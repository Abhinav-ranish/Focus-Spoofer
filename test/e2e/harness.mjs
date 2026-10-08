// Shared helpers for the real-browser regression suite.
//
// Launches Chromium (Chrome for Testing from the Playwright cache, or
// $CHROME_PATH) with the unpacked extension loaded, serves fixture pages from
// two local origins, and drives the extension through an extension page so the
// same message API the popup uses is exercised.
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const EXTENSION_DIR = path.resolve(here, '../../extension');
const FIXTURES = path.join(here, 'fixtures');

export function findChrome() {
    if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
    const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright');
    const linuxCache = path.join(os.homedir(), '.cache/ms-playwright');
    for (const root of [cache, linuxCache]) {
        if (!fs.existsSync(root)) continue;
        const dirs = fs.readdirSync(root).filter(d => /^chromium-\d+$/.test(d)).sort().reverse();
        for (const d of dirs) {
            const candidates = [
                'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
                'chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
                'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
                'chrome-linux64/chrome',
                'chrome-linux/chrome',
            ];
            for (const c of candidates) {
                const p = path.join(root, d, c);
                if (fs.existsSync(p)) return p;
            }
        }
    }
    throw new Error('No Chromium found. Set CHROME_PATH or run `npx playwright-core install chromium`.');
}

// Serve test/e2e/fixtures on two ports => two distinct origins.
export async function startServers() {
    const handler = (req, res) => {
        const url = new URL(req.url, 'http://x');
        const file = path.join(FIXTURES, url.pathname === '/' ? 'page.html' : url.pathname);
        if (!file.startsWith(FIXTURES) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(fs.readFileSync(file));
    };
    const listen = () => new Promise(resolve => {
        const s = http.createServer(handler).listen(0, '127.0.0.1', () => resolve(s));
    });
    const a = await listen();
    const b = await listen();
    return {
        // 127.0.0.1 and localhost are different origins (separate sessionStorage).
        originA: `http://127.0.0.1:${a.address().port}`,
        originB: `http://localhost:${b.address().port}`,
        close: () => { a.close(); b.close(); },
    };
}

export async function launch({ extensionDir = EXTENSION_DIR, userDataDir } = {}) {
    const dir = userDataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'focus-spoofer-e2e-'));
    const context = await chromium.launchPersistentContext(dir, {
        executablePath: findChrome(),
        headless: process.env.HEADFUL ? false : true,
        args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
    });
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    const extId = new URL(sw.url()).host;
    // An extension page to call chrome.* APIs from, exactly as the popup does.
    const driver = await context.newPage();
    await driver.goto(`chrome-extension://${extId}/options.html`);
    const ext = {
        tabIdOf: (url) => driver.evaluate(async (u) => {
            const tabs = await chrome.tabs.query({});
            const t = tabs.find(t => t.url === u || t.pendingUrl === u);
            return t ? t.id : null;
        }, url),
        send: (msg) => driver.evaluate((m) => chrome.runtime.sendMessage(m), msg),
        badge: (tabId) => driver.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId),
        sync: (obj) => driver.evaluate((o) => chrome.storage.sync.set(o), obj),
        getSync: (keys) => driver.evaluate((k) => chrome.storage.sync.get(k), keys),
        local: (keys) => driver.evaluate((k) => chrome.storage.local.get(k), keys),
        setLocal: (obj) => driver.evaluate((o) => chrome.storage.local.set(o), obj),
        registered: () => driver.evaluate(() => chrome.scripting.getRegisteredContentScripts()),
        evalInSW: (fn, arg) => sw.evaluate(fn, arg),
    };
    return { context, sw, extId, driver, ext, userDataDir: dir };
}

// Toggle protection for the tab showing `page`, the way the popup does, and
// wait for the reload it triggers.
export async function toggle(env, page) {
    const tabId = await env.ext.tabIdOf(page.url());
    const reloaded = page.waitForEvent('load');
    const res = await env.ext.send({ action: 'toggle_state', tabId });
    await reloaded;
    return res;
}

export async function getState(env, page) {
    const tabId = await env.ext.tabIdOf(page.url());
    return env.ext.send({ action: 'get_state', tabId, url: page.url() });
}

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export async function until(fn, { timeout = 5000, interval = 50 } = {}) {
    const end = Date.now() + timeout;
    let last;
    while (Date.now() < end) {
        last = await fn();
        if (last) return last;
        await sleep(interval);
    }
    return last;
}

// ── Raw DevTools-protocol launcher ───────────────────────────────────────────
// Playwright keeps every page "visible and focused" (by design, for stable
// tests), so it cannot exercise real tab switches. This launcher talks plain
// CDP so switching tabs genuinely hides the page and blurs the window.
import { spawn } from 'node:child_process';

class CdpTarget {
    constructor(wsUrl) { this.wsUrl = wsUrl; this.seq = 0; this.pending = new Map(); }
    async open() {
        this.ws = new WebSocket(this.wsUrl);
        this.ws.onmessage = (e) => {
            const m = JSON.parse(e.data);
            const cb = this.pending.get(m.id);
            if (cb) { this.pending.delete(m.id); cb(m); }
        };
        await new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = reject; });
        return this;
    }
    send(method, params = {}) {
        return new Promise((resolve, reject) => {
            const id = ++this.seq;
            this.pending.set(id, (m) => m.error ? reject(new Error(m.error.message)) : resolve(m.result));
            this.ws.send(JSON.stringify({ id, method, params }));
        });
    }
    // Evaluate an expression (string) in the page; awaits promises.
    async eval(expression) {
        const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
        return r.result.value;
    }
    close() { try { this.ws.close(); } catch (e) { } }
}

export async function launchRaw({ extensionDir = EXTENSION_DIR } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'focus-spoofer-raw-'));
    const port = 9400 + Math.floor(Math.random() * 500);
    const proc = spawn(findChrome(), [
        `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`,
        `--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`,
        '--no-first-run', '--no-default-browser-check',
        ...(process.env.HEADFUL ? ['--window-size=900,700'] : ['--headless=new']),
        'about:blank',
    ], { stdio: 'ignore' });
    const base = `http://127.0.0.1:${port}`;
    const json = async (p, method = 'GET') => (await fetch(base + p, { method })).json();
    const ready = await until(async () => {
        try {
            const l = await json('/json/list');
            return l.find(t => t.type === 'service_worker' && /^chrome-extension:\/\/[a-p]{32}\/background\.js$/.test(t.url)) ? l : null;
        } catch (e) { return null; }
    }, { timeout: 15000, interval: 200 });
    if (!ready) { proc.kill(); throw new Error('browser/extension did not start'); }
    const extId = new URL(ready.find(t => t.type === 'service_worker' && t.url.endsWith('/background.js')).url).host;
    const targets = [];
    // Browser-level session: Target.createTarget may open chrome-extension://
    // pages, which /json/new refuses.
    const browserTarget = await new CdpTarget((await json('/json/version')).webSocketDebuggerUrl).open();
    targets.push(browserTarget);
    const api = {
        extId,
        async newTab(url) {
            const { targetId } = await browserTarget.send('Target.createTarget', { url });
            const t = await until(async () => (await json('/json/list')).find(x => x.id === targetId));
            const target = await new CdpTarget(t.webSocketDebuggerUrl).open();
            target.id = targetId;
            targets.push(target);
            await until(() => target.eval('document.readyState === "complete"').catch(() => false));
            return target;
        },
        async activate(target) {
            await fetch(base + '/json/activate/' + target.id);
            await sleep(400);
        },
        async close() {
            targets.forEach(t => t.close());
            proc.kill();
            await sleep(200);
        },
    };
    // Extension page used to drive chrome.* APIs, like the popup.
    api.driver = await api.newTab(`chrome-extension://${extId}/options.html`);
    api.toggle = async (target) => {
        const href = await target.eval('window.__beforeToggle = true; location.href');
        await api.driver.eval(`(async () => {
            const t = (await chrome.tabs.query({})).find(t => t.url === ${JSON.stringify(href)});
            return chrome.runtime.sendMessage({ action: 'toggle_state', tabId: t.id });
        })()`);
        // Wait for the reload the toggle triggers to produce a fresh document.
        await until(() => target.eval('!window.__beforeToggle && document.readyState === "complete"').catch(() => false),
            { timeout: 10000 });
    };
    return api;
}
