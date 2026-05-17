// Markets page — grid of live TradingView embedded charts.
// Each card lazy-mounts its widget the first time the tab is shown.

(() => {
  // Note: TradingView's free embed widget rejects continuous-contract futures
  // tickers (e.g. CME_MINI:NQ1!), so we back each futures card with the
  // matching cash index — same intraday read, but actually streams.
  const INSTRUMENTS = [
    { key: "NQ",      label: "Nasdaq 100 (NQ proxy)",   symbol: "FOREXCOM:NSXUSD" },
    { key: "ES",      label: "S&P 500 (ES proxy)",      symbol: "FOREXCOM:SPXUSD" },
    { key: "YM",      label: "Dow Jones (YM proxy)",    symbol: "FOREXCOM:DJI" },
    { key: "RTY",     label: "Russell 2000 (RTY proxy)",symbol: "AMEX:IWM" },
    { key: "CL",      label: "Crude Oil (WTI)",         symbol: "TVC:USOIL" },
    { key: "GC",      label: "Gold",                    symbol: "OANDA:XAUUSD" },
    { key: "SI",      label: "Silver",                  symbol: "OANDA:XAGUSD" },
    { key: "DXY",     label: "US Dollar Index",         symbol: "TVC:DXY" },
    { key: "BTCUSD",  label: "Bitcoin / USD",           symbol: "BITSTAMP:BTCUSD" },
    { key: "EURUSD",  label: "Euro / USD",              symbol: "FX:EURUSD" },
    { key: "GBPUSD",  label: "British Pound / USD",     symbol: "FX:GBPUSD" },
    { key: "US10Y",   label: "US 10Y Treasury Yield",   symbol: "TVC:TNX" },
  ];

  let mounted = false;

  function buildGrid() {
    const grid = document.getElementById("markets-grid");
    if (!grid) return;
    grid.innerHTML = "";
    INSTRUMENTS.forEach((inst) => {
      const card = document.createElement("div");
      card.className = "market-card";
      card.innerHTML = `
        <div class="market-card-head">
          <div class="market-card-symbol">${inst.key}</div>
          <div class="market-card-name">${inst.label}</div>
        </div>
        <div class="market-card-chart" data-symbol="${inst.symbol}"></div>
      `;
      grid.appendChild(card);
    });
  }

  function mountWidgets() {
    const cards = document.querySelectorAll("#markets-grid .market-card-chart");
    cards.forEach((host) => {
      if (host.dataset.mounted === "1") return;
      host.dataset.mounted = "1";
      const symbol = host.dataset.symbol;

      // TradingView's Advanced Real-Time Chart widget. We give each chart its
      // own container div so the embed script can target it.
      const containerId = "tvchart-" + symbol.replace(/[^A-Za-z0-9]/g, "_");
      host.innerHTML = `<div id="${containerId}" style="height:100%;width:100%;"></div>`;

      const script = document.createElement("script");
      script.type = "text/javascript";
      script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
      script.async = true;
      script.innerHTML = JSON.stringify({
        autosize: true,
        symbol: symbol,
        interval: "60",
        timezone: "Etc/UTC",
        theme: "dark",
        style: "1",
        locale: "en",
        toolbar_bg: "#0E1014",
        enable_publishing: false,
        hide_top_toolbar: false,
        hide_legend: false,
        save_image: false,
        backgroundColor: "rgba(14, 16, 20, 1)",
        gridColor: "rgba(36, 41, 50, 0.6)",
        allow_symbol_change: false,
        details: false,
        hide_volume: false,
        support_host: "https://www.tradingview.com",
        container_id: containerId,
      });
      host.appendChild(script);
    });
  }

  function ensureMarkets() {
    if (!mounted) {
      buildGrid();
      mounted = true;
    }
    // Mount widgets after the panel is actually visible so TradingView can
    // measure container dimensions correctly.
    requestAnimationFrame(() => requestAnimationFrame(mountWidgets));
  }

  // Hook into the existing tab system — listen for clicks on the Markets tab
  // and also init if we land on #markets directly.
  document.addEventListener("click", (e) => {
    const btn = e.target.closest('[data-tab="markets"], [data-jump="markets"]');
    if (btn) ensureMarkets();
  });

  if ((location.hash || "").slice(1) === "markets") {
    // Wait a tick so the tab switch has applied.
    setTimeout(ensureMarkets, 0);
  }
})();
