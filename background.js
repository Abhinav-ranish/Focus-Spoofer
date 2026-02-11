// background.js

const SCRIPT_ID = 'focus-spoofer-core';

// 1. Register the content script globally on install
// It will run on ALL pages at document_start, but will only ACTIVATE
// if the sessionStorage flag is found.
chrome.runtime.onInstalled.addListener(async () => {
  // Clear any existing scripts to be safe
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  } catch (e) { /* ignore */ }

  await chrome.scripting.registerContentScripts([{
    id: SCRIPT_ID,
    js: ['inject.js'],
    matches: ['<all_urls>'],
    runAt: 'document_start',
    world: 'MAIN' // Inject directly into main world to override window props
  }]);

  console.log('Focus Spoofer: Content script registered globally.');
});

// spoofingState tracks which tabs we *believe* are on, for Badge purposes
// State structure: { [tabId]: boolean }
let spoofingState = {};

// Restore state (badge only)
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
    // We trust our internal state for the UI switch
    sendResponse({ isSpoofing: !!spoofingState[request.tabId] });

  } else if (request.action === 'toggle_state') {
    const tabId = request.tabId;
    const newState = !spoofingState[tabId];
    spoofingState[tabId] = newState;
    saveState();
    updateBadge(tabId, newState);

    // Apply Logic: Set Flag + Reload
    if (newState) {
      // TURN ON
      await chrome.scripting.executeScript({
        target: { tabId },
        func: () => window.sessionStorage.setItem('FOCUS_SPOOFers_ACTIVE', 'true')
      });
    } else {
      // TURN OFF
      await chrome.scripting.executeScript({
        target: { tabId },
        func: () => window.sessionStorage.removeItem('FOCUS_SPOOFers_ACTIVE')
      });
    }

    // Reload to apply changes (Essential for run_at: document_start)
    chrome.tabs.reload(tabId);

    sendResponse({ isSpoofing: newState });
  }
});

// Re-badge on reload if state matches
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (spoofingState[tabId] && changeInfo.status === 'loading') {
    updateBadge(tabId, true);
  }
});
