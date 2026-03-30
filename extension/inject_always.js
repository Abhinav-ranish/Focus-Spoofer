// inject_always.js
(function () {
    // 1. ALWAYS ON - NO CHECKS
    // This script is only injected into domains that are in the "Always On" list.
    // So we run the spoofing logic immediately.

    // console.log('[Focus Spoofer] Always-On Mode Activated.');

    // === SPOOFING LOGIC (Same as inject.js but without session guard) ===

    // 1. Aggressively Nuke "on" properties (window.onblur, window.onfocus)
    const eventsToBlock = ['onfocus', 'onblur', 'onvisibilitychange', 'onmouseleave', 'onpagehide', 'onresize'];

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
    // Events to always block
    const alwaysBlock = ['visibilitychange', 'webkitvisibilitychange', 'blur', 'focusout', 'mozvisibilitychange', 'msvisibilitychange', 'mouseleave', 'pagehide'];
    // Events to allow once (initial focus) then block
    const allowOnce = ['focus', 'focusin'];

    let initialFocusFired = { focus: false, focusin: false };

    const originalAddEventListener = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, listener, options) {
        if (alwaysBlock.includes(type)) {
            return;
        }
        return originalAddEventListener.call(this, type, listener, options);
    };

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
