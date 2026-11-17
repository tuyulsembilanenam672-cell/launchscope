// LaunchScope's dashboard. It reads window.RADAR (written beside dashboard/
// by main.ts) and renders the ranked board, a filterable table, a live-token
// view, and a per-protocol detail panel with the model's own inputs and the
// protocol's farm plan. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;

  var params = new URLSearchParams(window.location.search);
  var state = {
    q: params.get('q') || '',
    category: params.get('category') || 'all',
    chain: params.get('chain') || 'all',
    tab: params.get('tab') === 'live' ? 'live' : 'pre',
    sort: params.get('sort') || 'implied',
    watchlistOnly: params.get('watchlist') === '1',
    selected: params.get('detail') || null,
  };

  // The watchlist is the snapshot's own list: a row is on it when its slug is
  // one of the 40 the snapshot names.
  var watchSlugs = new Set(DATA.watchlist_slugs || []);

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // The model in one function: the page recomputes a row from the snapshot
  // figures and checks the number board.json carries, so the page's code and
  // the board's data are visibly the same arithmetic.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + model.maturity_range * Math.sqrt(Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days);
    return Math.max(1, Math.round(row.tvl_usd * model.base_multiple * growthMult * maturity));
  }

  var statsEl = document.getElementById('stats');
  statsEl.innerHTML =
    '<div><dt>Protocols scored</dt><dd>' + DATA.board_size + '</dd></div>' +
    '<div><dt>Watchlist</dt><dd>' + DATA.watchlist_size + '</dd></div>' +
    '<div><dt>Early finds</dt><dd>' + DATA.early_size + '</dd></div>' +
    '<div><dt>Live tokens</dt><dd>' + DATA.live_size + '</dd></div>';

  var model = DATA.model;
  document.getElementById('model').innerHTML =
    '<b>Model ' + esc(DATA.model_version) + ':</b> implied value = TVL &times; ' + model.base_multiple +
    ' &times; growth multiplier (7d change clamped ' + model.growth_floor + '% to ' + model.growth_cap +
    '%, weight ' + model.growth_weight + ') &times; maturity (0.5 + 0.5&times;&radic;(age / ' +
    model.maturity_days + ' days), unknown age ' + model.unknown_age_days +
    ' days). Snapshot as of ' + esc(DATA.as_of) + '; watchlist floor ' + fmtUsd(DATA.floor_usd) +
    '. A protocol records no token — never that it has none.';

  document.getElementById('foot').textContent =
    'LaunchScope ranks protocols that record no token by what their token would be worth if the record stayed as it is. ' +
    'It does not predict whether or when a token is issued. Source: DefiLlama public API, fetched ' + DATA.as_of +
    '. Farm plans are the entry\u2019s own reading of each protocol\u2019s record, not financial advice.';

  var qEl = document.getElementById('q');
  var catEl = document.getElementById('category');
  var chainEl = document.getElementById('chain');
  var sortEl = document.getElementById('sort');
  var wlEl = document.getElementById('watchlist');
  var tabPre = document.getElementById('tab-pre');
  var tabLive = document.getElementById('tab-live');
  var rowsEl = document.getElementById('rows');
  var countEl = document.getElementById('count');
  var detailEl = document.getElementById('detail');
  var headRow = document.querySelector('#board thead tr');

  function fillOptions(el, values, label) {
    var html = '<option value="all">' + label + '</option>';
    values.forEach(function (v) { html += '<option value="' + esc(v) + '">' + esc(v) + '</option>'; });
    el.innerHTML = html;
  }
  var categories = [];
  var chains = [];
  DATA.rows.forEach(function (r) {
    if (r.category && categories.indexOf(r.category) < 0) categories.push(r.category);
    (r.chains || []).forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  categories.sort();
  chains.sort();
  fillOptions(catEl, categories, 'All categories');
  fillOptions(chainEl, chains, 'All chains');

  qEl.value = state.q;
  catEl.value = state.category;
  chainEl.value = state.chain;
  sortEl.value = state.sort;
  wlEl.checked = state.watchlistOnly;

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var rows = DATA.rows.filter(function (r) {
      if (state.watchlistOnly && !watchSlugs.has(r.slug)) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var dir = state.sort === 'name' ? 1 : -1;
    var key = state.sort;
    rows.sort(function (a, b) {
      if (key === 'implied') return (b.implied_value_usd - a.implied_value_usd) || (a.rank - b.rank);
      if (key === 'tvl') return (b.tvl_usd - a.tvl_usd) || (a.rank - b.rank);
      if (key === 'growth') return ((b.change_7d === null ? -Infinity : b.change_7d) - (a.change_7d === null ? -Infinity : a.change_7d)) || (a.rank - b.rank);
      if (key === 'age') return ((b.age_days === null ? -1 : b.age_days) - (a.age_days === null ? -1 : a.age_days)) || (a.rank - b.rank);
      return (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1) * dir;
    });
    return rows;
  }

  function liveRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.live.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }

  function render() {
    tabPre.classList.toggle('on', state.tab === 'pre');
    tabLive.classList.toggle('on', state.tab === 'live');
    tabPre.setAttribute('aria-selected', state.tab === 'pre' ? 'true' : 'false');
    tabLive.setAttribute('aria-selected', state.tab === 'live' ? 'true' : 'false');
    if (state.tab === 'live') {
      headRow.innerHTML = '<th class="num">#</th><th>Protocol</th><th>Category</th><th>Chains</th><th class="num">TVL</th><th class="num">7d</th><th class="num">Market cap</th><th class="num">TVL / mcap</th>';
      var live = liveRows();
      rowsEl.innerHTML = live.map(function (r, i) {
        var ratio = r.mcap_usd ? (r.tvl_usd / r.mcap_usd).toFixed(2) + 'x' : 'n/a';
        var pct = fmtPct(r.change_7d);
        var cls = r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down';
        return '<tr><td class="num">' + (i + 1) + '</td><td>' + esc(r.name) + '</td><td>' + esc(r.category || '—') + '</td><td>' + esc((r.chains || []).join(', ') || '—') + '</td><td class="num">' + fmtUsd(r.tvl_usd) + '</td><td class="num ' + cls + '">' + pct + '</td><td class="num">' + fmtUsd(r.mcap_usd) + '</td><td class="num">' + ratio + '</td></tr>';
      }).join('') || '<tr><td colspan="8" class="empty">No live token matches this filter.</td></tr>';
      countEl.textContent = live.length + ' live-token protocols (already trading — shown at the market\u2019s own value, never ranked).';
      if (!state.selected) renderDetail(null);
      return;
    }
    headRow.innerHTML = '<th class="num">#</th><th>Protocol</th><th>Category</th><th>Chains</th><th class="num">TVL</th><th class="num">7d</th><th class="num">Age</th><th class="num">Implied value</th>';
    var rows = filteredRows();
    rowsEl.innerHTML = rows.map(function (r) {
      var pct = fmtPct(r.change_7d);
      var cls = r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down';
      var badge = watchSlugs.has(r.slug) ? '<span class="badge">WATCHLIST</span>' : '';
      var sel = state.selected === r.slug ? ' class="sel"' : '';
      return '<tr data-slug="' + esc(r.slug) + '"' + sel + '><td class="num">' + r.rank + '</td><td>' + esc(r.name) + badge + '<br><span style="color:var(--muted);font-size:12px">' + esc(r.slug) + '</span></td><td>' + esc(r.category || '—') + '</td><td>' + esc((r.chains || []).join(', ') || '—') + '</td><td class="num">' + fmtUsd(r.tvl_usd) + '</td><td class="num ' + cls + '">' + pct + '</td><td class="num">' + fmtAge(r.age_days) + '</td><td class="num"><b>' + fmtUsd(r.implied_value_usd) + '</b></td></tr>';
    }).join('') || '<tr><td colspan="8" class="empty">No pre-token protocol matches this filter.</td></tr>';
    countEl.textContent = rows.length + ' of ' + DATA.board_size + ' pre-token protocols. Click a row for its model breakdown and farm plan.';
    rowsEl.querySelectorAll('tr[data-slug]').forEach(function (tr) {
      tr.addEventListener('click', function () {
        state.selected = tr.getAttribute('data-slug');
        render();
      });
    });
    var selected = rows.filter(function (r) { return r.slug === state.selected; })[0] || null;
    if (!selected && state.selected) {
      selected = DATA.rows.filter(function (r) { return r.slug === state.selected; })[0] || null;
    }
    renderDetail(selected);
  }

  function renderDetail(row) {
    if (!row) {
      detailEl.innerHTML = '<h2>Protocol detail</h2><p class="sub">Click a row in the board to see how its implied value is built and how to farm it.</p><p class="note">Every row records no token in the snapshot. A protocol on the watchlist is one the house rule kept: TVL at or above the $50M floor, no token recorded, and not a wrapped, staked or bridged product of a token that already trades.</p>';
      return;
    }
    var check = impliedOf(row, model);
    var match = check === row.implied_value_usd ? 'matches board.json' : 'differs from board.json';
    var steps = (row.farm_steps || []).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    detailEl.innerHTML =
      '<h2>' + esc(row.name) + '</h2>' +
      '<p class="sub">Rank #' + row.rank + ' · ' + esc(row.category || 'Uncategorised') + ' · ' + esc((row.chains || []).join(', ') || '—') + (watchSlugs.has(row.slug) ? ' · <span class="badge">WATCHLIST</span>' : '') + '</p>' +
      '<dl class="kv">' +
      '<dt>TVL</dt><dd>' + fmtUsd(row.tvl_usd) + '</dd>' +
      '<dt>7-day change</dt><dd>' + fmtPct(row.change_7d) + '</dd>' +
      '<dt>Age (listed)</dt><dd>' + fmtAge(row.age_days) + '</dd>' +
      '<dt>Base (TVL &times; ' + model.base_multiple + ')</dt><dd>' + fmtUsd(row.tvl_usd * model.base_multiple) + '</dd>' +
      '<dt>Growth multiplier</dt><dd>' + row.growth_multiplier.toFixed(4) + 'x</dd>' +
      '<dt>Maturity multiplier</dt><dd>' + row.maturity_multiplier.toFixed(4) + 'x</dd>' +
      '<dt>Implied value</dt><dd><b>' + fmtUsd(row.implied_value_usd) + '</b></dd>' +
      '<dt>Page recompute</dt><dd>' + fmtUsd(check) + ' — ' + match + '</dd>' +
      '</dl>' +
      '<h3>Farm plan</h3><ol class="steps">' + steps + '</ol>' +
      '<p class="note">This protocol records no token in the snapshot as of ' + esc(DATA.as_of) + '. The implied value is LaunchScope\u2019s own claim from TVL, 7-day growth and age — not a prediction that a token is issued, or when.</p>';
  }

  qEl.addEventListener('input', function () { state.q = qEl.value; state.selected = null; render(); });
  catEl.addEventListener('change', function () { state.category = catEl.value; state.selected = null; render(); });
  chainEl.addEventListener('change', function () { state.chain = chainEl.value; state.selected = null; render(); });
  sortEl.addEventListener('change', function () { state.sort = sortEl.value; render(); });
  wlEl.addEventListener('change', function () { state.watchlistOnly = wlEl.checked; state.selected = null; render(); });
  tabPre.addEventListener('click', function () { state.tab = 'pre'; state.selected = null; render(); });
  tabLive.addEventListener('click', function () { state.tab = 'live'; state.selected = null; render(); });

  render();
})();
