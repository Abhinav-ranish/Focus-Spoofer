// spoofer.js — shared spoofing core (MAIN world, document_start)
//
// This file is loaded before inject.js / inject_always.js in the same content
// script. It only DEFINES window.__FOCUS_SPOOFER_RUN — it never activates on its
// own. The gate scripts decide whether to call it:
//   • inject.js         → runs it only if the per-session flag is set
//   • inject_always.js  → runs it unconditionally (Always-On domains)
//
// Keeping the logic in one place removes the old duplication between the two
// inject files and guarantees both code paths stay in sync.
(function () {
    'use strict';

    // Define exactly once per frame. If a page is BOTH session-toggled and
    // Always-On, two content scripts fire and this file loads twice; the second
    // load is a no-op so we never redefine or double-patch.
    if (window.__FOCUS_SPOOFER_RUN) return;

    var applied = false;

    // ─────────────────────────────────────────────────────────────────────────
    // toString() masking
    //
    // Fingerprinters sometimes check whether a native method has been replaced by
    // calling fn.toString() OR Function.prototype.toString.call(fn). Overriding
    // only fn.toString is defeated by the second form, so we patch
    // Function.prototype.toString itself and report every function we tampered
    // with as "[native code]".
    // ─────────────────────────────────────────────────────────────────────────
    var patched = new WeakMap(); // fn -> reported name
    var origFnToString = Function.prototype.toString;

    function mask(fn, name) {
        try { patched.set(fn, name); } catch (e) { }
        return fn;
    }

    // Installed from run(), never at load: on pages where protection is off,
    // Function.prototype must stay untouched.
    function installToStringMask() {
        try {
            var maskedToString = function toString() {
                var name = patched.get(this);
                if (name !== undefined) {
                    return 'function ' + name + '() { [native code] }';
                }
                return origFnToString.call(this);
            };
            Function.prototype.toString = maskedToString;
            mask(maskedToString, 'toString');
        } catch (e) { }
    }

    // Native page-state readers, captured before applyFocusSpoof() replaces
    // them, so the extension itself still knows the real state.
    var DocProto = window.Document && Document.prototype;
    var hiddenDesc = DocProto && Object.getOwnPropertyDescriptor(DocProto, 'hidden');
    var nativeHasFocus = DocProto && DocProto.hasFocus;
    function reallyHidden() {
        try { return !!(hiddenDesc && hiddenDesc.get.call(document)); } catch (e) { return false; }
    }
    function reallyFocused() {
        try { return nativeHasFocus ? !!nativeHasFocus.call(document) : true; } catch (e) { return true; }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Per-page-load fingerprint seed
    //
    // A fresh random seed is generated on every document load (NOT persisted).
    // Consequences, all intentional:
    //   • Stable WITHIN a single page load → every canvas read on the page agrees,
    //     so canvas-based apps don't flicker mid-page.
    //   • Different on every reload / new page → the fingerprint changes each load.
    //     Cover Your Tracks detects randomization by comparing the canvas/webgl/
    //     audio hash across two loads; a per-session-stable value would slip past
    //     that check, so we deliberately change it every load.
    // ─────────────────────────────────────────────────────────────────────────
    function makeSeed() {
        var s = 0;
        try {
            var buf = new Uint32Array(2);
            (window.crypto || window.msCrypto).getRandomValues(buf);
            s = (buf[0] ^ Math.imul(buf[1], 2654435761)) >>> 0;
        } catch (e) {
            s = (Math.floor(Math.random() * 0xffffffff)) >>> 0;
        }
        if (!s) s = 0x9e3779b9;
        return s;
    }

    var SEED = makeSeed();

    // Deterministic 32-bit hash of (seed, index). Same inputs → same output, so
    // repeated reads of a canvas within one page load are consistent. Uses the
    // murmur3 fmix32 finalizer so it avalanches — every output bit (including the
    // low bits we key pixel selection/direction off) depends on the whole seed,
    // ensuring two different page-load seeds yield different perturbations.
    function noiseAt(index) {
        var h = (Math.imul(index + 1, 2654435761) ^ SEED) >>> 0;
        h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0;
        h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0;
        h ^= h >>> 16;
        return h >>> 0;
    }

    function clamp8(v) {
        return v < 0 ? 0 : (v > 255 ? 255 : v);
    }

    // Perturb ~1/16 of pixels by ±1 on each RGB channel (alpha untouched). The
    // change is imperceptible visually but shifts any hash of the pixel data.
    function perturbRGBA(data) {
        var len = data.length;
        for (var i = 0; i < len; i += 4) {
            var n = noiseAt(i);
            if ((n & 0x0f) !== 0) continue;       // skip 15/16 pixels
            var d = (n & 0x10) ? 1 : -1;
            data[i] = clamp8(data[i] + d);
            data[i + 1] = clamp8(data[i + 1] + d);
            data[i + 2] = clamp8(data[i + 2] + d);
        }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // 1) FOCUS / VISIBILITY SPOOFING
    // ═════════════════════════════════════════════════════════════════════════
    function applyFocusSpoof() {
        // (a) Neutralise on* handler properties so a page can't wire detection
        //     through window.onblur = ... etc.
        var onProps = ['onfocus', 'onblur', 'onvisibilitychange', 'onmouseleave', 'onpagehide'];
        onProps.forEach(function (prop) {
            [window, document].forEach(function (target) {
                try {
                    if (target[prop]) target[prop] = null;
                    Object.defineProperty(target, prop, {
                        get: function () { return null; },
                        set: function () { },
                        configurable: false
                    });
                } catch (e) { }
            });
        });

        // (b) Spoof the Visibility API. Define on Document.prototype (not the
        //     instance) so reads via the prototype getter —
        //     Object.getOwnPropertyDescriptor(Document.prototype,'hidden').get.call(document)
        //     — a common anti-spoof probe, also return the faked value.
        function defineConst(obj, prop, value) {
            try {
                Object.defineProperty(obj, prop, {
                    get: function () { return value; },
                    configurable: true,
                    enumerable: true
                });
            } catch (e) { }
        }

        var DP = DocProto;
        if (DP) {
            defineConst(DP, 'hidden', false);
            defineConst(DP, 'visibilityState', 'visible');
            defineConst(DP, 'webkitHidden', false);
            defineConst(DP, 'webkitVisibilityState', 'visible');
        }
        // Instance-level too, as belt-and-braces for any engine quirks.
        defineConst(document, 'hidden', false);
        defineConst(document, 'visibilityState', 'visible');

        // (c) Spoof hasFocus() on the prototype (and instance).
        try {
            var fakeHasFocus = function hasFocus() { return true; };
            mask(fakeHasFocus, 'hasFocus');
            if (DP) DP.hasFocus = fakeHasFocus;
            document.hasFocus = fakeHasFocus;
        } catch (e) { }

        // (d) Event suppression.
        //
        // Only the signals that reveal "the user left" are suppressed. Element
        // level focus/blur/mouseleave must keep working — forms validate on
        // blur, React wires onFocus/onBlur through focusin/focusout on its root,
        // and hover menus close on mouseleave.
        //   • visibility events and pagehide: always (they only mean "left").
        //   • blur/focusout: when aimed at window/document, or when the window
        //     itself has lost focus (the element blur that accompanies it).
        //   • focus/focusin: the first one is allowed (initial state) unless the
        //     page has already been hidden/blurred — then it's a "came back"
        //     signal. Later window/document focus and the element re-focus that
        //     follows a suppressed window blur are dropped.
        //   • mouseleave: only on window/document/<html>/<body> — the pointer
        //     leaving the page — never on ordinary elements.
        var visibilityTypes = ['visibilitychange', 'webkitvisibilitychange', 'mozvisibilitychange',
            'msvisibilitychange', 'pagehide'];
        var pageLevelTypes = ['blur', 'focusout', 'mouseleave'];
        var initialFocusFired = { focus: false, focusin: false };
        var awayElement = null; // element that lost focus when the window did
        var away = false;
        var everAway = false;   // page has been hidden or blurred at least once

        function isPageTarget(t) {
            return t === window || t === document ||
                t === document.documentElement || t === document.body;
        }

        // Drop registrations that could only ever observe "the user left".
        var originalAddEventListener = EventTarget.prototype.addEventListener;
        var patchedAEL = function addEventListener(type, listener, options) {
            if (visibilityTypes.indexOf(type) !== -1) return;
            if (pageLevelTypes.indexOf(type) !== -1 && (this === window || this === document)) return;
            return originalAddEventListener.call(this, type, listener, options);
        };
        mask(patchedAEL, 'addEventListener');
        try { EventTarget.prototype.addEventListener = patchedAEL; } catch (e) { }

        function kill(e) {
            e.stopImmediatePropagation();
            e.stopPropagation();
        }

        // Capture-phase filters on window run before any page listener.
        var killVisibility = function (e) { everAway = true; kill(e); };
        visibilityTypes.forEach(function (type) {
            [window, document].forEach(function (target) {
                try { originalAddEventListener.call(target, type, killVisibility, true); } catch (e) { }
            });
        });

        ['blur', 'focusout'].forEach(function (type) {
            try {
                originalAddEventListener.call(window, type, function (e) {
                    var t = e.target;
                    if (t === window || t === document) { away = everAway = true; kill(e); return; }
                    if (!reallyFocused()) {
                        // The window is losing focus; this element blur is a side effect.
                        away = everAway = true;
                        awayElement = t;
                        kill(e);
                    }
                }, true);
            } catch (e) { }
        });

        ['focus', 'focusin'].forEach(function (type) {
            try {
                originalAddEventListener.call(window, type, function (e) {
                    var t = e.target;
                    if (t === window || t === document) {
                        if (!initialFocusFired[type] && !everAway) { initialFocusFired[type] = true; return; }
                        kill(e);
                        // The element re-focus (if any) follows in the same task.
                        if (away) setTimeout(function () { away = false; awayElement = null; }, 0);
                        return;
                    }
                    initialFocusFired[type] = true;
                    if (away && t === awayElement) kill(e);
                }, true);
            } catch (e) { }
        });

        try {
            originalAddEventListener.call(window, 'mouseleave', function (e) {
                if (isPageTarget(e.target)) kill(e);
            }, true);
        } catch (e) { }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // 2) TIMING-BASED DETECTION DEFENCE (rAF pause + timer throttling)
    //
    // A hidden tab has requestAnimationFrame paused and timers clamped by the
    // browser itself. A site measuring the wall-clock gap between rAF/heartbeat
    // ticks sees that stall and knows you left — no events involved. We keep
    // those callbacks firing on a near-normal cadence so the gap never appears.
    // ═════════════════════════════════════════════════════════════════════════
    function applyTimingDefense() {
        var now = function () {
            return (window.performance && performance.now) ? performance.now() : Date.now();
        };

        // (a) Silent audio marks the tab "audible", exempting it from Chrome's
        //     intensive background throttling (keeps main-thread timers near
        //     real-time).
        try {
            var AC = window.AudioContext || window.webkitAudioContext;
            if (AC) {
                var ctx = new AC();
                var osc = ctx.createOscillator();
                var gain = ctx.createGain();
                gain.gain.value = 0.0001; // inaudible but non-zero
                osc.connect(gain).connect(ctx.destination);
                osc.start();
                var resume = function () { try { ctx.resume(); } catch (e) { } };
                resume();
                ['pointerdown', 'keydown', 'touchstart'].forEach(function (t) {
                    window.addEventListener(t, resume, { once: true, capture: true });
                });
            }
        } catch (e) { }

        // (b) requestVideoFrameCallback shim: a hidden tab stops compositing video
        //     frames, so a player's per-frame callback stalls the instant you
        //     leave. Keep it firing with synthesized metadata tracking currentTime.
        function installVideoFrameShim() {
            var VP = window.HTMLVideoElement && HTMLVideoElement.prototype;
            if (!VP || !VP.requestVideoFrameCallback) return function () { };
            var nativeRVFC = VP.requestVideoFrameCallback;
            var states = new WeakMap();
            var tracked = new Set();
            var seq = 0;

            var stateOf = function (video) {
                var s = states.get(video);
                if (!s) {
                    s = { pending: [], lastNative: now(), presented: 0, driving: false };
                    states.set(video, s);
                    try { tracked.add(new WeakRef(video)); } catch (e) { }
                }
                return s;
            };
            var deliver = function (s, ts, meta) {
                if (s.pending.length === 0) return;
                var batch = s.pending; s.pending = [];
                for (var i = 0; i < batch.length; i++) {
                    try { batch[i].cb(ts, meta); } catch (err) { }
                }
            };
            var driveNative = function (video, s) {
                try {
                    nativeRVFC.call(video, function (ts, meta) {
                        s.lastNative = now();
                        s.presented = meta.presentedFrames;
                        deliver(s, ts, meta);
                        driveNative(video, s);
                    });
                } catch (e) { s.driving = false; }
            };

            var shimRVFC = function requestVideoFrameCallback(cb) {
                var s = stateOf(this);
                var id = ++seq;
                s.pending.push({ id: id, cb: cb });
                if (!s.driving) { s.driving = true; driveNative(this, s); }
                return id;
            };
            var shimCancelRVFC = function cancelVideoFrameCallback(id) {
                tracked.forEach(function (ref) {
                    var v = ref.deref(); if (!v) return;
                    var s = states.get(v); if (!s) return;
                    var i = s.pending.findIndex(function (e) { return e.id === id; });
                    if (i >= 0) s.pending.splice(i, 1);
                });
            };
            mask(shimRVFC, 'requestVideoFrameCallback');
            mask(shimCancelRVFC, 'cancelVideoFrameCallback');
            VP.requestVideoFrameCallback = shimRVFC;
            VP.cancelVideoFrameCallback = shimCancelRVFC;

            return function rvfcTick() {
                var t = now();
                tracked.forEach(function (ref) {
                    var video = ref.deref();
                    if (!video) { tracked.delete(ref); return; }
                    var s = states.get(video);
                    if (!s || s.pending.length === 0) return;
                    if (t - s.lastNative <= 100) return;   // native still presenting (visible / PiP)
                    if (video.paused || video.ended || video.readyState < 2) return;
                    deliver(s, t, {
                        presentationTime: t,
                        expectedDisplayTime: t,
                        width: video.videoWidth || 0,
                        height: video.videoHeight || 0,
                        mediaTime: video.currentTime || 0,
                        presentedFrames: ++s.presented,
                        processingDuration: 0
                    });
                });
            };
        }

        // (c) requestAnimationFrame shim. Visible: native rAF drives callbacks
        //     (vsync-accurate), scheduled only while something is pending so an
        //     idle page doesn't render at 60fps forever. Hidden: native rAF
        //     pauses, so a worker/timer watchdog flushes the queue instead.
        var nativeRAF = window.requestAnimationFrame
            ? window.requestAnimationFrame.bind(window) : null;
        if (!nativeRAF) return;

        var pending = new Map();
        var seq = 0;
        var lastNativeFire = now();
        var probeScheduled = false;

        var flush = function () {
            if (pending.size === 0) return;
            var ts = now();
            var cbs = Array.from(pending.values());
            pending.clear();
            for (var i = 0; i < cbs.length; i++) { try { cbs[i](ts); } catch (e) { } }
        };

        var probe = function () {
            probeScheduled = false;
            lastNativeFire = now();
            flush();
        };
        var scheduleProbe = function () {
            if (probeScheduled) return;
            probeScheduled = true;
            try { nativeRAF(probe); } catch (e) { probeScheduled = false; }
        };

        var watchdog = function () { if (now() - lastNativeFire > 250) flush(); };
        var rvfcTick = installVideoFrameShim();
        var onTick = function () { watchdog(); rvfcTick(); };

        // Background clocks only run while the tab is really hidden; a visible
        // tab gets native rAF/rVFC and pays nothing.
        //
        // Worker clock — background workers are throttled far less than the main
        // thread, keeping cadence high while hidden.
        var worker = null;
        try {
            var src = 'let i=null;onmessage=e=>{' +
                'if(e.data&&!i)i=setInterval(()=>postMessage(0),16);' +
                'else if(!e.data&&i){clearInterval(i);i=null;}};';
            var blobUrl = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
            worker = new Worker(blobUrl);
            worker.onmessage = onTick;
            try { URL.revokeObjectURL(blobUrl); } catch (e) { }
        } catch (e) { worker = null; } // blob workers may be blocked by a strict CSP

        // Main-thread fallback (covers strict-CSP sites that block blob workers).
        var fallbackTimer = null;
        var setClocks = function (hidden) {
            if (worker) { try { worker.postMessage(hidden); } catch (e) { } }
            if (hidden && fallbackTimer === null) fallbackTimer = setInterval(onTick, 100);
            if (!hidden && fallbackTimer !== null) { clearInterval(fallbackTimer); fallbackTimer = null; }
        };
        // Registered before applyFocusSpoof() adds its capture filter on window,
        // so this listener still sees the real visibilitychange.
        try {
            window.addEventListener('visibilitychange', function () { setClocks(reallyHidden()); }, true);
        } catch (e) { }
        setClocks(reallyHidden());

        var shimRAF = function requestAnimationFrame(cb) {
            var id = ++seq;
            pending.set(id, cb);
            scheduleProbe();
            return id;
        };
        var shimCancel = function cancelAnimationFrame(id) { pending.delete(id); };
        mask(shimRAF, 'requestAnimationFrame');
        mask(shimCancel, 'cancelAnimationFrame');

        try { window.requestAnimationFrame = shimRAF; } catch (e) { }
        try { window.cancelAnimationFrame = shimCancel; } catch (e) { }
        try { window.webkitRequestAnimationFrame = shimRAF; } catch (e) { }
        try { window.webkitCancelAnimationFrame = shimCancel; } catch (e) { }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // 3) CANVAS / WebGL / AUDIO FINGERPRINT DEFENCE
    //
    // Fingerprinters read back rendered pixels (canvas.toDataURL / getImageData /
    // toBlob, gl.readPixels) or audio samples and hash them into a stable device
    // ID. We inject a per-session, deterministic ±1 perturbation on read so the
    // hash is unique per session and no longer identifies the machine, while the
    // visible output is unchanged.
    // ═════════════════════════════════════════════════════════════════════════
    function applyFingerprintDefense() {
        // ── 2D canvas ──
        var HCE = window.HTMLCanvasElement && HTMLCanvasElement.prototype;
        var CRC = window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype;

        var origGetImageData = CRC && CRC.getImageData;

        // Build a noisy off-screen copy of a canvas so we never mutate the visible
        // one. Used by toDataURL / toBlob.
        function noisyClone(source) {
            var w = source.width, h = source.height;
            if (!w || !h) throw new Error('empty canvas');
            var copy = document.createElement('canvas');
            copy.width = w;
            copy.height = h;
            var cctx = copy.getContext('2d');
            cctx.drawImage(source, 0, 0);
            var img = origGetImageData.call(cctx, 0, 0, w, h);
            perturbRGBA(img.data);
            cctx.putImageData(img, 0, 0);
            return copy;
        }

        if (HCE && origGetImageData) {
            try {
                var origToDataURL = HCE.toDataURL;
                var patchedToDataURL = function toDataURL() {
                    try {
                        return origToDataURL.apply(noisyClone(this), arguments);
                    } catch (e) {
                        return origToDataURL.apply(this, arguments);
                    }
                };
                mask(patchedToDataURL, 'toDataURL');
                HCE.toDataURL = patchedToDataURL;
            } catch (e) { }

            try {
                var origToBlob = HCE.toBlob;
                if (origToBlob) {
                    var patchedToBlob = function toBlob(callback) {
                        var rest = Array.prototype.slice.call(arguments, 1);
                        try {
                            return origToBlob.apply(noisyClone(this), [callback].concat(rest));
                        } catch (e) {
                            return origToBlob.apply(this, arguments);
                        }
                    };
                    mask(patchedToBlob, 'toBlob');
                    HCE.toBlob = patchedToBlob;
                }
            } catch (e) { }

            try {
                var patchedGetImageData = function getImageData() {
                    var img = origGetImageData.apply(this, arguments);
                    try { perturbRGBA(img.data); } catch (e) { }
                    return img;
                };
                mask(patchedGetImageData, 'getImageData');
                CRC.getImageData = patchedGetImageData;
            } catch (e) { }
        }

        // ── WebGL readback ──
        [window.WebGLRenderingContext, window.WebGL2RenderingContext].forEach(function (Ctor) {
            if (!Ctor || !Ctor.prototype || !Ctor.prototype.readPixels) return;
            try {
                var proto = Ctor.prototype;
                var origReadPixels = proto.readPixels;
                var patchedReadPixels = function readPixels(x, y, width, height, format, type, pixels) {
                    var ret = origReadPixels.apply(this, arguments);
                    try {
                        if (pixels && pixels.length && type === this.UNSIGNED_BYTE) {
                            var len = pixels.length;
                            for (var i = 0; i < len; i += 4) {
                                if ((noiseAt(i) & 0x0f) !== 0) continue;
                                pixels[i] = clamp8(pixels[i] + ((noiseAt(i) & 0x10) ? 1 : -1));
                            }
                        }
                    } catch (e) { }
                    return ret;
                };
                mask(patchedReadPixels, 'readPixels');
                proto.readPixels = patchedReadPixels;
            } catch (e) { }
        });

        // ── Audio ──
        // getFloatFrequencyData writes into a caller-owned array (safe to noise).
        try {
            if (window.AnalyserNode && AnalyserNode.prototype.getFloatFrequencyData) {
                var origFFD = AnalyserNode.prototype.getFloatFrequencyData;
                var patchedFFD = function getFloatFrequencyData(array) {
                    origFFD.call(this, array);
                    try {
                        for (var i = 0; i < array.length; i++) {
                            array[i] += ((noiseAt(i) & 0xff) - 128) * 1e-4;
                        }
                    } catch (e) { }
                };
                mask(patchedFFD, 'getFloatFrequencyData');
                AnalyserNode.prototype.getFloatFrequencyData = patchedFFD;
            }
        } catch (e) { }

        // The classic audio fingerprint sums OfflineAudioContext-rendered samples
        // via AudioBuffer.getChannelData. Perturb deterministically by a tiny,
        // inaudible amount so the sum shifts per session.
        try {
            if (window.AudioBuffer && AudioBuffer.prototype.getChannelData) {
                var origGCD = AudioBuffer.prototype.getChannelData;
                var patchedGCD = function getChannelData(channel) {
                    var data = origGCD.call(this, channel);
                    try {
                        for (var i = 0; i < data.length; i += 137) {
                            data[i] += ((noiseAt(i) & 0xff) - 128) * 1e-7;
                        }
                    } catch (e) { }
                    return data;
                };
                mask(patchedGCD, 'getChannelData');
                AudioBuffer.prototype.getChannelData = patchedGCD;
            }
        } catch (e) { }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Public entry point. Idempotent: applies at most once per frame.
    // ─────────────────────────────────────────────────────────────────────────
    // Order matters: the timing defence registers its own visibilitychange
    // listener before applyFocusSpoof() starts swallowing those events.
    // `run.fingerprint = false` (set by nofp.js when the user turned
    // fingerprint randomization off) skips the canvas/WebGL/audio patches.
    function run() {
        if (applied) return;
        applied = true;
        installToStringMask();
        try { applyTimingDefense(); } catch (e) { }
        try { applyFocusSpoof(); } catch (e) { }
        if (run.fingerprint !== false) {
            try { applyFingerprintDefense(); } catch (e) { }
        }
    }
    mask(run, 'run');

    try {
        Object.defineProperty(window, '__FOCUS_SPOOFER_RUN', {
            value: run,
            configurable: false,
            enumerable: false,
            writable: false
        });
    } catch (e) {
        window.__FOCUS_SPOOFER_RUN = run;
    }
})();
