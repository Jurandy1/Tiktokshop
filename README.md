# PuxarDadosDotiktok

Extrator interno de dados do TikTok Shop — **sessão anônima automática, sem login**.

## Setup

```bash
npm install
npx playwright install chromium
cp .env.example .env
```

## Testar coleta de produto (sem login)

```bash
npm run test:shop

# Com ID específico
node src/test-shop.js --ids SEU_PRODUCT_ID

# Se captcha persistir
node src/test-shop.js --ids SEU_ID --visible
```

A sessão anônima (`msToken`, `ttwid`) é criada automaticamente na primeira execução e cacheada em `cookies/anonymous-state.json` (~45 min).

## Testar hashtags (Fase 1)

```bash
node src/index.js content --hashtags achadinhos,produtosvirais
```

Playwright stealth é usado por padrão — sem precisar de `save-cookies`.

## Como funciona (sem login)

```
1. Bootstrap anônimo → tiktok.com/shop (gera msToken/ttwid)
2. Warm-up + Playwright stealth (anti-detecção)
3. Captura API assinada ou hydration HTML
4. Se captcha → refresh sessão 1x → retry
5. Se persistir → PROXY_URL no .env
```

## Comandos

| Comando | O que faz |
|---|---|
| `npm run test:shop` | Teste produto via sessão anônima |
| `npm run collect:products -- --ids ID` | Coleta produto(s) |
| `npm run collect:content -- --hashtags tag` | Coleta vídeos + productIds |
| `npm run pipeline` | Fase 1 + 2 → JSON local |

## Firebase (opcional)

```bash
node src/test-shop.js --ids SEU_ID --firebase
```

## Fallback manual (opcional)

`save-cookies.js` ainda existe se quiser sessão logada manualmente — não é mais necessário no fluxo normal.

## Proxy (plano B)

Se captcha persistir na sua rede:

```env
PROXY_URL=http://user:pass@host:port
```

## Estrutura

```
src/
├── session/
│   ├── anonymous-session.js   ← bootstrap automático
│   └── url-signer.js          ← API assinada
├── browser/
│   └── stealth-context.js     ← anti-detecção
├── collectors/
│   ├── product-collector.js
│   └── content-collector.js
└── test-shop.js               ← comece aqui
cookies/anonymous-state.json    ← cache sessão anônima
```
