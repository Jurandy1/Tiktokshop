# Sistema TikTok Shop — arquitetura

## Componentes

| Peça | Onde roda | O que faz |
|---|---|---|
| **Scraper base** (`sync-viral-v2`) | Seu PC (Windows) | Puxa produtos BR via ScrapeCreators (1 crédito/query) e salva no Firestore |
| **Enrichment** (`browser-proxy`) | Seu PC + Chrome debug 9222 | Puxa reviews + more_from via CDP (0 créditos) |
| **Firestore** | Firebase Cloud | Guarda `products/`, `snapshots/`, `daily/`, `runs/` |
| **Dashboard** | Firebase Hosting | React lendo Firestore, protegido por Auth (só seu email) |
| **GitHub Actions** | GitHub | Faz `firebase deploy --only hosting` a cada push na `main` |

## Fluxo diário

```
Você → npm run sync:v2:full  ←  no PC, quando quiser coletar
        │
        ├─ ScrapeCreators (1 crédito/query BR)
        ├─ Chrome debug 9222 (enriquece top N)
        └─ firestore write (products/snapshots/daily)

Você → https://projetoafiliado-9ff07.web.app  ←  ver os dados no navegador
```

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
VITE_FIREBASE_AUTH_DOMAIN=projetoafiliado-9ff07.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=projetoafiliado-9ff07
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

## Uso no dia-a-dia

**Coletar produtos + enriquecer top 5 + salvar:**
```
scripts\abrir-chrome-debug.cmd tiktokshop
```
```
npm run sync:v2:full
```

**Só descoberta rápida (sem enrichment):**
```
npm run sync:v2:save
```

**Ver no dashboard:** `https://projetoafiliado-9ff07.web.app`

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

- **ScrapeCreators**: 100 créditos free (agora 95). US$47 quando quiser mais 25k.
- **Firebase**: ~US$1,50 (bem dentro do free tier)
- **GitHub Actions**: gratuito (repo público) ou 2000 min/mês (privado)
- **Firebase Hosting**: gratuito no free tier (10GB/mês)

**Total real: US$0 enquanto usar os créditos gratuitos.**
