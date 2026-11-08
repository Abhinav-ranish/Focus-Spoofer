import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import worker, { validateFeedback, validateReport, REASONS, ERROR_CATEGORIES, cleanText } from '../../server/src/worker.js';
import { fakeStorage, fakeFetch, at, DAY } from './fakes.mjs';

const require = createRequire(import.meta.url);
const T = require('../../extension/telemetry.js');

// Minimal D1 stand-in: records statements, returns canned rows for SELECTs.
function fakeDB() {
    const runs = [];
    const stmt = (sql) => ({
        sql, args: [],
        bind(...a) { this.args = a; return this; },
        async run() { runs.push({ sql, args: this.args }); return { success: true }; },
        async all() { runs.push({ sql, args: this.args }); return { results: [] }; },
    });
    return {
        runs,
        prepare: (sql) => stmt(sql),
        async batch(stmts) { for (const s of stmts) runs.push({ sql: s.sql, args: s.args }); return []; },
    };
}

function fakeLimiter(allow = Infinity) {
    const keys = [];
    let n = 0;
    return { keys, async limit({ key }) { keys.push(key); return { success: ++n <= allow }; } };
}

const ORIGIN = 'https://fb.example';
const EXT_ORIGIN = 'chrome-extension://jljikgppdmjedegdnehgibcfcecafodh';
function req(path, { method = 'POST', body, type = 'application/json', headers = {} } = {}) {
    // Reports come from the extension; everything else from our own pages.
    const origin = path === '/api/report' ? { origin: EXT_ORIGIN } : {};
    return new Request(ORIGIN + path, {
        method,
        headers: { 'content-type': type, 'cf-connecting-ip': '203.0.113.9', ...origin, ...headers },
        body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
    });
}
const env = (over = {}) => ({ DB: fakeDB(), SURVEY_LIMITER: fakeLimiter(), REPORT_LIMITER: fakeLimiter(), DASHBOARD_TOKEN: 'secret-token', ...over });

test('survey reasons match the page and the spec', async () => {
    const fs = await import('node:fs');
    const html = fs.readFileSync(new URL('../../server/public/uninstall.html', import.meta.url), 'utf8');
    const values = [...html.matchAll(/name="reason" value="([a-z_]+)"/g)].map(m => m[1]);
    assert.deepEqual(values, REASONS);
});

test('feedback validation: honeypot and too-fast are silently dropped, bad reason rejected', () => {
    assert.equal(validateFeedback({ reason: 'other', t: 5000, website: 'spam' }).silent, true);
    assert.equal(validateFeedback({ reason: 'other', t: 200 }).silent, true);
    assert.equal(validateFeedback({ reason: 'other' }).silent, true);
    assert.equal(validateFeedback({ reason: 'hack', t: 5000 }).ok, false);
    const ok = validateFeedback({ reason: 'broke_sites', t: 5000, details: '  broke\u0000 gmail  ', v: '1.8' });
    assert.deepEqual(ok.row, { reason: 'broke_sites', site: null, details: 'broke gmail', version: '1.8' });
    assert.equal(validateFeedback({ reason: 'temporary', t: 5000, v: '<script>' }).row.version, 'unknown');
    assert.equal(cleanText('x'.repeat(5000)).length, 1000);
    assert.equal(cleanText('   '), null);
});

test('feedback validation: "other" needs details; site is kept only for site reasons, as a bare host', () => {
    assert.equal(validateFeedback({ reason: 'other', t: 5000 }).error, 'details_required');
    assert.equal(validateFeedback({ reason: 'other', t: 5000, details: ' x ' }).error, 'details_required');
    assert.equal(validateFeedback({ reason: 'other', t: 5000, details: 'too many popups' }).ok, true);
    const site = (s, reason = 'didnt_work') => validateFeedback({ reason, t: 5000, site: s }).row.site;
    assert.equal(site('https://www.Canvas.ASU.edu/courses/123?x=1'), 'canvas.asu.edu');
    assert.equal(site('canvas.asu.edu/quiz'), 'canvas.asu.edu');
    assert.equal(site('my school portal'), 'my school portal');
    assert.equal(site('   '), null);
    assert.equal(site('canvas.asu.edu', 'temporary'), null);
});

test('POST /api/uninstall-feedback stores only reason/site/details/version/day — never the IP', async () => {
    const e = env();
    const res = await worker.fetch(req('/api/uninstall-feedback', { body: { reason: 'didnt_work', site: 'canvas.asu.edu', details: 'quiz page', t: 4000, v: '1.8' } }), e);
    assert.equal(res.status, 200);
    assert.equal(e.DB.runs.length, 1);
    const { sql, args } = e.DB.runs[0];
    assert.match(sql, /INSERT INTO uninstall_feedback \(day, reason, site, details, version\)/);
    assert.equal(args.length, 5);
    assert.ok(!JSON.stringify(args).includes('203.0.113.9'));
    assert.deepEqual(args.slice(1), ['didnt_work', 'canvas.asu.edu', 'quiz page', '1.8']);
    assert.equal(e.SURVEY_LIMITER.keys[0], '203.0.113.9', 'IP is used only as the ephemeral rate-limit key');
});

test('POST /api/uninstall-visit stores only day and version; cross-origin is refused', async () => {
    const e = env();
    let res = await worker.fetch(req('/api/uninstall-visit', { body: { v: '1.8.2' } }), e);
    assert.equal(res.status, 200);
    assert.equal(e.DB.runs.length, 1);
    assert.match(e.DB.runs[0].sql, /INSERT INTO uninstall_visits \(day, version, visits\)/);
    assert.deepEqual(e.DB.runs[0].args.slice(1), ['1.8.2']);
    res = await worker.fetch(req('/api/uninstall-visit', { body: { v: '1.8.2' }, headers: { origin: 'https://evil.example' } }), e);
    assert.equal(res.status, 403);
});

test('feedback: honeypot returns 200 without storing; cross-origin and rate-limited are refused', async () => {
    let e = env();
    let res = await worker.fetch(req('/api/uninstall-feedback', { body: { reason: 'other', t: 4000, website: 'x' } }), e);
    assert.equal(res.status, 200);
    assert.equal(e.DB.runs.length, 0);

    res = await worker.fetch(req('/api/uninstall-feedback', { body: { reason: 'temporary', t: 4000 }, headers: { origin: 'https://evil.example' } }), e);
    assert.equal(res.status, 403);

    e = env({ SURVEY_LIMITER: fakeLimiter(2) });
    const codes = [];
    for (let i = 0; i < 4; i++) {
        codes.push((await worker.fetch(req('/api/uninstall-feedback', { body: { reason: 'temporary', t: 4000 } }), e)).status);
    }
    assert.deepEqual(codes, [200, 200, 429, 429]);
    assert.equal(e.DB.runs.length, 2);
});

test('oversized and malformed bodies are rejected', async () => {
    const e = env();
    let res = await worker.fetch(req('/api/uninstall-feedback', { body: 'x'.repeat(5000), type: 'text/plain' }), e);
    assert.equal(res.status, 400);
    res = await worker.fetch(req('/api/report', { body: '{not json' }), e);
    assert.equal(res.status, 400);
    res = await worker.fetch(req('/api/report', { body: JSON.stringify({ schema: 1, day: '2026-10-06', pad: 'x'.repeat(5000) }) }), e);
    assert.equal(res.status, 400);
    assert.equal(e.DB.runs.length, 0);
});

test('report validation clamps counters and bounds the day', () => {
    const now = new Date('2026-10-08T05:00:00Z');
    assert.equal(validateReport({ schema: 1, day: '2026-10-09' }, now).ok, false, 'future');
    assert.equal(validateReport({ schema: 1, day: '2026-09-20' }, now).ok, false, 'too old');
    assert.equal(validateReport({ schema: 2, day: '2026-10-07' }, now).ok, false);
    assert.equal(validateReport({ schema: 1, day: '2026-10-07', week: 'W41' }, now).ok, false);
    const r = validateReport({ schema: 1, day: '2026-10-07', v: '1.8', counts: { activations: 1e9, deactivations: -4, alwaysOnAdded: 1.5 }, errors: { register_always_on: 2, '<x>': 1 } }, now).report;
    assert.equal(r.activations, 10000);
    assert.equal(r.deactivations, 0);
    assert.equal(r.always_on_added, 0);
    assert.deepEqual(r.errors, [['register_always_on', 2], ['unknown', 1]]);
});

test('contract: every report the extension builds is accepted by the server', async () => {
    const storage = fakeStorage({ analyticsEnabled: true });
    const clock = { now: at('2026-10-05T10:00:00Z') };
    const fetch = fakeFetch();
    const t = T.createTelemetry({ storage, fetch, endpoint: ORIGIN, version: '1.8', now: () => clock.now, alwaysOnCount: async () => 2 });
    for (let i = 0; i < 3; i++) {
        await t.activation();
        await t.count('alwaysOnRemoved');
        for (const c of T.ERROR_CATEGORIES) await t.error(c);
        clock.now += DAY;
        await t.flush(true);
    }
    assert.equal(fetch.calls.length, 3);
    for (const c of fetch.calls) {
        const v = validateReport(c.body, new Date(clock.now));
        assert.equal(v.ok, true, JSON.stringify(v));
        assert.equal(v.report.errors.some(([k]) => k === 'unknown' && c.body.errors.unknown === undefined), false);
    }
    assert.deepEqual(T.ERROR_CATEGORIES, ERROR_CATEGORIES);
});

test('POST /api/report folds into aggregates (no per-report row) and answers CORS', async () => {
    const e = env();
    const day = new Date(Date.now() - DAY).toISOString().slice(0, 10);
    const res = await worker.fetch(req('/api/report', { body: { schema: 1, v: '1.8', day, week: '2026-W41', counts: { activations: 3 }, usesAlwaysOn: true, firstActivation: true, errors: { inject_flag: 1 } } }), e);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), null, 'no CORS: websites must not be able to post reports');
    const sqls = e.DB.runs.map(r => r.sql);
    assert.equal(sqls.length, 3);
    assert.ok(sqls.every(s => /ON CONFLICT/.test(s)), 'every write must be an aggregate upsert');
    assert.deepEqual(e.DB.runs[0].args, [day, '1.8', 1, 3, 0, 0, 0, 1, 1]);
});

test('reports are only accepted from extension origins (websites cannot poison stats)', async () => {
    const day = new Date(Date.now() - DAY).toISOString().slice(0, 10);
    const body = { schema: 1, v: '1.8', day, counts: { activations: 1 } };
    let e = env();
    for (const origin of ['https://evil.example', 'null', ORIGIN]) {
        assert.equal((await worker.fetch(req('/api/report', { body, headers: { origin } }), e)).status, 403, origin);
    }
    const noOrigin = new Request(ORIGIN + '/api/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await worker.fetch(noOrigin, e)).status, 403);
    assert.equal(e.DB.runs.length, 0);
    assert.equal((await worker.fetch(req('/api/report', { body }), e)).status, 200);
    // Optional pinning to the published extension ID(s).
    e = env({ EXTENSION_ORIGINS: 'chrome-extension://' + 'a'.repeat(32) });
    assert.equal((await worker.fetch(req('/api/report', { body }), e)).status, 403);
    assert.equal((await worker.fetch(req('/api/report', { body, headers: { origin: 'chrome-extension://' + 'a'.repeat(32) } }), e)).status, 200);
});

test('stats require the dashboard token', async () => {
    const e = env();
    assert.equal((await worker.fetch(req('/api/stats', { method: 'GET' }), e)).status, 401);
    assert.equal((await worker.fetch(req('/api/stats', { method: 'GET', headers: { authorization: 'Bearer nope' } }), e)).status, 401);
    const ok = await worker.fetch(req('/api/stats', { method: 'GET', headers: { authorization: 'Bearer secret-token' } }), e);
    assert.equal(ok.status, 200);
    assert.deepEqual(Object.keys(await ok.json()).sort(), ['clickPlaces', 'clickSources', 'clicks', 'comments', 'daily', 'errors', 'ok', 'reasons', 'uninstalls', 'versions', 'weekly']);
    assert.equal((await worker.fetch(req('/api/stats', { method: 'GET', headers: { authorization: 'Bearer x' } }), env({ DASHBOARD_TOKEN: undefined }))).status, 401);
});

test('unknown routes 404; DB failures return a generic 500', async () => {
    assert.equal((await worker.fetch(req('/nope', { method: 'GET' }), env())).status, 404);
    const broken = env({ DB: { prepare() { throw new Error('d1 down'); } } });
    const res = await worker.fetch(req('/api/uninstall-feedback', { body: { reason: 'temporary', t: 4000 } }), broken);
    assert.equal(res.status, 500);
    assert.equal((await res.json()).error, 'server_error');
});

test('proxied requests: IP header trusted only with the shared secret; public origin may post the survey', async () => {
    const { clientKey, sameOrigin } = await import('../../server/src/worker.js');
    const h = (headers) => new Request('https://fb.example/api/uninstall-feedback', { method: 'POST', headers });
    const envP = { PROXY_SECRET: 's3cret', PUBLIC_ORIGINS: 'https://focus.oddworks.us' };
    assert.equal(clientKey(h({ 'cf-connecting-ip': '10.0.0.1', 'x-proxy-auth': 's3cret', 'x-client-ip': '203.0.113.9' }), envP), '203.0.113.9');
    assert.equal(clientKey(h({ 'cf-connecting-ip': '10.0.0.1', 'x-proxy-auth': 'guess', 'x-client-ip': '203.0.113.9' }), envP), '10.0.0.1');
    assert.equal(clientKey(h({ 'cf-connecting-ip': '10.0.0.1', 'x-client-ip': '203.0.113.9' }), {}), '10.0.0.1');
    assert.equal(sameOrigin(h({ origin: 'https://focus.oddworks.us' }), envP), true);
    assert.equal(sameOrigin(h({ origin: 'https://evil.example' }), envP), false);
    assert.equal(sameOrigin(h({ origin: 'https://focus.oddworks.us' }), {}), false);
});

test('UA parsing and source classification for /opensource', async () => {
    const { parseUA, classifySource } = await import('../../server/src/worker.js');
    const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
    assert.deepEqual(parseUA(mac), { browser: 'Chrome 131', os: 'macOS', device: 'desktop', bot: false });
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [LinkedInApp]/9.30';
    assert.deepEqual(parseUA(iphone), { browser: 'LinkedIn app', os: 'iOS 18', device: 'mobile', bot: false });
    const edge = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.2903.70';
    assert.equal(parseUA(edge).browser, 'Edge 131');
    assert.equal(parseUA(edge).os, 'Windows 10/11');
    assert.equal(parseUA('LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)').bot, true);

    assert.equal(classifySource('https://www.linkedin.com/feed/', mac), 'linkedin');
    assert.equal(classifySource('https://lnkd.in/abc', mac), 'linkedin');
    assert.equal(classifySource('https://t.co/xyz', mac), 'x');
    assert.equal(classifySource('https://www.google.co.in/', mac), 'google');
    assert.equal(classifySource('https://blog.example.com/post', mac), 'blog.example.com');
    assert.equal(classifySource(null, iphone), 'linkedin');
    assert.equal(classifySource(null, mac), 'direct');
    assert.equal(classifySource('https://www.linkedin.com/', mac, 'Resume PDF'), 'resumepdf');
});

test('/opensource logs the visit with proxied IP and geo, then redirects to GitHub', async () => {
    const e = env({ PROXY_SECRET: 's3cret', CLICK_LIMITER: fakeLimiter() });
    const geo = encodeURIComponent(JSON.stringify({ country: 'BR', region: 'São Paulo', city: 'São Paulo', asOrganization: 'Vivo' }));
    const waits = [];
    const res = await worker.fetch(req('/opensource?ref=linkedin', {
        method: 'GET',
        headers: { 'x-proxy-auth': 's3cret', 'x-client-ip': '198.51.100.7', 'x-client-geo': geo, referer: 'https://www.linkedin.com/', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/131.0 Safari/537.36' },
    }), e, { waitUntil: (p) => waits.push(p) });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), 'https://github.com/Abhinav-ranish/Focus-Spoofer/');
    await Promise.all(waits);
    const ins = e.DB.runs.find(r => r.sql.includes('INSERT INTO link_clicks'));
    assert.deepEqual(ins.args.slice(2, 10), ['198.51.100.7', 'BR', 'São Paulo', 'São Paulo', null, null, 'Vivo', null]);
    assert.equal(ins.args[ins.args.length - 2], 'linkedin');
    assert.deepEqual(e.CLICK_LIMITER.keys, ['198.51.100.7']);

    // Spoofed proxy headers without the secret are ignored; DB failures still redirect.
    const e2 = env({ PROXY_SECRET: 's3cret' });
    await worker.fetch(req('/opensource', { method: 'GET', headers: { 'x-client-ip': '1.2.3.4', 'x-client-geo': geo } }), e2);
    assert.equal(e2.DB.runs.find(r => r.sql.includes('INSERT INTO link_clicks')).args[2], '203.0.113.9');
    const broken = env({ DB: { prepare: () => ({ bind() { return this; } }), batch: async () => { throw new Error('down'); } } });
    assert.equal((await worker.fetch(req('/opensource', { method: 'GET' }), broken)).status, 302);
    // HEAD (link checkers) redirects without logging.
    const e3 = env();
    assert.equal((await worker.fetch(req('/opensource', { method: 'HEAD' }), e3)).status, 302);
    assert.equal(e3.DB.runs.length, 0);
});
