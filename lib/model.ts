// The token radar's model, version radar-3: one sealed snapshot in, one ranked board out.
//
// The board ranks every protocol the house rule leaves eligible: the watchlist (the floor, never the
// ceiling) plus every other pre-token protocol that is not a wrapped, staked or bridged product of a
// token that already trades. A protocol is pre-token when its record carries no token (no market cap,
// no CoinGecko id, no symbol); live-token protocols are kept apart and shown with the market's own
// values, never mixed into the ranked board. The page says a protocol records no token, never that
// it has none: a record can miss a token that exists.
//
// Implied value is peer-calibrated in three tiers, never a flat multiple and never a hand-kept list
// of names. The multiple a protocol gets is the median market-cap-to-TVL ratio of the live-token
// protocols in its own category when that category has at least 8 peers in this same snapshot;
// otherwise the median of its category family (Trading, Lending, Yield, Stable & RWA, Infra, Other);
// otherwise the snapshot-wide median. On this snapshot 76 rows take the category tier, 122 the
// family tier, and none falls back to the global median. Every multiple is clamped to [0.03, 1.00]:
//
//   multiple   = peer median mcap / TVL: category, else family, else global
//   growth     = clamp(change_7d, -80, 300) per cent
//   growthMult = 1 + (growth / 100) x 0.60 when growth is up, x 0.90 when it is down
//                (a falling TVL bites harder than a rising one rewards: declines are stickier)
//   age        = days from listed_at to the snapshot's as_of (unknown: the eligible median age)
//   maturity   = 0.70 + 0.50 x (1 - exp(-age / 730)): 0.70 at day zero, saturating toward 1.20,
//                so each extra year a protocol runs with no token adds less than the last
//   breadth    = 1 + 0.03 x sqrt(min(chains, 8)): more chains help, with diminishing returns
//   implied    = max(1, round(tvl_usd x multiple x growthMult x maturityMult x breadthMult))
//
// Each row also carries a Radar score (0-100: 70% where its implied value sits on the board's log
// scale, 30% its 7-day momentum) and a confidence (High / Medium / Low: direct category peers, a
// known listing date, a reported 7-day change). The score is a second lens for sorting; the rank
// itself is always the implied value.
//
// No protocol name is ever special-cased: the same function scores every row, and the peer multiples
// are recomputed from the snapshot on every run, so the model follows the snapshot's own figures.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_up_weight: number;
  growth_down_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_halflife_days: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
  peer_min_count: number;
  peer_floor: number;
  peer_cap: number;
}

export const MODEL: ModelConstants = {
  growth_up_weight: 0.6,
  growth_down_weight: 0.9,
  growth_floor: -80,
  growth_cap: 300,
  maturity_floor: 0.7,
  maturity_range: 0.5,
  maturity_halflife_days: 730,
  breadth_per_chain: 0.03,
  breadth_max_chains: 8,
  peer_min_count: 8,
  peer_floor: 0.03,
  peer_cap: 1.0,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-3';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 36;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  score: number;
  confidence: 'High' | 'Medium' | 'Low';
  peer_tier: 'category' | 'family' | 'global';
  model: {
    peer_multiple: number;
    peer_tier: 'category' | 'family' | 'global';
    peer_count: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row; the farm plan is derived in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  score: number;
  confidence: 'High' | 'Medium' | 'Low';
  peer_tier: 'category' | 'family' | 'global';
  peer_multiple: number;
  peer_count: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  /** The board's own farm plan, verbatim: the page renders these, and checks its own derivation against them. */
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_tvl_ratio: number | null;
}

/** One peer-calibration row for the dashboard's peer table. */
export interface PeerEntry {
  category: string;
  peers: number;
  multiple: number;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  peer_global: number;
  peer_global_count: number;
  peer_by_category: Record<string, number>;
  peer_count_by_category: Record<string, number>;
  peer_by_family: Record<string, number>;
  peer_count_by_family: Record<string, number>;
  peer_tier_counts: { category: number; family: number; global: number };
  median_age_days: number;
  watchlist: string[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a sorted array of numbers. */
function medianOf(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are a wrapped, staked or bridged product of a token that already trades. */
const PRODUCT_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** A name carrying a whole word wrapped, staked or staking is a product of a token that trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** A name beginning with an exchange's name is that exchange's product. */
const EXCHANGE_NAME = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token and not a product of a trading token. */
export function isEligible(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_NAME.test(p.name)) return false;
  return true;
}

/**
 * Category families: when a category has too few live-token peers to calibrate on its own, its
 * family pools the nearest categories. Every family is named from the categories it holds.
 */
export const FAMILIES: Record<string, string[]> = {
  Trading: ['Dexs', 'Derivatives', 'Dex Aggregator', 'Options', 'Prediction Market', 'Basis Trading', 'OTC Marketplace', 'Interest Rate Derivatives', 'Perpetuals', 'Synthetics'],
  Lending: ['Lending', 'CDP', 'CDP Manager', 'Leveraged Farming', 'Uncollateralized Lending', 'Collateral Markets', 'Risk Curators', 'Onchain Capital Allocator', 'CeDeFi', 'Anchor BTC'],
  Yield: ['Yield', 'Yield Aggregator', 'Farm', 'Liquidity Manager', 'Restaking', 'Staking Pool', 'Governance Incentives', 'Indexes', 'Vaults'],
  'Stable & RWA': ['RWA', 'Stablecoin Wrapper', 'Dual-Token Stablecoin', 'Payments', 'Crypto Card Issuer', 'Stablecoins'],
  Infra: ['Chain', 'Cross Chain Bridge', 'Bridge', 'Canonical Bridge', 'Insurance', 'Privacy', 'Oracle'],
};

/** The family a category belongs to, or 'Other' when it belongs to none. */
export function familyOf(category: string | null): string {
  if (category === null) return 'Other';
  for (const [family, members] of Object.entries(FAMILIES)) {
    if (members.includes(category)) return family;
  }
  return 'Other';
}

/** The peer multiples of the snapshot: the median mcap/TVL of live-token protocols, per category and per family. */
export interface PeerTable {
  global: number;
  globalCount: number;
  byCategory: Map<string, number>;
  countByCategory: Map<string, number>;
  byFamily: Map<string, number>;
  countByFamily: Map<string, number>;
}

export function peerMultiples(protocols: SnapshotProtocol[], model: ModelConstants = MODEL): PeerTable {
  const live = protocols.filter((p) => p.mcap_usd !== null && p.tvl_usd > 0 && p.category !== 'CEX');
  const clamp = (n: number): number => Math.min(model.peer_cap, Math.max(model.peer_floor, n));
  const all = live.map((p) => p.mcap_usd! / p.tvl_usd).sort((a, b) => a - b);
  const global = clamp(medianOf(all));
  const byCategory = new Map<string, number>();
  const countByCategory = new Map<string, number>();
  const byFamily = new Map<string, number>();
  const countByFamily = new Map<string, number>();
  const perCategory = new Map<string, number[]>();
  const perFamily = new Map<string, number[]>();
  for (const p of live) {
    const key = p.category ?? 'null';
    const ratio = p.mcap_usd! / p.tvl_usd;
    const list = perCategory.get(key) ?? [];
    list.push(ratio);
    perCategory.set(key, list);
    const fam = familyOf(p.category);
    const flist = perFamily.get(fam) ?? [];
    flist.push(ratio);
    perFamily.set(fam, flist);
  }
  for (const [key, ratios] of perCategory) {
    ratios.sort((a, b) => a - b);
    countByCategory.set(key, ratios.length);
    byCategory.set(key, clamp(medianOf(ratios)));
  }
  for (const [key, ratios] of perFamily) {
    ratios.sort((a, b) => a - b);
    countByFamily.set(key, ratios.length);
    byFamily.set(key, clamp(medianOf(ratios)));
  }
  return { global, globalCount: all.length, byCategory, countByCategory, byFamily, countByFamily };
}

/** The peer multiple one protocol gets, with the tier that supplied it and its peer count. */
export function peerMultipleFor(
  p: SnapshotProtocol,
  peers: PeerTable,
  model: ModelConstants = MODEL,
): { multiple: number; tier: 'category' | 'family' | 'global'; count: number } {
  const key = p.category ?? 'null';
  const catCount = peers.countByCategory.get(key) ?? 0;
  if (catCount >= model.peer_min_count) {
    return { multiple: peers.byCategory.get(key) ?? peers.global, tier: 'category', count: catCount };
  }
  const fam = familyOf(p.category);
  const famCount = peers.countByFamily.get(fam) ?? 0;
  if (famCount >= model.peer_min_count) {
    return { multiple: peers.byFamily.get(fam) ?? peers.global, tier: 'family', count: famCount };
  }
  return { multiple: peers.global, tier: 'global', count: peers.globalCount };
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  peers: PeerTable,
  medianAge: number,
  model: ModelConstants = MODEL,
): {
  implied: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  breadthMult: number;
  peerMultiple: number;
  peerTier: 'category' | 'family' | 'global';
  peerCount: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const peer = peerMultipleFor(protocol, peers, model);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const weight = growthPct >= 0 ? model.growth_up_weight : model.growth_down_weight;
  const growthMult = 1 + (growthPct / 100) * weight;
  const ageForModel = age ?? medianAge;
  const maturityMult =
    model.maturity_floor +
    model.maturity_range * (1 - Math.exp(-Math.max(ageForModel, 0) / model.maturity_halflife_days));
  const breadthMult = 1 + model.breadth_per_chain * Math.sqrt(Math.min(protocol.chains.length, model.breadth_max_chains));
  const implied = Math.max(1, Math.round(protocol.tvl_usd * peer.multiple * growthMult * maturityMult * breadthMult));
  return { implied, growthPct, growthMult, maturityMult, breadthMult, peerMultiple: peer.multiple, peerTier: peer.tier, peerCount: peer.count, age };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The median age, in days, of the eligible protocols with a known listing date. */
export function medianAgeOf(protocols: SnapshotProtocol[], asOf: string): number {
  const ages = protocols
    .map((p) => ageDays(asOf, p.listed_at))
    .filter((a): a is number => a !== null)
    .sort((a, b) => a - b);
  return ages.length === 0 ? 365 : medianOf(ages);
}

/** How much the model's evidence backs one row: direct peers, a known age, a reported 7-day change. */
export function confidenceOf(peerCount: number, age: number | null, change7d: number | null): 'High' | 'Medium' | 'Low' {
  let signals = 0;
  if (peerCount >= 8) signals += 1;
  if (age !== null) signals += 1;
  if (change7d !== null) signals += 1;
  return signals === 3 ? 'High' : signals === 2 ? 'Medium' : 'Low';
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const peers = peerMultiples(snapshot.protocols, model);
  const eligible = snapshot.protocols.filter(isEligible);
  const medianAge = medianAgeOf(eligible, snapshot.as_of);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the eligibility rule would leave out.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other eligible protocol, above or below the floor. No TVL cutoff.
  for (const p of eligible) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const s = impliedValue(p, snapshot.as_of, peers, medianAge, model);
    return { p, ...s };
  });  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));

  // The Radar score: 70% where the implied value sits on the board's log scale, 30% momentum.
  const logMin = Math.log10(Math.max(1, scored[scored.length - 1]!.implied));
  const logMax = Math.log10(Math.max(1, scored[0]!.implied));
  const logSpan = Math.max(1e-9, logMax - logMin);
  const scoreOf = (s: { implied: number; growthPct: number }): number => {
    const valueNorm = (Math.log10(Math.max(1, s.implied)) - logMin) / logSpan;
    const momentumNorm = (s.growthPct - model.growth_floor) / (model.growth_cap - model.growth_floor);
    return Math.max(0, Math.min(100, Math.round(70 * valueNorm + 30 * momentumNorm)));
  };

  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    age_days: s.age,
    implied_value_usd: s.implied,
    score: scoreOf(s),
    // Confidence reads the DIRECT category peers, not the tier that calibrated the row:
    // a family-tier row is honest about borrowing its multiple from its neighbours.
    confidence: confidenceOf(peers.countByCategory.get(s.p.category ?? 'null') ?? 0, s.age, s.p.change_7d),
    peer_tier: s.peerTier,
    model: {
      peer_multiple: round4(s.peerMultiple),
      peer_tier: s.peerTier,
      peer_count: s.peerCount,
      growth_pct: round4(s.growthPct),
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      breadth_multiplier: round4(s.breadthMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the position open and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 500;
  if (p.tvl_usd >= 100_000_000) return 250;
  if (p.tvl_usd >= 10_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 90;
  if (age < 365) return 60;
  return 45;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Lend $${capital} of USDC into ${name} on ${chain} and leave it supplied.`;
  if (c.includes('dex') || c.includes('swap') || c.includes('liquidity')) return `Add $${capital} of liquidity to ${name}'s deepest pool on ${chain} and hold the LP position.`;
  if (c.includes('yield') || c.includes('farm') || c.includes('aggregator')) return `Deposit $${capital} of USDC into ${name}'s highest-TVL vault on ${chain}.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault')) return `Allocate $${capital} to a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it.`;
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('options')) return `Post $${capital} of USDC as collateral on ${name} and open a small hedged position.`;
  if (c.includes('prediction')) return `Back one outcome with $${capital} on ${name} and leave the position open.`;
  if (c.includes('stable')) return `Mint $${capital} of the stable asset against collateral on ${name} on ${chain}.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover on ${name} on ${chain} and keep the policy active.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} through ${name} on ${chain} and keep the receipt token.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC through ${name} to ${chain} and put the funds to work there.`;
  return `Open a $${capital} position in ${name} on ${chain} and keep it active.`;
}

/** A second, different action in the same protocol, so the wallet shows more than one kind of use. */
function secondActionFor(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Borrow $25 of USDC against the supplied collateral on ${name}, then repay it within the week, so the position shows both sides of the market.`;
  if (c.includes('dex') || c.includes('swap') || c.includes('liquidity')) return `Make one $10 swap through ${name} on ${chain} each week, so the wallet shows trading volume as well as liquidity.`;
  if (c.includes('yield') || c.includes('farm') || c.includes('aggregator')) return `Claim any yield or points weekly and re-deposit them into the same vault, so the position compounds instead of sitting idle.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault')) return `Vote on one vault allocation or rebalance proposal when ${name} posts it, so the wallet is a participant and not just a deposit.`;
  if (c.includes('rwa')) return `Hold the asset through one full payout cycle and check the redemption window, so you know how to exit before you need to.`;
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('options')) return `Close and reopen a small hedged position once, so the account shows more than a single trade.`;
  if (c.includes('prediction')) return `Settle the first market and back a second outcome, so the wallet shows repeat activity.`;
  if (c.includes('stable')) return `Hold the minted stable asset for a full week and use it in one payment or deposit, so it circulates instead of sitting in the wallet.`;
  if (c.includes('insurance')) return `Review the cover terms and the renewal date each month, and renew before the policy lapses.`;
  if (c.includes('staking') || c.includes('restak')) return `Restake the staking rewards once, so the position grows from its own yield.`;
  if (c.includes('bridge')) return `Bridge a second, smaller amount back the other way, so the wallet shows two-way flow.`;
  return `Do one more on-chain action in ${name} within the first week: a vote, a claim, or a second deposit.`;
}

/**
 * A protocol's farm plan: eight steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  return [
    {
      text: `Set aside a fresh wallet for this farm only, and store its seed phrase offline.`,
      cost: 'under $3 in gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital plus about $${capital >= 500 ? 10 : capital >= 250 ? 8 : 5} in gas`,
      time: '15 minutes to set up',
    },
    {
      text: secondActionFor(p, chain),
      cost: 'about $3 in gas',
      time: '10 minutes',
    },
    {
      text: `Return once a week and make one real action: a deposit, a swap, a vote, or a claim.`,
      cost: 'about $2 in gas per week',
      time: '10 minutes a week',
    },
    {
      text: `Check the protocol's own points or rewards page before you move anything, and claim only through links it publishes.`,
      cost: 'free to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Keep the position open for at least ${hold} days, so the activity lands in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `If the protocol announces a token or a claim window, read its own announcement first and claim only from the address it names.`,
      cost: 'free to check; gas only when you claim',
      time: '10 minutes',
    },
    {
      text: `Log the wallet, the dates, and every transaction hash, and plan the exit now: withdraw, bridge back, and revoke any approval you no longer need.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      mcap_tvl_ratio: p.tvl_usd > 0 && p.mcap_usd !== null ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** A board row's compact form for data.js, with the model's multipliers unrounded: the page recomputes
 * each implied value from the raw figures, so the page's code and the board's data are visibly the same
 * arithmetic. The farm plan is derived in the page, from the same derivation main.ts runs. */
export function radarRow(
  row: BoardRow,
  raw: { peerMultiple: number; peerCount: number; growthMult: number; maturityMult: number; breadthMult: number },
): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    score: row.score,
    confidence: row.confidence,
    peer_tier: row.peer_tier,
    peer_multiple: raw.peerMultiple,
    peer_count: raw.peerCount,
    growth_multiplier: raw.growthMult,
    maturity_multiplier: raw.maturityMult,
    breadth_multiplier: raw.breadthMult,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const peers = peerMultiples(snapshot.protocols, model);
  const eligible = snapshot.protocols.filter(isEligible);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const peerByCategory: Record<string, number> = {};
  const peerCountByCategory: Record<string, number> = {};
  for (const [key, value] of [...peers.byCategory.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    peerByCategory[key] = round4(value);
    peerCountByCategory[key] = peers.countByCategory.get(key) ?? 0;
  }
  const peerByFamily: Record<string, number> = {};
  const peerCountByFamily: Record<string, number> = {};
  for (const [key, value] of [...peers.byFamily.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    peerByFamily[key] = round4(value);
    peerCountByFamily[key] = peers.countByFamily.get(key) ?? 0;
  }
  const tierCounts = { category: 0, family: 0, global: 0 };
  for (const row of board) tierCounts[row.peer_tier] += 1;
  // The raw multipliers, recomputed from the snapshot for each row, so data.js carries them unrounded.
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const medianAge = medianAgeOf(eligible, snapshot.as_of);
  const rows = board.map((row) => {
    const p = bySlug.get(row.slug)!;
    const s = impliedValue(p, snapshot.as_of, peers, medianAge, model);
    return radarRow(row, s);
  });
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    peer_global: round4(peers.global),
    peer_global_count: peers.globalCount,
    peer_by_category: peerByCategory,
    peer_count_by_category: peerCountByCategory,
    peer_by_family: peerByFamily,
    peer_count_by_family: peerCountByFamily,
    peer_tier_counts: tierCounts,
    median_age_days: medianAgeOf(eligible, snapshot.as_of),
    watchlist: snapshot.watchlist,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows,
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
