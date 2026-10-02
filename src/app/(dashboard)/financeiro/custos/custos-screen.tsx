"use client";

import { Fragment, useMemo, useState, useTransition, type ChangeEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Download, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { Aviso, Selo } from "@/app/(dashboard)/tracking/selo";
import {
  COOKIE_LOJA,
  ROTAS,
  TODAS,
  linhaDeCookie,
  type ConfigFinanceiraCorpo,
  type CustoItemCorpo,
  type CustosCorpo,
  type LojaDoSeletor,
} from "@/lib/financeiro/tipos";
import { lerNumero, parseCsvCustos, validarCustoItem } from "@/lib/financeiro/csv-custos";
import type { DadosCustos, SkuVendido } from "@/lib/financeiro/custos-queries";

// ============================================================================
// Tela Custos e taxas (cliente).
//
// Tres caixas, na ordem em que o lucro depende delas: a taxa de pagamento vale
// para TODO pedido, o custo por SKU para cada linha, e o CSV e so um atalho
// para lancar muitos custos de uma vez.
//
// Mutacao = fetch para a propria API + toast + router.refresh(): a pagina
// relida do servidor e a fonte da verdade, nada de estado otimista que divirja
// do banco.
// ============================================================================

const FOCO =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/40";
const CAIXA = "rounded-xl border border-border bg-surface";
const CAMPO = cn(
  "h-[28px] min-w-0 rounded-md border border-[var(--control-border)] bg-surface px-2 text-[12px] text-ink placeholder:text-t3 disabled:opacity-50",
  FOCO
);
const BOTAO_PRIMARIO = cn(
  "inline-flex h-[30px] shrink-0 items-center justify-center gap-1.5 rounded-md bg-[var(--solid)] px-[13px] text-[12.5px] font-semibold text-[var(--on-solid)] hover:bg-[var(--solid-hover)] disabled:pointer-events-none disabled:opacity-50",
  FOCO
);
const BOTAO_SECUNDARIO = cn(
  "inline-flex h-[30px] shrink-0 items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-[11px] text-[12.5px] font-semibold text-t1 hover:border-[var(--border-strong)] disabled:pointer-events-none disabled:opacity-50",
  FOCO
);
const BOTAO_LINHA = cn(
  "inline-flex h-7 shrink-0 items-center gap-1 rounded-[5px] border border-border bg-surface px-2 text-[11.5px] font-semibold text-t2 hover:border-[var(--border-strong)] hover:text-ink disabled:opacity-50 sm:h-6",
  FOCO
);

/** Moedas oferecidas no select de custo: as de fornecedor mais comuns. */
const MOEDAS_FORNECEDOR = ["USD", "BRL", "EUR", "CNY"];

/** Numero para campo de texto, no formato brasileiro (virgula). */
function paraCampo(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  return String(n).replace(".", ",");
}

function fmt(n: number, casas = 2): string {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

function fmtInteiro(n: number): string {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

/** "2026-09-01" -> "01/09/2026", sem passar por Date (fuso nao importa aqui). */
function fmtDia(dia: string): string {
  const [a, m, d] = dia.split("-");
  return a && m && d ? `${d}/${m}/${a}` : dia;
}

/**
 * Fora do componente: o lint do React Compiler recusa escrever em global
 * dentro do corpo de um componente, e o cookie do filtro e justamente isso.
 */
function gravarLojaNoFiltro(valor: string) {
  document.cookie = linhaDeCookie(COOKIE_LOJA, valor);
}

function semMyshopify(dominio: string): string {
  return dominio.replace(/\.myshopify\.com$/i, "");
}

async function lerErro(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: string };
    if (j?.error) return j.error;
  } catch {
    // corpo nao e JSON: cai no status
  }
  return `Erro ${res.status}`;
}

function TituloCaixa({ titulo, extra, children }: { titulo: string; extra?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
      <div className="min-w-0">
        <h2 className="text-[14px] font-semibold text-ink">{titulo}</h2>
        {children && <p className="mt-0.5 max-w-[70ch] text-[12px] leading-relaxed text-t2">{children}</p>}
      </div>
      {extra}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Escolher loja (filtro em "todas as lojas")
// ----------------------------------------------------------------------------

export function EscolherLoja({ lojas }: { lojas: LojaDoSeletor[] }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();

  function escolher(id: string) {
    gravarLojaNoFiltro(id);
    iniciar(() => router.refresh());
  }

  return (
    <div className={cn("flex flex-col gap-3 transition-opacity", pendente && "opacity-60")}>
      <div>
        <p className="text-[14px] font-semibold text-ink">Escolha uma loja</p>
        <p className="mt-0.5 max-w-[62ch] text-[12.5px] text-t2">
          Cada loja tem os próprios custos e a própria taxa de pagamento — o mesmo SKU pode vir de
          fornecedores diferentes. Escolha qual configurar.
        </p>
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {lojas.map((l) => (
          <button
            key={l.id}
            type="button"
            disabled={pendente}
            onClick={() => escolher(l.id)}
            className={cn(
              CAIXA,
              "flex min-w-0 flex-col items-start gap-0.5 px-4 py-3 text-left hover:border-[var(--border-strong)] disabled:pointer-events-none",
              FOCO
            )}
          >
            <span className="w-full truncate text-[13px] font-semibold text-ink">{l.nome}</span>
            <span className="w-full truncate font-mono text-[11.5px] text-t3">{semMyshopify(l.dominio)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Tela da loja
// ----------------------------------------------------------------------------

export function CustosScreen({ dados, loja }: { dados: DadosCustos; loja: LojaDoSeletor }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();

  function trocarLoja() {
    gravarLojaNoFiltro(TODAS);
    iniciar(() => router.refresh());
  }

  return (
    <div className={cn("flex flex-col gap-[18px] transition-opacity", pendente && "opacity-60")}>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className="min-w-0 truncate text-[13px] font-semibold text-ink">{loja.nome}</span>
        <span className="min-w-0 truncate font-mono text-[11.5px] text-t3">{semMyshopify(loja.dominio)}</span>
        {dados.moedaLoja && (
          <span className="font-mono text-[11px] text-t3">· {dados.moedaLoja}</span>
        )}
        <button type="button" onClick={trocarLoja} disabled={pendente} className={cn(BOTAO_LINHA, "ml-auto")}>
          Trocar loja
        </button>
      </div>

      <CaixaTaxas dados={dados} />
      <CaixaSkus dados={dados} />
      <CaixaCsv dados={dados} loja={loja} />
    </div>
  );
}

// ----------------------------------------------------------------------------
// (1) Taxa de pagamento e custo padrao
// ----------------------------------------------------------------------------

function CaixaTaxas({ dados }: { dados: DadosCustos }) {
  const router = useRouter();
  const cfg = dados.config;
  const [taxaPct, setTaxaPct] = useState(paraCampo(cfg?.taxa_pct));
  const [taxaFixa, setTaxaFixa] = useState(paraCampo(cfg?.taxa_fixa));
  const [custoPadrao, setCustoPadrao] = useState(paraCampo(cfg?.custo_padrao_pct));
  const [salvando, setSalvando] = useState(false);
  const moeda = dados.moedaLoja ?? "moeda da loja";

  async function salvar() {
    // Vazio na taxa = 0 (loja que nao paga taxa existe: PIX direto, por exemplo).
    const pct = taxaPct.trim() === "" ? 0 : lerNumero(taxaPct);
    const fixa = taxaFixa.trim() === "" ? 0 : lerNumero(taxaFixa);
    const padrao = custoPadrao.trim() === "" ? null : lerNumero(custoPadrao);
    if (!Number.isFinite(pct) || pct < 0 || pct >= 100) {
      toast.error("Taxa percentual inválida: use um número entre 0 e 99,99.");
      return;
    }
    if (!Number.isFinite(fixa) || fixa < 0 || fixa > 10000) {
      toast.error("Taxa fixa inválida: use um número entre 0 e 10.000.");
      return;
    }
    if (padrao !== null && (!Number.isFinite(padrao) || padrao < 0 || padrao > 100)) {
      toast.error("Custo padrão inválido: use um número entre 0 e 100, ou deixe vazio.");
      return;
    }
    const corpo: ConfigFinanceiraCorpo = {
      store_id: dados.storeId,
      taxa_pct: pct,
      taxa_fixa: fixa,
      custo_padrao_pct: padrao,
    };
    setSalvando(true);
    try {
      const res = await fetch(ROTAS.apiConfigFinanceira, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
      if (!res.ok) {
        toast.error(await lerErro(res));
        return;
      }
      toast.success("Taxas salvas.");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha de rede.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <section className={cn(CAIXA, "flex flex-col gap-4 p-4 sm:p-5")}>
      <TituloCaixa
        titulo="Taxa de pagamento e custo padrão"
        extra={
          cfg ? <Selo tom="ok">configurada</Selo> : <Selo tom="warn">não configurada</Selo>
        }
      >
        Se a loja usa Shopify Payments, a taxa real por pedido entra numa próxima versão; por ora
        informe a do seu contrato (Shopify &gt; Configurações &gt; Pagamentos).
      </TituloCaixa>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11.5px] font-medium text-t2">Taxa percentual (%)</span>
          <input
            inputMode="decimal"
            value={taxaPct}
            onChange={(e) => setTaxaPct(e.target.value)}
            placeholder="ex.: 3,99"
            className={cn(CAMPO, "font-mono tabular-nums")}
          />
          <span className="text-[10.5px] text-t3">sobre o valor recebido de cada pedido</span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11.5px] font-medium text-t2">Taxa fixa por pedido ({moeda})</span>
          <input
            inputMode="decimal"
            value={taxaFixa}
            onChange={(e) => setTaxaFixa(e.target.value)}
            placeholder="ex.: 0,39"
            className={cn(CAMPO, "font-mono tabular-nums")}
          />
          <span className="text-[10.5px] text-t3">na moeda da loja</span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11.5px] font-medium text-t2">Custo padrão (% do preço)</span>
          <input
            inputMode="decimal"
            value={custoPadrao}
            onChange={(e) => setCustoPadrao(e.target.value)}
            placeholder="vazio = não estimar"
            className={cn(CAMPO, "font-mono tabular-nums")}
          />
          <span className="text-[10.5px] text-t3">
            usado só para SKU sem custo cadastrado; vazio = a tela de lucro mostra quanto ficou sem custo
          </span>
        </label>
      </div>

      <div className="flex justify-end">
        <button type="button" onClick={salvar} disabled={salvando} className={BOTAO_PRIMARIO}>
          {salvando ? "Salvando…" : "Salvar taxas"}
        </button>
      </div>
    </section>
  );
}

// ----------------------------------------------------------------------------
// (2) Custos por SKU
// ----------------------------------------------------------------------------

interface Edicao {
  custo: string;
  frete: string;
  moeda: string;
  desde: string;
}

/**
 * Campo type=number so aceita ponto: "12,5" no value vira campo vazio. Por isso
 * aqui o numero vai com ponto, e paraCampo (virgula) fica para texto e CSV.
 */
function paraCampoNumero(n: number): string {
  return Number.isFinite(n) ? String(n) : "";
}

function valoresIniciais(s: SkuVendido, moedaLoja: string | null, hoje: string): Edicao {
  return {
    custo: s.vigente ? paraCampoNumero(s.vigente.custo_unitario) : "",
    frete: s.vigente ? paraCampoNumero(s.vigente.frete_unitario) : "",
    moeda: s.vigente?.moeda ?? moedaLoja ?? "USD",
    desde: hoje,
  };
}

function mudou(a: Edicao, b: Edicao): boolean {
  return a.custo !== b.custo || a.frete !== b.frete || a.moeda !== b.moeda || a.desde !== b.desde;
}

function CaixaSkus({ dados }: { dados: DadosCustos }) {
  const router = useRouter();
  const [edicoes, setEdicoes] = useState<Record<string, Edicao>>({});
  const [abertos, setAbertos] = useState<Set<string>>(() => new Set());
  const [salvando, setSalvando] = useState(false);
  const [apagando, setApagando] = useState<string | null>(null);

  const iniciais = useMemo(() => {
    const m = new Map<string, Edicao>();
    for (const s of dados.skus) m.set(s.sku, valoresIniciais(s, dados.moedaLoja, dados.hoje));
    return m;
  }, [dados.skus, dados.moedaLoja, dados.hoje]);

  const editados = useMemo(
    () =>
      Object.entries(edicoes).filter(([sku, e]) => {
        const ini = iniciais.get(sku);
        return ini ? mudou(e, ini) : false;
      }),
    [edicoes, iniciais]
  );

  const opcoesMoeda = useMemo(() => {
    const lista = [dados.moedaLoja, ...MOEDAS_FORNECEDOR].filter((m): m is string => Boolean(m));
    return [...new Set(lista)];
  }, [dados.moedaLoja]);

  function editar(sku: string, campo: keyof Edicao, valor: string) {
    setEdicoes((atual) => {
      const base = atual[sku] ?? iniciais.get(sku);
      if (!base) return atual;
      return { ...atual, [sku]: { ...base, [campo]: valor } };
    });
  }

  function alternar(sku: string) {
    setAbertos((atual) => {
      const novo = new Set(atual);
      if (novo.has(sku)) novo.delete(sku);
      else novo.add(sku);
      return novo;
    });
  }

  async function salvar() {
    const itens: CustoItemCorpo[] = [];
    for (const [sku, e] of editados) {
      const r = validarCustoItem(
        { sku, custo_unitario: e.custo, frete_unitario: e.frete, moeda: e.moeda, valido_desde: e.desde },
        dados.moedaLoja
      );
      if (!r.ok) {
        toast.error(`${sku}: ${r.motivo}`);
        return;
      }
      itens.push(r.item);
    }
    if (itens.length === 0) return;
    const corpo: CustosCorpo = { store_id: dados.storeId, origem: "manual", itens };
    setSalvando(true);
    try {
      const res = await fetch(ROTAS.apiCustos, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
      if (!res.ok) {
        toast.error(await lerErro(res));
        return;
      }
      toast.success(itens.length === 1 ? "Custo salvo." : `${itens.length} custos salvos.`);
      setEdicoes({});
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha de rede.");
    } finally {
      setSalvando(false);
    }
  }

  async function apagar(id: string, sku: string, desde: string) {
    if (!confirm(`Apagar o custo de ${sku} que vale desde ${fmtDia(desde)}?`)) return;
    setApagando(id);
    try {
      const res = await fetch(`${ROTAS.apiCustos}?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error(await lerErro(res));
        return;
      }
      toast.success("Versão apagada.");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha de rede.");
    } finally {
      setApagando(null);
    }
  }

  const semCusto = dados.skus.filter((s) => !s.vigente && s.unidades > 0).length;

  return (
    <section className={cn(CAIXA, "flex flex-col gap-3.5 p-4 sm:p-5")}>
      <TituloCaixa
        titulo="Custos por SKU"
        extra={
          dados.skus.length > 0 ? (
            semCusto > 0 ? (
              <Selo tom="warn">{fmtInteiro(semCusto)} sem custo</Selo>
            ) : (
              <Selo tom="ok">todos com custo</Selo>
            )
          ) : null
        }
      >
        Custo do produto e frete do fornecedor por unidade, na moeda em que você paga o fornecedor.
        Um custo vale da data em “Vale desde” em diante; pedidos anteriores ficam com o custo antigo.
        O PRIMEIRO custo de um SKU vale também para todos os pedidos anteriores a ele.
      </TituloCaixa>

      {dados.unidadesSemSku > 0 && (
        <Aviso
          tom="warn"
          titulo={`${fmtInteiro(dados.unidadesSemSku)} unidade(s) vendida(s) sem SKU nos últimos 60 dias`}
          detalhe="Sem SKU não dá para atribuir custo: cadastre o SKU da variante na Shopify (sem apagar a variante)."
        />
      )}

      {!dados.sincronizado && (
        <p className="rounded-lg border border-border bg-surface-2 px-3.5 py-2.5 text-[12px] text-t2">
          Os SKUs vendidos aparecem depois da primeira sincronização de pedidos (até 15 min, ou
          Atualizar agora na tela Lucro).
        </p>
      )}

      {dados.skus.length === 0 ? (
        dados.sincronizado ? (
          <div className="rounded-lg border border-dashed border-[var(--border-strong)] px-4 py-8 text-center">
            <p className="text-[13px] font-semibold text-ink">Nenhuma venda com SKU nos últimos 60 dias</p>
            <p className="mx-auto mt-1 max-w-[420px] text-[12px] text-t2">
              Quando a loja vender, os SKUs aparecem aqui para você lançar o custo. Se já sabe os
              custos, lance pelo CSV abaixo.
            </p>
          </div>
        ) : null
      ) : (
        <>
          <div className="-mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
            <table className="w-full min-w-[820px] border-separate border-spacing-0 text-[12px]">
              <thead>
                <tr className="text-left text-[11px] font-medium text-t3">
                  <th className="border-b border-border py-2 pr-3 font-medium">SKU</th>
                  <th className="border-b border-border py-2 pr-3 text-right font-medium">Unidades 60d</th>
                  <th className="border-b border-border py-2 pr-3 font-medium">Custo do produto</th>
                  <th className="border-b border-border py-2 pr-3 font-medium">Frete do fornecedor/un</th>
                  <th className="border-b border-border py-2 pr-3 font-medium">Moeda</th>
                  <th className="border-b border-border py-2 pr-3 font-medium">Vale desde</th>
                  <th className="border-b border-border py-2 font-medium">Situação</th>
                </tr>
              </thead>
              <tbody>
                {dados.skus.map((s) => {
                  const ini = iniciais.get(s.sku) as Edicao;
                  const e = edicoes[s.sku] ?? ini;
                  const editado = mudou(e, ini);
                  const aberto = abertos.has(s.sku);
                  const moedas = opcoesMoeda.includes(e.moeda) ? opcoesMoeda : [...opcoesMoeda, e.moeda];
                  return (
                    <Fragment key={s.sku}>
                      <tr
                        className={cn(editado && "bg-surface-2")}
                        style={editado ? { boxShadow: "inset 3px 0 0 var(--warn)" } : undefined}
                      >
                        <td className="border-b border-border py-2 pl-2 pr-3 align-middle">
                          <div className="flex min-w-0 items-center gap-1.5">
                            {s.versoes.length > 0 ? (
                              <button
                                type="button"
                                onClick={() => alternar(s.sku)}
                                aria-expanded={aberto}
                                aria-label={`Histórico de ${s.sku}`}
                                className={cn("rounded p-0.5 text-t3 hover:text-ink", FOCO)}
                              >
                                {aberto ? (
                                  <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                                ) : (
                                  <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                                )}
                              </button>
                            ) : (
                              <span aria-hidden className="inline-block w-[18px]" />
                            )}
                            <span className="max-w-[220px] truncate font-mono text-[12px] text-ink" title={s.sku}>
                              {s.sku}
                            </span>
                          </div>
                        </td>
                        <td className="border-b border-border py-2 pr-3 text-right align-middle font-mono tabular-nums text-t1">
                          {fmtInteiro(s.unidades)}
                        </td>
                        <td className="border-b border-border py-2 pr-3 align-middle">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            inputMode="decimal"
                            aria-label={`Custo do produto de ${s.sku}`}
                            value={e.custo}
                            onChange={(ev) => editar(s.sku, "custo", ev.target.value)}
                            placeholder="0,00"
                            className={cn(CAMPO, "w-[104px] font-mono tabular-nums")}
                          />
                        </td>
                        <td className="border-b border-border py-2 pr-3 align-middle">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            inputMode="decimal"
                            aria-label={`Frete do fornecedor por unidade de ${s.sku}`}
                            value={e.frete}
                            onChange={(ev) => editar(s.sku, "frete", ev.target.value)}
                            placeholder="0,00"
                            className={cn(CAMPO, "w-[104px] font-mono tabular-nums")}
                          />
                        </td>
                        <td className="border-b border-border py-2 pr-3 align-middle">
                          <select
                            aria-label={`Moeda do custo de ${s.sku}`}
                            value={e.moeda}
                            onChange={(ev) => editar(s.sku, "moeda", ev.target.value)}
                            className={cn(CAMPO, "w-[76px] font-mono")}
                          >
                            {moedas.map((m) => (
                              <option key={m} value={m}>
                                {m}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="border-b border-border py-2 pr-3 align-middle">
                          <input
                            type="date"
                            aria-label={`Vale desde, custo de ${s.sku}`}
                            value={e.desde}
                            onChange={(ev) => editar(s.sku, "desde", ev.target.value)}
                            className={cn(CAMPO, "w-[136px] font-mono tabular-nums")}
                          />
                        </td>
                        <td className="border-b border-border py-2 pr-2 align-middle">
                          {editado ? (
                            <Selo tom="neutro">editado</Selo>
                          ) : s.vigente ? (
                            <Selo tom="ok">com custo</Selo>
                          ) : (
                            <Selo tom="warn">sem custo</Selo>
                          )}
                        </td>
                      </tr>
                      {aberto && s.versoes.length > 0 && (
                        <tr>
                          <td colSpan={7} className="border-b border-border bg-surface-2 px-3 py-2.5">
                            <Historico
                              sku={s.sku}
                              versoes={s.versoes}
                              vigenteId={s.vigente?.id ?? null}
                              apagando={apagando}
                              onApagar={apagar}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            {editados.length > 0 && (
              <button type="button" onClick={() => setEdicoes({})} disabled={salvando} className={BOTAO_SECUNDARIO}>
                Descartar
              </button>
            )}
            <button
              type="button"
              onClick={salvar}
              disabled={salvando || editados.length === 0}
              className={BOTAO_PRIMARIO}
            >
              {salvando ? "Salvando…" : `Salvar alterações (${editados.length})`}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function Historico({
  sku,
  versoes,
  vigenteId,
  apagando,
  onApagar,
}: {
  sku: string;
  versoes: SkuVendido["versoes"];
  vigenteId: string | null;
  apagando: string | null;
  onApagar: (id: string, sku: string, desde: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[11px] font-medium text-t3">Histórico de {sku}</p>
      <table className="w-full max-w-[640px] text-[11.5px]">
        <thead>
          <tr className="text-left text-[10.5px] text-t3">
            <th className="py-1 pr-3 font-medium">Vale desde</th>
            <th className="py-1 pr-3 text-right font-medium">Custo</th>
            <th className="py-1 pr-3 text-right font-medium">Frete</th>
            <th className="py-1 pr-3 font-medium">Moeda</th>
            <th className="py-1 pr-3 font-medium">Origem</th>
            <th className="py-1 font-medium" />
          </tr>
        </thead>
        <tbody>
          {versoes.map((v) => (
            <tr key={v.id}>
              <td className="py-1 pr-3 font-mono tabular-nums text-t1">
                {fmtDia(v.valido_desde)}
                {v.id === vigenteId && <span className="ml-1.5 font-sans text-[10.5px] text-t3">vale hoje</span>}
              </td>
              <td className="py-1 pr-3 text-right font-mono tabular-nums text-t1">{fmt(v.custo_unitario)}</td>
              <td className="py-1 pr-3 text-right font-mono tabular-nums text-t1">{fmt(v.frete_unitario)}</td>
              <td className="py-1 pr-3 font-mono text-t2">{v.moeda}</td>
              <td className="py-1 pr-3 text-t2">{v.origem === "csv" ? "CSV" : "manual"}</td>
              <td className="py-1 text-right">
                <button
                  type="button"
                  disabled={apagando === v.id}
                  onClick={() => onApagar(v.id, sku, v.valido_desde)}
                  className={cn(BOTAO_LINHA, "hover:text-[var(--err)]")}
                >
                  {apagando === v.id ? "Apagando…" : "Apagar"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ----------------------------------------------------------------------------
// (3) Importar CSV
// ----------------------------------------------------------------------------

/** Campo de CSV com ";": aspas so quando precisa (SKU com ";" ou aspas). */
function campoCsv(v: string): string {
  return /[;"\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function CaixaCsv({ dados, loja }: { dados: DadosCustos; loja: LojaDoSeletor }) {
  const router = useRouter();
  const [texto, setTexto] = useState("");
  const [importando, setImportando] = useState(false);
  const moedaPadrao = dados.moedaLoja || "USD";

  const previa = useMemo(
    () => (texto.trim() ? parseCsvCustos(texto, moedaPadrao) : null),
    [texto, moedaPadrao]
  );

  const vendidos = useMemo(
    () => new Set(dados.skus.filter((s) => s.unidades > 0).map((s) => s.sku)),
    [dados.skus]
  );
  const naoVenderam = useMemo(
    () => (previa ? [...new Set(previa.itens.filter((i) => !vendidos.has(i.sku)).map((i) => i.sku))] : []),
    [previa, vendidos]
  );

  function baixarModelo() {
    const linhas = ["sku;custo_unitario;frete_unitario;moeda;valido_desde"];
    for (const s of dados.skus) {
      const v = s.vigente;
      // valido_desde vazio de proposito: reimportar sem mexer na data lanca a
      // versao a partir de hoje, sem reescrever o custo dos pedidos antigos.
      linhas.push(
        [
          campoCsv(s.sku),
          v ? paraCampo(v.custo_unitario) : "",
          v ? paraCampo(v.frete_unitario) : "",
          v?.moeda ?? moedaPadrao,
          "",
        ].join(";")
      );
    }
    // BOM: sem ele o Excel abre UTF-8 como Latin-1 e estraga SKU com acento.
    const blob = new Blob(["﻿" + linhas.join("\r\n") + "\r\n"], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `custos-${loja.dominio || "loja"}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function lerArquivo(ev: ChangeEvent<HTMLInputElement>) {
    const arquivo = ev.target.files?.[0];
    ev.target.value = "";
    if (!arquivo) return;
    if (arquivo.size > 5 * 1024 * 1024) {
      toast.error("Arquivo grande demais (máximo 5 MB).");
      return;
    }
    const leitor = new FileReader();
    leitor.onload = () => setTexto(typeof leitor.result === "string" ? leitor.result : "");
    leitor.onerror = () => toast.error("Não deu para ler o arquivo.");
    leitor.readAsText(arquivo);
  }

  async function importar() {
    if (!previa || previa.itens.length === 0) return;
    const corpo: CustosCorpo = { store_id: dados.storeId, origem: "csv", itens: previa.itens };
    setImportando(true);
    try {
      const res = await fetch(ROTAS.apiCustos, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
      if (!res.ok) {
        toast.error(await lerErro(res));
        return;
      }
      const j = (await res.json().catch(() => ({}))) as { gravados?: number };
      toast.success(`${fmtInteiro(j.gravados ?? previa.itens.length)} custo(s) importado(s).`);
      setTexto("");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha de rede.");
    } finally {
      setImportando(false);
    }
  }

  return (
    <section className={cn(CAIXA, "flex flex-col gap-3.5 p-4 sm:p-5")}>
      <TituloCaixa
        titulo="Importar CSV"
        extra={
          <button type="button" onClick={baixarModelo} className={BOTAO_SECUNDARIO}>
            <Download className="h-3.5 w-3.5" aria-hidden />
            Baixar modelo
          </button>
        }
      >
        Colunas: sku;custo_unitario;frete_unitario;moeda;valido_desde. Decimal com vírgula ou ponto.
        Moeda vazia = {moedaPadrao}; data vazia = hoje. O modelo já vem com os SKUs desta tela.
      </TituloCaixa>

      <div className="flex flex-col gap-2">
        <label className={cn(BOTAO_SECUNDARIO, "w-fit cursor-pointer focus-within:ring-2 focus-within:ring-[var(--brand)]/40")}>
          <Upload className="h-3.5 w-3.5" aria-hidden />
          Escolher arquivo
          <input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={lerArquivo} className="sr-only" />
        </label>
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={6}
          spellCheck={false}
          aria-label="Conteúdo do CSV de custos"
          placeholder={"sku;custo_unitario;frete_unitario;moeda;valido_desde\nCIL-001;12,50;3,20;USD;2026-10-01"}
          className={cn(
            "w-full rounded-md border border-[var(--control-border)] bg-surface px-2.5 py-2 font-mono text-[11.5px] text-ink placeholder:text-t3",
            FOCO
          )}
        />
      </div>

      {previa && (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 px-3.5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Selo tom={previa.itens.length > 0 ? "ok" : "neutro"}>
              {fmtInteiro(previa.itens.length)} válida(s)
            </Selo>
            {previa.erros.length > 0 && <Selo tom="err">{fmtInteiro(previa.erros.length)} com erro</Selo>}
          </div>

          {previa.erros.length > 0 && (
            <ul className="max-h-[160px] overflow-y-auto text-[11.5px] text-t2">
              {previa.erros.slice(0, 100).map((e, i) => (
                <li key={`${e.linha}-${i}`}>
                  <span className="font-mono tabular-nums text-t1">linha {e.linha}</span>: {e.motivo}
                </li>
              ))}
              {previa.erros.length > 100 && <li>… e mais {fmtInteiro(previa.erros.length - 100)}</li>}
            </ul>
          )}

          {naoVenderam.length > 0 && (
            <p className="text-[11.5px] text-t2">
              {fmtInteiro(naoVenderam.length)} SKU(s) não venderam nos últimos 60 dias — serão gravados
              assim mesmo:{" "}
              <span className="font-mono text-t1">
                {naoVenderam.slice(0, 15).join(", ")}
                {naoVenderam.length > 15 ? "…" : ""}
              </span>
            </p>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={importar}
              disabled={importando || previa.itens.length === 0}
              className={BOTAO_PRIMARIO}
            >
              {importando ? "Importando…" : `Importar ${fmtInteiro(previa.itens.length)} custos`}
            </button>
          </div>
        </div>
      )}

      <p className="text-[11.5px] leading-relaxed text-t3">
        Não use o CSV de produtos da Shopify com “sobrescrever” para lançar custo: sem as colunas de
        opção ele apaga as variantes, o que quebra SKU, rota e rastreamento.
      </p>
    </section>
  );
}
