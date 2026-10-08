// Background/service-worker behaviour: state, always-on registration, navigation.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, startServers, toggle, getState, until, sleep } from './harness.mjs';

let env, srv;
before(async () => {
    srv = await startServers();
    env = await launch();
});
after(async () => {
    await env?.context.close();
    srv?.close();
});

let pageSeq = 0;
// Every page gets a unique URL so tabIdOf() can never pick a leftover tab.
async function openFixture(origin = srv.originA, p = '/') {
    const page = await env.context.newPage();
    await page.goto(`${origin}${p}?n=${++pageSeq}`);
    return page;
}


// Simpler, behaviour-based probe: a spoofed page swallows visibilitychange.
const swallowsVisibility = (page) => page.evaluate(() => {
    let fired = false;
    document.addEventListener('visibilitychange', () => { fired = true; });
    document.dispatchEvent(new Event('visibilitychange'));
    return !fired;
});

test('always-on domain protects new loads without toggling, and removal stops it', async () => {
    await env.ext.sync({ alwaysOnDomains: ['localhost'] });
    await until(async () => (await env.ext.registered()).some(s => s.id === 'focus-spoofer-auto'));
    const page = await openFixture(srv.originB);
    assert.equal(await swallowsVisibility(page), true);
    assert.equal((await getState(env, page)).isAlwaysOn, true);
    await env.ext.sync({ alwaysOnDomains: [] });
    await until(async () => !(await env.ext.registered()).some(s => s.id === 'focus-spoofer-auto'));
    await page.reload();
    assert.equal(await swallowsVisibility(page), false);
    await page.close();
});

test('one malformed always-on entry does not disable every other always-on domain', async () => {
    await env.ext.sync({ alwaysOnDomains: ['[::1]', 'localhost'] });
    await sleep(800);
    const page = await openFixture(srv.originB);
    assert.equal(await swallowsVisibility(page), true, 'valid domain lost protection because of a bad sibling entry');
    await env.ext.sync({ alwaysOnDomains: [] });
    await sleep(500);
    await page.close();
});

test('storage change bursts do not leave always-on scripts unregistered', async () => {
    for (let i = 0; i < 5; i++) {
        await env.ext.sync({ alwaysOnDomains: i % 2 ? ['localhost'] : ['localhost', 'example.com'] });
    }
    await sleep(1000);
    const scripts = await env.ext.registered();
    const auto = scripts.find(s => s.id === 'focus-spoofer-auto');
    assert.ok(auto, 'always-on script missing after burst of changes');
    assert.ok(auto.matches.some(m => m.includes('localhost')));
    await env.ext.sync({ alwaysOnDomains: [] });
    await sleep(500);
});

test('navigating an active tab to another origin keeps it protected (badge matches reality)', async () => {
    const page = await openFixture(srv.originA);
    await toggle(env, page);
    await page.goto(srv.originB + '/?nav=1');
    await sleep(300);
    const tabId = await env.ext.tabIdOf(page.url());
    const badge = await env.ext.badge(tabId);
    const spoofed = await swallowsVisibility(page);
    assert.equal(badge === 'ON', spoofed, `badge=${badge} but spoofed=${spoofed}`);
    assert.equal(spoofed, true);
    await page.close();
});

test('popup state survives loss of extension session state (browser restart / extension update)', async () => {
    const page = await openFixture();
    await toggle(env, page);
    // storage.session is wiped when the extension updates or the browser restarts,
    // while the page's own sessionStorage flag (restored with the tab) survives.
    await env.ext.evalInSW(() => chrome.storage.session.clear());
    const st = await getState(env, page);
    assert.equal(st.isSpoofing, await swallowsVisibility(page), 'popup says inactive while the page is still spoofed');
    await page.close();
});

test('service worker restart keeps registrations and state', async () => {
    const page = await openFixture();
    await toggle(env, page);
    const cdp = await env.context.newCDPSession(env.driver);
    await cdp.send('ServiceWorker.enable').catch(() => {});
    await cdp.send('ServiceWorker.stopAllWorkers').catch(() => {});
    await sleep(500);
    const st = await getState(env, page);
    assert.equal(st.isSpoofing, true);
    const ids = (await env.ext.registered()).map(s => s.id);
    assert.ok(ids.includes('focus-spoofer-core'));
    await page.reload();
    assert.equal(await swallowsVisibility(page), true);
    await page.close();
});

test('fingerprint randomization can be turned off without losing focus spoofing', async () => {
    const canvasHash = (page) => page.evaluate(() => {
        const c = document.createElement('canvas');
        c.width = 64; c.height = 32;
        const g = c.getContext('2d');
        g.fillStyle = '#3a7'; g.fillRect(0, 0, 64, 32);
        g.fillStyle = '#e21'; g.font = '14px sans-serif'; g.fillText('fp-test', 4, 20);
        return c.toDataURL();
    });
    const page = await openFixture();
    const plain = await canvasHash(page);
    await toggle(env, page);
    assert.notEqual(await canvasHash(page), plain, 'fingerprint defence should perturb canvas by default');

    await env.ext.sync({ fingerprintEnabled: false });
    await until(async () => (await env.ext.registered()).some(s => s.js.includes('nofp.js')));
    await page.reload();
    assert.equal(await canvasHash(page), plain, 'canvas still perturbed after opting out');
    assert.equal(await swallowsVisibility(page), true, 'focus spoofing lost with fingerprint off');

    await env.ext.sync({ fingerprintEnabled: true });
    await until(async () => !(await env.ext.registered()).some(s => s.js.includes('nofp.js')));
    await page.reload();
    assert.notEqual(await canvasHash(page), plain);
    await page.close();
});

test('extension update/reload: active tab stays protected and the popup/badge agree', async () => {
    const page = await openFixture();
    await toggle(env, page);
    await env.reloadExtension();
    const ids = (await env.ext.registered()).map(s => s.id);
    assert.ok(ids.includes('focus-spoofer-core'), 'session script not re-registered after update');
    const tabId = await env.ext.tabIdOf(page.url());
    // onInstalled hydrates state from the open pages.
    assert.equal(await until(async () => (await env.ext.badge(tabId)) === 'ON'), true, 'badge lost after update');
    assert.equal((await getState(env, page)).isSpoofing, true);
    await page.reload();
    assert.equal(await swallowsVisibility(page), true);
    // And it can still be switched off.
    const res = await toggle(env, page);
    assert.equal(res.isSpoofing, false);
    assert.equal(await swallowsVisibility(page), false);
    await page.close();
});
