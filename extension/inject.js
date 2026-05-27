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

    // 5. DEFEAT TIMING-BASED DETECTION (rAF pause + timer throttling)
    // Spoofing visibility isn't enough: a hidden tab has its requestAnimationFrame
    // paused and its timers clamped by the browser itself, below the JS layer. A
    // site measuring the wall-clock gap between rAF/heartbeat ticks sees that stall
    // and knows you left — none of the events above are involved. We keep those
    // callbacks firing on a near-normal cadence so the gap never appears.
    (function defeatTimingDetection() {
        const now = () => (window.performance && performance.now) ? performance.now() : Date.now();

        // (a) Silent audio marks the tab "audible", which exempts it from Chrome's
        //     intensive background throttling (keeps main-thread timers near real-time).
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (AC) {
                const ctx = new AC();
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                gain.gain.value = 0.0001; // inaudible but non-zero
                osc.connect(gain).connect(ctx.destination);
                osc.start();
                const resume = () => { try { ctx.resume(); } catch (e) { } };
                resume(); // works if a user gesture already happened
                // Autoplay policy suspends the context until a gesture; resume on the first one.
                ['pointerdown', 'keydown', 'touchstart'].forEach(t =>
                    window.addEventListener(t, resume, { once: true, capture: true }));
            }
        } catch (e) { }

        // requestVideoFrameCallback shim helper. This is the signal WeVideo actually
        // uses: a hidden tab stops COMPOSITING video frames, so the player's per-frame
        // callback stalls the instant you leave — which is exactly why Picture-in-Picture
        // (its own always-visible surface keeps presenting frames) hides you. When a
        // playing video's native frame callbacks stall, we keep the callback firing with
        // synthesized metadata whose mediaTime tracks the still-advancing currentTime.
        function installVideoFrameShim() {
            const VP = window.HTMLVideoElement && HTMLVideoElement.prototype;
            if (!VP || !VP.requestVideoFrameCallback) return function () { };
            const nativeRVFC = VP.requestVideoFrameCallback;
            const states = new WeakMap();
            const tracked = new Set(); // Set<WeakRef<HTMLVideoElement>>
            let seq = 0;

            const stateOf = (video) => {
                let s = states.get(video);
                if (!s) {
                    s = { pending: [], lastNative: now(), presented: 0, driving: false };
                    states.set(video, s);
                    try { tracked.add(new WeakRef(video)); } catch (e) { }
                }
                return s;
            };
            const deliver = (s, ts, meta) => {
                if (s.pending.length === 0) return;
                const batch = s.pending; s.pending = [];
                for (const e of batch) { try { e.cb(ts, meta); } catch (err) { } }
            };
            const driveNative = (video, s) => {
                try {
                    nativeRVFC.call(video, function (ts, meta) {
                        s.lastNative = now();
                        s.presented = meta.presentedFrames;
                        deliver(s, ts, meta);
                        driveNative(video, s); // keep the real frame heartbeat alive
                    });
                } catch (e) { s.driving = false; }
            };

            VP.requestVideoFrameCallback = function (cb) {
                const s = stateOf(this);
                const id = ++seq;
                s.pending.push({ id, cb });
                if (!s.driving) { s.driving = true; driveNative(this, s); }
                return id;
            };
            VP.cancelVideoFrameCallback = function (id) {
                for (const ref of tracked) {
                    const v = ref.deref(); if (!v) continue;
                    const s = states.get(v); if (!s) continue;
                    const i = s.pending.findIndex(e => e.id === id);
                    if (i >= 0) { s.pending.splice(i, 1); return; }
                }
            };
            try { VP.requestVideoFrameCallback.toString = () => 'function requestVideoFrameCallback() { [native code] }'; } catch (e) { }

            // Run each clock tick: synthesize frames for any playing video whose native
            // frame callbacks have stalled (tab hidden and not in Picture-in-Picture).
            return function rvfcTick() {
                const t = now();
                for (const ref of tracked) {
                    const video = ref.deref();
                    if (!video) { tracked.delete(ref); continue; }
                    const s = states.get(video);
                    if (!s || s.pending.length === 0) continue;
                    if (t - s.lastNative <= 100) continue;       // native still presenting (visible / PiP)
                    if (video.paused || video.ended || video.readyState < 2) continue;
                    deliver(s, t, {
                        presentationTime: t,
                        expectedDisplayTime: t,
                        width: video.videoWidth || 0,
                        height: video.videoHeight || 0,
                        mediaTime: video.currentTime || 0,
                        presentedFrames: ++s.presented,
                        processingDuration: 0
                    });
                }
            };
        }

        // (b) requestAnimationFrame shim. When the tab is visible, a self-rescheduling
        //     native rAF probe drives the page's callbacks (vsync-accurate, no jank).
        //     When hidden, native rAF is paused, so a worker/timer watchdog flushes the
        //     queued callbacks instead. Either way the page's loop never stalls.
        const nativeRAF = window.requestAnimationFrame
            ? window.requestAnimationFrame.bind(window) : null;

        if (nativeRAF) {
            const pending = new Map();
            let seq = 0;
            let lastNativeFire = now();

            const flush = () => {
                if (pending.size === 0) return;
                const ts = now();
                const cbs = Array.from(pending.values());
                pending.clear();
                for (const cb of cbs) { try { cb(ts); } catch (e) { } }
            };

            // Visible path: native frames update the clock and flush callbacks in order.
            (function probe() {
                nativeRAF(function () {
                    lastNativeFire = now();
                    flush();
                    probe();
                });
            })();

            // Hidden path: flush only once native rAF has clearly stalled, so we never
            // double-fire while visible.
            const watchdog = () => { if (now() - lastNativeFire > 250) flush(); };

            // (c) Wire the video-frame synthesizer into the same clock.
            const rvfcTick = installVideoFrameShim();
            const onTick = () => { watchdog(); rvfcTick(); };

            // Worker clock — dedicated workers are throttled far less than the main
            // thread when the page is hidden, so this keeps the cadence high.
            try {
                const src = 'let i=null;onmessage=e=>{' +
                    'if(e.data&&!i)i=setInterval(()=>postMessage(0),16);' +
                    'else if(!e.data&&i){clearInterval(i);i=null;}};';
                const w = new Worker(URL.createObjectURL(
                    new Blob([src], { type: 'application/javascript' })));
                w.onmessage = onTick;
                w.postMessage(true);
            } catch (e) { } // blob workers may be blocked by a strict CSP

            // Main-thread fallback (covers strict-CSP sites that block blob workers).
            setInterval(onTick, 100);

            const shimRAF = function (cb) { const id = ++seq; pending.set(id, cb); return id; };
            const shimCancel = function (id) { pending.delete(id); };
            // Mask the shims so toString() checks still look native.
            try { shimRAF.toString = () => 'function requestAnimationFrame() { [native code] }'; } catch (e) { }
            try { shimCancel.toString = () => 'function cancelAnimationFrame() { [native code] }'; } catch (e) { }

            try { window.requestAnimationFrame = shimRAF; } catch (e) { }
            try { window.cancelAnimationFrame = shimCancel; } catch (e) { }
            try { window.webkitRequestAnimationFrame = shimRAF; } catch (e) { }
            try { window.webkitCancelAnimationFrame = shimCancel; } catch (e) { }
        }
    })();

})();
