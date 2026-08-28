import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { db } from './firebase';

/** Retorna os N produtos mais recentemente vistos, ordenados por lastSeenAt. */
export async function fetchRecentProducts(topN = 50) {
  if (!db) return [];
  const q = query(collection(db, 'products'), orderBy('lastSeenAt', 'desc'), limit(topN));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Retorna produtos + último snapshot (para ordenar por viralScore/soldCount).
 * Faz N+1 reads — usar limit baixo (30 já basta pra dashboard).
 */
export async function fetchTopViral(topN = 30) {
  if (!db) return [];
  const products = await fetchRecentProducts(topN * 2);

  const withSnapshots = await Promise.all(
    products.map(async (p) => {
      const snapsQ = query(
        collection(db, 'products', p.id, 'snapshots'),
        orderBy('capturedAt', 'desc'),
        limit(1)
      );
      const snapsSnap = await getDocs(snapsQ);
      const last = snapsSnap.docs[0]?.data() || {};
      return {
        ...p,
        lastSnapshot: last,
        viralScore: last.viralScore ?? 0,
        soldCount: last.soldCount ?? null,
        price: last.price ?? null,
        rating: last.rating ?? null,
        reviewCount: last.reviewCount ?? null,
        saleFormatted: last.saleFormatted ?? null,
        currency: last.currency ?? 'R$',
      };
    })
  );

  return withSnapshots
    .filter((p) => p.viralScore > 0 || p.soldCount != null)
    .sort((a, b) => (b.viralScore || 0) - (a.viralScore || 0))
    .slice(0, topN);
}

/** Detalhes de UM produto + histórico diário. */
export async function fetchProductDetail(productId) {
  if (!db) return null;
  const pRef = doc(db, 'products', productId);
  const pSnap = await getDoc(pRef);
  if (!pSnap.exists()) return null;

  const [snapshotsSnap, dailySnap] = await Promise.all([
    getDocs(
      query(collection(db, 'products', productId, 'snapshots'), orderBy('capturedAt', 'desc'), limit(60))
    ),
    getDocs(
      query(collection(db, 'products', productId, 'daily'), orderBy('date', 'desc'), limit(30))
    ),
  ]);

  return {
    id: pSnap.id,
    ...pSnap.data(),
    snapshots: snapshotsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    daily: dailySnap.docs.map((d) => ({ id: d.id, ...d.data() })).reverse(),
  };
}

/** Últimas N runs. */
export async function fetchRecentRuns(n = 10) {
  if (!db) return [];
  const q = query(collection(db, 'runs'), orderBy('startedAt', 'desc'), limit(n));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Contagens simples pro topo do dashboard. */
export async function fetchCounts() {
  if (!db) return { products: 0, runs: 0 };
  const [prod, runs] = await Promise.all([
    getDocs(query(collection(db, 'products'), limit(1000))),
    getDocs(query(collection(db, 'runs'), limit(1000))),
  ]);
  return { products: prod.size, runs: runs.size };
}
