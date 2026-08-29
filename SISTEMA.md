# Sistema TikTok Shop — arquitetura

## Componentes (100% online — nada depende do PC ligado)

| Peça | Onde roda | O que faz |
|---|---|---|
| **`scheduledSync`** (Cloud Function) | Firebase Cloud Functions, a cada 6h | Puxa produtos BR via ScrapeCreators `shop/search` (1 crédito/query) e salva no Firestore — preço, mais vendidos, melhores avaliados |
| **`onScrapeRequest`** (Cloud Function) | Firebase Cloud Functions, gatilho Firestore | Dispara a mesma coleta na hora quando o dashboard pede "Coletar agora" |
| **`scheduledVideoSync`** (Cloud Function) | Firebase Cloud Functions, 1x/dia | Puxa vídeos por hashtag via ScrapeCreators `search/hashtag` (1 crédito/hashtag), extrai o produto vinculado (anchors/commerce_info do próprio TikTok) e salva em `videos/` já com score de viral |
| **Firestore** | Firebase Cloud | Guarda `products/`, `snapshots/`, `daily/`, `videos/`, `runs/` |
| **Dashboard** | Firebase Hosting | React lendo Firestore, protegido por Auth (só seu email) |
| **GitHub Actions** | GitHub | `firebase deploy --only hosting` (dashboard) e `--only functions` (Cloud Functions) a cada push na `main` |

Ferramentas **só para uso local/debug**, não fazem parte do caminho de produção: `npm run sync:v2:full --enrich N` (precisa de Chrome debug 9222) e `npm run watcher` (fallback caso as Cloud Functions estejam indisponíveis). Ver `scripts/mapeamento-realidade.md`.

## Fluxo diário

```
Cloud Scheduler → scheduledSync (a cada 6h)      ──┐
Dashboard "Coletar agora" → onScrapeRequest        ├─→ ScrapeCreators shop/search → Firestore (products/)
                                                     │
Cloud Scheduler → scheduledVideoSync (1x/dia) ──────┴─→ ScrapeCreators search/hashtag → Firestore (videos/)

Você → https://tiktokshop-cb657.web.app  ←  ver os dados no navegador, sem precisar rodar nada
```

**Por que vídeo também usa ScrapeCreators e não sessão anônima própria**: testamos de verdade (headless + sessão anônima, sem login) e o TikTok simplesmente não serve mais lista de vídeos de hashtag pra quem não está logado — nem a API assinada, nem o HTML da página trazem os dados, mesmo com a região BR detectada corretamente. Não é bloqueio de IP, é a própria plataforma escondendo esse conteúdo de sessões anônimas. O ScrapeCreators (que já usamos pra produtos) resolve isso do lado deles e devolve os vídeos com o `productId` real vindo direto dos campos de comércio do TikTok (`anchors`/`commerce_info`) — ver `functions/src/video-core.js`.

## Setup one-shot (fazer 1x)

### 1. Firebase Console

- **Firestore** → criar (modo produção)
- **Firestore → Rules** → colar o conteúdo de `firestore.rules` (já pronto no repo, sobe via `firebase deploy --only firestore:rules`)
- **Firestore → TTL** → collection group `snapshots`, campo `expireAt` (limpa dados velhos automaticamente)
- **Authentication** → Sign-in method → Email/Password → habilitar
- **Authentication → Users** → adicionar `gorilaalbino1996@gmail.com` com senha (única conta que loga no dashboard)
- **Project settings → General → Your apps** → criar Web app (⚙️ → apelido "dashboard") → copiar as chaves para `dashboard/.env`

### 2. `dashboard/.env` (arquivo local, NÃO commitar)

Copiar de `dashboard/.env.example` e colar os valores reais:

```
VITE_FIREBASE_API_KEY=AIzaSy...
VITE_FIREBASE_AUTH_DOMAIN=tiktokshop-cb657.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=tiktokshop-cb657
VITE_FIREBASE_APP_ID=1:...
VITE_OWNER_EMAIL=gorilaalbino1996@gmail.com
```

### 3. Instalar dependências

```
npm install
```

```
cd dashboard && npm install
```

### 4. Firebase CLI local (opcional, mas útil pra deploy manual)

```
npm i -g firebase-tools
firebase login
firebase deploy --only firestore:rules,firestore:indexes
```

### 5. GitHub Actions (deploy do dashboard automático)

Precisa de 6 secrets no repo (`Settings → Secrets and variables → Actions`):

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_OWNER_EMAIL`
- `FIREBASE_SERVICE_ACCOUNT` — JSON inteiro de uma service account com role "Firebase Hosting Admin"

Como gerar `FIREBASE_SERVICE_ACCOUNT`:
```
firebase init hosting:github
```
(o CLI cria a service account e o secret automaticamente)

### 6. Deploy das Cloud Functions (1x, depois é automático)

Pré-requisito: projeto no plano **Blaze** (pay-as-you-go) — Cloud Functions/Cloud Scheduler exigem isso.

```
firebase functions:secrets:set SCRAPECREATORS_API_KEY
firebase deploy --only functions
```

As três functions (`scheduledSync`, `onScrapeRequest`, `scheduledVideoSync`) são leves — sem browser, sem Docker, sem Cloud Run. Depois do primeiro deploy manual, os pushes na `main` que tocarem `functions/**` já disparam `.github/workflows/deploy-functions.yml` sozinhos.

## Uso no dia-a-dia

**Não precisa fazer nada** — `scheduledSync` roda sozinha a cada 6h e `scheduledVideoSync` 1x/dia. O botão "Coletar agora" no dashboard também já dispara a Cloud Function na hora.

**Só pra debug local (opcional, precisa de Chrome aberto):**
```
scripts\abrir-chrome-debug.cmd tiktokshop
```
```
npm run sync:v2:full
```

**Ver no dashboard:** `https://tiktokshop-cb657.web.app`

**Rodar dashboard local:**
```
cd dashboard && npm run dev
```

**Push mudanças de código:**
```
git add . && git commit -m "..." && git push
```
→ GitHub Actions faz o deploy do dashboard automático.

## Custo mensal estimado

- **ScrapeCreators**: ~8 créditos/dia de produtos (`scheduledSync` a cada 6h × 2 queries) + ~2 créditos/dia de vídeo (`scheduledVideoSync` × 2 hashtags) ≈ 300/mês. 100 créditos free, US$47 quando quiser mais 25k.
- **Firebase Cloud Functions** (as 3 functions, todas leves, sem browser): centenas de execuções curtas/mês, dentro do free tier do Blaze na prática.
- **Firebase Firestore/Hosting**: ~US$1,50 (bem dentro do free tier)
- **GitHub Actions**: gratuito (repo público) ou 2000 min/mês (privado)

**Total real esperado: poucos dólares/mês, a maior parte dentro do free tier do Blaze.** O plano Blaze cobra só o que passar do free tier — vale acompanhar o billing do projeto nas primeiras semanas.
