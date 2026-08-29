#!/usr/bin/env node

/**
 * CLI da pipeline v2: ScrapeCreators (BR) → schema Firestore novo.
 *
 * A lógica real mora em ./sync-viral-v2-core.js (reaproveitada também pelas
 * Cloud Functions em functions/src/). Este arquivo só faz parse de flags e
 * chama runSync().
 *
 * Uso:
 *   node src/sync-viral-v2.js                              # queries default, sem salvar
 *   node src/sync-viral-v2.js --queries achadinhos,tiktokshop
 *   node src/sync-viral-v2.js --save                       # grava no Firestore
 *   node src/sync-viral-v2.js --queries kit --min-sold 100 --save
 *
 * Custo: 1 crédito ScrapeCreators por query.
 */
import { runSync, DEFAULT_QUERIES } from './sync-viral-v2-core.js';

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      flags[key] = next;
      i++;
    } else flags[key] = true;
  }
  return flags;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const queries = (flags.queries || DEFAULT_QUERIES.join(','))
    .split(',')
    .map((q) => q.trim())
    .filter(Boolean);

  const result = await runSync({
    queries,
    minSold: Number(flags['min-sold'] || 0),
    region: (flags.region || 'BR').toUpperCase(),
    save: Boolean(flags.save || flags.firebase),
    enrich: Number(flags.enrich || 0),
    source: 'cli',
  });

  if (!result.ok) process.exit(2);
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
