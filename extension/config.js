// config.js — build-time configuration shared by the service worker and the
// settings page.
//
// BACKEND_ORIGIN: origin of the deployed feedback Worker (server/), e.g.
// 'https://focus-spoofer-feedback.example.workers.dev' — no trailing slash.
// Leave empty to disable the uninstall survey and usage reports entirely.
self.FOCUS_SPOOFER_CONFIG = {
    BACKEND_ORIGIN: 'https://focus-spoofer-feedback.aranish.workers.dev'
};
