import {
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
  limit,
  serverTimestamp,
} from 'firebase/firestore';
import { auth, db } from './firebase';

/**
 * Enfileira uma coleta. O watcher local (npm run watcher) escuta essa collection
 * e dispara o pipeline no PC.
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
