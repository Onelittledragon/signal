// SIGNAL // Keyword Alerts.
// Watches the live news wire (/api/wire) for user keywords/phrases while the
// dashboard is open. Collects matches in the Alerts tab, badges new ones, and
// (optionally) forwards new matches to Telegram via /api/telegram.
(function () {
  'use strict';

  var LS_KEYS = 'signal.alerts.keywords';
  var LS_TG   = 'signal.alerts.telegram';
  var LS_SEEN = 'signal.alerts.seenKeys';
  var LS_NOTIFIED = 'signal.alerts.notifiedKeys';
  var POLL_MS = 45 * 1000;

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  function relTime(ms) {
    var diff = Date.now() - ms;
    if (!isFinite(diff) || diff < 0) return '';
    var m = Math.round(diff / 60000);
    if (m < 60) return m <= 1 ? 'just now' : m + 'm ago';
    var h = Math.round(m / 60);
    if (h < 24) return h + 'h ago';
    return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function parseKeywords(raw) {
    return String(raw || '')
      .split(',')
      .map(function (s) { return s.trim().toLowerCase(); })
      .filter(function (s) { return s.length > 0; });
  }
  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  // Whole-word/phrase matcher so "dram" doesn't match "microdramas".
  function buildMatchers(list) {
    return list.map(function (k) { return { kw: k, re: new RegExp('(^|[^a-z0-9])' + escapeRe(k) + '([^a-z0-9]|$)', 'i') }; });
  }
  // Stable key for a story so the same headline is only ever counted once,
  // even though the wire re-numbers item ids on every poll.
  function keyOf(it) { return String(it && it.headline || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

  function init() {
    var input = $('alerts-input');
    var saveBtn = $('alerts-save');
    var clearBtn = $('alerts-clear');
    var tgToggle = $('alerts-tg-toggle');
    var statusEl = $('alerts-status');
    var results = $('alerts-results');
    var emptyEl = $('alerts-empty');
    var countEl = $('alerts-count');
    var badge = $('alerts-badge');
    if (!input || !results) return;

    var keywords = parseKeywords(lsGet(LS_KEYS, ''));
    var matchers = buildMatchers(keywords);
    input.value = lsGet(LS_KEYS, '');
    tgToggle.checked = lsGet(LS_TG, '') === '1';

    var matches = [];              // collected matching items (newest first)
    var matchKeys = {};            // stable story key -> true, avoids list dupes
    var seen = {};                 // stable keys the user has viewed (badge)
    var notified = {};             // stable keys already pushed to Telegram
    try { (JSON.parse(lsGet(LS_SEEN, '[]')) || []).forEach(function (k) { seen[k] = true; }); } catch (e) {}
    try { (JSON.parse(lsGet(LS_NOTIFIED, '[]')) || []).forEach(function (k) { notified[k] = true; }); } catch (e) {}
    var unseenCount = 0;
    var backfill = true;  // first scan (and after a keyword change) seeds silently — no badge, no Telegram

    function setStatus(msg, isErr) {
      if (!msg) { statusEl.hidden = true; statusEl.textContent = ''; return; }
      statusEl.hidden = false; statusEl.textContent = msg;
      statusEl.classList.toggle('is-error', !!isErr);
    }
    function saveSeen() {
      lsSet(LS_SEEN, JSON.stringify(Object.keys(seen).slice(-500)));
    }
    function saveNotified() {
      lsSet(LS_NOTIFIED, JSON.stringify(Object.keys(notified).slice(-500)));
    }
    function updateBadge() {
      if (unseenCount > 0) { badge.hidden = false; badge.textContent = unseenCount > 99 ? '99+' : String(unseenCount); }
      else { badge.hidden = true; }
    }
    function matchedKeyword(text) {
      for (var i = 0; i < matchers.length; i++) { if (matchers[i].re.test(text)) return matchers[i].kw; }
      return null;
    }

    function render() {
      countEl.textContent = String(matches.length);
      clearBtn.hidden = matches.length === 0;
      emptyEl.style.display = matches.length ? 'none' : '';
      results.innerHTML = matches.map(function (n) {
        var isNew = !seen[n.key];
        var t = relTime(n.time);
        var inner =
          '<div class="alert-item-meta">' +
            '<span class="alert-item-src">' + esc(n.source || '') + '</span>' +
            '<span class="alert-item-kw">' + esc(n.kw) + '</span>' +
            (t ? '<span class="alert-item-time">' + esc(t) + '</span>' : '') +
          '</div>' +
          '<div class="alert-item-head">' + (isNew ? '<span class="alert-new">NEW</span> ' : '') + esc(n.headline) + '</div>';
        return n.url
          ? '<a class="alert-item" href="' + esc(n.url) + '" target="_blank" rel="noopener noreferrer">' + inner + '</a>'
          : '<div class="alert-item">' + inner + '</div>';
      }).join('');
    }

    function sendTelegram(item) {
      if (!tgToggle.checked) return;
      var text = '🔔 SIGNAL alert (' + item.kw + ')\n' + item.headline + (item.source ? '\n— ' + item.source : '') + (item.url ? '\n' + item.url : '');
      fetch('/api/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text })
      }).then(function (r) {
        if (!r.ok && r.status === 503) setStatus('Telegram isn’t set up yet — see the guide to add your bot token.', true);
      }).catch(function () {});
    }

    async function poll() {
      if (!keywords.length) return;
      try {
        var r = await fetch('/api/wire', { cache: 'no-store' });
        if (!r.ok) return;
        var data = await r.json();
        var items = (data && data.items) || [];
        var newlyAdded = [];
        // Oldest-first so newest ends up on top after unshift.
        for (var i = items.length - 1; i >= 0; i--) {
          var it = items[i];
          if (!it || !it.headline) continue;
          var k = keyOf(it);
          if (!k || matchKeys[k]) continue;
          var hay = (it.headline + ' ' + (it.summary || '')).toLowerCase();
          var kw = matchedKeyword(hay);
          if (!kw) continue;
          var rec = { key: k, headline: it.headline, source: it.source, url: it.url, time: it.time, kw: kw };
          matchKeys[k] = true;
          matches.unshift(rec);
          newlyAdded.push(rec);
        }
        if (matches.length > 100) matches = matches.slice(0, 100);
        // Badge counts unseen stories; Telegram fires once per unique story.
        newlyAdded.forEach(function (rec) {
          if (backfill) { seen[rec.key] = true; notified[rec.key] = true; return; }
          if (!seen[rec.key]) unseenCount++;
          if (!notified[rec.key]) { notified[rec.key] = true; saveNotified(); sendTelegram(rec); }
        });
        if (backfill) { saveSeen(); saveNotified(); backfill = false; }
        if (newlyAdded.length) {
          render(); updateBadge();
          // If the user is already looking at the Alerts tab, don't nag.
          var panel = document.querySelector('.tab-panel[data-panel="alerts"]');
          if (panel && panel.classList.contains('active')) markAllSeen();
        }
      } catch (e) { /* ignore transient errors */ }
    }

    function markAllSeen() {
      matches.forEach(function (n) { seen[n.key] = true; });
      unseenCount = 0; saveSeen(); updateBadge(); render();
    }

    saveBtn.addEventListener('click', function () {
      keywords = parseKeywords(input.value);
      matchers = buildMatchers(keywords);
      lsSet(LS_KEYS, input.value);
      // Rebuild the list against the new keywords; seed silently (no Telegram burst).
      matches = []; matchKeys = {}; backfill = true;
      setStatus(keywords.length ? ('Watching for: ' + keywords.join(', ')) : 'Enter at least one keyword to start watching.', !keywords.length);
      render();
      poll();
    });
    tgToggle.addEventListener('change', function () {
      lsSet(LS_TG, tgToggle.checked ? '1' : '0');
      setStatus(tgToggle.checked ? 'Telegram forwarding on (requires bot setup to actually send).' : 'Telegram forwarding off.', false);
    });
    clearBtn.addEventListener('click', function () {
      matches = []; matchIds = {}; render();
    });

    // When the user opens the Alerts tab, clear the "new" badge.
    document.querySelectorAll('.tab-btn').forEach(function (b) {
      if (b.dataset.tab === 'alerts') b.addEventListener('click', function () { setTimeout(markAllSeen, 400); });
    });
    if ((location.hash || '') === '#alerts') setTimeout(markAllSeen, 600);

    if (keywords.length) setStatus('Watching for: ' + keywords.join(', '));
    poll();
    setInterval(poll, POLL_MS);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
