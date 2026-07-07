// Global scrolling ticker tape — renders the watchlist + BTC across the very
// top of the app on every tab. Consumes shared market data from
// window.SignalMarket and re-renders whenever fresh quotes arrive.

(() => {
  const TRACK_ID = 'global-ticker-track';

  const fmtPrice = (v) => {
    if (v == null || !isFinite(v)) return '—';
    if (v >= 10000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (v >= 100)   return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (v >= 1)     return v.toFixed(2);
    return v.toFixed(4);
  };
  const fmtPct = (v) => v == null || !isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

  function buildSegment(quotes, symbols) {
    const out = [];
    for (const sym of symbols) {
      const q = quotes.get(sym);
      if (!q || q.last == null) continue;
      const upDown = (q.pct ?? 0) >= 0;
      const cls = upDown ? 'gt-up' : 'gt-dn';
      const arrow = upDown ? '▲' : '▼';
      out.push(
        `<span class="gt-item">` +
          `<span class="gt-sym">${esc(sym)}</span>` +
          `<span class="gt-px">${fmtPrice(q.last)}</span>` +
          `<span class="${cls}"><span class="gt-arrow">${arrow}</span> ${fmtPct(q.pct)}</span>` +
        `</span><span class="gt-bar">|</span>`
      );
    }
    return out.join('');
  }

  function renderSkeleton(el) {
    const chip = `<span class="gt-item">
        <span class="gt-sym"><span class="skel" style="width:34px"></span></span>
        <span class="gt-px"><span class="skel" style="width:52px"></span></span>
        <span class="skel" style="width:46px"></span>
      </span><span class="gt-bar">|</span>`;
    el.innerHTML = chip.repeat(10);
  }

  function render() {
    const mkt = window.SignalMarket;
    const el = document.getElementById(TRACK_ID);
    if (!el || !mkt) return;
    const quotes = mkt.state?.quotes;
    if (!quotes || quotes.size === 0) { renderSkeleton(el); return; }

    // Symbol order: futures, stocks, crypto.
    const order = [
      ...(mkt.FUTURES || []).map(f => f.sym),
      ...(mkt.STOCKS  || []).map(s => s.sym),
      ...(mkt.CRYPTO  || []).map(c => c.sym),
    ];
    const segment = buildSegment(quotes, order);
    if (!segment) { renderSkeleton(el); return; }
    // Duplicate the segment so the marquee can wrap seamlessly.
    el.innerHTML = segment + segment;
  }

  // ---------------------------------------------------------------------
  // JS-driven marquee: pixels-per-second is constant regardless of how many
  // symbols are on the wire, so the scroll speed feels even. The user can
  // also drag/swipe horizontally to scrub through the ticker; releasing
  // resumes auto-scroll from wherever they left it.
  // ---------------------------------------------------------------------
  const SCROLL_PX_PER_SEC = 110;   // baseline speed — a touch quicker than before
  let offset = 0;                  // px the track has been scrolled to the left
  let halfWidth = 0;               // width of one copy of the segment
  let lastFrame = 0;
  let paused = false;              // user is actively dragging
  let dragVelocity = 0;            // px/ms residual fling after release
  let dragLastX = 0, dragLastT = 0;
  let pointerActive = false;

  function applyTransform() {
    const el = document.getElementById(TRACK_ID);
    if (!el) return;
    el.style.transform = `translate3d(${-offset}px, 0, 0)`;
  }

  function measure() {
    const el = document.getElementById(TRACK_ID);
    if (!el) return;
    // Track holds two copies of the segment; the loop length is half the total.
    halfWidth = el.scrollWidth / 2 || 0;
    if (halfWidth > 0) offset = ((offset % halfWidth) + halfWidth) % halfWidth;
  }

  function tick(now) {
    if (!lastFrame) lastFrame = now;
    const dt = Math.min(50, now - lastFrame); // clamp huge frame gaps on tab return
    lastFrame = now;
    if (halfWidth > 0) {
      if (paused) {
        // hold position
      } else if (Math.abs(dragVelocity) > 0.02) {
        // Apply fling momentum, decaying over ~600ms.
        offset += dragVelocity * dt;
        dragVelocity *= Math.pow(0.0035, dt / 1000); // exp decay
      } else {
        offset += (SCROLL_PX_PER_SEC * dt) / 1000;
      }
      // Wrap so we can scroll forwards or backwards indefinitely.
      offset = ((offset % halfWidth) + halfWidth) % halfWidth;
      applyTransform();
    }
    requestAnimationFrame(tick);
  }

  function bindDrag() {
    const host = document.getElementById('global-ticker');
    if (!host || host.dataset.dragBound) return;
    host.dataset.dragBound = '1';

    const onDown = (ev) => {
      pointerActive = true;
      paused = true;
      dragVelocity = 0;
      dragLastX = ev.clientX;
      dragLastT = performance.now();
      host.classList.add('is-dragging');
      try { host.setPointerCapture(ev.pointerId); } catch {}
    };
    const onMove = (ev) => {
      if (!pointerActive) return;
      const now = performance.now();
      const dx = ev.clientX - dragLastX;
      const dt = Math.max(1, now - dragLastT);
      // Drag right → reveal items to the left (scroll backwards).
      offset -= dx;
      dragVelocity = -dx / dt; // px per ms
      dragLastX = ev.clientX;
      dragLastT = now;
      if (halfWidth > 0) {
        offset = ((offset % halfWidth) + halfWidth) % halfWidth;
        applyTransform();
      }
      ev.preventDefault();
    };
    const onUp = (ev) => {
      if (!pointerActive) return;
      pointerActive = false;
      paused = false;
      host.classList.remove('is-dragging');
      try { host.releasePointerCapture(ev.pointerId); } catch {}
    };

    host.addEventListener('pointerdown', onDown);
    host.addEventListener('pointermove', onMove, { passive: false });
    host.addEventListener('pointerup', onUp);
    host.addEventListener('pointercancel', onUp);
    host.addEventListener('pointerleave', onUp);
  }

  // Re-measure after every render (content changes width) and on resize.
  const renderAndMeasure = () => {
    render();
    requestAnimationFrame(measure);
  };

  window.addEventListener('signal:quotes', renderAndMeasure);
  // If quotes keep failing and we have nothing to show, say so — never an
  // endless skeleton.
  window.addEventListener('signal:quotes-error', (ev) => {
    const el = document.getElementById(TRACK_ID);
    const quotes = window.SignalMarket?.state?.quotes;
    if (el && (!quotes || quotes.size === 0) && (ev.detail?.fails || 0) >= 2) {
      el.innerHTML = '<span class="gt-loading">MARKET DATA OFFLINE — RECONNECTING…</span>';
    }
  });
  window.addEventListener('resize', measure);

  if (document.readyState !== 'loading') { renderAndMeasure(); bindDrag(); }
  document.addEventListener('DOMContentLoaded', () => { renderAndMeasure(); bindDrag(); });
  setTimeout(renderAndMeasure, 1500);
  setTimeout(renderAndMeasure, 4000);
  requestAnimationFrame(tick);
})();
