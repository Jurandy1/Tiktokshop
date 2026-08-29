/**
 * Cópia simplificada de src/db/firebase.js pra dentro de functions/ (ver nota
 * de empacotamento em functions/src/scrapecreators.js). Aqui não existe
 * caminho "local" — a function sempre roda como Cloud Function, então
 * initializeApp() sempre usa credenciais automáticas (ADC).
 *
 * Mesmo schema em camadas do projeto:
 *   products/{productId}                        ← campos estáveis
 *   products/{productId}/snapshots/{tsIso}      ← série temporal
 *   products/{productId}/daily/{YYYY-MM-DD}     ← agregado diário
 *   videos/{videoId}                            ← metadados estáveis
 *   videos/{videoId}/snapshots/{tsIso}          ← série temporal
 *   runs/{runId}                                ← metadata da execução
 */
let db = null;
let FieldValue = null;
const TTL_DAYS_SNAPSHOTS = 90;

export async function initFirebase() {
  if (db) return db;

  const { initializeApp, getApps } = await import('firebase-admin/app');
  const firestoreModule = await import('firebase-admin/firestore');
  FieldValue = firestoreModule.FieldValue;

  if (getApps().length === 0) {
    initializeApp();
  }

  db = firestoreModule.getFirestore();
  return db;
}

function nowIso() {
  return new Date().toISOString();
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function snapshotDocId(iso = nowIso()) {
  return iso.replace(/[:.]/g, '-');
}

function ttlDate(days = TTL_DAYS_SNAPSHOTS) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

function stripUndefined(obj) {
  return JSON.parse(JSON.stringify(obj));
}

export function splitProductPayload(product) {
  const priceObj = typeof product.price === 'object' ? product.price : null;
  const salePrice = priceObj?.sale ?? product.price ?? null;
  const originalPrice = priceObj?.original ?? product.originalPrice ?? null;
  const currency = priceObj?.currency ?? product.currency ?? 'BRL';
  const discountPct = priceObj?.discountPct ?? product.discountPct ?? null;

  const stable = stripUndefined({
    productId: String(product.productId),
    title: product.title || null,
    description: product.description || null,
    image: product.image || product.imageUrl || product.images?.[0] || null,
    images: product.images || [],
    pdpUrl: product.pdpUrl || product.productUrl || null,
    seller: product.seller || product.shop || null,
    category: product.category || product.category_breadcrumb || null,
    lastSeenAt: nowIso(),
    lastViralScore: product.viralScore ?? null,
    lastSoldCount: product.soldCount ?? null,
    lastPrice: salePrice,
    lastOriginalPrice: originalPrice,
    lastRating: product.rating ?? null,
    lastReviewCount: product.reviewCount ?? product.ratingCount ?? null,
    lastSaleFormatted: priceObj?.saleFormatted ?? null,
    lastCurrency: currency,
  });

  const snapshot = stripUndefined({
    price: salePrice,
    originalPrice,
    currency,
    discountPct,
    saleFormatted: priceObj?.saleFormatted ?? null,
    soldCount: product.soldCount ?? null,
    stock: product.stock ?? null,
    rating: product.rating ?? null,
    reviewCount: product.reviewCount ?? product.ratingCount ?? null,
    viralScore: product.viralScore ?? null,
    commissionPct: product.commissionPct ?? null,
    source: product._source || product.source || null,
    capturedAt: nowIso(),
    expireAt: ttlDate(),
  });

  return { stable, snapshot };
}

export async function upsertProductWithSnapshot(product, { runId } = {}) {
  const firestore = await initFirebase();
  const { stable, snapshot } = splitProductPayload(product);
  const productId = stable.productId;

  const productRef = firestore.collection('products').doc(productId);
  const snapRef = productRef.collection('snapshots').doc(snapshotDocId(snapshot.capturedAt));
  const dailyRef = productRef.collection('daily').doc(todayIso());

  const batch = firestore.batch();

  batch.set(
    productRef,
    { ...stable, firstSeenAt: FieldValue.serverTimestamp(), lastSeenAt: stable.lastSeenAt },
    { merge: true }
  );

  batch.set(snapRef, { ...snapshot, productId, runId: runId || null });

  batch.set(
    dailyRef,
    {
      date: todayIso(),
      snapshotCount: FieldValue.increment(1),
      soldCountMax: snapshot.soldCount ?? null,
      priceLast: snapshot.price ?? null,
      viralScoreMax: snapshot.viralScore ?? null,
      updatedAt: nowIso(),
    },
    { merge: true }
  );

  await batch.commit();
  return { productId, snapshotId: snapRef.id };
}

/** Grava/atualiza um vídeo + snapshot. */
export async function upsertVideoWithSnapshot(video, { runId } = {}) {
  const firestore = await initFirebase();
  const videoId = String(video.videoId);
  const videoRef = firestore.collection('videos').doc(videoId);
  const snapRef = videoRef.collection('snapshots').doc(snapshotDocId());

  // Precisa saber ANTES do batch se é vídeo novo, pra só incrementar o
  // contador do produto uma vez (não a cada snapshot repetido do mesmo vídeo).
  const isNewVideo = !(await videoRef.get()).exists;

  const stable = stripUndefined({
    videoId,
    productId: video.productId || null,
    productTitle: video.productTitle || null,
    productKnown: Boolean(video.productKnown),
    productMatchType: video.productMatchType || null,
    productPrice: video.productPrice ?? null,
    productSoldCount: video.productSoldCount ?? null,
    author: video.author || null,
    description: video.description || null,
    videoUrl: video.videoUrl || null,
    coverUrl: video.coverUrl || null,
    hashtag: video.hashtag || null,
    lastSeenAt: nowIso(),
    lastPlayCount: video.stats?.playCount ?? null,
    lastLikeCount: video.stats?.diggCount ?? null,
    lastCommentCount: video.stats?.commentCount ?? null,
    lastShareCount: video.stats?.shareCount ?? null,
    lastViralScore: video.viralScore ?? null,
  });

  const snapshot = stripUndefined({
    playCount: video.stats?.playCount ?? null,
    likeCount: video.stats?.diggCount ?? null,
    shareCount: video.stats?.shareCount ?? null,
    commentCount: video.stats?.commentCount ?? null,
    viralScore: video.viralScore ?? null,
    capturedAt: nowIso(),
    expireAt: ttlDate(),
    runId: runId || null,
  });

  // Só marca hasVideo/incrementa videoCount se o produto JÁ existe no nosso
  // catálogo (coletado via sync de produtos) — nunca cria um doc de produto
  // "coto" (só com hasVideo, sem título/preço/etc) pra produtos que a gente
  // só conhece através do vídeo.
  let productExists = false;
  let productRef = null;
  if (isNewVideo && video.productId) {
    productRef = firestore.collection('products').doc(String(video.productId));
    productExists = (await productRef.get()).exists;
  }

  const batch = firestore.batch();
  batch.set(videoRef, { ...stable, firstSeenAt: FieldValue.serverTimestamp() }, { merge: true });
  batch.set(snapRef, snapshot);

  if (productExists) {
    batch.set(productRef, { hasVideo: true, videoCount: FieldValue.increment(1) }, { merge: true });
  }

  await batch.commit();

  return { videoId, snapshotId: snapRef.id };
}

/** Grava documento de metadata da run. */
export async function saveRun(runData) {
  const firestore = await initFirebase();
  const runId = runData.runId || `run-${Date.now()}`;
  await firestore
    .collection('runs')
    .doc(runId)
    .set({ ...runData, runId, updatedAt: nowIso() }, { merge: true });
  return runId;
}
