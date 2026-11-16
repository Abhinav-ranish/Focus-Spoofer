import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fakeStorage } from './fakes.mjs';

const require = createRequire(import.meta.url);
const R = require('../../extension/review.js');
const MIN = 60000;

function setup(initial = {}) {
    const storage = fakeStorage(initial);
    const clock = { now: 1_000_000 };
    const r = R.createReview({ storage, now: () => clock.now });
    return { r, storage, clock };
}

test('counts only time spent playing out of view, across stretches', async () => {
    const { r, clock } = setup();
    await r.update(true); clock.now += 6 * MIN;
    await r.update(false); clock.now += 30 * MIN; // nothing playing: not counted
    assert.equal(await r.due(), false);
    await r.update(true); clock.now += 3 * MIN;
    assert.equal(await r.due(), false);
    clock.now += 1 * MIN; // 6 + 4 = 10 minutes, the open stretch included
    assert.equal(await r.due(), true);
});

test('repeated updates with the same state do not restart the stretch', async () => {
    const { r, clock } = setup();
    await r.update(true); clock.now += 5 * MIN;
    await r.update(true); clock.now += 5 * MIN;
    assert.equal(await r.due(), true);
});

test('asking ends it for good', async () => {
    const { r, clock, storage } = setup();
    await r.update(true); clock.now += 11 * MIN;
    assert.equal(await r.due(), true);
    await r.asked();
    assert.equal(await r.due(), false);
    assert.equal(await r.isAsked(), true);
    await r.update(true); clock.now += 60 * MIN;
    assert.equal(await r.due(), false);
    assert.equal(storage.data.review.since, undefined);
});

test('a stretch left open over a restart is dropped, and one stretch is capped', async () => {
    const { r, clock } = setup();
    await r.update(true); clock.now += 30 * MIN;
    await r.restart();
    assert.equal(await r.due(), false);

    const b = setup({ review: { keptMs: 0, since: 1_000_000 - 10 * 24 * 60 * MIN } });
    await b.r.update(false);
    assert.equal(b.storage.data.review.keptMs, R.MAX_STRETCH_MS);
});
