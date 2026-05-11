// SIGNAL // Heatmap — Finviz/OpenStock-style sector treemap.
// Consumes live quotes from window.SignalMarket. Sized by hardcoded
// (slow-moving) market caps; colored by live % change.

(() => {
  // Universe with sector + approximate market cap (in $B). Caps are only used
  // for sizing — they don't need to be tick-accurate.
  const UNIVERSE = [
    // Technology
    { sym: 'AAPL',  name: 'Apple Inc.',          sector: 'Technology',    mcap: 3500 },
    { sym: 'MSFT',  name: 'Microsoft Corp.',     sector: 'Technology',    mcap: 3100 },
    { sym: 'NVDA',  name: 'NVIDIA Corp.',        sector: 'Technology',    mcap: 2800 },
    { sym: 'AVGO',  name: 'Broadcom Inc.',       sector: 'Technology',    mcap:  780 },
    { sym: 'ORCL',  name: 'Oracle Corp.',        sector: 'Technology',    mcap:  380 },
    { sym: 'CRM',   name: 'Salesforce',          sector: 'Technology',    mcap:  280 },
    { sym: 'AMD',   name: 'Adv. Micro Devices',  sector: 'Technology',    mcap:  250 },
    // Communication Services
    { sym: 'GOOGL', name: 'Alphabet Inc.',       sector: 'Communication', mcap: 2100 },
    { sym: 'META',  name: 'Meta Platforms',      sector: 'Communication', mcap: 1400 },
    { sym: 'NFLX',  name: 'Netflix, Inc.',       sector: 'Communication', mcap:  250 },
    // Consumer Cyclical
    { sym: 'AMZN',  name: 'Amazon.com',          sector: 'Consumer Cyclical', mcap: 1900 },
    { sym: 'TSLA',  name: 'Tesla, Inc.',         sector: 'Consumer Cyclical', mcap: 1100 },
    { sym: 'HD',    name: 'Home Depot',          sector: 'Consumer Cyclical', mcap:  380 },
    { sym: 'NKE',   name: 'Nike, Inc.',          sector: 'Consumer Cyclical', mcap:  110 },
    // Consumer Defensive
    { sym: 'WMT',   name: 'Walmart',             sector: 'Consumer Defensive', mcap: 700 },
    { sym: 'COST',  name: 'Costco',              sector: 'Consumer Defensive', mcap: 400 },
    { sym: 'PG',    name: 'Procter & Gamble',    sector: 'Consumer Defensive', mcap: 380 },
    { sym: 'KO',    name: 'Coca-Cola',           sector: 'Consumer Defensive', mcap: 280 },
    // Financials
    { sym: 'JPM',   name: 'JPMorgan Chase',      sector: 'Financials',    mcap: 600 },
    { sym: 'V',     name: 'Visa Inc.',           sector: 'Financials',    mcap: 540 },
    { sym: 'MA',    name: 'Mastercard',          sector: 'Financials',    mcap: 440 },
    { sym: 'BAC',   name: 'Bank of America',     sector: 'Financials',    mcap: 320 },
    // Healthcare
    { sym: 'LLY',   name: 'Eli Lilly',           sector: 'Healthcare',    mcap: 700 },
    { sym: 'UNH',   name: 'UnitedHealth',        sector: 'Healthcare',    mcap: 540 },
    { sym: 'JNJ',   name: 'Johnson & Johnson',   sector: 'Healthcare',    mcap: 420 },
    // Energy
    { sym: 'XOM',   name: 'Exxon Mobil',         sector: 'Energy',        mcap: 480 },
    { sym: 'CVX',   name: 'Chevron',             sector: 'Energy',        mcap: 290 },
    // Crypto
    { sym: 'BTC',   name: 'Bitcoin',             sector: 'Crypto',        mcap: 1600 },
  ];

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const fmtPrice = (v) => {
    if (v == null || !isFinite(v)) return '—';
    if (v >= 10000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (v >= 100)   return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (v >= 1)     return v.toFixed(2);
    return v.toFixed(4);
  };
  const fmtPct = (v) => v == null || !isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
  const fmtChg = (v) => v == null || !isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;
  const fmtVol = (v) => {
    if (v == null || !isFinite(v) || v === 0) return '—';
    if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
    return String(v);
  };
  const fmtMcap = (b) => b >= 1000 ? '$' + (b/1000).toFixed(2) + 'T' : '$' + b.toFixed(0) + 'B';

  // Diverging color scale around 0.
  function colorForPct(pct) {
    if (pct == null || !isFinite(pct)) return '#1a1a1a';
    const p = Math.max(-5, Math.min(5, pct));
    if (p > 3)   return '#00b04a';
    if (p > 1)   return '#1d7a3e';
    if (p > 0.2) return '#0e4a22';
    if (p >= -0.2) return '#1a1a1a';
    if (p > -1)  return '#3a1818';
    if (p > -3)  return '#7a1a1a';
    return '#b00020';
  }

  function textColorForBg(pct) {
    // Slightly faded text on lighter cells reads better.
    return Math.abs(pct ?? 0) >= 1 ? '#ffffff' : '#e0e0e0';
  }

  // Squarified treemap — d3 is already loaded for the geopolitical globe.
  function layout(width, height) {
    if (!window.d3) return null;
    const d3 = window.d3;
    const sectors = new Map();
    for (const inst of UNIVERSE) {
      if (!sectors.has(inst.sector)) sectors.set(inst.sector, []);
      sectors.get(inst.sector).push(inst);
    }
    const root = d3.hierarchy({
      name: 'root',
      children: [...sectors.entries()].map(([name, items]) => ({
        name,
        children: items.map(i => ({ ...i, value: i.mcap })),
      })),
    }).sum(d => d.value || 0).sort((a, b) => (b.value || 0) - (a.value || 0));

    d3.treemap()
      .size([width, height])
      .paddingOuter(2)
      .paddingTop(20)
      .paddingInner(2)
      .round(true)(root);
    return root;
  }

  function getQuote(sym) {
    return window.SignalMarket?.state?.quotes?.get(sym);
  }

  let popupTarget = null;

  function render() {
    const stage = document.getElementById('hm-stage');
    const svg = document.getElementById('hm-svg');
    const empty = document.getElementById('hm-empty');
    if (!stage || !svg) return;
    const rect = stage.getBoundingClientRect();
    const w = Math.floor(rect.width);
    const h = Math.floor(rect.height);
    if (w < 50 || h < 50) return;

    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('width', w);
    svg.setAttribute('height', h);

    const root = layout(w, h);
    if (!root) {
      empty.textContent = 'D3 not loaded.';
      return;
    }

    // Are any quotes available yet?
    const haveData = UNIVERSE.some(u => getQuote(u.sym));
    empty.style.display = haveData ? 'none' : '';

    const sectors = root.children || [];
    const pieces = [];

    // Sector titles + cells
    for (const sec of sectors) {
      const x = sec.x0, y = sec.y0;
      const sw = sec.x1 - sec.x0, sh = sec.y1 - sec.y0;
      pieces.push(`<g class="hm-sector">
        <text class="hm-sector-label" x="${x + 4}" y="${y + 14}">${esc(sec.data.name)}</text>
      </g>`);

      const leaves = sec.children || [];
      for (const leaf of leaves) {
        const lx = leaf.x0, ly = leaf.y0;
        const lw = leaf.x1 - leaf.x0, lh = leaf.y1 - leaf.y0;
        if (lw < 4 || lh < 4) continue;
        const q = getQuote(leaf.data.sym);
        const pct = q?.pct;
        const fill = colorForPct(pct);
        const txt = textColorForBg(pct);
        // Font sizing based on box size
        const symFs = Math.max(10, Math.min(28, Math.min(lw, lh) * 0.28));
        const pctFs = Math.max(8,  Math.min(18, Math.min(lw, lh) * 0.18));
        const showPct = lh > 38 && lw > 36;
        const cx = lx + lw / 2;
        const cy = ly + lh / 2;
        const symY = showPct ? cy - 2 : cy + symFs * 0.35;
        const pctY = cy + symFs * 0.55;
        pieces.push(`<g class="hm-cell" data-sym="${esc(leaf.data.sym)}">
          <rect class="hm-cell-rect" x="${lx}" y="${ly}" width="${lw}" height="${lh}" fill="${fill}"></rect>
          <text class="hm-cell-sym" x="${cx}" y="${symY}" fill="${txt}" font-size="${symFs}">${esc(leaf.data.sym)}</text>
          ${showPct ? `<text class="hm-cell-pct" x="${cx}" y="${pctY}" fill="${txt}" font-size="${pctFs}">${esc(fmtPct(pct))}</text>` : ''}
        </g>`);
      }
    }

    svg.innerHTML = pieces.join('');
    // Wire up clicks
    svg.querySelectorAll('.hm-cell').forEach(g => {
      g.addEventListener('click', (e) => showPopup(g.dataset.sym, e));
    });
    // Tooltip-style popup also on hover for desktops
    svg.querySelectorAll('.hm-cell').forEach(g => {
      g.addEventListener('mousemove', (e) => showPopup(g.dataset.sym, e));
      g.addEventListener('mouseleave', () => hidePopup(g.dataset.sym));
    });

    // Update the "UPDATED" label
    const ts = window.SignalMarket?.state?.lastUpdate;
    const up = document.getElementById('hm-updated');
    if (up && ts) {
      const t = ts;
      up.textContent = `${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}:${String(t.getSeconds()).padStart(2,'0')}`;
    }
  }

  function showPopup(sym, evt) {
    const inst = UNIVERSE.find(u => u.sym === sym);
    const q = getQuote(sym);
    const pop = document.getElementById('hm-popup');
    const stage = document.getElementById('hm-stage');
    if (!pop || !inst || !stage) return;
    popupTarget = sym;
    const cls = (q?.pct ?? 0) >= 0 ? 'up' : 'dn';
    pop.innerHTML = `
      <div class="pop-h">${esc(sym)}</div>
      <div class="pop-name">${esc(inst.name)} · ${esc(inst.sector)}</div>
      <div class="pop-row"><span class="pop-k">LAST</span><span class="pop-v">${fmtPrice(q?.last)}</span></div>
      <div class="pop-row"><span class="pop-k">CHANGE</span><span class="pop-v ${cls}">${fmtChg(q?.chg)}  (${fmtPct(q?.pct)})</span></div>
      <div class="pop-divider"></div>
      <div class="pop-row"><span class="pop-k">DAY HIGH</span><span class="pop-v up">${fmtPrice(q?.high)}</span></div>
      <div class="pop-row"><span class="pop-k">DAY LOW</span><span class="pop-v dn">${fmtPrice(q?.low)}</span></div>
      <div class="pop-row"><span class="pop-k">VOLUME</span><span class="pop-v">${fmtVol(q?.vol)}</span></div>
      <div class="pop-row"><span class="pop-k">MKT CAP</span><span class="pop-v">${fmtMcap(inst.mcap)}</span></div>
    `;
    pop.hidden = false;

    // Position near cursor, clamped within stage
    const stageRect = stage.getBoundingClientRect();
    const px = (evt?.clientX ?? stageRect.left) - stageRect.left + 14;
    const py = (evt?.clientY ?? stageRect.top)  - stageRect.top  + 14;
    const popW = pop.offsetWidth, popH = pop.offsetHeight;
    const maxX = stage.clientWidth  - popW - 6;
    const maxY = stage.clientHeight - popH - 6;
    pop.style.left = Math.max(6, Math.min(px, maxX)) + 'px';
    pop.style.top  = Math.max(6, Math.min(py, maxY)) + 'px';
  }

  function hidePopup(sym) {
    if (popupTarget && popupTarget !== sym) return;
    const pop = document.getElementById('hm-popup');
    if (pop) pop.hidden = true;
    popupTarget = null;
  }

  let started = false;
  let resizeRaf = null;
  function start() {
    if (started) return;
    started = true;
    render();
    window.addEventListener('signal:quotes', render);
    window.addEventListener('resize', () => {
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(render);
    });
    // Heatmap auto-refresh — independent 60s tick on top of the shared cache.
    setInterval(() => {
      window.SignalMarket?.refresh?.();
    }, 60 * 1000);
  }

  function onTabChange() {
    const active = document.querySelector('.tab-panel.active');
    const isHm = active && active.dataset.panel === 'heatmap';
    document.body.classList.toggle('heatmap-mode', !!isHm);
    if (isHm) {
      start();
      // First time DOM is laid out, render after a frame.
      requestAnimationFrame(render);
    }
  }
  document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => setTimeout(onTabChange, 40)));
  window.addEventListener('hashchange', () => setTimeout(onTabChange, 40));
  setTimeout(onTabChange, 120);
})();
