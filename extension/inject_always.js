// inject_always.js — Always-On gate
//
// Registered together with spoofer.js (which runs first and defines
// window.__FOCUS_SPOOFER_RUN) only for domains on the Always-On list. It
// activates the spoofer unconditionally, no session flag required.
(function () {
    try {
        if (typeof window.__FOCUS_SPOOFER_RUN === 'function') window.__FOCUS_SPOOFER_RUN();
    } catch (e) { }
})();
