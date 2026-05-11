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

  window.addEventListener('signal:quotes', render);
  // First paint when the page is ready — and again a few seconds in, in case
  // data arrives during paint.
  if (document.readyState !== 'loading') render();
  document.addEventListener('DOMContentLoaded', render);
  setTimeout(render, 1500);
  setTimeout(render, 4000);
})();
