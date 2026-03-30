document.addEventListener('DOMContentLoaded', async () => {
    const toggleSwitch = document.getElementById('toggleSwitch');
    const statusText = document.getElementById('statusText');
    const alwaysOnCheckbox = document.getElementById('alwaysOnCheckbox');
    const openSettings = document.getElementById('openSettings');
    const iconContainer = document.getElementById('iconContainer');
    const mainIcon = document.getElementById('mainIcon');

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

            if (isAlwaysOn) {
                toggleSwitch.disabled = true;
                statusText.textContent = "Always ON";
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
                toggleSwitch.checked = true;
                toggleSwitch.disabled = true;
                updateUI(true);
            } else {
                domains = domains.filter(d => d !== domain);
                toggleSwitch.disabled = false;
            }

            chrome.storage.sync.set({ alwaysOnDomains: domains }, () => {
                chrome.tabs.reload(tab.id);
            });
        });
    });

    // Settings Link
    openSettings.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.runtime.openOptionsPage();
    });

    function updateUI(isActive) {
        if (isActive) {
            statusText.textContent = "Protected";
            statusText.classList.add('active');
            iconContainer.classList.add('active');
            mainIcon.src = 'icons/icon-inner-active128.png';
        } else {
            statusText.textContent = "Inactive";
            statusText.classList.remove('active');
            iconContainer.classList.remove('active');
            mainIcon.src = 'icons/icon-inner128.png';
        }
    }
});
