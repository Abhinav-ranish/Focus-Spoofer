// i18n.js — fills the page's text from _locales/<lang>/messages.json.
//
//   data-i18n="key"              → textContent
//   data-i18n-title="key"        → title
//   data-i18n-aria="key"         → aria-label
//   data-i18n-placeholder="key"  → placeholder
//
// The English text stays in the HTML as the fallback, so a missing key never
// leaves a blank. Scripts use self.t(key, fallback).
(function () {
    const get = (key) => {
        try { return chrome.i18n.getMessage(key) || ''; } catch (e) { return ''; }
    };
    self.t = (key, fallback) => get(key) || fallback || '';

    const attrs = [['i18nTitle', 'title'], ['i18nAria', 'aria-label'], ['i18nPlaceholder', 'placeholder']];
    document.querySelectorAll('[data-i18n], [data-i18n-title], [data-i18n-aria], [data-i18n-placeholder]').forEach((el) => {
        if (el.dataset.i18n) {
            const v = get(el.dataset.i18n);
            if (v) el.textContent = v;
        }
        for (const [key, attr] of attrs) {
            if (!el.dataset[key]) continue;
            const v = get(el.dataset[key]);
            if (v) el.setAttribute(attr, v);
        }
    });
    try { document.documentElement.lang = chrome.i18n.getMessage('@@ui_locale').replace('_', '-') || 'en'; } catch (e) { }
})();
