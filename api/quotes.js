// Edge-cached server-side quote fetcher.
// Every browser hits this single endpoint and gets the SAME response
// (cached at Vercel's edge for ~3s). No more public CORS proxies, no more
// per-device divergence.

export const config = { runtime: 'edge' };

const FUTURES = [
  { sym: 'NQ', yf: 'NQ=F' },
  { sym: 'ES', yf: 'ES=F' },
];

const STOCKS = [
  'AAPL','MSFT','NVDA','GOOGL','AMZN','META','TSLA','AVGO','AMD','NFLX',
  'COST','JPM','V','WMT','XOM',
  'ADBE','CRM','CSCO','ACN','IBM','QCOM','TXN','INTC','NOW','INTU','AMAT','MU','PANW','ANET','ORCL',
  'DIS','TMUS','VZ','CMCSA','T',
  'HD','MCD','NKE','LOW','SBUX','BKNG','TJX',
  'MA','BAC','WFC','GS','MS','BLK','AXP','C','SCHW','SPGI',
  'LLY','UNH','JNJ','MRK','ABBV','PFE','TMO','ABT','ISRG','AMGN','DHR','BMY','MRNA','SLS',
  'PG','KO','PEP','PM','MO',
  'CVX','COP',
  'GE','RTX','CAT','HON','BA','UPS','UNP','LMT',
  'LIN','SHW','NEE','SO','PLD','AMT',
];

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; SIGNAL/1.0)',
  'Accept': 'application/json',
};

async function fetchYahooChunk(symbols) {
  const url = `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(symbols.join(','))}&range=1d&interval=5m`;
  const r = await fetch(url, { headers: YF_HEADERS, cache: 'no-store' });
  if (!r.ok) throw new Error('yahoo ' + r.status);
  const j = await r.json();
  return j?.spark?.result || [];
}

async function fetchCrypto() {
  const url = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true';
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error('coingecko ' + r.status);
  const j = await r.json();
  const d = j?.bitcoin;
  if (!d) return [];
  const price = d.usd;
  const pct = d.usd_24h_change;
  const chg = (price != null && pct != null) ? price - price / (1 + pct/100) : null;
  return [{
    sym: 'BTC',
    last: price, chg, pct,
    vol: d.usd_24h_vol,
    mcap: d.usd_market_cap,
    high: null, low: null, spark: null,
  }];
}

function normalizeYahoo(results) {
  const out = [];
  for (const r of results) {
    const resp = r?.response?.[0];
    const meta = resp?.meta;
    if (!meta) continue;
    const last = meta.regularMarketPrice;
    const prev = meta.chartPreviousClose ?? meta.previousClose;
    const chg = (last != null && prev != null) ? last - prev : null;
    const pct = (chg != null && prev) ? (chg / prev) * 100 : null;
    const closes = resp?.indicators?.quote?.[0]?.close;
    const spark = Array.isArray(closes) ? closes.filter(v => v != null) : null;
    out.push({
      sym: r.symbol,
      last, prev, chg, pct,
      vol: meta.regularMarketVolume,
      high: meta.regularMarketDayHigh,
      low: meta.regularMarketDayLow,
      spark,
    });
  }
  return out;
}

export default async function handler() {
  const symbols = [...FUTURES.map(f => f.yf), ...STOCKS];
  const chunks = [];
  for (let i = 0; i < symbols.length; i += 18) chunks.push(symbols.slice(i, i + 18));

  try {
    const [stockBatches, crypto] = await Promise.all([
      Promise.allSettled(chunks.map(fetchYahooChunk)),
      fetchCrypto().catch(() => []),
    ]);

    const raw = [];
    for (const b of stockBatches) if (b.status === 'fulfilled') raw.push(...b.value);
    const stocks = normalizeYahoo(raw);

    // Map yf symbol → display symbol for futures.
    const yfToSym = new Map(FUTURES.map(f => [f.yf, f.sym]));
    const quotes = {};
    for (const s of stocks) {
      const key = yfToSym.get(s.sym) || s.sym;
      quotes[key] = { ...s, sym: key };
    }
    for (const c of crypto) quotes[c.sym] = c;

    const body = JSON.stringify({
      ts: Date.now(),
      quotes,
    });

    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        // All clients share the same edge-cached payload for 3s, then
        // stale-while-revalidate keeps it instant while we refresh in the background.
        'Cache-Control': 'public, s-maxage=3, stale-while-revalidate=10',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 502,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
}
