import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
} from 'firebase/firestore';
import { db } from './firebase';

function mapProduct(docSnap, last = {}) {
  const data = typeof docSnap.data === 'function' ? docSnap.data() : docSnap;
  const id = docSnap.id || data.productId || data.id;
  const p = { id, ...data };
  return {
    ...p,
    viralScore: last.viralScore ?? p.lastViralScore ?? p.viralScore ?? 0,
    soldCount: last.soldCount ?? p.lastSoldCount ?? p.soldCount ?? null,
    price: last.price ?? p.lastPrice ?? null,
    rating: last.rating ?? p.lastRating ?? p.rating ?? null,
    reviewCount: last.reviewCount ?? p.lastReviewCount ?? p.reviewCount ?? null,
    saleFormatted: last.saleFormatted ?? p.lastSaleFormatted ?? null,
    currency: last.currency ?? p.lastCurrency ?? 'R$',
  };
}

/** Retorna os N produtos mais recentemente vistos. */
export async function fetchRecentProducts(topN = 50) {
  if (!db) return [];

  try {
    const q = query(collection(db, 'products'), orderBy('lastSeenAt', 'desc'), limit(topN));
    const snap = await getDocs(q);
    return snap.docs.map((d) => mapProduct(d));
  } catch {
    const snap = await getDocs(query(collection(db, 'products'), limit(topN)));
    return snap.docs.map((d) => mapProduct(d));
  }
}

/** Produtos + último snapshot (fallback nos campos denormalizados do doc). */
export async function fetchTopViral(topN = 30) {
  if (!db) return [];

  let products = await fetchRecentProducts(topN * 2);
  if (!products.length) {
    const snap = await getDocs(query(collection(db, 'products'), limit(topN * 2)));
    products = snap.docs.map((d) => mapProduct(d));
  }

  const enriched = await Promise.all(
    products.map(async (p) => {
      try {
        const snapsSnap = await getDocs(
          query(
            collection(db, 'products', p.id, 'snapshots'),
            orderBy('capturedAt', 'desc'),
            limit(1)
          )
        );
        const last = snapsSnap.docs[0]?.data() || {};
        return mapProduct(p, last);
      } catch {
        return p;
      }
    })
  );

  return enriched
    .sort((a, b) => (b.viralScore || 0) - (a.viralScore || 0))
    .slice(0, topN);
}

/** Detalhes de UM produto + histórico. */
export async function fetchProductDetail(productId) {
  if (!db) return null;
  const pRef = doc(db, 'products', productId);
  const pSnap = await getDoc(pRef);
  if (!pSnap.exists()) return null;

  const [snapshotsSnap, dailySnap] = await Promise.all([
    getDocs(
      query(collection(db, 'products', productId, 'snapshots'), orderBy('capturedAt', 'desc'), limit(60))
    ).catch(() => ({ docs: [] })),
    getDocs(
      query(collection(db, 'products', productId, 'daily'), orderBy('date', 'desc'), limit(30))
    ).catch(() => ({ docs: [] })),
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
  try {
    const q = query(collection(db, 'runs'), orderBy('startedAt', 'desc'), limit(n));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    const snap = await getDocs(query(collection(db, 'runs'), limit(n)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
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
