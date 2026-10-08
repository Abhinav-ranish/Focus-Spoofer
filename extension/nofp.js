// nofp.js — fingerprint randomization opt-out
//
// Registered between spoofer.js and the gate script only when the user turned
// "Randomize canvas/WebGL/audio fingerprint" off in Settings. run() checks this
// flag and skips the canvas/WebGL/audio patches; focus/visibility spoofing and
// the timing defence are unaffected.
(function () {
    try {
        if (typeof window.__FOCUS_SPOOFER_RUN === 'function') window.__FOCUS_SPOOFER_RUN.fingerprint = false;
    } catch (e) { }
})();
