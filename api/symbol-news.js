// Per-symbol company news — edge-cached.
// Fetches recent headlines for a single ticker from Finnhub's company-news
// endpoint, keeping FINNHUB_API_KEY server-side (this repo is public).
// Usage:  /api/symbol-news?symbol=AAPL

export const config = { runtime: 'edge' };

const FINNHUB_KEY =
  (typeof process !== 'undefined' && process.env && process.env.FINNHUB_API_KEY) || '';

function jsonResponse(body, status, cache) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': cache,
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

export default async function handler(req) {
  try {
    const url = new URL(req.url);
    const raw = url.searchParams.get('symbol') || '';
    // Sanitize: uppercase letters, digits, dot and dash only.
    const symbol = raw.toUpperCase().replace(/[^A-Z0-9.\-]/g, '').slice(0, 12);

    if (!symbol) {
      return jsonResponse({ error: 'Missing symbol. Try ?symbol=AAPL' }, 400, 'no-store');
    }
    if (!FINNHUB_KEY) {
      return jsonResponse(
        { error: 'Symbol news is unavailable — FINNHUB_API_KEY is not set.' },
        503, 'no-store'
      );
    }

    // Finnhub company-news needs a date window; last 14 days.
    const now = new Date();
    const from = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const api = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}` +
      `&from=${ymd(from)}&to=${ymd(now)}&token=${FINNHUB_KEY}`;

    const r = await fetch(api, { cache: 'no-store' });
    if (!r.ok) throw new Error(`finnhub ${r.status}`);
    const arr = await r.json();

    const seen = new Set();
    const items = (Array.isArray(arr) ? arr : [])
      .filter((it) => it && it.headline && it.datetime)
      .filter((it) => {
        const k = String(it.headline).toLowerCase().trim();
        if (!k || seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .sort((a, b) => b.datetime - a.datetime)
      .slice(0, 40)
      .map((it, i) => ({
        id: `${it.datetime}-${i}`,
        headline: it.headline,
        source: it.source || 'Wire',
        url: it.url || '',
        time: it.datetime * 1000,
        summary: it.summary || '',
      }));

    return jsonResponse(
      { ts: Date.now(), symbol, count: items.length, items },
      200,
      'public, s-maxage=60, stale-while-revalidate=300'
    );
  } catch (e) {
    return jsonResponse({ error: String(e?.message || e) }, 502, 'no-store');
  }
}
