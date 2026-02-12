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
      js: ['inject.js'],
      matches: ['<all_urls>'],
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
        js: ['inject_always.js'], // The raw unchecked spoofer
        matches: matchPatterns,
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

let spoofingState = {}; // Session-based state

chrome.storage.session.get(['spoofingState'], (result) => {
  if (result.spoofingState) {
    spoofingState = result.spoofingState;
  }
});

function updateBadge(tabId, isSpoofing) {
  if (isSpoofing) {
    chrome.action.setBadgeText({ text: 'ON', tabId: tabId });
    chrome.action.setBadgeBackgroundColor({ color: '#4CAF50', tabId: tabId });
  } else {
    chrome.action.setBadgeText({ text: '', tabId: tabId });
  }
}

function saveState() {
  chrome.storage.session.set({ spoofingState });
}

// Handle Messages
chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {

  if (request.action === 'get_state') {
    // Check if this tab is in the "Always On" list to report correctly
    const tabId = request.tabId;
    const url = request.url; // Popup should send URL

    let isAlwaysOn = false;
    if (url) {
      isAlwaysOn = await checkAlwaysOn(url);
    }

    sendResponse({
      isSpoofing: !!spoofingState[tabId] || isAlwaysOn,
      isAlwaysOn: isAlwaysOn
    });

  } else if (request.action === 'toggle_state') {
    const tabId = request.tabId;
    // We only toggle SESSION state here. Always-On is handled via storage/options.
    const newState = !spoofingState[tabId];
    spoofingState[tabId] = newState;
    saveState();
    updateBadge(tabId, newState);

    if (newState) {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: () => window.sessionStorage.setItem('FOCUS_SPOOFers_ACTIVE', 'true')
      });
    } else {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: () => window.sessionStorage.removeItem('FOCUS_SPOOFers_ACTIVE')
      });
    }

    chrome.tabs.reload(tabId);
    sendResponse({ isSpoofing: newState });
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
// Note: WebNavigation might be better to detect Always-On reloads
chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId === 0) {
    // Check session state
    if (spoofingState[details.tabId]) {
      updateBadge(details.tabId, true);
    } else {
      // Check Always-On state
      const isAlways = await checkAlwaysOn(details.url);
      if (isAlways) {
        updateBadge(details.tabId, true);
      } else {
        updateBadge(details.tabId, false);
      }
    }
  }
});
