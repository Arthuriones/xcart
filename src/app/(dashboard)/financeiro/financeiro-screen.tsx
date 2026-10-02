"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDownRight, ArrowUpRight, Loader2, RefreshCw } from "lucide-react";
import { Aviso, Selo } from "@/app/(dashboard)/tracking/selo";
import type { Tom } from "@/app/(dashboard)/tracking/saude";
import {
  COOKIE_LOJA,
  PERIODOS,
  ROTAS,
  TODAS,
  formatarDinheiro,
  linhaDeCookie,
  variacaoPct,
  type Intervalo,
  type LojaDoSeletor,
  type SyncResposta,
} from "@/lib/financeiro/tipos";
// So tipos: calculo.ts e queries.ts nao entram no bundle do navegador.
import type { LinhaDia, LinhaLoja, Semaforo, Totais } from "@/lib/financeiro/calculo";
import type { DadosFinanceiro } from "@/lib/financeiro/queries";

type Dados = Extract<DadosFinanceiro, { vazio: false }>;

// ---------------------------------------------------------------------------
// Formatacao
// ---------------------------------------------------------------------------

const SEMAFORO: Record<Semaforo, { tom: Tom; palavra: string }> = {
  verde: { tom: "ok", palavra: "Lucro" },
  amarelo: { tom: "warn", palavra: "No limite" },
  vermelho: { tom: "err", palavra: "Prejuízo" },
  cinza: { tom: "neutro", palavra: "Sem gasto" },
};

const DIA_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** Acima de 10 mil some o centavo: na coluna estreita ele so atrapalha a leitura. */
function dinheiro(v: number, moeda: string): string {
  return formatarDinheiro(v, moeda, Math.abs(v) >= 10000 ? 0 : 2);
}

/** KPI grande: a partir de mil ja sem centavo, para caber em meia tela de 375px. */
function dinheiroKpi(v: number, moeda: string): string {
  return formatarDinheiro(v, moeda, Math.abs(v) >= 1000 ? 0 : 2);
}

function vezes(v: number | null): string {
  if (v === null) return "—";
  return `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 })}×`;
}

function porcento(v: number | null): string {
  if (v === null) return "—";
  return `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

function numero(n: number): string {
  return n.toLocaleString("pt-BR");
}

function dataCurta(dia: string): string {
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
}

function diaDaSemana(dia: string): string {
  return DIA_SEMANA[new Date(`${dia}T12:00:00Z`).getUTCDay()] ?? "";
}

function rotuloIntervalo(i: Intervalo): string {
  return i.desde === i.ate ? dataCurta(i.desde) : `${dataCurta(i.desde)}–${dataCurta(i.ate)}`;
}

/** Nome no banco e velho em algumas lojas: o dominio vai sempre junto. */
function rotuloLoja(l: Pick<LojaDoSeletor, "nome" | "dominio">): string {
  const dominio = String(l.dominio || "").replace(/\.myshopify\.com$/i, "");
  if (!dominio || l.nome === l.dominio || l.nome === dominio) return l.nome || dominio;
  return `${l.nome} · ${dominio}`;
}

/**
 * Hora no fuso do relatorio, nao no do servidor nem no do navegador: o mesmo
 * texto nos dois lados evita erro de hidratacao.
 */
function horaAtualizacao(iso: string | null, fuso: string): string {
  if (!iso) return "Ainda sem sincronização";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "Ainda sem sincronização";
  try {
    const hora = new Intl.DateTimeFormat("pt-BR", {
      timeZone: fuso,
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
    const dia = new Intl.DateTimeFormat("pt-BR", {
      timeZone: fuso,
      day: "2-digit",
      month: "2-digit",
    }).format(d);
    const hoje = new Intl.DateTimeFormat("pt-BR", {
      timeZone: fuso,
      day: "2-digit",
      month: "2-digit",
    }).format(new Date());
    return dia === hoje ? `Atualizado às ${hora}` : `Atualizado em ${dia}, ${hora}`;
  } catch {
    return `Atualizado em ${iso.slice(0, 16).replace("T", " ")}`;
  }
}

// ---------------------------------------------------------------------------
// Pecas
// ---------------------------------------------------------------------------

/**
 * Variacao contra o periodo anterior. `bom` diz qual lado e o bom: subir
 * faturamento e bom, subir gasto nao e bom nem ruim (pode ser escala).
 */
function Variacao({
  atual,
  anterior,
  bom,
}: {
  atual: number | null;
  anterior: number | null;
  bom: "alta" | "neutro";
}) {
  const v = atual === null || anterior === null ? null : variacaoPct(atual, anterior);
  if (v === null || !Number.isFinite(v)) {
    return <span className="text-[11.5px] text-t3">sem base no período anterior</span>;
  }
  const subiu = v > 0;
  const parado = Math.abs(v) < 0.05;
  const cor =
    bom === "neutro" || parado ? "var(--t2)" : subiu ? "var(--ok)" : "var(--err)";
  const Icone = subiu ? ArrowUpRight : ArrowDownRight;
  const texto = Math.abs(v).toLocaleString("pt-BR", {
    maximumFractionDigits: Math.abs(v) < 10 ? 1 : 0,
  });
  return (
    <span className="inline-flex items-center gap-0.5 text-[11.5px] font-medium" style={{ color: cor }}>
      {!parado && <Icone aria-hidden className="h-3.5 w-3.5" />}
      <span className="sr-only">{parado ? "estável" : subiu ? "alta de" : "queda de"}</span>
      <span className="font-mono tabular-nums">{parado ? "0%" : `${texto}%`}</span>
      <span className="font-normal text-t3">&nbsp;vs. anterior</span>
    </span>
  );
}

function Kpi({
  rotulo,
  valor,
  cor,
  palavra,
  dica,
  variacao,
}: {
  rotulo: string;
  valor: string;
  cor?: string;
  palavra?: string;
  dica?: string;
  variacao: ReactNode;
}) {
  return (
    <div className="min-w-0 bg-surface px-3.5 py-3 sm:px-4">
      <div className="truncate text-[11.5px] text-t3">{rotulo}</div>
      <div
        title={valor}
        className="mt-[3px] truncate font-mono text-[22px] font-semibold tracking-[-0.02em] tabular-nums text-ink"
        style={cor ? { color: cor } : undefined}
      >
        {valor}
      </div>
      {/* A palavra fica na linha de baixo: em 375px, valor e palavra lado a
          lado cortariam o numero. */}
      {(palavra || dica) && (
        <div className="mt-0.5 truncate text-[11.5px] text-t3">
          {palavra && (
            <span className="font-medium" style={{ color: cor }}>
              {palavra}
            </span>
          )}
          {palavra && dica && " · "}
          {dica}
        </div>
      )}
      <div className="mt-1">{variacao}</div>
    </div>
  );
}

function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section>
      <div className="mb-[9px] flex items-center gap-2.5">
        <h2 className="text-[13px] font-semibold text-ink">{titulo}</h2>
        <span className="h-px flex-1 bg-border" />
      </div>
      {children}
    </section>
  );
}

const NUM = "font-mono text-[12px] tabular-nums text-ink";

// ---------------------------------------------------------------------------
// Tela
// ---------------------------------------------------------------------------

export function FinanceiroScreen({ dados }: { dados: Dados }) {
  const router = useRouter();
  const [pendente, startTransition] = useTransition();
  const [sincronizando, setSincronizando] = useState(false);

  const { resultado: r, filtro } = dados;
  const moeda = r.moeda;
  const din = (v: number) => dinheiro(v, moeda);
  const periodo = PERIODOS.find((p) => p.id === filtro.periodo)?.rotulo ?? "";
  const lojaPorId = new Map(dados.lojas.map((l) => [l.id, l]));

  function trocarLoja(lojaId: string) {
    // Mesmo cookie do seletor do topo: a escolha vale para as outras telas.
    document.cookie = linhaDeCookie(COOKIE_LOJA, lojaId);
    startTransition(() => router.refresh());
  }

  async function atualizarAgora() {
    if (sincronizando) return;
    setSincronizando(true);
    const chamar = async (url: string): Promise<SyncResposta> => {
      const res = await fetch(url, { method: "POST" });
      let corpo: Partial<SyncResposta> & { erro?: string; error?: string } = {};
      try {
        corpo = await res.json();
      } catch {
        // corpo vazio ou HTML: o status diz o que houve.
      }
      if (!res.ok) throw new Error(corpo.erro || corpo.error || `erro ${res.status}`);
      return {
        ok: Boolean(corpo.ok),
        processadas: Number(corpo.processadas) || 0,
        puladas: Number(corpo.puladas) || 0,
        erros: Array.isArray(corpo.erros) ? corpo.erros : [],
      };
    };

    try {
      const [pedidos, meta] = await Promise.allSettled([
        chamar(ROTAS.apiSyncPedidos),
        chamar(ROTAS.apiSyncMeta),
      ]);
      const linhas: string[] = [];
      let falhou = false;
      const descrever = (nome: string, unidade: string, res: PromiseSettledResult<SyncResposta>) => {
        if (res.status === "rejected") {
          falhou = true;
          const msg = res.reason instanceof Error ? res.reason.message : String(res.reason);
          linhas.push(`${nome}: não atualizou (${msg})`);
          return;
        }
        const v = res.value;
        if (v.erros.length) falhou = true;
        linhas.push(
          `${nome}: ${v.processadas} ${unidade}` +
            (v.erros.length ? ` · ${v.erros.length} com erro: ${v.erros.slice(0, 2).join("; ")}` : "")
        );
      };
      descrever("Pedidos", "loja(s) lida(s)", pedidos);
      descrever("Meta", "conta(s) lida(s)", meta);
      if (falhou) toast.warning("Atualização incompleta", { description: linhas.join("\n") });
      else toast.success("Números atualizados", { description: linhas.join("\n") });
    } finally {
      setSincronizando(false);
      startTransition(() => router.refresh());
    }
  }

  // --- Avisos acionaveis --------------------------------------------------
  const avisos: {
    chave: string;
    tom: "err" | "warn";
    titulo: ReactNode;
    detalhe?: ReactNode;
    acao?: { rotulo: string; onClick?: () => void; href?: string };
  }[] = [];

  const estadoPorLoja = new Map(dados.estados.map((e) => [e.store_id, e]));
  const carregando = dados.lojaIds.filter((id) => {
    const e = estadoPorLoja.get(id);
    // Loja com erro (negado ou falhou) fica so com o aviso de erro dela: uma
    // loja morta nao pode prender o "ainda puxando" para sempre.
    return !e || (!e.carga_inicial_ok && !e.ultimo_erro);
  });
  if (carregando.length > 0) {
    avisos.push({
      chave: "carga",
      tom: "warn",
      titulo:
        "Ainda estamos puxando os pedidos da Shopify (até 60 dias). Os números vão completar nas próximas rodadas.",
      detalhe:
        dados.lojaIds.length > 1
          ? `Faltam: ${carregando.map((id) => rotuloLoja(lojaPorId.get(id) ?? { nome: id, dominio: "" })).join(", ")}.`
          : undefined,
      acao: { rotulo: sincronizando ? "Atualizando…" : "Atualizar agora", onClick: atualizarAgora },
    });
  }
  // UM aviso por tipo de erro, com as lojas listadas -- nao um por loja. A
  // conta do Arthur tinha 7 lojas antigas cadastradas (pausada, app
  // desinstalado, token velho), e a home virava uma parede de caixas
  // vermelhas por lojas que ele nem usa mais.
  const nomeDe = (id: string) => {
    const loja = lojaPorId.get(id);
    return loja ? rotuloLoja(loja) : id;
  };
  const negadas = dados.estados.filter((e) => e.ultimo_erro_tipo === "negado");
  const falharam = dados.estados.filter(
    (e) => e.ultimo_erro_tipo !== "negado" && e.ultimo_erro
  );
  if (negadas.length > 0) {
    avisos.push({
      chave: "negado",
      tom: "warn",
      titulo:
        negadas.length === 1
          ? `A Shopify não deixa ler os pedidos de ${nomeDe(negadas[0].store_id)}.`
          : `A Shopify não deixa ler os pedidos de ${negadas.length} lojas: ${negadas.map((e) => nomeDe(e.store_id)).join(", ")}.`,
      detalhe:
        "Loja pausada ou sem plano, app desinstalado, token vencido ou sem a permissão de pedidos. O faturamento delas fica de fora. Se não usa mais, desconecte em Lojas; se usa, reconecte.",
      acao: { rotulo: "Abrir Lojas", href: "/stores" },
    });
  }
  if (falharam.length > 0) {
    avisos.push({
      chave: "falhou",
      tom: "warn",
      titulo:
        falharam.length === 1
          ? `Os pedidos de ${nomeDe(falharam[0].store_id)} não atualizaram na última rodada.`
          : `Os pedidos de ${falharam.length} lojas não atualizaram na última rodada: ${falharam.map((e) => nomeDe(e.store_id)).join(", ")}.`,
      detalhe: falharam[0].ultimo_erro,
    });
  }

  if (dados.contas.total === 0 || dados.contas.semLoja > 0) {
    avisos.push({
      chave: "contas",
      tom: "warn",
      titulo: "Conecte e ligue suas contas de anúncio para o gasto entrar no lucro.",
      detalhe:
        dados.contas.total === 0
          ? "Sem gasto, o lucro mostrado é o que sobra antes do anúncio."
          : `${dados.contas.semLoja === 1 ? "1 conta ainda não está ligada" : `${dados.contas.semLoja} contas ainda não estão ligadas`} a nenhuma loja: o gasto fica de fora.`,
      acao: { rotulo: "Contas de anúncio", href: ROTAS.anuncios },
    });
  }
  for (const c of dados.contas.comErro) {
    avisos.push({
      chave: `conta-erro-${c.nome}`,
      tom: "err",
      titulo: `${c.nome}: o gasto não está sendo lido.`,
      detalhe: c.erro,
      acao: { rotulo: "Contas de anúncio", href: ROTAS.anuncios },
    });
  }
  if (dados.contas.googleSemDado3h.length > 0) {
    avisos.push({
      chave: "google-3h",
      tom: "warn",
      titulo: `O script do Google não manda dados há mais de 3 horas: ${dados.contas.googleSemDado3h.join(", ")}.`,
      detalhe: "Confira se o script está colado e agendado de hora em hora na conta do Google Ads.",
      acao: { rotulo: "Contas de anúncio", href: ROTAS.anuncios },
    });
  }

  const cobertura = r.atual.coberturaCusto;
  if (cobertura !== null && cobertura < 0.95) {
    const falta = porcento(1 - cobertura);
    const semNada = r.avisos.lojasSemCustoPadraoComFalta.length > 0;
    avisos.push({
      chave: "cobertura",
      tom: "warn",
      titulo: semNada
        ? `${falta} da receita está sem custo cadastrado: o lucro está inflado.`
        : `${falta} da receita usa o custo padrão estimado, não o custo real do SKU.`,
      detalhe: semNada
        ? `Sem custo e sem custo padrão: ${r.avisos.lojasSemCustoPadraoComFalta.join(", ")}.`
        : undefined,
      acao: { rotulo: "Cadastrar custos", href: ROTAS.custos },
    });
  }
  if (r.avisos.lojasSemTaxa.length > 0) {
    avisos.push({
      chave: "taxa",
      tom: "warn",
      titulo: `Taxa de pagamento não configurada em: ${r.avisos.lojasSemTaxa.join(", ")}.`,
      detalhe: "Sem ela, o lucro não desconta o que o gateway cobra de cada venda.",
      acao: { rotulo: "Configurar taxa", href: ROTAS.custos },
    });
  }
  if (r.avisos.moedasSemCotacao.length > 0) {
    avisos.push({
      chave: "sem-cotacao",
      tom: "warn",
      titulo: `Valores em ${r.avisos.moedasSemCotacao.join(", ")} ficaram de fora: não há cotação para essa moeda.`,
      detalhe: "Preferimos um total menor e honesto a somar moedas diferentes como se fossem iguais.",
    });
  }
  if (r.avisos.cambioAproximado) {
    avisos.push({
      chave: "cambio",
      tom: "warn",
      titulo: "Câmbio aproximado (sem cotação do dia)",
      detalhe:
        "Parte dos valores foi convertida por uma tabela fixa. Os números se ajustam quando a cotação do dia chegar.",
    });
  }
  if (r.avisos.fusosDiferentes.length > 0) {
    avisos.push({
      chave: "fusos",
      tom: "warn",
      titulo: "Conta de anúncio com fuso diferente do da loja",
      detalhe: (
        <>
          {r.avisos.fusosDiferentes
            .map((f) => `${f.conta} (${f.fusoConta}) × ${f.loja} (${f.fusoLoja})`)
            .join("; ")}
          . O gasto de um dia pode cair no dia vizinho do pedido.
        </>
      ),
    });
  }

  // --- Numeros ------------------------------------------------------------
  const a = r.atual;
  const ant = r.anterior;
  const semMovimento = a.receita === 0 && a.gasto === 0 && a.cmv === 0;
  const corLucro = semMovimento ? undefined : a.lucro < 0 ? "var(--err)" : "var(--ok)";
  const palavraLucro = semMovimento ? undefined : a.lucro < 0 ? "prejuízo" : "lucro";

  const mostrarPorLoja = filtro.lojaId === TODAS && dados.lojaIds.length >= 2;
  const maiorLucro = Math.max(1, ...r.porDia.map((d) => Math.abs(d.lucro)));

  return (
    <div
      className="flex flex-col gap-[18px] transition-opacity"
      style={{ opacity: pendente ? 0.6 : 1 }}
      aria-busy={pendente || undefined}
    >
      {/* 0) Barra */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="min-w-0 text-[12px] text-t2">
          Período: <span className="font-medium text-ink">{periodo}</span> ·{" "}
          <span className="font-mono tabular-nums">{rotuloIntervalo(r.intervalos.atual)}</span> · valores
          em <span className="font-medium text-ink">{moeda}</span>
          {filtro.lojaId !== TODAS && (
            <>
              {" "}
              ·{" "}
              <button
                type="button"
                onClick={() => trocarLoja(TODAS)}
                className="underline underline-offset-2 hover:text-ink"
              >
                ver todas as lojas
              </button>
            </>
          )}
        </p>
        <span className="flex-1" />
        <span className="text-[12px] text-t3">{horaAtualizacao(dados.atualizadoEm, dados.fuso)}</span>
        <button
          type="button"
          onClick={atualizarAgora}
          disabled={sincronizando}
          className="inline-flex h-[28px] items-center gap-1.5 rounded-md border border-[var(--control-border)] bg-surface px-2.5 text-[12px] font-medium text-ink transition-colors hover:border-[var(--border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/40 disabled:opacity-60"
        >
          {sincronizando ? (
            <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw aria-hidden className="h-3.5 w-3.5" />
          )}
          {sincronizando ? "Atualizando…" : "Atualizar agora"}
        </button>
      </div>

      {/* 1) Avisos */}
      {avisos.length > 0 && (
        <div className="flex flex-col gap-2">
          {avisos.map(({ chave, ...av }) => (
            <Aviso key={chave} {...av} />
          ))}
        </div>
      )}

      {/* 2) KPIs */}
      <div>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-[var(--border-subtle)] lg:grid-cols-4">
          <Kpi
            rotulo="Faturamento"
            valor={dinheiroKpi(a.receita, moeda)}
            variacao={<Variacao atual={a.receita} anterior={ant.receita} bom="alta" />}
          />
          <Kpi
            rotulo="Gasto em anúncios"
            valor={dinheiroKpi(a.gasto, moeda)}
            dica={`Meta ${din(a.gastoMeta)} · Google ${din(a.gastoGoogle)}`}
            variacao={<Variacao atual={a.gasto} anterior={ant.gasto} bom="neutro" />}
          />
          <Kpi
            rotulo="Lucro estimado"
            valor={dinheiroKpi(a.lucro, moeda)}
            cor={corLucro}
            palavra={palavraLucro}
            variacao={<Variacao atual={a.lucro} anterior={ant.lucro} bom="alta" />}
          />
          <Kpi
            rotulo="ROAS real"
            valor={vezes(a.roas)}
            dica={a.roasEquilibrio !== null ? `equilíbrio ${vezes(a.roasEquilibrio)}` : "equilíbrio —"}
            variacao={<Variacao atual={a.roas} anterior={ant.roas} bom="alta" />}
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 px-1 text-[12px] text-t3">
          <span>
            Pedidos <span className={NUM}>{numero(a.pedidos)}</span>
            {a.reenvios > 0 && (
              <span className="text-t3">
                {" "}
                + {numero(a.reenvios)} {a.reenvios === 1 ? "reenvio" : "reenvios"}
              </span>
            )}
          </span>
          <span>
            Ticket médio <span className={NUM}>{a.ticket === null ? "—" : din(a.ticket)}</span>
          </span>
          <span>
            CPA <span className={NUM}>{a.cpa === null ? "—" : din(a.cpa)}</span>
          </span>
          <span>
            Margem <span className={NUM}>{porcento(a.margem)}</span>
          </span>
        </div>
      </div>

      {/* 3) Por loja */}
      {mostrarPorLoja && (
        <Secao titulo="Por loja">
          <TabelaLojas
            linhas={r.porLoja}
            total={a}
            din={din}
            onEscolher={trocarLoja}
          />
          <p className="mt-1.5 px-1 text-[11.5px] text-t3">
            Clique numa loja para ver só ela. O semáforo compara o ROAS real com o de
            equilíbrio: abaixo de 1,2× o equilíbrio fica “no limite”.
          </p>
        </Secao>
      )}

      {/* 4) Dia a dia */}
      <Secao titulo="Dia a dia">
        <TabelaDias linhas={r.porDia} din={din} maiorLucro={maiorLucro} />
      </Secao>

      {/* 5) Como calculamos */}
      <details className="rounded-lg border border-border bg-surface px-4 py-3 text-[12.5px] text-t2">
        <summary className="cursor-pointer select-none font-medium text-ink">Como calculamos</summary>
        <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5">
          <li>
            <b className="font-medium text-ink">Faturamento</b> = pago − reembolsado − impostos − taxas
            alfandegárias − gorjetas, na moeda da loja convertida pela cotação do dia. Inclui o frete
            cobrado do cliente. Pedido de teste e de PDV fica de fora; pedido com pagamento pendente
            entra com zero até ser pago.
          </li>
          <li>
            <b className="font-medium text-ink">Produtos + frete</b> = custo do produto + frete do
            fornecedor por unidade, pela versão do custo que valia no dia do pedido. Item cancelado
            antes do envio não custa; reembolso depois do envio continua custando.
          </li>
          <li>
            <b className="font-medium text-ink">Taxas</b> = % + valor fixo por pedido, configurados em
            Custos e taxas (estimativa do gateway).
          </li>
          <li>
            <b className="font-medium text-ink">Gasto</b> = total da conta de anúncio. No Meta inclui
            anúncio apagado ou arquivado; o Google chega pelo script, de hora em hora.
          </li>
          <li>
            <b className="font-medium text-ink">Lucro estimado</b> = faturamento − produtos + frete −
            taxas − gasto. <b className="font-medium text-ink">ROAS real</b> = faturamento ÷ gasto.{" "}
            <b className="font-medium text-ink">ROAS de equilíbrio</b> = faturamento ÷ (faturamento −
            produtos − taxas): abaixo dele, o anúncio dá prejuízo.
          </li>
          <li>
            O dia do pedido segue o fuso da loja; o dia do gasto segue o fuso da conta de anúncio.
          </li>
          <li>Hoje é parcial: os números de hoje ainda vão mudar.</li>
        </ul>
      </details>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabelas
// ---------------------------------------------------------------------------

const GRADE_LOJA =
  "grid min-w-[1060px] grid-cols-[104px_minmax(170px,1.6fr)_64px_minmax(96px,1fr)_minmax(96px,1fr)_68px_84px_minmax(104px,1fr)_64px_minmax(92px,1fr)] items-center gap-3";

function TabelaLojas({
  linhas,
  total,
  din,
  onEscolher,
}: {
  linhas: LinhaLoja[];
  total: Totais;
  din: (v: number) => string;
  onEscolher: (storeId: string) => void;
}) {
  const lucroPorPedido = (t: Totais) => (t.pedidos > 0 ? din(t.lucro / t.pedidos) : "—");
  const corLucro = (t: Totais) => (t.lucro < 0 ? "var(--err)" : t.lucro > 0 ? "var(--ok)" : undefined);
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="overflow-x-auto">
        <div
          className={`${GRADE_LOJA} border-b border-border bg-surface-2 px-3.5 py-2 text-[11px] font-semibold text-t3`}
        >
          <div>Estado</div>
          <div>Loja</div>
          <div className="text-right">Pedidos</div>
          <div className="text-right">Faturamento</div>
          <div className="text-right">Gasto</div>
          <div className="text-right">ROAS real</div>
          <div className="text-right">ROAS equil.</div>
          <div className="text-right">Lucro</div>
          <div className="text-right">Margem</div>
          <div className="text-right">Lucro/pedido</div>
        </div>

        <div className={`${GRADE_LOJA} border-b border-border bg-surface-2 px-3.5 py-2.5`}>
          <div />
          <div className="text-[12px] font-semibold text-t1">Total</div>
          <div className={`${NUM} text-right font-medium`}>{numero(total.pedidos)}</div>
          <div className={`${NUM} text-right font-semibold`}>{din(total.receita)}</div>
          <div className={`${NUM} text-right`}>{din(total.gasto)}</div>
          <div className={`${NUM} text-right`}>{vezes(total.roas)}</div>
          <div className={`${NUM} text-right`}>{vezes(total.roasEquilibrio)}</div>
          <div className={`${NUM} text-right font-semibold`} style={{ color: corLucro(total) }}>
            {din(total.lucro)}
          </div>
          <div className={`${NUM} text-right`}>{porcento(total.margem)}</div>
          <div className={`${NUM} text-right`}>{lucroPorPedido(total)}</div>
        </div>

        {linhas.map((l) => {
          const s = SEMAFORO[l.semaforo];
          return (
            <button
              key={l.storeId}
              type="button"
              onClick={() => onEscolher(l.storeId)}
              title="Ver só esta loja"
              className={`${GRADE_LOJA} min-h-[46px] w-full border-b border-[var(--border-subtle)] px-3.5 py-1.5 text-left transition-colors last:border-b-0 hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none`}
            >
              <div>
                <Selo tom={s.tom}>{s.palavra}</Selo>
              </div>
              <div className="min-w-0">
                <div className="truncate text-[12.5px] font-semibold text-ink">{l.nome}</div>
                <div className="truncate font-mono text-[10.5px] text-t3">{l.dominio}</div>
              </div>
              <div className={`${NUM} text-right`}>{numero(l.pedidos)}</div>
              <div className={`${NUM} text-right`}>{din(l.receita)}</div>
              <div className={`${NUM} text-right`}>{din(l.gasto)}</div>
              <div className={`${NUM} text-right`}>{vezes(l.roas)}</div>
              <div className={`${NUM} text-right`}>{vezes(l.roasEquilibrio)}</div>
              <div className={`${NUM} text-right font-medium`} style={{ color: corLucro(l) }}>
                {din(l.lucro)}
              </div>
              <div className={`${NUM} text-right`}>{porcento(l.margem)}</div>
              <div className={`${NUM} text-right`}>{lucroPorPedido(l)}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const GRADE_DIA =
  "grid min-w-[980px] grid-cols-[112px_60px_minmax(96px,1fr)_minmax(96px,1fr)_minmax(80px,0.8fr)_minmax(88px,0.9fr)_minmax(88px,0.9fr)_minmax(180px,1.6fr)_60px] items-center gap-3";

function TabelaDias({
  linhas,
  din,
  maiorLucro,
}: {
  linhas: LinhaDia[];
  din: (v: number) => string;
  maiorLucro: number;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="overflow-x-auto">
        <div
          className={`${GRADE_DIA} border-b border-border bg-surface-2 px-3.5 py-2 text-[11px] font-semibold text-t3`}
        >
          <div>Dia</div>
          <div className="text-right">Pedidos</div>
          <div className="text-right">Faturamento</div>
          <div className="text-right">Produtos + frete</div>
          <div className="text-right">Taxas</div>
          <div className="text-right">Meta</div>
          <div className="text-right">Google</div>
          <div>Lucro</div>
          <div className="text-right">ROAS</div>
        </div>
        {linhas.map((d) => {
          const tom: Tom = d.lucro < 0 ? "err" : d.lucro > 0 ? "ok" : "neutro";
          const cor = tom === "err" ? "var(--err)" : tom === "ok" ? "var(--ok)" : "var(--t3)";
          const largura = Math.round((Math.abs(d.lucro) / maiorLucro) * 100);
          return (
            <div
              key={d.dia}
              className={`${GRADE_DIA} min-h-[38px] border-b border-[var(--border-subtle)] px-3.5 py-1.5 last:border-b-0`}
            >
              <div className="flex items-baseline gap-1.5">
                <span className="font-mono text-[12px] tabular-nums text-ink">{dataCurta(d.dia)}</span>
                <span className="text-[11.5px] text-t3">
                  {d.parcial ? "hoje · parcial" : diaDaSemana(d.dia)}
                </span>
              </div>
              <div className={`${NUM} text-right`}>{numero(d.pedidos)}</div>
              <div className={`${NUM} text-right`}>{din(d.receita)}</div>
              <div className={`${NUM} text-right text-t2`}>{din(d.cmv)}</div>
              <div className={`${NUM} text-right text-t2`}>{din(d.taxas)}</div>
              <div className={`${NUM} text-right text-t2`}>{din(d.gastoMeta)}</div>
              <div className={`${NUM} text-right text-t2`}>{din(d.gastoGoogle)}</div>
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className="w-[92px] shrink-0 text-right font-mono text-[12px] font-medium tabular-nums"
                  style={{ color: cor }}
                >
                  {din(d.lucro)}
                </span>
                <span aria-hidden className="h-1.5 min-w-[40px] flex-1 overflow-hidden rounded-[3px] bg-[var(--track)]">
                  <span
                    className="block h-1.5 rounded-[3px]"
                    style={{ width: `${largura}%`, background: cor }}
                  />
                </span>
              </div>
              <div className={`${NUM} text-right`}>{vezes(d.roas)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
