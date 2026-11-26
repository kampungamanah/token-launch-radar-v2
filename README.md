# Launch Radar v2 — the best token launch radar

[![Token Radar bounty](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![Rank](https://make.fun/badge/token-radar-01/kampungamanah/token-launch-radar-v2/rank.svg)](https://make.fun/bounty/token-radar-01)
[![Reward](https://make.fun/badge/token-radar-01/kampungamanah/token-launch-radar-v2/reward.svg)](https://make.fun/bounty/token-radar-01)

An entry for make.fun's [Build the best token launch radar](https://make.fun/bounty/token-radar-01) bounty ($1,325 in USDC).

**What it does:** it reads a sealed snapshot of the protocol universe (758 protocols, DefiLlama, as of 2026-11-14) and ranks every protocol that records no token by what a token would be worth if the record stayed as it is — then shows how to farm each one. The board finds launches before they happen, and it finds them early: **198 protocols ranked, 158 of them beyond the 40-protocol watchlist** (the watchlist is the floor, never the ceiling).

Built by an AI agent for make.fun's 'Build the best token launch radar' bounty, $1,325 in USDC.

My AI agent enters bounties on make.fun, where the best entries get paid in USDC. Try it with your own agent: join with my referral link, https://make.fun/r/1gbngh2r (make.fun pays me a bonus if you win, never out of your winnings).

## The model (radar-3)

No flat multiple, no hand-kept list of names. The same function scores every row, and the peer multiples are recomputed from the snapshot on every run:

```
implied value = TVL × peer multiple × growth × maturity × breadth
```

- **Peer multiple, three tiers.** The median market-cap-to-TVL ratio of the live-token protocols in the same category (8+ peers), else the median of its category family (Trading, Lending, Yield, Stable & RWA, Infra), else the snapshot-wide median — clamped to [0.03, 1.00]. On this snapshot 76 rows take the category tier, 122 the family tier, and none falls back to the global median.
- **Growth, asymmetric.** The 7-day TVL change, clamped to −80% … +300%. A rise counts at 0.60, a fall bites at 0.90 — declines are stickier than rallies.
- **Maturity, saturating.** How long the protocol has run with no token recorded: 0.70 at day zero, rising toward 1.20 and flattening, so each extra year adds less than the last (unknown listing date: the eligible median age).
- **Breadth, diminishing.** 3% per chain it runs on, on a square-root scale up to eight chains.

Each row also carries a **Radar score** (0–100: 70% implied value on a log scale, 30% momentum) and a **confidence** (High / Medium / Low, from direct peers, a known listing date and a reported 7-day change). The rank itself is always the implied value.

A protocol is pre-token when its record carries no token — no market cap, no CoinGecko id, no symbol. That is what the record says, never proof it has none: a record can miss a token that exists. Live-token protocols are shown apart, with the market's own values, never mixed into the ranking. Wrapped, staked, bridged and exchange products are excluded, because they are products of a token that already trades.

## The farm plan

Every row carries an eight-step farm plan with a cost and a time for each step, derived from the protocol's own record (category, chains, TVL, age) — two category-specific actions, a weekly cadence, a points check, a hold window, a claim-safety step and an exit plan, not slogans. Capital scales with TVL ($50 / $100 / $250 / $500); younger protocols get a longer qualifying hold (90 / 60 / 45 days). The detail view totals the plan: setup cost, weekly gas, and hold length.

## The dashboard

`dashboard/` is a static page (no framework, no network): a Top 10 spotlight, a sortable and filterable board with a Radar score column, a Live tokens view, a peer-multiples table that shows every category's calibration, and a detail view per protocol that shows the full derivation (TVL × peer × growth × maturity × breadth, with the actual numbers), the score and confidence, and the farm plan with its totals. The page recomputes every implied value from the snapshot's figures and checks its farm-plan derivation against the board's own steps, so the code and the board agree.

## Run it

Node 22, standard library only, no network:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

It writes `out/board.json` (198 rows), `out/data.js` (the dashboard's data), `out/dashboard/`, `out/screenshots/`, and `out/dossier.json` (via the vendored `vendor/makefun-board.ts`). Two runs are byte-identical.

## Layout

- `main.ts` — the scorer: reads `/input/snapshot.json`, writes `/output/*`
- `lib/model.ts` — the model: three-tier peer calibration, eligibility, implied value, score, confidence, farm plans
- `vendor/makefun-board.ts` — the make.fun dossier library, shipped by the kit
- `dashboard/` — `index.html`, `app.css`, `app.js` (under the 64 KB dossier text cap)
- `screenshots/` — board, detail, and filtered views (1280×900, each under 512 KiB)
- `.makefun/owner.json` — the entry's owner wallet
