// SIGNAL // Terminal — CRT Bloomberg-style command line interface.
// Data: Yahoo Finance (stocks/futures/indexes) via allorigins proxy,
//       CoinGecko (BTC) direct + proxy fallback, RSS news pipeline.

(() => {
  const CFG = window.SIGNAL_CONFIG || {};
  // Free CORS proxies — both rate-limit aggressively; we tolerate partial
  // batch failures by keeping state.quotes from the prior successful cycle.
  const PROXIES = [
    'https://api.allorigins.win/raw?url=',
    'https://api.codetabs.com/v1/proxy?quest=',
  ];

  // ---------- Instruments ----------
  // Futures (NQ + ES only — VIX/DXY removed per spec).
  const FUTURES = [
    { sym: 'NQ',  name: 'E-mini Nasdaq', yf: 'NQ=F' },
    { sym: 'ES',  name: 'E-mini S&P',    yf: 'ES=F' },
  ];

  // Stocks watchlist (rendered in the terminal table + ticker).
  const STOCKS = [
    { sym: 'AAPL',  name: 'Apple Inc.' },
    { sym: 'MSFT',  name: 'Microsoft Corp.' },
    { sym: 'NVDA',  name: 'NVIDIA Corp.' },
    { sym: 'GOOGL', name: 'Alphabet Inc.' },
    { sym: 'AMZN',  name: 'Amazon.com' },
    { sym: 'META',  name: 'Meta Platforms' },
    { sym: 'TSLA',  name: 'Tesla, Inc.' },
    { sym: 'AVGO',  name: 'Broadcom Inc.' },
    { sym: 'AMD',   name: 'Adv. Micro Dev.' },
    { sym: 'NFLX',  name: 'Netflix, Inc.' },
    { sym: 'COST',  name: 'Costco' },
    { sym: 'JPM',   name: 'JPMorgan Chase' },
    { sym: 'V',     name: 'Visa Inc.' },
    { sym: 'WMT',   name: 'Walmart' },
    { sym: 'XOM',   name: 'Exxon Mobil' },
  ];

  // Crypto (BTC only).
  const CRYPTO = [
    { sym: 'BTC', name: 'Bitcoin', id: 'bitcoin' },
  ];

  // Additional symbols pulled only for the heatmap (not rendered in the
  // terminal table). Combined into a single Yahoo fetch. Sector / mcap
  // metadata for these lives in js/heatmap-grid.js.
  const HEATMAP_EXTRA = [
    // already in STOCKS: AAPL MSFT NVDA GOOGL AMZN META TSLA AVGO AMD NFLX COST JPM V WMT XOM
    'ADBE','CRM','CSCO','ACN','IBM','QCOM','TXN','INTC','NOW','INTU','AMAT','MU','PANW','ANET','ORCL',
    'DIS','TMUS','VZ','CMCSA','T',
    'HD','MCD','NKE','LOW','SBUX','BKNG','TJX',
    'MA','BAC','WFC','GS','MS','BLK','AXP','C','SCHW','SPGI',
    'LLY','UNH','JNJ','MRK','ABBV','PFE','TMO','ABT','ISRG','AMGN','DHR','BMY',
    'PG','KO','PEP','PM','MO',
    'CVX','COP',
    'GE','RTX','CAT','HON','BA','UPS','UNP','LMT',
    'LIN','SHW','NEE','SO','PLD','AMT',
  ];

  // ---------- State ----------
  const state = {
    quotes: new Map(),    // symbol -> { last, prev, chg, pct, vol, high, low, mcap, spark: [...] }
    news: [],
    lastUpdate: null,
    latencyMs: null,
  };

  // ---------- Cache (localStorage, instant-paint only) ----------
  // The localStorage cache exists ONLY to paint instantly on repeat visits.
  // It never delays a network refresh — the server endpoint is the single
  // source of truth across every device, and is edge-cached for ~3s.
  const CACHE_KEY = 'signal:cache:v2';
  const CACHE_TTL_MS = 0;
  function cacheLoad() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const j = JSON.parse(raw);
      if (!j || typeof j.ts !== 'number') return null;
      if (j.quotes) {
        for (const [k, v] of Object.entries(j.quotes)) state.quotes.set(k, v);
      }
      if (Array.isArray(j.news)) {
        state.news = j.news.map(n => ({ ...n, time: new Date(n.time) }));
      }
      if (j.ts) state.lastUpdate = new Date(j.ts);
      return j.ts;
    } catch { return null; }
  }
  function cacheSave() {
    try {
      const payload = {
        ts: Date.now(),
        quotes: Object.fromEntries(state.quotes),
        news: state.news.map(n => ({ ...n, time: n.time instanceof Date ? n.time.toISOString() : n.time })),
      };
      localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
    } catch {}
  }
  function cacheFresh(ts) {
    return ts != null && (Date.now() - ts) < CACHE_TTL_MS;
  }

  // Skeleton helpers — used while the very first fetch is in flight.
  const skel = (w = 50) => `<span class="skel" style="width:${w}px"></span>`;

  // ---------- DOM helpers ----------
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const pad = (s, n) => String(s).padEnd(n, ' ').slice(0, n);
  const fmtPrice = (v) => {
    if (v == null || !isFinite(v)) return '—';
    if (v >= 10000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (v >= 100)   return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (v >= 1)     return v.toFixed(2);
    return v.toFixed(4);
  };
  const fmtChg = (v) => v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2);
  const fmtPct = (v) => v == null || !isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
  const fmtVol = (v) => {
    if (v == null || !isFinite(v) || v === 0) return '—';
    if (v >= 1e9)  return (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6)  return (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3)  return (v / 1e3).toFixed(1) + 'K';
    return String(v);
  };
  const fmtMcap = (v) => {
    if (v == null || !isFinite(v) || v === 0) return '—';
    if (v >= 1e12) return '$' + (v / 1e12).toFixed(2) + 'T';
    if (v >= 1e9)  return '$' + (v / 1e9).toFixed(1) + 'B';
    if (v >= 1e6)  return '$' + (v / 1e6).toFixed(1) + 'M';
    return '$' + v.toFixed(0);
  };
  const fmtClock = (d) => `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
  const fmtRel = (d) => {
    const s = Math.floor((Date.now() - d.getTime()) / 1000);
    if (s < 60) return `${s}S AGO`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}M AGO`;
    return `${Math.floor(m / 60)}H AGO`;
  };

  async function proxiedJSON(url) {
    let lastErr;
    for (const p of PROXIES) {
      try {
        const r = await fetch(p + encodeURIComponent(url), { cache: 'no-store' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return await r.json();
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('no proxy');
  }

  // ---------- Fetchers ----------
  // Yahoo spark — batched. Returns { sym, last, prev, chg, pct, vol, high, low, spark }
  async function fetchYahooBatch(symbols) {
    const url = `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(symbols.join(','))}&range=1d&interval=5m`;
    const j = await proxiedJSON(url);
    return j?.spark?.result || [];
  }

  async function fetchYahoo(symbols) {
    if (!symbols.length) return [];
    const chunks = [];
    for (let i = 0; i < symbols.length; i += 18) chunks.push(symbols.slice(i, i + 18));
    const batches = await Promise.allSettled(chunks.map(c => fetchYahooBatch(c)));
    const results = [];
    for (const b of batches) if (b.status === 'fulfilled') results.push(...b.value);
    const out = [];
    for (const r of results) {
      const resp = r?.response?.[0];
      const meta = resp?.meta;
      if (!meta) continue;
      const last = meta.regularMarketPrice;
      const prev = meta.chartPreviousClose ?? meta.previousClose;
      const chg  = (last != null && prev != null) ? last - prev : null;
      const pct  = (chg != null && prev) ? (chg / prev) * 100 : null;
      const closes = resp?.indicators?.quote?.[0]?.close;
      const sparkArr = Array.isArray(closes) ? closes.filter(v => v != null) : null;
      out.push({
        sym: r.symbol,
        last, prev, chg, pct,
        vol: meta.regularMarketVolume,
        high: meta.regularMarketDayHigh,
        low: meta.regularMarketDayLow,
        spark: sparkArr,
      });
    }
    return out;
  }

  async function fetchCrypto() {
    const ids = CRYPTO.map(c => c.id);
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true`;
    const parse = (obj) => {
      const out = [];
      for (const c of CRYPTO) {
        const d = obj?.[c.id];
        if (!d) continue;
        const price = d.usd;
        const pct = d.usd_24h_change;
        const chg = (price != null && pct != null) ? price - price / (1 + pct/100) : null;
        out.push({
          sym: c.sym,
          last: price, chg, pct,
          vol: d.usd_24h_vol,
          mcap: d.usd_market_cap,
          high: null, low: null,
          spark: null,
        });
      }
      return out;
    };
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (r.ok) return parse(await r.json());
      throw 0;
    } catch {
      try { return parse(await proxiedJSON(url)); } catch (e) { return []; }
    }
  }

  // ---------- Sparkline SVG ----------
  function renderSpark(values, width = 70, height = 18) {
    if (!values || values.length < 2) return '<span class="t-dim">—</span>';
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = (max - min) || 1;
    const stepX = width / (values.length - 1);
    const pts = values.map((v, i) => `${(i * stepX).toFixed(1)},${(height - ((v - min) / range) * height).toFixed(1)}`).join(' ');
    const up = values[values.length - 1] >= values[0];
    const stroke = up ? '#00ff66' : '#ff3a3a';
    return `<svg class="term-spark" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
      <polyline points="${pts}" fill="none" stroke="${stroke}" stroke-width="1.2" />
    </svg>`;
  }

  // ---------- Renderers ----------
  function symbolToYf(sym) {
    const f = FUTURES.find(x => x.sym === sym);
    if (f) return f.yf;
    return sym;
  }
  function metaForSym(sym) {
    return FUTURES.find(x => x.sym === sym)
        || STOCKS.find(x => x.sym === sym)
        || CRYPTO.find(x => x.sym === sym);
  }

  function renderTable() {
    const tbody = $('#term-tbl tbody');
    if (!tbody) return;
    const rows = [];
    let upCount = 0, dnCount = 0, mcapTotal = 0;

    const all = [
      ...FUTURES.map(f => ({ ...f, kind: 'fut' })),
      ...STOCKS.map(s => ({ ...s, kind: 'eq' })),
      ...CRYPTO.map(c => ({ ...c, kind: 'cx' })),
    ];

    for (const inst of all) {
      const q = state.quotes.get(inst.sym);
      const pct = q?.pct;
      const cls = pct == null ? 't-dim' : (pct >= 0 ? 'up' : 'dn');
      if (pct != null) { pct >= 0 ? upCount++ : dnCount++; }
      if (q?.mcap) mcapTotal += q.mcap;
      const sparkSvg = q?.spark ? renderSpark(q.spark) : (q ? '<span class="t-dim">—</span>' : skel(70));
      const cell = (val, fmt, klass) => q ? `<td class="num ${klass}">${fmt(val)}</td>` : `<td class="num">${skel(54)}</td>`;
      rows.push(`<tr data-sym="${esc(inst.sym)}">
        <td class="sym">${esc(inst.sym)}</td>
        <td class="name">${esc(inst.name)}</td>
        ${cell(q?.last, fmtPrice, cls === 't-dim' ? 't-dim' : '')}
        ${cell(q?.chg,  fmtChg,   cls)}
        ${cell(pct,     fmtPct,   cls)}
        ${cell(q?.vol,  fmtVol,   '')}
        ${cell(q?.high, fmtPrice, '')}
        ${cell(q?.low,  fmtPrice, '')}
        <td class="num">${sparkSvg}</td>
      </tr>`);
    }
    tbody.innerHTML = rows.join('');

    $('#term-mcap').textContent = mcapTotal ? fmtMcap(mcapTotal) : '$—';
    $('#term-upcount').textContent = `${upCount} UP`;
    $('#term-dncount').textContent = `${dnCount} DOWN`;
  }

  function renderTicker() {
    const el = $('#term-ticker');
    if (!el) return;
    const all = [
      ...FUTURES.map(f => f.sym),
      ...STOCKS.map(s => s.sym),
      ...CRYPTO.map(c => c.sym),
    ];
    const parts = [];
    for (const sym of all) {
      const q = state.quotes.get(sym);
      if (!q || q.last == null) continue;
      const cls = (q.pct ?? 0) >= 0 ? 'tk-up' : 'tk-dn';
      const arrow = (q.pct ?? 0) >= 0 ? '▲' : '▼';
      parts.push(`<span class="tk-sym">${esc(sym)}</span><span class="tk-px">${fmtPrice(q.last)}</span><span class="${cls}">${arrow} ${fmtPct(q.pct)}</span><span class="tk-bar">|</span>`);
    }
    // Duplicate so the marquee never reveals an empty patch.
    el.innerHTML = parts.join('') + parts.join('');
  }

  function renderNews() {
    const el = $('#term-news');
    if (!el) return;
    const items = state.news.slice(0, 50);
    $('#term-news-count').textContent = items.length ? `${items.length} ARTICLES` : 'LOADING';
    if (!items.length) {
      el.innerHTML = Array.from({ length: 6 }).map(() => `
        <div class="term-news-item" style="cursor:default;">
          <div class="term-news-row1"><span class="skel" style="width:60px"></span><span class="skel" style="width:48px"></span></div>
          <div class="term-news-title"><span class="skel skel-line" style="width:88%"></span></div>
          <div class="term-news-sum"><span class="skel skel-line" style="width:96%"></span><span class="skel skel-line" style="width:62%"></span></div>
        </div>`).join('');
      return;
    }
    el.innerHTML = items.map(n => `
      <div class="term-news-item" data-url="${esc(n.link)}">
        <div class="term-news-row1">
          <span class="term-news-cat">${esc((n.category || 'WIRE').toUpperCase())}</span>
          <span class="term-news-time">${esc(fmtRel(n.time))}</span>
        </div>
        <div class="term-news-title">${esc(n.title)}</div>
        ${n.summary ? `<div class="term-news-sum">${esc(n.summary)}</div>` : ''}
        <div class="term-news-by">
          <span>${esc(n.source || '')}</span>
          <span class="term-news-read"> | [READ MORE]</span>
        </div>
      </div>
    `).join('');
    el.querySelectorAll('.term-news-item').forEach(it => {
      it.addEventListener('click', () => {
        const u = it.dataset.url;
        if (u) window.open(u, '_blank', 'noopener');
      });
    });
  }

  function renderStatus() {
    const now = new Date();
    $('#term-last').textContent = fmtClock(state.lastUpdate || now);
    $('#term-latency').textContent = state.latencyMs == null ? '--ms' : `${state.latencyMs}ms`;
    const conn = $('#term-conn');
    if ((state.quoteFails || 0) >= 3) {
      // Repeated fetch failures — the table is stale; say so instead of
      // claiming a live connection.
      conn.textContent = 'STALE — RECONNECTING';
      conn.classList.remove('t-green'); conn.classList.add('t-red');
    } else if (state.quotes.size > 0) {
      conn.textContent = 'CONNECTED';
      conn.classList.remove('t-red'); conn.classList.add('t-green');
    } else {
      conn.textContent = 'CONNECTING…';
    }
    // Market status — computed in America/New_York so DST never skews it.
    const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const etDay = et.getDay();
    const etMin = et.getHours() * 60 + et.getMinutes();
    const open = etDay >= 1 && etDay <= 5 && etMin >= 9 * 60 + 30 && etMin < 16 * 60;
    const mk = $('#term-mkt-status');
    if (mk) {
      mk.textContent = open ? 'OPEN' : 'CLOSED';
      mk.className = open ? 't-green' : 't-red';
    }
  }

  // ---------- Refresh loop ----------
  // All clients fetch from our own /api/quotes endpoint. Vercel caches the
  // response at the edge for ~3s, so every browser within that window sees
  // the IDENTICAL payload — that's how mobile and desktop stay in sync.
  async function refreshQuotes() {
    const t0 = performance.now();
    try {
      const r = await fetch('/api/quotes', { cache: 'no-store' });
      if (!r.ok) throw new Error('quotes ' + r.status);
      const j = await r.json();
      const quotes = j.quotes || {};
      // Replace the map atomically so all renderers see a consistent set.
      const next = new Map();
      for (const [k, v] of Object.entries(quotes)) next.set(k, v);
      // Preserve any prior values for symbols the server didn't return.
      for (const [k, v] of state.quotes) if (!next.has(k)) next.set(k, v);
      state.quotes = next;
      state.latencyMs = Math.round(performance.now() - t0);
      state.lastUpdate = j.ts ? new Date(j.ts) : new Date();
      state.quoteFails = 0;
      cacheSave();
      renderTable();
      renderTicker();
      renderStatus();
      window.dispatchEvent(new CustomEvent('signal:quotes', { detail: { quotes: state.quotes, ts: state.lastUpdate } }));
    } catch (e) {
      // Soft-fail — keep whatever quotes we already had. Next tick retries.
      state.latencyMs = Math.round(performance.now() - t0);
      state.quoteFails = (state.quoteFails || 0) + 1;
      renderStatus();
      window.dispatchEvent(new CustomEvent('signal:quotes-error', { detail: { fails: state.quoteFails } }));
    }
  }

  // Public surface for other modules.
  window.SignalMarket = {
    state,
    STOCKS,
    FUTURES,
    CRYPTO,
    refresh: refreshQuotes,
  };

  async function refreshNews() {
    try {
      const r = await fetch('/api/news', { cache: 'no-store' });
      if (!r.ok) throw new Error('news ' + r.status);
      const j = await r.json();
      state.news = (j.items || []).map(n => ({ ...n, time: new Date(n.time) }));
      cacheSave();
      renderNews();
      window.dispatchEvent(new CustomEvent('signal:news', { detail: { news: state.news } }));
    } catch {
      // Keep existing news on failure.
    }
  }

  // ---------- Command parser ----------
  const COMMANDS = {
    help:       'Show all available commands',
    '<TICKER>': 'Quote + stats for any symbol (e.g. AAPL, NQ, BTC)',
    'news <TICKER>': 'Latest headlines mentioning that ticker',
    'news':     'Latest headlines (all)',
    btc:        'Live BTC price',
    eval:       'Prop firm evaluation status',
    watchlist:  'Show full watchlist',
    chart:      'Toggle sparkline chart visibility',
    export:     'Export current snapshot as JSON',
    clear:      'Clear output',
  };

  function outputBlock(cmd, html) {
    const out = $('#term-output');
    out.hidden = false;
    const block = document.createElement('div');
    block.className = 'out-block';
    block.innerHTML = `<div class="out-cmd">&gt; ${esc(cmd)}</div><div class="out-body">${html}</div>`;
    out.prepend(block);
    out.scrollTop = 0;
  }

  function fmtRowLine(label, value, valueClass = '') {
    return `<span class="out-key">${pad(label, 18)}</span> <span class="${valueClass || 'out-val'}">${value}</span>`;
  }

  function runCommand(raw) {
    const cmd = String(raw || '').trim();
    if (!cmd) return;
    const lower = cmd.toLowerCase();
    const parts = lower.split(/\s+/);

    if (lower === 'help' || lower === '?') {
      const lines = ['<span class="t-amber">AVAILABLE COMMANDS</span>',
        '<span class="out-divider">═══════════════════════════════════════════════</span>'];
      for (const [k, v] of Object.entries(COMMANDS)) {
        lines.push(`<span class="out-key">${pad(k, 18)}</span> <span class="out-val">${esc(v)}</span>`);
      }
      lines.push('', '<span class="t-dim">EXAMPLES: AAPL  |  NEWS TSLA  |  BTC  |  EVAL  |  WATCHLIST</span>');
      outputBlock(cmd, lines.join('\n'));
      return;
    }

    if (lower === 'clear') {
      const out = $('#term-output');
      out.innerHTML = ''; out.hidden = true;
      return;
    }

    if (lower === 'btc') {
      const q = state.quotes.get('BTC');
      if (!q) { outputBlock(cmd, `<span class="out-err">No BTC data yet — try again in a moment.</span>`); return; }
      const cls = (q.pct ?? 0) >= 0 ? 'out-val-up' : 'out-val-dn';
      const lines = [
        '<span class="t-amber">BITCOIN (BTC/USD)</span>',
        '<span class="out-divider">═══════════════════════════════════════════════</span>',
        fmtRowLine('LAST',         '$' + fmtPrice(q.last)),
        fmtRowLine('24H CHANGE',   fmtChg(q.chg) + '  (' + fmtPct(q.pct) + ')', cls),
        fmtRowLine('24H VOLUME',   '$' + fmtVol(q.vol)),
        fmtRowLine('MARKET CAP',   fmtMcap(q.mcap)),
        fmtRowLine('UPDATED',      fmtClock(state.lastUpdate || new Date())),
      ];
      outputBlock(cmd, lines.join('\n'));
      return;
    }

    if (lower === 'eval') {
      // Mocked prop-firm eval status — labelled DEMO so it can never be
      // mistaken for live account data.
      const lines = [
        '<span class="t-amber">PROP FIRM EVALUATION STATUS</span> <span class="t-red">[DEMO — SAMPLE DATA, NOT LIVE]</span>',
        '<span class="out-divider">═══════════════════════════════════════════════</span>',
        fmtRowLine('ACCOUNT',         'FTMO 100K · PHASE 1'),
        fmtRowLine('DAYS ELAPSED',    '14 / 30'),
        fmtRowLine('PROFIT TARGET',   '$6,420  /  $10,000  (64.2%)', 'out-val-up'),
        fmtRowLine('DAILY P&L',       '+$842',                       'out-val-up'),
        fmtRowLine('DAILY LOSS LIMIT','-$1,820 / -$5,000  ✓ OK',     'out-val-up'),
        fmtRowLine('MAX DRAWDOWN',    '-$3,150 / -$10,000 ✓ OK',     'out-val-up'),
        fmtRowLine('TRADING DAYS',    '8 / 10 MIN'),
        fmtRowLine('CONSISTENCY',     '47% (under 50% rule)',        'out-val-up'),
        fmtRowLine('STATUS',          'ON TRACK',                    'out-val-up'),
      ];
      outputBlock(cmd, lines.join('\n'));
      return;
    }

    if (lower === 'watchlist' || lower === 'stocks') {
      const lines = ['<span class="t-amber">WATCHLIST</span>',
        '<span class="out-divider">═══════════════════════════════════════════════</span>',
        `<span class="out-key">${pad('SYM',6)} ${pad('LAST',10)} ${pad('CHG',9)} ${pad('%CHG',8)} ${pad('VOL',8)}</span>`];
      for (const inst of [...FUTURES, ...STOCKS, ...CRYPTO]) {
        const q = state.quotes.get(inst.sym);
        if (!q) continue;
        const cls = (q.pct ?? 0) >= 0 ? 'out-val-up' : 'out-val-dn';
        lines.push(`<span class="t-amber">${pad(inst.sym,6)}</span><span class="out-val"> ${pad(fmtPrice(q.last),10)}</span><span class="${cls}"> ${pad(fmtChg(q.chg),9)} ${pad(fmtPct(q.pct),8)}</span><span class="out-val"> ${pad(fmtVol(q.vol),8)}</span>`);
      }
      outputBlock(cmd, lines.join('\n'));
      return;
    }

    if (lower === 'chart') {
      document.querySelectorAll('.term-spark').forEach(s => s.style.display = s.style.display === 'none' ? '' : 'none');
      outputBlock(cmd, `<span class="out-val">Sparkline charts toggled.</span>`);
      return;
    }

    if (lower === 'export') {
      const snapshot = {
        ts: new Date().toISOString(),
        quotes: Object.fromEntries(state.quotes),
        news: state.news.slice(0, 10).map(n => ({ title: n.title, source: n.source, time: n.time })),
      };
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `signal-terminal-${Date.now()}.json`;
      a.click();
      outputBlock(cmd, `<span class="out-val">Snapshot exported (${state.quotes.size} quotes, ${state.news.length} headlines).</span>`);
      return;
    }

    // news [TICKER]
    if (parts[0] === 'news') {
      const tk = parts[1] ? parts[1].toUpperCase() : null;
      // Map ticker → list of phrases that count as a mention.
      const NEWS_ALIASES = {
        AAPL: ['AAPL','APPLE'], MSFT: ['MSFT','MICROSOFT'], NVDA: ['NVDA','NVIDIA'],
        GOOGL:['GOOGL','GOOGLE','ALPHABET'], AMZN: ['AMZN','AMAZON'],
        META: ['META','FACEBOOK'], TSLA: ['TSLA','TESLA','ELON'],
        AVGO: ['AVGO','BROADCOM'], AMD: ['AMD'], NFLX: ['NFLX','NETFLIX'],
        COST: ['COST','COSTCO'], JPM: ['JPM','JPMORGAN','JP MORGAN'],
        V: ['VISA'], WMT: ['WMT','WALMART'], XOM: ['XOM','EXXON'],
        BTC: ['BTC','BITCOIN'], NQ: ['NASDAQ','NQ','TECH STOCKS'],
        ES: ['S&P','SP500','ES FUTURES'], VIX: ['VIX','VOLATILITY'],
        DXY: ['DXY','DOLLAR'],
      };
      const needles = tk ? (NEWS_ALIASES[tk] || [tk]) : null;
      const items = state.news.filter(n => {
        if (!needles) return true;
        const t = (n.title + ' ' + (n.summary || '')).toUpperCase();
        return needles.some(w => t.includes(w));
      }).slice(0, 15);
      if (!items.length) {
        outputBlock(cmd, `<span class="out-err">No headlines found${tk ? ` for ${tk}` : ''}.</span>`);
        return;
      }
      const lines = [`<span class="t-amber">NEWS${tk ? ' :: ' + tk : ''}</span>`,
        '<span class="out-divider">═══════════════════════════════════════════════</span>'];
      for (const n of items) {
        lines.push(`<span class="t-dim">[${fmtRel(n.time)}]</span> <span class="t-amber">${esc(n.source || '')}</span>`);
        lines.push(`<span class="out-val">  ${esc(n.title)}</span>`);
      }
      outputBlock(cmd, lines.join('\n'));
      return;
    }

    // Ticker lookup — match any known sym (case-insensitive)
    const upper = cmd.toUpperCase().replace(/[^A-Z0-9.=^\-]/g, '');
    const inst = metaForSym(upper);
    if (inst) {
      const q = state.quotes.get(inst.sym);
      if (!q) { outputBlock(cmd, `<span class="out-err">No data yet for ${inst.sym}.</span>`); return; }
      const cls = (q.pct ?? 0) >= 0 ? 'out-val-up' : 'out-val-dn';
      const arrow = (q.pct ?? 0) >= 0 ? '▲' : '▼';
      const lines = [
        `<span class="t-amber">${esc(inst.sym)}  ${esc(inst.name || '')}</span>`,
        '<span class="out-divider">═══════════════════════════════════════════════</span>',
        fmtRowLine('LAST',       fmtPrice(q.last)),
        fmtRowLine('CHANGE',     `${arrow} ${fmtChg(q.chg)} (${fmtPct(q.pct)})`, cls),
        fmtRowLine('DAY HIGH',   fmtPrice(q.high), 'out-val-up'),
        fmtRowLine('DAY LOW',    fmtPrice(q.low),  'out-val-dn'),
        fmtRowLine('VOLUME',     fmtVol(q.vol)),
        fmtRowLine('MARKET CAP', q.mcap ? fmtMcap(q.mcap) : '—'),
        fmtRowLine('UPDATED',    fmtClock(state.lastUpdate || new Date())),
      ];
      outputBlock(cmd, lines.join('\n'));
      return;
    }

    // Unknown ticker — still try Yahoo directly?
    outputBlock(cmd, `<span class="out-err">Unknown command or symbol: ${esc(cmd)}</span>\n<span class="t-dim">Type HELP to list available commands.</span>`);
  }

  // ---------- Wire up UI ----------
  function bindCommandUI() {
    const input = $('#term-input');
    const exec  = $('#term-exec');
    const submit = () => {
      const v = input.value;
      runCommand(v);
      input.value = '';
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      if (e.key === 'Escape') {
        input.value = '';
        const out = $('#term-output'); out.innerHTML = ''; out.hidden = true;
      }
    });
    exec.addEventListener('click', submit);
    document.querySelectorAll('.term-q').forEach(b => {
      b.addEventListener('click', () => runCommand(b.dataset.cmd));
    });
    // CTRL+R refresh
    document.addEventListener('keydown', (e) => {
      if (document.body.classList.contains('terminal-mode')
          && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        refreshQuotes();
        refreshNews();
      }
    });
  }

  // ---------- Boot ----------
  let started = false;
  let uiBound = false;
  function ensureUI() {
    if (uiBound) return;
    if (!document.querySelector('#term-input')) return;
    bindCommandUI();
    uiBound = true;
  }
  function start() {
    if (started) return;
    started = true;
    ensureUI();
    // Hydrate from localStorage BEFORE first render → instant paint on repeat
    // visits. Always fetch in the background; only delay the network call when
    // the cached payload is still within the 30s TTL.
    const cachedTs = cacheLoad();
    if (state.quotes.size) {
      window.dispatchEvent(new CustomEvent('signal:quotes', { detail: { quotes: state.quotes, ts: state.lastUpdate } }));
    }
    if (state.news.length) {
      window.dispatchEvent(new CustomEvent('signal:news', { detail: { news: state.news } }));
    }
    renderTable();
    renderNews();
    renderStatus();
    // Always hit the server immediately — the localStorage cache only exists
    // to paint instantly while the network request is in flight.
    refreshQuotes();
    refreshNews();
    // 5s quote polling — the /api/quotes endpoint is edge-cached for ~3s so
    // this stays cheap while keeping every device in lockstep.
    setInterval(refreshQuotes, 5000);
    setInterval(refreshNews, 30 * 1000);
    // Pause polling while the tab is hidden, refresh immediately on focus
    // so the data is already current when the user returns.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) { refreshQuotes(); refreshNews(); }
    });
    window.addEventListener('focus', () => { refreshQuotes(); refreshNews(); });
    setInterval(() => {
      // re-tick the timestamps in the news list (relative ages drift)
      renderNews();
      renderStatus();
    }, 30 * 1000);
  }

  function onTabChange() {
    const active = document.querySelector('.tab-panel.active');
    const isTerm = active && active.dataset.panel === 'terminal';
    document.body.classList.toggle('terminal-mode', !!isTerm);
    ensureUI();
  }
  document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => setTimeout(onTabChange, 30)));
  window.addEventListener('hashchange', () => setTimeout(onTabChange, 30));
  // Start data fetching immediately on page load so the global ticker and
  // heatmap have data even before the user opens the Terminal tab.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { start(); onTabChange(); });
  } else {
    start();
    setTimeout(onTabChange, 50);
  }
})();
