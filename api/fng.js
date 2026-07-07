// CNN Fear & Greed index — edge-cached proxy.
// CNN's dataviz endpoint rejects non-browser clients, so we fetch it
// server-side with browser headers and return a trimmed payload every
// client can share from the edge cache.

export const config = { runtime: 'edge' };

const URL = 'https://production.dataviz.cnn.io/index/fearandgreed/graphdata';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Origin': 'https://edition.cnn.com',
  'Referer': 'https://edition.cnn.com/',
};

export default async function handler() {
  try {
    const r = await fetch(URL, { headers: HEADERS, cache: 'no-store' });
    if (!r.ok) throw new Error('cnn ' + r.status);
    const j = await r.json();
    const fg = j?.fear_and_greed;
    if (!fg || fg.score == null) throw new Error('cnn payload shape');

    // Last ~30 daily points for the sparkline.
    const hist = (j?.fear_and_greed_historical?.data || [])
      .slice(-30)
      .map((p) => ({ t: p.x, v: Math.round(p.y * 10) / 10 }));

    const body = JSON.stringify({
      ts: Date.now(),
      score: Math.round(fg.score * 10) / 10,
      rating: fg.rating,
      prevClose: Math.round(fg.previous_close * 10) / 10,
      week: Math.round(fg.previous_1_week * 10) / 10,
      month: Math.round(fg.previous_1_month * 10) / 10,
      year: Math.round(fg.previous_1_year * 10) / 10,
      history: hist,
    });

    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800',
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
