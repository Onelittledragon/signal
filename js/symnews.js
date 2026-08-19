// SIGNAL // Search news by symbol.
// Calls /api/symbol-news?symbol=XXX and renders headlines for that ticker.
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // "3m ago" / "2h ago" / "Aug 19" style relative time.
  function relTime(ms) {
    const diff = Date.now() - ms;
    if (!isFinite(diff) || diff < 0) return '';
    const m = Math.round(diff / 60000);
    if (m < 60) return m <= 1 ? 'just now' : m + 'm ago';
    const h = Math.round(m / 60);
    if (h < 24) return h + 'h ago';
    const d = new Date(ms);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function init() {
    const input = $('symnews-input');
    const goBtn = $('symnews-go');
    const clearBtn = $('symnews-clear');
    const status = $('symnews-status');
    const results = $('symnews-results');
    const feed = $('tw-feed');
    if (!input || !goBtn || !results) return;

    function setStatus(msg, isError) {
      if (!msg) { status.hidden = true; status.textContent = ''; return; }
      status.hidden = false;
      status.textContent = msg;
      status.classList.toggle('is-error', !!isError);
    }

    function showResultsMode(on) {
      results.hidden = !on;
      clearBtn.hidden = !on;
      // Hide the general live wire while showing symbol results, so the
      // page isn't two competing feeds.
      if (feed) feed.style.display = on ? 'none' : '';
    }

    function clearResults() {
      results.innerHTML = '';
      showResultsMode(false);
      setStatus('');
      input.value = '';
      input.focus();
    }

    async function search() {
      const symbol = (input.value || '').toUpperCase().replace(/[^A-Z0-9.\-]/g, '').slice(0, 12);
      if (!symbol) { setStatus('Type a stock symbol first, like AAPL.', true); return; }
      input.value = symbol;
      setStatus('Loading news for ' + symbol + '…', false);
      results.innerHTML = '';
      showResultsMode(true);
      goBtn.disabled = true;

      try {
        const r = await fetch('/api/symbol-news?symbol=' + encodeURIComponent(symbol), { cache: 'no-store' });
        const data = await r.json();
        if (!r.ok) throw new Error(data && data.error ? data.error : ('HTTP ' + r.status));

        const items = (data && data.items) || [];
        if (!items.length) {
          setStatus('No recent news found for ' + symbol + '.', false);
          return;
        }
        setStatus(items.length + ' recent stories for ' + symbol, false);

        const html = items.map(function (n) {
          const t = relTime(n.time);
          const head = esc(n.headline);
          const src = esc(n.source);
          const inner =
            '<div class="symnews-item-meta"><span class="symnews-item-src">' + src + '</span>' +
            (t ? '<span class="symnews-item-time">' + esc(t) + '</span>' : '') + '</div>' +
            '<div class="symnews-item-head">' + head + '</div>';
          return n.url
            ? '<a class="symnews-item" href="' + esc(n.url) + '" target="_blank" rel="noopener noreferrer">' + inner + '</a>'
            : '<div class="symnews-item">' + inner + '</div>';
        }).join('');
        results.innerHTML = html;
      } catch (e) {
        setStatus('Could not load news for ' + symbol + '. ' + (e && e.message ? e.message : ''), true);
      } finally {
        goBtn.disabled = false;
      }
    }

    goBtn.addEventListener('click', search);
    clearBtn.addEventListener('click', clearResults);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); search(); }
      if (e.key === 'Escape') { clearResults(); }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
