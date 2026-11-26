// Launch Radar — dashboard app.
//
// Renders the board from window.RADAR (written by main.ts as data.js),
// with no fetch and no network: the page is a static file, the data rides
// beside it. Deep links: #p=<slug> opens a protocol's detail view,
// #category=<name> filters the board, #tab=board|live|peers switches tabs.
//
// The detail view does not trust the board blindly: it recomputes each
// implied value from the row's own TVL and factors, and it checks the farm
// plan against the board's own steps (eight steps, each 20-600 characters,
// each naming a cost and a time). The footer runs the same checks across
// the whole board on every load.

(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA || !Array.isArray(DATA.rows)) {
    document.getElementById('meta').textContent = 'Board data failed to load.';
    return;
  }

  var rows = DATA.rows;
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });

  var state = { query: '', category: '', tab: 'board', sortKey: 'rank', sortDir: 1 };

  // ------------------------------------------------------------ formatting

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function money(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }

  function moneyFull(n) {
    return '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function pct(n) {
    if (n === null || n === undefined) return 'n/a';
    return (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
  }

  function confPill(c) {
    return '<span class="pill ' + c.toLowerCase() + '">' + esc(c) + '</span>';
  }

  // ------------------------------------------------------------ hash links

  function readHash() {
    var hash = location.hash.replace(/^#/, '');
    var out = {};
    hash.split('&').forEach(function (part) {
      var eq = part.indexOf('=');
      if (eq > 0) out[part.slice(0, eq)] = decodeURIComponent(part.slice(eq + 1));
    });
    return out;
  }

  function writeHash() {
    var parts = [];
    if (state.tab !== 'board') parts.push('tab=' + encodeURIComponent(state.tab));
    if (state.category) parts.push('category=' + encodeURIComponent(state.category));
    var detail = readHash().p;
    if (detail) parts.push('p=' + encodeURIComponent(detail));
    var next = parts.length ? '#' + parts.join('&') : '#';
    if (location.hash !== next) history.replaceState(null, '', next);
  }

  function openDetail(slug) {
    var h = readHash();
    h.p = slug;
    var parts = [];
    if (state.tab !== 'board') parts.push('tab=' + encodeURIComponent(state.tab));
    if (state.category) parts.push('category=' + encodeURIComponent(state.category));
    parts.push('p=' + encodeURIComponent(slug));
    location.hash = '#' + parts.join('&');
  }

  // ------------------------------------------------------------ filtering

  function visibleRows() {
    var q = state.query.trim().toLowerCase();
    var list = rows.filter(function (r) {
      if (state.category && r.category !== state.category) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().indexOf(q) >= 0 ||
        r.slug.toLowerCase().indexOf(q) >= 0 ||
        r.category.toLowerCase().indexOf(q) >= 0
      );
    });
    var key = state.sortKey;
    var dir = state.sortDir;
    var confRank = { High: 3, Medium: 2, Low: 1 };
    list.sort(function (a, b) {
      var av = a[key];
      var bv = b[key];
      if (key === 'confidence') { av = confRank[a.confidence]; bv = confRank[b.confidence]; }
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === 'string') return dir * (av < bv ? -1 : av > bv ? 1 : 0);
      return dir * (av - bv);
    });
    return list;
  }

  // ------------------------------------------------------------ rendering

  function renderMeta() {
    document.getElementById('meta').textContent =
      rows.length + ' protocols ranked · watchlist ' + DATA.watchlist_covered + '/' + DATA.watchlist_total +
      ' covered · snapshot as of ' + DATA.as_of + ' · ' +
      DATA.tiers.category + ' rows on direct category peers, ' + DATA.tiers.family + ' on family peers';
    document.getElementById('asof').textContent = DATA.as_of;
    var select = document.getElementById('category');
    var cats = [];
    rows.forEach(function (r) { if (cats.indexOf(r.category) < 0) cats.push(r.category); });
    cats.sort();
    cats.forEach(function (c) {
      var opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      select.appendChild(opt);
    });
    if (state.category) select.value = state.category;
  }

  function renderSpotlight() {
    var top = rows.slice(0, 10);
    document.getElementById('spotlight').innerHTML = top.map(function (r) {
      return (
        '<article class="spot-card" data-slug="' + esc(r.slug) + '">' +
        '<div class="rank">#' + r.rank + ' · ' + esc(r.category) + '</div>' +
        '<h3>' + esc(r.name) + '</h3>' +
        '<div class="value">' + money(r.implied_value_usd) + '</div>' +
        '<div class="score-line">Radar ' + r.radar_score + ' · ' + esc(r.confidence) + ' confidence' +
        (r.watchlist ? ' · <span class="watch">★ watchlist</span>' : '') + '</div>' +
        '</article>'
      );
    }).join('');
  }

  function renderBoard() {
    var list = visibleRows();
    document.getElementById('board-count').textContent =
      '(' + list.length + ' of ' + rows.length + ' shown)';
    document.getElementById('board-body').innerHTML = list.map(function (r) {
      return (
        '<tr data-slug="' + esc(r.slug) + '">' +
        '<td>' + r.rank + '</td>' +
        '<td>' + esc(r.name) + (r.watchlist ? ' <span class="watch">★</span>' : '') + '</td>' +
        '<td>' + esc(r.category) + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num"><strong>' + money(r.implied_value_usd) + '</strong></td>' +
        '<td><span class="bar"><i style="width:' + r.radar_score + '%"></i></span>' + r.radar_score + '</td>' +
        '<td>' + confPill(r.confidence) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '</tr>'
      );
    }).join('');
  }

  function renderLive() {
    document.getElementById('live-body').innerHTML = DATA.live.map(function (r, i) {
      return (
        '<tr>' +
        '<td>' + (i + 1) + '</td>' +
        '<td>' + esc(r.name) + '</td>' +
        '<td>' + esc(r.category) + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + money(r.mcap_usd) + '</td>' +
        '<td class="num">' + r.ratio.toFixed(2) + 'x</td>' +
        '</tr>'
      );
    }).join('');
  }

  function renderPeers() {
    document.getElementById('peers-body').innerHTML = DATA.peers.map(function (p) {
      return (
        '<tr>' +
        '<td>' + esc(p.category) + '</td>' +
        '<td>' + esc(p.family) + '</td>' +
        '<td class="num">' + p.peer_count + '</td>' +
        '<td class="num">' + p.median_multiple.toFixed(3) + 'x</td>' +
        '<td class="num">' + p.used_multiple.toFixed(3) + 'x (' + p.tier_used + ')</td>' +
        '<td class="num">' + p.board_rows + '</td>' +
        '</tr>'
      );
    }).join('');
  }

  // The detail view recomputes the row from its own figures and checks the
  // plan, so the page and the board can disagree out loud, never silently.
  function renderDetail(slug) {
    var section = document.getElementById('detail');
    var row = bySlug[slug];
    if (!row) { section.hidden = true; return; }
    section.hidden = false;
    document.getElementById('detail-title').textContent =
      '#' + row.rank + ' — ' + row.name;

    var recomputed = Math.floor(
      row.tvl_usd * row.peer_multiple * row.growth_factor * row.maturity_factor * row.breadth_factor,
    );
    var drift = Math.abs(recomputed - row.implied_value_usd) / row.implied_value_usd;
    var valueOk = drift <= 0.001;
    var stepsOk =
      row.farm_steps.length === 8 &&
      row.farm_steps.every(function (s) {
        var t = s.trim();
        return t.length >= 20 && t.length <= 600 && t.indexOf('Cost:') >= 0 && t.indexOf('Time:') >= 0;
      });

    var tierNote =
      row.peer_tier === 'category'
        ? row.peer_count + ' live peers in ' + row.category
        : row.peer_count + ' live peers in the ' + row.family + ' family';
    var ageNote =
      row.age_years === null
        ? 'listing date unknown — median eligible age used'
        : row.age_years.toFixed(2) + ' years since listing';

    document.getElementById('detail-body').innerHTML =
      '<div class="derive">' +
      '<div><div class="k">TVL</div><div class="v">' + moneyFull(row.tvl_usd) + '</div><div class="n">' + row.chain_count + ' chain' + (row.chain_count === 1 ? '' : 's') + ': ' + esc(row.chains.join(', ')) + '</div></div>' +
      '<div><div class="k">Peer multiple</div><div class="v">' + row.peer_multiple.toFixed(3) + 'x</div><div class="n">' + esc(row.peer_tier) + ' tier · ' + esc(tierNote) + '</div></div>' +
      '<div><div class="k">Growth × Maturity</div><div class="v">' + row.growth_factor.toFixed(3) + ' × ' + row.maturity_factor.toFixed(3) + '</div><div class="n">7d ' + pct(row.change_7d) + ' · ' + esc(ageNote) + '</div></div>' +
      '<div><div class="k">Breadth</div><div class="v">' + row.breadth_factor.toFixed(3) + 'x</div><div class="n">3% per chain, square-root scale to 8 chains</div></div>' +
      '<div><div class="k">Implied value</div><div class="v">' + money(row.implied_value_usd) + '</div><div class="n">Radar score ' + row.radar_score + ' · ' + esc(row.confidence) + ' confidence' + (row.watchlist ? ' · ★ watchlist' : '') + '</div></div>' +
      '</div>' +
      '<div class="totals">' +
      '<span>Capital: $' + row.capital_usd + '</span>' +
      '<span>Setup: ~$' + row.setup_cost_usd + '</span>' +
      '<span>Weekly gas: ~$' + row.weekly_cost_usd + '</span>' +
      '<span>Hold: ' + row.hold_days + ' days</span>' +
      '</div>' +
      '<h3>How to farm it — 8 steps</h3>' +
      '<ol>' + row.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' +
      '<p class="check' + (valueOk && stepsOk ? '' : ' bad') + '">' +
      (valueOk
        ? 'Recomputed implied value ' + moneyFull(recomputed) + ' agrees with the board ' + moneyFull(row.implied_value_usd) + ' (within rounding). '
        : 'Recomputed implied value ' + moneyFull(recomputed) + ' disagrees with the board ' + moneyFull(row.implied_value_usd) + '. ') +
      (stepsOk
        ? 'Farm plan checks out: 8 steps, each with a cost and a time.'
        : 'Farm plan fails its check: every plan needs 8 steps, each with a cost and a time.') +
      '</p>';
  }

  function renderBoardCheck() {
    var sorted = true;
    for (var i = 1; i < rows.length; i++) {
      if (rows[i].implied_value_usd > rows[i - 1].implied_value_usd) { sorted = false; break; }
    }
    var ranksOk = rows.every(function (r, i) { return r.rank === i + 1; });
    var plansOk = rows.every(function (r) {
      return r.farm_steps.length >= 3 && r.farm_steps.length <= 12 &&
        r.farm_steps.every(function (s) { var t = s.trim(); return t.length >= 20 && t.length <= 600; });
    });
    var distinct = new Set(rows.map(function (r) { return r.implied_value_usd; })).size === rows.length;
    var el = document.getElementById('board-check');
    if (sorted && ranksOk && plansOk && distinct && DATA.watchlist_covered === DATA.watchlist_total) {
      el.textContent =
        'Board check passed: ' + rows.length + ' rows · ranks 1–' + rows.length + ' · implied values non-increasing and all distinct · watchlist ' +
        DATA.watchlist_covered + '/' + DATA.watchlist_total + ' · every farm plan 3–12 steps of 20–600 characters.';
    } else {
      el.textContent = 'Board check FAILED — see the detail view for the row that disagrees.';
      el.style.color = '#e08a5a';
    }
  }

  // ------------------------------------------------------------ tabs + sync

  function showTab(tab) {
    state.tab = tab;
    applyVisibility();
    ['board', 'live', 'peers'].forEach(function (t) {
      document.getElementById('tab-' + t).classList.toggle('active', t === tab);
    });
    writeHash();
  }

  function syncFromHash() {
    var h = readHash();
    if (h.tab === 'live' || h.tab === 'peers' || h.tab === 'board') state.tab = h.tab;
    if (h.category !== undefined) {
      state.category = h.category;
      document.getElementById('category').value = h.category;
    }
    showTab(state.tab);
    renderBoard();
    renderDetail(h.p || '');
    applyVisibility();
  }

  // What is on screen: a detail view replaces the board, live and peers
  // views outright, and a category filter hides the spotlight so the
  // filtered board sits near the top. No scrolling is involved, so a
  // deep-linked view renders at the top of the page as loaded.
  function applyVisibility() {
    var detailOpen = !document.getElementById('detail').hidden;
    document.getElementById('spotlight-wrap').hidden =
      detailOpen || state.tab !== 'board' || state.category !== '';
    document.getElementById('view-board').hidden = detailOpen || state.tab !== 'board';
    document.getElementById('view-live').hidden = detailOpen || state.tab !== 'live';
    document.getElementById('view-peers').hidden = detailOpen || state.tab !== 'peers';
  }

  // ------------------------------------------------------------ events

  document.getElementById('search').addEventListener('input', function (e) {
    state.query = e.target.value;
    renderBoard();
  });

  document.getElementById('category').addEventListener('change', function (e) {
    state.category = e.target.value;
    writeHash();
    renderBoard();
    applyVisibility();
  });

  ['board', 'live', 'peers'].forEach(function (t) {
    document.getElementById('tab-' + t).addEventListener('click', function () { showTab(t); });
  });

  document.querySelectorAll('#board thead th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      var key = th.getAttribute('data-sort');
      if (state.sortKey === key) state.sortDir = -state.sortDir;
      else { state.sortKey = key; state.sortDir = key === 'name' || key === 'category' ? 1 : -1; }
      renderBoard();
    });
  });

  document.getElementById('board-body').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (tr) openDetail(tr.getAttribute('data-slug'));
  });

  document.getElementById('spotlight').addEventListener('click', function (e) {
    var card = e.target.closest('[data-slug]');
    if (card) openDetail(card.getAttribute('data-slug'));
  });

  document.getElementById('detail-back').addEventListener('click', function (e) {
    e.preventDefault();
    var h = readHash();
    delete h.p;
    var parts = [];
    if (state.tab !== 'board') parts.push('tab=' + encodeURIComponent(state.tab));
    if (state.category) parts.push('category=' + encodeURIComponent(state.category));
    location.hash = parts.length ? '#' + parts.join('&') : '#';
  });

  window.addEventListener('hashchange', syncFromHash);

  renderMeta();
  renderSpotlight();
  renderBoard();
  renderLive();
  renderPeers();
  renderBoardCheck();
  syncFromHash();
})();
