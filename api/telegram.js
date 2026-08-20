// Telegram push for Keyword Alerts.
// Sends a message to your Telegram chat using a bot token kept server-side.
// Set these in Vercel (Project > Settings > Environment Variables):
//   TELEGRAM_BOT_TOKEN  — from @BotFather
//   TELEGRAM_CHAT_ID    — your chat id (from @userinfobot or getUpdates)
// Until both are set, this endpoint returns 503 and the feature stays inactive.

export const config = { runtime: 'edge' };

const TOKEN =
  (typeof process !== 'undefined' && process.env &&
    (process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_TOKEN)) || '';
const CHAT_ID =
  (typeof process !== 'undefined' && process.env && process.env.TELEGRAM_CHAT_ID) || '';

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' },
  });
}

export default async function handler(req) {
  try {
    if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
    if (!TOKEN || !CHAT_ID) return json({ error: 'Telegram not configured' }, 503);

    let text = '';
    try { const b = await req.json(); text = String(b && b.text || '').slice(0, 3500); } catch (e) {}
    if (!text) return json({ error: 'Missing text' }, 400);

    const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT_ID, text, disable_web_page_preview: true }),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      return json({ error: `telegram ${r.status}${t ? ': ' + t.slice(0, 160) : ''}` }, 502);
    }
    return json({ ok: true }, 200);
  } catch (e) {
    return json({ error: String(e?.message || e) }, 502);
  }
}
