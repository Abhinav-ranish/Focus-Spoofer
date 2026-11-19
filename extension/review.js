// review.js — decides when to ask for a store review. It asks once, ever.
//
// It counts the time a protected tab plays sound while you are somewhere else
// (another tab, another window, Chrome minimized), which is the moment the
// extension visibly did its job. After 10 minutes of that, the popup shows a
// review card one time. Showing it ends the count for good, whatever you click.
// Nothing here is sent anywhere.
(function (root) {
    'use strict';

    var KEY = 'review';
    var THRESHOLD_MS = 10 * 60 * 1000;
    // A stretch left open across a crash or a sleeping laptop counts at most this.
    var MAX_STRETCH_MS = 2 * 60 * 60 * 1000;

    function createReview(opts) {
        var storage = opts.storage, now = opts.now;
        var queue = Promise.resolve();

        // Serialized read-modify-write of the stored state:
        // { keptMs, since (start of the current stretch, or absent), asked }.
        function mutate(fn) {
            var run = queue.then(function () {
                return storage.get([KEY]).then(function (r) {
                    var s = r[KEY] || { keptMs: 0 };
                    var out = fn(s);
                    return storage.set({ [KEY]: s }).then(function () { return out; });
                });
            });
            queue = run.catch(function () { });
            return run;
        }

        function total(s, t) {
            return s.keptMs + (s.since ? Math.min(Math.max(0, t - s.since), MAX_STRETCH_MS) : 0);
        }

        function close(s) {
            s.keptMs = total(s, now());
            delete s.since;
        }

        return {
            // playing: whether any protected tab is playing sound out of view.
            update: function (playing) {
                return mutate(function (s) {
                    if (s.asked || playing === !!s.since) return;
                    if (playing) s.since = now(); else close(s);
                });
            },
            // A stretch still open at startup ended at some unknown time; drop it.
            restart: function () {
                return mutate(function (s) { delete s.since; });
            },
            due: function () {
                return mutate(function (s) { return !s.asked && total(s, now()) >= THRESHOLD_MS; });
            },
            asked: function () {
                return mutate(function (s) { close(s); s.asked = true; });
            },
            isAsked: function () {
                return storage.get([KEY]).then(function (r) { return !!(r[KEY] && r[KEY].asked); });
            }
        };
    }

    var api = { createReview: createReview, THRESHOLD_MS: THRESHOLD_MS, MAX_STRETCH_MS: MAX_STRETCH_MS };
    root.FocusReview = api;
    if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
