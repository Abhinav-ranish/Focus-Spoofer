// config.js — build-time configuration shared by the service worker and the
// settings page.
//
// BACKEND_ORIGIN: origin of the deployed feedback Worker (server/), e.g.
// 'https://focus-spoofer-feedback.example.workers.dev' — no trailing slash.
// Leave empty to disable the uninstall survey and usage reports entirely.
//
// REVIEW_URL: where "Leave a review" goes (the store's reviews page).
// WELCOME_URL: opened once after a fresh install; the site picks the language.
self.FOCUS_SPOOFER_CONFIG = {
    BACKEND_ORIGIN: 'https://focus.oddworks.us',
    REVIEW_URL: 'https://chromewebstore.google.com/detail/focus-spoofer/ejgeaphjlcnmjgadkcljhchgbaiioihh/reviews',
    WELCOME_URL: 'https://focus.oddworks.us/test?welcome=1'
};
