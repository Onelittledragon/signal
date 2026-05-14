// Edge-cached server-side news fetcher.
// Parses RSS feeds directly (no rss2json third-party dependency) so every
// device sees the same headline list and the same ordering.

export const config = { runtime: 'edge' };

const FEEDS = [
  { name: 'Reuters Business', url: 'https://feeds.reuters.com/reuters/businessNews' },
  { name: 'Yahoo Finance',    url: 'https://finance.yahoo.com/news/rssindex' },
  { name: 'CNBC Markets',     url: 'https://www.cnbc.com/id/10000664/device/rss/rss.html' },
  { name: 'MarketWatch',      url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories' },
  { name: 'Investing.com',    url: 'https://www.investing.com/rss/news_25.rss' },
];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; SIGNAL/1.0)',
  'Accept': 'application/rss+xml, application/xml, text/xml, */*',
};

const stripTags = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

function extract(block, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = block.match(re);
  return m ? m[1] : '';
}

function parseFeed(xml, source) {
  const items = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks.slice(0, 25)) {
    const title = stripTags(extract(b, 'title'));
    if (!title) continue;
    let link = stripTags(extract(b, 'link'));
    if (!link) {
      const m = b.match(/<link[^>]*href="([^"]+)"/i);
      if (m) link = m[1];
    }
    const dateStr = extract(b, 'pubDate') || extract(b, 'updated') || extract(b, 'published') || '';
    const time = new Date(dateStr || Date.now()).toISOString();
    const summary = stripTags(extract(b, 'description') || extract(b, 'summary') || extract(b, 'content'));
    items.push({
      title,
      link,
      source,
      category: source.split(' ')[0],
      time,
      summary: summary.slice(0, 260),
    });
  }
  return items;
}

async function fetchFeed(feed) {
  const r = await fetch(feed.url, { headers: HEADERS, cache: 'no-store' });
  if (!r.ok) throw new Error(feed.name + ' ' + r.status);
  const xml = await r.text();
  return parseFeed(xml, feed.name);
}

export default async function handler() {
  try {
    const results = await Promise.allSettled(FEEDS.map(fetchFeed));
    const all = [];
    for (const r of results) if (r.status === 'fulfilled') all.push(...r.value);

    // Dedupe by normalised title, newest first.
    const seen = new Set();
    const items = all
      .sort((a, b) => new Date(b.time) - new Date(a.time))
      .filter((n) => {
        const k = n.title.toLowerCase().replace(/\s+/g, ' ').trim();
        if (!k || seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, 60);

    return new Response(JSON.stringify({ ts: Date.now(), items }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=120',
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
