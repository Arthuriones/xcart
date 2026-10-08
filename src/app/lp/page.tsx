import type { Metadata } from "next";
import type { ReactNode } from "react";
import {
  Activity,
  Bell,
  Calculator,
  Check,
  CircleDollarSign,
  Download,
  Minus,
  Plug,
  Plus,
  Route,
  Smartphone,
  Store,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
  PreviaLucro,
  PreviaRastreamento,
} from "./ilustracoes";
import { GARANTIA, PACOTES, PLANOS, PRECO_A_PARTIR } from "./plano";

/**
 * A landing comercial (raiz do host publico e /lp), no design v2
 * ("design novo/2.0/Landing xcart v2").
 *
 * Vende primeiro o que o lojista abre o app para ver -- lucro por loja,
 * rastreamento e alertas (decisao 2 do redesign) -- e deixa o roteamento como
 * um modulo, para quem usa vitrine.
 *
 * As faixas escuras (roteamento, cartao do plano e chamada final) nao tem cor
 * propria: levam a classe `dark`, que redefine a paleta do app so dentro
 * delas. Os mesmos tokens (bg-surface, text-ink, text-t2...) pintam o claro e
 * o escuro, e o tema escuro do site continua funcionando.
 *
 * Server component inteiro; a unica parte no navegador e o menu do celular
 * (e a troca de tema no rodape). As perguntas abrem com <details>, sem
 * JavaScript. O texto mora em conteudo.ts e o plano em plano.ts.
 */

export const metadata: Metadata = {
  title: "xcart · lucro, rastreamento e alertas para lojas Shopify",
  description:
    "Veja o lucro estimado de cada loja Shopify, já descontado o anúncio. Entregue as compras ao Meta, ao TikTok e ao Google e receba alertas quando algo quebra.",
};

const ICONE_PRINCIPAL: Record<RecursoPrincipal["id"], LucideIcon> = {
  lucro: CircleDollarSign,
  rastreamento: Activity,
  alertas: Bell,
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
const SOBRETITULO = "font-mono text-dense text-t2";
const TITULO_SECAO =
  "text-[clamp(30px,4vw,46px)] leading-[1.08] font-semibold tracking-[-0.025em] text-balance text-ink";

const FUNDO = {
  /** O fundo da pagina. */
  pagina: "",
  /** Faixa clara de ponta a ponta, para alternar com o fundo da pagina. */
  faixa: "border-y border-border bg-surface",
  /** Faixa escura: a paleta escura do app, so aqui dentro. */
  escuro: "dark border-y border-border bg-surface text-ink",
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
      className={cn("scroll-mt-16 px-4 py-16 sm:px-6 md:py-28", FUNDO[fundo], className)}
    >
      <div className="mx-auto w-full max-w-6xl">{children}</div>
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
    <div className={cn("flex max-w-180 flex-col gap-3.5", className)}>
      {typeof sobretitulo === "string" ? (
        <p className={SOBRETITULO}>{sobretitulo}</p>
      ) : (
        sobretitulo
      )}
      <h2 id={`${id}-titulo`} className={TITULO_SECAO}>
        {titulo}
      </h2>
      {descricao ? (
        <p className="text-[17px] leading-relaxed text-pretty text-t1">{descricao}</p>
      ) : null}
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

/** Preco, teste e cancelamento numa linha (hero e chamada final). */
function LinhaDoPlano({ className }: { className?: string }) {
  return (
    <p className={cn("flex flex-wrap gap-x-3.5 gap-y-1.5 text-dense text-t2", className)}>
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

export default function Landing() {
  return (
    <div className="flex min-h-screen flex-col bg-bg text-ink">
      <a
        href="#conteudo"
        className="sr-only z-50 rounded-control bg-surface px-3 py-2 text-dense text-ink focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Pular para o conteúdo
      </a>
      <CabecalhoSite />

      <main id="conteudo" className="flex-1">
        {/* --------------------------------------------------------- hero */}
        <section aria-labelledby="hero-titulo" className="px-4 pt-12 pb-14 sm:px-6 md:pt-24 md:pb-24">
          <div className="mx-auto grid w-full max-w-6xl items-center gap-10 lg:grid-cols-2 lg:gap-16">
            <div className="flex flex-col items-start gap-6">
              <p className="inline-flex h-7 items-center gap-2 rounded-full border border-border bg-surface px-3 text-label font-medium text-t1">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-ok" />
                Para quem opera lojas Shopify
              </p>
              <h1
                id="hero-titulo"
                className="text-[clamp(40px,6vw,66px)] leading-[1.02] font-semibold tracking-[-0.035em] text-balance text-ink"
              >
                Quanto cada loja lucrou hoje.{" "}
                <span className="text-t3">Já descontado o anúncio.</span>
              </h1>
              <p className="max-w-[46ch] text-base leading-relaxed text-pretty text-t1 md:text-lg">
                O xcart cruza os pedidos da Shopify com o gasto do Meta e do Google, entrega cada
                compra ao Meta, ao TikTok e ao Google e avisa no Telegram quando algo quebra.
              </p>
              <div className="flex w-full max-w-105 flex-wrap gap-2">
                <a href={URL_CRIAR_CONTA} className={cn(LINK_BOTAO_PRIMARIO, "flex-[1_1_160px]")}>
                  Criar conta
                </a>
                <a href="#preco" className={cn(LINK_BOTAO_SECUNDARIO, "flex-[1_1_160px]")}>
                  Ver o preço
                </a>
              </div>
              <LinhaDoPlano />
            </div>
            <PreviaLucro />
          </div>
        </section>

        {/* ------------------------------------------------- conecta com */}
        <section aria-labelledby="conecta-com" className="border-t border-border px-4 py-5 sm:px-6">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-7 gap-y-3">
            <p id="conecta-com" className={SOBRETITULO}>
              Conecta com
            </p>
            <ul className="flex flex-wrap gap-x-7 gap-y-2 text-base font-semibold tracking-[-0.01em] text-t1">
              {CONECTA_COM.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        </section>

        {/* ---------------------------------------------------- problema */}
        <Secao id="por-que" fundo="faixa">
          <Cabecalho
            id="por-que"
            sobretitulo="Por que o xcart existe"
            titulo="Cada painel mostra um pedaço da conta"
            descricao="A Shopify sabe o que vendeu. O Meta e o Google sabem o que gastaram. Nenhum deles junta as duas pontas com o custo do produto, e o pixel do navegador ainda deixa compras pelo caminho."
          />
          <ul className="mt-8 grid border-t border-ink md:mt-14 md:grid-cols-3">
            {PROBLEMAS.map((p) => (
              <li key={p.origem} className="flex flex-col gap-2.5 pt-6 pb-2 md:pr-6">
                <p className={SOBRETITULO}>{p.origem}</p>
                <h3 className="text-xl leading-snug font-semibold tracking-[-0.01em] text-ink">
                  {p.titulo}
                </h3>
                <p className="text-[15px] leading-relaxed text-pretty text-t1">{p.texto}</p>
              </li>
            ))}
          </ul>
          <p className="mt-8 max-w-[38ch] text-[clamp(20px,2.4vw,26px)] leading-[1.35] font-medium tracking-[-0.015em] text-balance text-ink md:mt-14">
            {PROBLEMA_FECHO}
          </p>
        </Secao>

        {/* ----------------------------------------------------- recursos */}
        <Secao id="recursos">
          <Cabecalho
            id="recursos"
            sobretitulo="Dinheiro e rastreamento no centro"
            titulo="As três telas que você abre todo dia"
            descricao="Lucro, Rastreamento e Alertas. O resto do xcart existe para elas ficarem certas."
          />

          <div className="mt-12 flex flex-col gap-16 md:mt-18 md:gap-26">
            {RECURSOS_PRINCIPAIS.map((r, i) => {
              const Icone = ICONE_PRINCIPAL[r.id];
              const Ilustracao = ILUSTRACAO[r.id];
              return (
                <article
                  key={r.id}
                  aria-labelledby={`recurso-${r.id}`}
                  className="grid items-center gap-8 lg:grid-cols-2 lg:gap-16"
                >
                  <div className={cn("flex flex-col gap-4", i % 2 === 1 && "lg:order-2")}>
                    <p className="inline-flex items-center gap-2.5 text-dense font-medium text-t2">
                      <span className="font-mono text-ink">{String(i + 1).padStart(2, "0")}</span>
                      <span aria-hidden="true" className="h-px w-6 bg-border-strong" />
                      <Icone aria-hidden className="size-4" strokeWidth={1.75} />
                      {r.tela}
                    </p>
                    <h3
                      id={`recurso-${r.id}`}
                      className="text-[clamp(24px,2.8vw,32px)] leading-[1.15] font-semibold tracking-[-0.02em] text-balance text-ink"
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

          <div className="mt-18 border-t border-border pt-10 md:mt-28">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
              <h3 className="text-page text-ink">Também no xcart</h3>
              <p className="text-body text-t2">Incluído no plano.</p>
            </div>
            <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {OUTROS_RECURSOS.map((r) => {
                const Icone = ICONE_SECUNDARIO[r.id];
                return (
                  <li
                    key={r.id}
                    className="flex flex-col gap-2.5 rounded-card border border-border bg-surface p-5"
                  >
                    <Icone aria-hidden className="size-5 text-t2" strokeWidth={1.75} />
                    <span className="text-section text-ink">{r.titulo}</span>
                    <p className="text-dense leading-normal text-pretty text-t2">{r.texto}</p>
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
        <Secao id="comparar" className="pt-0 md:pt-0">
          <div className="grid items-start gap-8 lg:grid-cols-2 lg:gap-16">
            <Cabecalho
              id="comparar"
              sobretitulo="Mais que um painel"
              titulo="Mostrar o lucro é o começo"
              descricao="Um painel diz quanto você ganhou. O xcart também garante que a compra chegou à plataforma de anúncio e avisa quando alguma coisa para."
            />
            <div className="overflow-hidden rounded-overlay border border-border bg-surface">
              <table className="w-full text-body">
                <caption className="sr-only">Um painel de lucro comum comparado ao xcart</caption>
                <thead className="border-b border-border bg-surface-2 text-label text-t2">
                  <tr>
                    <th scope="col" className="px-4 py-3.5 text-left font-medium sm:px-5">
                      <span className="sr-only">Recurso</span>
                    </th>
                    <th
                      scope="col"
                      className="w-18 px-1 py-3.5 text-center align-bottom font-medium sm:w-24"
                    >
                      Painel de lucro
                    </th>
                    <th
                      scope="col"
                      className="w-18 px-1 py-3.5 text-center align-bottom font-semibold text-ink sm:w-24"
                    >
                      xcart
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {COMPARACAO.map((l) => (
                    <tr key={l.item}>
                      <th
                        scope="row"
                        className="px-4 py-3.5 text-left leading-[1.45] font-normal text-ink sm:px-5"
                      >
                        {l.item}
                      </th>
                      <td className="px-1 py-3.5 text-center">
                        <Marca sim={l.painel} />
                      </td>
                      <td className="px-1 py-3.5 text-center">
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
        <Secao id="como-comecar" fundo="faixa">
          <Cabecalho
            id="como-comecar"
            sobretitulo="Como começar"
            titulo="Quatro passos até o primeiro lucro na tela"
            descricao="O app guia cada um. Ninguém precisa mexer em código."
          />
          <ol className="mt-10 grid gap-6 sm:grid-cols-2 md:mt-14 lg:grid-cols-4 lg:gap-8">
            {PASSOS.map((p, i) => (
              <li key={p.titulo} className="flex flex-col gap-2.5 border-t-2 border-ink pt-5">
                <span className="font-mono text-dense font-medium text-ink">Passo {i + 1}</span>
                <span className="text-lg leading-snug font-semibold tracking-[-0.01em] text-ink">
                  {p.titulo}
                </span>
                <p className="text-body leading-relaxed text-pretty text-t2">{p.texto}</p>
              </li>
            ))}
          </ol>
        </Secao>

        {/* --------------------------------------------------- roteamento */}
        <Secao id="roteamento" fundo="escuro">
          <Cabecalho
            id="roteamento"
            sobretitulo={
              <p className="inline-flex h-6.5 w-fit items-center rounded-full border border-border-strong px-2.5 text-label font-medium text-t1">
                Módulo opcional
              </p>
            }
            titulo="Roteamento, para quem usa vitrine"
            descricao="Quem anuncia direto na loja que cobra não precisa dele. Lucro, rastreamento e alertas funcionam sem vitrine."
          />
          <div className="mt-10 grid items-center gap-10 md:mt-14 lg:grid-cols-2 lg:gap-16">
            <ListaComCheck itens={ROTEAMENTO} className="gap-3.5" />
            <DiagramaRota />
          </div>
        </Secao>

        {/* -------------------------------------------------------- preço */}
        <Secao id="preco">
          <Cabecalho id="preco" sobretitulo="Preço" titulo="Escolha seu plano" descricao={GARANTIA.longa} />
          <ul className="mt-10 grid gap-4 md:mt-14 lg:grid-cols-3">
            {PLANOS.map((plano) => (
              <li
                key={plano.id}
                className={cn(
                  "flex flex-col gap-5 rounded-overlay border p-6 sm:p-8",
                  plano.destaque ? "dark border-border-strong bg-surface text-ink" : "border-border bg-surface"
                )}
              >
                <div className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-lg font-semibold text-ink">{plano.nome}</h3>
                    {plano.selo ? <Badge variant="neutral">{plano.selo}</Badge> : null}
                  </div>
                  <p className="text-dense text-t2">{plano.subtitulo}</p>
                </div>
                <p className="flex flex-wrap items-baseline gap-x-1.5">
                  <span className="text-base font-semibold text-t2">R$</span>
                  <span className="num text-[clamp(40px,4.5vw,48px)] leading-none font-semibold tracking-[-0.03em] text-ink">
                    {plano.valor}
                  </span>
                  <span aria-hidden="true" className="text-[15px] text-t2">
                    / mês
                  </span>
                  <span className="sr-only">por mês</span>
                </p>
                <a
                  // O cadastro guarda o plano: a escolha de plano do app ja abre nele.
                  href={`${URL_CRIAR_CONTA}&plano=${plano.id}`}
                  className={cn(plano.destaque ? LINK_BOTAO_PRIMARIO : LINK_BOTAO_SECUNDARIO, "w-full")}
                >
                  Escolher plano
                  <span className="sr-only"> {plano.nome}</span>
                </a>
                <ListaComCheck itens={plano.itens} className="border-t border-border pt-5" />
              </li>
            ))}
          </ul>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-x-8 gap-y-4 rounded-overlay border border-border bg-surface px-5 py-5 sm:px-8">
            <div className="flex max-w-[52ch] flex-col gap-1">
              <h3 className="text-section text-ink">Créditos extras</h3>
              <p className="text-dense leading-normal text-pretty text-t2">
                Cada crédito refaz com IA a foto de um produto, sem a marca. Compra avulsa por Pix,
                dentro do app, na tela de assinatura; os créditos somam ao saldo.
              </p>
            </div>
            <ul aria-label="Pacotes de créditos" className="num flex flex-wrap gap-x-6 gap-y-2 text-body">
              {PACOTES.map((p) => (
                <li key={p.id}>
                  <span className="text-t2">{p.rotulo}</span>{" "}
                  <strong className="font-semibold text-ink">{p.preco}</strong>
                </li>
              ))}
            </ul>
          </div>
        </Secao>

        {/* ------------------------------------------- prova social (real) */}
        {PROVAS.length > 0 ? (
          <Secao id="quem-usa">
            <Cabecalho id="quem-usa" titulo="Quem usa" />
            <ul className="mt-10 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {PROVAS.map((p) => (
                <li key={p.autor} className="rounded-card border border-border bg-surface p-5">
                  <figure className="flex flex-col gap-3">
                    <blockquote className="text-body text-pretty text-t1">{p.texto}</blockquote>
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
        <Secao id="perguntas" fundo="faixa" className="border-b-0">
          <div className="grid items-start gap-8 lg:grid-cols-2 lg:gap-16">
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
          className="dark scroll-mt-16 border-t border-border bg-surface px-4 py-18 text-ink sm:px-6 md:py-32"
        >
          <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-5 text-center">
            <h2
              id="criar-conta-titulo"
              className="max-w-[16ch] text-[clamp(34px,5vw,58px)] leading-[1.04] font-semibold tracking-[-0.03em] text-balance text-ink"
            >
              Comece pelo lucro de hoje
            </h2>
            <p className="max-w-[48ch] text-[17px] leading-relaxed text-pretty text-t2">
              Conecte uma loja Shopify e veja quanto ela lucrou, com o anúncio já descontado.
            </p>
            <a href={URL_CRIAR_CONTA} className={cn(LINK_BOTAO_PRIMARIO, "mt-2 px-7")}>
              Criar conta
            </a>
            <LinhaDoPlano className="justify-center" />
          </div>
        </section>
      </main>

      <RodapeSite />

      {/* Barra do celular: preco e Criar conta sempre a mao. O espaco abaixo
          do rodape existe para a barra nao cobrir o fim da pagina. */}
      <aside
        aria-label="Assinatura"
        className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t border-border bg-surface px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] md:hidden"
      >
        <p className="flex min-w-0 flex-1 flex-col">
          <span className="num truncate text-[15px] font-semibold text-ink">A partir de {PRECO_A_PARTIR}/mês</span>
          <span className="truncate text-label text-t2">{GARANTIA.curta}</span>
        </p>
        <a href={URL_CRIAR_CONTA} className={LINK_BOTAO_PRIMARIO}>
          Criar conta
        </a>
      </aside>
      <div aria-hidden="true" className="dark h-19 bg-bg md:hidden" />
    </div>
  );
}
