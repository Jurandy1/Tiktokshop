repo: Jurandy1/Tiktokshop
branch: main
path: dashboard/

## Last sync
date: 2026-08-29T12:56:00Z

### Updated in this project
- Redesign premium (light, editorial) das 7 telas do dashboard em um único Design Component
- Layout sem cards: grades alinhadas, hairlines, tipografia serif/sans/mono
- Filtros, tabs, busca e navegação funcionando com os mesmos dados e rótulos do código atual

## Screen map
| Tela no projeto | Arquivos do repo |
|---|---|
| Visão geral | dashboard/src/pages/Overview.jsx, components/ProductCard.jsx, components/VideoCard.jsx |
| Produtos | dashboard/src/pages/Home.jsx, lib/scrape-requests.js |
| Detalhe do produto | dashboard/src/pages/Product.jsx |
| Vídeos virais | dashboard/src/pages/Videos.jsx |
| Lojas | dashboard/src/pages/Lojas.jsx |
| Sistema | dashboard/src/pages/Sistema.jsx |
| Login | dashboard/src/components/LoginGate.jsx |
| Shell / navegação | dashboard/src/App.jsx, components/Sidebar.jsx, index.css |
