/**
 * Firestore writer com schema em camadas:
 *
 *   products/{productId}                        ← campos estáveis (title, images, seller)
 *   products/{productId}/snapshots/{tsIso}      ← série temporal (price, sold, viralScore)
 *   products/{productId}/daily/{YYYY-MM-DD}     ← agregado diário (nunca expira)
 *   videos/{videoId}                            ← metadados estáveis
 *   videos/{videoId}/snapshots/{tsIso}          ← série temporal
 *   runs/{runId}                                ← metadata da execução
 *
 * Regras:
 *   - Grava sempre via admin SDK (bypassa rules)
 *   - Snapshots levam `expireAt` (TTL 90d configurado no console)
 *   - Daily agregado é atualizado com FieldValue.increment no mesmo batch
 *
 * Compatibilidade retro: `saveProductsToFirebase` (usado por sync-most-viral)
 * continua funcionando — internamente escreve nas 3 coleções novas.
 */
import { readFileSync, existsSync } from 'fs';
import { config } from '../config.js';

let db = null;
let FieldValue = null;
const TTL_DAYS_SNAPSHOTS = 90;

export function isFirebaseConfigured() {
  return Boolean(config.firebase.serviceAccountPath && existsSync(config.firebase.serviceAccountPath));
}

export async function initFirebase() {
  if (db) return db;

  const accountPath = config.firebase.serviceAccountPath;
  if (!accountPath || !existsSync(accountPath)) {
    throw new Error(`Service account não encontrado: ${accountPath}`);
  }

  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const firestoreModule = await import('firebase-admin/firestore');
  FieldValue = firestoreModule.FieldValue;

  if (getApps().length === 0) {
    const serviceAccount = JSON.parse(readFileSync(accountPath, 'utf-8'));
    initializeApp({ credential: cert(serviceAccount) });
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
  return iso.replace(/[:.]/g, '-'); // ISO válido como docId
}

function ttlDate(days = TTL_DAYS_SNAPSHOTS) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

function stripUndefined(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Separa dados estáveis (do produto) dos voláteis (do snapshot).
 * Aceita tanto o formato antigo (achatado) quanto o novo (do scrapecreators.normalizeSearchProduct).
 */
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
    // Campos denormalizados pro dashboard ler sem subcollection
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

/**
 * Grava UM produto:
 *   - upsert no products/{id} (merge, mantém firstSeenAt)
 *   - novo doc em snapshots/{ts}
 *   - increment no daily/{YYYY-MM-DD}
 */
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

/** Compat: escreve N produtos + registra run doc. */
export async function saveProductsToFirebase(products, meta = {}) {
  await initFirebase();
  const runId = meta.runId || `run-${Date.now()}`;
  const results = [];

  for (const product of products) {
    if (!product?.productId) continue;
    try {
      const r = await upsertProductWithSnapshot(product, { runId });
      results.push(r);
    } catch (err) {
      results.push({ productId: product.productId, error: err.message });
    }
  }

  await saveRun({
    runId,
    source: meta.source || 'unknown',
    productsFound: results.length,
    errors: results.filter((r) => r.error).map((r) => ({ productId: r.productId, error: r.error })),
    finishedAt: nowIso(),
    ...meta,
  });

  return {
    runId,
    collection: 'products',
    savedIds: results.filter((r) => !r.error).map((r) => r.productId),
    errors: results.filter((r) => r.error),
  };
}

/** Grava/atualiza um vídeo + snapshot. */
export async function upsertVideoWithSnapshot(video, { runId } = {}) {
  const firestore = await initFirebase();
  const videoId = String(video.videoId);
  const videoRef = firestore.collection('videos').doc(videoId);
  const snapRef = videoRef.collection('snapshots').doc(snapshotDocId());

  const stable = stripUndefined({
    videoId,
    productId: video.productId || null,
    author: video.author || null,
    description: video.description || null,
    videoUrl: video.videoUrl || null,
    coverUrl: video.coverUrl || null,
    lastSeenAt: nowIso(),
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

  const batch = firestore.batch();
  batch.set(
    videoRef,
    { ...stable, firstSeenAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
  batch.set(snapRef, snapshot);
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
