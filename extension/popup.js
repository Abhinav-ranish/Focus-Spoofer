document.addEventListener('DOMContentLoaded', async () => {
    const toggleSwitch = document.getElementById('toggleSwitch');
    const statusText = document.getElementById('statusText');
    const alwaysOnCheckbox = document.getElementById('alwaysOnCheckbox');
    const openSettings = document.getElementById('openSettings');
    const iconContainer = document.getElementById('iconContainer');
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

    // Review: a link that is always there, and a card shown once (see review.js).
    const reviewUrl = (self.FOCUS_SPOOFER_CONFIG || {}).REVIEW_URL;
    const reviewCard = document.getElementById('reviewCard');
    const openReview = (e) => {
        e.preventDefault();
        if (reviewUrl) chrome.tabs.create({ url: reviewUrl });
    };
    document.getElementById('rateLink').addEventListener('click', openReview);
    const fadeReviewCard = () => {
        reviewCard.classList.add('fading');
        setTimeout(() => { reviewCard.hidden = true; }, 300);
    };
    document.getElementById('reviewBtn').addEventListener('click', (e) => {
        openReview(e);
        fadeReviewCard();
    });
    document.getElementById('reviewClose').addEventListener('click', fadeReviewCard);
    function showReviewCard() {
        if (!reviewUrl) return;
        reviewCard.hidden = false;
        // Seeing it once is the one time; it never comes back.
        chrome.runtime.sendMessage({ action: 'review_asked' });
    }

    // Reload preference is global; off, the toggle applies to the live page
    // for sites that break on refresh. The info icon turns into a warning
    // while it's off, and a click on it shows the explanation inline.
    const reloadCheckbox = document.getElementById('reloadCheckbox');
    const reloadRow = document.getElementById('reloadRow');
    const reloadInfo = document.getElementById('reloadInfo');
    const reloadNote = document.getElementById('reloadNote');
    function updateReloadInfo() {
        const on = reloadCheckbox.checked;
        const text = on
            ? t('reloadInfoOn', 'Recommended. Reloading starts protection before the site\'s own scripts run. Turn it off only if a site breaks when it reloads.')
            : t('reloadInfoOff', 'Without a reload, a site may still notice tab switches it was already watching for. Turning protection off applies on the next reload.');
        reloadRow.classList.toggle('reload-off', !on);
        reloadInfo.title = text;
        reloadInfo.setAttribute('aria-label', text);
        reloadNote.textContent = text;
    }
    chrome.storage.sync.get(['reloadOnToggle'], (r) => {
        reloadCheckbox.checked = r.reloadOnToggle !== false;
        updateReloadInfo();
    });
    reloadCheckbox.addEventListener('change', () => {
        chrome.storage.sync.set({ reloadOnToggle: reloadCheckbox.checked });
        updateReloadInfo();
    });
    reloadInfo.addEventListener('click', () => {
        reloadNote.hidden = !reloadNote.hidden;
        reloadInfo.setAttribute('aria-expanded', String(!reloadNote.hidden));
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
        statusText.textContent = t('statusUnavailable', 'Unavailable');
        if (descriptionEl) {
            descriptionEl.textContent = t('unavailableHint', 'Focus Spoofer can only run on regular web pages (http/https).');
            descriptionEl.hidden = false;
        }
        return;
    }

    let currentDomain = '';
    try { currentDomain = new URL(tab.url).hostname; } catch (e) { }
    const siteNameEl = document.getElementById('siteName');
    if (siteNameEl) siteNameEl.textContent = currentDomain.replace(/^www\./, '');

    function updateUI(isActive) {
        if (isActive) {
            statusText.textContent = t('statusProtected', 'Protected');
            statusText.classList.add('active');
            iconContainer.classList.add('active');
        } else {
            statusText.textContent = t('statusInactive', 'Inactive');
            statusText.classList.remove('active');
            iconContainer.classList.remove('active');
        }
    }

    // Ask the background for this tab's state and paint the real UI in one shot.
    chrome.runtime.sendMessage({ action: 'get_state', tabId: tab.id, url: tab.url }, (response) => {
        if (chrome.runtime.lastError || !response) return;

        toggleSwitch.checked = response.isSpoofing;
        alwaysOnCheckbox.checked = response.isAlwaysOn;
        updateUI(response.isSpoofing);
        if (response.askReview) showReviewCard();

        if (response.isAlwaysOn) {
            toggleSwitch.disabled = true;
            statusText.textContent = t('statusAlwaysOn', 'Always on');
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
                statusText.textContent = t('statusAlwaysOn', 'Always on');
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
