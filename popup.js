document.addEventListener('DOMContentLoaded', async () => {
    const toggleSwitch = document.getElementById('toggleSwitch');
    const statusText = document.getElementById('statusText');

    // get current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab) return;

    // Ask background for state of this tab
    chrome.runtime.sendMessage({ action: 'get_state', tabId: tab.id }, (response) => {
        if (response && response.isSpoofing) {
            toggleSwitch.checked = true;
            updateUI(true);
        } else {
            toggleSwitch.checked = false;
            updateUI(false);
        }
    });

    // Handle toggle change
    toggleSwitch.addEventListener('change', () => {
        const isChecked = toggleSwitch.checked;
        updateUI(isChecked);

        // Notify background
        chrome.runtime.sendMessage({
            action: 'toggle_state',
            tabId: tab.id
        }, (response) => {
            // confirm state if needed, but UI optimistically updates
        });
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
