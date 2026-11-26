// Launch Radar — model "radar-3".
//
// A token launch radar that reads a frozen snapshot of the protocol universe
// (DefiLlama rows: slug, name, category, chains, TVL, 7-day change, market
// cap, listing date, CoinGecko id, symbol) and ranks every protocol whose
// record shows no token by what a token would be worth if the record stayed
// as it is. Nothing here names a protocol by hand: every row, multiple and
// plan is derived from the snapshot on every run, so a future snapshot with
// protocols that do not exist yet is ranked the same way.
//
// The value model, in one line:
//
//   implied value = TVL x peer multiple x growth x maturity x breadth
//
// Peer multiple, three tiers. A live-token protocol (one whose record
// carries a market cap) gives a market-cap-to-TVL ratio. The multiple for a
// row is the median ratio of the live-token protocols in its own category
// when that category has eight or more of them; otherwise the median ratio
// of its category family; otherwise the median ratio of the whole snapshot.
// The result is clamped to [0.03, 1.00]: a token is never priced above the
// value locked in its protocol, and never below three cents on the dollar.
//
// Families group the snapshot's categories by what the protocol does:
// Trading (exchanges, perps, prediction markets), Lending (lending, CDP,
// collateral, curators of other people's capital), Yield (vaults, farms,
// staking and restaking products), Stable & RWA (dollars and tokenised
// real-world assets) and Infra (chains, bridges, oracles and the plumbing
// everything else stands on). Risk curators and onchain capital allocators
// sit in Yield: they allocate capital for a return, like a vault, not like
// a loan book.
//
// Growth is asymmetric. The 7-day TVL change is clamped to -80% .. +300%.
// A rise counts at 0.60 and a fall bites at 0.90: declines are stickier
// than rallies, so a protocol that is shrinking is marked down harder than
// a growing one is marked up.
//
// Maturity saturates. A protocol with no token recorded for longer is worth
// more of its peer multiple, but each extra year adds less than the last:
// the factor runs from 0.70 on day zero toward 1.20 and flattens, following
// 0.70 + 0.50 * (1 - exp(-ageYears / 2)). A protocol with no listing date
// takes the eligible median age.
//
// Breadth diminishes. Running on more chains is worth more, on a
// square-root scale up to eight chains: 1 + 0.03 * sqrt(min(chains, 8)).
//
// Rank is always the implied value, highest first. Each row also carries a
// Radar score (0-100: 70% the log of the implied value across the board,
// 30% the 7-day momentum) and a confidence (High / Medium / Low, one point
// each for direct category peers, a known listing date and a reported
// 7-day change). The farm plan is eight steps derived from the row's own
// record: two actions specific to its category, a weekly cadence, a points
// check, a hold window, a claim-safety step and an exit plan, each with a
// cost and a time. Capital scales with TVL ($50 / $100 / $250 / $500); a
// younger protocol gets a longer qualifying hold (90 / 60 / 45 days).

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface BoardRow {
  slug: string;
  name: string;
  category: string;
  family: string;
  chains: string[];
  chain_count: number;
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_years: number | null;
  watchlist: boolean;
  rank: number;
  implied_value_usd: number;
  peer_multiple: number;
  peer_tier: 'category' | 'family' | 'global';
  peer_count: number;
  growth_factor: number;
  maturity_factor: number;
  breadth_factor: number;
  radar_score: number;
  confidence: 'High' | 'Medium' | 'Low';
  capital_usd: number;
  hold_days: number;
  setup_cost_usd: number;
  weekly_cost_usd: number;
  farm_steps: string[];
}

export interface PeerRow {
  category: string;
  family: string;
  peer_count: number;
  median_multiple: number;
  used_multiple: number;
  tier_used: 'category' | 'family';
  board_rows: number;
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string;
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
}

export interface Board {
  model: string;
  as_of: string;
  rows: BoardRow[];
  peers: PeerRow[];
  live: LiveRow[];
  tiers: { category: number; family: number; global: number };
  watchlist_total: number;
  watchlist_covered: number;
}

// ------------------------------------------------------------------ tables

/** Category -> family. Every category the snapshot names is listed; an
 *  unlisted category falls back to the global median (third tier). */
export const CATEGORY_FAMILY: Record<string, string> = {
  Dexs: 'Trading',
  Derivatives: 'Trading',
  'Prediction Market': 'Trading',
  'Basis Trading': 'Trading',
  Options: 'Trading',
  'Options Vault': 'Trading',
  'OTC Marketplace': 'Trading',
  Synthetics: 'Trading',
  'Interest Rate Derivatives': 'Trading',
  'NFT Marketplace': 'Trading',
  Lending: 'Lending',
  CDP: 'Lending',
  'CDP Manager': 'Lending',
  'Collateral Management': 'Lending',
  'Collateral Markets': 'Lending',
  'Uncollateralized Lending': 'Lending',
  CeDeFi: 'Lending',
  'Leveraged Farming': 'Lending',
  Yield: 'Yield',
  'Yield Aggregator': 'Yield',
  Farm: 'Yield',
  'Liquidity Manager': 'Yield',
  'Staking Pool': 'Yield',
  Restaking: 'Yield',
  'Governance Incentives': 'Yield',
  Indexes: 'Yield',
  'Liquid Staking': 'Yield',
  'Liquid Restaking': 'Yield',
  'Restaked BTC': 'Yield',
  'Risk Curators': 'Yield',
  'Onchain Capital Allocator': 'Yield',
  RWA: 'Stable & RWA',
  'Stablecoin Issuer': 'Stable & RWA',
  'Stablecoin Wrapper': 'Stable & RWA',
  'Reserve Currency': 'Stable & RWA',
  'Algo-Stables': 'Stable & RWA',
  'Dual-Token Stablecoin': 'Stable & RWA',
  'Anchor BTC': 'Stable & RWA',
  'Decentralized BTC': 'Stable & RWA',
  Chain: 'Infra',
  Bridge: 'Infra',
  'Canonical Bridge': 'Infra',
  'Cross Chain Bridge': 'Infra',
  Privacy: 'Infra',
  Payments: 'Infra',
  'Crypto Card Issuer': 'Infra',
  Insurance: 'Infra',
  Launchpad: 'Infra',
  'Token Locker': 'Infra',
  DOR: 'Infra',
  'AI Agents': 'Infra',
  'Decentralized AI': 'Infra',
  CEX: 'Infra',
};

/** Categories that are products of a token that already trades, never a
 *  launch of their own: wrapped, staked, bridged and exchange products. */
const PRODUCT_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** Exchange names a protocol name must not start with. */
const EXCHANGE_PREFIXES = [
  'Binance',
  'Coinbase',
  'Bybit',
  'Kraken',
  'Bitget',
  'OKX',
  'Bitfinex',
  'Gemini',
];

const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Two farming actions per category, written as (name, chain, capital)
 *  templates. The family table is the fallback for categories with no
 *  entry of their own. */
const CATEGORY_ACTIONS: Record<string, [string, string]> = {
  Dexs: [
    'Swap ${capital} of assets through {name} on {chain}, splitting it across two trades on different days so the volume looks like real use rather than one burst',
    'Add ${capital} of liquidity to the busiest {name} pool on {chain} and leave it earning fees for the full hold window',
  ],
  Lending: [
    'Supply ${capital} of collateral to {name} on {chain} and keep the position open, checking the health factor once a week',
    'Borrow a small amount against that collateral on {name}, repay it within the same week, and repeat the cycle monthly',
  ],
  Yield: [
    'Deposit ${capital} into the {name} vault on {chain} and let the yield compound for the full hold window',
    'Stake the receipt token {name} issues on {chain} if the vault offers a staking or locking option, and keep it staked',
  ],
  'Prediction Market': [
    'Place ${capital} in small prediction positions on {name} across three different markets on {chain}, rather than one large bet',
    'Provide liquidity to a {name} market on {chain} so the position earns fees while the outcome is still open',
  ],
  RWA: [
    'Hold ${capital} of {name} tokenised assets on {chain} for the full hold window, keeping the position in one wallet',
    'Reinvest any yield {name} pays on {chain} back into the same position instead of withdrawing it each month',
  ],
  CDP: [
    'Open a collateralised position on {name} with ${capital} on {chain} and mint a modest amount of its dollar asset',
    'Keep the {name} position above a safe collateral ratio for the full hold window, topping it up if the ratio drifts',
  ],
  Derivatives: [
    'Open a small hedged position on {name} with ${capital} on {chain}, sized so a single move cannot liquidate it',
    'Trade on {name} at least twice a month on {chain}, keeping each trade small and closing it before the weekend',
  ],
  'Risk Curators': [
    'Allocate ${capital} to a curated vault on {name} on {chain} and leave the allocation untouched for the full hold window',
    'Compare the curator vaults on {name} each month on {chain} and move only if a vault has clearly underperformed for two months',
  ],
  'Onchain Capital Allocator': [
    'Deposit ${capital} with {name} on {chain} into its main allocation strategy and keep the deposit for the full hold window',
    'Check {name} on {chain} monthly for new allocation strategies and add a small amount only to strategies with a track record',
  ],
  'Yield Aggregator': [
    'Deposit ${capital} into the top {name} strategy on {chain} and let the aggregator auto-compound it for the full hold window',
    'Harvest and re-deposit {name} rewards on {chain} once a week so the compounding is visible on-chain',
  ],
  Chain: [
    'Bridge ${capital} onto {name} via its official bridge and hold the funds there for the full hold window',
    'Use a native {name} app every week on {chain} so the wallet shows steady activity on the chain itself',
  ],
};

const FAMILY_ACTIONS: Record<string, [string, string]> = {
  Trading: [
    'Trade ${capital} through {name} on {chain} in at least two separate sessions, keeping each trade small',
    'Use a second {name} feature on {chain}, such as its liquidity pool or limit orders, so the wallet is not a one-trick user',
  ],
  Lending: [
    'Supply ${capital} to {name} on {chain} and keep the supply in place for the full hold window',
    'Use a small borrow on {name} once a month on {chain} and repay it promptly to show both sides of the book',
  ],
  Yield: [
    'Deposit ${capital} into {name} on {chain} and leave it compounding for the full hold window',
    'Claim and re-deposit any {name} rewards on {chain} weekly so the position grows on-chain',
  ],
  'Stable & RWA': [
    'Hold ${capital} of {name} assets on {chain} for the full hold window in a single wallet',
    'Use the {name} asset on {chain} in a real transaction each month, such as a payment or a transfer, not just a hold',
  ],
  Infra: [
    'Bridge ${capital} through {name} on {chain} and keep the funds active on the destination for the full hold window',
    'Use {name} on {chain} at least once a week for a real task, such as a transfer or a contract call',
  ],
};

// ------------------------------------------------------------------ helpers

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] as number;
  return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function daysBetween(fromYmd: string, toYmd: string): number {
  const [y1, m1, d1] = fromYmd.split('-').map(Number);
  const [y2, m2, d2] = toYmd.split('-').map(Number);
  const a = Date.UTC(y1 as number, (m1 as number) - 1, d1 as number);
  const b = Date.UTC(y2 as number, (m2 as number) - 1, d2 as number);
  return Math.round((b - a) / 86_400_000);
}

/** A protocol records no token when its record carries no market cap, no
 *  CoinGecko id and no symbol. That is what the record says, never proof
 *  it has none. */
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** A wrapped, staked, bridged or exchange product of a token that already
 *  trades is not a launch: it is excluded from the board. */
export function isProduct(p: SnapshotProtocol): boolean {
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  if (EXCHANGE_PREFIXES.some((prefix) => p.name.startsWith(prefix))) return true;
  if (VERSION_SUFFIX.test(p.name)) return true;
  return false;
}

export function isEligible(p: SnapshotProtocol): boolean {
  return recordsNoToken(p) && !isProduct(p);
}

function ageYears(p: SnapshotProtocol, asOf: string, fallback: number): number | null {
  if (p.listed_at === null) return null;
  const days = daysBetween(p.listed_at, asOf);
  if (days < 0) return 0;
  return days / 365.25;
}

/** The saturating maturity factor: 0.70 on day zero, rising toward 1.20. */
export function maturityFactor(age: number): number {
  return 0.7 + 0.5 * (1 - Math.exp(-age / 2));
}

/** Asymmetric growth: rises count 0.60, falls bite 0.90. */
export function growthFactor(change7d: number | null): number {
  if (change7d === null) return 1;
  const moved = clamp(change7d, -80, 300) / 100;
  return 1 + moved * (moved >= 0 ? 0.6 : 0.9);
}

/** Diminishing breadth: 3% per chain on a square-root scale, to 8 chains. */
export function breadthFactor(chainCount: number): number {
  return 1 + 0.03 * Math.sqrt(Math.min(chainCount, 8));
}

function capitalTier(tvlUsd: number): number {
  if (tvlUsd >= 1_000_000_000) return 500;
  if (tvlUsd >= 250_000_000) return 250;
  if (tvlUsd >= 50_000_000) return 100;
  return 50;
}

function holdDays(age: number | null, fallbackAge: number): number {
  const years = age === null ? fallbackAge : age;
  if (years < 1) return 90;
  if (years < 3) return 60;
  return 45;
}

function fill(template: string, name: string, chain: string, capital: number): string {
  return template
    .replaceAll('{name}', name)
    .replaceAll('{chain}', chain)
    .replaceAll('${capital}', `$${capital}`);
}

/** Eight farm steps for one row. Each step names what to do, what it costs
 *  and how long it takes, and stays within the gate's 20-600 characters. */
export function farmPlan(row: BoardRow): string[] {
  const chain = row.chains[0] ?? 'Ethereum';
  const pair = CATEGORY_ACTIONS[row.category] ?? FAMILY_ACTIONS[row.family] ?? FAMILY_ACTIONS.Infra!;
  const setup = row.setup_cost_usd;
  const weekly = row.weekly_cost_usd;
  const steps = [
    `Set up a fresh wallet and fund it with $${row.capital_usd} on ${chain} for ${row.name}, keeping the seed phrase offline and the wallet used only for this farm. Cost: ~$${setup} in gas and bridge fees. Time: 30 minutes.`,
    `${fill(pair[0], row.name, chain, row.capital_usd)}. Cost: ~$${Math.max(2, Math.round(setup / 2))} in gas. Time: 20 minutes.`,
    `${fill(pair[1], row.name, chain, row.capital_usd)}. Cost: ~$${Math.max(2, Math.round(setup / 2))} in gas. Time: 20 minutes.`,
    `Repeat one ${row.name} action every week on ${chain} for the full ${row.hold_days}-day hold, at least four transactions a month, so the wallet reads as a steady user and not a one-off. Cost: ~$${weekly} a week in gas. Time: 15 minutes a week.`,
    `Check the ${row.name} points or activity page once a week on ${chain} and record the balance; if a week shows no new activity, do an extra small transaction before the week ends. Cost: $0. Time: 10 minutes a week.`,
    `Hold the ${row.name} position untouched for ${row.hold_days} days on ${chain}: do not withdraw, unstake or move it early, since early exits usually reset qualifying time. Cost: $0. Time: ${row.hold_days} days.`,
    `Before claiming anything from ${row.name}, verify the claim link on its official site or social account and never sign a blind approval; revoke the spending allowance right after claiming. Cost: ~$${Math.max(1, Math.round(setup / 3))} in gas. Time: 15 minutes.`,
    `Exit plan: when ${row.name} issues a token, claim it, sell half within the first week and keep the rest for a month; if no token appears after the hold, withdraw the $${row.capital_usd} and move on. Cost: ~$${setup} in gas. Time: 30 minutes.`,
  ];
  return steps;
}

// ------------------------------------------------------------------ the board

export function buildBoard(snapshot: Snapshot): Board {
  const asOf = snapshot.as_of;
  const watchlist = new Set(snapshot.watchlist);

  const live = snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.tvl_usd > 0,
  );
  const globalMedian = median(live.map((p) => (p.mcap_usd as number) / p.tvl_usd));

  const byCategory = new Map<string, number[]>();
  const byFamily = new Map<string, number[]>();
  for (const p of live) {
    const ratio = (p.mcap_usd as number) / p.tvl_usd;
    if (p.category !== null) {
      const list = byCategory.get(p.category) ?? [];
      list.push(ratio);
      byCategory.set(p.category, list);
      const family = CATEGORY_FAMILY[p.category];
      if (family !== undefined) {
        const famList = byFamily.get(family) ?? [];
        famList.push(ratio);
        byFamily.set(family, famList);
      }
    }
  }

  const eligible = snapshot.protocols.filter(isEligible);
  const knownAges = eligible
    .map((p) => ageYears(p, asOf, 0))
    .filter((a): a is number => a !== null);
  const medianAge = knownAges.length > 0 ? median(knownAges) : 1;

  const tiers = { category: 0, family: 0, global: 0 };
  const scored: BoardRow[] = eligible.map((p) => {
    const category = p.category ?? 'Uncategorised';
    const family = (p.category !== null && CATEGORY_FAMILY[p.category]) || 'Infra';
    const peers = p.category !== null ? byCategory.get(p.category) ?? [] : [];
    let multiple: number;
    let tier: BoardRow['peer_tier'];
    let peerCount: number;
    if (peers.length >= 8) {
      multiple = median(peers);
      tier = 'category';
      peerCount = peers.length;
    } else if (byFamily.has(family)) {
      multiple = median(byFamily.get(family) as number[]);
      tier = 'family';
      peerCount = (byFamily.get(family) as number[]).length;
    } else {
      multiple = globalMedian;
      tier = 'global';
      peerCount = live.length;
    }
    tiers[tier] += 1;
    multiple = clamp(multiple, 0.03, 1.0);

    const age = ageYears(p, asOf, medianAge);
    const ageForFactors = age === null ? medianAge : age;
    const growth = growthFactor(p.change_7d);
    const maturity = maturityFactor(ageForFactors);
    const breadth = breadthFactor(p.chains.length);
    const implied = Math.floor(p.tvl_usd * multiple * growth * maturity * breadth);

    const capital = capitalTier(p.tvl_usd);
    const hold = holdDays(age, medianAge);
    const setup = Math.max(4, Math.round(capital * 0.03));
    const weekly = Math.max(2, Math.round(capital * 0.015));

    let points = 0;
    if (tier === 'category') points += 1;
    if (p.listed_at !== null) points += 1;
    if (p.change_7d !== null) points += 1;
    const confidence: BoardRow['confidence'] =
      points === 3 ? 'High' : points === 2 ? 'Medium' : 'Low';

    const row: BoardRow = {
      slug: p.slug,
      name: p.name,
      category,
      family,
      chains: [...p.chains],
      chain_count: p.chains.length,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      age_years: age === null ? null : Math.round(age * 100) / 100,
      watchlist: watchlist.has(p.slug),
      rank: 0,
      implied_value_usd: implied,
      peer_multiple: Math.round(multiple * 1e6) / 1e6,
      peer_tier: tier,
      peer_count: peerCount,
      growth_factor: Math.round(growth * 1e6) / 1e6,
      maturity_factor: Math.round(maturity * 1e6) / 1e6,
      breadth_factor: Math.round(breadth * 1e6) / 1e6,
      radar_score: 0,
      confidence,
      capital_usd: capital,
      hold_days: hold,
      setup_cost_usd: setup,
      weekly_cost_usd: weekly,
      farm_steps: [],
    };
    row.farm_steps = farmPlan(row);
    return row;
  });

  // Rank is the implied value, highest first. Scores need the board's own
  // log range, so they are filled in after the sort.
  scored.sort((a, b) => b.implied_value_usd - a.implied_value_usd);
  scored.forEach((row, i) => {
    row.rank = i + 1;
  });
  const logs = scored.map((r) => Math.log(r.implied_value_usd));
  const logMin = Math.min(...logs);
  const logMax = Math.max(...logs);
  const logSpan = logMax - logMin || 1;
  for (const row of scored) {
    const logPart = ((Math.log(row.implied_value_usd) - logMin) / logSpan) * 100;
    const moved = row.change_7d === null ? 0 : clamp(row.change_7d, -50, 100);
    const momentumPart = ((moved + 50) / 150) * 100;
    row.radar_score = Math.round(0.7 * logPart + 0.3 * momentumPart);
  }

  // Peer-multiples table: one row per category with at least one live
  // peer, with the multiple the board actually used for it.
  const boardByCategory = new Map<string, number>();
  for (const row of scored) {
    boardByCategory.set(row.category, (boardByCategory.get(row.category) ?? 0) + 1);
  }
  const peers: PeerRow[] = [...byCategory.entries()]
    .map(([category, ratios]) => {
      const family = CATEGORY_FAMILY[category] ?? 'Infra';
      const raw = median(ratios);
      const direct = ratios.length >= 8;
      const used = direct
        ? clamp(raw, 0.03, 1.0)
        : clamp(median(byFamily.get(family) ?? [globalMedian]), 0.03, 1.0);
      return {
        category,
        family,
        peer_count: ratios.length,
        median_multiple: Math.round(raw * 10000) / 10000,
        used_multiple: Math.round(used * 10000) / 10000,
        tier_used: direct ? ('category' as const) : ('family' as const),
        board_rows: boardByCategory.get(category) ?? 0,
      };
    })
    .sort((a, b) => b.peer_count - a.peer_count || (a.category < b.category ? -1 : 1));

  // Live tokens, shown apart from the ranking: the 36 largest by market
  // cap, with the market's own values, never mixed into the board.
  const liveRows: LiveRow[] = live
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category ?? 'Uncategorised',
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd as number,
      ratio: Math.round(((p.mcap_usd as number) / p.tvl_usd) * 10000) / 10000,
    }))
    .sort((a, b) => b.mcap_usd - a.mcap_usd)
    .slice(0, 36);

  return {
    model: 'radar-3',
    as_of: asOf,
    rows: scored,
    peers,
    live: liveRows,
    tiers,
    watchlist_total: snapshot.watchlist.length,
    watchlist_covered: scored.filter((r) => r.watchlist).length,
  };
}
