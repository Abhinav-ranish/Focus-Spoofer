document.addEventListener('DOMContentLoaded', async () => {
    const toggleSwitch = document.getElementById('toggleSwitch');
    const statusText = document.getElementById('statusText');
    const alwaysOnCheckbox = document.getElementById('alwaysOnCheckbox');
    const openSettings = document.getElementById('openSettings');

    // get current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab) return;

    // Ask background for state of this tab
    chrome.runtime.sendMessage({ action: 'get_state', tabId: tab.id, url: tab.url }, (response) => {
        if (response) {
            const isActive = response.isSpoofing;
            const isAlwaysOn = response.isAlwaysOn;

            toggleSwitch.checked = isActive;
            alwaysOnCheckbox.checked = isAlwaysOn;
            updateUI(isActive);

            // If always on, disable the main toggle visually or just keep it checked?
            // Better UX: Keep it checked, maybe disable interaction if you want to force it.
            // But user might want to turn it off temporarily?
            // Actually, if 'Always On' is true, the script is registered globally for that domain.
            // Toggling the switch won't remove the script until the domain is removed from settings.
            // So if 'Always On' is checked, we should probably force the Toggle to ON and disable it.
            if (isAlwaysOn) {
                toggleSwitch.disabled = true;
                statusText.textContent = "Always ON (Settings)";
            }
        }
    });

    // Handle main toggle (Session)
    toggleSwitch.addEventListener('change', () => {
        const isChecked = toggleSwitch.checked;
        updateUI(isChecked);

        // Notify background
        chrome.runtime.sendMessage({
            action: 'toggle_state',
            tabId: tab.id
        }, (response) => {
            // confirmed
        });
    });

    // Handle Always On Checkbox
    alwaysOnCheckbox.addEventListener('change', async () => {
        const isChecked = alwaysOnCheckbox.checked;
        const url = new URL(tab.url);
        const domain = url.hostname;

        // Get current list
        chrome.storage.sync.get(['alwaysOnDomains'], (result) => {
            let domains = result.alwaysOnDomains || [];

            if (isChecked) {
                if (!domains.includes(domain)) {
                    domains.push(domain);
                }
                // Force the UI to ON and Disabled
                toggleSwitch.checked = true;
                toggleSwitch.disabled = true;
                updateUI(true);
            } else {
                domains = domains.filter(d => d !== domain);
                // Re-enable the toggle (it stays checked until user unchecks it or reloads)
                toggleSwitch.disabled = false;
                // The background script will update registers, but we might need a reload to clear the current script
                // For now, let's leave it 'ON' in session until user turns it off or reloads.
            }

            chrome.storage.sync.set({ alwaysOnDomains: domains }, () => {
                // Reload is often simpler to apply "Always On" script changes immediately
                chrome.tabs.reload(tab.id);
            });
        });
    });

    // Settings Link
    openSettings.addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
    });

    function updateUI(isActive) {
        if (isActive) {
            statusText.textContent = "Spoofing ENABLED";
            statusText.classList.add('active');
        } else {
            statusText.textContent = "Inactive";
            statusText.classList.remove('active');
        }
    }
});
