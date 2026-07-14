// background.js

const SCRIPT_ID_SESSION = 'focus-spoofer-core';
const SCRIPT_ID_ALWAYS = 'focus-spoofer-auto';

// On Install/Startup: Register core session script AND restore Persistent scripts
chrome.runtime.onInstalled.addListener(async () => {
  await setupSessionScript();
  await updateAlwaysOnScripts();
});

chrome.runtime.onStartup.addListener(async () => {
  await setupSessionScript();
  await updateAlwaysOnScripts();
});

// Listener for storage changes to update Always-On scripts dynamically
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && changes.alwaysOnDomains) {
    updateAlwaysOnScripts();
  }
});

async function setupSessionScript() {
  try {
    // This script runs on ALL pages but waits for sessionStorage flag
    // We register it if not exists (or blindly overwrite)
    await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID_SESSION] }).catch(() => { });
    await chrome.scripting.registerContentScripts([{
      id: SCRIPT_ID_SESSION,
      js: ['spoofer.js', 'inject.js'], // spoofer.js defines the core; inject.js gates it
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

async function updateAlwaysOnScripts() {
  chrome.storage.sync.get(['alwaysOnDomains'], async (result) => {
    const domains = result.alwaysOnDomains || [];

    // Unregister existing auto-script
    try {
      await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID_ALWAYS] }).catch(() => { });
    } catch (e) { }

    if (domains.length === 0) return;

    // Construct match patterns
    // We match http and https for the domain and all subdomains
    const matchPatterns = [];
    domains.forEach(d => {
      matchPatterns.push(`*://${d}/*`);
      matchPatterns.push(`*://*.${d}/*`);
    });

    try {
      await chrome.scripting.registerContentScripts([{
        id: SCRIPT_ID_ALWAYS,
        js: ['spoofer.js', 'inject_always.js'], // spoofer.js defines the core; inject_always.js runs it
        matches: matchPatterns,
        allFrames: true, // detection often lives in a cross-origin player iframe
        matchOriginAsFallback: true,
        runAt: 'document_start',
        world: 'MAIN'
      }]);
      console.log('Always-On scripts updated for:', domains);
    } catch (e) {
      console.error('Failed to register Always-On scripts:', e);
    }
  });
}

// --- BADGE & STATE MANAGEMENT ---
// Per-tab spoofing state lives in chrome.storage.session (the single source of
// truth). Every read/write goes through storage so the service worker staying
// alive is never assumed.

function updateBadge(tabId, isSpoofing) {
  if (isSpoofing) {
    chrome.action.setBadgeText({ text: 'ON', tabId: tabId });
    chrome.action.setBadgeBackgroundColor({ color: '#22c55e', tabId: tabId });
  } else {
    chrome.action.setBadgeText({ text: '', tabId: tabId });
  }
}

// Drop a tab's state when it closes so session storage doesn't grow unbounded.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const storageData = await chrome.storage.session.get(['spoofingState']);
  const state = storageData.spoofingState || {};
  if (tabId in state) {
    delete state[tabId];
    await chrome.storage.session.set({ spoofingState: state });
  }
});

// Handle Messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'get_state') {
    (async () => {
      const tabId = request.tabId;
      const url = request.url;

      const storageData = await chrome.storage.session.get(['spoofingState']);
      const state = storageData.spoofingState || {};

      let isAlwaysOn = false;
      if (url) {
        isAlwaysOn = await checkAlwaysOn(url);
      }

      sendResponse({
        isSpoofing: !!state[tabId] || isAlwaysOn,
        isAlwaysOn: isAlwaysOn
      });
    })();
    return true; // Keep channel open for async response

  } else if (request.action === 'toggle_state') {
    (async () => {
      const tabId = request.tabId;

      const storageData = await chrome.storage.session.get(['spoofingState']);
      const state = storageData.spoofingState || {};

      const newState = !state[tabId];
      state[tabId] = newState;

      await chrome.storage.session.set({ spoofingState: state });

      updateBadge(tabId, newState);

      // Seed the flag into EVERY frame (top + cross-origin iframes), since each
      // origin has its own sessionStorage and the player iframe needs it too.
      if (newState) {
        await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          func: () => { try { window.sessionStorage.setItem('FOCUS_SPOOFers_ACTIVE', 'true'); } catch (e) { } }
        }).catch(() => { });
      } else {
        await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          func: () => { try { window.sessionStorage.removeItem('FOCUS_SPOOFers_ACTIVE'); } catch (e) { } }
        }).catch(() => { });
      }

      chrome.tabs.reload(tabId);
      sendResponse({ isSpoofing: newState });
    })();
    return true; // Keep channel open for async response
  }
});

async function checkAlwaysOn(url) {
  if (!url) return false;
  return new Promise(resolve => {
    chrome.storage.sync.get(['alwaysOnDomains'], (result) => {
      const domains = result.alwaysOnDomains || [];
      try {
        const hostname = new URL(url).hostname;
        // Check exact or subdomain match
        const match = domains.some(d => hostname === d || hostname.endsWith('.' + d));
        resolve(match);
      } catch (e) {
        resolve(false);
      }
    });
  });
}

// Re-badge on reload if state matches OR if always-on
chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId === 0) {
    // Always read fresh from storage, not stale local variable
    const storageData = await chrome.storage.session.get(['spoofingState']);
    const state = storageData.spoofingState || {};

    if (state[details.tabId]) {
      updateBadge(details.tabId, true);
    } else {
      const isAlways = await checkAlwaysOn(details.url);
      updateBadge(details.tabId, isAlways);
    }
  }
});
