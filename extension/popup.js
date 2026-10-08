document.addEventListener('DOMContentLoaded', async () => {
    const toggleSwitch = document.getElementById('toggleSwitch');
    const statusText = document.getElementById('statusText');
    const alwaysOnCheckbox = document.getElementById('alwaysOnCheckbox');
    const openSettings = document.getElementById('openSettings');
    const iconContainer = document.getElementById('iconContainer');
    const mainIcon = document.getElementById('mainIcon');
    const versionEl = document.getElementById('version');
    const descriptionEl = document.querySelector('.description');

    // Version is read from the manifest so it can never drift out of sync.
    try {
        versionEl.textContent = 'v' + chrome.runtime.getManifest().version;
    } catch (e) { }

    // Settings link works regardless of the current tab.
    openSettings.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.runtime.openOptionsPage();
    });

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    // The extension can only inject into http(s) pages. On chrome://, the Web
    // Store, extension pages, etc. we can't do anything — show that clearly
    // instead of letting the controls throw or silently fail.
    const isInjectable = /^https?:\/\//i.test(tab.url || '');
    if (!isInjectable) {
        toggleSwitch.disabled = true;
        alwaysOnCheckbox.disabled = true;
        statusText.textContent = 'Unavailable';
        if (descriptionEl) descriptionEl.textContent =
            'Focus Spoofer can only run on regular web pages (http/https).';
        return;
    }

    let currentDomain = '';
    try { currentDomain = new URL(tab.url).hostname; } catch (e) { }
    const siteNameEl = document.getElementById('siteName');
    if (siteNameEl) siteNameEl.textContent = currentDomain.replace(/^www\./, '');

    function updateUI(isActive) {
        if (isActive) {
            statusText.textContent = 'Protected';
            statusText.classList.add('active');
            iconContainer.classList.add('active');
            mainIcon.src = 'icons/icon-inner-active128.png';
        } else {
            statusText.textContent = 'Inactive';
            statusText.classList.remove('active');
            iconContainer.classList.remove('active');
            mainIcon.src = 'icons/icon-inner128.png';
        }
    }

    // Ask the background for this tab's state and paint the real UI in one shot.
    chrome.runtime.sendMessage({ action: 'get_state', tabId: tab.id, url: tab.url }, (response) => {
        if (chrome.runtime.lastError || !response) return;

        toggleSwitch.checked = response.isSpoofing;
        alwaysOnCheckbox.checked = response.isAlwaysOn;
        updateUI(response.isSpoofing);

        if (response.isAlwaysOn) {
            toggleSwitch.disabled = true;
            statusText.textContent = 'Always on';
        }
    });

    // Main per-tab toggle.
    toggleSwitch.addEventListener('change', () => {
        const isChecked = toggleSwitch.checked;
        updateUI(isChecked);
        chrome.runtime.sendMessage({ action: 'toggle_state', tabId: tab.id }, (response) => {
            // Keep the switch honest if the background disagrees or failed.
            if (chrome.runtime.lastError || !response) return;
            if (response.isSpoofing !== toggleSwitch.checked) {
                toggleSwitch.checked = response.isSpoofing;
                updateUI(response.isSpoofing);
            }
        });
    });

    // Always-On for this site.
    alwaysOnCheckbox.addEventListener('change', () => {
        const isChecked = alwaysOnCheckbox.checked;
        if (!currentDomain) return;

        chrome.storage.sync.get(['alwaysOnDomains'], (result) => {
            let domains = result.alwaysOnDomains || [];

            if (isChecked) {
                if (!domains.includes(currentDomain)) domains.push(currentDomain);
                toggleSwitch.checked = true;
                toggleSwitch.disabled = true;
                updateUI(true);
                statusText.textContent = 'Always on';
            } else {
                domains = domains.filter(d => d !== currentDomain);
                toggleSwitch.disabled = false;
            }

            chrome.storage.sync.set({ alwaysOnDomains: domains }, () => {
                chrome.tabs.reload(tab.id);
                // Turning Always-On off falls back to this tab's own toggle
                // state; repaint from it instead of leaving "Protected" up.
                if (!isChecked) {
                    chrome.runtime.sendMessage({ action: 'get_state', tabId: tab.id, url: tab.url }, (response) => {
                        if (chrome.runtime.lastError || !response) return;
                        toggleSwitch.checked = response.isSpoofing;
                        updateUI(response.isSpoofing);
                    });
                }
            });
        });
    });
});
