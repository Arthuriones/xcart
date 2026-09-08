<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# xcart — orientation for AI agents

This repo (`xcart`) is a dropshipping automation tool built around a **two-store routed-checkout** model:

- **Vitrine (source store)** — branded/replica products, gets ad traffic, customer adds to cart.
- **Loja checkout (target/dark store)** — neutralized generic copy + AI de-branded photos, where payment happens.
- At checkout the cart is **routed vitrine → checkout store by SKU** and the buyer is redirected to the checkout store's checkout. A vitrine may point at **several** checkout stores, with the traffic split between them (rotation).

**The system hinges on SKU** — it's the only stable join key (neutralization rewrites titles/images). When editing the checkout store you may change title/description/tags/images, but **never touch variants/SKUs** or you break the route.

**Before doing substantial work, read [`ARCHITECTURE.md`](./ARCHITECTURE.md)** (complete reference: routing, import pipeline, Shopify/AI integration, data model, billing, deployment, gotchas) and [`CLAUDE.md`](./CLAUDE.md) (quick orientation). Key facts: routing destinations live in `routed_checkout_targets` (one row per checkout store, each with its own SKU map); Next.js 16, React 19, Supabase (RLS), Gemini 2.5, Shopify Admin GraphQL 2024-10 via Client Credentials Grant, Stripe billing, background jobs on a Supabase-table queue (not Inngest). Deployed on Vercel + Docker.
