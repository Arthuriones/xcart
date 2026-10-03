import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  CircleCheck,
  CreditCard,
  Info,
  OctagonAlert,
  Shuffle,
  Store,
  TriangleAlert,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { cn } from "@/components/ui/cn";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiCard } from "@/components/ui/kpi-card";
import { Section } from "@/components/ui/section";
import { STATUS, StatusBadge, type TomStatus } from "@/components/ui/status-badge";
import { horaNoFuso, rotuloFuso } from "@/components/layout/contexto";
import { FUSO_RELATORIO_PADRAO } from "@/lib/financeiro/tipos";
import { DIAS_CARRINHOS, type DetalheRota, type RotaDaLista } from "@/lib/leitura/visao-rota";
import {
  CONSOLE,
  ROTULO_ESTRATEGIA,
  contarProblemas,
  destinosNaTela,
  eventoNaTela,
  nomeDaRota,
  plural,
  problemasDaRota,
  produtosLigados,
  quandoTexto,
  textoSinal,
  type DestinoNaTela,
  type EstadoDestino,
  type TomProblema,
} from "./apresentar";
import { Atualizar, TentarDeNovo } from "./estados";
import { SeletorRota } from "./seletor-rota";

// ============================================================================
// A Visao da rota montada no servidor: rota escolhida, 4 numeros, o que
// requer atencao, o caminho do comprador (vitrine -> rodizio -> lojas de
// checkout) e a atividade do script. So o seletor de rota e os botoes de
// "Atualizar" / "Tentar de novo" sao de cliente.
// ============================================================================

const SELO_DESTINO: Record<EstadoDestino, { tom: TomStatus; texto: string }> = {
  ok: STATUS.rota.ativa,
  paused: STATUS.rota.pausada,
  attention: STATUS.rota.atencao,
};

const SELO_PROBLEMA: Record<TomProblema, { tom: TomStatus; texto: string }> = {
  err: STATUS.alerta.critico,
  warn: STATUS.alerta.aviso,
  info: { tom: "info", texto: "Informação" },
};

const ICONE = { err: OctagonAlert, warn: TriangleAlert, info: Info, ok: CircleCheck } as const;
const CAIXA_ICONE = {
  err: "border-err-border bg-err-bg text-err",
  warn: "border-warn-border bg-warn-bg text-warn",
  info: "border-info-border bg-info-bg text-info",
  ok: "border-ok-border bg-ok-bg text-ok",
} as const;

const LINK_NOME =
  "rounded-sm text-dense font-semibold text-ink wrap-anywhere hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

function inteiro(n: number): string {
  return n.toLocaleString("pt-BR");
}

function IconeTom({ tom }: { tom: keyof typeof ICONE }) {
  const Icone = ICONE[tom];
  return (
    <span
      aria-hidden
      className={cn("grid size-8 shrink-0 place-items-center rounded-control border", CAIXA_ICONE[tom])}
    >
      <Icone className="size-4" strokeWidth={1.75} />
    </span>
  );
}

export function TelaVisao({
  rotas,
  rota,
  detalhe,
}: {
  rotas: RotaDaLista[];
  rota: RotaDaLista;
  detalhe: DetalheRota;
}) {
  const { agora } = detalhe;
  const destinos = destinosNaTela(detalhe.destinos, rota.ativa);
  const problemas = problemasDaRota({ rota, destinos, falhas: detalhe.falhas, agora });
  const nProblemas = contarProblemas(problemas);
  const temCritico = problemas.some((p) => p.tom === "err");
  const cobrando = destinos.filter((d) => d.estado === "ok").length;
  const produtos = produtosLigados(destinos);
  const eventos = detalhe.eventos?.map((ev) => eventoNaTela(ev, destinos)) ?? null;

  const seloRota = !rota.ativa ? STATUS.rota.pausada : nProblemas > 0 ? STATUS.rota.atencao : STATUS.rota.ativa;
  const hora = horaNoFuso(agora, FUSO_RELATORIO_PADRAO);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex w-full min-w-0 flex-col gap-1 sm:w-80">
          <span className="flex items-center gap-2">
            <span id="seletor-rota-rotulo" className="text-label font-medium text-t1">
              Rota
            </span>
            <StatusBadge {...seloRota} />
          </span>
          {rotas.length > 1 ? (
            <SeletorRota
              rotuloId="seletor-rota-rotulo"
              atual={rota.id}
              rotas={rotas.map((r) => ({
                id: r.id,
                rotulo: nomeDaRota(r),
                estado: r.ativa ? "Ativa" : "Pausada",
              }))}
            />
          ) : (
            <span className="text-section text-ink wrap-anywhere">{nomeDaRota(rota)}</span>
          )}
        </div>
        <Atualizar texto={`Atualizado às ${hora} (${rotuloFuso(FUSO_RELATORIO_PADRAO)})`} />
      </div>

      {detalhe.erros.length > 0 ? (
        <Callout tom="warn" titulo="Parte dos números não veio agora" acao={<TentarDeNovo />}>
          <p>A rota e as lojas estão certas. Onde falta o número aparece “—”, nunca zero.</p>
          <details className="mt-1 text-label text-t1">
            <summary className="cursor-pointer">Detalhes para o suporte</summary>
            <p className="mt-1 break-words font-mono">{detalhe.erros.join(" · ")}</p>
          </details>
        </Callout>
      ) : null}

      <section aria-label="Números da rota" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          rotulo="Lojas na rota"
          valor={inteiro((rota.vitrine ? 1 : 0) + destinos.length)}
          detalhe={`${rota.vitrine ? "1 vitrine" : "Vitrine removida"} · ${plural(
            destinos.length,
            "de checkout",
            "de checkout"
          )}`}
        />
        <KpiCard
          rotulo="Lojas cobrando"
          valor={`${inteiro(cobrando)} de ${inteiro(destinos.length)}`}
          detalhe={rota.ativa ? "Recebem comprador agora" : "Rota pausada"}
          definicao="Loja de checkout ligada, com fatia do tráfego e produtos ligados por SKU. É nela que o pagamento acontece."
        />
        <KpiCard
          rotulo="Produtos ligados por SKU"
          valor={produtos.valor === null ? null : inteiro(produtos.valor)}
          motivoSemDado="Nenhuma loja de checkout"
          detalhe={
            produtos.valor === null
              ? undefined
              : produtos.menor !== null
                ? `De ${inteiro(produtos.menor)} a ${inteiro(produtos.valor)} entre as lojas`
                : destinos.length > 1
                  ? "O mesmo em todas as lojas"
                  : "Na loja de checkout"
          }
          definicao="Produtos da vitrine com par na loja de checkout, casados pelo SKU. Produto sem par sai sem rota."
        />
        <KpiCard
          rotulo="Problemas"
          valor={inteiro(nProblemas)}
          estado={
            nProblemas > 0
              ? { tom: temCritico ? "err" : "warn", texto: "Requer ação" }
              : detalhe.falhas === null
                ? { tom: "warn", texto: "Parcial" }
                : { tom: "ok", texto: "Tudo certo" }
          }
          detalhe={
            detalhe.falhas === null
              ? "Sem a contagem de falhas, que não veio agora"
              : nProblemas > 0
                ? "O que fazer está logo abaixo"
                : "Nada pedindo ação nesta rota"
          }
          href={nProblemas > 0 ? "#requer-atencao" : undefined}
        />
      </section>

      {problemas.length > 0 ? (
        <Section
          id="requer-atencao"
          className="scroll-mt-32"
          titulo="Requer atenção"
          descricao="Do mais grave para o informativo. Cada item leva ao lugar que resolve."
          espaco="nenhum"
        >
          <ul className="flex flex-col">
            {problemas.map((p, i) => (
              <li
                key={p.id}
                className={cn("flex flex-wrap items-start gap-3 px-4 py-3.5", i > 0 && "border-t border-border-subtle")}
              >
                <IconeTom tom={p.tom} />
                <div className="flex min-w-0 flex-1 basis-60 flex-col gap-1">
                  <StatusBadge {...SELO_PROBLEMA[p.tom]} />
                  <p className="text-dense font-semibold text-ink wrap-anywhere">{p.titulo}</p>
                  <p className="text-dense text-t1 text-pretty">{p.detalhe}</p>
                  {p.suporte ? (
                    <details className="text-label text-t2">
                      <summary className="cursor-pointer">Detalhes para o suporte</summary>
                      <p className="mt-1 break-words font-mono">{p.suporte}</p>
                    </details>
                  ) : null}
                </div>
                <Link
                  href={p.acao.href}
                  className={cn(
                    buttonVariants({ variant: "secondary", size: "sm" }),
                    "h-ctl-lg w-full sm:h-ctl-sm sm:w-auto"
                  )}
                >
                  {p.acao.rotulo}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section
        titulo="Caminho do comprador"
        descricao={`Da vitrine, o xcart leva o carrinho para uma loja de checkout pela divisão do rodízio. Carrinhos dos últimos ${DIAS_CARRINHOS} dias.`}
        acoes={
          <Link
            href="/sales"
            className={cn(buttonVariants({ variant: "link", size: "sm" }), "min-h-ctl-lg sm:min-h-0")}
          >
            Receita de cada loja em Vendas
          </Link>
        }
      >
        <div className="grid items-start gap-2 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,2fr)] lg:gap-3">
          <NoVitrine rota={rota} texto={textoSinal(detalhe.sinal, agora)} />
          <Seta />
          <NoRodizio rota={rota} carrinhos={detalhe.carrinhos} destinos={destinos} />
          <Seta />
          <ListaCheckout destinos={destinos} />
        </div>
      </Section>

      <Section
        titulo="Atividade recente"
        descricao="Os últimos eventos do script na vitrine desta rota."
        acoes={
          <Link href="/activity" className={buttonVariants({ variant: "secondary", size: "sm" })}>
            Ver tudo
          </Link>
        }
        espaco="nenhum"
      >
        {eventos === null ? (
          <EmptyState
            role="alert"
            variante="simples"
            titulo="Não deu para ler a atividade agora"
            descricao="Os eventos continuam sendo gravados. Tente de novo em instantes."
            acao={<TentarDeNovo />}
            className="min-h-40"
          />
        ) : eventos.length === 0 ? (
          <EmptyState
            variante="simples"
            titulo="Nenhum carrinho passou pela rota ainda"
            descricao="Os eventos aparecem quando um comprador finaliza a compra na vitrine."
            className="min-h-40"
          />
        ) : (
          <ul className="flex flex-col">
            {eventos.map((ev, i) => (
              <li
                key={ev.id}
                className={cn("flex flex-wrap items-start gap-3 px-4 py-3", i > 0 && "border-t border-border-subtle")}
              >
                <IconeTom tom={ev.tom} />
                <div className="flex min-w-0 flex-1 basis-56 flex-col gap-0.5">
                  <p className="text-dense font-medium text-ink">{ev.rotulo}</p>
                  {ev.descricao ? <p className="text-dense text-t1 wrap-anywhere">{ev.descricao}</p> : null}
                  <p className="num text-label text-t2">{quandoTexto(ev.em, agora)}</p>
                </div>
                {ev.tom !== "ok" ? (
                  <Link
                    href={CONSOLE}
                    className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-ctl-lg sm:h-ctl-sm")}
                  >
                    Ver o diagnóstico
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function Seta() {
  return (
    <div aria-hidden className="grid place-items-center text-t3 lg:pt-10">
      <ArrowDown className="size-4 lg:hidden" strokeWidth={1.75} />
      <ArrowRight className="hidden size-4 lg:block" strokeWidth={1.75} />
    </div>
  );
}

function Rotulo({ icone: Icone, children }: { icone: typeof Store; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 text-label font-medium text-t2">
      <Icone aria-hidden className="size-3.5" strokeWidth={1.75} />
      {children}
    </span>
  );
}

function NoVitrine({ rota, texto }: { rota: RotaDaLista; texto: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-card border border-border bg-surface-2 p-3">
      <Rotulo icone={Store}>Vitrine</Rotulo>
      {rota.vitrine ? (
        <>
          <Link href={`/stores/${rota.vitrine.id}`} className={LINK_NOME}>
            {rota.vitrine.nome}
          </Link>
          <span className="font-mono text-label text-t2 wrap-anywhere">{rota.vitrine.dominio}</span>
        </>
      ) : (
        <span className="text-dense text-t1">Loja removida do xcart</span>
      )}
      <span className="mt-1 text-label text-t2">{texto}</span>
    </div>
  );
}

function NoRodizio({
  rota,
  carrinhos,
  destinos,
}: {
  rota: RotaDaLista;
  carrinhos: number | null;
  destinos: DestinoNaTela[];
}) {
  // Script antigo grava o carrinho sem dizer a loja: a diferenca aparece
  // escrita, para a soma das lojas nao parecer errada.
  const somaLojas = destinos.reduce((s, d) => s + (d.carrinhos ?? 0), 0);
  const semLoja =
    carrinhos !== null && destinos.every((d) => d.carrinhos !== null) ? Math.max(0, carrinhos - somaLojas) : 0;
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-card border border-dashed border-border-strong bg-surface p-3">
      <Rotulo icone={Shuffle}>Rodízio do xcart</Rotulo>
      <span className="text-dense font-semibold text-ink">
        {rota.ativa ? ROTULO_ESTRATEGIA[rota.estrategia] : "Pausado: ninguém é levado"}
      </span>
      <span className="num text-label text-t1">
        {carrinhos === null
          ? "Carrinhos roteados: —"
          : `${plural(carrinhos, "carrinho roteado", "carrinhos roteados")} em ${DIAS_CARRINHOS} dias`}
      </span>
      {semLoja > 0 ? (
        <span className="num text-label text-t2">
          {semLoja === 1 ? "1 deles sem a loja registrada" : `${inteiro(semLoja)} deles sem a loja registrada`}
        </span>
      ) : null}
    </div>
  );
}

function ListaCheckout({ destinos }: { destinos: DestinoNaTela[] }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Rotulo icone={CreditCard}>Lojas de checkout</Rotulo>
      {destinos.length === 0 ? (
        <EmptyState
          variante="tracejado"
          titulo="Nenhuma loja de checkout"
          descricao="Ligue uma loja à rota no console."
          className="min-h-28 py-4"
        />
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Lojas de checkout da rota">
          {destinos.map((d) => (
            <li key={d.id} className="flex flex-col gap-2 rounded-card border border-border bg-surface p-3">
              <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                <div className="flex min-w-0 flex-1 basis-40 flex-col">
                  {d.loja ? (
                    <Link href={`/stores/${d.lojaId}`} className={LINK_NOME}>
                      {d.nome}
                    </Link>
                  ) : (
                    <span className="text-dense font-semibold text-ink">{d.nome}</span>
                  )}
                  {d.dominio ? (
                    <span className="font-mono text-label text-t2 wrap-anywhere">{d.dominio}</span>
                  ) : null}
                </div>
                <StatusBadge {...SELO_DESTINO[d.estado]} />
              </div>
              <div className="flex items-center gap-3">
                <span aria-hidden className="relative h-2 min-w-10 flex-1 overflow-hidden rounded-xs bg-track">
                  <span
                    className={cn(
                      "absolute inset-y-0 left-0 rounded-xs",
                      d.estado === "ok" ? "bg-chart-2" : d.estado === "attention" ? "bg-warn" : "bg-t4"
                    )}
                    style={{ width: `${d.fatia}%` }}
                  />
                </span>
                <span className="num shrink-0 whitespace-nowrap text-dense font-semibold text-ink">
                  {d.fatia}% do tráfego
                </span>
              </div>
              <p className="num text-label text-t2">
                {plural(d.mapeados, "produto ligado", "produtos ligados")} ·{" "}
                {d.carrinhos === null
                  ? "carrinhos: —"
                  : `${plural(d.carrinhos, "carrinho", "carrinhos")} em ${DIAS_CARRINHOS} dias`}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
