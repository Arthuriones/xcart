import type { ReactNode } from "react";
import { ArrowDown, ArrowRight, OctagonAlert, Send, TriangleAlert } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { STATUS, StatusBadge } from "@/components/ui/status-badge";

// ============================================================================
// Ilustracoes das telas do app para a landing.
//
// Sao montadas com os mesmos tokens e selos do app (o visual e o do produto),
// mas SEM numero: onde a tela real mostra valor, aqui ha uma barra neutra. A
// landing nao pode inventar faturamento, lucro nem horario. Quando o Arthur
// tiver capturas reais aprovadas, elas entram no lugar destas.
//
// Tudo fica escondido do leitor de tela (aria-hidden) e a legenda diz o que a
// figura mostra. Nada aqui recebe foco: os "botoes" sao so desenho.
// ============================================================================

function Figura({ legenda, children }: { legenda: string; children: ReactNode }) {
  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <div aria-hidden="true" className="pointer-events-none select-none">
        {children}
      </div>
      <figcaption className="text-label text-t2">{legenda}</figcaption>
    </figure>
  );
}

/** Moldura de tela: o nome da tela e o contexto, como no topo do app. */
function Janela({
  tela,
  contexto = [],
  children,
}: {
  tela: string;
  contexto?: string[];
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-card border border-border-strong bg-bg">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-2.5">
        <span className="mr-1 text-dense font-semibold text-ink">{tela}</span>
        {contexto.map((c) => (
          <span
            key={c}
            className="inline-flex h-6 items-center rounded-control border border-border bg-surface-2 px-2 text-label text-t1"
          >
            {c}
          </span>
        ))}
      </div>
      <div className="flex flex-col gap-2 p-2 sm:p-3">{children}</div>
    </div>
  );
}

/** O lugar de um valor. Neutra de proposito: nao e numero. */
function Barra({ className }: { className?: string }) {
  return <span className={cn("block h-2 rounded-full bg-track", className)} />;
}

function Cartao({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("rounded-card border border-border bg-surface", className)}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- Lucro

const KPIS = ["Lucro estimado", "Faturamento", "Gasto em anúncio", "ROAS real"];

const LOJAS: { nome: string; status: keyof typeof STATUS.lucro }[] = [
  { nome: "w-24", status: "lucro" },
  { nome: "w-20", status: "noLimite" },
  { nome: "w-28", status: "prejuizo" },
];

export function PreviaLucro() {
  return (
    <Figura legenda="Ilustração da tela Lucro. Na sua conta, os números vêm dos pedidos e do gasto das suas lojas.">
      <Janela tela="Lucro" contexto={["Todas as lojas", "Hoje · parcial", "BRL"]}>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {KPIS.map((k, i) => (
            <Cartao key={k} className="flex flex-col gap-2 p-3">
              <span className="truncate text-label text-t2">{k}</span>
              <Barra className="h-5 w-3/4 bg-border-strong" />
              {i === 0 ? (
                <StatusBadge {...STATUS.lucro.lucro} />
              ) : (
                <Barra className="mt-1.5 w-1/2" />
              )}
            </Cartao>
          ))}
        </div>

        <Cartao className="p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-label font-medium text-t1">Lucro por dia</span>
            <span className="flex items-center gap-3 text-label text-t2">
              <span className="flex items-center gap-1.5">
                <span className="block h-0.5 w-4 rounded-full bg-chart-1" />
                Período
              </span>
              <span className="flex items-center gap-1.5">
                <span className="block w-4 border-t-2 border-dashed border-control-border" />
                Anterior
              </span>
            </span>
          </div>
          <svg viewBox="0 0 320 96" preserveAspectRatio="none" className="mt-3 h-24 w-full">
            {[24, 48, 72].map((y) => (
              <line
                key={y}
                x1="0"
                x2="320"
                y1={y}
                y2={y}
                className="stroke-chart-grid"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <path
              d="M0,84 C40,80 70,70 110,72 S170,62 210,60 S280,52 320,48"
              fill="none"
              className="stroke-control-border"
              strokeWidth="1.5"
              strokeDasharray="5 5"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d="M0,78 C30,72 50,60 80,62 S130,40 160,44 S220,30 250,26 S300,18 320,14"
              fill="none"
              className="stroke-chart-1"
              strokeWidth="2"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </Cartao>

        <Cartao>
          <div className="grid grid-cols-[1fr_auto_4rem] items-center gap-3 border-b border-border-subtle px-3 py-2 text-label text-t2">
            <span>Loja</span>
            <span>Situação</span>
            <span className="text-right">Lucro</span>
          </div>
          <ul className="divide-y divide-border-subtle">
            {LOJAS.map((l) => (
              <li
                key={l.status}
                className="grid grid-cols-[1fr_auto_4rem] items-center gap-3 px-3 py-2.5"
              >
                <Barra className={cn("h-2.5 bg-border-strong", l.nome)} />
                <StatusBadge {...STATUS.lucro[l.status]} />
                <Barra className="ml-auto w-12" />
              </li>
            ))}
          </ul>
        </Cartao>
      </Janela>
    </Figura>
  );
}

// ------------------------------------------------- Composicao do lucro

const COMPOSICAO: { rotulo: string; barra: string }[] = [
  { rotulo: "Faturamento", barra: "left-0 w-full bg-chart-2" },
  { rotulo: "Produto", barra: "left-[64%] w-[36%] bg-control-border" },
  { rotulo: "Frete do fornecedor", barra: "left-[54%] w-[10%] bg-control-border" },
  { rotulo: "Taxa de pagamento", barra: "left-[49%] w-[5%] bg-control-border" },
  { rotulo: "Anúncio", barra: "left-[24%] w-[25%] bg-chart-3" },
  { rotulo: "Lucro estimado", barra: "left-0 w-[24%] bg-chart-1" },
];

export function PreviaComposicao() {
  return (
    <Figura legenda="Ilustração da composição do lucro: do faturamento sai cada custo até sobrar o lucro.">
      <Janela tela="Composição do lucro" contexto={["Todas as lojas", "Este mês"]}>
        <Cartao className="p-3">
          <ul className="flex flex-col gap-3">
            {COMPOSICAO.map((c) => (
              <li
                key={c.rotulo}
                className="grid grid-cols-[minmax(0,8.5rem)_1fr] items-center gap-3"
              >
                <span className="truncate text-label text-t1">{c.rotulo}</span>
                <span className="relative block h-3 rounded-full bg-track">
                  <span className={cn("absolute inset-y-0 rounded-full", c.barra)} />
                </span>
              </li>
            ))}
          </ul>
        </Cartao>
      </Janela>
    </Figura>
  );
}

// ---------------------------------------------------------- Rastreamento

const EVENTOS: {
  evento: string;
  plataforma: "Meta" | "Google";
  tom: "ok" | "run" | "err";
  texto: string;
}[] = [
  { evento: "Compra", plataforma: "Meta", tom: "ok", texto: "Enviado" },
  { evento: "Compra", plataforma: "Google", tom: "ok", texto: "Enviado" },
  { evento: "Iniciar checkout", plataforma: "Meta", tom: "ok", texto: "Enviado" },
  { evento: "Adicionar ao carrinho", plataforma: "Google", tom: "run", texto: "Na fila" },
  { evento: "Ver produto", plataforma: "Meta", tom: "err", texto: "Falhou" },
];

export function PreviaRastreamento() {
  return (
    <Figura legenda="Ilustração dos Eventos ao vivo: cada envio ao Meta e ao Google, com o estado de cada um.">
      <Janela tela="Eventos ao vivo" contexto={["Todas as lojas"]}>
        <Cartao>
          <ul className="divide-y divide-border-subtle">
            {EVENTOS.map((e) => (
              <li key={`${e.evento}-${e.plataforma}`} className="flex items-center gap-2 px-3 py-2.5">
                <span className="min-w-0 flex-1 truncate text-dense font-medium text-ink">
                  {e.evento}
                </span>
                <span className="inline-flex h-5.5 items-center rounded-control border border-border px-1.5 text-label text-t1">
                  {e.plataforma}
                </span>
                <StatusBadge tom={e.tom} texto={e.texto} pulso={false} className="w-21 justify-center" />
              </li>
            ))}
          </ul>
        </Cartao>
      </Janela>
    </Figura>
  );
}

// --------------------------------------------------------------- Alertas

const BOTAO_FALSO = "pointer-events-none";

export function PreviaAlertas() {
  return (
    <Figura legenda="Ilustração da tela Alertas: o que quebrou, em qual loja e o atalho para resolver.">
      <Janela tela="Alertas">
        <Cartao className="flex gap-3 p-3">
          <OctagonAlert className="mt-0.5 size-4 shrink-0 text-err" strokeWidth={1.75} />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-dense font-semibold text-ink">Gastou sem vender hoje</span>
              <StatusBadge {...STATUS.alerta.critico} />
            </div>
            <Barra className="w-28" />
            <div className="mt-1 flex flex-wrap gap-2">
              <span className={cn(buttonVariants({ variant: "primary", size: "sm" }), BOTAO_FALSO)}>
                Ver o lucro da loja
              </span>
              <span className={cn(buttonVariants({ variant: "secondary", size: "sm" }), BOTAO_FALSO)}>
                Silenciar 24 h
              </span>
            </div>
          </div>
        </Cartao>
        <Cartao className="flex gap-3 p-3">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" strokeWidth={1.75} />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-dense font-semibold text-ink">
                Compra não chegou na plataforma
              </span>
              <StatusBadge {...STATUS.alerta.aviso} />
            </div>
            <Barra className="w-20" />
            <div className="mt-1 flex flex-wrap gap-2">
              <span className={cn(buttonVariants({ variant: "secondary", size: "sm" }), BOTAO_FALSO)}>
                Abrir os eventos
              </span>
            </div>
          </div>
        </Cartao>
        <div className="flex items-center gap-2 px-1 text-label text-t2">
          <Send className="size-3.5 shrink-0" strokeWidth={1.75} />
          Os dois avisos também foram para o Telegram.
        </div>
      </Janela>
    </Figura>
  );
}

// ------------------------------------------------------------ Roteamento

function Caixa({ titulo, texto, destaque }: { titulo: string; texto: string; destaque?: boolean }) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-0.5 rounded-card border px-3 py-2.5",
        destaque ? "border-transparent bg-solid text-on-solid" : "border-border bg-surface text-ink"
      )}
    >
      <span className="text-dense font-semibold">{titulo}</span>
      <span className={cn("text-label", destaque ? "text-on-solid" : "text-t2")}>{texto}</span>
    </div>
  );
}

function Seta() {
  return (
    <span className="flex shrink-0 items-center justify-center text-t2">
      <ArrowDown className="size-4 sm:hidden" strokeWidth={1.75} />
      <ArrowRight className="hidden size-4 sm:block" strokeWidth={1.75} />
    </span>
  );
}

export function DiagramaRota() {
  return (
    <Figura legenda="A vitrine recebe o tráfego; o carrinho vai, pelo SKU, para uma das lojas de checkout.">
      <div className="flex flex-col gap-2 rounded-card border border-border-strong bg-bg p-3 sm:flex-row sm:items-center sm:p-4">
        <div className="sm:flex-1">
          <Caixa titulo="Vitrine" texto="Recebe o tráfego do anúncio" />
        </div>
        <Seta />
        <div className="sm:flex-1">
          <Caixa titulo="xcart" texto="Casa o carrinho pelo SKU" destaque />
        </div>
        <Seta />
        <div className="flex flex-col gap-2 sm:flex-1">
          <Caixa titulo="Loja de checkout" texto="Cobra o pedido" />
          <Caixa titulo="Outra loja de checkout" texto="Divide o tráfego" />
        </div>
      </div>
    </Figura>
  );
}
