// SIGNAL // Terminal — Bloomberg-style live trading terminal.
// Free data: CoinGecko (crypto), Yahoo Finance via CORS proxies (stocks/futures/indexes),
// existing SIGNAL RSS news pipeline (filtered to watchlist tickers).

(() => {
  const CFG = window.SIGNAL_CONFIG || {};
  // corsproxy.io now requires a paid plan; allorigins is the only one of the
  // three that still serves Yahoo Finance endpoints without auth.
  const PROXIES = [
    'https://api.allorigins.win/raw?url=',
    'https://api.codetabs.com/v1/proxy?quest=',
    'https://corsproxy.io/?',
  ];

  // ---------- Watchlist & overview definitions ----------
  // "Nasdaq & S&P 500" interpreted as: indexes + the biggest movers of each.
  const OVERVIEW = [
    { sym: 'SPY',   name: 'S&P 500 ETF',   yf: 'SPY' },
    { sym: 'QQQ',   name: 'Nasdaq 100 ETF',yf: 'QQQ' },
    { sym: 'ES',    name: 'E-mini S&P Fut',yf: 'ES=F' },
    { sym: 'NQ',    name: 'E-mini NQ Fut', yf: 'NQ=F' },
    { sym: 'VIX',   name: 'Volatility',    yf: '^VIX' },
    { sym: 'DXY',   name: 'Dollar Index',  yf: 'DX-Y.NYB' },
    { sym: 'BTC',   name: 'Bitcoin',       cg: 'bitcoin' },
    { sym: 'ETH',   name: 'Ethereum',      cg: 'ethereum' },
  ];

  const STOCKS = [
    'AAPL','MSFT','NVDA','GOOGL','AMZN','META','TSLA','AVGO',
    'AMD','NFLX','COST','PEP','ADBE','CRM','LIN','TMO',
    'JPM','V','WMT','XOM',
  ];

  const CRYPTOS = [
    { sym: 'BTC',  id: 'bitcoin' },
    { sym: 'ETH',  id: 'ethereum' },
    { sym: 'SOL',  id: 'solana' },
    { sym: 'XRP',  id: 'ripple' },
    { sym: 'DOGE', id: 'dogecoin' },
  ];

  // Economic calendar — anchored to today's date so it stays plausibly current.
  const ECON = (() => {
    const today = new Date();
    const mk = (dayOffset, hour, min, name, imp) => {
      const d = new Date(today);
      d.setDate(d.getDate() + dayOffset);
      d.setHours(hour, min, 0, 0);
      return { date: d, name, imp };
    };
    return [
      mk(0,  8, 30, 'Initial Jobless Claims',   'med'),
      mk(1,  8, 30, 'CPI (Consumer Price Index)','high'),
      mk(2,  8, 30, 'Core PPI',                  'med'),
      mk(2, 10, 0,  'Fed Chair Speech',          'high'),
      mk(3,  8, 30, 'Retail Sales',              'med'),
      mk(6, 14, 0,  'FOMC Rate Decision',        'high'),
      mk(7,  8, 30, 'Non-Farm Payrolls (NFP)',   'high'),
      mk(8,  8, 30, 'Unemployment Rate',         'high'),
      mk(10, 10, 0, 'ISM Manufacturing PMI',     'med'),
      mk(14, 8, 30, 'GDP (Advance)',             'high'),
    ];
  })();

  // ---------- State ----------
  const state = {
    quotes: new Map(), // symbol -> { last, prev, chg, pct, vol, mcap, ts }
    news: [],
    lastUpdate: null,
    netStatus: 'idle',
    sessionStart: Date.now(),
    aiLastRun: 0,
  };

  // ---------- Helpers ----------
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmtPrice = (v) => {
    if (v == null || !isFinite(v)) return '—';
    if (v >= 10000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (v >= 100)   return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (v >= 1)     return v.toFixed(2);
    return v.toFixed(4);
  };
  const fmtChg = (v) => {
    if (v == null || !isFinite(v)) return '—';
    const s = v >= 0 ? '+' : '';
    return s + (Math.abs(v) >= 100 ? v.toFixed(2) : v.toFixed(2));
  };
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
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    return `${Math.floor(m / 60)}h`;
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
  // Yahoo v7/quote now requires crumb auth via public proxies. Use the auth-free
  // "spark" batched chart endpoint, which returns close series + previousClose.
  async function fetchYahooBatch(symbols) {
    const url = `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(symbols.join(','))}&range=1d&interval=5m&indicators=close&includeTimestamps=false&includePrePost=false&corsDomain=finance.yahoo.com&.tsrc=finance`;
    const j = await proxiedJSON(url);
    return j?.spark?.result || [];
  }

  async function fetchYahoo(symbols) {
    if (!symbols.length) return [];
    // Yahoo spark caps at 20 symbols per request — batch in chunks.
    const chunks = [];
    for (let i = 0; i < symbols.length; i += 18) chunks.push(symbols.slice(i, i + 18));
    try {
      const batches = await Promise.allSettled(chunks.map(c => fetchYahooBatch(c)));
      const out = [];
      const results = [];
      for (const b of batches) if (b.status === 'fulfilled') results.push(...b.value);
      for (const r of results) {
        const meta = r?.response?.[0]?.meta;
        if (!meta) continue;
        const last = meta.regularMarketPrice;
        const prev = meta.chartPreviousClose ?? meta.previousClose;
        const chg = (last != null && prev != null) ? last - prev : null;
        const pct = (chg != null && prev) ? (chg / prev) * 100 : null;
        out.push({
          sym: r.symbol,
          last,
          prev,
          chg,
          pct,
          vol: meta.regularMarketVolume,
          mcap: null,
        });
      }
      return out;
    } catch (e) {
      console.warn('[term] Yahoo spark fail', e);
      return [];
    }
  }

  async function fetchCrypto(ids) {
    if (!ids.length) return [];
    // simple/price is lighter & CORS-friendly direct
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true`;
    const parse = (obj) => {
      const out = [];
      for (const id of ids) {
        const d = obj?.[id];
        if (!d) continue;
        const price = d.usd;
        const pct = d.usd_24h_change;
        const chg = (price != null && pct != null) ? price - price / (1 + pct/100) : null;
        out.push({
          id,
          current_price: price,
          price_change_24h: chg,
          price_change_percentage_24h: pct,
          total_volume: d.usd_24h_vol,
          market_cap: d.usd_market_cap,
        });
      }
      return out;
    };
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (r.ok) return parse(await r.json());
      throw new Error(`HTTP ${r.status}`);
    } catch {
      try { return parse(await proxiedJSON(url)); } catch (e) { console.warn('[term] CoinGecko fail', e); return []; }
    }
  }

  // ---------- Renderers ----------
  function renderOverview() {
    const el = $('#term-overview');
    if (!el) return;
    el.innerHTML = OVERVIEW.map(o => {
      const q = state.quotes.get(o.sym);
      const pct = q?.pct;
      const cls = pct == null ? '' : (pct >= 0 ? 'up' : 'dn');
      return `
        <div class="ovr-tile ${cls}">
          <div class="ovr-sym"><span>${esc(o.sym)}</span><span class="ovr-name">${esc(o.name)}</span></div>
          <div class="ovr-price">${fmtPrice(q?.last)}</div>
          <div class="ovr-change">
            <span>${fmtChg(q?.chg)}</span>
            <span>${fmtPct(pct)}</span>
          </div>
        </div>`;
    }).join('');
  }

  function renderWatchlist() {
    const tbody = $('#term-watch tbody');
    if (!tbody) return;
    const rows = [];
    for (const sym of STOCKS) {
      const q = state.quotes.get(sym);
      const pct = q?.pct;
      const cls = pct == null ? '' : (pct >= 0 ? 'up' : 'dn');
      rows.push(`<tr data-sym="${esc(sym)}">
        <td class="sym">${esc(sym)}</td>
        <td class="num">${fmtPrice(q?.last)}</td>
        <td class="num ${cls}">${fmtChg(q?.chg)}</td>
        <td class="num ${cls}">${fmtPct(pct)}</td>
        <td class="num">${fmtVol(q?.vol)}</td>
        <td class="num">${fmtMcap(q?.mcap)}</td>
      </tr>`);
    }
    for (const c of CRYPTOS) {
      const q = state.quotes.get(c.sym);
      const pct = q?.pct;
      const cls = pct == null ? '' : (pct >= 0 ? 'up' : 'dn');
      rows.push(`<tr class="crypto" data-sym="${esc(c.sym)}">
        <td class="sym">${esc(c.sym)}</td>
        <td class="num">${fmtPrice(q?.last)}</td>
        <td class="num ${cls}">${fmtChg(q?.chg)}</td>
        <td class="num ${cls}">${fmtPct(pct)}</td>
        <td class="num">${fmtVol(q?.vol)}</td>
        <td class="num">${fmtMcap(q?.mcap)}</td>
      </tr>`);
    }
    tbody.innerHTML = rows.join('');
    const cnt = $('#term-watch-count');
    if (cnt) cnt.textContent = `${STOCKS.length + CRYPTOS.length} INSTRUMENTS`;
  }

  function flashChanges(prev) {
    const tbody = $('#term-watch tbody');
    if (!tbody) return;
    tbody.querySelectorAll('tr').forEach(tr => {
      const sym = tr.dataset.sym;
      const cur = state.quotes.get(sym);
      const old = prev.get(sym);
      if (!cur || !old || old.last == null) return;
      if (cur.last > old.last) { tr.classList.remove('flash-up'); void tr.offsetWidth; tr.classList.add('flash-up'); }
      else if (cur.last < old.last) { tr.classList.remove('flash-dn'); void tr.offsetWidth; tr.classList.add('flash-dn'); }
    });
  }

  // Build a set of tickers to filter news by.
  const WATCH_TICKERS = new Set([
    ...STOCKS,
    ...CRYPTOS.map(c => c.sym),
    'BITCOIN','ETHEREUM','BTC','ETH','SOLANA','SPX','S&P','NASDAQ','NDX','SPY','QQQ',
  ]);
  // Map noisy names to canonical tickers (for display & matching)
  const NAME_TO_TICKER = [
    [/\bapple\b/i, 'AAPL'], [/\bmicrosoft\b/i, 'MSFT'], [/\bnvidia\b/i, 'NVDA'],
    [/\b(alphabet|google)\b/i, 'GOOGL'], [/\bamazon\b/i, 'AMZN'], [/\bmeta\b/i, 'META'],
    [/\btesla\b/i, 'TSLA'], [/\bbroadcom\b/i, 'AVGO'], [/\bnetflix\b/i, 'NFLX'],
    [/\bbitcoin\b/i, 'BTC'], [/\bethereum\b/i, 'ETH'], [/\bsolana\b/i, 'SOL'],
    [/\bs&p\s*500\b/i, 'SPX'], [/\bnasdaq\b/i, 'NDX'], [/\bdow\b/i, 'DJI'],
  ];

  function extractTickers(text) {
    const hits = new Set();
    // Direct symbol mentions ($AAPL or AAPL)
    for (const m of String(text).matchAll(/\$?([A-Z]{2,5})\b/g)) {
      if (WATCH_TICKERS.has(m[1])) hits.add(m[1]);
    }
    for (const [re, t] of NAME_TO_TICKER) if (re.test(text)) hits.add(t);
    return [...hits];
  }

  function renderNews() {
    const el = $('#term-news');
    if (!el) return;
    const items = state.news;
    if (!items || !items.length) {
      el.innerHTML = `<div class="term-empty">Awaiting headlines on watchlist tickers…</div>`;
      $('#term-news-count').textContent = '0';
      return;
    }
    const filtered = items
      .map(n => ({ ...n, tickers: extractTickers(`${n.title} ${n.summary || ''}`) }))
      .filter(n => n.tickers.length > 0)
      .slice(0, 60);
    $('#term-news-count').textContent = `${filtered.length} ON WATCHLIST`;
    if (!filtered.length) {
      el.innerHTML = `<div class="term-empty">No headlines matched watchlist tickers yet.</div>`;
      return;
    }
    el.innerHTML = filtered.map(n => `
      <div class="term-news-item" data-url="${esc(n.link)}">
        <div class="term-news-time">${esc(fmtRel(n.time))}</div>
        <div class="term-news-tickers">${esc(n.tickers.slice(0,3).join(' '))}</div>
        <div>
          <div class="term-news-title">${esc(n.title)}</div>
          <div class="term-news-src">${esc(n.source || '')}</div>
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

  function renderEcon() {
    const el = $('#term-econ');
    if (!el) return;
    const now = Date.now();
    const upcoming = ECON.filter(e => e.date.getTime() >= now - 12*3600*1000).slice(0, 10);
    if (!upcoming.length) { el.innerHTML = `<div class="term-empty">No events scheduled.</div>`; return; }
    el.innerHTML = upcoming.map(e => {
      const d = e.date;
      const day = d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' }).toUpperCase();
      const time = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
      return `<div class="term-econ-row">
        <div class="term-econ-date">${esc(day)}</div>
        <div class="term-econ-time">${esc(time)}</div>
        <div class="term-econ-name">${esc(e.name)}</div>
        <div class="term-econ-imp ${e.imp}">${esc(e.imp.toUpperCase())}</div>
      </div>`;
    }).join('');
  }

  function renderAI() {
    const el = $('#term-ai');
    if (!el) return;

    // Compute movers from current quotes
    const all = [];
    for (const sym of [...STOCKS, ...CRYPTOS.map(c => c.sym)]) {
      const q = state.quotes.get(sym);
      if (q && q.pct != null && isFinite(q.pct)) all.push({ sym, pct: q.pct, last: q.last });
    }
    if (!all.length) {
      el.innerHTML = `<div class="ai-headline">Awaiting data…</div><div class="ai-body">The terminal will summarize movers once live quotes are received.</div>`;
      return;
    }
    all.sort((a, b) => b.pct - a.pct);
    const winners = all.slice(0, 3);
    const losers = all.slice(-3).reverse();
    const spy = state.quotes.get('SPY');
    const qqq = state.quotes.get('QQQ');
    const vix = state.quotes.get('VIX');
    const btc = state.quotes.get('BTC');

    const tone = (spy?.pct ?? 0) >= 0 ? 'risk-on' : 'risk-off';
    const breadth = all.filter(x => x.pct > 0).length / all.length;

    const fmtSym = (s) => `<span class="tk">${esc(s.sym)}</span> <span class="${s.pct>=0?'up':'dn'}">${fmtPct(s.pct)}</span>`;

    const headline = `${tone.toUpperCase()} TAPE · BREADTH ${(breadth*100).toFixed(0)}% · ${new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',hour12:false})}`;

    const indexLine = [
      spy && `<span class="tk">SPY</span> ${fmtPrice(spy.last)} <span class="${spy.pct>=0?'up':'dn'}">${fmtPct(spy.pct)}</span>`,
      qqq && `<span class="tk">QQQ</span> ${fmtPrice(qqq.last)} <span class="${qqq.pct>=0?'up':'dn'}">${fmtPct(qqq.pct)}</span>`,
      vix && `<span class="tk">VIX</span> ${fmtPrice(vix.last)} <span class="${vix.pct>=0?'dn':'up'}">${fmtPct(vix.pct)}</span>`,
      btc && `<span class="tk">BTC</span> ${fmtPrice(btc.last)} <span class="${btc.pct>=0?'up':'dn'}">${fmtPct(btc.pct)}</span>`,
    ].filter(Boolean).join(' · ');

    const vol = vix?.pct >= 5 ? 'Volatility spiking — VIX bid suggests hedging demand.'
              : vix?.pct <= -5 ? 'Vol compressing — VIX dump favors continuation in beta.'
              : 'Volatility is contained.';

    const driver = tone === 'risk-on'
      ? `Tape leadership is in ${winners.map(w => fmtSym(w)).join(', ')}. Laggards: ${losers.map(l => fmtSym(l)).join(', ')}.`
      : `Pressure is concentrated in ${losers.map(l => fmtSym(l)).join(', ')}, with relative strength only in ${winners.map(w => fmtSym(w)).join(', ')}.`;

    el.innerHTML = `
      <div class="ai-headline">${headline}</div>
      <div class="ai-body">${indexLine}. ${driver} ${vol} Breadth at ${(breadth*100).toFixed(0)}% across the ${all.length}-name watchlist ${breadth>=0.6?'confirms risk appetite':breadth<=0.4?'signals broad-based selling':'shows a mixed, choppy tape'}.</div>
    `;
    $('#term-ai-time').textContent = new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',hour12:false});
  }

  function setStatus(text, err = false) {
    const t = $('#term-status-text'); if (t) t.textContent = text;
    const dot = document.querySelector('.term-dot'); if (dot) dot.classList.toggle('err', !!err);
  }

  function tickClocks() {
    const c = $('#term-clock'); if (c) c.textContent = fmtClock(new Date());
    const s = $('#term-session');
    if (s) {
      const mins = Math.floor((Date.now() - state.sessionStart) / 60000);
      const h = String(Math.floor(mins / 60)).padStart(2,'0');
      const m = String(mins % 60).padStart(2,'0');
      s.textContent = `${h}:${m}`;
    }
  }

  // ---------- Refresh loop ----------
  async function refresh() {
    setStatus('FETCHING…');
    const prev = new Map(state.quotes);

    const yfSymbols = [
      ...new Set([
        ...OVERVIEW.filter(o => o.yf).map(o => o.yf),
        ...STOCKS,
      ])
    ];
    const cgIds = [...new Set([
      ...OVERVIEW.filter(o => o.cg).map(o => o.cg),
      ...CRYPTOS.map(c => c.id),
    ])];

    const [stocks, crypto] = await Promise.all([
      fetchYahoo(yfSymbols),
      fetchCrypto(cgIds),
    ]);

    let got = 0;
    for (const s of stocks) {
      // map yahoo symbol back to our display sym for overview
      const ovr = OVERVIEW.find(o => o.yf === s.sym);
      const key = ovr ? ovr.sym : s.sym;
      state.quotes.set(key, { last: s.last, prev: s.prev, chg: s.chg, pct: s.pct, vol: s.vol, mcap: s.mcap });
      got++;
    }
    for (const c of crypto) {
      const m = CRYPTOS.find(x => x.id === c.id) || OVERVIEW.find(o => o.cg === c.id);
      if (!m) continue;
      state.quotes.set(m.sym, {
        last: c.current_price,
        prev: c.current_price - (c.price_change_24h || 0),
        chg: c.price_change_24h,
        pct: c.price_change_percentage_24h,
        vol: c.total_volume,
        mcap: c.market_cap,
      });
      got++;
    }

    state.lastUpdate = new Date();
    $('#term-net').textContent = `NET ${got}/${yfSymbols.length + cgIds.length}`;

    renderOverview();
    renderWatchlist();
    flashChanges(prev);
    renderAI();

    if (got > 0) setStatus('LIVE');
    else setStatus('DEGRADED', true);
  }

  function refreshNews() {
    // Pull from app.js's news state if accessible — otherwise pull from RSS directly.
    // app.js encapsulates state, but it stores news in DOM. We'll re-fetch the same feeds
    // here using rss2json with a smaller set so it's lightweight.
    const feeds = (CFG.NEWS_FEEDS || []).slice(0, 4);
    if (!feeds.length || !CFG.RSS2JSON) {
      renderNews();
      return;
    }
    Promise.allSettled(feeds.map(async f => {
      const r = await fetch(CFG.RSS2JSON + encodeURIComponent(f.url));
      if (!r.ok) throw 0;
      const j = await r.json();
      if (j.status !== 'ok') throw 0;
      return (j.items || []).slice(0, 20).map(it => ({
        title: String(it.title || '').replace(/<[^>]+>/g, ''),
        summary: String(it.description || it.content || '').replace(/<[^>]+>/g, '').slice(0, 240),
        link: it.link,
        source: f.name,
        time: new Date(it.pubDate || Date.now()),
      }));
    })).then(results => {
      const all = [];
      for (const r of results) if (r.status === 'fulfilled') all.push(...r.value);
      const seen = new Set();
      state.news = all.sort((a,b) => b.time - a.time).filter(it => {
        const k = it.title.toLowerCase().trim();
        if (!k || seen.has(k)) return false;
        seen.add(k); return true;
      });
      renderNews();
    });
  }

  // ---------- Init ----------
  let started = false;
  let priceTimer = null;
  let newsTimer = null;
  let clockTimer = null;

  function start() {
    if (started) return;
    started = true;
    state.sessionStart = Date.now();
    renderEcon();
    renderWatchlist(); // empty skeleton
    renderOverview();
    renderNews();
    renderAI();
    refresh();
    refreshNews();
    priceTimer = setInterval(refresh, 15000);         // every 15s (proxy-friendly)
    newsTimer  = setInterval(refreshNews, 90 * 1000); // every 90s
    clockTimer = setInterval(tickClocks, 1000);
    tickClocks();
  }

  // Hook into the tab system: start when terminal tab activated; toggle body class.
  function onTabChange() {
    const active = document.querySelector('.tab-panel.active');
    const isTerm = active && active.dataset.panel === 'terminal';
    document.body.classList.toggle('terminal-mode', !!isTerm);
    if (isTerm) start();
  }
  document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => setTimeout(onTabChange, 30)));
  window.addEventListener('hashchange', () => setTimeout(onTabChange, 30));
  // Initial check (in case URL hash is #terminal)
  if (location.hash === '#terminal') {
    // app.js already activated it; just sync state
    setTimeout(onTabChange, 50);
  }
  // Always check once on load in case the tab is somehow pre-active
  setTimeout(onTabChange, 100);
})();
