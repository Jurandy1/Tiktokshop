# Mapeamento definitivo — TikTok Shop BR (Ago/2026)

Descobertas empíricas via `scripts/auto-mapear-endpoints.js` + testes reais.

## TL;DR

- **Descobrir produtos por keyword BR** → `ScrapeCreators shopSearch` (funciona ótimo, 1 crédito)
- **Enriquecer produto (mais_from da loja, categorias, seller_id)** → `page_data` via browser-proxy CDP (0 crédito, precisa Chrome debug)
- **Reviews + rating agregado** → `get_product_reviews` via browser-proxy CDP (0 crédito)
- **Detalhes do produto principal** → BLOQUEADO em BR pela API interna do TikTok (`nova_config` retorna `"region not supported"`). Contornar: usar dados que já vieram do `shopSearch`.
- **Vídeos afiliados por produto** → ainda não capturado empiricamente; possivelmente também bloqueado em BR

## Endpoints internos descobertos

Todos em `https://shop.tiktok.com`.

### 1. `POST /api/shop/pdp_desktop/page_data`
Batch de componentes da PDP. Retorna:
- `data.components_map[]` — mais produtos da mesma loja + você_pode_gostar
- `data.global_data.product_info.product_info.product_model.seller_id` — id da loja
- `data.global_data.product_info.categories[]` — árvore completa
- `data.global_api_data.nova_config.base_resp` — `{StatusCode: 400, StatusMessage: "region not supported"}` em BR ⚠

Payload OBRIGATÓRIO inclui `global_data.product_info.product_info.product_model = {product_id, seller_id}` — vem do cliente, não do servidor. Sem `seller_id`, `more_from` retorna 0.

Assinatura: `X-Tts-Oec-Bsid` como query param (gerado pelo `webmssdk.js`, muda a cada request).

### 2. `POST /api/shop/pdp_desktop/get_product_reviews`
Reviews + rating agregado. **FUNCIONA em BR.**

Payload:
```json
{
  "product_id": "1731185867445732754",
  "sort_rule": 1,
  "page_start": 1,
  "page_size": 20,
  "review_filter": { "filter_type": 0, "filter_value": 0 },
  "component_name": "reviews"
}
```

Retorna:
```json
{
  "code": 0,
  "data": {
    "has_more": false,
    "total_reviews": "48",
    "product_reviews": [ /* { review_rating, review_text, review_country, reviewer_name, review_time, ... } */ ],
    "review_ratings": {
      "review_count": "48",
      "overall_score": 4.4,
      "rating_result": { "1": "3", "2": "0", "3": "4", "4": "8", "5": "33" }
    }
  }
}
```

### 3. Outros endpoints capturados (não úteis para dados)
- `POST /api/v1/bs/rt` — behavior report (telemetria)
- `POST https://api-verification.tiktokshop.com/api/v1/bs/setting` — anti-fraude
- `POST https://mssdk-sg.tiktok.com/web/report` — SDK security beacons
- `GET  https://mssdk-sg.tiktok.com/web/resource` — regenera token
- `POST https://sgali-mcs.byteoversea.com/webid` — gera web_id
- `POST https://libraweb-sg.tiktok.com/service/2/abtest_config/` — A/B tests
- `POST https://mcs-sg.tiktokv.com/v1/list` — event queue
- `GET  https://mon.tiktokv.com/monitor_web/settings/browser-settings` — config

## Por que não replicar o `X-Tts-Oec-Bsid` em Node?

O token é gerado pelo bundle `webmssdk.js` (versão `1.0.0.162` no momento da captura). Ele consome fingerprint do browser, timestamp, cookie webid e produz um payload binário assinado. Replicar isso é engenharia reversa contínua — cada versão nova quebra.

**Estratégia adotada:** deixar o browser (via CDP na porta 9222) gerar o token sozinho e interceptar as respostas. Ver `src/collectors/tiktok-shop-browser-proxy.js`.

## Como usar

**Pré-requisito**: Chrome debug rodando

```
scripts\abrir-chrome-debug.cmd tiktokshop
```

**Coletar dados de uma PDP** (0 créditos):

```js
import { collectPdp } from './src/collectors/tiktok-shop-browser-proxy.js';
const r = await collectPdp('1731185867445732754');
// r.pageData.moreFrom, r.pageData.sellerId, r.reviews.overallScore, ...
```

**Enriquecer múltiplas** (pipeline):

```js
import { enrichProductsFromCdp } from './src/collectors/tiktok-shop-browser-proxy.js';
await enrichProductsFromCdp(['id1', 'id2'], { delayMs: 2000 });
```

## O que ainda não conseguimos

| Dado | Status | Notas |
|---|---|---|
| Comissão de afiliado por produto | ❌ | Não veio em nenhum endpoint público. Só via TikTok Affiliate API (exige seller) ou ScrapeCreators (US-only) |
| Vídeos afiliados por produto | ⚠ | Não capturado. Provavelmente também bloqueado em BR |
| Best sellers globais BR (marketplace inteiro) | ❌ | Endpoint não existe — só busca por keyword |
| Rank de produtos por categoria BR | ❌ | Mesmo problema |
| Trending do Creative Center BR | 🟡 | Não testado ainda. Ver [lofe-w/tiktok-creative-center-scraper](https://github.com/lofe-w/tiktok-creative-center-scraper-public) |

## Ideias pra próximos passos

1. **`shopProducts` de UMA loja** (endpoint SC funciona pra US, testar BR): pega storeUrl e retorna TODOS os produtos daquela loja ordenados por sold. Loja "Achadinhos" tem seller_id `7496147458926807442`.
2. **Auto-descobrir lojas ativas BR**: já temos `seller_id` de cada produto do search. Cruzar N searches → lista de sellers → pra cada seller, chamar `shopProducts` pra pegar catálogo completo.
3. **Snapshot histórico de sold_count**: com Firestore schema novo (`products/{id}/snapshots/{ts}`), medir crescimento de vendas dia-a-dia — indicador real de viralidade.
