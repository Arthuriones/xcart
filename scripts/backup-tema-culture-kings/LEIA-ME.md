# Tema da vitrine Culture Kings — como estava antes

Os tres JSON aqui sao a versao ORIGINAL dos templates do tema `block` da loja
`vvq0qq-ih.myshopify.com`, capturados antes de qualquer escrita.

Guardo porque a Shopify nao versiona asset de tema: uma vez sobrescrito, o
conteudo anterior nao existe mais em lugar nenhum. Se algo do desenho novo
ficar pior que o antigo, e daqui que sai a volta.

O que tinha de errado neles, e por isso foram reescritos:

- `index.json` — dois slideshows apontando para arquivos que nunca foram
  copiados para esta loja (`imgi_214_slider_desk_4.jpg` e companhia): era o
  banner em branco. Mais colecoes inexistentes (`new-balance`, `vans`,
  `adidas-originals`, `mujer`, `hombre`, `ninos`), reels apontando para
  handles de produto da loja chilena, e dois blocos de liquid puxando CSS de
  `//www.blockstore.cl/cdn/`.
- `collection.json` — "COMPRA POR CATEGORÍA" listando mujer/hombre/ninos, e
  um rich-text "ZAPATILLAS URBANAS EN CHILE".
- `product.json` — abas "Lo último en Block" e a mesma lista de categorias.

Para restaurar um deles:

    PUT /admin/api/2024-10/themes/<id>/assets.json
    { "asset": { "key": "templates/index.json", "value": "<conteudo>" } }
