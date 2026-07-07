// Economic calendar — edge-cached proxy over ForexFactory's weekly JSON feed.
// Returns upcoming (next 72h) events for the currencies that move NQ/ES,
// normalized and sorted so the client just renders.

export const config = { runtime: 'edge' };

const URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';

// USD events always matter for index futures; other majors only when
// medium/high impact so the list stays scannable.
const MAJORS = new Set(['EUR', 'GBP', 'JPY', 'CNY', 'CHF', 'CAD', 'AUD', 'NZD']);

// ForexFactory rate-limits per IP — one polite retry, and a browser UA.
async function fetchCalendar() {
  const opts = {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept': 'application/json',
    },
    cache: 'no-store',
  };
  let r = await fetch(URL, opts);
  if (r.status === 429) {
    await new Promise((res) => setTimeout(res, 1500));
    r = await fetch(URL, opts);
  }
  if (!r.ok) throw new Error('calendar ' + r.status);
  return r.json();
}

export default async function handler() {
  try {
    const arr = await fetchCalendar();
    if (!Array.isArray(arr)) throw new Error('calendar payload shape');

    const now = Date.now();
    const HORIZON = 72 * 3600 * 1000;   // next 3 days
    const GRACE = 2 * 3600 * 1000;      // keep events from the last 2h ("just released")

    const items = arr
      .map((e) => {
        const t = Date.parse(e.date);
        return {
          title: String(e.title || '').trim(),
          country: String(e.country || '').toUpperCase(),
          time: Number.isFinite(t) ? t : null,
          impact: String(e.impact || 'Low').toLowerCase(),   // high | medium | low | holiday
          forecast: String(e.forecast || '').trim(),
          previous: String(e.previous || '').trim(),
        };
      })
      .filter((e) => e.title && e.time && e.time > now - GRACE && e.time < now + HORIZON)
      .filter((e) => {
        if (e.impact === 'holiday') return false;
        if (e.country === 'USD') return true;
        return MAJORS.has(e.country) && (e.impact === 'high' || e.impact === 'medium');
      })
      .sort((a, b) => a.time - b.time)
      .slice(0, 40);

    return new Response(JSON.stringify({ ts: now, items }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600',
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
