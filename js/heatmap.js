// SIGNAL // Heatmap tab — TradingView heatmap is embedded as an iframe; this
// module only drives the right-hand market-overview sidebar (NQ/ES/BTC tiles
// + a compact news feed).

(() => {
  const TILE_SYMS = ['NQ', 'ES', 'BTC'];

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const fmtPrice = (v) => {
    if (v == null || !isFinite(v)) return '—';
    if (v >= 10000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (v >= 100)   return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (v >= 1)     return v.toFixed(2);
    return v.toFixed(4);
  };
  const fmtChg = (v) => v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2);
  const fmtPct = (v) => v == null || !isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
  const fmtRel = (d) => {
    const s = Math.floor((Date.now() - d.getTime()) / 1000);
    if (s < 60) return `${s}S AGO`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}M AGO`;
    return `${Math.floor(m / 60)}H AGO`;
  };

  function renderTiles() {
    const quotes = window.SignalMarket?.state?.quotes;
    if (!quotes) return;
    for (const sym of TILE_SYMS) {
      const q = quotes.get(sym);
      const tile = document.querySelector(`.hm-tile[data-sym="${sym}"]`);
      const pxEl  = document.getElementById(`hm-px-${sym}`);
      const chgEl = document.getElementById(`hm-chg-${sym}`);
      if (!tile || !pxEl || !chgEl) continue;
      pxEl.textContent  = fmtPrice(q?.last);
      chgEl.textContent = `${fmtChg(q?.chg)}  (${fmtPct(q?.pct)})`;
      tile.classList.remove('up', 'dn');
      if (q?.pct != null) tile.classList.add(q.pct >= 0 ? 'up' : 'dn');
    }
    const ts = window.SignalMarket?.state?.lastUpdate;
    const up = document.getElementById('hm-updated');
    if (up && ts) {
      up.textContent = `${String(ts.getHours()).padStart(2,'0')}:${String(ts.getMinutes()).padStart(2,'0')}:${String(ts.getSeconds()).padStart(2,'0')}`;
    }
  }

  function renderNews() {
    const news = (window.SignalMarket?.state?.news) || [];
    const el = document.getElementById('hm-news');
    const count = document.getElementById('hm-news-count');
    if (!el) return;
    const items = news.slice(0, 5);
    if (count) count.textContent = `${items.length} LATEST`;
    if (!items.length) {
      el.innerHTML = `<div class="hm-news-item" style="cursor:default;color:#707070;">Loading headlines…</div>`;
      return;
    }
    el.innerHTML = items.map(n => `
      <div class="hm-news-item" data-url="${esc(n.link)}">
        <div class="hm-news-meta">
          <span class="hm-news-src">${esc(n.source || 'WIRE')}</span>
          <span class="hm-news-time">${esc(fmtRel(n.time))}</span>
        </div>
        <div class="hm-news-title">${esc(n.title)}</div>
      </div>
    `).join('');
    el.querySelectorAll('.hm-news-item').forEach(it => {
      it.addEventListener('click', () => {
        if (it.dataset.url) window.open(it.dataset.url, '_blank', 'noopener');
      });
    });
  }

  function renderAll() {
    renderTiles();
    renderNews();
  }

  window.addEventListener('signal:quotes', renderAll);
  window.addEventListener('signal:news', renderNews);
  // Re-tick relative ages every 30s
  setInterval(renderNews, 30 * 1000);

  function onTabChange() {
    const active = document.querySelector('.tab-panel.active');
    const isHm = active && active.dataset.panel === 'heatmap';
    document.body.classList.toggle('heatmap-mode', !!isHm);
    if (isHm) renderAll();
  }
  document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => setTimeout(onTabChange, 40)));
  window.addEventListener('hashchange', () => setTimeout(onTabChange, 40));
  setTimeout(() => { onTabChange(); renderAll(); }, 200);
})();
