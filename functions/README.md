# functions/

Cloud Functions leves (sem browser, sem Docker) que rodam a coleta de produtos
e vídeos 100% na nuvem:

- `scheduledSync` — a cada 6h, produtos via ScrapeCreators `shop/search`
- `onScrapeRequest` — dispara na hora quando o dashboard pede "Coletar agora"
- `scheduledVideoSync` — 1x/dia, vídeos virais com produto via ScrapeCreators `search/hashtag`

## Deploy

```
firebase functions:secrets:set SCRAPECREATORS_API_KEY   # 1x, se ainda não fez
firebase deploy --only functions
```

Automático via `.github/workflows/deploy-functions.yml` em todo push na `main`
que tocar `functions/**`.

## IAM necessário (só precisa fazer 1x por projeto)

O deploy de uma function 2ª geração com trigger do Firestore (`onScrapeRequest`)
precisa que a conta que faz o deploy tenha permissão de "agir como" a service
account padrão que vai rodar a function (o Cloud Functions cria um trigger do
Eventarc, que exige isso). Sem essa permissão o deploy falha com:

```
Error: Missing permissions required for functions deploy. You must have
permission iam.serviceAccounts.ActAs on service account
<project>@appspot.gserviceaccount.com.
```

Corrigir (rodar 1x, com uma conta com permissão de IAM Admin no projeto):

```
gcloud projects add-iam-policy-binding <PROJECT_ID> \
  --member="serviceAccount:<conta-que-faz-o-deploy>@<PROJECT_ID>.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"
```

Isso vale tanto pra quem roda `firebase deploy` manual quanto pra service
account usada no secret `FIREBASE_SERVICE_ACCOUNT` do GitHub Actions.
