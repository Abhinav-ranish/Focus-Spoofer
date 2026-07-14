// inject.js — session gate
//
// Registered together with spoofer.js (which runs first and defines
// window.__FOCUS_SPOOFER_RUN). This runs at document_start on every page but
// only activates the spoofer when the per-session flag is present, keeping the
// footprint on untouched tabs to a single sessionStorage read.
(function () {
    try {
        if (!window.sessionStorage.getItem('FOCUS_SPOOFers_ACTIVE')) return;
    } catch (e) {
        // Sandboxed iframe without sessionStorage access — nothing to do.
        return;
    }
    try {
        if (typeof window.__FOCUS_SPOOFER_RUN === 'function') window.__FOCUS_SPOOFER_RUN();
    } catch (e) { }
})();
