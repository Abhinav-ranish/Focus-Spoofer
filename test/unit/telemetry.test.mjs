import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fakeStorage, fakeFetch, at, DAY } from './fakes.mjs';

const require = createRequire(import.meta.url);
const T = require('../../extension/telemetry.js');

function setup({ enabled = false, now = at('2026-10-07T12:00:00Z'), fetch = fakeFetch(), endpoint = 'https://fb.example', initial = {}, alwaysOn = 0 } = {}) {
    const storage = fakeStorage({ ...(enabled ? { analyticsEnabled: true } : {}), ...initial });
    const clock = { now };
    const t = T.createTelemetry({
        storage, fetch, endpoint, version: '1.8',
        now: () => clock.now,
        alwaysOnCount: async () => alwaysOn,
    });
    return { t, storage, fetch, clock };
}

test('disabled (default): nothing is counted, stored or sent', async () => {
    const { t, storage, fetch, clock } = setup();
    await t.touch();
    await t.count('activations');
    await t.count('alwaysOnAdded', 3);
    await t.error('register_always_on');
    await t.activation();
    clock.now += 2 * DAY;
    assert.equal(await t.flush(true), 0);
    assert.equal(fetch.calls.length, 0);
    assert.equal(storage.data.telemetry, undefined);
    // Only the local "has ever activated" bit may be written, never sent.
    assert.deepEqual(Object.keys(storage.data).sort(), ['everActivated']);
    assert.deepEqual(await t.pending(), []);
});

test('enabled: counts aggregate per UTC day and only finished days are sent', async () => {
    const { t, fetch, clock } = setup({ enabled: true });
    await t.activation();
    await t.activation();
    await t.count('deactivations');
    await t.count('alwaysOnAdded', 2);
    await t.error('register_always_on');
    await t.error('something-new');
    assert.equal(await t.flush(true), 0, 'today must not be sent yet');
    assert.equal(fetch.calls.length, 0);

    clock.now += DAY;
    assert.equal(await t.flush(true), 1);
    assert.equal(fetch.calls.length, 1);
    const { url, body, init } = fetch.calls[0];
    assert.equal(url, 'https://fb.example/api/report');
    assert.equal(init.credentials, 'omit');
    assert.deepEqual(body, {
        schema: 1, v: '1.8', day: '2026-10-07', week: '2026-W41',
        counts: { activations: 2, deactivations: 1, alwaysOnAdded: 2, alwaysOnRemoved: 0 },
        usesAlwaysOn: false, firstActivation: true,
        errors: { register_always_on: 1, unknown: 1 },
    });
    // Sent days are removed; nothing is re-sent.
    clock.now += 3 * 3600000;
    assert.equal(await t.flush(true), 0);
});

test('report payload never contains identifiers or free text', async () => {
    const { t, fetch, clock } = setup({ enabled: true, alwaysOn: 4 });
    await t.activation();
    clock.now += DAY;
    await t.flush(true);
    const body = fetch.calls[0].body;
    assert.deepEqual(Object.keys(body).sort(), ['counts', 'day', 'errors', 'firstActivation', 'schema', 'usesAlwaysOn', 'v', 'week']);
    assert.equal(body.usesAlwaysOn, true);
    for (const v of Object.values(body.counts)) assert.equal(typeof v, 'number');
});

test('week flag only on the first report of each ISO week', async () => {
    const { t, fetch, clock } = setup({ enabled: true, now: at('2026-10-05T10:00:00Z') }); // Monday
    for (let i = 0; i < 8; i++) {
        await t.touch();
        clock.now += DAY;
        await t.flush(true);
    }
    const weeks = fetch.calls.map(c => [c.body.day, c.body.week]);
    assert.deepEqual(weeks.filter(w => w[1]).map(w => w.join(' ')), ['2026-10-05 2026-W41', '2026-10-12 2026-W42']);
    assert.equal(fetch.calls.length, 8);
});

test('failed sends are kept and retried; 4xx rejections are dropped', async () => {
    let mode = 'down';
    const fetch = fakeFetch(() => mode === 'down' ? new Error('offline') : mode === 'reject' ? { ok: false, status: 400 } : { ok: true, status: 200 });
    const { t, clock, storage } = setup({ enabled: true, fetch });
    await t.count('activations');
    clock.now += DAY;
    assert.equal(await t.flush(true), 0);
    assert.ok(storage.data.telemetry.days['2026-10-07'], 'day kept for retry');
    // the failure itself is recorded as an error category for the current day
    assert.equal(storage.data.telemetry.days['2026-10-08'].errors.report_send, 1);
    mode = 'up';
    assert.equal(await t.flush(true), 1);
    assert.equal(fetch.calls.at(-1).body.day, '2026-10-07');

    await t.count('activations');
    clock.now += DAY;
    mode = 'reject';
    await t.flush(true);
    assert.equal(storage.data.telemetry.days['2026-10-08'], undefined, 'rejected report is not retried forever');
});

test('days older than a week are discarded, not sent', async () => {
    const { t, fetch, clock } = setup({ enabled: true });
    await t.count('activations');
    clock.now += 10 * DAY;
    await t.flush(true);
    assert.equal(fetch.calls.length, 0);
});

test('flush is throttled to once an hour unless forced', async () => {
    const { t, fetch, clock } = setup({ enabled: true });
    await t.touch();
    clock.now += DAY;
    await t.flush();
    await t.touch();
    clock.now += DAY;
    await t.flush(); // within the hour of the previous attempt? no: a day passed
    assert.equal(fetch.calls.length, 2);
    await t.touch();
    clock.now += 60000;
    assert.equal(await t.flush(), 0);
});

test('first activation is only reported for genuinely new installs', async () => {
    // Existing user updating: marked on onInstalled(reason=update).
    const a = setup({ enabled: true });
    await a.t.markExistingInstall();
    await a.t.activation();
    a.clock.now += DAY;
    await a.t.flush(true);
    assert.equal(a.fetch.calls[0].body.firstActivation, false);

    // User who activated before opting in, then opts in.
    const b = setup({ enabled: false });
    await b.t.activation();
    await b.t.setEnabled(true);
    await b.t.activation();
    b.clock.now += DAY;
    await b.t.flush(true);
    assert.equal(b.fetch.calls[0].body.firstActivation, false);
});

test('opting out deletes pending data and stops sending', async () => {
    const { t, fetch, clock, storage } = setup({ enabled: true });
    await t.count('activations');
    await t.setEnabled(false);
    assert.equal(storage.data.telemetry, undefined);
    clock.now += DAY;
    await t.flush(true);
    assert.equal(fetch.calls.length, 0);
});

test('no endpoint configured: nothing is sent even when enabled', async () => {
    const { t, fetch, clock } = setup({ enabled: true, endpoint: '' });
    await t.count('activations');
    clock.now += DAY;
    await t.flush(true);
    assert.equal(fetch.calls.length, 0);
});

test('pending() previews exactly what flush() would send', async () => {
    const { t, fetch, clock } = setup({ enabled: true, alwaysOn: 1 });
    await t.activation();
    clock.now += DAY;
    await t.count('deactivations');
    clock.now += DAY;
    const preview = await t.pending();
    await t.flush(true);
    assert.deepEqual(preview, fetch.calls.map(c => c.body));
});

test('isoWeek matches ISO-8601 at year boundaries', () => {
    assert.equal(T.isoWeek('2026-01-01'), '2026-W01');
    assert.equal(T.isoWeek('2027-01-01'), '2026-W53');
    assert.equal(T.isoWeek('2024-12-30'), '2025-W01');
    assert.equal(T.isoWeek('2026-10-07'), '2026-W41');
});
