// SIGNAL // Native S&P 500 sector heatmap.
// Treemap built on top of d3.hierarchy + d3.treemap. Quotes come from the
// shared SignalMarket pipeline (Yahoo via CORS proxy, 15s refresh).

(() => {
  // Approximate market caps in $B — used only for tile sizing. Live %
  // change drives the colour, and the click popup pulls live last/vol/H/L
  // from the SignalMarket cache so values stay current.
  const STOCKS = [
    // Technology
    { sym:'AAPL',  name:'Apple',           sector:'Technology', mcap:3500, domain:'apple.com' },
    { sym:'MSFT',  name:'Microsoft',       sector:'Technology', mcap:3200, domain:'microsoft.com' },
    { sym:'NVDA',  name:'NVIDIA',          sector:'Technology', mcap:3300, domain:'nvidia.com' },
    { sym:'AVGO',  name:'Broadcom',        sector:'Technology', mcap:780,  domain:'broadcom.com' },
    { sym:'ORCL',  name:'Oracle',          sector:'Technology', mcap:480,  domain:'oracle.com' },
    { sym:'CRM',   name:'Salesforce',      sector:'Technology', mcap:290,  domain:'salesforce.com' },
    { sym:'ADBE',  name:'Adobe',           sector:'Technology', mcap:230,  domain:'adobe.com' },
    { sym:'AMD',   name:'AMD',             sector:'Technology', mcap:230,  domain:'amd.com' },
    { sym:'CSCO',  name:'Cisco',           sector:'Technology', mcap:230,  domain:'cisco.com' },
    { sym:'ACN',   name:'Accenture',       sector:'Technology', mcap:200,  domain:'accenture.com' },
    { sym:'NOW',   name:'ServiceNow',      sector:'Technology', mcap:200,  domain:'servicenow.com' },
    { sym:'IBM',   name:'IBM',             sector:'Technology', mcap:200,  domain:'ibm.com' },
    { sym:'QCOM',  name:'Qualcomm',        sector:'Technology', mcap:180,  domain:'qualcomm.com' },
    { sym:'INTU',  name:'Intuit',          sector:'Technology', mcap:175,  domain:'intuit.com' },
    { sym:'TXN',   name:'Texas Instr.',    sector:'Technology', mcap:175,  domain:'ti.com' },
    { sym:'AMAT',  name:'Applied Mat.',    sector:'Technology', mcap:160,  domain:'appliedmaterials.com' },
    { sym:'MU',    name:'Micron',          sector:'Technology', mcap:140,  domain:'micron.com' },
    { sym:'INTC',  name:'Intel',           sector:'Technology', mcap:130,  domain:'intel.com' },
    { sym:'PANW',  name:'Palo Alto',       sector:'Technology', mcap:130,  domain:'paloaltonetworks.com' },
    { sym:'ANET',  name:'Arista',          sector:'Technology', mcap:130,  domain:'arista.com' },
    // Communications
    { sym:'GOOGL', name:'Alphabet',        sector:'Communications', mcap:2100, domain:'google.com' },
    { sym:'META',  name:'Meta',            sector:'Communications', mcap:1500, domain:'meta.com' },
    { sym:'NFLX',  name:'Netflix',         sector:'Communications', mcap:300,  domain:'netflix.com' },
    { sym:'TMUS',  name:'T-Mobile',        sector:'Communications', mcap:240,  domain:'t-mobile.com' },
    { sym:'DIS',   name:'Disney',          sector:'Communications', mcap:180,  domain:'disney.com' },
    { sym:'VZ',    name:'Verizon',         sector:'Communications', mcap:170,  domain:'verizon.com' },
    { sym:'CMCSA', name:'Comcast',         sector:'Communications', mcap:170,  domain:'comcast.com' },
    { sym:'T',     name:'AT&T',            sector:'Communications', mcap:140,  domain:'att.com' },
    // Consumer Discretionary
    { sym:'AMZN',  name:'Amazon',          sector:'Consumer Disc.', mcap:2000, domain:'amazon.com' },
    { sym:'TSLA',  name:'Tesla',           sector:'Consumer Disc.', mcap:900,  domain:'tesla.com' },
    { sym:'HD',    name:'Home Depot',      sector:'Consumer Disc.', mcap:400,  domain:'homedepot.com' },
    { sym:'MCD',   name:'McDonald’s',      sector:'Consumer Disc.', mcap:210,  domain:'mcdonalds.com' },
    { sym:'BKNG',  name:'Booking',         sector:'Consumer Disc.', mcap:160,  domain:'booking.com' },
    { sym:'LOW',   name:'Lowe’s',          sector:'Consumer Disc.', mcap:140,  domain:'lowes.com' },
    { sym:'TJX',   name:'TJX',             sector:'Consumer Disc.', mcap:140,  domain:'tjx.com' },
    { sym:'NKE',   name:'Nike',            sector:'Consumer Disc.', mcap:120,  domain:'nike.com' },
    { sym:'SBUX',  name:'Starbucks',       sector:'Consumer Disc.', mcap:100,  domain:'starbucks.com' },
    // Financials
    { sym:'JPM',   name:'JPMorgan',        sector:'Financials', mcap:700, domain:'jpmorganchase.com' },
    { sym:'V',     name:'Visa',            sector:'Financials', mcap:580, domain:'visa.com' },
    { sym:'MA',    name:'Mastercard',      sector:'Financials', mcap:470, domain:'mastercard.com' },
    { sym:'BAC',   name:'Bank of America', sector:'Financials', mcap:340, domain:'bankofamerica.com' },
    { sym:'WFC',   name:'Wells Fargo',     sector:'Financials', mcap:240, domain:'wellsfargo.com' },
    { sym:'AXP',   name:'American Express',sector:'Financials', mcap:200, domain:'americanexpress.com' },
    { sym:'MS',    name:'Morgan Stanley',  sector:'Financials', mcap:180, domain:'morganstanley.com' },
    { sym:'GS',    name:'Goldman Sachs',   sector:'Financials', mcap:170, domain:'goldmansachs.com' },
    { sym:'SPGI',  name:'S&P Global',      sector:'Financials', mcap:150, domain:'spglobal.com' },
    { sym:'BLK',   name:'BlackRock',       sector:'Financials', mcap:150, domain:'blackrock.com' },
    { sym:'SCHW',  name:'Schwab',          sector:'Financials', mcap:140, domain:'schwab.com' },
    { sym:'C',     name:'Citigroup',       sector:'Financials', mcap:130, domain:'citigroup.com' },
    // Healthcare
    { sym:'LLY',   name:'Eli Lilly',       sector:'Healthcare', mcap:700, domain:'lilly.com' },
    { sym:'UNH',   name:'UnitedHealth',    sector:'Healthcare', mcap:520, domain:'unitedhealthgroup.com' },
    { sym:'JNJ',   name:'J&J',             sector:'Healthcare', mcap:380, domain:'jnj.com' },
    { sym:'ABBV',  name:'AbbVie',          sector:'Healthcare', mcap:310, domain:'abbvie.com' },
    { sym:'MRK',   name:'Merck',           sector:'Healthcare', mcap:260, domain:'merck.com' },
    { sym:'TMO',   name:'Thermo Fisher',   sector:'Healthcare', mcap:210, domain:'thermofisher.com' },
    { sym:'ABT',   name:'Abbott',          sector:'Healthcare', mcap:200, domain:'abbott.com' },
    { sym:'DHR',   name:'Danaher',         sector:'Healthcare', mcap:180, domain:'danaher.com' },
    { sym:'ISRG',  name:'Intuitive',       sector:'Healthcare', mcap:170, domain:'intuitive.com' },
    { sym:'AMGN',  name:'Amgen',           sector:'Healthcare', mcap:170, domain:'amgen.com' },
    { sym:'PFE',   name:'Pfizer',          sector:'Healthcare', mcap:170, domain:'pfizer.com' },
    { sym:'BMY',   name:'Bristol-Myers',   sector:'Healthcare', mcap:120, domain:'bms.com' },
    // Staples
    { sym:'WMT',   name:'Walmart',         sector:'Staples', mcap:540, domain:'walmart.com' },
    { sym:'COST',  name:'Costco',          sector:'Staples', mcap:400, domain:'costco.com' },
    { sym:'PG',    name:'P&G',             sector:'Staples', mcap:380, domain:'pg.com' },
    { sym:'KO',    name:'Coca-Cola',       sector:'Staples', mcap:290, domain:'coca-cola.com' },
    { sym:'PEP',   name:'Pepsi',           sector:'Staples', mcap:230, domain:'pepsico.com' },
    { sym:'PM',    name:'Philip Morris',   sector:'Staples', mcap:170, domain:'pmi.com' },
    { sym:'MO',    name:'Altria',          sector:'Staples', mcap:90,  domain:'altria.com' },
    // Energy
    { sym:'XOM',   name:'Exxon Mobil',     sector:'Energy', mcap:480, domain:'exxonmobil.com' },
    { sym:'CVX',   name:'Chevron',         sector:'Energy', mcap:280, domain:'chevron.com' },
    { sym:'COP',   name:'ConocoPhillips',  sector:'Energy', mcap:130, domain:'conocophillips.com' },
    // Industrials
    { sym:'GE',    name:'GE Aerospace',    sector:'Industrials', mcap:200, domain:'geaerospace.com' },
    { sym:'CAT',   name:'Caterpillar',     sector:'Industrials', mcap:175, domain:'caterpillar.com' },
    { sym:'RTX',   name:'RTX',             sector:'Industrials', mcap:170, domain:'rtx.com' },
    { sym:'UNP',   name:'Union Pacific',   sector:'Industrials', mcap:150, domain:'up.com' },
    { sym:'HON',   name:'Honeywell',       sector:'Industrials', mcap:140, domain:'honeywell.com' },
    { sym:'LMT',   name:'Lockheed',        sector:'Industrials', mcap:130, domain:'lockheedmartin.com' },
    { sym:'BA',    name:'Boeing',          sector:'Industrials', mcap:120, domain:'boeing.com' },
    { sym:'UPS',   name:'UPS',             sector:'Industrials', mcap:120, domain:'ups.com' },
    // Materials / Utilities / Real Estate
    { sym:'LIN',   name:'Linde',           sector:'Materials',   mcap:220, domain:'linde.com' },
    { sym:'SHW',   name:'Sherwin-Wms',     sector:'Materials',   mcap:90,  domain:'sherwin-williams.com' },
    { sym:'NEE',   name:'NextEra',         sector:'Utilities',   mcap:160, domain:'nexteraenergy.com' },
    { sym:'SO',    name:'Southern Co',     sector:'Utilities',   mcap:100, domain:'southerncompany.com' },
    { sym:'PLD',   name:'Prologis',        sector:'Real Estate', mcap:120, domain:'prologis.com' },
    { sym:'AMT',   name:'American Tower',  sector:'Real Estate', mcap:100, domain:'americantower.com' },
  ];

  const SECTOR_ORDER = [
    'Technology','Communications','Consumer Disc.','Financials',
    'Healthcare','Staples','Energy','Industrials',
    'Materials','Utilities','Real Estate',
  ];
  const BY_SYM = new Map(STOCKS.map(s => [s.sym, s]));

  // --------- helpers ---------
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const fmtPct = (v) => v == null || !isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
  const fmtPrice = (v) => {
    if (v == null || !isFinite(v)) return '—';
    if (v >= 10000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (v >= 100)   return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (v >= 1)     return v.toFixed(2);
    return v.toFixed(4);
  };
  const fmtVol = (v) => {
    if (v == null || !isFinite(v) || v === 0) return '—';
    if (v >= 1e9) return (v/1e9).toFixed(2)+'B';
    if (v >= 1e6) return (v/1e6).toFixed(2)+'M';
    if (v >= 1e3) return (v/1e3).toFixed(1)+'K';
    return String(v);
  };
  const fmtMcap = (b) => b >= 1000 ? `$${(b/1000).toFixed(2)}T` : `$${b.toFixed(0)}B`;

  // Piecewise lerp through bright→dark green, near-flat, dark→bright red.
  // Anchors at ±0.5% (slight) and ±2.5% (strong) for a punchy gradient.
  const stops = [
    [-3.0, [255, 58, 74]],   // bright red
    [-1.5, [150, 36, 48]],   // medium red
    [-0.5, [60, 18, 24]],    // dark red
    [ 0.0, [22, 22, 22]],    // flat
    [ 0.5, [14, 56, 36]],    // dark green
    [ 1.5, [22, 130, 78]],   // medium green
    [ 3.0, [25, 210, 122]],  // bright green
  ];
  function colorFor(pct) {
    if (pct == null || !isFinite(pct)) return 'rgb(28,28,28)';
    const p = Math.max(stops[0][0], Math.min(stops[stops.length-1][0], pct));
    for (let i = 0; i < stops.length - 1; i++) {
      const [pa, ca] = stops[i], [pb, cb] = stops[i+1];
      if (p <= pb) {
        const t = (p - pa) / (pb - pa || 1);
        return `rgb(${Math.round(ca[0]+(cb[0]-ca[0])*t)},${Math.round(ca[1]+(cb[1]-ca[1])*t)},${Math.round(ca[2]+(cb[2]-ca[2])*t)})`;
      }
    }
    return `rgb(${stops[stops.length-1][1].join(',')})`;
  }

  // Pick a foreground (white or near-black) that contrasts with the tile.
  function textOn(rgbStr) {
    const m = rgbStr.match(/\d+/g);
    if (!m) return '#fff';
    const [r,g,b] = m.map(Number);
    const lum = (0.299*r + 0.587*g + 0.114*b) / 255;
    return lum > 0.55 ? '#0a0a0a' : '#ffffff';
  }

  // --------- render ---------
  let container, popup, ro, queued = false;

  function getQuote(sym) {
    return window.SignalMarket?.state?.quotes?.get(sym) || null;
  }

  function build() {
    if (!container) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h || typeof d3 === 'undefined') return;

    // Group stocks by sector preserving SECTOR_ORDER, drop empty sectors.
    const grouped = SECTOR_ORDER
      .map(name => ({ name, children: STOCKS.filter(s => s.sector === name) }))
      .filter(g => g.children.length);

    const root = d3.hierarchy({ name: 'root', children: grouped })
      .sum(d => d.mcap || 0)
      .sort((a, b) => (b.value || 0) - (a.value || 0));

    const HEADER = 18;
    d3.treemap()
      .tile(d3.treemapSquarify.ratio(1))
      .size([w, h])
      .paddingOuter(0)
      .paddingTop(HEADER)
      .paddingInner(2)
      .round(true)(root);

    const frag = document.createDocumentFragment();
    for (const sector of root.children) {
      const sx = sector.x0, sy = sector.y0;
      const sw = sector.x1 - sector.x0, sh = sector.y1 - sector.y0;
      if (sw < 4 || sh < HEADER + 6) continue;

      const head = document.createElement('div');
      head.className = 'hm-sec-head';
      head.style.cssText = `left:${sx}px;top:${sy}px;width:${sw}px;height:${HEADER}px;`;
      head.innerHTML = `<span class="hm-sec-name">${esc(sector.data.name).toUpperCase()}</span>`;
      frag.appendChild(head);

      for (const leaf of (sector.children || [])) {
        const lx = leaf.x0, ly = leaf.y0;
        const lw = leaf.x1 - leaf.x0, lh = leaf.y1 - leaf.y0;
        if (lw < 2 || lh < 2) continue;
        const d = leaf.data;
        const q = getQuote(d.sym);
        const pct = q?.pct;
        const bg = colorFor(pct);
        const fg = textOn(bg);

        const tile = document.createElement('button');
        tile.className = 'hm-tile-grid';
        tile.dataset.sym = d.sym;
        tile.style.cssText = `left:${lx}px;top:${ly}px;width:${lw}px;height:${lh}px;background:${bg};color:${fg};`;

        // Density depends on tile size:
        //   tiny → ticker only
        //   small/medium → ticker + %
        //   large enough → logo + ticker + %
        const showPct = lh >= 28 && lw >= 36;
        const big = lw >= 90 && lh >= 60;
        const showLogo = lw >= 70 && lh >= 70 && d.domain;
        const logoSize = lh >= 110 && lw >= 110 ? 38 : 28;
        // Clearbit's free logo endpoint was deprecated; Google's s2 favicon
        // service is the most reliable in-browser replacement. Fall back to
        // DuckDuckGo's icon service, then drop the img entirely if both fail.
        const logoHtml = showLogo
          ? `<img class="hm-tg-logo" alt="" width="${logoSize}" height="${logoSize}" loading="lazy" referrerpolicy="no-referrer"
                  src="https://www.google.com/s2/favicons?domain=${esc(d.domain)}&sz=64"
                  data-fallback="https://icons.duckduckgo.com/ip3/${esc(d.domain)}.ico"
                  onerror="if(this.dataset.fallback){this.src=this.dataset.fallback;this.dataset.fallback='';}else{this.remove();}"/>`
          : '';
        tile.innerHTML = big
          ? `${logoHtml}<div class="hm-tg-sym">${esc(d.sym)}</div><div class="hm-tg-pct">${esc(fmtPct(pct))}</div>`
          : showPct
            ? `<div class="hm-tg-sym sm">${esc(d.sym)}</div><div class="hm-tg-pct sm">${esc(fmtPct(pct))}</div>`
            : `<div class="hm-tg-sym tiny">${esc(d.sym)}</div>`;
        frag.appendChild(tile);
      }
    }

    // Atomic swap.
    container.replaceChildren(frag);

    // Update last-tick stamp in the top bar.
    const ts = window.SignalMarket?.state?.lastUpdate;
    const up = document.getElementById('hm-updated');
    if (up && ts) {
      up.textContent = `${String(ts.getHours()).padStart(2,'0')}:${String(ts.getMinutes()).padStart(2,'0')}:${String(ts.getSeconds()).padStart(2,'0')}`;
    }
  }

  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; build(); });
  }

  // --------- popup ---------
  function openDetail(sym) {
    const meta = BY_SYM.get(sym);
    const q = getQuote(sym);
    if (!popup || !meta) return;
    const pct = q?.pct;
    const accent = colorFor(pct);
    const cls = pct >= 0 ? 'up' : pct < 0 ? 'dn' : '';
    popup.className = `hm-detail show ${cls}`;
    popup.style.setProperty('--hm-accent', accent);
    popup.innerHTML = `
      <div class="hm-detail-card">
        <button class="hm-detail-close" aria-label="Close">×</button>
        <div class="hm-detail-head">
          <div class="hm-detail-sym">${esc(sym)}</div>
          <div class="hm-detail-name">${esc(meta.name)} · ${esc(meta.sector).toUpperCase()}</div>
        </div>
        <div class="hm-detail-price">${esc(fmtPrice(q?.last))}</div>
        <div class="hm-detail-chg">${esc(fmtPct(pct))} TODAY</div>
        <div class="hm-detail-grid">
          <div><span>DAY HIGH</span><strong>${esc(fmtPrice(q?.high))}</strong></div>
          <div><span>DAY LOW</span><strong>${esc(fmtPrice(q?.low))}</strong></div>
          <div><span>VOLUME</span><strong>${esc(fmtVol(q?.vol))}</strong></div>
          <div><span>MKT CAP</span><strong>${esc(fmtMcap(meta.mcap))}</strong></div>
        </div>
      </div>
    `;
    popup.querySelector('.hm-detail-close').addEventListener('click', closeDetail);
  }
  function closeDetail() {
    if (popup) popup.classList.remove('show');
  }

  // --------- wire-up ---------
  function init() {
    container = document.getElementById('hm-treemap');
    popup = document.getElementById('hm-detail');
    if (!container) return;

    container.addEventListener('click', (ev) => {
      const t = ev.target.closest('.hm-tile-grid');
      if (t && t.dataset.sym) openDetail(t.dataset.sym);
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') closeDetail();
    });
    if (popup) {
      // Click outside the card closes it (the popup element is its own backdrop).
      popup.addEventListener('click', (ev) => { if (ev.target === popup) closeDetail(); });
    }

    if (window.ResizeObserver) {
      ro = new ResizeObserver(schedule);
      ro.observe(container);
    } else {
      window.addEventListener('resize', schedule);
    }

    window.addEventListener('signal:quotes', schedule);

    // First paint may happen before SignalMarket has any quotes — render
    // the layout with flat colours immediately, then re-render when data
    // arrives.
    schedule();

    // Belt-and-braces 60s tick in case the broader pipeline ever stalls.
    setInterval(schedule, 60 * 1000);
  }

  function onTabChange() {
    const active = document.querySelector('.tab-panel.active');
    const isHm = active && active.dataset.panel === 'heatmap';
    document.body.classList.toggle('heatmap-mode', !!isHm);
    if (isHm) schedule();
  }
  document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => setTimeout(onTabChange, 40)));
  window.addEventListener('hashchange', () => setTimeout(onTabChange, 40));

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { init(); setTimeout(onTabChange, 50); });
  } else {
    init();
    setTimeout(onTabChange, 50);
  }
})();
