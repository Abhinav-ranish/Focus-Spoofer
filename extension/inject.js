// inject.js
(function () {
    // 1. BOOTSTRAP CHECK
    // We check sessionStorage synchronously. This script runs at document_start.
    // If the flag is not set, we exit immediately to minimize impact.
    try {
        if (!window.sessionStorage.getItem('FOCUS_SPOOFers_ACTIVE')) {
            return;
        }
    } catch (e) {
        // If we can't access sessionStorage (e.g. sandboxed iframe), we bail.
        return;
    }

    // console.log('[Focus Spoofer] Flag found using local spoof.');

    // === SPOOFING LOGIC ===

    // 1. Aggressively Nuke "on" properties (window.onblur, window.onfocus)
    // This must happen BEFORE the page parses its own scripts.
    const eventsToBlock = ['onfocus', 'onblur', 'onvisibilitychange', 'onmouseleave', 'onpagehide', 'onresize']; // Added onresize sometimes used for detection

    eventsToBlock.forEach(prop => {
        try {
            if (window[prop]) window[prop] = null;
            Object.defineProperty(window, prop, {
                get: function () { return null; },
                set: function (val) { /* prevent assignment */ },
                configurable: false
            });

            if (document[prop]) document[prop] = null;
            Object.defineProperty(document, prop, {
                get: function () { return null; },
                set: function (val) { /* prevent assignment */ },
                configurable: false
            });
        } catch (e) { }
    });

    // 2. Spoof Visibility API
    Object.defineProperty(document, 'hidden', {
        get: function () { return false; },
        configurable: true
    });

    Object.defineProperty(document, 'visibilityState', {
        get: function () { return 'visible'; },
        configurable: true
    });

    // 3. Spoof document.hasFocus
    document.hasFocus = function () { return true; };

    // 4. Capture and Stop Events
    // We use the capture phase to kill these events before they reach the target.
    // Events to always block
    const alwaysBlock = ['visibilitychange', 'webkitvisibilitychange', 'blur', 'focusout', 'mozvisibilitychange', 'msvisibilitychange', 'mouseleave', 'pagehide'];
    // Events to allow once (initial focus) then block
    const allowOnce = ['focus', 'focusin'];

    let initialFocusFired = { focus: false, focusin: false };

    const allBlocked = [...alwaysBlock, ...allowOnce];

    // Override EventTarget.prototype.addEventListener to intercept listeners
    const originalAddEventListener = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, listener, options) {
        if (alwaysBlock.includes(type)) {
            return;
        }
        // Allow focus/focusin listeners through — we control the events themselves
        return originalAddEventListener.call(this, type, listener, options);
    };

    // Block events in capture phase
    alwaysBlock.forEach(type => {
        try {
            window.addEventListener(type, e => {
                e.stopImmediatePropagation();
                e.stopPropagation();
            }, true);
        } catch (e) { }

        try {
            document.addEventListener(type, e => {
                e.stopImmediatePropagation();
                e.stopPropagation();
            }, true);
        } catch (e) { }
    });

    // Allow the first focus/focusin through, then block all subsequent
    allowOnce.forEach(type => {
        try {
            window.addEventListener(type, e => {
                if (initialFocusFired[type]) {
                    e.stopImmediatePropagation();
                    e.stopPropagation();
                } else {
                    initialFocusFired[type] = true;
                }
            }, true);
        } catch (e) { }

        try {
            document.addEventListener(type, e => {
                if (initialFocusFired[type]) {
                    e.stopImmediatePropagation();
                    e.stopPropagation();
                } else {
                    initialFocusFired[type] = true;
                }
            }, true);
        } catch (e) { }
    });

})();
