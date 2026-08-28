#!/usr/bin/env node

/**
 * Watcher local: escuta a coleção `scrape_requests` no Firestore e dispara
 * o pipeline sync-viral-v2 quando um novo pedido aparece (do dashboard).
 *
 * Rode continuamente no PC:
 *   npm run watcher
 *
 * Vai ficar em background. Chrome debug precisa estar aberto se algum
 * request tiver enrich > 0.
 */
import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { initFirebase } from './db/firebase.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYNC_SCRIPT = join(__dirname, 'sync-viral-v2.js');

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function runSync({ queries, enrich = 0 }) {
  return new Promise((resolve) => {
    const args = ['--save'];
    if (queries?.length) args.push('--queries', queries.join(','));
    if (enrich) args.push('--enrich', String(enrich));

    log(`▶ node sync-viral-v2 ${args.join(' ')}`);
    const child = spawn(process.execPath, [SYNC_SCRIPT, ...args], {
      stdio: 'inherit',
      env: process.env,
    });

    child.on('exit', (code) => {
      log(`◀ pipeline saiu com code=${code}`);
      resolve({ code, ok: code === 0 });
    });
  });
}

async function main() {
  const db = await initFirebase();
  const { FieldValue, Timestamp } = await import('firebase-admin/firestore');

  // ignora requests antigos ao iniciar
  const startedAt = Timestamp.now();

  log('👀 Watching scrape_requests where status == "pending"...');
  log('   Startup time:', startedAt.toDate().toISOString());

  const unsub = db
    .collection('scrape_requests')
    .where('status', '==', 'pending')
    .onSnapshot(
      async (snap) => {
        for (const change of snap.docChanges()) {
          if (change.type !== 'added') continue;
          const doc = change.doc;
          const data = doc.data();

          // Só processa se foi criado após o watcher subir (evita reprocessar)
          if (data.createdAt && data.createdAt.toMillis() < startedAt.toMillis()) {
            continue;
          }

          log(`📬 Request ${doc.id}: queries=${JSON.stringify(data.queries)} enrich=${data.enrich}`);

          // Marca running
          try {
            await doc.ref.update({
              status: 'running',
              startedAt: FieldValue.serverTimestamp(),
            });
          } catch (err) {
            log(`   ⚠  não conseguiu marcar running: ${err.message}`);
            continue;
          }

          // Roda pipeline
          const result = await runSync({
            queries: data.queries || undefined,
            enrich: Number(data.enrich) || 0,
          });

          // Marca done/error
          try {
            await doc.ref.update({
              status: result.ok ? 'done' : 'error',
              finishedAt: FieldValue.serverTimestamp(),
              exitCode: result.code,
            });
            log(`   ✅ marcado ${result.ok ? 'done' : 'error'}`);
          } catch (err) {
            log(`   ⚠  não conseguiu marcar done: ${err.message}`);
          }
        }
      },
      (err) => {
        log('❌ onSnapshot error:', err.message);
        process.exit(1);
      }
    );

  // Mantém vivo
  process.on('SIGINT', () => {
    log('👋 SIGINT — desligando watcher');
    unsub();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
