// Focus Spoofer site interactions.
// Lenis (smooth scroll) + GSAP/ScrollTrigger/SplitText from jsDelivr. Every
// effect is optional: without the libraries, or with reduced motion, the page
// is fully readable and static.
(function () {
  'use strict';

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Animations need both GSAP and ScrollTrigger; if either is missing the page
  // stays static (content is only hidden once .js is set below).
  var hasGsap = typeof window.gsap !== 'undefined' && typeof window.ScrollTrigger !== 'undefined';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  // ── Nav state ──────────────────────────────────────────────────────────
  var nav = $('#nav');
  var onScroll = function () { if (nav) nav.classList.toggle('scrolled', window.scrollY > 12); };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // ── The eye: cursor tracking, fluid iris, blinking ──────────────────────
  var eye = $('#eye');
  if (eye) {
    var look = $('#look'), iris = $('#iris'), pupil = $('#pupil'), lid = $('#lid');
    var target = { x: 0, y: 0, dilate: 0 }, cur = { x: 0, y: 0, dilate: 0 };

    window.addEventListener('pointermove', function (e) {
      var r = eye.getBoundingClientRect();
      var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      var dx = e.clientX - cx, dy = e.clientY - cy;
      var d = Math.hypot(dx, dy) || 1;
      var reach = Math.min(1, d / (r.width * 0.9));
      target.x = (dx / d) * 52 * reach;
      target.y = (dy / d) * 30 * reach;
      // pupil widens when the cursor comes close (curiosity)
      target.dilate = Math.max(0, 1 - d / (r.width * 0.55));
    }, { passive: true });

    // Iris outline: a soft blob from 72 points with layered sine noise.
    var N = 72;
    function blob(t, amp) {
      var pts = [];
      for (var i = 0; i < N; i++) {
        var a = (i / N) * Math.PI * 2;
        var r = 70 + amp * (Math.sin(a * 3 + t * 1.1) * 1.9 + Math.sin(a * 4 - t * 0.8) * 1.1 + Math.sin(a * 2 + t * 0.5) * 1.6);
        pts.push([200 + Math.cos(a) * r, 200 + Math.sin(a) * r]);
      }
      var d = 'M' + pts[0][0].toFixed(1) + ' ' + pts[0][1].toFixed(1);
      for (var j = 1; j <= N; j++) {
        var p = pts[j % N], q = pts[(j + 1) % N];
        var mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
        d += 'Q' + p[0].toFixed(1) + ' ' + p[1].toFixed(1) + ' ' + mx.toFixed(1) + ' ' + my.toFixed(1);
      }
      return d + 'Z';
    }

    var t0 = performance.now();
    (function frame(now) {
      cur.x += (target.x - cur.x) * 0.12;
      cur.y += (target.y - cur.y) * 0.12;
      cur.dilate += (target.dilate - cur.dilate) * 0.08;
      look.setAttribute('transform', 'translate(' + cur.x.toFixed(2) + ' ' + cur.y.toFixed(2) + ')');
      pupil.setAttribute('r', (27 + cur.dilate * 9).toFixed(2));
      if (!reduce) iris.setAttribute('d', blob((now - t0) / 1000, 1 + cur.dilate * 0.8));
      requestAnimationFrame(frame);
    })(t0);

    var leftAt = 0;
    var blink = function () {
      if (!hasGsap || leftAt) return;
      gsap.timeline()
        .to(lid, { scaleY: 0.06, transformOrigin: '50% 50%', duration: 0.09, ease: 'power2.in' })
        .to(lid, { scaleY: 1, duration: 0.16, ease: 'power2.out' });
    };
    if (!reduce) {
      (function loop() { setTimeout(function () { blink(); loop(); }, 3200 + Math.random() * 4200); })();
      eye.addEventListener('click', blink);
    }

    // Live demo: this page is NOT protected by anything, so it can time you
    // whenever you leave. (With Focus Spoofer on for this tab, it can't.)
    // Messages live on the elements (data-*) so translated pages carry their own.
    var watch = $('#watch'), note = $('#awayNote'), secs = $('#watchSecs'), log = $('#watchLog');
    var baseTitle = document.title, reason = '', tick = 0;
    var msg = function (el, name) { return (el && el.getAttribute(name)) || ''; };
    var away = function () { return (performance.now() - leftAt) / 1000; };
    function leave(why) {
      leftAt = performance.now(); reason = why;
      if (!watch) return;
      watch.classList.remove('caught');
      watch.classList.add('away');
      // Background tabs run timers about once a second, so the title (which
      // you can see from the other tab) counts whole seconds.
      tick = setInterval(function () {
        var s = away();
        secs.textContent = s.toFixed(1);
        document.title = msg(watch, 'data-msg-title').replace('{s}', Math.floor(s));
      }, 100);
      if (hasGsap && !reduce) gsap.to(lid, { scaleY: 0.45, transformOrigin: '50% 50%', duration: 0.3, ease: 'power2.out' });
    }
    function back() {
      var s = away().toFixed(1);
      leftAt = 0;
      clearInterval(tick);
      document.title = baseTitle;
      if (!watch) return;
      watch.classList.remove('away');
      watch.classList.add('caught');
      secs.textContent = s;
      note.innerHTML = '';
      var b = document.createElement('b');
      b.textContent = msg(note, reason === 'tab' ? 'data-msg-tab' : 'data-msg-window').replace('{s}', s);
      note.appendChild(b);
      note.appendChild(document.createTextNode(msg(note, 'data-msg-tail')));
      var li = document.createElement('li');
      [new Date().toLocaleTimeString(document.documentElement.lang || undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' }),
        msg(watch, reason === 'tab' ? 'data-msg-log-tab' : 'data-msg-log-window'), s + 's'].forEach(function (t) {
        var span = document.createElement('span');
        span.textContent = t;
        li.appendChild(span);
      });
      log.insertBefore(li, log.firstChild);
      while (log.children.length > 3) log.removeChild(log.lastChild);
      // Eyes wide open: caught you.
      if (hasGsap && !reduce) {
        gsap.timeline()
          .to(lid, { scaleY: 1.08, duration: 0.18, ease: 'back.out(3)' })
          .to(lid, { scaleY: 1, duration: 0.3 })
          .add(blink, '+=0.25');
      }
    }
    document.addEventListener('visibilitychange', function () {
      // Switching tabs blurs the window a moment before the tab hides.
      if (document.hidden) { if (leftAt) reason = 'tab'; else leave('tab'); return; }
      if (leftAt) back();
    });
    window.addEventListener('blur', function () { if (!leftAt && !document.hidden) leave('window'); });
    window.addEventListener('focus', function () { if (leftAt && !document.hidden) back(); });
  }

  // ── Fingerprint demo (signal 03): same drawing, with and without noise ──
  function fnv(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return ('00000000' + h.toString(16)).slice(-8);
  }
  function drawFp(c, noisy) {
    var g = c.getContext('2d');
    g.fillStyle = '#e2452b'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#161411'; g.font = '600 15px Georgia, serif'; g.fillText('fingerprint', 14, 34);
    g.fillStyle = 'rgba(255,255,255,.7)'; g.fillRect(14, 46, 92, 10);
    if (noisy) {
      var img = g.getImageData(0, 0, c.width, c.height);
      for (var k = 0; k < img.data.length; k += 4) {
        if (Math.random() < 0.06) { var d = Math.random() < 0.5 ? -1 : 1; img.data[k] += d; img.data[k + 1] += d; img.data[k + 2] += d; }
      }
      g.putImageData(img, 0, 0);
    }
    try { return fnv(c.toDataURL()); } catch (e) { return '—'; }
  }
  var fa = $('#fpA'), fb = $('#fpB');
  if (fa && fb) {
    var la = $('#fpHashA').getAttribute('data-label') || '', lb = $('#fpHashB').getAttribute('data-label') || '';
    $('#fpHashA').textContent = la + '  ' + drawFp(fa, false);
    $('#fpHashB').textContent = lb + ' ' + drawFp(fb, true);
    fb.addEventListener('pointerenter', function () { $('#fpHashB').textContent = lb + ' ' + drawFp(fb, true); });
  }

  if (!hasGsap) return;
  document.documentElement.classList.add('js');
  gsap.registerPlugin(ScrollTrigger);
  if (window.SplitText) gsap.registerPlugin(SplitText);

  // ── Smooth scroll ──────────────────────────────────────────────────────
  if (!reduce && window.Lenis) {
    var lenis = new Lenis({ lerp: 0.09, wheelMultiplier: 1 });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(function (time) { lenis.raf(time * 1000); });
    gsap.ticker.lagSmoothing(0);
    $$('a[href^="#"]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        var id = a.getAttribute('href');
        if (id.length > 1 && $(id)) { e.preventDefault(); lenis.scrollTo(id, { offset: -24 }); }
      });
    });
  }

  if (reduce) {
    gsap.set('[data-reveal]', { opacity: 1, y: 0 });
    gsap.set('[data-clip]', { clipPath: 'none' });
    return;
  }

  // ── Hero intro ─────────────────────────────────────────────────────────
  var splitReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  splitReady.then(function () {
    $$('[data-split]').forEach(function (el) {
      if (!window.SplitText) return;
      var split = SplitText.create(el, { type: 'lines,words', mask: 'lines', linesClass: 'split-line' });
      gsap.from(split.words, { yPercent: 110, duration: 1.1, ease: 'expo.out', stagger: 0.06, delay: 0.15 });
    });
    ScrollTrigger.refresh();
  });

  $$('[data-reveal]').forEach(function (el, i) {
    gsap.to(el, { opacity: 1, y: 0, duration: 1, ease: 'power3.out', delay: 0.55 + 0.1 * i });
  });

  var cssVar = function (name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); };

  var mm = gsap.matchMedia();

  // ── Hero → protected tab (pinned, desktop only) ─────────────────────────
  mm.add('(min-width: 861px)', function () {
    var hero = $('#hero'), stage = $('#stage'), mock = $('#mock');
    var mockBody = $('.mock-body', mock);
    var dx = function () {
      var s = stage.getBoundingClientRect(), b = mockBody.getBoundingClientRect(), h = hero.getBoundingClientRect();
      // mock is centred in the hero; compute where its body centre will be
      return (h.left + h.width / 2) - (s.left + s.width / 2);
    };
    var dy = function () {
      var s = stage.getBoundingClientRect(), h = hero.getBoundingClientRect();
      return (h.top + h.height / 2 + 22) - (s.top + s.height / 2);
    };
    var tl = gsap.timeline({
      scrollTrigger: { trigger: hero, start: 'top top', end: '+=110%', scrub: 0.6, pin: true, invalidateOnRefresh: true }
    });
    tl.to('.hero-copy', { y: -140, opacity: 0, ease: 'power2.in', duration: 0.5 }, 0)
      .to('#watch', { y: -40, opacity: 0, duration: 0.25 }, 0)
      .to(stage, { x: dx, y: dy, scale: 0.46, ease: 'power2.inOut', duration: 1 }, 0)
      .to(mock, { opacity: 1, scale: 1, ease: 'power2.out', duration: 0.7 }, 0.3)
      .from('.mock-popup', { y: -16, opacity: 0, duration: 0.3 }, 0.75)
      .from('.mock-caption span', { y: 10, opacity: 0, stagger: 0.06, duration: 0.25 }, 0.8)
      // The switch flips on and the eye turns green: protected.
      .from('.mock-popup .sw', { '--k': 0, backgroundColor: cssVar('--line-strong'), duration: 0.2 }, 1.05)
      .from('.mock-popup .state', { opacity: 0.4, duration: 0.2 }, 1.05)
      .to('#iris', { fill: function () { return cssVar('--ok'); }, duration: 0.25 }, 1.05);
  });

  // ── Signal stack: earlier cards recede as the next one lands ────────────
  var cards = $$('.signal');
  cards.forEach(function (card, i) {
    var next = cards[i + 1];
    if (!next) return;
    gsap.fromTo(card, { scale: 1, filter: 'brightness(1)' }, {
      scale: 0.94, filter: 'brightness(0.95)', ease: 'none',
      scrollTrigger: { trigger: next, start: 'top bottom', end: 'top 30%', scrub: true }
    });
  });

  // ── Previews: clip reveal + depth parallax ──────────────────────────────
  $$('[data-clip]').forEach(function (el) {
    gsap.to(el, {
      clipPath: 'inset(0% 0 0 0 round 18px)', duration: 1.4, ease: 'expo.out',
      scrollTrigger: { trigger: el, start: 'top 82%' }
    });
  });
  $$('[data-depth]').forEach(function (img) {
    var depth = parseFloat(img.getAttribute('data-depth')) || 0.08;
    gsap.fromTo(img, { yPercent: depth * 60, scale: 1.06 }, {
      yPercent: -depth * 60, scale: 1, ease: 'none',
      scrollTrigger: { trigger: img.parentNode, start: 'top bottom', end: 'bottom top', scrub: true }
    });
  });
})();
