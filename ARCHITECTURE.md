# xcart — Complete Technical Reference

> Package name: `xcart`. Product/UI name: **Xcart**.
> This file is the canonical, self-contained explanation of how the app works. Any AI or developer pulling this repo should read this first. Last deep-audited: 2026-07.

---

## 1. What xcart is (the core idea — read this first)

xcart is a **dropshipping automation tool built around a two-store "routed checkout" model**:

- **Vitrine (showcase / source store)** — the store that receives ad traffic. It carries **branded / replica** products with real brand names, replica model names, brand imagery and logos (e.g. "Rolex GMT-Master", "Air Jordan"). This is what the customer browses and adds to cart. Optimized to convert.
- **Loja checkout (dark store / target store)** — a mirror catalog where the **actual sale and payment happen**. Its products are **neutralized**: brand/replica names stripped from titles, descriptions and tags → generic wording ("メンズ GMT腕時計", "Tênis esportivo casual"), and product photos **replaced by AI-generated de-branded images** (logos/watermarks removed). This reduces the checkout store's exposure to trademark takedowns and payment-processor review.

At checkout, the customer's cart is **routed from the vitrine to the checkout store, matched by SKU**, and they are redirected (via a Shopify cart permalink) to the checkout store's checkout in the correct currency. The stores never appear linked (the loader forces `no-referrer`).

**The whole system hinges on SKU.** Neutralization deliberately rewrites titles and images, so title/handle/image can never be the join key. SKUs are copied verbatim from vitrine → checkout store and are the anchor for the routing map. **If source products lack SKUs, routing cannot work.** (See §9 and §13.)

One neutralized checkout store can be **reused** across multiple vitrines, and **a vitrine can route to several checkout stores at once** (rotation, §10.2) — traffic is split between them so a single payment account going down does not take the vitrine with it.

Beyond routing, xcart also: imports/clones products from many sources, AI-optimizes/translates copy, AI-neutralizes text & images, generates store policies/pages/menus/reviews/Instagram content, and manages billing/credits.

---

## 2. Stack & deployment

- **Next.js 16.2.4** (App Router, `output: "standalone"`, `runtime = "nodejs"` on API routes), **React 19.2.4**, TypeScript, Tailwind v4 + shadcn/ui, `zustand`, `sonner`.
- **Supabase** — Auth (`@supabase/ssr`), Postgres (RLS on every table), Storage (public buckets). Project id `hvfwjlwydmcstarfjtko`.
- **Google Gemini** — two SDKs: `@google/generative-ai` (text, `gemini-2.5-flash`) and `@google/genai` (per-call config + images, `gemini-2.5-flash-image`). Requires `GEMINI_API_KEY`.
- **Pagou.ai** — subscriptions (card or Pix automatico) + one-time credit packs (Pix). Base `https://api.pagou.ai`, `Authorization: Bearer`.
- **Scraping** — `cheerio`, `playwright-core` + `@sparticuz/chromium` (headless Chromium on Vercel), `undici` proxy, Bright Data fallback. `sharp` for image transcoding.
- **Shopify** — Admin GraphQL API, version pinned `2024-10`.
- **Deploy**: Vercel (primary; `vercel.json` sets `maxDuration` per route + an hourly cron) and Docker (`Dockerfile` multi-stage `node:20-alpine`, `docker-compose.yml` for VPS). `AGENTS.md` warns Next.js 16 has breaking changes — read `node_modules/next/dist/docs/` before writing Next code.

`next.config.ts`: `serverExternalPackages: [playwright-core, @sparticuz/chromium, undici]`, remote image hosts (alicdn, aliexpress, cdn.shopify.com). Root layout forces **dark theme** and `lang="pt-BR"`.

---

## 3. Multi-host + i18n routing

All host/locale logic is in the edge middleware: `src/proxy.ts` → `src/lib/supabase/middleware.ts`.

**Hosts** (by `Host` header):
- `adm.*` → **admin** subdomain (no i18n; pinned to `/admin/**`; requires `profiles.is_admin`).
- `user.*` (or localhost/`*.vercel.app`) → **app** subdomain (the dashboard).
- anything else → **marketing** root: only `/`, `/lp`, `/privacy`, `/terms`, `/data-deletion`, `/user-data-deletion` render; every other path 307-redirects to the `user.` app origin.
- Static files with an extension (e.g. `/routed-checkout-loader.js`) bypass i18n + auth entirely.

**Locale** (`src/i18n/routing.ts`): `locales: ["pt","en","ja"]`, default **pt (unprefixed)**, `en`→`/en`, `ja`→`/ja`. `localeDetection` off; `localeOf`/`prefixOf` in the middleware derive locale from the path prefix (the geo-IP default described in comments is not actually implemented — pt is effective default). Messages in `messages/{pt,en,ja}.json`. Use `src/i18n/navigation.ts` (`Link`, `useRouter`, `redirect`) not `next/*`. Language switcher cycles pt→en→ja.

---

## 4. Auth & sessions

Supabase Auth, standard cookie sessions (no custom JWT). Clients: `src/lib/supabase/{client (browser), server (RSC), admin (service-role, bypasses RLS)}.ts`.

- **Login/signup/recovery**: `src/app/(auth)/login/page.tsx` → password or magic-link; `callback/route.ts` exchanges `?code`; recovery → `set-password`.
- Middleware refreshes the session every request and enforces: unauthenticated → `/login`; authenticated without `user_metadata.has_password === true` → forced to `/set-password` (mechanism for admin-provisioned accounts).
- Dashboard layout gate: `userHasAccess()` (billing). Admin layout gate: `profiles.is_admin`.
- `handle_new_user` trigger auto-creates a `profiles` row per `auth.users` insert.

---

## 5. Data model (Supabase, `supabase/migrations/001-018`)

All tables have RLS (owner-scoped via `auth.uid()`); service-role bypasses. Shared `update_updated_at()` trigger.

| Table | Purpose / key columns |
|---|---|
| **stores** | Connected Shopify stores. `user_id`, `shop_domain` (unique per user), `name`, `theme_id`, **`client_id`/`client_secret`** (custom-app creds), `access_token` (OAuth fallback, nullable). Profile: `niche`, `target_audience`, `brand_voice`, `store_description`, `logo_path`. Pricing: `currency_code`, `auto_convert_prices`, `currency_rate`, `price_markup_percent`. `target_language` (default `pt-BR`, drives AI output language). |
| **products** | Imported/optimized products (app-side mirror). `store_id`, `aliexpress_url`, `shopify_product_id`, title/original, price, `images[]`, `status` (pending/optimized/published/failed). |
| **store_assets** | Brand visual materials (`file_path`, `label`). |
| **app_secrets** | Global KV secrets, **service-role only** (e.g. proxy creds). |
| **background_jobs** | Async queue. `type` (`bulk_import`, `neutralize_image`, optimize, etc.), `status` (pending/processing/completed/failed), **`progress` jsonb doubles as the input payload + live step**, `result`, `error`. Index `(store_id,type,status,created_at)`. |
| **clone_runs** | Audit of clone ops (preview/export/apply). |
| **routed_checkout_configs** | **The route.** `source_store_id` (vitrine), `target_store_id` (**primary checkout store — legacy/summary; the real destinations live in `routed_checkout_targets`**), `rotation` (`{strategy:'sticky'\|'each_checkout'}`), `mode` (`standard`/`enterprise`/`enterprise_static` — wizard writes `enterprise_static`), `public_token` (unique; public loader identifier), `enabled`, **`sku_map`** `{sku→targetVariantId}`, **`variant_map`** `{sourceVariantId→targetVariantId}`, `settings` (`checkout_domain`/`checkout_country`/`checkout_locale` overrides). |
| **routed_checkout_targets** | **The routing map, one row per checkout store of a route.** `route_id`, `target_store_id`, `weight` (relative share in the rotation; 0 = configured but out of it), `enabled`, **`sku_map`** `{sku→targetVariantId}`, **`variant_map`**, `settings` (domain/market override), `position`, `last_healed_at`. Unique on `(route_id, target_store_id)`. Each checkout store has its own variant ids, so the maps **cannot** be shared between targets. |
| **routed_checkout_fallbacks** | Loader fallback telemetry (`route_config_id`, **`target_id`** — which checkout store lost the cart, `reason`, `detail`, `page_url`). |
| **ai_product_reviews** | AI-generated synthetic reviews (product ref, rating, body, disclosure, image_url, `published`). |
| **instagram_connections / instagram_posts** | IG business-account tokens + published carousels. |
| **profiles** | One per user. `is_admin`, `plan` (free/pro), `pagou_customer_id`/`pagou_subscription_id`, `payment_provider` (pagou\|stripe), `cancel_at_period_end`, `subscription_status`, `current_period_end`, **`ai_credits`**, `access_granted`, `free_clone_store_id` (trial; NULL = available). |
| **ai_usage_log** | Every AI action + `cost_usd` + `credits_used` (metering; service-role insert only). |
| **credit_purchases** | One-time credit-pack purchases. |

Storage buckets (public read; write scoped to `foldername[1] == auth.uid()`): `store-logos`, `product-images` (neutralized/branded/review images live here), `store-assets`.

### 5.1 External checkout (migration 069, `src/lib/checkouts-externos/`)

A checkout where the order happens outside Shopify (Sphere Affiliates first: COD affiliate network, the owner earns a **commission**). It is NOT a `stores` row — almost every `.from("stores")` assumes Shopify.

| Table | Purpose |
|---|---|
| **checkouts_externos** | `plataforma` ('sphere'), `nome`, `ativo` (paused = a NEW order is ignored; events of an existing order still apply, since Sphere sends each one once), `moeda_receita` (Sphere does not send the commission currency), `fuso` (the order's `dia_local`), `taxa_aprovacao_padrao`, last event/error. |
| **checkout_externo_contas** | Affiliate codes (`afiliado.codigo`) per checkout, PK `(user_id, plataforma, conta)`: the first event of a code links it; a checkout may have several codes, but a code belongs to ONE checkout of the user (another checkout gets 409 -- double count). "Trocar URL" releases the checkout's codes. |
| **checkout_externo_segredos** | The webhook token (in clear, to show the URL again) + `token_hash` (sha256, unique: the endpoint lookup). RLS on, **zero policy**, only `service_role`. |
| **pedidos_externos** | One row per order, LAST state: `situacao` pendente/aprovado/pago/expirado/revertido, `receita` = net commission, `valor` = order total (hint only), `dia_local`, `atualizado_em` (event time, never regresses), `versao` (optimistic lock). |
| **checkout_externo_eventos** | Idempotency lock `(checkout, pedido, evento)` + the screen log. |
| **ad_accounts.checkout_id** | An ad account links to ONE store OR ONE checkout (`check`), composite FK `on delete set null (checkout_id)`. |

Webhook: `POST /api/webhooks/checkout/<token>` (public; token = the only secret; 404 for unknown; 64 KB cap; the insert into `checkout_externo_eventos` is the lock; `aplicarEvento` keeps out-of-order events from regressing; the "Venda no celular" goes in `after()`). The test event (`afiliado.codigo = "xcart-teste"`) never creates an order. In the Dashboard the checkout is a "store" with `tipo: "checkout"` in `EntradaFinanceiro.lojas`, orders in `externos`, and it rides the cash-on-delivery cards (Recebido / A receber / Previsto by the approval rate). `filtroResolvido()` keeps `lojas`/`lojaIds` Shopify-only and adds `checkouts`/`checkoutIds`/`checkout`. External checkouts do NOT count towards plan limits.

---

## 6. Shopify integration (`src/lib/shopify/client.ts`)

- **Auth = Client Credentials Grant.** `getAccessToken` POSTs `grant_type=client_credentials` to `/admin/oauth/access_token`; token cached in-memory per `domain:clientId`, 24h TTL, renews 5 min before expiry. If a stored OAuth `access_token` exists, it's used directly.
- **Install flow**: a store must be OAuth-installed once (`src/app/api/shopify/auth/route.ts`, scopes: `write_products`, `write_content`, `write_legal_policies`, `write_online_store_navigation`, `read/write_publications`, `read_themes`, metaobjects, …). **`write_themes` is NOT requested and Client Credentials Grant cannot mint it — theme edits require a Shopify CLI + Theme Access password, not this app.**
- `shopifyGraphQL` — retries on 429 and GraphQL `THROTTLED` (up to 4×); handles 402 (store frozen).
- **Product create/update**: `createProduct` (productCreate + `productVariantsBulkCreate/Update` + `productCreateMedia` + inventory + `publishablePublish` to Online Store). `updateShopifyProduct` (productUpdate + bulk variant update + full media replace). `productSet` is used by external scripts but not the app. SKU lives on `inventoryItem.sku`.
- Store setup: `updateStorePolicies` (`shopPolicyUpdate`), `createMenu` (`menuCreate`), `createPages` (`pageCreate`, idempotent on handle clash). Taxonomy enrichment via `src/lib/products/shopify-taxonomy-enrichment.ts` + metafields.

---

## 7. StoreContext & AI generation

`StoreContext` (`{name, niche, targetAudience, brandVoice, storeDescription, targetLanguage}`) is fetched by `getStoreContext(storeId, userId)` (`src/lib/store-context.ts`) and conditions **every** AI call. Returns `null` if `niche` is empty → AI routes 400 "configure the store profile". `targetLanguage` forces output language everywhere.

AI features (all in `src/lib/gemini/client.ts` unless noted; text = `gemini-2.5-flash`, images = `gemini-2.5-flash-image`):
- `optimizeProduct` — title/description/tags/SEO (forbids revealing dropshipping/marketplace origin).
- `generateStorePolicies` — 4 HTML policies (hardcoded BR/CDC/LGPD defaults).
- `suggestThemeImprovements` — markdown suggestions (targets a fixed "Vessel" BR theme).
- `generateStoreSetup` — policies + menus + pages + copyright.
- `generateImageEditPrompt`, `suggestShopifyTaxonomy` (multimodal).
- Reviews (`api/ai/reviews`) — synthetic UGC text + optional AI images, saved to `ai_product_reviews`.

Logo watermarking (non-AI): `src/lib/images/apply-logo.ts` composites the store logo over product images with `sharp`.

---

## 8. Import / clone pipeline

Two **independent** detection stacks:
- **Generic import** (`src/lib/import/source-adapters.ts` → `importFromSource`): AliExpress, Shopify-public, generic HTML. Drives single import + bulk-import jobs.
- **Clone route** (`src/app/api/shopify/clone/route.ts`): Shopify-public, **WooCommerce**, **Shoplazza**. ⚠️ Woo/Shoplazza adapters are **clone-only** — the bulk/multi-site pages force `sourceType:"generic_site"` and never reach them (misleading UI copy).

- **AliExpress** (`src/lib/aliexpress/`): browser-first (intercepts the MTOP PDP XHR via Playwright), HTML fallback with proxy escalation (env proxy → Bright Data Web Unlocker → Bright Data native proxy). Anti-bot heavy; needs a proxy for scale.
- **Shopify public** (`src/lib/shopify/public-store.ts`): `/products.json` pagination; `resolveVariantIdsBySku` powers the routing SKU fallback.
- **Generic HTML** (`src/lib/import/generic-site.ts`): JSON-LD + meta + CSS heuristics; variants via Cartesian product of `<select>`/radio options. **Usually yields no SKU** → breaks routing for those products.

**Job model**: Supabase-table queue (`background_jobs`), NOT Inngest/BullMQ/Redis. `POST /api/jobs/bulk-import` inserts one row per source (cap 20/batch) and drains inline via Next `after()`; an **hourly Vercel cron** (`/api/jobs/bulk-import/process`) re-drains `pending`. ⚠️ `processBulkImportJobs` has **no atomic claim and no stale-recovery** — concurrent drainers can double-process, and a job that dies mid-loop stays `processing` forever. The **image queue** (`processImageNeutralizeJobs`) is the robust one: concurrency pool, 4-min stale reset, credit-gated, self-chaining.

---

## 9. Text & image neutralization (`src/lib/ai/product-neutralizer.ts`)

The mechanism that produces the **checkout store's generic catalog**. Two modes: `stock-neutralize` (remove ALL brands/models → generic stock) and `external-references` (remove only marketplace/seller refs, keep the product's real brand).

- **Text** (`neutralizeText`, `gemini-2.5-flash`): rewrites title/description/tags/SEO brand-free in `targetLanguage` (title ≤70 chars). `stripExternalArtifacts` also regex-strips marketplace terms.
- **Image** (`neutralizeImage`, `gemini-2.5-flash-image`): downloads original → `sharp` to ≤1200px JPEG → Gemini image model removes logos/watermarks and reconstructs a generic stock photo → uploads JPEG to the `product-images` Supabase bucket → returns public URL. Deferred to the background image queue for the checkout store (1 hero image/product). Whole-store re-run: `POST /api/jobs/neutralize-store-images` (billing-gated, 1 credit/image; skips images already under `/product-images/`).

**Both require `GEMINI_API_KEY`** (only on the deployed env; may be absent from a local `.env.local`).

---

## 10. Routed checkout — full runtime flow

Files: `public/routed-checkout-loader.js`, `src/app/api/checkout-routes/**`, `src/lib/shopify/cart-routing.ts`, `src/components/routed-checkout/**`.

**Setup (wizard, `connect-stores-wizard.tsx`)** — 3 modes:
- **generate** — read vitrine → AI-neutralize (text + optional image) → create products in the checkout store → build maps. Calls `create-destination` then `POST /api/checkout-routes`. ⚠️ Heavy/AI; times out on large catalogs.
- **reuse** — copy an already-neutralized checkout store into a new one (no AI) → connect by SKU.
- **connect ("Só conectar")** — both stores already populated → **only matches by SKU/label and generates the script**, creates nothing. Calls `connect-by-sku`. **Use this when the catalog already exists on both stores.**

`connect-by-sku` reads all variants of both stores, matches source→target **by SKU first, label second**, and inserts a `routed_checkout_configs` row (`enterprise_static`, fresh `public_token`, the `sku_map`/`variant_map`).

**Runtime**:
1. Loader `<script>` (with `data-token` = `public_token`, optional `data-config-url` = a theme-CDN `xcart-config.json`) sits in the vitrine `theme.liquid`. Forces `no-referrer`.
2. Add-to-cart is **not** intercepted (vitrine cart works normally). Only **checkout** clicks are intercepted (capture-phase listeners + 500 ms rescan; matches Shopify/Yampi/Dropi buttons via multilingual regex). Express wallets and the dynamic "Buy it now" live in a **closed** shadow DOM (`shopify-accelerated-checkout(-cart)`), so they are matched on `composedPath()` instead; the cart wallets are also hidden with CSS, because PayPal is an iframe whose clicks never reach the page. On the product page the block can't be hidden (it also carries "Buy it now"), so the loader lays a transparent overlay over `.shopify-payment-button` (wrapper gets `position:relative; isolation:isolate`, so the overlay's z-index never climbs above a drawer or sticky header) and re-adds it via `MutationObserver` when the theme swaps the block on variant change; a tap on it while the theme has "Add" disabled (sold out) does nothing. A product-page buy ("Buy it now", wallet, "Comprar agora") reads `/cart.js` first and adds **only the missing quantity** of the form's variant (`/cart/add.js` sums into the existing line: re-adding on every attempt doubled the item at the checkout store), then routes the cart. **A checkout click is always `preventDefault`ed, even mid-routing**: the lock (`isRouting`) holds until the page leaves, and is released only on error, on `pageshow` from bfcache, or by a 10 s safety valve after the redirect. Releasing it early or skipping `preventDefault` sent the buyer's second tap to the vitrine's own checkout.
3. On checkout: reads `/cart.js` → lines `{sku, sourceVariantId, quantity}`.
4. Resolve: **inline first** (the loader picks a checkout store and reads its maps), else `POST /api/checkout-routes/resolve` (server, keyed by `public_token`). Per target the precedence is `targetVariantId` → `variantMap` → `skuMap` → live `products.json` SKU lookup on that checkout store. **Which checkout store gets the cart is decided by §10.2.** The loader only resolves inline when the picked target covers the cart *completely*; partial coverage falls through to the API, which can still complete it from `products.json`. That lookup has a **budget** (`ORCAMENTO_HIDRATACAO_MS` = 8 s, `src/lib/checkout-routes/hidratar-por-sku.ts`) that must stay well under the loader's `PRAZO_REDE_MS` (15 s) -- locked by `tests/resolve-orcamento.test.ts`. A cold SKU index of a big checkout store (up to 20 `products.json` pages through the proxy, each now with a 10 s timeout) runs past it: the API answers with the maps it has and the read keeps going via `after()` to warm the per-instance cache, and a concurrent retry joins the read in flight instead of starting another.
5. Builds a Shopify **cart permalink** `https://<checkoutDomain>/cart/<variantId>:<qty>,...?country=&locale=&discount=` and redirects (no `attributes[...]`: they land on the checkout store's order, see `buildCartPermalink`). **Country/locale are per checkout store**: `routed_checkout_targets.settings` (`checkout_country`, `checkout_locale`, `checkout_domain`), one rule for the server and the theme config in `src/lib/checkout-routes/mercado.ts` (`mercadoDoDestino`). Nothing saved = the old behaviour (country from the store's `target_language`, `en-US` → `US` for every buyer); `checkout_country = "auto"` = no country, Shopify geolocates the buyer; `"CL"` = fixed. Edited in the Lojas tab ("País e moeda do checkout…", `POST /api/checkout-routes/settings` with `targetId`, written by the service role because 064 left the session only weight/enabled/limit/position). The route-level `settings` only matter for a legacy route with no target row. Shopify's permalink doc confirms `discount` and the locale **path prefix** (`/fr/cart/...`), not `country`/`locale` as query params — those stay because they are what runs in production; the path prefix is not used. **Discount**: the code(s) applied in the vitrine cart (`discount_codes`, or `discount_code` applications in `cart.js`) go as `?discount=A,B` — code only, never the amount; same validation in the loader (`cuponsDoCarrinho`) and the server (`normalizarCupons`), and the code must exist in the checkout store too. **Currency telemetry**: `routed_ok` carries the vitrine cart currency and the country sent, stored by `track-fallback` as a `moeda=EUR pais=US|auto` suffix on `detail` (`src/lib/checkout-routes/carrinho-levado.ts`); the activity lines warn when the cart currency differs from the fixed country's, and the store dialog shows the last 30 days by currency. Re-matching a store already in the route (`connect-by-sku` upsert) keeps its settings and weight (`destino-conectado.ts`).
6. Failures → red toast + `track-fallback` telemetry; never routes to the vitrine's own checkout (it can't charge).

**CRITICAL for anyone editing the checkout store**: routing resolves **only by SKU / variant ID**. You can freely rewrite the checkout products' **title, description, tags, SEO and images** (that's exactly what neutralization does) — routing is unaffected as long as you do **not** change/delete variants or SKUs. Never delete+recreate checkout products after a route exists (new variant IDs break `variant_map`; even if SKUs are re-copied and `sku_map` still resolves, prefer in-place `productUpdate`).

### 10.2 Rotation — one vitrine, several checkout stores

`src/lib/checkout-routes/rotation.ts` (server) and the mirrored logic in `public/routed-checkout-loader.js` decide **which** checkout store receives a given cart.

**The rule that overrides everything: rotation never costs a cart line.** Coverage is computed per target first; only the targets tied for the *best* coverage enter the draw. Splitting "fairly" between a store that resolves 5 of 5 lines and one that resolves 3 would send the buyer to a checkout missing two items — rotation exists to spread volume across payment accounts, not to lose sales. A target with `weight = 0` is out of the draw entirely, *unless* it is the only one that covers the cart (better a paused store than a partial checkout).

Among the tied targets the draw is weighted by `weight` and anchored on a rotation key:
- **`sticky`** (default) — the key is the buyer's, stored in their browser (`localStorage["xcart_rk"]`), so the same buyer always lands on the same checkout store. Abandoning the cart and coming back finds the same checkout, and the checkout store's pixel does not see one user hopping domains.
- **`each_checkout`** — fresh draw on every checkout click.

⚠️ **The server and the loader must agree.** Both use the same FNV-1a 32-bit hash (`hashRotationKey`) and the same stable ordering (by target id). If they diverge, a buyer who resolves inline on one visit and via the API on the next switches checkout store mid-purchase. There is a test for exactly this in the rotation suite.

`weight` is relative, not a percentage: `[2,1,1]` is 50%/25%/25%. The UI shows the derived share.

Managed at `/clone/routed-checkout/map` (visual map + weights) and via `GET/PATCH/DELETE /api/checkout-routes/[id]/targets`. Adding a checkout store to an existing route reuses the SKU matching: `POST /api/checkout-routes/connect-by-sku` with `routeId` and `createRoute:false`. A target whose coverage comes back below the safety bar is inserted with `weight = 0` — configured and visible, but receiving nothing until reviewed.

### 10.1 Self-healing

A route rots rather than breaking: the merchant adds a product by hand in Shopify, it lands with no SKU and outside `sku_map`, and nobody notices because the vitrine keeps selling — through the wrong checkout. One account reached **27% coverage** with no alarm.

- `src/lib/checkout-routes/heal.ts` → `healRoute({ routeId, targetId })` — **the unit of healing is the target, not the route**: each checkout store has its own map to rot. Omitting `targetId` heals the first enabled one. It stamps/dedupes vitrine SKUs, remaps entries pointing at the wrong target variant, creates missing counterparts in the checkout store (text-neutralized, image queued), and writes `last_healed_at`.
- Callers: the **Corrigir** button (`POST /api/checkout-routes/repair`, user-scoped) heals **every** enabled target of the route in one go (or only `targetId` when given); the cron (`/api/jobs/routes/heal`, `30 * * * *`, `CRON_SECRET`) takes 4 enabled **targets** per run, oldest `last_healed_at` first (NULL first). Healing writes the corrected map to the target row; the route's legacy `sku_map`/`variant_map` are only kept in sync when the healed target is the primary one.
- `POST /api/checkout-routes/health` checks **one** checkout store per call (it paginates both catalogs; sweeping every target in one request would blow `maxDuration`) — pass `targetId`, else the first enabled one; the response says which via `checkedTargetId`/`checkedTargetName`. It reports `coveragePercent` and `noSkuCount`, and **never returns `ok: true` while SKU-less variants exist** — that blind spot is what made a 27% route look healthy.
- `PATCH /api/checkout-routes/toggle` flips `enabled` only; the general `PATCH /api/checkout-routes` overwrites `sku_map`/`variant_map` and must not be used to toggle.
- **Map always, create only for a vouched pair** (`src/lib/checkout-routes/conserto-regras.ts`). Matching runs in two passes: equal SKU, then the old `variant_map` when it still points at a live checkout variant that no other vitrine SKU owns (a vitrine SKU that changed used to spawn a duplicate product). Creating products/variants needs route + target enabled, `weight > 0`, >= 70% of the vitrine already paired and at most 20 new products per pass; otherwise the heal only maps, stores `last_heal.ok = false` with "N produtos faltam", and creates only when the merchant confirms (`repair` with `criarFaltantes: true`). The confirmation covers ONE checkout store: `repair` requires `targetId` with it unless the route has a single enabled target, and the Diagnostico shows each store's pending count with its own button (`pendenciasDoConserto`). The wizard passes it only when `connect-by-sku` said `safeToEnable`. A checkout variant whose option combo already belongs to another vitrine product is reported, never adopted. A checkout product that already holds variants of more than one vitrine product (the old `xc-` prefix bug) gets no new variant and no new pair -- it is reported (`mixedBlockedVariantCount`) until the merchant splits it.
- **The saved map is pruned, not only extended** (`podarMapas`). The loader and `resolve` read `variant_map` before `sku_map`, so a stale entry wins. A pair whose target no longer exists in the checkout is dropped from both maps (only when the checkout index is complete: pagination finished and every product's variants were read). A live vitrine variant left without a pair loses its old pair when that target is claimed by another variant or carries another vitrine variant's SKU. Variants missing from products.json (unpublished) keep a live pair. Pass 2 (old `variant_map`) runs oldest variant first, so a copied product does not take the original's pair.
- Duplicate vitrine SKU: the variant already in the target's `variant_map` keeps it, otherwise the lowest id (oldest) -- the same rule in the heal (products.json, newest first) and in `connect-by-sku` (Admin API, oldest first).
- **Products with more than 50 variants.** The products query brings 50 variants per product; `completarVariantes` (`client.ts`) reads the rest 250 at a time, up to Shopify's 2048-per-product cap (all stores since 15/10/2025). Every path that indexes or creates uses it: heal, `connect-by-sku`, `health`, `create-destination` (source products and lookup candidates) and `getProductById` (the `syncedProduct` after a create). `productVariantsBulkCreate` goes in batches of 250 (Shopify's list-argument cap). Before this, the Yarden Store -> pauments checkout product was born with 50 of 66 variants and 16 stayed unpaired. Extending an existing product stops at 2048 and warns.
- **Stores the heal cannot serve** (`loja-fora-do-ar.ts`): paused by Shopify (402) = `loja_pausada`, app removed / credential revoked / `uninstalled_at` = `sem_app`, vitrine with a password (products.json closed, confirmed by `shop.json` `password_enabled`) = `vitrine_fechada`, 404 = `loja_fechada`. The heal writes `settings.last_heal` with `motivo`, `lado` and `proximaTentativa` (+12 h) on the route AND on the target row, and stops (409, `HealRouteError.foraDoAr`, `registrado: true` -- the cron must not write the failure again, which would count the pass twice and erase `proximaTentativa`). The cron skips a target until `proximaTentativa`; the Corrigir button never waits. A generic error (network) has no motivo and is retried next hour. The cron queue reads enabled routes first, then their enabled targets (a paused route's targets used to sit at the head forever, since they are never healed and their `last_healed_at` never moves). `repair` with several targets skips one that is fora do ar and reports it in `lojasForaDoAr`.
- **Price and availability are counted, never synced** (`conferirPares`). Each target's `settings.last_heal.conferencia` holds how many matched variants have a price different from the vitrine (only when both stores have the same currency, from `shop.currencyCode`) and how many the checkout does not sell (product not ACTIVE, `onlineStoreUrl` null = off the Online Store channel, `availableForSale` false = tracked and out of stock), with 3 examples each. The route Overview shows them per checkout store. The merchant may have changed a price on purpose.
- A product created by the heal goes with the checkout store's current name as `vendor` (from `shop.name`), never the vitrine's vendor (store name or brand).
- After writing, the heal calls `sincronizarTemaDaRota` (see §13.9).
- `last_heal` is written twice: on the route (`routed_checkout_configs.settings`, the last pass of any target -- what the card shows) and on the healed target (`routed_checkout_targets.settings`). `falhas` counts consecutive failing passes **per target**: the cron heals one target at a time, so a route-level counter alternated 0,1,0,1 between a good and a broken target and never reached 3. The cron also records passes that threw before writing (`registrarFalhaDoConserto`, with `targetId`). Store-down failures carry `lado` (`vitrine`/`checkout`). One shape for both records: `UltimoConserto` in `ultimo-conserto.ts` (extends `Partial<ForaDoAr>` + `falhas`; the target's `UltimoConsertoDoDestino` adds `conferencia`). The alert "Conserto da rota falhando" counts only COMMON failures: it fires when any enabled target with weight > 0 reaches 3; a route with no target rows (legacy) uses the route-level record. A store fora do ar never feeds that counter (it only moves once per 12 h wait): it has its own alert, opened on the FIRST pass that finds it, one per route -- `roteamento_loja_fora_do_ar` (critico: `sem_app` = credential revoked/app removed, `loja_pausada`, `loja_fechada`) and `roteamento_vitrine_com_senha` (aviso, notified once: the password can be on purpose). The vitrine side is read from the route's record (the last pass always checks the vitrine first); the checkout side from each receiving target's record.

### 10.3 Sensor — escapes and orders

`src/lib/checkout-routes/sensor.ts` (rules) + `sensores.ts` (I/O). Two Shopify webhooks, both requiring `read_orders` (`write_orders` also counts, since it grants read; on 08/10 NORAH, NORAH OUTLET, Stepz and Stepz Club had no order scope at all):
- `orders/create` on every enabled checkout store → `routed_checkout_orders` (kept 8 days). Without it the route screen used to show "0 pedidos" — now it shows which store lacks the webhook and why.
- `checkouts/create` on the vitrine of every enabled route → `routed_checkout_fallbacks` with reason `checkout_na_vitrine`, detail = SKU/variant/quantity only (no email/phone/address). Deduped per checkout token via the PK of `shopify_webhook_events`. Ignored when the vitrine is also an enabled checkout store of some route. Shopify's docs only say it "occurs whenever a checkout is created" (abandoned checkouts exist only after contact info), so the count is a floor.

`track-fallback` (public, token in the vitrine HTML) only stores the reasons the loader sends (`motivoDoLoader`); `checkout_na_vitrine` is refused there, so the escape count and its alert come only from the webhook.

Alert "Script do roteamento sumiu": no `loader_ready` in the last 6 h while the same 6 h window yesterday AND the day before each had >= 5. Traffic is not uniform: a minimum over 72 h fired almost every night on small vitrines. Suppressed only when the VITRINE is down (`lado: "vitrine"`), not the checkout store.

Subscription (`conferirWebhooks`): end of the heal cron (≤ 6 stores/run, each store ≤ 1×/day), after `connect-by-sku`/`POST /api/checkout-routes`, and on "Testar agora" (pending ones only). State lives in `settings.webhook_pedidos` (target row) and `settings.webhook_vitrine` (route row). The funnel (`src/lib/leitura/funil-rota.ts`, Visão tab) uses only `count: exact, head: true` — rows are capped at 1000 by PostgREST.

---

## 11. Billing & credits

Two env flags, both **default OFF** (measure-only): `BILLING_ENFORCED` (credit debiting), `ACCESS_CONTROL_ENABLED` (entry + free-clone trial gate).

- **1 credit = 1 product image neutralized** — the only credit-debiting action (debited before Gemini, refunded on failure). Pro plan (`PRO_PRICE_USD = 17`) resets to `PRO_INCLUDED_CREDITS = 20` each paid invoice; packs `pack_50/200/500`.
- Pagou.ai: `POST /v2/customers`, `POST /v2/transactions` (Pix avulso -> recarga), `POST /v2/subscriptions` (token `pgct_` do Payment Element **ou** `pix_automatic`), `POST /v2/subscriptions/{id}/cancel` (**so no fim do periodo**). Nao ha checkout hospedado nem portal do cliente: o cartao e tokenizado no browser via `js.pagou.ai/payments/v3.js` e a tela de gerenciar assinatura e nossa (`/api/billing/subscription`). Webhook em `/api/billing/pagou/webhook`: a Pagou nao documenta assinatura HMAC, entao o handler **nunca confia no corpo** — exige token secreto na `notify_url`, deduplica pelo id do evento em `payment_events` e confirma o estado via `GET` autenticado antes de creditar. Recarga Pix nasce `pending` em `credit_purchases` e so vira credito em `credit_pending_purchase()` (atomica e idempotente). Creditos do plano sao repostos por `reset_ai_credits` quando o periodo vira. `/api/billing/webhook` e o webhook **legado** do Stripe, mantido so para as assinaturas antigas.
- Free-clone trial: first clone consumes `free_clone_store_id`; a second different store → 402 `subscribe_required`.

---

## 12. Environment variables

Documented in `.env.example`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `NEXT_PUBLIC_APP_URL`, `CRON_SECRET`, proxy vars (`IMPORT_FETCH_PROXY_URL`, `GLOBAL_FETCH_PROXY_URL`, `ALIEXPRESS_FETCH_PROXY_URL`, `BRIGHTDATA_*`), Instagram/Meta (`INSTAGRAM_*`, `META_*`, `META_GRAPH_VERSION`).

**Used in code but MISSING from `.env.example`** (add these when deploying): `PAGOU_SECRET_KEY`, `PAGOU_WEBHOOK_TOKEN`, `NEXT_PUBLIC_PAGOU_PUBLIC_KEY`, `NEXT_PUBLIC_PAGOU_ENV`, `STRIPE_WEBHOOK_SECRET` (legado), `BILLING_ENFORCED`, `ACCESS_CONTROL_ENABLED`, `BULK_IMPORT_CRON_SECRET`.

---

## 13. Known issues / gotchas

1. **SKUs are load-bearing** for routing — but the app now **stamps them itself**. `src/lib/shopify/sku-stamp.ts` (`normalizarSkus`) writes a neutral `xc-<base36 variant id>` onto any vitrine variant missing a SKU, and re-stamps SKUs duplicated across variants (a duplicate routes the buyer to the *wrong product*). It runs inside `connect-by-sku`, inside `healRoute`, and hourly via cron — so a product created by hand in Shopify still routes. See §10.1.
2. **`create-destination` timeout + late dedup**: it AI-translates/neutralizes *before* checking for existing products, and processes the whole catalog in one request (concurrency 6, `maxDuration=300`). Large catalogs time out ("Failed to fetch") leaving partial/duplicate products. Prefer the **"Só conectar"** mode when the catalog already exists.
3. **Bulk-import job queue** has no atomic claim / stale recovery (unlike the image queue) → possible double-processing and stuck `processing` jobs.
4. **Woo/Shoplazza are clone-only**; the multi-site page advertises them but HTML-scrapes instead.
5. **`write_themes` is unavailable** via this app's Client Credentials Grant — theme edits need Shopify CLI + a Theme Access password (`shptka_...`), which only works through the CLI, not the Admin REST/GraphQL API directly.
6. **Currency correctness** depends on the checkout store actually having the Shopify Market/currency configured.
7. **Pricing/copy inconsistencies**: `PRO_PRICE_USD=17` but some strings still say "R$89/mês"; some AI prompts hardcode BR (CDC/LGPD/15-30 business days) regardless of `target_language`.
8. **CORS wide open** on `resolve`/`track-fallback` (needed cross-origin); auth is solely the unguessable `public_token`.
9. **The theme keeps a copy of the maps** (`xcart-config.json`) and the loader routes on it before calling the API. `src/lib/checkout-routes/tema-vitrine.ts` pushes it again on its own after heal/repair, toggle, target PATCH/DELETE, settings and a new target (hash in `settings.theme_sync`; writes only on change; a failure waits 6 h, an up-to-date theme is rechecked daily). It only touches THIS route's script and only when it already reads an embedded config -- it never installs. The script points at `{{ 'xcart-config.json' | asset_url }}`, which follows the published theme. A paused route is pushed with no targets, and the legacy target only applies when the route has **no** target rows (all paused = no routing). For that reason the Instalar button refuses a paused route (409, `code: "rota_pausada"`): installing it would block every checkout on the vitrine. A failed read of the target rows is not "no rows": `loadRouteTargets` throws `RouteTargetsLoadError`, `resolve` and `embed-config` answer 503, the heal stops, and nothing is written to the theme (`theme_sync` = falhou, no hash).
10. **A theme still running the previous loader** reads the legacy `domain`/`skuMap`/`variantMap` fields, which `buildEmbedConfig` keeps emitting alongside `targets`. Those themes route to the first target only — no rotation, but no breakage.

---

## 14. Operational playbook — set up a routed store correctly

1. Connect both stores (vitrine + checkout) in `/stores` (OAuth-install each once).
2. Import/build the vitrine catalog. SKUs no longer need to be prepared by hand — the wizard stamps whatever is missing (§10.1).
3. Populate the checkout store with the SAME SKUs. Either let the wizard **generate** (AI-neutralized, but watch the timeout on big catalogs) or replicate products with matching SKUs and then neutralize.
4. **Neutralize the checkout store** — generic brand-free titles/descriptions/tags + AI photos (via `neutralize-store-images`, needs `GEMINI_API_KEY` + credits). Titles/descriptions/images can be rewritten freely; **never touch SKUs/variants**.
5. Connect via the wizard **"Só conectar"** mode → it builds `sku_map`/`variant_map` and outputs the loader `<script>`.
6. Install the loader script in the vitrine `theme.liquid` (or via `update-theme`).
7. Verify: SKU parity between the two stores must be 1:1; a cart on the vitrine should redirect to the checkout store's checkout in the right currency.

---

## 15. File map (entry points)

- Routing: `public/routed-checkout-loader.js`, `src/app/api/checkout-routes/{resolve,connect-by-sku,create-destination,repair,health,settings,track-fallback,map,[id]/*}/route.ts`, `src/lib/shopify/cart-routing.ts`, `src/lib/checkout-routes/{rotation,targets,embed-config,store-roles,heal}.ts`, `src/components/routed-checkout/*`, `src/app/(dashboard)/clone/routed-checkout/map/page.tsx`.
- Import: `src/lib/import/*`, `src/lib/aliexpress/*`, `src/lib/shopify/public-store.ts`, `src/lib/jobs/*`, `src/app/api/{import,aliexpress,jobs}/*`.
- Shopify + AI: `src/lib/shopify/client.ts`, `src/lib/gemini/client.ts`, `src/lib/ai/product-neutralizer.ts`, `src/lib/store-context.ts`, `src/lib/products/shopify-taxonomy-enrichment.ts`, `src/app/api/shopify/*`.
- Shell: `src/proxy.ts`, `src/lib/supabase/middleware.ts`, `src/lib/billing/*`, `src/app/(dashboard)/*`, `src/app/admin/*`.
- Data: `supabase/migrations/001-025_*.sql`.
- Deploy: `next.config.ts`, `vercel.json`, `Dockerfile`, `docker-compose.yml`, `.env.example`.
