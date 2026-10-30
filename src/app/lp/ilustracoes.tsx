import type { CSSProperties, ReactNode } from "react";
import { ArrowRight, TriangleAlert } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { LogoPanda } from "@/components/layout/logo";
import { StatusBadge, type TomStatus } from "@/components/ui/status-badge";

// ============================================================================
// Ilustracoes das telas do app para a landing ("design novo/Landing").
//
// Sao montadas com os mesmos tokens e selos do app (o visual e o do produto),
// mas SEM numero: onde a tela real mostra valor, aqui vai "R$ ••.•••" -- a
// landing nao pode inventar faturamento, lucro nem variacao. As barras e a
// linha do grafico sao proporcoes fixas, so forma.
//
// Tudo fica escondido do leitor de tela (aria-hidden) e a legenda diz o que a
// figura mostra. Nada aqui recebe foco nem clique: os "botoes" sao so desenho.
// ============================================================================

// ------------------------------------------------- composicao do lucro

interface LinhaComposicao {
  rotulo: string;
  /** Onde a barra comeca e quanto ocupa, em % do faturamento (so forma). */
  esq: number;
  larg: number;
  barra: string;
  /** Faturamento e lucro em destaque; os custos no meio, mais leves. */
  ponta: boolean;
}

const COMPOSICAO: LinhaComposicao[] = [
  { rotulo: "Faturamento", esq: 0, larg: 100, barra: "bg-chart-2", ponta: true },
  { rotulo: "Produto + frete", esq: 64, larg: 36, barra: "bg-t4", ponta: false },
  { rotulo: "Taxas de pagamento", esq: 59, larg: 5, barra: "bg-t4 opacity-60", ponta: false },
  { rotulo: "Meta Ads", esq: 34, larg: 25, barra: "bg-chart-3", ponta: false },
  { rotulo: "Google Ads", esq: 28, larg: 6, barra: "bg-chart-3 opacity-60", ponta: false },
  { rotulo: "Lucro estimado", esq: 0, larg: 28, barra: "bg-chart-1", ponta: true },
];

/** A borda de cima de cada linha: nenhuma na primeira, forte antes do lucro. */
function bordaDaLinha(i: number, total: number): string {
  if (i === 0) return "";
  return i === total - 1 ? "border-t border-border-strong" : "border-t border-border-subtle";
}

function BarraDaComposicao({ linha, altura }: { linha: LinhaComposicao; altura: string }) {
  const posicao: CSSProperties = { left: `${linha.esq}%`, width: `${linha.larg}%` };
  return (
    <span className={cn("relative block rounded-[2px] bg-track", altura)}>
      <span className={cn("absolute inset-y-0 rounded-[2px]", linha.barra)} style={posicao} />
    </span>
  );
}

// ------------------------------------------------------ previa do hero

// Formas do grafico (o periodo e o anterior tracejado): fixas, sem valor.
const SERIE_ATUAL = [62, 70, 58, 74, 66, 80, 72, 86, 78, 92, 84, 98, 90, 104, 96, 110, 100, 116];
const SERIE_ANTERIOR = [52, 56, 50, 60, 55, 63, 58, 66, 62, 70, 64, 73, 68, 76, 71, 79, 74, 82];

function caminho(serie: readonly number[]): string {
  return serie
    .map((v, i) => `${i ? "L" : "M"}${((i / (serie.length - 1)) * 600).toFixed(1)} ${(150 - v).toFixed(1)}`)
    .join(" ");
}

const LINHA_ATUAL = caminho(SERIE_ATUAL);
const LINHA_ANTERIOR = caminho(SERIE_ANTERIOR);
const AREA_ATUAL = `${LINHA_ATUAL} L600 150 L0 150 Z`;

const MENU_DA_JANELA: { rotulo: string; tipo: "grupo" | "item" | "ativo" }[] = [
  { rotulo: "Financeiro", tipo: "grupo" },
  { rotulo: "Dashboard", tipo: "ativo" },
  { rotulo: "Campanhas", tipo: "item" },
  { rotulo: "Pedidos", tipo: "item" },
  { rotulo: "Custos e taxas", tipo: "item" },
  { rotulo: "Rastreamento", tipo: "grupo" },
  { rotulo: "Rastreamento", tipo: "item" },
  { rotulo: "Eventos ao vivo", tipo: "item" },
  { rotulo: "Alertas", tipo: "item" },
];

const KPIS_DA_JANELA: { rotulo: string; valor: string; variacao: string; cor: string; borda: string }[] = [
  { rotulo: "Faturamento", valor: "R$ •••.•••,••", variacao: "↑ ••,•%", cor: "text-ok", borda: "border-r" },
  // No celular sao 2 colunas: o segundo fecha a linha e perde a divisoria.
  { rotulo: "Gasto em anúncios", valor: "R$ ••.•••,••", variacao: "↑ •,•%", cor: "text-t2", borda: "md:border-r" },
  { rotulo: "ROAS real", valor: "•,••×", variacao: "↑ •,•%", cor: "text-ok", borda: "border-r" },
  { rotulo: "Margem", valor: "••,•%", variacao: "↑ •,• p.p.", cor: "text-ok", borda: "" },
];

const CHIP_DA_JANELA =
  "inline-flex h-6.5 shrink-0 items-center rounded-control border border-border px-2.25 text-label whitespace-nowrap text-t1";

/**
 * A janela do hero: o Dashboard novo com os valores escondidos. O menu lateral
 * so cabe a partir de 1100px e a composicao do lucro a partir de 900px; no
 * celular os KPIs vao em duas colunas.
 */
export function PreviaDashboard() {
  return (
    <figure className="mt-6 flex w-full flex-col gap-3 text-left md:mt-12">
      <div
        aria-hidden="true"
        className="pointer-events-none relative overflow-hidden rounded-[14px] border border-border bg-bg shadow-[0_32px_80px_rgba(26,26,26,.10),0_2px_8px_rgba(26,26,26,.05)] select-none dark:shadow-[0_32px_80px_rgba(0,0,0,.5),0_0_0_1px_var(--border)]"
      >
        <div className="flex min-h-105 md:min-h-130">
          <div className="hidden w-49 flex-none flex-col gap-0.5 px-2 py-3 min-[1100px]:flex">
            <div className="flex h-8 items-center px-2 pb-2">
              <LogoPanda altura={18} />
            </div>
            {MENU_DA_JANELA.map((n, i) =>
              n.tipo === "grupo" ? (
                <div key={i} className="flex h-7 items-center px-2 pt-2.5 text-[11px] text-t3">
                  {n.rotulo}
                </div>
              ) : (
                <div
                  key={i}
                  className={cn(
                    "flex h-7.5 items-center gap-2 rounded-control border px-2 text-label",
                    n.tipo === "ativo"
                      ? "border-border bg-surface font-medium text-ink"
                      : "border-transparent text-t1"
                  )}
                >
                  <span className="size-3 rounded-[3px] border-[1.5px] border-current opacity-70" />
                  {n.rotulo}
                </div>
              )
            )}
          </div>

          <div className="m-2 flex min-w-0 flex-1 flex-col rounded-[10px] border border-border bg-surface min-[1100px]:ml-0">
            <div className="flex h-11 items-center gap-1.5 overflow-hidden border-b border-border px-3.5">
              <span className="mr-1.5 text-dense font-semibold text-ink">Dashboard</span>
              <span className={CHIP_DA_JANELA}>Todas as lojas</span>
              <span className={cn(CHIP_DA_JANELA, "md:hidden")}>Hoje</span>
              <span className={cn(CHIP_DA_JANELA, "max-md:hidden")}>Últimos 30 dias</span>
              <span className={cn(CHIP_DA_JANELA, "max-md:hidden")}>vs. período anterior</span>
              <span className={cn(CHIP_DA_JANELA, "max-md:hidden")}>BRL</span>
            </div>

            <div className="flex flex-col gap-3.5 p-4">
              <div className="grid grid-cols-1 gap-3.5 min-[900px]:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
                <div className="flex flex-col gap-1.5 rounded-card border border-border px-4 pt-4 pb-2.5">
                  <span className="text-label text-t2">Lucro estimado</span>
                  <span className="flex items-center gap-2.5">
                    <span className="num text-[24px] leading-[1.1] font-semibold tracking-[-0.03em] text-ink md:text-[30px]">
                      R$ ••.•••,••
                    </span>
                    <span className="inline-flex h-5 items-center gap-1.25 rounded-full border border-ok-border bg-ok-bg px-1.75 text-[11px] font-medium text-ok">
                      <span className="size-1.25 rounded-full bg-ok" />
                      Lucro
                    </span>
                  </span>
                  <span className="flex items-center gap-1.5 text-[11px] text-t3">
                    <span className="h-4.5 rounded-sm bg-ok-bg px-1.5 leading-4.5 font-semibold text-ok">
                      ↑ •,•%
                    </span>
                    vs. período anterior
                  </span>
                  <svg
                    viewBox="0 0 600 150"
                    preserveAspectRatio="none"
                    className="mt-1.5 block h-30 w-full md:h-[170px]"
                  >
                    <path
                      d="M0 37H600 M0 75H600 M0 112H600"
                      className="stroke-chart-grid"
                      strokeWidth={1}
                      vectorEffect="non-scaling-stroke"
                    />
                    <path d={AREA_ATUAL} className="fill-chart-1" fillOpacity={0.05} />
                    <path
                      d={LINHA_ANTERIOR}
                      fill="none"
                      className="stroke-t4"
                      strokeWidth={1.5}
                      strokeDasharray="4 4"
                      vectorEffect="non-scaling-stroke"
                    />
                    <path
                      d={LINHA_ATUAL}
                      fill="none"
                      className="stroke-chart-1"
                      strokeWidth={2}
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                </div>

                <div className="hidden flex-col gap-0.5 rounded-card border border-border px-4 py-3.5 min-[900px]:flex">
                  <span className="pb-1.5 text-dense font-semibold text-ink">Composição do lucro</span>
                  {COMPOSICAO.map((c, i) => (
                    <div
                      key={c.rotulo}
                      className={cn("flex flex-col gap-1.25 py-1.75", bordaDaLinha(i, COMPOSICAO.length))}
                    >
                      <span
                        className={cn(
                          "flex justify-between gap-2 text-[11px]",
                          c.ponta ? "font-semibold text-ink" : "text-t1"
                        )}
                      >
                        <span>{c.rotulo}</span>
                        <span className="num text-t3">R$ ••.•••</span>
                      </span>
                      <BarraDaComposicao linha={c} altura="h-1.25" />
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 overflow-hidden rounded-card border border-border md:grid-cols-4">
                {KPIS_DA_JANELA.map((k) => (
                  <div key={k.rotulo} className={cn("flex flex-col gap-1 border-border px-3.5 py-3", k.borda)}>
                    <span className="text-[11px] whitespace-nowrap text-t2">{k.rotulo}</span>
                    <span className="num text-[16px] font-semibold tracking-[-0.01em] whitespace-nowrap text-ink">
                      {k.valor}
                    </span>
                    <span className={cn("text-[11px] font-semibold", k.cor)}>{k.variacao}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="absolute inset-x-0 bottom-0 h-24 bg-linear-to-b from-transparent to-bg" />
      </div>
      <figcaption className="text-center text-label text-t3">
        Ilustração do Dashboard com os valores escondidos. Na sua conta, os números vêm dos pedidos e
        do gasto das suas lojas.
      </figcaption>
    </figure>
  );
}

// ----------------------------------------------- janelas dos recursos

function Figura({ legenda, children }: { legenda: string; children: ReactNode }) {
  return (
    <figure className="flex min-w-0 flex-col gap-2.5">
      <div aria-hidden="true" className="pointer-events-none select-none">
        {children}
      </div>
      <figcaption className="text-label text-t3">{legenda}</figcaption>
    </figure>
  );
}

/** Moldura de tela: o nome da tela e o contexto, como no topo do app. */
function Janela({
  tela,
  contexto = [],
  className,
  children,
}: {
  tela: string;
  contexto?: string[];
  /** O respiro do corpo, que muda com o conteudo. */
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-overlay border border-border bg-surface shadow-[0_1px_2px_rgba(26,26,26,.04)]">
      <div className="flex h-10.5 items-center gap-1.5 overflow-hidden border-b border-border bg-surface-2 px-3.5">
        <span className="mr-1.5 text-dense font-semibold whitespace-nowrap text-ink">{tela}</span>
        {contexto.map((c) => (
          <span
            key={c}
            className="inline-flex h-6 shrink-0 items-center rounded-control border border-border bg-surface px-2 text-label whitespace-nowrap text-t1"
          >
            {c}
          </span>
        ))}
      </div>
      <div className={cn("flex flex-col", className)}>{children}</div>
    </div>
  );
}

export function PreviaComposicao() {
  return (
    <Figura legenda="Ilustração da composição do lucro, com os valores escondidos: do faturamento sai cada custo até sobrar o lucro.">
      <Janela tela="Composição do lucro" contexto={["Todas as lojas", "Este mês"]} className="px-4 pt-1.5 pb-3.5">
        {COMPOSICAO.map((c, i) => (
          <div
            key={c.rotulo}
            className={cn("flex flex-col gap-1.5 py-2.75", bordaDaLinha(i, COMPOSICAO.length))}
          >
            <span className="flex items-center justify-between gap-2.5">
              <span
                className={cn(
                  "truncate text-dense",
                  c.ponta ? "font-semibold text-ink" : "font-normal text-t1"
                )}
              >
                {c.rotulo}
              </span>
              <span className="num text-label whitespace-nowrap text-t3">
                {i === 0 ? "R$ •••.•••" : "R$ ••.•••"}
              </span>
            </span>
            <BarraDaComposicao linha={c} altura="h-1.5" />
          </div>
        ))}
      </Janela>
    </Figura>
  );
}

// So Meta e TikTok: os Eventos ao vivo listam o que sai do servidor. O Google
// vai pela tag do Google no navegador e nao passa pela fila.
const EVENTOS: { evento: string; plataforma: "Meta" | "TikTok"; tom: TomStatus; texto: string }[] = [
  { evento: "Compra", plataforma: "Meta", tom: "ok", texto: "Enviado" },
  { evento: "Compra", plataforma: "TikTok", tom: "ok", texto: "Enviado" },
  { evento: "Iniciar checkout", plataforma: "Meta", tom: "ok", texto: "Enviado" },
  { evento: "Adicionar ao carrinho", plataforma: "TikTok", tom: "info", texto: "Na fila" },
  { evento: "Ver produto", plataforma: "Meta", tom: "err", texto: "Falhou" },
];

export function PreviaRastreamento() {
  return (
    <Figura legenda="Ilustração dos Eventos ao vivo: cada envio do servidor ao Meta e ao TikTok, com o estado de cada um.">
      <Janela tela="Eventos ao vivo" contexto={["Todas as lojas"]} className="px-4 py-1">
        {EVENTOS.map((e, i) => (
          <div
            key={`${e.evento}-${e.plataforma}`}
            className={cn(
              "flex items-center justify-between gap-2.5 py-2.75",
              i > 0 && "border-t border-border-subtle"
            )}
          >
            <span className="truncate text-dense font-medium text-ink">
              {e.evento} · {e.plataforma}
            </span>
            <StatusBadge tom={e.tom} texto={e.texto} pulso={false} />
          </div>
        ))}
      </Janela>
    </Figura>
  );
}

const ACAO_FALSA = "h-6 rounded-control border px-2 text-label leading-5.5 font-medium whitespace-nowrap";

function CartaoAlerta({
  titulo,
  tom,
  selo,
  origem,
  children,
}: {
  titulo: string;
  tom: "err" | "warn";
  selo: string;
  /** Loja e quando, como na tela Alertas. */
  origem: string;
  /** As acoes do aviso. */
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "mb-2 flex items-start gap-2.5 rounded-card border border-l-3 border-border p-3.5",
        tom === "err" ? "border-l-err" : "border-l-warn"
      )}
    >
      <TriangleAlert
        className={cn("mt-px size-4 shrink-0", tom === "err" ? "text-err" : "text-warn")}
        strokeWidth={1.75}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex items-center justify-between gap-2.5">
          <span className="truncate text-dense font-medium text-ink">{titulo}</span>
          <StatusBadge tom={tom} texto={selo} pulso={false} />
        </span>
        <span className="flex flex-wrap items-center gap-1.5 text-label text-t3">
          {origem}
          <span className="ml-auto inline-flex gap-1.5">{children}</span>
        </span>
      </span>
    </div>
  );
}

export function PreviaAlertas() {
  return (
    <Figura legenda="Ilustração da tela Alertas: o que quebrou, em qual loja e o atalho para resolver.">
      <Janela tela="Alertas" className="p-3.5">
        <CartaoAlerta titulo="Gastou sem vender hoje" tom="err" selo="Crítico" origem="Alto Fit · há 12 min">
          <span className={cn(ACAO_FALSA, "border-transparent bg-solid text-on-solid")}>Ver o lucro da loja</span>
          <span className={cn(ACAO_FALSA, "border-border-strong text-ink")}>Silenciar 24 h</span>
        </CartaoAlerta>
        <CartaoAlerta titulo="Compra não chegou na plataforma" tom="warn" selo="Aviso" origem="Kova Home · há 2 h">
          <span className={cn(ACAO_FALSA, "border-border-strong bg-surface text-ink")}>Abrir os eventos</span>
        </CartaoAlerta>
        <p className="px-0.5 pt-1 text-dense text-t2">Os dois avisos também foram para o Telegram.</p>
      </Janela>
    </Figura>
  );
}

// ------------------------------------------------------------ roteamento

function Caixa({ titulo, texto, className }: { titulo: string; texto: string; className?: string }) {
  return (
    <div className={cn("rounded-card border border-border bg-surface-2 px-3.5 py-3", className)}>
      <div className="text-dense font-semibold text-ink">{titulo}</div>
      <div className="text-label text-t2">{texto}</div>
    </div>
  );
}

function Seta() {
  return (
    <div className="grid place-items-center text-t3">
      <ArrowRight className="size-4 rotate-90 sm:rotate-0" strokeWidth={1.75} />
    </div>
  );
}

export function DiagramaRota() {
  return (
    <Figura legenda="A vitrine recebe o tráfego; o carrinho vai, pelo SKU, para uma das lojas de checkout.">
      <div className="grid grid-cols-1 items-center gap-3 rounded-overlay border border-border bg-surface p-6 sm:grid-cols-[minmax(0,1fr)_20px_minmax(0,1fr)_20px_minmax(0,1.1fr)]">
        <Caixa titulo="Vitrine" texto="Recebe o tráfego do anúncio" />
        <Seta />
        <div className="rounded-card bg-solid px-3.5 py-3 text-on-solid">
          <div className="text-dense font-semibold">Panda Track</div>
          <div className="text-label opacity-85">Casa o carrinho pelo SKU</div>
        </div>
        <Seta />
        <div className="flex flex-col gap-2">
          <Caixa titulo="Loja de checkout" texto="Cobra o pedido" />
          <Caixa
            titulo="Outra loja de checkout"
            texto="Divide o tráfego"
            className="border-dashed border-border-strong bg-transparent"
          />
        </div>
      </div>
    </Figura>
  );
}
