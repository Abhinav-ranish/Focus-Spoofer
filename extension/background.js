// background.js

const SCRIPT_ID_SESSION = 'focus-spoofer-core';
const SCRIPT_ID_ALWAYS = 'focus-spoofer-auto';
const SCRIPT_ID_PROBE = 'focus-spoofer-probe';
const SESSION_FLAG = 'FOCUS_SPOOFers_ACTIVE';

// On Install/Startup: Register core session script AND restore Persistent scripts
chrome.runtime.onInstalled.addListener(async () => {
  await registerAll();
  await hydrateTabState();
});

chrome.runtime.onStartup.addListener(async () => {
  await registerAll();
  await hydrateTabState();
});

// Listener for storage changes to update content scripts dynamically
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && changes.fingerprintEnabled) {
    registerAll();
  } else if (areaName === 'sync' && changes.alwaysOnDomains) {
    updateAlwaysOnScripts();
  }
});

// --- CONTENT SCRIPT REGISTRATION ---
// Registrations are serialized: overlapping unregister/register pairs (install
// + a storage change, or several quick storage changes) used to race into
// "Duplicate script ID" errors that left Always-On silently unregistered.
let registrationQueue = Promise.resolve();
function serialized(fn) {
  const run = registrationQueue.then(fn, fn);
  registrationQueue = run.catch(() => { });
  return run;
}

// Content script files, in load order. spoofer.js defines the core; nofp.js
// (only when the user turned fingerprint randomization off) flags it; the
// gate script decides whether to run it.
async function scriptFiles(gate) {
  const { fingerprintEnabled } = await chrome.storage.sync.get(['fingerprintEnabled']);
  return fingerprintEnabled === false ? ['spoofer.js', 'nofp.js', gate] : ['spoofer.js', gate];
}

function registerAll() {
  return serialized(async () => {
    await setupSessionScript();
    await registerAlwaysOn();
  });
}

function updateAlwaysOnScripts() {
  return serialized(registerAlwaysOn);
}

async function setupSessionScript() {
  try {
    // This script runs on ALL pages but waits for sessionStorage flag
    await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID_SESSION] }).catch(() => { });
    await chrome.scripting.registerContentScripts([{
      id: SCRIPT_ID_SESSION,
      js: await scriptFiles('inject.js'), // inject.js gates on the session flag
      matches: ['<all_urls>'],
      allFrames: true, // detection often lives in a cross-origin player iframe
      matchOriginAsFallback: true, // also cover about:blank / srcdoc / sandboxed frames
      runAt: 'document_start',
      world: 'MAIN'
    }]);
  } catch (e) {
    console.error('Session script setup error:', e);
  }
}

// Match patterns for one Always-On entry: the domain and all subdomains.
function patternsFor(domain) {
  const d = String(domain || '').trim().toLowerCase();
  if (!d || /[\s/*:?#@]/.test(d.replace(/^\[.*\]$/, 'ip6'))) return [];
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(d) || d.startsWith('[');
  return isIp ? [`*://${d}/*`] : [`*://${d}/*`, `*://*.${d}/*`];
}

function alwaysOnScript(matches, js, id = SCRIPT_ID_ALWAYS) {
  return {
    id,
    js, // inject_always.js runs the core unconditionally
    matches,
    allFrames: true, // detection often lives in a cross-origin player iframe
    matchOriginAsFallback: true,
    runAt: 'document_start',
    world: 'MAIN'
  };
}

async function registerAlwaysOn() {
  const { alwaysOnDomains } = await chrome.storage.sync.get(['alwaysOnDomains']);
  const domains = Array.isArray(alwaysOnDomains) ? alwaysOnDomains : [];

  await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID_ALWAYS] }).catch(() => { });
  if (domains.length === 0) return;

  const js = await scriptFiles('inject_always.js');
  const matches = domains.flatMap(patternsFor);
  try {
    if (matches.length) await chrome.scripting.registerContentScripts([alwaysOnScript(matches, js)]);
    return;
  } catch (e) {
    console.warn('Always-On registration failed, isolating bad entries:', e);
  }

  // One invalid pattern rejects the whole registration, which used to disable
  // every Always-On domain. Probe each entry and keep the valid ones.
  const good = [];
  for (const d of domains) {
    const m = patternsFor(d);
    if (!m.length) continue;
    try {
      await chrome.scripting.registerContentScripts([alwaysOnScript(m, js, SCRIPT_ID_PROBE)]);
      good.push(...m);
    } catch (e) {
      console.warn('Skipping invalid Always-On entry:', d);
    }
    await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID_PROBE] }).catch(() => { });
  }
  if (!good.length) return;
  try {
    await chrome.scripting.registerContentScripts([alwaysOnScript(good, js)]);
  } catch (e) {
    console.error('Failed to register Always-On scripts:', e);
  }
}

// --- BADGE & STATE MANAGEMENT ---
// Per-tab spoofing state lives in chrome.storage.session. Every read/write
// goes through storage so the service worker staying alive is never assumed,
// and mutations are serialized so concurrent messages can't lose updates.

let stateQueue = Promise.resolve();
function mutateState(fn) {
  const run = stateQueue.then(async () => {
    const { spoofingState } = await chrome.storage.session.get(['spoofingState']);
    const state = spoofingState || {};
    const result = await fn(state);
    await chrome.storage.session.set({ spoofingState: state });
    return result;
  });
  stateQueue = run.catch(() => { });
  return run;
}

async function readState() {
  const { spoofingState } = await chrome.storage.session.get(['spoofingState']);
  return spoofingState || {};
}

function updateBadge(tabId, isSpoofing) {
  if (isSpoofing) {
    chrome.action.setBadgeText({ text: 'ON', tabId: tabId }).catch(() => { });
    chrome.action.setBadgeBackgroundColor({ color: '#22c55e', tabId: tabId }).catch(() => { });
  } else {
    chrome.action.setBadgeText({ text: '', tabId: tabId }).catch(() => { });
  }
}

// The page's own sessionStorage flag is what actually turns protection on at
// document_start. It survives things chrome.storage.session does not (browser
// restart with session restore, extension update), so read it back when the
// two may have diverged. Returns true/false, or null if the tab can't be read.
async function readPageFlag(tabId) {
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (key) => { try { return !!window.sessionStorage.getItem(key); } catch (e) { return false; } },
      args: [SESSION_FLAG]
    });
    return res ? !!res.result : null;
  } catch (e) {
    return null;
  }
}

// Rebuild per-tab state from the open pages after the extension (re)starts.
async function hydrateTabState() {
  let tabs = [];
  try { tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] }); } catch (e) { return; }
  const found = {};
  await Promise.all(tabs.map(async (tab) => {
    if (tab.discarded) return;
    if (await readPageFlag(tab.id)) found[tab.id] = true;
  }));
  await mutateState((state) => {
    for (const id of Object.keys(found)) state[id] = true;
  });
  for (const tab of tabs) {
    if (found[tab.id]) updateBadge(tab.id, true);
  }
}

function setFlagInAllFrames(tabId, on) {
  return chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: (key, enable) => {
      try {
        if (enable) window.sessionStorage.setItem(key, 'true');
        else window.sessionStorage.removeItem(key);
      } catch (e) { }
    },
    args: [SESSION_FLAG, on]
  });
}

// Drop a tab's state when it closes so session storage doesn't grow unbounded.
chrome.tabs.onRemoved.addListener((tabId) => {
  mutateState((state) => { delete state[tabId]; });
});

// Handle Messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'get_state') {
    (async () => {
      const tabId = request.tabId;
      const isAlwaysOn = request.url ? await checkAlwaysOn(request.url) : false;
      let isSession = !!(await readState())[tabId];

      // Reconcile with the page: after a browser restart or extension
      // update the stored state is gone but the page flag is not.
      const pageFlag = await readPageFlag(tabId);
      if (pageFlag !== null && pageFlag !== isSession) {
        isSession = pageFlag;
        await mutateState((state) => {
          if (pageFlag) state[tabId] = true; else delete state[tabId];
        });
        updateBadge(tabId, isSession || isAlwaysOn);
      }

      sendResponse({
        isSpoofing: isSession || isAlwaysOn,
        isAlwaysOn: isAlwaysOn
      });
    })();
    return true; // Keep channel open for async response

  } else if (request.action === 'toggle_state') {
    (async () => {
      const tabId = request.tabId;
      const newState = await mutateState((state) => {
        const next = !state[tabId];
        if (next) state[tabId] = true; else delete state[tabId];
        return next;
      });

      updateBadge(tabId, newState);

      // Seed the flag into EVERY frame (top + cross-origin iframes), since each
      // origin has its own sessionStorage and the player iframe needs it too.
      await setFlagInAllFrames(tabId, newState).catch(() => { });

      chrome.tabs.reload(tabId).catch(() => { });
      sendResponse({ isSpoofing: newState });
    })();
    return true; // Keep channel open for async response
  }
});

async function checkAlwaysOn(url) {
  if (!url) return false;
  const { alwaysOnDomains } = await chrome.storage.sync.get(['alwaysOnDomains']);
  const domains = alwaysOnDomains || [];
  try {
    const hostname = new URL(url).hostname;
    // Check exact or subdomain match
    return domains.some(d => hostname === d || hostname.endsWith('.' + d));
  } catch (e) {
    return false;
  }
}

// A protected tab that navigates to a different origin lands on a page whose
// sessionStorage has no flag, so the document_start gate stays closed while the
// badge still says ON. Inject into the new document right away and seed the
// flag so later reloads are covered from document_start. (Best effort: this
// can run after the page's first inline scripts.)
async function protectNavigation(details) {
  const files = await scriptFiles('inject_always.js');
  const target = { tabId: details.tabId, frameIds: [details.frameId] };
  await chrome.scripting.executeScript({ target, files, world: 'MAIN', injectImmediately: true });
  await chrome.scripting.executeScript({
    target,
    func: (key) => { try { window.sessionStorage.setItem(key, 'true'); } catch (e) { } },
    args: [SESSION_FLAG],
    injectImmediately: true
  });
}

// Re-badge on reload if state matches OR if always-on
chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (!/^https?:/.test(details.url)) {
    if (details.frameId === 0) updateBadge(details.tabId, !!(await readState())[details.tabId]);
    return;
  }
  const active = !!(await readState())[details.tabId];
  if (active) protectNavigation(details).catch(() => { });
  if (details.frameId === 0) {
    updateBadge(details.tabId, active || await checkAlwaysOn(details.url));
  }
});
