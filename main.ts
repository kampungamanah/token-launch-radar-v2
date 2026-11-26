// Launch Radar — entrypoint.
//
// Reads the sealed snapshot, builds the ranked board, and writes the
// outputs the gate checks:
//
//   board.json      the ranked board (rows, peers, live tokens, tiers)
//   data.js         the same board as a script the dashboard page loads
//   dashboard/      a copy of dashboard/ (index, styles, app)
//   screenshots/    a copy of screenshots/ (board, detail, filtered)
//   dossier.json    buildDossier of the output directory
//
// Node 22, standard library only, no network. Two runs over the same
// snapshot write byte-identical outputs: no timestamps, no random values,
// no iteration over unordered maps in the output paths.
//
// Usage:
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
//
// The input defaults to /input/snapshot.json (the grader's sealed path),
// then to input/snapshot.json beside the repository. The output defaults
// to $MAKEFUN_OUTPUT_DIR, then /output when it exists, then ./out.

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBoard } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)));

function flagValue(argv: string[], name: string): string | undefined {
  const at = argv.indexOf(name);
  if (at >= 0 && at + 1 < argv.length) return argv[at + 1];
  const joined = argv.find((a) => a.startsWith(`${name}=`));
  return joined === undefined ? undefined : joined.slice(name.length + 1);
}

function pickInput(argv: string[]): string {
  const fromFlag = flagValue(argv, '--input');
  if (fromFlag !== undefined) return fromFlag;
  if (process.env.MAKEFUN_INPUT !== undefined) return process.env.MAKEFUN_INPUT;
  const sealed = '/input/snapshot.json';
  if (existsSync(sealed)) return sealed;
  const beside = join(REPO_ROOT, 'input', 'snapshot.json');
  if (existsSync(beside)) return beside;
  return sealed;
}

function pickOutput(argv: string[]): string {
  const fromFlag = flagValue(argv, '--output');
  if (fromFlag !== undefined) return fromFlag;
  if (process.env.MAKEFUN_OUTPUT_DIR !== undefined) return process.env.MAKEFUN_OUTPUT_DIR;
  if (existsSync('/output')) return '/output';
  return join(REPO_ROOT, 'out');
}

function main(): void {
  const argv = process.argv.slice(2);
  const inputPath = pickInput(argv);
  const outputDir = pickOutput(argv);

  const snapshot = JSON.parse(readFileSync(inputPath, 'utf8'));
  const board = buildBoard(snapshot);

  mkdirSync(outputDir, { recursive: true });
  mkdirSync(join(outputDir, 'dashboard'), { recursive: true });
  mkdirSync(join(outputDir, 'screenshots'), { recursive: true });

  // The board: one JSON object, keys in a fixed order, two-space indent.
  const boardJson = `${JSON.stringify(board, null, 2)}\n`;
  writeFileSync(join(outputDir, 'board.json'), boardJson, 'utf8');

  // The dashboard's data, as a plain script the page loads with no fetch.
  const dataJs = `window.RADAR = ${JSON.stringify(board)};\n`;
  writeFileSync(join(outputDir, 'data.js'), dataJs, 'utf8');

  // The page itself, and the screenshots taken of it.
  cpSync(join(REPO_ROOT, 'dashboard'), join(outputDir, 'dashboard'), { recursive: true });
  cpSync(join(REPO_ROOT, 'screenshots'), join(outputDir, 'screenshots'), { recursive: true });

  // The dossier is built last, from exactly what was just written, so it
  // always matches the output directory byte for byte.
  const dossier = buildDossier(outputDir, { text_max_bytes: 65536 });
  writeFileSync(join(outputDir, 'dossier.json'), dossier);

  const top = board.rows[0];
  console.log(
    `Launch Radar (${board.model}): ${board.rows.length} rows, ` +
      `watchlist ${board.watchlist_covered}/${board.watchlist_total}, ` +
      `tiers category ${board.tiers.category} / family ${board.tiers.family} / global ${board.tiers.global}, ` +
      `top ${top?.name ?? 'none'} $${(top?.implied_value_usd ?? 0).toLocaleString('en-US')}`,
  );
  console.log(`Wrote ${outputDir}/board.json, data.js, dashboard/, screenshots/, dossier.json`);
}

main();
