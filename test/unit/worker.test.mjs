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
function req(path, { method = 'POST', body, type = 'application/json', headers = {} } = {}) {
    return new Request(ORIGIN + path, {
        method,
        headers: { 'content-type': type, 'cf-connecting-ip': '203.0.113.9', ...headers },
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
    assert.deepEqual(ok.row, { reason: 'broke_sites', details: 'broke gmail', version: '1.8' });
    assert.equal(validateFeedback({ reason: 'other', t: 5000, v: '<script>' }).row.version, 'unknown');
    assert.equal(cleanText('x'.repeat(5000)).length, 1000);
    assert.equal(cleanText('   '), null);
});

test('POST /api/uninstall-feedback stores only reason/details/version/day — never the IP', async () => {
    const e = env();
    const res = await worker.fetch(req('/api/uninstall-feedback', { body: { reason: 'didnt_work', details: 'site X', t: 4000, v: '1.8' } }), e);
    assert.equal(res.status, 200);
    assert.equal(e.DB.runs.length, 1);
    const { sql, args } = e.DB.runs[0];
    assert.match(sql, /INSERT INTO uninstall_feedback \(day, reason, details, version\)/);
    assert.equal(args.length, 4);
    assert.ok(!JSON.stringify(args).includes('203.0.113.9'));
    assert.deepEqual(args.slice(1), ['didnt_work', 'site X', '1.8']);
    assert.equal(e.SURVEY_LIMITER.keys[0], '203.0.113.9', 'IP is used only as the ephemeral rate-limit key');
});

test('feedback: honeypot returns 200 without storing; cross-origin and rate-limited are refused', async () => {
    let e = env();
    let res = await worker.fetch(req('/api/uninstall-feedback', { body: { reason: 'other', t: 4000, website: 'x' } }), e);
    assert.equal(res.status, 200);
    assert.equal(e.DB.runs.length, 0);

    res = await worker.fetch(req('/api/uninstall-feedback', { body: { reason: 'other', t: 4000 }, headers: { origin: 'https://evil.example' } }), e);
    assert.equal(res.status, 403);

    e = env({ SURVEY_LIMITER: fakeLimiter(2) });
    const codes = [];
    for (let i = 0; i < 4; i++) {
        codes.push((await worker.fetch(req('/api/uninstall-feedback', { body: { reason: 'other', t: 4000 } }), e)).status);
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
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    const sqls = e.DB.runs.map(r => r.sql);
    assert.equal(sqls.length, 3);
    assert.ok(sqls.every(s => /ON CONFLICT/.test(s)), 'every write must be an aggregate upsert');
    assert.deepEqual(e.DB.runs[0].args, [day, '1.8', 1, 3, 0, 0, 0, 1, 1]);
    const pre = await worker.fetch(req('/api/report', { method: 'OPTIONS', body: undefined }), e);
    assert.equal(pre.status, 204);
});

test('stats require the dashboard token', async () => {
    const e = env();
    assert.equal((await worker.fetch(req('/api/stats', { method: 'GET' }), e)).status, 401);
    assert.equal((await worker.fetch(req('/api/stats', { method: 'GET', headers: { authorization: 'Bearer nope' } }), e)).status, 401);
    const ok = await worker.fetch(req('/api/stats', { method: 'GET', headers: { authorization: 'Bearer secret-token' } }), e);
    assert.equal(ok.status, 200);
    assert.deepEqual(Object.keys(await ok.json()).sort(), ['comments', 'daily', 'errors', 'ok', 'reasons', 'versions', 'weekly']);
    assert.equal((await worker.fetch(req('/api/stats', { method: 'GET', headers: { authorization: 'Bearer x' } }), env({ DASHBOARD_TOKEN: undefined }))).status, 401);
});

test('unknown routes 404; DB failures return a generic 500', async () => {
    assert.equal((await worker.fetch(req('/nope', { method: 'GET' }), env())).status, 404);
    const broken = env({ DB: { prepare() { throw new Error('d1 down'); } } });
    const res = await worker.fetch(req('/api/uninstall-feedback', { body: { reason: 'other', t: 4000 } }), broken);
    assert.equal(res.status, 500);
    assert.equal((await res.json()).error, 'server_error');
});
