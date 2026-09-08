@AGENTS.md

# xcart

> **Full technical reference: [`ARCHITECTURE.md`](./ARCHITECTURE.md)** — read it for the complete picture. This file is the quick orientation.

## The core idea (most important thing to understand)

xcart is a dropshipping tool built around a **two-store "routed checkout"** model:

- **Vitrine (showcase / source store)** — gets the ad traffic. Carries **branded/replica** products (real brand names, replica models, logos). Customer browses and adds to cart here.
- **Loja checkout (dark store / target store)** — where payment actually happens. Same catalog but **neutralized**: brand/replica names removed from title/description/tags (generic wording) and product photos **replaced by AI-generated de-branded images**.

At checkout, the cart is **routed vitrine → checkout store, matched by SKU**, and the customer is redirected (Shopify cart permalink) to the checkout store's checkout in the right currency. The two stores never appear linked (`no-referrer`).

A vitrine can point at **several checkout stores at once** and the traffic is split between them (rotation — see ARCHITECTURE.md §10.2), so one payment account going down doesn't take the vitrine with it. Each checkout store carries its own `sku_map` (`routed_checkout_targets`), because variant ids differ per store. The draw only ever happens between targets that cover the cart equally well — **rotation never costs a cart line**.

**Everything hinges on SKU.** Neutralization rewrites titles/images, so SKU is the only stable join key between the two stores. No SKUs on the vitrine → routing can't work. When editing the checkout store, you may freely change title/description/tags/images but **never change or delete variants/SKUs** — that breaks the route.

Also does: multi-source import/clone (AliExpress, Shopify, WooCommerce, Shoplazza, generic sites), AI optimize/translate/neutralize, AI store setup (policies/menus/pages/reviews/Instagram), Stripe billing + credits.

## Stack (current)
- **Next.js 16** (App Router, standalone) + TypeScript + Tailwind v4 + shadcn/ui. React 19. Interface so em portugues (`src/lib/textos.ts` + `messages/pt.json`).
- **Supabase** — Auth (password + magic link), Postgres (RLS), Storage. Service-role admin client bypasses RLS.
- **Gemini** — `gemini-2.5-flash` (text), `gemini-2.5-flash-image` (images). Needs `GEMINI_API_KEY`.
- **Shopify** — Admin GraphQL `2024-10`, **Client Credentials Grant** (creds per-store in Supabase `stores`). `write_themes` NOT available this way.
- **Stripe** — subscriptions + credit packs. **Background jobs = Supabase-table queue + Vercel cron** (NOT Inngest/BullMQ).
- **Scraping** — cheerio + Playwright/`@sparticuz/chromium` + Bright Data proxy. `sharp` for images.
- Deploy: **Vercel** (primary, hourly cron) + Docker.

## Trabalho de loja x trabalho de projeto

O repo carrega duas coisas: o **app** (`src/`) e os **scripts de operacao**
(`scripts/`) -- reprecificar catalogo, importar produto, consertar rota. Sao
rodados a mao com `npx tsx`, nunca importados pela aplicacao.

Eles ficam FORA do type-check do build e fora do deploy:

- `npm run typecheck` -- o app. E o que o build da Vercel roda.
- `npm run typecheck:scripts` -- os scripts. **Rode antes de commitar script.**
- `npm test` -- vitest. Cobre a paridade do sorteio do rodizio (loader x
  servidor) e a repartição de 100% da tela de Vendas.
- `vercel.json` tem `ignoreCommand`: commit que so toca `scripts/` nao gera
  deploy.

O motivo e concreto: um campo inventado em `scripts/consertar-rota.ts` derrubou
tres deploys seguidos do app, num arquivo que a aplicacao nem le.

## Multi-host
`adm.*` = admin, `user.*` = app/dashboard, other host = marketing landing only. Logic in `src/proxy.ts` → `src/lib/supabase/middleware.ts`.

## Where things live
- Routing: `src/app/api/checkout-routes/*`, `public/routed-checkout-loader.js`, `src/lib/shopify/cart-routing.ts`, `src/lib/checkout-routes/*` (rotation, targets, embed config, heal), `src/components/routed-checkout/*`
- Shopify + AI: `src/lib/shopify/client.ts`, `src/lib/gemini/client.ts`, `src/lib/ai/product-neutralizer.ts`, `src/lib/store-context.ts`
- Import/jobs: `src/lib/import/*`, `src/lib/aliexpress/*`, `src/lib/jobs/*`, `src/app/api/jobs/*`
- Data: `supabase/migrations/001-031_*.sql` (see ARCHITECTURE.md §5 for every table)

## StoreContext drives all AI
Every AI call receives `StoreContext` (name, niche, target_audience, brand_voice, store_description, **target_language**) from `getStoreContext(storeId, userId)`. API routes fetch it server-side by `storeId`; if `niche` is empty the AI route 400s. `target_language` forces the output language.

## Key gotchas (see ARCHITECTURE.md §13)
- Routing needs SKUs on both stores; generic-site imports often have none.
- `create-destination` neutralizes before dedup and runs one-shot → times out on big catalogs. Use the wizard **"Só conectar"** mode when the catalog already exists.
- Bulk-import queue has no atomic claim / stale recovery (image queue does).
- `write_themes` needs Shopify CLI + Theme Access password, not this app.
- Some prompts/strings still hardcode BR (CDC/LGPD, "R$89") — verify against `target_language`.
- Changing rotation weights only reaches buyers after the theme config is pushed again (`update-theme`); until then the inline path routes on the old split.
- The rotation draw is mirrored in the loader and on the server — the two hashes must stay identical or a buyer switches checkout store mid-purchase. **Travado por `tests/rotation-parity.test.ts`**, que le o loader do disco e compara com o servidor. A fila ordena por `id || domain` nos dois lados: `embed-config` manda `id: null` de proposito em rota legada, e ordenar so por id divergia.
- **Policy de UPDATE/INSERT precisa de `WITH CHECK`, nao so `USING`.** `USING` prende a linha ANTIGA; sem `WITH CHECK` a linha NOVA nao e validada e o usuario reatribui o dono -- ou, em `profiles`, se promove a `is_admin`. Ver migration 030.
- **URL vinda do usuario NUNCA vai direto para `fetch`.** Use `safeFetch`/`assertUrlPublica` de `src/lib/net/safe-url.ts`: resolve o DNS e recusa rede privada, link-local e loopback, revalidando cada redirect. `normalizeShopDomain` so valida FORMATO -- `metadata.google.internal` e `169.254.169.254.nip.io` passavam por ela.
- Funcao nova em `public` vira endpoint em `/rest/v1/rpc/`. Se for SECURITY DEFINER, **revogue de `public, anon, authenticated`** e conceda so a `service_role` — sao DOIS caminhos de privilegio (o grant a PUBLIC e o explicito que o default-privileges do Supabase cria), e tirar um deixa o outro. Confira com `has_function_privilege`: o comando responde sucesso sem ter revogado nada. Ver migration 027.
