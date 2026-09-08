import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { PRO_PRICE_BRL, PRO_INCLUDED_CREDITS, CREDIT_PACKS } from "@/lib/billing/plans";

/**
 * A landing comercial.
 *
 * Refeita sobre o design system do app -- mesmos tokens, mesma escala, mesma
 * linguagem de cartao e borda. Antes ela vivia no sistema visual anterior
 * (bg-background, primary/, border-border/40) e destoava de tudo o que o
 * visitante encontra depois de entrar.
 *
 * O texto tambem mudou, e essa e a parte que importa mais: a versao antiga
 * vendia "clone qualquer loja para a Shopify em minutos", que e a ferramenta
 * de importacao. O produto hoje e o checkout roteado -- vitrine anuncia, loja
 * de checkout cobra, o xcart casa os SKUs e decide quem cobra cada carrinho.
 * A importacao virou um meio para isso, nao o fim.
 */

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://user.xcart.app";
const loginUrl = `${appUrl}/login`;
const signupUrl = `${loginUrl}?mode=signup`;

export const metadata: Metadata = {
  title: "xcart — uma vitrine, várias lojas de checkout",
  description:
    "O xcart leva o carrinho da sua vitrine para a loja que cobra, casando os SKUs. Divida o tráfego entre vários checkouts e continue vendendo quando um cair.",
};

const ETAPAS = [
  {
    n: "01",
    titulo: "Conecte as duas lojas",
    texto:
      "A vitrine, que recebe o tráfego do anúncio, e uma ou mais lojas de checkout, onde o pagamento acontece.",
  },
  {
    n: "02",
    titulo: "Leve o catálogo",
    texto:
      "Importe de Shopify, WooCommerce, Shoplazza, AliExpress ou de um site qualquer. O xcart replica na loja de checkout já neutralizado.",
  },
  {
    n: "03",
    titulo: "Ligue por SKU",
    texto:
      "Cada variante ganha par nas duas lojas. É o SKU que sustenta a rota — título e foto podem ser totalmente diferentes.",
  },
  {
    n: "04",
    titulo: "Divida o tráfego",
    texto:
      "Escolha quanto de cada comprador vai para cada checkout. Um processador cai, você move a fatia e continua vendendo.",
  },
];

const RECURSOS = [
  {
    titulo: "Rodízio entre checkouts",
    texto:
      "Uma vitrine aponta para várias lojas de checkout ao mesmo tempo. O sorteio nunca custa uma linha do carrinho: só entram no rodízio as lojas que cobrem o carrinho inteiro.",
  },
  {
    titulo: "Casamento por SKU",
    texto:
      "A ligação entre as lojas é o SKU, não o nome. Isso deixa a loja de checkout mudar título, descrição, tags e foto sem quebrar nada.",
  },
  {
    titulo: "Neutralização com IA",
    texto:
      "A loja de checkout recebe o catálogo com o texto reescrito sem marca e as fotos regeradas sem logo. As duas lojas nunca parecem ligadas.",
  },
  {
    titulo: "Importação de qualquer fonte",
    texto:
      "Shopify, WooCommerce, Shoplazza, AliExpress e sites genéricos. Traduz para o idioma da loja de destino e publica direto.",
  },
  {
    titulo: "Conserto automático",
    texto:
      "De hora em hora o xcart confere a rota: SKU sem par, variante trocada, produto que sumiu. Acha e corrige antes do carrinho falhar.",
  },
  {
    titulo: "Conectado ao Claude",
    texto:
      "Um servidor MCP dá ao Claude acesso de leitura e edição às suas lojas. Pergunte, audite e corrija conversando.",
  },
];

/** Cartão do diagrama da operação, igual ao do design. */
function Caixa({
  titulo,
  texto,
  destaque,
}: {
  titulo: string;
  texto: string;
  destaque?: boolean;
}) {
  return (
    <div
      className="rounded-[7px] px-3 py-2.5"
      style={{
        border: `1px solid ${destaque ? "var(--solid)" : "var(--border)"}`,
        background: destaque ? "var(--solid)" : "var(--surface)",
        color: destaque ? "var(--on-solid)" : "var(--ink)",
      }}
    >
      <div className="text-[12.5px] font-semibold">{titulo}</div>
      <div
        className="text-[11px]"
        style={{ color: destaque ? "var(--t4)" : "var(--t3)" }}
      >
        {texto}
      </div>
    </div>
  );
}

function Fio() {
  return (
    <div className="ml-4 h-4 w-px" style={{ background: "var(--border-strong)" }} aria-hidden />
  );
}

export default function Landing() {
  return (
    <div className="min-h-screen bg-[var(--bg)] text-ink">
      {/* ------------------------------------------------------- topo */}
      <header className="sticky top-0 z-50 border-b border-border bg-[var(--header-bg)] backdrop-blur">
        <div className="mx-auto flex max-w-[1080px] items-center gap-6 px-5 py-3">
          {/* logo-cropped tem o texto escuro, que e o que serve num fundo
              claro; logo.png e a versao de texto branco, para fundo escuro. */}
          <Link href="/lp" className="flex items-center">
            <Image
              src="/logo-cropped.png"
              alt="xcart"
              width={891}
              height={177}
              priority
              className="h-6 w-auto"
            />
          </Link>
          <nav className="ml-4 hidden items-center gap-6 md:flex">
            {[
              ["#como-funciona", "Como funciona"],
              ["#recursos", "Recursos"],
              ["#precos", "Preços"],
            ].map(([href, rotulo]) => (
              <a
                key={href}
                href={href}
                className="text-[12.5px] text-t2 transition-colors hover:text-ink"
              >
                {rotulo}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <a href={loginUrl} className="text-[12.5px] text-t2 hover:text-ink">
              Entrar
            </a>
            <a
              href={signupUrl}
              className="inline-flex h-[30px] items-center rounded-md bg-[var(--solid)] px-[13px] text-[12.5px] font-semibold text-[var(--on-solid)] transition-colors hover:bg-[var(--solid-hover)]"
            >
              Começar
            </a>
          </div>
        </div>
      </header>

      {/* ------------------------------------------------------- hero */}
      <section className="mx-auto grid max-w-[1080px] items-center gap-12 px-5 py-20 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div>
          <span className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1 text-[11.5px] text-t2">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: "var(--ok)" }}
              aria-hidden
            />
            Checkout roteado para Shopify
          </span>
          <h1 className="mt-4 max-w-[15ch] text-[40px] font-semibold leading-[1.08] tracking-[-0.02em] text-ink">
            Uma vitrine, várias lojas de checkout
          </h1>
          <p className="mt-4 max-w-[46ch] text-pretty text-[14px] leading-relaxed text-t2">
            A vitrine recebe o tráfego do anúncio. A loja de checkout cobra. O xcart leva
            o carrinho de uma para a outra casando os SKUs — e divide o tráfego entre
            quantos checkouts você quiser.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-2.5">
            <a
              href={signupUrl}
              className="inline-flex h-9 items-center rounded-md bg-[var(--solid)] px-4 text-[13px] font-semibold text-[var(--on-solid)] transition-colors hover:bg-[var(--solid-hover)]"
            >
              Começar agora
            </a>
            <a
              href="#precos"
              className="inline-flex h-9 items-center rounded-md border border-[var(--border-strong)] bg-surface px-4 text-[13px] font-semibold !text-ink transition-colors hover:bg-surface-2"
            >
              Ver preços
            </a>
          </div>
          <p className="mt-4 text-[12px] text-t3">
            R$ {PRO_PRICE_BRL.toFixed(0).replace(".", ",")}/mês · rotas e produtos
            ilimitados · {PRO_INCLUDED_CREDITS} imagens neutralizadas inclusas
          </p>
        </div>

        {/* O diagrama é o produto. Vem do design, onde ele explica a operação
            melhor do que qualquer parágrafo. */}
        <div className="rounded-lg border border-border bg-surface-2 p-7">
          <div className="font-mono text-[10px] tracking-[0.12em] text-t3">
            MODELO DA OPERAÇÃO
          </div>
          <div className="mt-5 flex flex-col gap-2.5">
            <Caixa titulo="Vitrine" texto="Recebe o tráfego do anúncio" />
            <Fio />
            <Caixa titulo="XCART" texto="Mapeia, sincroniza e roteia" destaque />
            <Fio />
            <Caixa titulo="Lojas de checkout" texto="Onde o pagamento acontece" />
          </div>
          <p className="mt-6 text-pretty text-[12.5px] text-t1">
            As duas lojas nunca aparecem ligadas. O comprador navega numa e paga na
            outra, sem perceber a troca.
          </p>
        </div>
      </section>

      {/* ----------------------------------------------- como funciona */}
      <section id="como-funciona" className="border-y border-border bg-surface">
        <div className="mx-auto max-w-[1080px] px-5 py-16">
          <h2 className="text-[22px] font-semibold tracking-[-0.01em] text-ink">
            Como funciona
          </h2>
          <p className="mt-1.5 text-[13px] text-t2">Quatro passos até a rota no ar.</p>
          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {ETAPAS.map((etapa) => (
              <div
                key={etapa.n}
                className="rounded-lg border border-border bg-surface-2 p-5"
              >
                <div className="font-mono text-[11px] text-t4">{etapa.n}</div>
                <div className="mt-2 text-[13.5px] font-semibold text-ink">
                  {etapa.titulo}
                </div>
                <p className="mt-1.5 text-pretty text-[12.5px] leading-relaxed text-t2">
                  {etapa.texto}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* --------------------------------------------------- recursos */}
      <section id="recursos" className="mx-auto max-w-[1080px] px-5 py-16">
        <h2 className="text-[22px] font-semibold tracking-[-0.01em] text-ink">
          O que o xcart resolve
        </h2>
        <p className="mt-1.5 text-[13px] text-t2">
          O trabalho que separa duas lojas Shopify de uma operação que cobra.
        </p>
        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {RECURSOS.map((r) => (
            <div key={r.titulo} className="rounded-lg border border-border bg-surface p-5">
              <div className="text-[13.5px] font-semibold text-ink">{r.titulo}</div>
              <p className="mt-1.5 text-pretty text-[12.5px] leading-relaxed text-t2">
                {r.texto}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ----------------------------------------------------- preços */}
      <section id="precos" className="border-y border-border bg-surface">
        <div className="mx-auto max-w-[1080px] px-5 py-16">
          <h2 className="text-[22px] font-semibold tracking-[-0.01em] text-ink">
            Preço simples
          </h2>
          <p className="mt-1.5 text-[13px] text-t2">
            Um plano com tudo liberado. Pague a mais só por imagem neutralizada.
          </p>

          <div className="mt-8 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="rounded-lg border border-[var(--border-strong)] bg-surface-2 p-6">
              <div className="flex items-baseline gap-2">
                <span className="text-[13px] font-semibold text-ink">Pro</span>
                <span
                  className="rounded px-[7px] py-0.5 text-[11px] font-medium"
                  style={{ background: "var(--ok-bg)", color: "var(--ok)" }}
                >
                  tudo liberado
                </span>
              </div>
              <div className="mt-3 flex items-baseline gap-1.5">
                <span className="text-[34px] font-semibold tracking-[-0.02em] tabular-nums text-ink">
                  R$ {PRO_PRICE_BRL.toFixed(0)}
                </span>
                <span className="text-[13px] text-t3">/mês</span>
              </div>
              <ul className="mt-5 flex flex-col gap-2">
                {[
                  "Vitrines e lojas de checkout ilimitadas",
                  "Rodízio de tráfego entre checkouts",
                  "Importação de Shopify, WooCommerce, Shoplazza e AliExpress",
                  "Neutralização de texto ilimitada",
                  `${PRO_INCLUDED_CREDITS} imagens neutralizadas por mês`,
                  "Conserto automático da rota de hora em hora",
                  "Servidor MCP para usar com o Claude",
                ].map((item) => (
                  <li key={item} className="flex gap-2.5 text-[12.5px] text-t1">
                    <span
                      className="mt-[7px] h-1 w-1 shrink-0 rounded-full"
                      style={{ background: "var(--ok)" }}
                      aria-hidden
                    />
                    {item}
                  </li>
                ))}
              </ul>
              <a
                href={signupUrl}
                className="mt-6 inline-flex h-9 w-full items-center justify-center rounded-md bg-[var(--solid)] px-4 text-[13px] font-semibold text-[var(--on-solid)] transition-colors hover:bg-[var(--solid-hover)]"
              >
                Assinar Pro
              </a>
            </div>

            <div className="rounded-lg border border-border bg-surface p-6">
              <div className="text-[13px] font-semibold text-ink">Créditos extras</div>
              <p className="mt-1.5 max-w-[42ch] text-pretty text-[12.5px] leading-relaxed text-t2">
                1 crédito = 1 imagem neutralizada com IA. Recarregue quando precisar, sem
                mudar de plano. Texto sem marca não consome crédito.
              </p>
              <div className="mt-5 overflow-hidden rounded-lg border border-border">
                {CREDIT_PACKS.map((pack) => (
                  <div
                    key={pack.id}
                    className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-surface-2 px-4 py-3 last:border-b-0"
                  >
                    <span className="text-[12.5px] text-t1">{pack.label}</span>
                    <span className="font-mono text-[12.5px] font-medium tabular-nums text-ink">
                      R$ {(pack.amountCents / 100).toFixed(0)}
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-[11.5px] text-t3">
                Compre dentro do app, na aba de assinatura.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------- cta final */}
      <section className="mx-auto max-w-[1080px] px-5 py-20 text-center">
        <h2 className="text-[26px] font-semibold tracking-[-0.02em] text-ink">
          Sua vitrine já tem tráfego. Falta quem cobra.
        </h2>
        <p className="mx-auto mt-3 max-w-[52ch] text-pretty text-[13px] text-t2">
          Conecte as duas lojas, ligue por SKU e coloque a rota no ar. Se um checkout
          cair, o tráfego vai para o próximo sem você tocar no anúncio.
        </p>
        <a
          href={signupUrl}
          className="mt-7 inline-flex h-9 items-center rounded-md bg-[var(--solid)] px-5 text-[13px] font-semibold text-[var(--on-solid)] transition-colors hover:bg-[var(--solid-hover)]"
        >
          Criar conta
        </a>
      </section>

      {/* ------------------------------------------------------ rodapé */}
      <footer className="border-t border-border bg-surface">
        <div className="mx-auto flex max-w-[1080px] flex-col items-center justify-between gap-4 px-5 py-8 text-[12px] text-t3 sm:flex-row">
          <Image
            src="/logo-cropped.png"
            alt="xcart"
            width={891}
            height={177}
            className="h-5 w-auto"
          />
          <div className="flex items-center gap-5">
            <Link href="/privacy" className="text-t3 transition-colors hover:text-ink">
              Privacidade
            </Link>
            <Link href="/terms" className="text-t3 transition-colors hover:text-ink">
              Termos
            </Link>
            <a href={loginUrl} className="text-t3 transition-colors hover:text-ink">
              Entrar
            </a>
          </div>
          <p>© {new Date().getFullYear()} xcart</p>
        </div>
      </footer>
    </div>
  );
}
