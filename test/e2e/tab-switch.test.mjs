// Real tab-switch scenarios (page genuinely hidden, window genuinely blurred).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchRaw, startServers, sleep } from './harness.mjs';

let b, srv, seq = 0;
before(async () => { srv = await startServers(); b = await launchRaw(); });
after(async () => { await b?.close(); srv?.close(); });

const LOG = 'JSON.stringify({ log, hidden: document.hidden, state: document.visibilityState, focus: document.hasFocus() })';

async function protectedTab() {
    const tab = await b.newTab(`${srv.originA}/?raw=${++seq}`);
    await b.toggle(tab);
    return tab;
}

async function awayAndBack(tab, ms = 600) {
    const other = await b.newTab('about:blank');
    await b.activate(other);
    await sleep(ms);
    const whileAway = JSON.parse(await tab.eval(LOG));
    await b.activate(tab);
    return { whileAway, other };
}

test('control: an unprotected page does see the tab switch (harness sanity)', async () => {
    const tab = await b.newTab(`${srv.originA}/?raw=${++seq}`);
    await b.activate(tab);
    await tab.eval('log.length = 0');
    const { whileAway } = await awayAndBack(tab);
    assert.equal(whileAway.hidden, true);
    assert.ok(whileAway.log.some(l => l.startsWith('visibilitychange')), whileAway.log.join(','));
});

test('protected page never sees the tab switch', async () => {
    const tab = await protectedTab();
    await b.activate(tab);
    await tab.eval('log.length = 0');
    const { whileAway } = await awayAndBack(tab);
    assert.equal(whileAway.hidden, false);
    assert.equal(whileAway.state, 'visible');
    assert.equal(whileAway.focus, true);
    const after = JSON.parse(await tab.eval(LOG));
    assert.deepEqual(after.log, [], 'leaked: ' + after.log.join(','));
});

test('focused input does not get blur/focusout on tab switch, but still does on a normal click away', async () => {
    const tab = await protectedTab();
    await b.activate(tab);
    await tab.eval('document.getElementById("c").focus(); log.length = 0');
    await awayAndBack(tab);
    await sleep(200);
    const afterSwitch = JSON.parse(await tab.eval(LOG)).log;
    assert.deepEqual(afterSwitch.filter(l => /blur|focusout|focus/.test(l)), [], 'leaked: ' + afterSwitch.join(','));
    await tab.eval('document.getElementById("a").focus()');
    const afterClick = JSON.parse(await tab.eval(LOG)).log;
    assert.ok(afterClick.includes('el-blur:c'), afterClick.join(','));
    assert.ok(afterClick.includes('root-focusout:c'), afterClick.join(','));
    assert.ok(afterClick.includes('el-focus:a'), afterClick.join(','));
});

test('requestAnimationFrame keeps ticking while the tab is hidden', async () => {
    const tab = await protectedTab();
    await b.activate(tab);
    await tab.eval('window.ticks = 0; (function f() { ticks++; requestAnimationFrame(f); })(); 1');
    const other = await b.newTab('about:blank');
    await b.activate(other);
    await tab.eval('window.ticks = 0');
    await sleep(1500);
    const ticks = await tab.eval('ticks');
    await b.activate(tab);
    assert.ok(ticks >= 10, `only ${ticks} rAF ticks in 1.5s while hidden`);
});

test('control: without protection rAF stalls while hidden (harness sanity)', async () => {
    const tab = await b.newTab(`${srv.originA}/?raw=${++seq}`);
    await b.activate(tab);
    await tab.eval('window.ticks = 0; (function f() { ticks++; requestAnimationFrame(f); })(); 1');
    const other = await b.newTab('about:blank');
    await b.activate(other);
    await tab.eval('window.ticks = 0');
    await sleep(1500);
    const ticks = await tab.eval('ticks');
    await b.activate(tab);
    assert.ok(ticks < 5, `${ticks} ticks — page was not really hidden`);
});
