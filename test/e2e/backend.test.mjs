// End-to-end: extension ↔ feedback Worker. The real server/src/worker.js runs
// behind a tiny Node adapter with an in-memory D1 stand-in, and a copy of the
// extension is pointed at it via config.js.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../../server/src/worker.js';
import { launch, until, sleep, EXTENSION_DIR } from './harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(here, '../../server/public');
const VERSION = JSON.parse(fs.readFileSync(path.join(EXTENSION_DIR, 'manifest.json'), 'utf8')).version;

const db = { feedback: [], reports: [], stmts: [] };
const fakeD1 = {
    prepare(sql) {
        return {
            sql, args: [],
            bind(...a) { this.args = a; return this; },
            async run() { db.stmts.push(sql); if (/uninstall_feedback/.test(sql)) db.feedback.push(this.args); return {}; },
            async all() { return { results: [] }; },
        };
    },
    async batch(stmts) { for (const s of stmts) { db.stmts.push(s.sql); if (/usage_daily/.test(s.sql)) db.reports.push(s.args); } return []; },
};
const requests = [];
let server, origin, env;

before(async () => {
    server = http.createServer(async (req, res) => {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const body = Buffer.concat(chunks);
        requests.push({ method: req.method, url: req.url, origin: req.headers.origin, body: body.toString() });
        const request = new Request(origin + req.url, {
            method: req.method,
            headers: { ...req.headers, 'cf-connecting-ip': req.socket.remoteAddress },
            body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
        });
        const assets = {
            fetch: async (r) => {
                let file = path.join(PUBLIC, new URL(r.url).pathname);
                if (!path.extname(file)) file += '.html'; // mirrors Cloudflare's html_handling
                if (!file.startsWith(PUBLIC) || !fs.existsSync(file)) return new Response('nf', { status: 404 });
                return new Response(fs.readFileSync(file), { headers: { 'content-type': 'text/html; charset=utf-8' } });
            },
        };
        const out = await worker.fetch(request, { DB: fakeD1, ASSETS: assets, DASHBOARD_TOKEN: 't' });
        res.writeHead(out.status, Object.fromEntries(out.headers));
        res.end(Buffer.from(await out.arrayBuffer()));
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    origin = `http://127.0.0.1:${server.address().port}`;

    const ext = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-spoofer-ext-'));
    fs.cpSync(EXTENSION_DIR, ext, { recursive: true });
    const cfg = path.join(ext, 'config.js');
    fs.writeFileSync(cfg, fs.readFileSync(cfg, 'utf8').replace(/BACKEND_ORIGIN:\s*''/, `BACKEND_ORIGIN: '${origin}'`));
    env = await launch({ extensionDir: ext });
});

after(async () => {
    await env?.context.close();
    server?.close();
});

async function restartWorker() {
    const cdp = await env.context.newCDPSession(env.driver);
    await cdp.send('ServiceWorker.enable').catch(() => { });
    await cdp.send('ServiceWorker.stopAllWorkers').catch(() => { });
    await sleep(300);
}

const yesterday = () => new Date(Date.now() - 86400000).toISOString().slice(0, 10);

test('opted out by default: the extension sends nothing', async () => {
    const page = await env.context.newPage();
    await page.goto(origin + '/nope-404'); // any page; wakes the worker via webNavigation
    await env.ext.send({ action: 'get_state', tabId: await env.ext.tabIdOf(page.url()), url: page.url() });
    await env.ext.setLocal({ telemetry: { days: { [yesterday()]: { counts: { activations: 1 }, errors: {}, firstActivation: false } } } });
    await restartWorker();
    await env.ext.send({ action: 'get_state', tabId: 1, url: origin + '/' });
    await sleep(800);
    assert.equal(requests.filter(r => r.url.startsWith('/api/')).length, 0);
    assert.equal((await env.ext.local(['analyticsEnabled'])).analyticsEnabled, undefined);
    await env.ext.setLocal({ telemetry: null });
    await page.close();
});

test('settings page: opting in via the checkbox sends a finished day as one aggregate report', async () => {
    await env.driver.reload();
    const box = env.driver.locator('#analyticsCheckbox');
    assert.equal(await box.isDisabled(), false);
    assert.equal(await box.isChecked(), false);
    await box.check();
    await until(async () => (await env.ext.local(['analyticsEnabled'])).analyticsEnabled === true);

    await env.ext.setLocal({ telemetry: { days: { [yesterday()]: { counts: { activations: 2, deactivations: 1 }, errors: { inject_flag: 1 }, firstActivation: true } } } });
    await env.driver.reload();
    const preview = await env.driver.locator('#analyticsPreview').textContent();
    assert.match(preview, /"activations": 2/);

    await restartWorker();
    await env.ext.send({ action: 'get_state', tabId: 1, url: origin + '/' });
    const sent = await until(() => requests.find(r => r.url === '/api/report' && r.method === 'POST'));
    assert.ok(sent, 'no report sent');
    const body = JSON.parse(sent.body);
    assert.equal(body.day, yesterday());
    assert.deepEqual(body.counts, { activations: 2, deactivations: 1, alwaysOnAdded: 0, alwaysOnRemoved: 0 });
    assert.ok(!/127\.0\.0\.1|localhost|http/.test(JSON.stringify(body)), 'report contains a URL/host');
    await until(() => db.reports.length === 1);
    const local = await env.ext.local(['telemetry']);
    assert.equal(local.telemetry.days[yesterday()], undefined, 'sent day not cleared');

    await box.uncheck();
    await until(async () => (await env.ext.local(['telemetry'])).telemetry === undefined);
});

test('survey page is usable at phone width', async () => {
    const page = await env.context.newPage();
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto(origin + '/uninstall?v=1.7');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflow, false, 'horizontal scroll on mobile');
    assert.equal(await page.locator('#submit').isDisabled(), true);
    await page.click('#skip');
    assert.equal(await page.locator('#skip-view').isVisible(), true);
    await page.close();
    assert.equal(db.feedback.length, 0, 'skip must not submit');
});

test('uninstalling opens the survey; a submitted response is stored without the IP', async () => {
    const opened = env.context.waitForEvent('page', { predicate: p => p.url().includes('/uninstall') || p.url() === 'about:blank', timeout: 15000 });
    await env.sw.evaluate(() => chrome.management.uninstallSelf()).catch(() => { });
    let page = await opened;
    await page.waitForURL(/\/uninstall\?v=/);
    assert.ok(page.url().endsWith('/uninstall?v=' + VERSION), page.url());
    await page.click('text=Caused issues with other websites');
    await page.fill('#details', 'Broke a form on my bank site');
    await sleep(1600); // the server ignores sub-1.5s submissions as bot traffic
    await page.click('#submit');
    await page.waitForSelector('#done-view', { state: 'visible' });
    await until(() => db.feedback.length === 1);
    const [day, reason, details, version] = db.feedback[0];
    assert.equal(reason, 'broke_sites');
    assert.equal(details, 'Broke a form on my bank site');
    assert.equal(version, VERSION);
    assert.match(day, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(!JSON.stringify(db.feedback).includes('127.0.0.1'));
});
