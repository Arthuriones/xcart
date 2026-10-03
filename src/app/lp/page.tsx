import type { Metadata } from "next";
import type { ReactNode } from "react";
import {
  Activity,
  Bell,
  Calculator,
  Check,
  CircleDollarSign,
  Download,
  Info,
  Plug,
  Route,
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
  OUTROS_RECURSOS,
  PASSOS,
  PERGUNTAS,
  PROVAS,
  RECURSOS_PRINCIPAIS,
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
import { BENEFICIOS_PRO, PACOTES, POLITICA_TESTE, PRECO_PRO } from "./plano";

/**
 * A landing comercial (raiz do host publico e /lp).
 *
 * Vende primeiro o que o lojista abre o app para ver -- lucro por loja,
 * rastreamento pelo servidor e alertas (decisao 2 do redesign) -- e deixa o
 * roteamento como um modulo, para quem usa vitrine. A versao anterior vendia
 * so o checkout roteado.
 *
 * Server component inteiro; a unica parte no navegador e o menu do celular
 * (e a troca de tema no rodape). O texto mora em conteudo.ts e o plano em
 * plano.ts, ambos esperando a aprovacao do Arthur.
 */

export const metadata: Metadata = {
  title: "xcart · lucro, rastreamento e alertas para lojas Shopify",
  description:
    "Veja o lucro estimado de cada loja Shopify, já descontado o anúncio. Envie as compras ao Meta e ao Google pelo servidor e receba alertas quando algo quebra.",
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
  roteamento: Route,
};

// cn() e obrigatorio: o cva junta "border-transparent" da base com a borda da
// variante sem resolver o conflito, e o contorno do secundario sumia.
const LINK_BOTAO_PRIMARIO = cn(buttonVariants({ variant: "primary", size: "lg" }));
const LINK_BOTAO_SECUNDARIO = cn(buttonVariants({ variant: "secondary", size: "lg" }));

function Secao({
  id,
  titulo,
  descricao,
  faixa,
  children,
}: {
  id: string;
  titulo: string;
  descricao?: string;
  /** Faixa clara de ponta a ponta, para alternar com o fundo da pagina. */
  faixa?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-titulo`}
      className={cn("scroll-mt-16", faixa && "border-y border-border bg-surface")}
    >
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 md:py-20">
        <div className="flex max-w-2xl flex-col gap-2">
          <h2 id={`${id}-titulo`} className="text-kpi text-balance text-ink">
            {titulo}
          </h2>
          {descricao ? <p className="text-body text-pretty text-t2">{descricao}</p> : null}
        </div>
        <div className="mt-10">{children}</div>
      </div>
    </section>
  );
}

function ListaComCheck({ itens }: { itens: readonly string[] }) {
  return (
    <ul className="flex flex-col gap-2.5">
      {itens.map((item) => (
        <li key={item} className="flex gap-2.5 text-body text-pretty text-t1">
          <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-ok" strokeWidth={2} />
          {item}
        </li>
      ))}
    </ul>
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
        <section className="mx-auto grid w-full max-w-6xl gap-10 px-4 pt-12 pb-16 sm:px-6 md:pt-20 md:pb-20 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-center lg:gap-12">
          <div className="flex flex-col items-start gap-5">
            <p className="text-dense font-medium text-t2">Para quem opera lojas Shopify</p>
            <h1 className="text-4xl leading-tight font-semibold tracking-tight text-balance text-ink lg:text-5xl lg:leading-tight">
              Quanto cada loja lucrou hoje, já descontado o anúncio
            </h1>
            <p className="max-w-[46ch] text-overlay leading-7 font-normal text-pretty text-t1">
              O xcart junta os pedidos da Shopify com o gasto do Meta e do Google, envia as
              compras às duas plataformas pelo servidor e avisa quando algo quebra.
            </p>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              <a href={URL_CRIAR_CONTA} className={LINK_BOTAO_PRIMARIO}>
                Criar conta
              </a>
              <a href="#preco" className={LINK_BOTAO_SECUNDARIO}>
                Ver o preço
              </a>
            </div>
            <p className="text-label text-t2">
              <span className="num">{PRECO_PRO}</span> por mês · {POLITICA_TESTE.curta} ·
              Cancele quando quiser
            </p>
          </div>
          <PreviaLucro />
        </section>

        {/* ----------------------------------------------------- recursos */}
        <Secao
          id="recursos"
          faixa
          titulo="Dinheiro e rastreamento no centro"
          descricao="As três telas que você abre todo dia. O resto do xcart existe para elas ficarem certas."
        >
          <div className="flex flex-col gap-16 md:gap-20">
            {RECURSOS_PRINCIPAIS.map((r, i) => {
              const Icone = ICONE_PRINCIPAL[r.id];
              const Ilustracao = ILUSTRACAO[r.id];
              return (
                <article
                  key={r.id}
                  aria-labelledby={`recurso-${r.id}`}
                  className="grid items-center gap-8 lg:grid-cols-2 lg:gap-12"
                >
                  <div className={cn("flex flex-col gap-4", i % 2 === 1 && "lg:order-2")}>
                    <span className="inline-flex items-center gap-2 text-dense font-medium text-t2">
                      <Icone aria-hidden className="size-4" strokeWidth={1.75} />
                      {r.tela}
                    </span>
                    <h3 id={`recurso-${r.id}`} className="text-page text-balance text-ink">
                      {r.titulo}
                    </h3>
                    <p className="text-body leading-6 text-pretty text-t1">{r.resumo}</p>
                    <ListaComCheck itens={r.pontos} />
                  </div>
                  <Ilustracao />
                </article>
              );
            })}
          </div>

          <div className="mt-20 border-t border-border pt-12">
            <h3 className="text-page text-ink">Também no xcart</h3>
            <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {OUTROS_RECURSOS.map((r) => {
                const Icone = ICONE_SECUNDARIO[r.id];
                return (
                  <li
                    key={r.id}
                    className="flex flex-col gap-2 rounded-card border border-border bg-surface-2 p-4"
                  >
                    <Icone aria-hidden className="size-5 text-t2" strokeWidth={1.75} />
                    <span className="text-section text-ink">{r.titulo}</span>
                    <p className="text-dense text-pretty text-t2">{r.texto}</p>
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

        {/* ------------------------------------------------- como começar */}
        <Secao
          id="como-comecar"
          titulo="Como começar"
          descricao="Quatro passos até o primeiro lucro na tela. O app guia cada um."
        >
          <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {PASSOS.map((p, i) => (
              <li
                key={p.titulo}
                className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4"
              >
                <span
                  aria-hidden="true"
                  className="num flex size-7 items-center justify-center rounded-full border border-border-strong text-dense font-semibold text-ink"
                >
                  {i + 1}
                </span>
                <span className="text-section text-ink">{p.titulo}</span>
                <p className="text-dense text-pretty text-t2">{p.texto}</p>
              </li>
            ))}
          </ol>
        </Secao>

        {/* --------------------------------------------------- roteamento */}
        <Secao
          id="roteamento"
          faixa
          titulo="Roteamento, para quem usa vitrine"
          descricao="Um módulo opcional. Quem anuncia direto na loja que cobra não precisa dele."
        >
          <div className="grid items-center gap-8 lg:grid-cols-2 lg:gap-12">
            <ListaComCheck
              itens={[
                "A vitrine recebe o tráfego do anúncio. No checkout, o carrinho vai para a loja que cobra, casado pelo SKU.",
                "Rodízio entre várias lojas de checkout: se uma conta de pagamento cair, as outras continuam vendendo.",
                "O sorteio só acontece entre lojas que cobrem o carrinho inteiro. Nenhum item fica para trás.",
                "A loja de checkout recebe o catálogo com texto e fotos sem marca, refeitos por IA.",
                "De hora em hora o xcart confere a rota e conserta o SKU que ficou sem par.",
              ]}
            />
            <DiagramaRota />
          </div>
        </Secao>

        {/* -------------------------------------------------------- preço */}
        <Secao
          id="preco"
          titulo="Um plano, tudo liberado"
          descricao="Pague a mais só se precisar de mais fotos refeitas por IA."
        >
          <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div className="flex flex-col gap-5 rounded-card border border-border-strong bg-surface p-5 sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-section text-ink">Pro</h3>
                <Badge variant="neutral">Plano único</Badge>
              </div>
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="num text-kpi text-ink">{PRECO_PRO}</span>
                <span className="text-body text-t2">por mês</span>
              </p>
              <ListaComCheck itens={BENEFICIOS_PRO} />
              <a href={URL_CRIAR_CONTA} className={cn(LINK_BOTAO_PRIMARIO, "w-full")}>
                Criar conta e assinar
              </a>
              <div className="flex flex-col gap-2 border-t border-border-subtle pt-4 text-dense text-t2">
                <p>Cartão de crédito, que renova todo mês, ou Pix, que libera 30 dias.</p>
                <p className="flex gap-2 text-t1">
                  <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-info" strokeWidth={1.75} />
                  {POLITICA_TESTE.longa}
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-4 rounded-card border border-border bg-surface p-5 sm:p-6">
              <h3 className="text-section text-ink">Créditos extras</h3>
              <p className="text-dense text-pretty text-t2">
                Cada crédito refaz com IA a foto de um produto, sem a marca. Compra avulsa por
                Pix, que não expira.
              </p>
              <table className="w-full text-dense">
                <caption className="sr-only">Pacotes de créditos e preços</caption>
                <thead>
                  <tr className="border-b border-border text-label text-t2">
                    <th scope="col" className="py-2 text-left font-medium">
                      Pacote
                    </th>
                    <th scope="col" className="py-2 text-right font-medium">
                      Preço
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {PACOTES.map((p) => (
                    <tr key={p.id}>
                      <th scope="row" className="py-3 text-left font-normal text-ink">
                        {p.rotulo}
                      </th>
                      <td className="num py-3 text-right text-ink">{p.preco}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-auto text-label text-t2">
                A compra é feita dentro do app, na tela de assinatura.
              </p>
            </div>
          </div>
        </Secao>

        {/* ------------------------------------------- prova social (real) */}
        {PROVAS.length > 0 ? (
          <Secao id="quem-usa" faixa titulo="Quem usa">
            <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {PROVAS.map((p) => (
                <li key={p.autor} className="rounded-card border border-border bg-surface-2 p-5">
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
        <Secao id="perguntas" faixa={PROVAS.length === 0} titulo="Perguntas frequentes">
          <dl className="grid gap-x-12 gap-y-8 md:grid-cols-2">
            {PERGUNTAS.map((q) => (
              <div key={q.pergunta} className="flex flex-col gap-2">
                <dt className="text-section text-ink">{q.pergunta}</dt>
                <dd className="text-body leading-6 text-pretty text-t1">{q.resposta}</dd>
              </div>
            ))}
          </dl>
        </Secao>

        {/* ---------------------------------------------------- cta final */}
        <section
          aria-labelledby="final-titulo"
          className="mx-auto flex w-full max-w-6xl flex-col items-center gap-4 px-4 py-16 text-center sm:px-6 md:py-20"
        >
          <h2 id="final-titulo" className="text-kpi text-balance text-ink">
            Comece pelo lucro de hoje
          </h2>
          <p className="max-w-[52ch] text-body text-pretty text-t2">
            Conecte uma loja Shopify e veja quanto ela lucrou, com o anúncio já descontado.
          </p>
          <a href={URL_CRIAR_CONTA} className={cn(LINK_BOTAO_PRIMARIO, "mt-2")}>
            Criar conta
          </a>
        </section>
      </main>

      <RodapeSite />
    </div>
  );
}
