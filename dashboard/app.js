// Launch Radar, model radar-3. Renders window.RADAR from data.js: the ranked board, the live-token
// view, the peer-multiple table, and a detail view per protocol. The page recomputes every implied
// value from the snapshot's own figures (TVL, peer multiple, 7-day change, age, chains), so the code
// and the board agree; the farm plan is derived here from the same rules main.ts runs, from each
// protocol's own record, and checked against the board's own steps before it is shown.
//
// The model, radar-3:
//   peer multiple: category median (8+ peers), else family median, else the global median
//   growth: 7-day change clamped to -80%..+300%; up at 0.60, down at 0.90
//   maturity: 0.70 + 0.50 * (1 - exp(-age / 730)), saturating toward 1.20
//   breadth: 1 + 0.03 * sqrt(min(chains, 8))
//   implied = TVL x peer x growth x maturity x breadth
//   score: 70% log implied value on the board's scale + 30% momentum, 0-100
//   confidence: High / Medium / Low from direct peers, known age, reported 7-day change

(function () {
  'use strict';
  var R = window.RADAR;
  if (!R) { document.body.innerHTML = '<p style="padding:40px">Launch Radar: no data.js found.</p>'; return; }
  var M = R.model;

  // ---------- formatting ----------
  function usd(n) {
    if (n === null || n === undefined) return '—';
    var a = Math.abs(n);
    if (a >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n.toFixed(0);
  }
  function pct(n) {
    if (n === null || n === undefined) return '—';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function age(n) {
    if (n === null || n === undefined) return '—';
    if (n < 365) return n + 'd';
    return (n / 365).toFixed(1) + 'y';
  }
  function mult(n) { return '×' + n.toFixed(4); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- the model, recomputed in the page ----------
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
  function growthMult(row) {
    var g = clamp(row.change_7d === null ? 0 : row.change_7d, M.growth_floor, M.growth_cap);
    return 1 + (g / 100) * (g >= 0 ? M.growth_up_weight : M.growth_down_weight);
  }
  function maturityMult(row) {
    var a = row.age_days === null ? R.median_age_days : row.age_days;
    return M.maturity_floor + M.maturity_range * (1 - Math.exp(-Math.max(a, 0) / M.maturity_halflife_days));
  }
  function breadthMult(row) {
    return 1 + M.breadth_per_chain * Math.sqrt(Math.min(row.chains.length, M.breadth_max_chains));
  }
  function impliedOf(row) {
    return Math.max(1, Math.round(row.tvl_usd * row.peer_multiple * growthMult(row) * maturityMult(row) * breadthMult(row)));
  }
  // Self-check: the page's arithmetic must reproduce the board's values exactly.
  var bad = 0;
  R.rows.forEach(function (r) { if (impliedOf(r) !== r.implied_value_usd) bad++; });
  if (bad) console.warn('Launch Radar: ' + bad + ' rows recompute differently from the board');

  // ---------- the farm plan, derived in the page (same rules as lib/model.ts) ----------
  function chainOf(row) { return row.chains.length ? row.chains[0] : 'its main chain'; }
  function capitalFor(row) {
    if (row.tvl_usd >= 1e9) return 500;
    if (row.tvl_usd >= 1e8) return 250;
    if (row.tvl_usd >= 1e7) return 100;
    return 50;
  }
  function holdDaysFor(ageDays) {
    if (ageDays === null) return 45;
    if (ageDays < 180) return 90;
    if (ageDays < 365) return 60;
    return 45;
  }
  function actionFor(row, capital, chain) {
    var c = (row.category || '').toLowerCase();
    var name = row.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Lend $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and leave it supplied.';
    if (c.indexOf('dex') >= 0 || c.indexOf('swap') >= 0 || c.indexOf('liquidity') >= 0) return 'Add $' + capital + ' of liquidity to ' + name + '\'s deepest pool on ' + chain + ' and hold the LP position.';
    if (c.indexOf('yield') >= 0 || c.indexOf('farm') >= 0 || c.indexOf('aggregator') >= 0) return 'Deposit $' + capital + ' of USDC into ' + name + '\'s highest-TVL vault on ' + chain + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('vault') >= 0) return 'Allocate $' + capital + ' to a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + ' of ' + name + '\'s yield-bearing asset on ' + chain + ' and hold it.';
    if (c.indexOf('derivative') >= 0 || c.indexOf('perpetual') >= 0 || c.indexOf('options') >= 0) return 'Post $' + capital + ' of USDC as collateral on ' + name + ' and open a small hedged position.';
    if (c.indexOf('prediction') >= 0) return 'Back one outcome with $' + capital + ' on ' + name + ' and leave the position open.';
    if (c.indexOf('stable') >= 0) return 'Mint $' + capital + ' of the stable asset against collateral on ' + name + ' on ' + chain + '.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover on ' + name + ' on ' + chain + ' and keep the policy active.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Stake $' + capital + ' through ' + name + ' on ' + chain + ' and keep the receipt token.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC through ' + name + ' to ' + chain + ' and put the funds to work there.';
    return 'Open a $' + capital + ' position in ' + name + ' on ' + chain + ' and keep it active.';
  }
  function secondActionFor(row, chain) {
    var c = (row.category || '').toLowerCase();
    var name = row.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Borrow $25 of USDC against the supplied collateral on ' + name + ', then repay it within the week, so the position shows both sides of the market.';
    if (c.indexOf('dex') >= 0 || c.indexOf('swap') >= 0 || c.indexOf('liquidity') >= 0) return 'Make one $10 swap through ' + name + ' on ' + chain + ' each week, so the wallet shows trading volume as well as liquidity.';
    if (c.indexOf('yield') >= 0 || c.indexOf('farm') >= 0 || c.indexOf('aggregator') >= 0) return 'Claim any yield or points weekly and re-deposit them into the same vault, so the position compounds instead of sitting idle.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('vault') >= 0) return 'Vote on one vault allocation or rebalance proposal when ' + name + ' posts it, so the wallet is a participant and not just a deposit.';
    if (c.indexOf('rwa') >= 0) return 'Hold the asset through one full payout cycle and check the redemption window, so you know how to exit before you need to.';
    if (c.indexOf('derivative') >= 0 || c.indexOf('perpetual') >= 0 || c.indexOf('options') >= 0) return 'Close and reopen a small hedged position once, so the account shows more than a single trade.';
    if (c.indexOf('prediction') >= 0) return 'Settle the first market and back a second outcome, so the wallet shows repeat activity.';
    if (c.indexOf('stable') >= 0) return 'Hold the minted stable asset for a full week and use it in one payment or deposit, so it circulates instead of sitting in the wallet.';
    if (c.indexOf('insurance') >= 0) return 'Review the cover terms and the renewal date each month, and renew before the policy lapses.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Restake the staking rewards once, so the position grows from its own yield.';
    if (c.indexOf('bridge') >= 0) return 'Bridge a second, smaller amount back the other way, so the wallet shows two-way flow.';
    return 'Do one more on-chain action in ' + name + ' within the first week: a vote, a claim, or a second deposit.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + ' Keep the position open and check the protocol\'s own page.';
    return s;
  }
  function farmSteps(row) {
    var chain = chainOf(row);
    var capital = capitalFor(row);
    var hold = holdDaysFor(row.age_days);
    var gas2 = capital >= 500 ? 10 : capital >= 250 ? 8 : 5;
    var steps = [
      { text: 'Set aside a fresh wallet for this farm only, and store its seed phrase offline.', cost: 'under $3 in gas for the first transaction', time: '5 minutes' },
      { text: actionFor(row, capital, chain), cost: '$' + capital + ' of capital plus about $' + gas2 + ' in gas', time: '15 minutes to set up' },
      { text: secondActionFor(row, chain), cost: 'about $3 in gas', time: '10 minutes' },
      { text: 'Return once a week and make one real action: a deposit, a swap, a vote, or a claim.', cost: 'about $2 in gas per week', time: '10 minutes a week' },
      { text: 'Check the protocol\'s own points or rewards page before you move anything, and claim only through links it publishes.', cost: 'free to check, and never pay to claim', time: '10 minutes' },
      { text: 'Keep the position open for at least ' + hold + ' days, so the activity lands in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: 'If the protocol announces a token or a claim window, read its own announcement first and claim only from the address it names.', cost: 'free to check; gas only when you claim', time: '10 minutes' },
      { text: 'Log the wallet, the dates, and every transaction hash, and plan the exit now: withdraw, bridge back, and revoke any approval you no longer need.', cost: 'nothing but the log', time: '5 minutes' }
    ];
    return steps.map(stepText);
  }
  // Self-check: the derived plan must match the board's own steps on every row.
  var badSteps = 0;
  R.rows.forEach(function (r) {
    var derived = farmSteps(r);
    if (derived.length !== r.farm_steps.length) { badSteps++; return; }
    for (var i = 0; i < derived.length; i++) if (derived[i] !== r.farm_steps[i]) { badSteps++; break; }
  });
  if (badSteps) console.warn('Launch Radar: ' + badSteps + ' rows derive a different farm plan from the board');

  // ---------- state ----------
  var state = { q: '', category: 'all', chain: 'all', watchOnly: false, sort: 'rank', dir: 1, tab: 'board' };
  var watchSet = {};
  R.watchlist.forEach(function (s) { watchSet[s] = true; });
  var $ = function (id) { return document.getElementById(id); };
  var rowsEl = $('rows'), countEl = $('count'), detailEl = $('detail');

  function readHash() {
    var h = new URLSearchParams(location.hash.slice(1));
    if (h.get('q') !== null) state.q = h.get('q');
    if (h.get('category')) state.category = h.get('category');
    if (h.get('chain')) state.chain = h.get('chain');
    if (h.get('watchlist') === '1') state.watchOnly = true;
    if (h.get('tab') === 'live' || h.get('tab') === 'peers') state.tab = h.get('tab');
    if (h.get('sort')) state.sort = h.get('sort');
    if (h.get('dir') === '-1') state.dir = -1;
    return h.get('p');
  }
  function writeHash(openSlug) {
    var h = new URLSearchParams();
    if (state.q) h.set('q', state.q);
    if (state.category !== 'all') h.set('category', state.category);
    if (state.chain !== 'all') h.set('chain', state.chain);
    if (state.watchOnly) h.set('watchlist', '1');
    if (state.tab !== 'board') h.set('tab', state.tab);
    if (state.sort !== 'rank') h.set('sort', state.sort);
    if (state.dir === -1) h.set('dir', '-1');
    if (openSlug) h.set('p', openSlug);
    history.replaceState(null, '', '#' + h.toString());
  }

  // ---------- header, stats, selects, spotlight ----------
  $('asOf').textContent = R.as_of;
  $('source').textContent = R.source + ', ' + R.as_of;
  var top = R.rows[0];
  $('stats').innerHTML = [
    ['<b>' + R.board_size + '</b><span>protocols ranked</span>'],
    ['<b>' + R.watchlist_size + ' / ' + R.watchlist_size + '</b><span>watchlist covered</span>'],
    ['<b>' + R.early_size + '</b><span>found beyond the watchlist</span>'],
    ['<b>' + usd(top ? top.implied_value_usd : 0) + '</b><span>top implied value</span>'],
    ['<b>' + R.peer_global.toFixed(3) + '</b><span>median peer multiple</span>'],
    ['<b>' + R.live_size + '</b><span>live tokens set aside</span>']
  ].map(function (s) { return '<div class="stat">' + s[0] + '</div>'; }).join('');

  $('spotlight').innerHTML = R.rows.slice(0, 10).map(function (r) {
    var chg = r.change_7d === null ? '7d —' : '7d ' + pct(r.change_7d);
    return '<button class="card" data-slug="' + esc(r.slug) + '">' +
      '<span class="rk">#' + r.rank + ' · SCORE ' + r.score + '</span>' +
      '<span class="nm">' + esc(r.name) + '</span>' +
      '<span class="vl">' + usd(r.implied_value_usd) + '</span>' +
      '<span class="dt">' + esc(r.category || '—') + ' · ' + chg + '</span></button>';
  }).join('');

  var categories = [], chains = [];
  R.rows.forEach(function (r) {
    if (r.category && categories.indexOf(r.category) < 0) categories.push(r.category);
    r.chains.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  categories.sort(); chains.sort();
  $('category').innerHTML = '<option value="all">All categories</option>' + categories.map(function (c) {
    return '<option value="' + esc(c) + '">' + esc(c) + '</option>';
  }).join('');
  $('chain').innerHTML = '<option value="all">All chains</option>' + chains.map(function (c) {
    return '<option value="' + esc(c) + '">' + esc(c) + '</option>';
  }).join('');

  // ---------- board ----------
  function filtered() {
    var q = state.q.trim().toLowerCase();
    var rows = R.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (state.watchOnly && !watchSet[r.slug]) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var key = state.sort, dir = state.dir;
    rows.sort(function (a, b) {
      var av = a[key], bv = b[key];
      if (av === null) return 1; if (bv === null) return -1;
      if (typeof av === 'string') return av.localeCompare(bv) * dir;
      return (av - bv) * dir;
    });
    return rows;
  }
  function renderBoard() {
    var rows = filtered();
    rowsEl.innerHTML = rows.map(function (r) {
      var chg = r.change_7d === null ? '<span>—</span>' : '<span class="' + (r.change_7d >= 0 ? 'pos' : 'neg') + '">' + pct(r.change_7d) + '</span>';
      return '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><span class="nm">' + esc(r.name) + '</span>' + (watchSet[r.slug] ? '<span class="badge">WATCHLIST</span>' : '') + '<span class="sub">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td class="num">' + usd(r.tvl_usd) + '</td>' +
        '<td class="num">' + chg + '</td>' +
        '<td class="num">' + age(r.age_days) + '</td>' +
        '<td class="num"><span class="scorebar"><i style="width:' + r.score + '%"></i></span>' + r.score + '</td>' +
        '<td class="num"><b>' + usd(r.implied_value_usd) + '</b></td></tr>';
    }).join('');
    countEl.textContent = rows.length + ' of ' + R.board_size + ' protocols shown. Implied values are this radar\u2019s own claim, computed from the snapshot\u2019s figures alone.';
  }
  function renderLive() {
    $('liveRows').innerHTML = R.live.map(function (r) {
      return '<tr><td><span class="nm">' + esc(r.name) + '</span><span class="sub">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td class="num">' + usd(r.tvl_usd) + '</td>' +
        '<td class="num">' + usd(r.mcap_usd) + '</td>' +
        '<td class="num">' + (r.mcap_tvl_ratio === null ? '—' : r.mcap_tvl_ratio.toFixed(3)) + '</td>' +
        '<td class="num">' + (r.change_7d === null ? '—' : pct(r.change_7d)) + '</td></tr>';
    }).join('');
  }
  function familyOf(cat) {
    var fams = { Trading: ['Dexs', 'Derivatives', 'Dex Aggregator', 'Options', 'Prediction Market', 'Basis Trading', 'OTC Marketplace', 'Interest Rate Derivatives', 'Perpetuals', 'Synthetics'], Lending: ['Lending', 'CDP', 'CDP Manager', 'Leveraged Farming', 'Uncollateralized Lending', 'Collateral Markets', 'Risk Curators', 'Onchain Capital Allocator', 'CeDeFi', 'Anchor BTC'], Yield: ['Yield', 'Yield Aggregator', 'Farm', 'Liquidity Manager', 'Restaking', 'Staking Pool', 'Governance Incentives', 'Indexes', 'Vaults'], 'Stable & RWA': ['RWA', 'Stablecoin Wrapper', 'Dual-Token Stablecoin', 'Payments', 'Crypto Card Issuer', 'Stablecoins'], Infra: ['Chain', 'Cross Chain Bridge', 'Bridge', 'Canonical Bridge', 'Insurance', 'Privacy', 'Oracle'] };
    for (var f in fams) if (fams[f].indexOf(cat) >= 0) return f;
    return 'Other';
  }
  function renderPeers() {
    var cats = Object.keys(R.peer_by_category).sort();
    $('peerRows').innerHTML = cats.map(function (c) {
      var fam = familyOf(c);
      var fn = R.peer_count_by_family[fam];
      var fm = R.peer_by_family[fam];
      return '<tr><td><span class="nm">' + esc(c) + '</span></td>' +
        '<td class="num">' + R.peer_count_by_category[c] + '</td>' +
        '<td class="num">' + R.peer_by_category[c].toFixed(3) + '</td>' +
        '<td>' + esc(fam) + '</td>' +
        '<td class="num">' + (fn === undefined ? '—' : fn) + '</td>' +
        '<td class="num">' + (fm === undefined ? '—' : fm.toFixed(3)) + '</td></tr>';
    }).join('');
  }
  function setTab(tab) {
    state.tab = tab;
    $('tabBoard').classList.toggle('active', tab === 'board');
    $('tabLive').classList.toggle('active', tab === 'live');
    $('tabPeers').classList.toggle('active', tab === 'peers');
    $('board').hidden = tab !== 'board';
    countEl.hidden = tab !== 'board';
    $('liveTable').hidden = tab !== 'live';
    $('liveNote').hidden = tab !== 'live';
    $('peerTable').hidden = tab !== 'peers';
    $('peerNote').hidden = tab !== 'peers';
    if (tab === 'live') renderLive();
    if (tab === 'peers') renderPeers();
    writeHash(currentSlug);
  }

  // ---------- detail ----------
  var currentSlug = null;
  function chainsShort(row) {
    if (!row.chains.length) return 'no chain listed';
    var shown = row.chains.slice(0, 3).join(', ');
    return row.chains.length > 3 ? shown + ' +' + (row.chains.length - 3) + ' more' : shown;
  }
  // A stored farm step is "action. Cost: ... . Time: ... .": split it for display.
  function splitStep(s) {
    var ci = s.lastIndexOf(' Cost: ');
    var ti = s.lastIndexOf(' Time: ');
    if (ci < 0 || ti < ci) return { text: s, cost: '', time: '' };
    return { text: s.slice(0, ci), cost: s.slice(ci + 7, ti), time: s.slice(ti + 7).replace(/\.$/, '') };
  }
  function openDetail(slug) {
    var row = null;
    R.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) { detailEl.hidden = true; currentSlug = null; return; }
    currentSlug = slug;
    var g = row.change_7d === null ? 0 : row.change_7d;
    var ageShown = row.age_days === null ? R.median_age_days + ' days (median)' : row.age_days + ' days';
    var tierNote = row.peer_tier === 'category'
      ? 'its own category, ' + esc(row.category || '') + ' (' + row.peer_count + ' peers)'
      : row.peer_tier === 'family'
        ? 'its ' + esc(familyOf(row.category || '')) + ' family (' + row.peer_count + ' peers)'
        : 'the snapshot-wide median (' + row.peer_count + ' peers)';
    var capital = capitalFor(row);
    var hold = holdDaysFor(row.age_days);
    var gas2 = capital >= 500 ? 10 : capital >= 250 ? 8 : 5;
    var setupCost = capital + 3 + gas2 + 3;
    var steps = row.farm_steps.map(splitStep);
    detailEl.innerHTML =
      '<button class="close" id="closeDetail">Close &times;</button>' +
      '<h2>' + esc(row.name) + '</h2>' +
      '<p class="meta">#' + row.rank + ' &middot; ' + esc(row.category || 'no category') + ' &middot; ' + esc(chainsShort(row)) + (watchSet[row.slug] ? ' &middot; <span class="badge">WATCHLIST</span>' : '') + ' &middot; <span class="conf ' + row.confidence + '">' + row.confidence.toUpperCase() + ' CONFIDENCE</span></p>' +
      '<div class="kv">' +
      '<div><span>Implied value</span><b>' + usd(row.implied_value_usd) + '</b></div>' +
      '<div><span>Radar score</span><b>' + row.score + ' / 100</b></div>' +
      '<div><span>TVL</span><b>' + usd(row.tvl_usd) + '</b></div>' +
      '<div><span>7-day change</span><b>' + pct(row.change_7d) + '</b></div>' +
      '<div><span>Age, no token recorded</span><b>' + age(row.age_days) + '</b></div>' +
      '<div><span>Peer multiple</span><b>' + mult(row.peer_multiple) + '</b></div>' +
      '</div>' +
      '<h3>How the value is worked out</h3>' +
      '<div class="math">' +
      usd(row.tvl_usd) + ' &times; ' + mult(row.peer_multiple) + ' peer<br>' +
      '&times; ' + mult(growthMult(row)) + ' growth (' + pct(g) + ' in 7 days)<br>' +
      '&times; ' + mult(maturityMult(row)) + ' maturity (' + esc(ageShown) + ')<br>' +
      '&times; ' + mult(breadthMult(row)) + ' breadth (' + row.chains.length + ' chain' + (row.chains.length === 1 ? '' : 's') + ')<br>' +
      '<span class="tot">= ' + usd(row.implied_value_usd) + '</span>' +
      '</div>' +
      '<p class="note">The peer multiple is the median market-cap-to-TVL ratio of live-token protocols in ' + tierNote + ', in this snapshot. The page recomputes the total from the same figures, so the code and the board agree. The score is 70% implied value on a log scale plus 30% momentum.</p>' +
      '<h3>Farm plan — 8 steps</h3>' +
      '<ol class="steps">' + steps.map(function (s) {
        return '<li>' + esc(s.text) + '<span class="ct">Cost: ' + esc(s.cost) + ' &middot; Time: ' + esc(s.time) + '</span></li>';
      }).join('') + '</ol>' +
      '<p class="totals">Plan total: about <b>$' + setupCost + '</b> to set up ($' + capital + ' of capital, the rest gas), then about <b>$2 a week</b> in gas, over at least <b>' + hold + ' days</b>. The capital stays in the position and can be withdrawn.</p>' +
      '<p class="note">This protocol records no token in the snapshot: no market cap, no CoinGecko id, no symbol. That is what the record says, never proof it has none. Nothing here is financial advice.</p>';
    detailEl.hidden = false;
    $('closeDetail').addEventListener('click', function () { detailEl.hidden = true; currentSlug = null; writeHash(null); });
    detailEl.scrollTop = 0;
    writeHash(slug);
  }

  // ---------- events ----------
  $('q').addEventListener('input', function (e) { state.q = e.target.value; renderBoard(); writeHash(currentSlug); });
  $('category').addEventListener('change', function (e) { state.category = e.target.value; renderBoard(); writeHash(currentSlug); });
  $('chain').addEventListener('change', function (e) { state.chain = e.target.value; renderBoard(); writeHash(currentSlug); });
  $('watchOnly').addEventListener('change', function (e) { state.watchOnly = e.target.checked; renderBoard(); writeHash(currentSlug); });
  $('tabBoard').addEventListener('click', function () { setTab('board'); });
  $('tabLive').addEventListener('click', function () { setTab('live'); });
  $('tabPeers').addEventListener('click', function () { setTab('peers'); });
  document.querySelectorAll('#board thead th').forEach(function (th) {
    th.addEventListener('click', function () {
      var key = th.getAttribute('data-sort');
      if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = key === 'name' || key === 'category' ? 1 : -1; }
      renderBoard(); writeHash(currentSlug);
    });
  });
  rowsEl.addEventListener('click', function (e) {
    var tr = e.target.closest('tr');
    if (tr) openDetail(tr.getAttribute('data-slug'));
  });
  $('spotlight').addEventListener('click', function (e) {
    var card = e.target.closest('.card');
    if (card) openDetail(card.getAttribute('data-slug'));
  });
  window.addEventListener('hashchange', function () {
    var p = readHash();
    syncControls();
    setTab(state.tab);
    renderBoard();
    if (p) openDetail(p); else { detailEl.hidden = true; currentSlug = null; }
  });
  function syncControls() {
    $('q').value = state.q;
    $('category').value = state.category;
    $('chain').value = state.chain;
    $('watchOnly').checked = state.watchOnly;
  }

  // ---------- boot ----------
  var open = readHash();
  syncControls();
  renderBoard();
  if (state.tab !== 'board') setTab(state.tab);
  if (open) openDetail(open);
  // A shared link that carries a filter lands on the filters and the board, not the page top.
  if (!open && (state.category !== 'all' || state.chain !== 'all' || state.watchOnly || state.q)) {
    document.querySelector('.controls').scrollIntoView();
  }
})();
