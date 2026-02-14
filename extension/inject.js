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
    const eventTypes = ['visibilitychange', 'webkitvisibilitychange', 'blur', 'mozvisibilitychange', 'msvisibilitychange', 'mouseleave', 'pagehide'];

    // Override EventTarget.prototype.addEventListener to intercept listeners
    const originalAddEventListener = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, listener, options) {
        if (eventTypes.includes(type)) {
            // console.log(`[Focus Spoofer] Blocked listener for: ${type}`);
            return;
        }
        return originalAddEventListener.call(this, type, listener, options);
    };

    // Also aggressively stop propagation for any that originate from the browser
    eventTypes.forEach(type => {
        try {
            window.addEventListener(type, e => {
                e.stopImmediatePropagation();
                e.stopPropagation();
                // console.log(`[Focus Spoofer] Killed event: ${type}`);
            }, true); // Capture phase
        } catch (e) { }

        try {
            document.addEventListener(type, e => {
                e.stopImmediatePropagation();
                e.stopPropagation();
            }, true);
        } catch (e) { }
    });

})();
