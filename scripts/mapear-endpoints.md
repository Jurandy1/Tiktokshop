# Mapear endpoints internos do TikTok Shop BR

Objetivo: descobrir os endpoints exatos que o site `shop.tiktok.com/br` chama do seu navegador — pra replicar no scraper caseiro e reduzir dependência do ScrapeCreators.

Faça isso **com o Chrome debug que você já usa** (msToken/ttwid já quentes).

## 1. Abrir Chrome com debug

```
scripts\abrir-chrome-debug.cmd tiktokshop
```

Loga (se pedir), navega até `https://shop.tiktok.com/br`.

## 2. Abrir DevTools no Network

- F12 → aba **Network** → filtro **Fetch/XHR**
- Clica no ícone 🚫 (limpar) pra zerar
- Marca ☑ **Preserve log** (senão limpa a cada nav)

## 3. Coletar 3 fluxos-chave

### a) Feed de descoberta / best-sellers
Rola a home do Shop BR uns 5s. Filtra Network por `/api/`. Procure calls com:
- `mall`, `discovery`, `feed`, `recommend`, `product_list`, `best_seller`
- Copia como **cURL (bash)** clicando com botão direito no request

### b) PDP de um produto
Abre qualquer produto (ex.: um dos 8 que o ScrapeCreators retornou):
```
https://www.tiktok.com/shop/pdp/1731172563256837522
```
Procure em Network calls tipo:
- `/api/shop/pdp_desktop/product_info/`
- `/api/product/detail/`
- `/api/shop/product/`
- `/api/comment/list/`
- `/api/shop/product/vouchers/`

Salve o cURL de cada uma.

### c) Vídeos que promovem o produto (afiliados)
Ainda na PDP, rola até "Related videos" / "Videos". Deve disparar calls tipo:
- `/api/shop/product/video/`
- `/api/aweme/*` filtrado por `product_id`

## 4. O que anotar para cada endpoint

Cole neste checklist por endpoint:

```
NOME: (ex.: PDP product_info)
URL: https://www.tiktok.com/api/shop/pdp_desktop/product_info/?...
MÉTODO: GET
QUERY-PARAMS relevantes: product_id, region, aid, msToken, X-Bogus, X-Gnarly
HEADERS-CHAVE:
  - Cookie: msToken, ttwid, sessionid_ss (marca quais são obrigatórios)
  - User-Agent
  - Referer
RESPONSE ok? (200 sem captcha)
```

## 5. Comparar com ScrapeCreators

Rode o probe:

```
node src/collectors/scrapecreators-probe.js --product 1731172563256837522
```

Ele salva dois JSONs em `output/probe/`. Compare campo a campo:

| Campo | ScrapeCreators traz? | Nosso CDP traz? | De onde vem no site |
|---|---|---|---|
| price.sale | ✅ | ? | product_info |
| sold_count | ✅ | ? | product_info |
| commission_rate | ? | ❌ | (buscar) |
| related_videos | ✅ | ❌ | product/video |
| shop_rating | ✅ | ? | shop_info |

## 6. Replicar no caseiro

Pra cada endpoint que o site chama sem captcha:
1. Copia a URL + query params + headers do cURL
2. Substitui `msToken`/`X-Bogus` por lib de assinatura ([carcabot/tiktok-signature](https://github.com/carcabot/tiktok-signature) — Node) ou reaproveita o cookie que o Playwright já coleta em `cookies/anonymous-state.json`
3. Cria um novo método em `src/collectors/tiktok-api.js` (já existe stub) que bata direto no endpoint sem abrir browser — muito mais rápido e barato

## 7. O que já sabemos (partida)

- **Assinatura mínima**: `msToken` (cookie) + `X-Bogus` (calculado da URL) — implementação em [carcabot/tiktok-signature](https://github.com/carcabot/tiktok-signature)
- **Endpoint conhecido de PDP web**: `https://www.tiktok.com/api/shop/pdp_desktop/product_info/?product_id={id}&region=BR&aid=1988`
- **Ref adicional**: [gist adrianhorning08](https://gist.github.com/adrianhorning08/5c4aae4d54c33d5e28a29aed0cdb0e86) mapeia endpoints Shop BR
- **Referência viva de parsing**: [yt-dlp/tiktok.py](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/tiktok.py)

## 8. Fluxo curto para amanhã

1. Faz o passo 3 (5-10 min no DevTools) e cola aqui as URLs
2. Rodamos o probe pra 3 productIds
3. Escrevemos `src/collectors/tiktok-shop-direct.js` que chama esses endpoints diretos
4. Deixamos o Playwright/CDP como fallback quando o direto capchar
