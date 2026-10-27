import type { Metadata } from "next";
import type { ReactNode } from "react";
import {
  ArrowRight,
  Calculator,
  Check,
  Download,
  Minus,
  Plug,
  Plus,
  Route,
  Smartphone,
  Store,
  type LucideIcon,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { CabecalhoSite } from "@/components/site/cabecalho-site";
import { RodapeSite } from "@/components/site/rodape-site";
import { URL_CRIAR_CONTA } from "@/components/site/links";
import {
  COMPARACAO,
  CONECTA_COM,
  OUTROS_RECURSOS,
  PASSOS,
  PERGUNTAS,
  PROBLEMAS,
  PROBLEMA_FECHO,
  PROVAS,
  RECURSOS_PRINCIPAIS,
  ROTEAMENTO,
  type RecursoPrincipal,
  type RecursoSecundario,
} from "./conteudo";
import {
  DiagramaRota,
  PreviaAlertas,
  PreviaComposicao,
  PreviaDashboard,
  PreviaRastreamento,
} from "./ilustracoes";
import { GARANTIA, NOTA_DO_PRECO, PLANOS, PRECO_A_PARTIR, type PlanoNaTela } from "./plano";

/**
 * A landing comercial (raiz do host publico e /lp), no redesign de
 * 24/10/2026 ("design novo/Landing").
 *
 * Vende primeiro o que o lojista abre o app para ver -- lucro por loja,
 * rastreamento e alertas -- e deixa o roteamento como um modulo, para quem
 * usa vitrine. O hero e centralizado e mostra o Dashboard novo com os
 * valores escondidos: nenhum numero inventado.
 *
 * So o preco, a chamada final e o rodape sao escuros. Nao tem cor propria:
 * levam a classe `dark`, que redefine a paleta do app so dentro deles. Os
 * mesmos tokens (bg-surface, text-ink, text-t2...) pintam o claro e o escuro,
 * e o tema escuro do site continua funcionando.
 *
 * Server component inteiro; a unica parte no navegador e o menu do celular
 * (e a troca de tema no rodape). As perguntas abrem com <details>, sem
 * JavaScript. O texto mora em conteudo.ts e o plano em plano.ts.
 *
 * Larguras do design: celular < 768 (md), estreito < 1024 (lg); a janela do
 * hero ganha a composicao em 900px e o menu lateral em 1100px.
 */

const TITULO = "xcart · lucro, rastreamento e alertas para lojas Shopify";
const DESCRICAO =
  "Veja o lucro estimado de cada loja Shopify, já descontado o anúncio. Entregue as compras ao Meta, ao TikTok e ao Google e receba alertas quando algo quebra.";

// A raiz e /lp sao a mesma pagina (o proxy reescreve a raiz para /lp): o
// canonical diz ao Google qual vale, e o openGraph e o que aparece no link
// compartilhado no WhatsApp e no Instagram.
export const metadata: Metadata = {
  metadataBase: new URL("https://xcart.app"),
  title: TITULO,
  description: DESCRICAO,
  alternates: { canonical: "/" },
  openGraph: {
    title: TITULO,
    description: DESCRICAO,
    url: "/",
    siteName: "xcart",
    locale: "pt_BR",
    type: "website",
  },
};

const ILUSTRACAO: Record<RecursoPrincipal["id"], () => ReactNode> = {
  lucro: PreviaComposicao,
  rastreamento: PreviaRastreamento,
  alertas: PreviaAlertas,
};

const ICONE_SECUNDARIO: Record<RecursoSecundario["id"], LucideIcon> = {
  custos: Calculator,
  integracoes: Plug,
  importar: Download,
  lojas: Store,
  "venda-no-celular": Smartphone,
  roteamento: Route,
};

// cn() e obrigatorio: o cva junta "border-transparent" da base com a borda da
// variante sem resolver o conflito, e o contorno do secundario sumia.
const LINK_BOTAO_PRIMARIO = cn(buttonVariants({ variant: "primary", size: "lg" }), "font-semibold");
const LINK_BOTAO_SECUNDARIO = cn(
  buttonVariants({ variant: "secondary", size: "lg" }),
  "font-semibold"
);

/** Rotulo pequeno em monoespacada acima do titulo de cada secao. */
const SOBRETITULO = "font-mono text-label text-t3";
const TITULO_SECAO =
  "text-[clamp(30px,3.6vw,46px)] leading-[1.06] font-semibold tracking-[-0.03em] text-balance text-ink";
const TEXTO_SECAO = "text-[17px] leading-[1.6] text-pretty text-t1";

/** Duas colunas que viram uma quando a menor nao cabe (o auto-fit do design). */
const DUAS_COLUNAS = {
  460: "grid grid-cols-[repeat(auto-fit,minmax(min(100%,460px),1fr))]",
  440: "grid grid-cols-[repeat(auto-fit,minmax(min(100%,440px),1fr))]",
  420: "grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))]",
} as const;

const FUNDO = {
  /** O fundo da pagina. */
  pagina: "",
  /** Faixa clara de ponta a ponta, para alternar com o fundo da pagina. */
  faixa: "bg-surface",
  /** O cinza mais leve (roteamento). */
  faixa2: "bg-surface-2",
  /** Faixa escura: a paleta escura do app, so aqui dentro. */
  escuro: "dark bg-bg text-ink",
} as const;

function Secao({
  id,
  fundo = "pagina",
  className,
  children,
}: {
  id: string;
  fundo?: keyof typeof FUNDO;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-titulo`}
      className={cn(
        "scroll-mt-15 border-t border-border px-4 py-16 md:px-6 md:py-28",
        FUNDO[fundo],
        className
      )}
    >
      <div className="mx-auto w-full max-w-300">{children}</div>
    </section>
  );
}

function Cabecalho({
  id,
  sobretitulo,
  titulo,
  descricao,
  className,
}: {
  /** O mesmo id da secao: o titulo vira `${id}-titulo`. */
  id: string;
  sobretitulo?: ReactNode;
  titulo: string;
  descricao?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {typeof sobretitulo === "string" ? <p className={SOBRETITULO}>{sobretitulo}</p> : sobretitulo}
      <h2 id={`${id}-titulo`} className={TITULO_SECAO}>
        {titulo}
      </h2>
      {descricao ? <p className={TEXTO_SECAO}>{descricao}</p> : null}
    </div>
  );
}

function ListaComCheck({ itens, className }: { itens: readonly string[]; className?: string }) {
  return (
    <ul className={cn("flex flex-col gap-2.5", className)}>
      {itens.map((item) => (
        <li key={item} className="flex gap-2.5 text-[15px] leading-normal text-pretty text-t1">
          <Check aria-hidden className="mt-0.75 size-4 shrink-0 text-ok" strokeWidth={2} />
          {item}
        </li>
      ))}
    </ul>
  );
}

/** Preco, garantia e cancelamento numa linha (hero e chamada final). */
function LinhaDoPlano({ className }: { className?: string }) {
  return (
    <p className={cn("flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-dense text-t2", className)}>
      <span className="num font-semibold text-ink">A partir de {PRECO_A_PARTIR} por mês</span>
      <span>{GARANTIA.curta}</span>
      <span>Cancele quando quiser</span>
    </p>
  );
}

function Marca({ sim }: { sim: boolean }) {
  return sim ? (
    <>
      <Check aria-hidden className="mx-auto size-4 text-ok" strokeWidth={2} />
      <span className="sr-only">Sim</span>
    </>
  ) : (
    <>
      <Minus aria-hidden className="mx-auto size-4 text-t4" strokeWidth={2} />
      <span className="sr-only">Não</span>
    </>
  );
}

/**
 * Cartao de um plano, dentro da faixa escura. O em destaque ganha o brilho e
 * a borda terracota, o selo no topo e o botao cheio. O terracota do botao e do
 * selo e o da marca no tema CLARO (#b04a2f): o --brand do escuro e claro demais
 * para levar texto branco.
 */
function CartaoPlano({ plano }: { plano: PlanoNaTela }) {
  const destaque = Boolean(plano.destaque);
  return (
    <li
      className={cn(
        "relative flex flex-col rounded-[16px] border bg-surface px-5.5 pt-7 pb-5.5",
        destaque
          ? "border-brand/60 bg-[radial-gradient(120%_55%_at_50%_0%,rgba(176,74,47,.24),rgba(176,74,47,0)_70%)]"
          : "border-border"
      )}
    >
      {plano.selo ? (
        <span className="absolute -top-2.75 left-1/2 h-5.5 -translate-x-1/2 rounded-full bg-[#b04a2f] px-3 text-[11px] leading-5.5 font-bold tracking-[.08em] whitespace-nowrap text-white uppercase">
          {plano.selo}
        </span>
      ) : null}
      <h3 className="text-overlay tracking-[-0.01em] text-ink">{plano.nome}</h3>
      <p className="mt-1.5 min-h-10 text-dense leading-5 text-pretty text-t2">{plano.subtitulo}</p>
      <p className="mt-5 flex items-baseline gap-0.75">
        <span className="mr-0.5 text-body font-semibold text-t2">R$</span>
        <span className="num text-[40px] leading-none font-bold tracking-[-0.045em] text-ink">
          {plano.inteiro}
        </span>
        <span className="num text-[16px] font-semibold text-ink">{plano.centavos}</span>
        <span aria-hidden="true" className="ml-1 text-dense text-t3">
          /mês
        </span>
        <span className="sr-only">por mês</span>
      </p>
      <dl className="mt-6 flex flex-col border-t border-border">
        {plano.especificacoes.map((e) => (
          <div key={e.rotulo} className="flex items-center justify-between gap-3 border-b border-border py-2.5">
            <dt className="text-label text-t3">{e.rotulo}</dt>
            <dd className={cn("text-right text-label font-semibold", e.incluso ? "text-ink" : "text-t3")}>
              {e.valor}
            </dd>
          </div>
        ))}
      </dl>
      <ul className="mt-5 mb-7 flex flex-col gap-3">
        {plano.recursos.map((r) => (
          <li key={r} className="flex gap-2.5 text-body text-pretty text-t1">
            <span
              aria-hidden="true"
              className={cn(
                "grid size-5 flex-none place-items-center rounded-full",
                destaque ? "bg-brand/16 text-[#e39a78]" : "bg-hover text-t2"
              )}
            >
              <Check className="size-2.75" strokeWidth={3} />
            </span>
            {r}
          </li>
        ))}
      </ul>
      <a
        // O cadastro guarda o plano: a escolha de plano do app ja abre nele.
        href={`${URL_CRIAR_CONTA}&plano=${plano.id}`}
        className={cn(
          "mt-auto flex h-11 items-center justify-center gap-2 rounded-full border text-body font-semibold",
          destaque
            ? "border-[#b04a2f] bg-[#b04a2f] text-white hover:bg-[#9c3f27] hover:text-white"
            : "border-border-strong text-ink hover:bg-hover hover:text-ink"
        )}
      >
        Escolher plano
        <ArrowRight aria-hidden className="size-4" strokeWidth={2} />
        <span className="sr-only"> {plano.nome}</span>
      </a>
    </li>
  );
}

export default function Landing() {
  return (
    <div className="flex min-h-screen flex-col bg-bg text-ink">
      <a
        href="#conteudo"
        className="sr-only z-50 rounded-control bg-solid px-3 py-2 text-dense text-on-solid focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Pular para o conteúdo
      </a>
      <CabecalhoSite caixa="landing" />

      <main id="conteudo" className="flex-1">
        {/* --------------------------------------------------------- hero */}
        {/* overflow-x-clip, nao hidden: hidden cortava a sombra da janela num
            degrau reto logo acima do "Conecta com". */}
        <section
          aria-labelledby="hero-titulo"
          className="overflow-x-clip px-4 pt-12 pb-10 md:px-6 md:pt-22 md:pb-12"
        >
          <div className="mx-auto flex w-full max-w-300 flex-col items-center gap-6 text-center">
            <p className="inline-flex h-7 items-center gap-2 rounded-full border border-border bg-surface px-3 text-label font-medium text-t1">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-ok" />
              Para quem opera lojas Shopify
            </p>
            <h1
              id="hero-titulo"
              className="w-full max-w-260 text-[clamp(38px,5.4vw,72px)] leading-[1.02] font-semibold tracking-[-0.04em] text-balance text-ink"
            >
              Quanto cada loja lucrou hoje.{" "}
              <span className="block text-t3">Já descontado o anúncio.</span>
            </h1>
            <p className="max-w-[52ch] text-[clamp(16px,1.6vw,19px)] leading-[1.6] text-pretty text-t1">
              O xcart cruza os pedidos da Shopify com o gasto do Meta e do Google, entrega cada
              compra ao Meta, ao TikTok e ao Google e avisa no Telegram quando algo quebra.
            </p>
            <div className="flex w-full max-w-100 flex-wrap justify-center gap-2">
              <a href={URL_CRIAR_CONTA} className={cn(LINK_BOTAO_PRIMARIO, "flex-[1_1_160px]")}>
                Criar conta
              </a>
              <a href="#preco" className={cn(LINK_BOTAO_SECUNDARIO, "flex-[1_1_160px]")}>
                Ver o preço
              </a>
            </div>
            <LinhaDoPlano />
            <PreviaDashboard />
          </div>
        </section>

        {/* ------------------------------------------------- conecta com */}
        <section aria-labelledby="conecta-com" className="px-6 pb-14">
          <div className="mx-auto flex w-full max-w-300 flex-wrap items-center justify-center gap-x-3 gap-y-2.5">
            <p id="conecta-com" className={cn(SOBRETITULO, "mr-2")}>
              Conecta com
            </p>
            <ul className="flex flex-wrap justify-center gap-2">
              {CONECTA_COM.map((p) => (
                <li
                  key={p}
                  className="inline-flex h-ctl-md items-center rounded-full border border-border bg-surface px-3.5 text-dense font-semibold tracking-[-0.005em] text-t1"
                >
                  {p}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ---------------------------------------------------- problema */}
        <Secao id="por-que" fundo="faixa">
          <div className={cn(DUAS_COLUNAS[460], "items-start gap-x-18 gap-y-12")}>
            <div className="flex flex-col gap-4">
              <Cabecalho
                id="por-que"
                sobretitulo="Por que o xcart existe"
                titulo="Cada painel mostra um pedaço da conta"
                descricao="A Shopify sabe o que vendeu. O Meta e o Google sabem o que gastaram. Nenhum deles junta as duas pontas com o custo do produto, e o pixel do navegador ainda deixa compras pelo caminho."
              />
              <p className="mt-3 border-l-2 border-brand pl-4 text-[clamp(18px,1.9vw,22px)] leading-[1.4] font-medium tracking-[-0.015em] text-pretty text-ink">
                {PROBLEMA_FECHO}
              </p>
            </div>
            <ol className="flex flex-col border-t border-border">
              {PROBLEMAS.map((p) => (
                <li
                  key={p.origem}
                  className="grid grid-cols-[120px_minmax(0,1fr)] gap-x-5 gap-y-1 border-b border-border py-5.5"
                >
                  <p className="font-mono text-label leading-6.5 text-t3">{p.origem}</p>
                  <div className="flex flex-col gap-1.5">
                    <h3 className="text-[19px] leading-[1.35] font-semibold tracking-[-0.01em] text-ink">
                      {p.titulo}
                    </h3>
                    <p className="text-[15px] leading-[1.6] text-pretty text-t1">{p.texto}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </Secao>

        {/* ----------------------------------------------------- recursos */}
        <Secao id="recursos">
          <Cabecalho
            id="recursos"
            sobretitulo="Dinheiro e rastreamento no centro"
            titulo="As três telas que você abre todo dia"
            descricao="Lucro, Rastreamento e Alertas. O resto do xcart existe para elas ficarem certas."
            className="max-w-180"
          />

          <div className="mt-14 flex flex-col gap-16 md:gap-26">
            {RECURSOS_PRINCIPAIS.map((r, i) => {
              const Ilustracao = ILUSTRACAO[r.id];
              return (
                <article
                  key={r.id}
                  aria-labelledby={`recurso-${r.id}`}
                  className={cn(DUAS_COLUNAS[420], "items-center gap-x-18 gap-y-10")}
                >
                  {/* O do meio troca de lado a partir de 1024px. */}
                  <div className={cn("flex flex-col gap-4", i % 2 === 1 && "lg:order-2")}>
                    <p className="inline-flex items-center gap-2.5 text-dense font-medium text-t2">
                      <span className="font-mono text-label text-ink">{String(i + 1).padStart(2, "0")}</span>
                      <span aria-hidden="true" className="h-px w-5 bg-border-strong" />
                      {r.tela}
                    </p>
                    <h3
                      id={`recurso-${r.id}`}
                      className="text-[clamp(24px,2.6vw,32px)] leading-[1.15] font-semibold tracking-[-0.022em] text-balance text-ink"
                    >
                      {r.titulo}
                    </h3>
                    <p className="text-base leading-[1.65] text-pretty text-t1">{r.resumo}</p>
                    <ListaComCheck itens={r.pontos} className="mt-1" />
                  </div>
                  <Ilustracao />
                </article>
              );
            })}
          </div>

          <div className="mt-16 flex flex-col gap-5 md:mt-26">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
              <h3 className="text-page tracking-[-0.015em] text-ink">Também no xcart</h3>
              <p className="text-body text-t2">Incluído no plano.</p>
            </div>
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-px overflow-hidden rounded-overlay border border-border bg-border">
              {OUTROS_RECURSOS.map((r) => {
                const Icone = ICONE_SECUNDARIO[r.id];
                return (
                  <li key={r.id} className="flex flex-col gap-2 bg-surface p-5.5">
                    <Icone aria-hidden className="size-5 text-t2" strokeWidth={1.75} />
                    <span className="mt-1 text-section text-ink">{r.titulo}</span>
                    <p className="text-dense leading-[1.55] text-pretty text-t2">{r.texto}</p>
                    {r.id === "roteamento" ? (
                      <a href="#roteamento" className="mt-auto pt-1 text-dense font-medium">
                        Como funciona
                      </a>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        </Secao>

        {/* ---------------------------------------------------- comparar */}
        <Secao id="comparar" fundo="faixa">
          <div className={cn(DUAS_COLUNAS[440], "items-start gap-x-18 gap-y-10")}>
            <Cabecalho
              id="comparar"
              sobretitulo="Mais que um painel"
              titulo="Mostrar o lucro é o começo"
              descricao="Um painel diz quanto você ganhou. O xcart também garante que a compra chegou à plataforma de anúncio e avisa quando alguma coisa para."
            />
            <div className="overflow-hidden rounded-overlay border border-border">
              <table className="w-full text-body">
                <caption className="sr-only">Um painel de lucro comum comparado ao xcart</caption>
                <thead className="border-b border-border bg-surface-2">
                  <tr>
                    <th scope="col" className="px-5 py-3.5 text-left text-label font-medium text-t3">
                      Recurso
                    </th>
                    <th scope="col" className="w-26 px-1 py-3.5 text-center text-label font-medium text-t2">
                      Painel de lucro
                    </th>
                    <th scope="col" className="w-22 px-1 py-3.5 text-center text-label font-semibold text-ink">
                      xcart
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARACAO.map((l) => (
                    <tr key={l.item} className="border-t border-border-subtle">
                      <th
                        scope="row"
                        className="px-5 py-3.5 text-left leading-[1.45] font-normal text-pretty text-ink"
                      >
                        {l.item}
                      </th>
                      <td className="text-center">
                        <Marca sim={l.painel} />
                      </td>
                      <td className="bg-surface-2 text-center">
                        <Marca sim />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Secao>

        {/* ------------------------------------------------- como começar */}
        <Secao id="como-comecar">
          <Cabecalho
            id="como-comecar"
            sobretitulo="Como começar"
            titulo="Quatro passos até o primeiro lucro na tela"
            descricao="O app guia cada um e mostra o que copiar e onde colar."
            className="max-w-180"
          />
          <ol className="mt-12 grid grid-cols-[repeat(auto-fit,minmax(min(100%,230px),1fr))] gap-3">
            {PASSOS.map((p, i) => (
              <li
                key={p.titulo}
                className="flex flex-col gap-2.5 rounded-overlay border border-border bg-surface p-5.5"
              >
                <span className="flex items-center gap-2.5">
                  <span className="grid size-7 place-items-center rounded-full bg-solid font-mono text-label font-medium text-on-solid">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span
                    aria-hidden="true"
                    className={cn("h-px flex-1", i < PASSOS.length - 1 ? "bg-border" : "bg-transparent")}
                  />
                </span>
                <span className="mt-1.5 text-[17px] leading-[1.35] font-semibold tracking-[-0.01em] text-ink">
                  {p.titulo}
                </span>
                <p className="text-body leading-[1.6] text-pretty text-t2">{p.texto}</p>
              </li>
            ))}
          </ol>
        </Secao>

        {/* --------------------------------------------------- roteamento */}
        <Secao id="roteamento" fundo="faixa2">
          <div className={cn(DUAS_COLUNAS[440], "items-center gap-x-18 gap-y-10")}>
            <div className="flex flex-col gap-4">
              <Cabecalho
                id="roteamento"
                sobretitulo={
                  <p className="inline-flex h-6.5 w-fit items-center rounded-full border border-border-strong bg-surface px-2.5 text-label font-medium text-t1">
                    Módulo opcional
                  </p>
                }
                titulo="Roteamento, para quem usa vitrine"
                descricao="Quem anuncia direto na loja que cobra não precisa dele. Lucro, rastreamento e alertas funcionam sem vitrine."
              />
              <ListaComCheck itens={ROTEAMENTO} className="mt-2 gap-3" />
            </div>
            <DiagramaRota />
          </div>
        </Secao>

        {/* -------------------------------------------------------- preço */}
        <Secao id="preco" fundo="escuro">
          <div className="mx-auto flex max-w-260 flex-col items-center">
            <Cabecalho
              id="preco"
              sobretitulo="Preço"
              titulo="Escolha seu plano"
              className="max-w-160 items-center gap-3 text-center"
            />
            <p className="mt-3 text-center text-base leading-[1.6] text-t2">{GARANTIA.longa}</p>
            <ul className="mt-14 grid w-full max-w-105 grid-cols-1 items-stretch gap-6 min-[820px]:max-w-full min-[820px]:grid-cols-3 min-[820px]:gap-3.5">
              {PLANOS.map((plano) => (
                <CartaoPlano key={plano.id} plano={plano} />
              ))}
            </ul>
            <p className="mt-7 max-w-175 text-center text-label leading-5 text-pretty text-t3">
              {NOTA_DO_PRECO}
            </p>
          </div>
        </Secao>

        {/* ------------------------------------------- prova social (real) */}
        {PROVAS.length > 0 ? (
          <Secao id="quem-usa">
            <Cabecalho id="quem-usa" titulo="Quem usa" />
            <ul className="mt-10 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {PROVAS.map((p) => (
                <li key={p.autor} className="rounded-overlay border border-border bg-surface p-5.5">
                  <figure className="flex flex-col gap-3">
                    <blockquote className="text-[15px] leading-[1.6] text-pretty text-t1">{p.texto}</blockquote>
                    <figcaption className="text-dense text-t2">
                      <span className="font-semibold text-ink">{p.autor}</span>
                      {p.detalhe ? ` · ${p.detalhe}` : null}
                    </figcaption>
                  </figure>
                </li>
              ))}
            </ul>
          </Secao>
        ) : null}

        {/* ---------------------------------------------------- perguntas */}
        <Secao id="perguntas" fundo="faixa">
          <div className={cn(DUAS_COLUNAS[440], "items-start gap-x-18 gap-y-10")}>
            <Cabecalho
              id="perguntas"
              sobretitulo="Perguntas"
              titulo="Perguntas frequentes"
              descricao="O que mais perguntam antes de conectar a primeira loja."
              className="lg:sticky lg:top-24"
            />
            <div className="border-t border-border">
              {PERGUNTAS.map((q, i) => (
                <details key={q.pergunta} open={i === 0} className="group border-b border-border">
                  <summary className="flex min-h-15 cursor-pointer list-none items-center justify-between gap-4 py-4 text-left text-base font-semibold text-ink [&::-webkit-details-marker]:hidden">
                    <span>{q.pergunta}</span>
                    <Plus
                      aria-hidden
                      className="size-4.5 shrink-0 text-t2 transition-transform duration-180 ease-xc group-open:rotate-45"
                      strokeWidth={1.75}
                    />
                  </summary>
                  <p className="pr-10 pb-5 text-[15px] leading-[1.65] text-pretty text-t1">
                    {q.resposta}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </Secao>

        {/* ---------------------------------------------------- cta final */}
        <section
          id="criar-conta"
          aria-labelledby="criar-conta-titulo"
          className="dark scroll-mt-15 border-t border-border bg-surface px-4 py-20 text-center text-ink md:px-6 md:py-32"
        >
          <div className="mx-auto flex w-full max-w-300 flex-col items-center gap-5">
            <h2
              id="criar-conta-titulo"
              className="max-w-[16ch] text-[clamp(34px,5vw,60px)] leading-[1.02] font-semibold tracking-[-0.035em] text-balance text-ink"
            >
              Comece pelo lucro de hoje
            </h2>
            <p className="max-w-[48ch] text-[17px] leading-[1.6] text-pretty text-t2">
              Conecte uma loja Shopify e veja quanto ela lucrou, com o anúncio já descontado.
            </p>
            <a href={URL_CRIAR_CONTA} className={cn(LINK_BOTAO_PRIMARIO, "mt-2 px-7")}>
              Criar conta
            </a>
            <LinhaDoPlano />
          </div>
        </section>
      </main>

      <RodapeSite caixa="landing" />

      {/* Barra do celular: preco e Criar conta sempre a mao. O espaco abaixo
          do rodape existe para a barra nao cobrir o fim da pagina. */}
      <aside
        aria-label="Assinatura"
        className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t border-border bg-surface px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] md:hidden"
      >
        <p className="flex min-w-0 flex-1 flex-col">
          <span className="num truncate text-[15px] font-semibold text-ink">
            A partir de {PRECO_A_PARTIR}/mês
          </span>
          <span className="truncate text-label text-t2">{GARANTIA.curta}</span>
        </p>
        <a href={URL_CRIAR_CONTA} className={cn(LINK_BOTAO_PRIMARIO, "px-4.5")}>
          Criar conta
        </a>
      </aside>
      <div aria-hidden="true" className="dark h-19 bg-bg md:hidden" />
    </div>
  );
}
