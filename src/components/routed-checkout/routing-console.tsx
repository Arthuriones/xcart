"use client";

import { useCallback, useState } from "react";
import dynamic from "next/dynamic";
import {
  Check,
  Copy,
  Ellipsis,
  Loader2,
  Plus,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { getPublicAppUrl } from "@/lib/public-url";
import {
  COR_ALVO,
  TEXTO_ALVO,
  targetState,
  type StripTarget,
} from "@/components/routed-checkout/target-state";
import type { GraphRoute, GraphTarget, RouteGraph } from "@/lib/checkout-routes/graph";

// Os dois so existem depois de um clique -- "Conectar loja" e "Configurar".
// Somados sao 23 KB que todo mundo baixava para abrir o roteamento.
const AddStorePanel = dynamic(
  () =>
    import("@/components/routed-checkout/add-store-panel").then((m) => m.AddStorePanel),
  { ssr: false }
);
const RotationPanel = dynamic(
  () =>
    import("@/components/routed-checkout/rotation-panel").then((m) => m.RotationPanel),
  { ssr: false }
);

type Alvo = GraphTarget;
type Rota = GraphRoute;
type Grafo = RouteGraph;

interface Diagnostico {
  ok: boolean;
  coveragePercent: number;
  noSkuCount: number;
  missingCount: number;
  wrongCount: number;
  checkedTargetName?: string;
}

function snippet(token: string) {
  const origem = getPublicAppUrl(process.env.NEXT_PUBLIC_APP_URL || "");
  return `<script\n  src="${origem}/routed-checkout-loader.js"\n  data-token="${token}"\n  async>\n</script>`;
}

export function RoutingConsole({
  grafoInicial,
  onConnectStores,
}: {
  grafoInicial: Grafo;
  onConnectStores: () => void;
}) {
  const [grafo, setGrafo] = useState<Grafo>(grafoInicial);
  const [rotaId, setRotaId] = useState<string | null>(
    grafoInicial.routes[0]?.id ?? null
  );

  const carregar = useCallback(async () => {
    try {
      const r = await fetch("/api/checkout-routes/map");
      if (!r.ok) throw new Error();
      const d = (await r.json()) as Grafo;
      setGrafo(d);
      setRotaId((atual) =>
        atual && d.routes.some((x) => x.id === atual) ? atual : (d.routes[0]?.id ?? null)
      );
    } catch {
      toast.error("Não consegui carregar as rotas.");
    }
  }, []);

  return (
    <ConsoleView
      grafo={grafo}
      rotaId={rotaId}
      onSelecionar={setRotaId}
      onConnectStores={onConnectStores}
      onRecarregar={carregar}
    />
  );
}

/** O desenho, sem busca de dados: dá para renderizar com qualquer estado. */
export function ConsoleView({
  grafo,
  rotaId,
  onSelecionar,
  onConnectStores,
  onRecarregar,
}: {
  grafo: Grafo;
  rotaId: string | null;
  onSelecionar: (id: string) => void;
  onConnectStores: () => void;
  onRecarregar: () => void;
}) {
  const [editando, setEditando] = useState(false);
  const [conectandoLoja, setConectandoLoja] = useState(false);
  const [instalando, setInstalando] = useState(false);
  const [instalado, setInstalado] = useState(false);
  const [manual, setManual] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [checando, setChecando] = useState(false);
  const [diagnostico, setDiagnostico] = useState<Diagnostico | null>(null);
  const [consertando, setConsertando] = useState(false);
  const [ocupadoId, setOcupadoId] = useState<string | null>(null);
  const [alvosLocais, setAlvosLocais] = useState<Alvo[] | null>(null);
  const [filtro, setFiltro] = useState<(typeof FILTROS)[number]>("Todas");

  const rota = grafo.routes.find((r) => r.id === rotaId) ?? null;
  const porId = new Map(grafo.stores.map((s) => [s.id, s]));

  if (grafo.routes.length === 0) {
    const semLojas = grafo.stores.length < 2;
    return (
      <div className="flex flex-col gap-[18px]">
        <div className="rounded-lg border border-dashed border-[var(--border-strong)] bg-surface px-8 py-11 text-center">
          <div className="text-[15px] font-semibold text-ink">Nenhuma rota ainda</div>
          <p className="mx-auto mb-4 mt-1.5 max-w-[380px] text-[12.5px] text-t2">
            Ligue a vitrine ao checkout: a vitrine recebe o tráfego do anúncio, a loja
            de checkout cobra. O xcart leva o carrinho de uma para a outra casando os
            SKUs.
          </p>
          <button
            type="button"
            onClick={semLojas ? () => setConectandoLoja(true) : onConnectStores}
            className="h-[30px] rounded-md bg-[var(--solid)] px-[13px] text-[12.5px] font-semibold text-[var(--on-solid)] transition-colors hover:bg-[var(--solid-hover)]"
          >
            {semLojas ? "Conectar uma loja Shopify" : "Criar a primeira rota"}
          </button>
        </div>
        {conectandoLoja && (
          <div className="rounded-lg border border-border bg-surface text-left">
            <AddStorePanel
              onConnected={() => {
                setConectandoLoja(false);
                onRecarregar();
              }}
              onCancel={() => setConectandoLoja(false)}
            />
          </div>
        )}
      </div>
    );
  }

  if (!rota) return null;

  const alvos: StripTarget[] = (alvosLocais ?? rota.targets).map((t) => ({
    id: t.id,
    name: porId.get(t.storeId)?.name || "loja removida",
    domain: porId.get(t.storeId)?.shopDomain || "",
    enabled: t.enabled,
    weight: t.weight,
    sharePercent: t.sharePercent,
    mappedSkuCount: t.mappedSkuCount,
  }));

  const vitrine = porId.get(rota.sourceStoreId);
  const quebrada = rota.lastHeal && !rota.lastHeal.ok;

  async function salvarAlvos(mudancas: { id: string; weight?: number; enabled?: boolean }[]) {
    const resposta = await fetch(`/api/checkout-routes/${rota!.id}/targets`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targets: mudancas }),
    });
    if (!resposta.ok) {
      toast.error("Não consegui salvar. Recarregue a página.");
      setAlvosLocais(null);
      return;
    }
    onRecarregar();
  }

  /** Mexer numa fatia redistribui o resto, para a soma continuar 100. */
  function mudarFatia(alvo: StripTarget, valor: number) {
    const base = alvosLocais ?? rota!.targets;
    const novo = Math.max(0, Math.min(100, Math.round(valor)));
    const outros = base.filter((t) => t.id !== alvo.id && t.enabled);
    const soma = outros.reduce((s, t) => s + t.weight, 0);
    const sobra = 100 - novo;

    const proximo = base.map((t) => {
      if (t.id === alvo.id) return { ...t, weight: novo, sharePercent: novo };
      if (!t.enabled) return t;
      const parte =
        soma > 0 ? Math.round((t.weight / soma) * sobra) : Math.round(sobra / outros.length);
      return { ...t, weight: Math.max(0, parte), sharePercent: Math.max(0, parte) };
    });
    setAlvosLocais(proximo);
    salvarAlvos(proximo.filter((t) => t.enabled).map((t) => ({ id: t.id, weight: t.weight })));
  }

  async function alternar(alvo: StripTarget) {
    setOcupadoId(alvo.id);
    try {
      await salvarAlvos([{ id: alvo.id, weight: alvo.weight, enabled: !alvo.enabled }]);
      setAlvosLocais(null);
    } finally {
      setOcupadoId(null);
    }
  }

  function dividirIgual() {
    const base = (alvosLocais ?? rota!.targets).filter((t) => t.enabled);
    if (base.length === 0) return;
    const parte = Math.floor(100 / base.length);
    const resto = 100 - parte * base.length;
    const mudancas = base.map((t, i) => ({ id: t.id, weight: parte + (i < resto ? 1 : 0) }));
    setAlvosLocais(
      (alvosLocais ?? rota!.targets).map((t) => {
        const m = mudancas.find((x) => x.id === t.id);
        return m ? { ...t, weight: m.weight, sharePercent: m.weight } : t;
      })
    );
    salvarAlvos(mudancas);
  }

  async function instalar() {
    setInstalando(true);
    try {
      const r = await fetch(`/api/checkout-routes/${rota!.id}/update-theme`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setManual(true);
        toast.error(d.error || "Não consegui escrever no tema. Cole o script na mão.");
        return;
      }
      setInstalado(true);
      toast.success(d.message || "Script instalado na vitrine.");
      onRecarregar();
    } finally {
      setInstalando(false);
    }
  }

  async function diagnosticar() {
    setChecando(true);
    setDiagnostico(null);
    try {
      const r = await fetch("/api/checkout-routes/health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: rota!.id }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast.error(d.error || "Falha ao verificar.");
        return;
      }
      setDiagnostico(d);
    } finally {
      setChecando(false);
    }
  }

  async function corrigir() {
    setConsertando(true);
    try {
      const r = await fetch("/api/checkout-routes/repair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: rota!.id }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast.error(d.error || "Falha ao corrigir.");
        return;
      }
      toast.success(
        d.noop
          ? "Nada para corrigir: a rota já estava certa."
          : `Corrigida. ${d.createdProductCount || 0} produtos criados, ${d.stampedSkuCount || 0} SKUs gravados.`
      );
      setDiagnostico(null);
      onRecarregar();
    } finally {
      setConsertando(false);
    }
  }

  async function alternarRota() {
    await fetch("/api/checkout-routes/toggle", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: rota!.id, enabled: !rota!.enabled }),
    });
    toast.success(rota!.enabled ? "Rota pausada." : "Rota ligada.");
    onRecarregar();
  }

  async function apagar() {
    if (
      !window.confirm(
        `Apagar a rota "${rota!.name}"? A vitrine volta a mandar o comprador para o próprio checkout, que não cobra.`
      )
    )
      return;
    const r = await fetch(`/api/checkout-routes?id=${rota!.id}`, { method: "DELETE" });
    if (!r.ok) {
      toast.error("Falha ao apagar a rota.");
      return;
    }
    toast.success("Rota apagada.");
    onRecarregar();
  }

  // ---------------------------------------------------------------- estado

  /**
   * Estado de uma rota inteira, na linguagem do design.
   *
   * "atencao" ganha de "ativa": uma rota que esta no ar mas com destino sem
   * produto ligado parece saudavel e nao esta -- e o caso que faz o carrinho
   * falhar sem ninguem perceber.
   */
  function estadoDaRota(r: Rota): "active" | "warn" | "paused" {
    if (!r.enabled) return "paused";
    const semMapa = r.targets.some((t) => t.enabled && t.mappedSkuCount === 0);
    if (semMapa || (r.lastHeal && !r.lastHeal.ok)) return "warn";
    return "active";
  }

  const ESTADO_ROTA = {
    active: { texto: "Ativa", cor: "var(--ok)" },
    warn: { texto: "Atenção", cor: "var(--warn)" },
    paused: { texto: "Parada", cor: "var(--t4)" },
  } as const;

  const FILTROS = ["Todas", "Ativas", "Atenção", "Paradas"] as const;

  const visiveis = grafo.routes.filter((r) => {
    if (filtro === "Todas") return true;
    const e = estadoDaRota(r);
    return (
      (filtro === "Ativas" && e === "active") ||
      (filtro === "Atenção" && e === "warn") ||
      (filtro === "Paradas" && e === "paused")
    );
  });

  const parada = !rota.enabled;
  const recebendo = alvos.filter((a) => !parada && targetState(a) === "ok").length;
  const metaRota = ESTADO_ROTA[estadoDaRota(rota)];
  const divisao =
    rota.rotationStrategy === "each_checkout" ? "Sorteia toda vez" : "Sempre a mesma loja";
  const ligados = alvos.reduce((maior, a) => Math.max(maior, a.mappedSkuCount), 0);

  const fatos = [
    {
      l: "Origem",
      v: vitrine?.name || "vitrine removida",
      sub: vitrine?.shopDomain || "—",
    },
    {
      l: "Divisão",
      v: divisao,
      sub: ligados > 0 ? `${ligados} produtos ligados` : "nenhum produto ligado",
    },
    {
      l: "Carrinhos · 30d",
      v: rota.routedCount30d.toLocaleString("pt-BR"),
      sub: "roteados por esta rota",
    },
  ];

  const BOTAO =
    "h-[27px] shrink-0 rounded-md px-2.5 text-[12px] font-semibold transition-colors";

  return (
    <div className="flex flex-col gap-[18px]">
      {conectandoLoja && (
        <div className="rounded-lg border border-border bg-surface">
          <AddStorePanel
            onConnected={() => {
              setConectandoLoja(false);
              onRecarregar();
            }}
            onCancel={() => setConectandoLoja(false)}
          />
        </div>
      )}

      <div className="flex flex-col gap-3.5">
        <div className="grid gap-4 lg:grid-cols-[minmax(240px,300px)_minmax(0,1fr)] lg:items-start">
          {/* -------------------------------------------------- lista */}
          <div className="flex flex-col gap-[9px]">
            <div className="flex flex-wrap items-center gap-[7px]">
              {FILTROS.map((f) => {
                const on = filtro === f;
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFiltro(f)}
                    className="h-[25px] rounded-md px-[9px] text-[11.5px] font-semibold transition-colors"
                    style={{
                      border: `1px solid ${on ? "var(--solid)" : "var(--border)"}`,
                      background: on ? "var(--solid)" : "var(--surface)",
                      color: on ? "var(--on-solid)" : "var(--t2)",
                    }}
                  >
                    {f}
                  </button>
                );
              })}
            </div>

            <div className="overflow-hidden rounded-lg border border-border bg-surface">
              {visiveis.length === 0 ? (
                <p className="px-3.5 py-[22px] text-center text-[12px] text-t3">
                  Nenhuma rota com esse status.
                </p>
              ) : (
                visiveis.map((r) => {
                  const meta = ESTADO_ROTA[estadoDaRota(r)];
                  const on = r.id === rota.id;
                  const ativos = r.enabled
                    ? r.targets.filter((t) => t.enabled && t.weight > 0).length
                    : 0;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => {
                        setAlvosLocais(null);
                        setDiagnostico(null);
                        onSelecionar(r.id);
                      }}
                      className="flex w-full items-center gap-[9px] border-b border-[var(--border-subtle)] px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-surface-2"
                      style={{
                        borderLeft: `2px solid ${on ? "var(--solid)" : "transparent"}`,
                        background: on ? "var(--surface-2)" : "var(--surface)",
                      }}
                    >
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: meta.cor }}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span
                          className="block truncate text-[12.5px] text-ink"
                          style={{ fontWeight: on ? 600 : 500 }}
                        >
                          {r.name}
                        </span>
                        <span className="mt-px block truncate text-[11px] text-t3">
                          {meta.texto} · {ativos} de {r.targets.length} lojas
                        </span>
                      </span>
                      <span className="shrink-0 font-mono text-[11.5px] tabular-nums text-t2">
                        {r.routedCount30d}
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            <button
              type="button"
              onClick={onConnectStores}
              className="h-[30px] rounded-[7px] border border-dashed border-[var(--border-strong)] text-[12.5px] font-semibold text-t2 transition-colors hover:border-ink hover:text-ink"
            >
              Nova rota
            </button>
          </div>

          {/* ------------------------------------------------- detalhe */}
          <div className="rounded-lg border border-border bg-surface">
            <div className="flex flex-wrap items-center gap-[11px] border-b border-[var(--border-subtle)] px-[17px] py-3.5">
              <span
                className="h-[7px] w-[7px] shrink-0 rounded-full"
                style={{ background: metaRota.cor }}
                aria-hidden
              />
              <div className="min-w-0 flex-1 basis-[200px]">
                <div className="truncate text-[14px] font-semibold text-ink">{rota.name}</div>
                <div className="mt-px text-[11.5px] text-t3">
                  {metaRota.texto} · {recebendo} de {alvos.length} lojas recebendo comprador
                </div>
              </div>

              <button
                type="button"
                onClick={diagnosticar}
                disabled={checando}
                className={cn(BOTAO, "border border-[var(--border-strong)] bg-surface text-ink hover:bg-surface-2 disabled:opacity-50")}
              >
                {checando ? "Testando…" : "Testar"}
              </button>
              <button
                type="button"
                onClick={alternarRota}
                className={cn(BOTAO, "border border-border bg-surface text-t2 hover:border-[var(--border-strong)]")}
              >
                {parada ? "Voltar" : "Parar"}
              </button>
              <button
                type="button"
                onClick={() => setEditando((v) => !v)}
                className={cn(
                  BOTAO,
                  editando
                    ? "border border-[var(--border-strong)] bg-[var(--nav-active)] text-ink"
                    : "bg-[var(--solid)] text-[var(--on-solid)] hover:bg-[var(--solid-hover)]"
                )}
              >
                Configurar
              </button>

              {/* O design nao previu instalar o script nem apagar a rota, mas
                  as duas coisas existem e precisam de casa. */}
              <DropdownMenu>
                <DropdownMenuTrigger className="inline-flex h-[27px] w-[27px] shrink-0 items-center justify-center rounded-md border border-border bg-surface text-t4 transition-colors hover:border-[var(--border-strong)] hover:text-ink focus-visible:outline-none">
                  <Ellipsis className="h-3.5 w-3.5" aria-hidden />
                  <span className="sr-only">Mais ações</span>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem onClick={instalar} disabled={instalando}>
                    {instalando ? (
                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    ) : instalado ? (
                      <Check className="mr-2 h-3.5 w-3.5" />
                    ) : (
                      <Upload className="mr-2 h-3.5 w-3.5" />
                    )}
                    {instalado ? "Instalado na vitrine" : "Instalar na vitrine"}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setManual((v) => !v)}>
                    <Copy className="mr-2 h-3.5 w-3.5" />
                    Instalar o script na mão
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setConectandoLoja((v) => !v)}>
                    <Plus className="mr-2 h-3.5 w-3.5" />
                    Conectar loja
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={apagar}>
                    Apagar rota
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {quebrada && (
              <p className="border-b border-[var(--border-subtle)] bg-[var(--err-bg)] px-[17px] py-2.5 text-[12px] text-ink">
                {rota.lastHeal?.message || "A última checagem automática achou um problema."}
              </p>
            )}

            <div className="grid grid-cols-1 border-b border-[var(--border-subtle)] sm:grid-cols-3">
              {fatos.map((fato) => (
                <div
                  key={fato.l}
                  className="border-l border-[var(--border-subtle)] px-[17px] py-3 first:border-l-0"
                >
                  <div className="text-[11px] uppercase tracking-[0.06em] text-t4">
                    {fato.l}
                  </div>
                  <div className="mt-[3px] truncate text-[12.5px] font-semibold text-ink">
                    {fato.v}
                  </div>
                  <div className="mt-px break-all font-mono text-[10.5px] text-t3">
                    {fato.sub}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-[7px] px-[17px] py-[13px]">
              <div className="mb-px text-[11px] uppercase tracking-[0.06em] text-t4">
                Lojas de checkout
              </div>
              {alvos.map((alvo) => {
                const estado = targetState(alvo);
                const viva = !parada && estado === "ok";
                const fatia = parada ? 0 : alvo.sharePercent;
                const ocupado = ocupadoId === alvo.id;
                return (
                  <div key={alvo.id} className="flex items-center gap-[9px]">
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: parada ? "var(--t4)" : COR_ALVO[estado] }}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">
                      {alvo.name}
                    </span>
                    <span
                      className="shrink-0 whitespace-nowrap text-[11.5px]"
                      style={{ color: parada ? "var(--t3)" : COR_ALVO[estado] }}
                    >
                      {parada ? "Parada" : TEXTO_ALVO[estado]}
                    </span>

                    <span className="h-1 min-w-[36px] flex-1 basis-[60px] overflow-hidden rounded-[3px] bg-[var(--track)]">
                      <span
                        className="block h-1 rounded-[3px] transition-[width] duration-300"
                        style={{
                          width: `${fatia}%`,
                          background: viva ? "var(--solid)" : "var(--border-strong)",
                        }}
                      />
                    </span>

                    {editando ? (
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={alvo.sharePercent}
                        disabled={!alvo.enabled || ocupado || parada}
                        onChange={(e) => mudarFatia(alvo, Number(e.target.value))}
                        className="h-[24px] w-14 shrink-0 rounded-md border border-[var(--control-border)] bg-surface px-2 text-right font-mono text-[11.5px] tabular-nums text-ink"
                        aria-label={`Porcentagem do tráfego para ${alvo.name}`}
                      />
                    ) : (
                      <span className="w-[34px] shrink-0 text-right font-mono text-[11.5px] tabular-nums text-t1">
                        {fatia}%
                      </span>
                    )}

                    {/* Com a rota parada, mexer numa loja nao muda nada: o
                        botao diz isso em vez de fingir que funciona. */}
                    <button
                      type="button"
                      disabled={ocupado || parada}
                      onClick={() => alternar(alvo)}
                      className="h-6 shrink-0 whitespace-nowrap rounded-[5px] border border-border bg-surface px-2 text-[11.5px] font-semibold transition-colors hover:border-[var(--border-strong)] disabled:opacity-60"
                      style={{ color: parada ? "var(--t4)" : "var(--t2)" }}
                    >
                      {parada ? "Rota parada" : alvo.enabled ? "Parar loja" : "Voltar loja"}
                    </button>
                  </div>
                );
              })}
            </div>

            {editando && (
              <div className="border-t border-[var(--border-subtle)] px-[17px] py-3.5">
                <div className="mb-3 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={dividirIgual}
                    className="text-[12px] text-t2 underline underline-offset-4 hover:text-ink"
                  >
                    Dividir igual
                  </button>
                  <span className="text-[11.5px] text-t3">
                    Mexer numa fatia redistribui as outras para somar 100%.
                  </span>
                </div>
                <RotationPanel
                  routeId={rota.id}
                  sourceStoreId={rota.sourceStoreId}
                  stores={grafo.stores.map((s) => ({
                    id: s.id,
                    name: s.name,
                    shopDomain: s.shopDomain,
                  }))}
                  onChanged={onRecarregar}
                  esconderLista
                />
              </div>
            )}
          </div>
        </div>

        <p className="max-w-[620px] text-pretty text-[12px] text-t3">
          Rota parada não recebe comprador e continua conectada. Os produtos ligados são
          preservados.
        </p>
      </div>

      {manual && (
        <div className="rounded-lg border border-border bg-surface px-4 py-3.5">
          <p className="text-[12px] text-t2">
            Cole no <code className="font-mono text-[11px] text-ink">theme.liquid</code> da
            vitrine, antes de{" "}
            <code className="font-mono text-[11px] text-ink">&lt;/head&gt;</code>.
          </p>
          <pre className="mt-2 overflow-x-auto rounded-md bg-surface-2 p-3 font-mono text-[11px] leading-relaxed text-ink">
            {snippet(rota.publicToken)}
          </pre>
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(snippet(rota.publicToken));
                setCopiado(true);
                setTimeout(() => setCopiado(false), 2000);
              } catch {
                toast.error("O navegador bloqueou a cópia. Selecione o texto e copie.");
              }
            }}
            className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[12px] text-ink hover:border-[var(--border-strong)]"
          >
            {copiado ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copiado ? "Copiado" : "Copiar"}
          </button>
        </div>
      )}

      {diagnostico && (
        <div
          className={cn(
            "rounded-lg border px-4 py-3.5",
            diagnostico.ok
              ? "border-[var(--ok-border)] bg-[var(--ok-bg)]"
              : "border-[var(--err-border)] bg-[var(--err-bg)]"
          )}
        >
          <p className="flex items-baseline gap-2">
            <span className="font-mono text-[20px] font-medium tabular-nums text-ink">
              {diagnostico.coveragePercent}%
            </span>
            <span className="text-[12px] text-t2">
              das variantes têm destino
              {diagnostico.checkedTargetName ? ` em ${diagnostico.checkedTargetName}` : ""}
            </span>
          </p>
          {!diagnostico.ok && (
            <>
              <ul className="mt-1.5 flex flex-col gap-0.5 text-[12px] text-t2">
                {diagnostico.noSkuCount > 0 && (
                  <li>{diagnostico.noSkuCount} variantes sem SKU nunca roteiam.</li>
                )}
                {diagnostico.missingCount > 0 && (
                  <li>{diagnostico.missingCount} SKUs sem par na loja de checkout.</li>
                )}
                {diagnostico.wrongCount > 0 && (
                  <li>
                    {diagnostico.wrongCount} SKUs apontam para a variante errada, o que
                    manda o comprador para outro produto.
                  </li>
                )}
              </ul>
              <button
                type="button"
                onClick={corrigir}
                disabled={consertando}
                className="mt-2.5 inline-flex items-center gap-1.5 rounded-md bg-[var(--solid)] px-3 py-1.5 text-[12px] font-medium text-[var(--on-solid)] disabled:opacity-50"
              >
                {consertando && <Loader2 className="h-3 w-3 animate-spin" />}
                Corrigir agora
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
