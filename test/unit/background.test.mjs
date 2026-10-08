// Loads extension/background.js in a VM with a mocked chrome.* surface, the
// way a fresh service worker start would.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeStorage, fakeFetch } from './fakes.mjs';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../extension');
const event = () => { const ls = []; return { ls, addListener: (f) => ls.push(f), fire: (...a) => Promise.all(ls.map(f => f(...a))) }; };

function boot({ origin = 'https://fb.example', sync = {}, local = {} } = {}) {
    const calls = { uninstall: [], registered: [], badge: {}, reloads: [] };
    const storageChanged = event();
    const syncArea = fakeStorage(sync);
    const origSet = syncArea.set.bind(syncArea);
    syncArea.set = async (obj) => {
        const changes = {};
        for (const k of Object.keys(obj)) changes[k] = { oldValue: syncArea.data[k], newValue: obj[k] };
        await origSet(obj);
        await storageChanged.fire(changes, 'sync');
    };
    let scripts = [];
    const chrome = {
        runtime: {
            onInstalled: event(), onStartup: event(), onMessage: event(),
            getManifest: () => ({ version: '1.8' }),
            setUninstallURL: async (u) => { calls.uninstall.push(u); },
        },
        storage: { onChanged: storageChanged, sync: syncArea, local: fakeStorage(local), session: fakeStorage() },
        scripting: {
            registerContentScripts: async (list) => {
                for (const s of list) {
                    if (scripts.some(x => x.id === s.id)) throw new Error(`Duplicate script ID '${s.id}'`);
                    if (s.matches.some(m => m.includes('['))) throw new Error('Invalid match pattern');
                }
                scripts.push(...list); calls.registered.push(...list.map(s => s.id));
            },
            unregisterContentScripts: async ({ ids }) => { scripts = scripts.filter(s => !ids.includes(s.id)); },
            getRegisteredContentScripts: async () => scripts,
            executeScript: async () => [{ result: false }],
        },
        tabs: { onRemoved: event(), query: async () => [], reload: async (id) => { calls.reloads.push(id); } },
        action: {
            setBadgeText: async ({ text, tabId }) => { calls.badge[tabId] = text; },
            setBadgeBackgroundColor: async () => { },
        },
        webNavigation: { onCommitted: event() },
    };
    const fetch = fakeFetch();
    const ctx = {
        chrome, fetch, console: { log() { }, warn() { }, error() { } }, URL, Date, Promise, Set, Array, Object, JSON,
        encodeURIComponent, structuredClone, setTimeout,
    };
    ctx.self = ctx;
    ctx.importScripts = (...files) => {
        for (const f of files) {
            let src = fs.readFileSync(path.join(EXT, f), 'utf8');
            if (f === 'config.js') src = src.replace(/BACKEND_ORIGIN:\s*'[^']*'/, `BACKEND_ORIGIN: '${origin}'`);
            vm.runInContext(src, ctx, { filename: f });
        }
    };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(EXT, 'background.js'), 'utf8'), ctx, { filename: 'background.js' });
    const send = (msg) => new Promise((resolve) => {
        const keep = chrome.runtime.onMessage.ls[0](msg, {}, resolve);
        if (keep !== true) resolve(undefined);
    });
    return { chrome, calls, fetch, send, scripts: () => scripts, local: chrome.storage.local, sync: syncArea };
}

const settle = () => new Promise(r => setTimeout(r, 20));
// Values created inside the VM have a different realm's prototypes.
const plain = (x) => JSON.parse(JSON.stringify(x));

test('uninstall survey URL is set on every service worker start, with only the version', () => {
    const a = boot();
    const b = boot(); // a second wake-up of the worker
    assert.deepEqual(a.calls.uninstall, ['https://fb.example/uninstall?v=1.8']);
    assert.deepEqual(b.calls.uninstall, ['https://fb.example/uninstall?v=1.8']);
});

test('no backend configured: uninstall URL is cleared, nothing is sent', async () => {
    const env = boot({ origin: '', local: { analyticsEnabled: true } });
    assert.deepEqual(env.calls.uninstall, ['']);
    await env.chrome.runtime.onStartup.fire();
    await env.send({ action: 'toggle_state', tabId: 1 });
    await settle();
    assert.equal(env.fetch.calls.length, 0);
});

test('startup registers the session script; one malformed always-on entry does not drop the others', async () => {
    const env = boot({ sync: { alwaysOnDomains: ['[::1]', 'example.com', 'bad domain'] } });
    await env.chrome.runtime.onStartup.fire();
    const s = env.scripts();
    assert.ok(s.find(x => x.id === 'focus-spoofer-core'));
    const auto = s.find(x => x.id === 'focus-spoofer-auto');
    assert.ok(auto, 'always-on script missing');
    assert.deepEqual(plain(auto.matches), ['*://example.com/*', '*://*.example.com/*']);
    assert.equal(s.some(x => x.id === 'focus-spoofer-probe'), false, 'probe script leaked');
});

test('concurrent registrations never hit duplicate-ID errors', async () => {
    const env = boot({ sync: { alwaysOnDomains: ['a.com'] } });
    await Promise.all([
        env.chrome.runtime.onInstalled.fire({ reason: 'install' }),
        env.sync.set({ alwaysOnDomains: ['a.com', 'b.com'] }),
        env.sync.set({ alwaysOnDomains: ['b.com'] }),
    ]);
    await settle();
    const auto = env.scripts().filter(x => x.id === 'focus-spoofer-auto');
    assert.equal(auto.length, 1);
    assert.deepEqual(plain(auto[0].matches), ['*://b.com/*', '*://*.b.com/*']);
});

test('fingerprint opt-out inserts nofp.js before the gate in both registrations', async () => {
    const env = boot({ sync: { alwaysOnDomains: ['a.com'], fingerprintEnabled: false } });
    await env.chrome.runtime.onStartup.fire();
    const byId = Object.fromEntries(env.scripts().map(s => [s.id, s.js]));
    assert.deepEqual(plain(byId['focus-spoofer-core']), ['spoofer.js', 'nofp.js', 'inject.js']);
    assert.deepEqual(plain(byId['focus-spoofer-auto']), ['spoofer.js', 'nofp.js', 'inject_always.js']);
});

test('opted out (default): toggling and settings changes record nothing', async () => {
    const env = boot();
    await env.send({ action: 'toggle_state', tabId: 7 });
    await env.send({ action: 'toggle_state', tabId: 7 });
    await env.sync.set({ alwaysOnDomains: ['x.com'] });
    await settle();
    assert.equal(env.local.data.telemetry, undefined);
    assert.equal(env.fetch.calls.length, 0);
});

test('opted in: activations, deactivations and site setting changes are counted (no domains)', async () => {
    const env = boot({ local: { analyticsEnabled: true } });
    assert.deepEqual(plain(await env.send({ action: 'toggle_state', tabId: 7 })), { isSpoofing: true });
    assert.deepEqual(plain(await env.send({ action: 'toggle_state', tabId: 7 })), { isSpoofing: false });
    await env.sync.set({ alwaysOnDomains: ['x.com', 'y.com'] });
    await env.sync.set({ alwaysOnDomains: ['y.com'] });
    await settle();
    const days = env.local.data.telemetry.days;
    const today = Object.values(days)[0];
    assert.deepEqual(plain(today.counts), { activations: 1, deactivations: 1, alwaysOnAdded: 2, alwaysOnRemoved: 1 });
    assert.equal(today.firstActivation, true);
    assert.ok(!JSON.stringify(env.local.data).includes('x.com'), 'domain leaked into telemetry storage');
    assert.equal(env.calls.badge[7], '');
    assert.deepEqual(env.calls.reloads, [7, 7]);
});

test('update install marks the user as already activated', async () => {
    const env = boot({ local: { analyticsEnabled: true } });
    await env.chrome.runtime.onInstalled.fire({ reason: 'update' });
    await env.send({ action: 'toggle_state', tabId: 3 });
    await settle();
    assert.equal(Object.values(env.local.data.telemetry.days)[0].firstActivation, false);
});
