import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { db } from './firebase';

function mapVideo(docSnap) {
  const data = docSnap.data();
  return { id: docSnap.id, ...data };
}

/** Vídeos mais recentemente vistos (todos, com ou sem produto identificado). */
export async function fetchRecentVideos(topN = 60) {
  if (!db) return [];
  try {
    const q = query(collection(db, 'videos'), orderBy('lastSeenAt', 'desc'), limit(topN));
    const snap = await getDocs(q);
    return snap.docs.map(mapVideo);
  } catch {
    const snap = await getDocs(query(collection(db, 'videos'), limit(topN)));
    return snap.docs.map(mapVideo);
  }
}

/** Contagem de vídeos salvos — todos já têm produto confirmado (regra da coleta). */
export async function fetchVideoCount() {
  if (!db) return 0;
  const snap = await getDocs(query(collection(db, 'videos'), limit(1000)));
  return snap.size;
}

/** Vídeos com produto confirmado, ordenados pelos mais virais. */
export async function fetchTopViralVideos(topN = 60) {
  if (!db) return [];
  try {
    const q = query(
      collection(db, 'videos'),
      where('productKnown', '==', true),
      orderBy('lastViralScore', 'desc'),
      limit(topN)
    );
    const snap = await getDocs(q);
    return snap.docs.map(mapVideo);
  } catch {
    return [];
  }
}

/** Vídeos ligados a um produto específico. */
export async function fetchVideosByProduct(productId, topN = 20) {
  if (!db || !productId) return [];
  try {
    const q = query(
      collection(db, 'videos'),
      where('productId', '==', productId),
      orderBy('lastSeenAt', 'desc'),
      limit(topN)
    );
    const snap = await getDocs(q);
    return snap.docs.map(mapVideo);
  } catch {
    return [];
  }
}
