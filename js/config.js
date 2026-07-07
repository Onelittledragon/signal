// SIGNAL configuration
// ---------------------------------------------------------------------------
// The live geopolitical briefing is generated server-side by /api/geo using
// the ANTHROPIC_API_KEY environment variable (set it in Vercel). Pasting a
// key below overrides that with direct-from-browser calls — local dev only;
// never commit a key here.
//
// Get a key: https://console.anthropic.com/
window.SIGNAL_CONFIG = {
  CLAUDE_API_KEY: "",
  CLAUDE_MODEL: "claude-sonnet-4-20250514",
  REFRESH_MS: 60 * 1000,

  // CORS proxies tried in order — some endpoints don't serve CORS headers.
  CORS_PROXIES: [
    "https://corsproxy.io/?",
    "https://api.allorigins.win/raw?url=",
    "https://api.codetabs.com/v1/proxy?quest=",
  ],
  // Wrapping proxy — returns JSON { contents: "..." } so we read it back out.
  CORS_JSON_WRAPPER: "https://api.allorigins.win/get?url=",

  // RSS2JSON converts RSS into JSON over HTTPS with CORS headers.
  RSS2JSON: "https://api.rss2json.com/v1/api.json?rss_url=",

  NEWS_FEEDS: [
    { name: "Reuters Business", url: "https://feeds.reuters.com/reuters/businessNews" },
    { name: "Yahoo Finance",     url: "https://finance.yahoo.com/news/rssindex" },
    { name: "CNBC Markets",      url: "https://www.cnbc.com/id/10000664/device/rss/rss.html" },
    { name: "MarketWatch",       url: "https://feeds.content.dowjones.io/public/rss/mw_topstories" },
    { name: "Investing.com",     url: "https://www.investing.com/rss/news_25.rss" },
  ],
};
