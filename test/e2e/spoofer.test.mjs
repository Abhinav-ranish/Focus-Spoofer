// Real-browser regression suite. Run with `npm run test:e2e`.
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

test('inactive page is left untouched', async () => {
    const page = await openFixture();
    const r = await page.evaluate(() => ({
        aelNative: EventTarget.prototype.addEventListener.toString().includes('[native code]'),
    }));
    assert.equal(r.aelNative, true);
    assert.equal(await swallowsVisibility(page), false);
    // Function.prototype.toString must not be replaced on pages where the user
    // never enabled protection (it used to be patched on every page). A JS
    // wrapper shows up as an extra stack frame from the extension's script.
    const replaced = await page.evaluate(() => {
        try { Function.prototype.toString.call({}); return 'no-throw'; } catch (e) { return /spoofer\.js|chrome-extension:/.test(e.stack); }
    });
    assert.equal(replaced, false, 'Function.prototype.toString was patched on an inactive page');
    await page.close();
});

test('activation spoofs visibility/focus and blocks detection listeners', async () => {
    const page = await openFixture();
    const res = await toggle(env, page);
    assert.equal(res.isSpoofing, true);
    const r = await page.evaluate(() => {
        log.length = 0;
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new FocusEvent('blur'));
        document.dispatchEvent(new MouseEvent('mouseleave'));
        const protoHidden = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden').get.call(document);
        return {
            hidden: document.hidden, state: document.visibilityState, protoHidden,
            hasFocus: document.hasFocus(), log: log.slice(),
            maskedToString: Function.prototype.toString.call(document.hasFocus),
        };
    });
    assert.equal(r.hidden, false);
    assert.equal(r.state, 'visible');
    assert.equal(r.protoHidden, false);
    assert.equal(r.hasFocus, true);
    assert.deepEqual(r.log, [], 'detection listeners fired: ' + r.log.join(','));
    assert.match(r.maskedToString, /\[native code\]/);
    const tabId = await env.ext.tabIdOf(page.url());
    assert.equal(await env.ext.badge(tabId), 'ON');
    await page.close();
});

test('element focus/blur, React-style focusin/focusout and hover menus keep working while active', async () => {
    const page = await openFixture();
    await toggle(env, page);
    await page.click('#a');
    await page.click('#b');
    await page.click('#c');
    await page.click('#a');
    await page.hover('#menu');
    await page.mouse.move(400, 400);
    const log = await page.evaluate(() => log.slice());
    for (const want of ['el-focus:a', 'el-blur:a', 'el-focus:b', 'el-blur:b', 'el-focus:c', 'root-focusin:c', 'el-blur:c', 'root-focusout:c', 'menu-mouseenter:menu', 'menu-mouseleave:menu']) {
        assert.ok(log.includes(want), `missing ${want}; got ${log.join(',')}`);
    }
    assert.equal(log.some(l => l.startsWith('window-blur')), false);
    await page.close();
});

test('window.onresize keeps working while active', async () => {
    const page = await openFixture();
    await toggle(env, page);
    const r = await page.evaluate(() => {
        let n = 0;
        window.onresize = () => { n++; };
        window.dispatchEvent(new Event('resize'));
        return n;
    });
    assert.equal(r, 1);
    await page.close();
});

test('refresh keeps protection; repeated on/off toggling stays consistent', async () => {
    const page = await openFixture();
    await toggle(env, page);
    await page.reload();
    assert.equal(await swallowsVisibility(page), true, 'lost protection after refresh');
    for (let i = 0; i < 4; i++) {
        const res = await toggle(env, page);
        const expected = i % 2 === 0 ? false : true;
        assert.equal(res.isSpoofing, expected);
        assert.equal(await swallowsVisibility(page), expected, `iteration ${i}`);
        assert.equal((await getState(env, page)).isSpoofing, expected);
    }
    await toggle(env, page); // leave off
    await page.close();
});

test('rapid toggling does not desync popup state from the page', async () => {
    const page = await openFixture();
    const tabId = await env.ext.tabIdOf(page.url());
    // Fire three toggles without waiting; final state should be ON (odd count).
    await Promise.all([1, 2, 3].map(() => env.ext.send({ action: 'toggle_state', tabId })));
    await sleep(1500);
    await page.waitForLoadState('load');
    const st = await getState(env, page);
    assert.equal(st.isSpoofing, await swallowsVisibility(page), 'popup and page disagree');
    await page.close();
});

test('requestAnimationFrame callbacks still run and can be cancelled while active', async () => {
    const page = await openFixture();
    await toggle(env, page);
    const r = await page.evaluate(() => new Promise(resolve => {
        let ran = 0, cancelledRan = false;
        const id = requestAnimationFrame(() => { cancelledRan = true; });
        cancelAnimationFrame(id);
        const tick = (ts) => { ran++; if (ran < 5) requestAnimationFrame(tick); else resolve({ ran, cancelledRan, ts: typeof ts }); };
        requestAnimationFrame(tick);
        setTimeout(() => resolve({ ran, cancelledRan, timeout: true }), 3000);
    }));
    assert.equal(r.ran, 5);
    assert.equal(r.cancelledRan, false);
    assert.equal(r.ts, 'number');
    await page.close();
});
