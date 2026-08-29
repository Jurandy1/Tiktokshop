import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  limit,
  serverTimestamp,
} from 'firebase/firestore';
import { auth, db } from './firebase';

/**
 * Enfileira uma coleta. A Cloud Function onScrapeRequest (functions/src/on-scrape-request.js)
 * escuta essa collection e dispara o pipeline automaticamente — sem depender de
 * nenhum processo local. (O antigo watcher local, npm run watcher, continua existindo
 * só como fallback de dev.)
 */
export async function requestScrape({ queries, enrich = 0, note = null } = {}) {
  if (!db || !auth?.currentUser) throw new Error('Não autenticado');
  const ref = await addDoc(collection(db, 'scrape_requests'), {
    queries: queries || null,
    enrich,
    note,
    status: 'pending',
    createdAt: serverTimestamp(),
    requestedBy: auth.currentUser.email,
  });
  return ref.id;
}

/**
 * Observa UMA request específica pelo id (não depende de ela estar entre as
 * N mais recentes — importante se várias pessoas/abas enfileiram ao mesmo
 * tempo e a request "sai" da janela do watchRecentRequests antes de terminar).
 */
export function watchRequest(id, callback) {
  if (!db || !id) return () => {};
  return onSnapshot(
    doc(db, 'scrape_requests', id),
    (snap) => callback(snap.exists() ? { id: snap.id, ...snap.data() } : null),
    () => callback(null)
  );
}

/** Observa o estado das requests. Callback recebe array com as N mais recentes. */
export function watchRecentRequests(callback, n = 5) {
  if (!db) return () => {};
  const q = query(collection(db, 'scrape_requests'), orderBy('createdAt', 'desc'), limit(n));
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => callback([], err)
  );
}
