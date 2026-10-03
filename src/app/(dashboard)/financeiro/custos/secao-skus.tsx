"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ExternalLinkIcon, HistoryIcon, SearchIcon } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { cn } from "@/components/ui/cn";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataTable, type ColunaTabela } from "@/components/ui/data-table";
import { Dica } from "@/components/ui/dica";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Section } from "@/components/ui/section";
import { Segmented } from "@/components/ui/segmented";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { ROTAS, somarDias, type CustoItemCorpo, type CustosCorpo } from "@/lib/financeiro/tipos";
import type { DadosCustos, SkuVendido } from "@/lib/financeiro/custos-queries";
import { useSincronizarLoja } from "@/app/(dashboard)/stores/usar-sincronizar";
import {
  DIAS_JANELA,
  ROTULO_ORDEM,
  errosDaEdicao,
  filtrarSkus,
  fmtDia,
  fmtInteiro,
  itemDaEdicao,
  mensagemDeFalha,
  opcoesDeMoeda,
  ordenarSkus,
  paginar,
  periodoVigente,
  plural,
  temErro,
  type Edicao,
  type ErrosEdicao,
  type Ordem,
  type Situacao,
} from "./apresentar";
import { HistoricoSku } from "./historico-sku";

// ============================================================================
// (2) Custo por produto: os SKUs vendidos em 60 dias, com o custo e o frete
// por unidade editaveis na propria linha.
//
// Filtro, busca, ordem e pagina sao do cliente (a lista ja veio inteira). A
// ordem segue o que esta GRAVADO, nao o que esta sendo digitado: a linha nao
// pula de lugar no meio da edicao.
//
// Salvar manda so as linhas alteradas, pela rota de sempre (POST
// /api/financeiro/custos, origem "manual", mesmo corpo). A barra de salvar
// gruda no pe da tela enquanto houver alteracao.
// ============================================================================

type Linha = { id: string; s: SkuVendido };

async function lerJson(res: Response): Promise<{ error?: unknown; gravados?: unknown } | null> {
  try {
    return (await res.json()) as { error?: unknown; gravados?: unknown };
  } catch {
    return null;
  }
}

export function SecaoSkus({
  dados,
  loja,
  edicoes,
  iniciais,
  alterados,
  situacaoInicial,
  onEditar,
  onDescartar,
  onSalvo,
}: {
  dados: DadosCustos;
  loja: { id: string; nome: string; dominio: string };
  edicoes: Record<string, Edicao>;
  iniciais: ReadonlyMap<string, Edicao>;
  alterados: string[];
  situacaoInicial: Situacao;
  onEditar: (sku: string, campo: keyof Edicao, valor: string) => void;
  onDescartar: () => void;
  /** Gravou: a tela limpa as alteracoes junto com a releitura. */
  onSalvo: () => void;
}) {
  const router = useRouter();
  const { sincronizar, emCurso } = useSincronizarLoja();
  const [situacao, setSituacao] = useState<Situacao>(situacaoInicial);
  const [busca, setBusca] = useState("");
  const [ordem, setOrdem] = useState<Ordem>("pendentes");
  const [pagina, setPagina] = useState(1);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [historico, setHistorico] = useState<string | null>(null);
  const [recarregando, iniciar] = useTransition();

  const alteradosSet = useMemo(() => new Set(alterados), [alterados]);
  const semCusto = useMemo(() => dados.skus.filter((s) => !s.vigente).length, [dados.skus]);
  const filtradas = useMemo(
    () => ordenarSkus(filtrarSkus(dados.skus, { situacao, busca, alterados: alteradosSet }), ordem),
    [dados.skus, situacao, busca, alteradosSet, ordem]
  );
  const pag = paginar(filtradas, pagina);
  const desde = somarDias(dados.hoje, -DIAS_JANELA);
  const versoesAbertas = historico ? (dados.skus.find((s) => s.sku === historico)?.versoes ?? []) : [];

  function trocarSituacao(v: Situacao) {
    setSituacao(v);
    setPagina(1);
    // Na URL, para o link poder abrir a tabela ja filtrada (sem ir ao servidor).
    const url = new URL(window.location.href);
    if (v === "semCusto") url.searchParams.set("situacao", v);
    else url.searchParams.delete("situacao");
    window.history.replaceState(null, "", url);
  }

  function edicaoDe(s: SkuVendido): Edicao {
    return edicoes[s.sku] ?? (iniciais.get(s.sku) as Edicao);
  }

  async function salvar() {
    if (salvando) return;
    const itens: CustoItemCorpo[] = [];
    let invalidas = 0;
    for (const sku of alterados) {
      const item = itemDaEdicao(sku, edicoes[sku], dados.moedaLoja);
      if (item) itens.push(item);
      else invalidas += 1;
    }
    if (invalidas > 0) {
      setErro(
        invalidas === 1
          ? "1 linha tem erro. Corrija o campo marcado para salvar."
          : `${fmtInteiro(invalidas)} linhas têm erro. Corrija os campos marcados para salvar.`
      );
      // Mostra so as alteradas e leva o foco ao primeiro campo com erro.
      setSituacao("alterados");
      setBusca("");
      setPagina(1);
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>('[data-custos-tabela] [aria-invalid="true"]')?.focus()
      );
      return;
    }
    if (itens.length === 0) return;
    const corpo: CustosCorpo = { store_id: dados.storeId, origem: "manual", itens };
    setSalvando(true);
    setErro(null);
    try {
      let res: Response;
      try {
        res = await fetch(ROTAS.apiCustos, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(corpo),
        });
      } catch {
        setErro(mensagemDeFalha(null, null));
        return;
      }
      // Sessao vencida: o proxy manda para /login e a resposta "da certo".
      if (!res.ok || res.redirected) {
        setErro(mensagemDeFalha(res.redirected ? 401 : res.status, await lerJson(res), itens.length));
        return;
      }
      toast.success(itens.length === 1 ? "Custo salvo" : `${fmtInteiro(itens.length)} custos salvos`, {
        description: "O lucro já usa os custos novos.",
      });
      if (situacao === "alterados") trocarSituacao("todos");
      // Limpa e rele juntos: a linha nao pisca com o valor antigo.
      iniciar(() => {
        onSalvo();
        router.refresh();
      });
    } finally {
      setSalvando(false);
    }
  }

  const tituloDesde = (
    <span className="inline-flex items-center gap-1">
      Vale desde
      <Dica rotulo="Como funciona o Vale desde">
        Um custo novo vale da data da linha em diante; os pedidos anteriores ficam com o custo antigo. O
        primeiro custo de um produto vale também para os pedidos antigos. Para corrigir um custo errado, use a
        mesma data dele.
      </Dica>
    </span>
  );

  const colunas: ColunaTabela<Linha>[] = [
    {
      chave: "produto",
      titulo: "Produto",
      ordenavel: false,
      className: "min-w-44 max-w-72 whitespace-normal",
      celula: ({ s }) => (
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="break-all font-mono text-dense text-ink">{s.sku}</span>
          {s.unidades === 0 ? <span className="text-label text-t2">Sem venda em 60 dias</span> : null}
        </span>
      ),
    },
    {
      chave: "unidades",
      titulo: "Vendidas",
      alinhar: "direita",
      ordenavel: false,
      celula: ({ s }) => fmtInteiro(s.unidades),
    },
    {
      chave: "custo",
      titulo: "Custo do produto",
      ordenavel: false,
      celula: ({ s }) => {
        const e = edicaoDe(s);
        const erros: ErrosEdicao = alteradosSet.has(s.sku) ? errosDaEdicao(e) : {};
        return (
          <CampoValor
            rotulo={`Custo do produto de ${s.sku}`}
            valor={e.custo}
            erro={erros.custo}
            onMudar={(v) => onEditar(s.sku, "custo", v)}
          />
        );
      },
    },
    {
      chave: "frete",
      titulo: "Frete por unidade",
      ordenavel: false,
      celula: ({ s }) => {
        const e = edicaoDe(s);
        const erros: ErrosEdicao = alteradosSet.has(s.sku) ? errosDaEdicao(e) : {};
        return (
          <CampoValor
            rotulo={`Frete do fornecedor por unidade de ${s.sku}`}
            valor={e.frete}
            erro={erros.frete}
            onMudar={(v) => onEditar(s.sku, "frete", v)}
          />
        );
      },
    },
    {
      chave: "moeda",
      titulo: "Moeda",
      ordenavel: false,
      celula: ({ s }) => {
        const e = edicaoDe(s);
        return (
          <Select value={e.moeda} onValueChange={(v) => v && onEditar(s.sku, "moeda", String(v))}>
            <SelectTrigger
              size="sm"
              aria-label={`Moeda do custo de ${s.sku}`}
              className="num w-full data-[size=sm]:h-ctl-lg sm:w-24 sm:data-[size=sm]:h-ctl-sm"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {opcoesDeMoeda(dados.moedaLoja, e.moeda).map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      },
    },
    {
      chave: "desde",
      titulo: tituloDesde,
      ordenavel: false,
      celula: ({ s }) => {
        const editado = alteradosSet.has(s.sku);
        if (editado && s.vigente) {
          const e = edicaoDe(s);
          return (
            <CampoData
              rotulo={`Vale desde, custo de ${s.sku}`}
              valor={e.desde}
              erro={errosDaEdicao(e).desde}
              onMudar={(v) => onEditar(s.sku, "desde", v)}
            />
          );
        }
        if (editado) return <span className="text-dense text-t1">Todos os pedidos</span>;
        return <span className="text-dense text-t1">{periodoVigente(s, dados.hoje) ?? "—"}</span>;
      },
    },
    {
      chave: "situacao",
      titulo: "Situação",
      ordenavel: false,
      celula: ({ s }) => {
        if (alteradosSet.has(s.sku)) {
          return temErro(errosDaEdicao(edicaoDe(s))) ? (
            <StatusBadge tom="err">Com erro</StatusBadge>
          ) : (
            <StatusBadge tom="info">Alterado</StatusBadge>
          );
        }
        return s.vigente ? <StatusBadge tom="ok">Com custo</StatusBadge> : <StatusBadge tom="warn">Sem custo</StatusBadge>;
      },
    },
    {
      chave: "historico",
      titulo: <span className="sr-only">Histórico</span>,
      alinhar: "direita",
      ordenavel: false,
      celula: ({ s }) =>
        s.versoes.length > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-ctl-lg sm:h-ctl-sm"
            onClick={() => setHistorico(s.sku)}
          >
            <HistoryIcon aria-hidden />
            Histórico
            <span className="sr-only"> de {s.sku}</span>
          </Button>
        ) : null,
    },
  ];

  const lerPedidos = (
    <Button variant="secondary" size="sm" pending={emCurso === loja.id} onClick={() => void sincronizar(loja)}>
      Ler pedidos agora
    </Button>
  );

  const limparFiltros = () => {
    setBusca("");
    trocarSituacao("todos");
  };

  let vazioFiltrado = (
    <EmptyState
      variante="simples"
      className="min-h-45 border-t border-border-subtle"
      titulo={busca ? `Nenhum produto com “${busca}”` : "Nenhum produto com esse filtro"}
      descricao="Busque pelo SKU ou mude o filtro."
      acao={
        <Button variant="secondary" onClick={limparFiltros}>
          Limpar filtros
        </Button>
      }
    />
  );
  if (!busca && situacao === "semCusto") {
    vazioFiltrado = (
      <EmptyState
        variante="simples"
        className="min-h-45 border-t border-border-subtle"
        titulo="Todos os produtos vendidos têm custo"
        descricao="O lucro desta loja já desconta o custo de cada venda."
        acao={
          <Button variant="secondary" onClick={limparFiltros}>
            Ver todos
          </Button>
        }
      />
    );
  }

  return (
    <>
      <Section
        espaco="nenhum"
        aria-busy={recarregando || undefined}
        titulo="Custo por produto"
        descricao={`Vendidos desde ${fmtDia(desde)} (60 dias). Custo e frete por unidade, na moeda em que você paga o fornecedor.`}
        acoes={
          dados.skus.length > 0 ? (
            semCusto > 0 ? (
              <StatusBadge tom="warn" tamanho="md">
                {fmtInteiro(semCusto)} sem custo
              </StatusBadge>
            ) : (
              <StatusBadge tom="ok" tamanho="md">
                Todos com custo
              </StatusBadge>
            )
          ) : null
        }
      >
        {dados.unidadesSemSku > 0 || (!dados.sincronizado && dados.skus.length > 0) ? (
          <div className="flex flex-col gap-3 px-4">
            {dados.unidadesSemSku > 0 ? (
              <Callout
                tom="warn"
                titulo={`${plural(dados.unidadesSemSku, "unidade vendida", "unidades vendidas")} sem SKU nos últimos 60 dias`}
                acao={
                  <a
                    href={`https://${loja.dominio}/admin/products`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
                  >
                    Abrir produtos na Shopify
                    <ExternalLinkIcon aria-hidden />
                    <span className="sr-only">(abre em outra aba)</span>
                  </a>
                }
              >
                Sem SKU não dá para lançar custo. Cadastre o SKU da variante na Shopify, sem apagar a variante.
              </Callout>
            ) : null}
            {!dados.sincronizado && dados.skus.length > 0 ? (
              <Callout tom="info" titulo="Os pedidos desta loja ainda não foram lidos" acao={lerPedidos}>
                Por enquanto a tabela mostra só os custos já lançados. Os produtos vendidos chegam em até 15 minutos.
              </Callout>
            ) : null}
          </div>
        ) : null}

        {dados.skus.length === 0 ? (
          dados.sincronizado ? (
            <EmptyState
              variante="simples"
              className="min-h-45 border-t border-border-subtle"
              titulo="Nenhuma venda com SKU nos últimos 60 dias"
              descricao="Os produtos aparecem aqui depois da primeira venda."
              acao={
                <a href="#planilha" className={buttonVariants({ variant: "secondary" })}>
                  Lançar pela planilha
                </a>
              }
            />
          ) : (
            <EmptyState
              variante="simples"
              className="min-h-45 border-t border-border-subtle"
              titulo="Os produtos vendidos ainda não chegaram"
              descricao="Eles aparecem depois da primeira leitura de pedidos, em até 15 minutos."
              acao={lerPedidos}
            />
          )
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 border-b border-border-subtle px-4 pb-3">
              <Segmented
                rotulo="Mostrar produtos"
                valor={situacao}
                onValorChange={trocarSituacao}
                tamanho="md"
                opcoes={[
                  { valor: "todos", rotulo: `Todos (${fmtInteiro(dados.skus.length)})` },
                  { valor: "semCusto", rotulo: `Sem custo (${fmtInteiro(semCusto)})` },
                  {
                    valor: "alterados",
                    rotulo: `Alterados (${fmtInteiro(alterados.length)})`,
                    desabilitado: alterados.length === 0 && situacao !== "alterados",
                    motivo: "nenhuma alteração por salvar",
                  },
                ]}
              />
              <div className="relative min-w-48 flex-1 sm:max-w-72">
                <SearchIcon
                  aria-hidden
                  className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-t3"
                />
                <Input
                  type="search"
                  value={busca}
                  onChange={(e) => {
                    setBusca(e.target.value);
                    setPagina(1);
                  }}
                  aria-label="Buscar produto pelo SKU"
                  placeholder="Buscar pelo SKU"
                  className="h-ctl-lg pl-8 text-dense sm:h-ctl-md"
                />
              </div>
              <Select
                value={ordem}
                onValueChange={(v) => {
                  if (v) {
                    setOrdem(v as Ordem);
                    setPagina(1);
                  }
                }}
              >
                <SelectTrigger aria-label="Ordenar produtos" className="h-ctl-lg w-full sm:h-ctl-md sm:w-48">
                  <SelectValue>{(v: string) => ROTULO_ORDEM[v as Ordem] ?? v}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(ROTULO_ORDEM) as Ordem[]).map((o) => (
                    <SelectItem key={o} value={o}>
                      {ROTULO_ORDEM[o]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div data-custos-tabela>
              <DataTable
                legenda={`Custo por produto vendido desde ${fmtDia(desde)}`}
                colunas={colunas}
                linhas={pag.itens.map((s) => ({ id: s.sku, s }))}
                className="[&>ul]:pt-3"
                vazio={vazioFiltrado}
              />
            </div>

            {pag.total > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle px-4 py-2.5">
                <p className="text-label text-t2">
                  <span className="num">
                    {fmtInteiro(pag.de)}–{fmtInteiro(pag.ate)}
                  </span>{" "}
                  de {plural(pag.total, "produto", "produtos")}. O xcart converte cada moeda pela cotação do dia do
                  pedido.
                </p>
                {pag.paginas > 1 ? (
                  <nav aria-label="Páginas da tabela" className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="h-ctl-lg sm:h-ctl-sm"
                      disabled={pag.pagina <= 1}
                      onClick={() => setPagina(pag.pagina - 1)}
                    >
                      Anterior
                    </Button>
                    <span className="num text-label text-t2" aria-live="polite">
                      Página {pag.pagina} de {pag.paginas}
                    </span>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="h-ctl-lg sm:h-ctl-sm"
                      disabled={pag.pagina >= pag.paginas}
                      onClick={() => setPagina(pag.pagina + 1)}
                    >
                      Próxima
                    </Button>
                  </nav>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </Section>

      {alterados.length > 0 ? (
        <BarraSalvar
          total={alterados.length}
          erro={erro}
          salvando={salvando || recarregando}
          onSalvar={() => void salvar()}
          onDescartar={() => {
            setErro(null);
            if (situacao === "alterados") trocarSituacao("todos");
            onDescartar();
          }}
        />
      ) : null}

      <HistoricoSku
        sku={historico}
        versoes={versoesAbertas}
        hoje={dados.hoje}
        temCustoPadrao={dados.config?.custo_padrao_pct != null}
        onFechar={() => setHistorico(null)}
      />
    </>
  );
}

/** "N alterações · Descartar · Salvar", grudada no pe da tela (acima da barra do celular). */
function BarraSalvar({
  total,
  erro,
  salvando,
  onSalvar,
  onDescartar,
}: {
  total: number;
  erro: string | null;
  salvando: boolean;
  onSalvar: () => void;
  onDescartar: () => void;
}) {
  return (
    <div
      role="region"
      aria-label="Alterações não salvas"
      className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-border-strong bg-surface px-4 py-3 shadow-overlay md:bottom-4"
    >
      <div className="flex min-w-0 flex-1 basis-64 flex-col gap-0.5">
        <p className="text-dense font-semibold text-ink">
          {plural(total, "alteração não salva", "alterações não salvas")}
        </p>
        {erro ? (
          <p role="alert" className="text-label font-medium text-err">
            {erro}
          </p>
        ) : (
          <p className="text-label text-t2">
            Cada custo novo vale da data da linha em diante; os pedidos anteriores ficam com o custo antigo.
          </p>
        )}
      </div>
      <div className="flex w-full items-center gap-2 sm:w-auto">
        <ConfirmDialog
          gatilho={
            <Button variant="ghost" disabled={salvando} className="h-ctl-lg flex-1 sm:h-ctl-md sm:flex-none">
              Descartar
            </Button>
          }
          titulo={total === 1 ? "Descartar 1 alteração?" : `Descartar ${fmtInteiro(total)} alterações?`}
          descricao="Os custos voltam ao que está salvo. O que você digitou e não salvou se perde."
          confirmar="Descartar alterações"
          cancelar="Continuar editando"
          onConfirmar={onDescartar}
        />
        <Button pending={salvando} onClick={onSalvar} className="h-ctl-lg flex-1 sm:h-ctl-md sm:flex-none">
          {salvando ? "Salvando…" : total === 1 ? "Salvar alteração" : `Salvar ${fmtInteiro(total)} alterações`}
        </Button>
      </div>
    </div>
  );
}

/** Campo de dinheiro da linha: aceita virgula, erro embaixo ligado por aria-describedby. */
function CampoValor({
  rotulo,
  valor,
  erro,
  onMudar,
}: {
  rotulo: string;
  valor: string;
  erro?: string;
  onMudar: (v: string) => void;
}) {
  const id = useId();
  return (
    <span className="flex w-full flex-col items-stretch gap-1 sm:w-24">
      <Input
        value={valor}
        onChange={(e) => onMudar(e.target.value)}
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        placeholder="0,00"
        aria-label={rotulo}
        aria-invalid={erro ? true : undefined}
        aria-describedby={erro ? id : undefined}
        className="num h-ctl-lg text-right text-dense sm:h-ctl-sm"
      />
      {erro ? (
        <span id={id} className="text-label font-medium whitespace-normal text-err">
          {erro}
        </span>
      ) : null}
    </span>
  );
}

function CampoData({
  rotulo,
  valor,
  erro,
  onMudar,
}: {
  rotulo: string;
  valor: string;
  erro?: string;
  onMudar: (v: string) => void;
}) {
  const id = useId();
  return (
    <span className="flex w-full flex-col gap-1 sm:w-36">
      <Input
        type="date"
        value={valor}
        onChange={(e) => onMudar(e.target.value)}
        aria-label={rotulo}
        aria-invalid={erro ? true : undefined}
        aria-describedby={erro ? id : undefined}
        className="num h-ctl-lg text-dense sm:h-ctl-sm"
      />
      {erro ? (
        <span id={id} className="text-label font-medium text-err">
          {erro}
        </span>
      ) : null}
    </span>
  );
}
