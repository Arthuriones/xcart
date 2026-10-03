"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontalIcon, RefreshCwIcon, SearchIcon } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { cn } from "@/components/ui/cn";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataTable, type ColunaTabela } from "@/components/ui/data-table";
import { Dica } from "@/components/ui/dica";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Section } from "@/components/ui/section";
import { Segmented } from "@/components/ui/segmented";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { rotuloFuso } from "@/components/layout/contexto";
import {
  ROTAS,
  type ContaAnuncioResumo,
  type LojaDoSeletor,
  type Plataforma,
  type SyncResposta,
} from "@/lib/financeiro/tipos";
import { chamar } from "./api";
import {
  FILTROS,
  ORDEM_GRUPO,
  casaBusca,
  cidadeDoFuso,
  contarFiltros,
  formatarCustomerId,
  listarNomes,
  passaNoFiltro,
  plural,
  situacaoDaConta,
  type FiltroConta,
  type GastoNaTela,
  type SituacaoConta,
  type TextoGasto,
} from "./regras";
import { ErroLeitura } from "./erro-leitura";

// ============================================================================
// Contas de anuncio de uma plataforma: loja ligada, gasto de hoje e do
// periodo, situacao, ativa e as acoes. A mesma tabela para Meta e Google --
// as duas tem as mesmas acoes agora (Remover nas duas; Sincronizar so no Meta,
// porque o Google e o script que envia).
//
// Trocar a loja e ligar/pausar salvam na hora (PATCH /api/ads/contas/[id], a
// API de sempre) e o aviso traz "Desfazer". A tela mostra a mudanca antes de
// o servidor confirmar e volta sozinha se ele recusar.
// ============================================================================

const NENHUMA = "__nenhuma";

type Mudanca = { store_id?: string | null; ativo?: boolean };

interface Props {
  plataforma: Plataforma;
  contas: ContaAnuncioResumo[];
  lojas: LojaDoSeletor[];
  gastos: Record<string, GastoNaTela>;
  erroGasto: string | null;
  fusosLoja: Record<string, string>;
  erroFuso: string | null;
  lojaFiltrada: string | null;
  agoraMs: number;
  fuso: string;
  moeda: string;
  periodo: string;
  /** Google: o script novo aparece uma vez, no painel da tela. */
  onScript?: (titulo: string, script: string) => void;
}

interface Linha extends Record<string, unknown> {
  id: string;
  conta: ContaAnuncioResumo;
  nome: string;
  situacao: SituacaoConta;
  gasto: GastoNaTela;
  nomeOrdem: string;
  lojaOrdem: string;
  hojeValor: number | null;
  periodoValor: number | null;
  situacaoOrdem: number;
}

type Acao = { tipo: "remover" | "script"; conta: ContaAnuncioResumo; nome: string };

function nomeDaConta(c: ContaAnuncioResumo): string {
  if (c.nome) return c.nome;
  return c.plataforma === "google" ? `Conta ${formatarCustomerId(c.external_id)}` : "Conta sem nome";
}

function idExibido(c: ContaAnuncioResumo): string {
  return c.plataforma === "google" ? formatarCustomerId(c.external_id) : `act_${c.external_id}`;
}

function CelulaGasto({ g, parcial }: { g: TextoGasto | null; parcial?: string | null }) {
  if (!g) {
    return (
      <span className="flex flex-col items-end">
        <span className="text-t2">—</span>
        <span className="text-label text-t2">sem dado lido</span>
      </span>
    );
  }
  const apoio = [g.detalhe, parcial].filter(Boolean).join(" · ");
  return (
    <span className="flex flex-col items-end">
      <span>{g.texto}</span>
      {apoio ? <span className="text-label text-t2">{apoio}</span> : null}
    </span>
  );
}

export function ContasTabela({
  plataforma,
  contas,
  lojas,
  gastos,
  erroGasto,
  fusosLoja,
  erroFuso,
  lojaFiltrada,
  agoraMs,
  fuso,
  moeda,
  periodo,
  onScript,
}: Props) {
  const router = useRouter();
  const [atualizando, startTransition] = useTransition();
  const meta = plataforma === "meta";
  const nomePlataforma = meta ? "Meta" : "Google Ads";

  // Mudanca otimista por conta. Quando o servidor manda a lista nova (refresh),
  // ela ja traz a mudanca e as sobreposicoes saem -- ajuste no render, sem efeito.
  const [contasVistas, setContasVistas] = useState(contas);
  const [sobrepor, setSobrepor] = useState<Record<string, Mudanca>>({});
  if (contasVistas !== contas) {
    setContasVistas(contas);
    setSobrepor({});
  }
  const [salvando, setSalvando] = useState<Record<string, boolean>>({});
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<FiltroConta>("todas");
  const [sincronizando, setSincronizando] = useState(false);
  const [acao, setAcao] = useState<Acao | null>(null);
  const [dialogoAberto, setDialogoAberto] = useState(false);
  const [erroAcao, setErroAcao] = useState<string | null>(null);

  const nomeLoja = new Map(lojas.map((l) => [l.id, l.nome]));
  const atualizar = () => startTransition(() => router.refresh());

  const efetivas = contas.map((c) => ({ ...c, ...sobrepor[c.id] }));
  const linhasTodas: Linha[] = efetivas.map((c) => {
    const situacao = situacaoDaConta(c, agoraMs, fuso);
    const gasto = gastos[c.id] ?? { hoje: null, periodo: null, parcial: null };
    const nome = nomeDaConta(c);
    return {
      id: c.id,
      conta: c,
      nome,
      situacao,
      gasto,
      nomeOrdem: nome.toLocaleLowerCase("pt-BR"),
      lojaOrdem: c.store_id ? (nomeLoja.get(c.store_id) ?? "").toLocaleLowerCase("pt-BR") : "",
      hojeValor: gasto.hoje?.valor ?? null,
      periodoValor: gasto.periodo?.valor ?? null,
      situacaoOrdem: ORDEM_GRUPO[situacao.grupo],
    };
  });
  const contagem = contarFiltros(linhasTodas.map((l) => l.situacao.grupo));
  const linhas = linhasTodas.filter(
    (l) => passaNoFiltro(l.situacao.grupo, filtro) && casaBusca(l.conta, busca)
  );
  const semLoja = linhasTodas.filter((l) => l.situacao.grupo === "semLoja");
  const fusoDiferente = efetivas.filter((c) => {
    const fusoLoja = c.store_id ? fusosLoja[c.store_id] : undefined;
    return Boolean(c.fuso && fusoLoja && c.fuso !== fusoLoja);
  });

  async function salvar(
    c: ContaAnuncioResumo,
    mudanca: Mudanca,
    anterior: Mudanca,
    aviso: { titulo: string; texto: string },
    desfazendo = false
  ) {
    const nome = nomeDaConta(c);
    setSobrepor((s) => ({ ...s, [c.id]: { ...s[c.id], ...mudanca } }));
    setSalvando((s) => ({ ...s, [c.id]: true }));
    const r = await chamar(`${ROTAS.apiContas}/${c.id}`, {
      method: "PATCH",
      body: JSON.stringify(mudanca),
    });
    setSalvando((s) => ({ ...s, [c.id]: false }));
    if (!r.ok) {
      setSobrepor((s) => ({ ...s, [c.id]: { ...s[c.id], ...anterior } }));
      toast.error(`Não deu para salvar ${nome}`, { description: r.erro });
      return;
    }
    if (desfazendo) {
      toast.success("Desfeito", { description: `${nome} voltou como estava.` });
    } else {
      toast(aviso.titulo, {
        description: aviso.texto,
        action: {
          label: "Desfazer",
          onClick: () => void salvar(c, anterior, mudanca, aviso, true),
        },
      });
    }
    atualizar();
  }

  function mudarLoja(c: ContaAnuncioResumo, valor: string | null) {
    const novo = !valor || valor === NENHUMA ? null : valor;
    if (novo === (c.store_id ?? null)) return;
    const nome = nomeDaConta(c);
    void salvar(
      c,
      { store_id: novo },
      { store_id: c.store_id ?? null },
      novo
        ? {
            titulo: `${nome} ligada a ${nomeLoja.get(novo) ?? "loja"}`,
            texto: "O gasto dela passa a contar no lucro dessa loja, inclusive os dias já lidos.",
          }
        : { titulo: `${nome} sem loja`, texto: "O gasto dela sai do lucro até você escolher uma loja." }
    );
  }

  function alternar(c: ContaAnuncioResumo, ativo: boolean) {
    const nome = nomeDaConta(c);
    void salvar(
      c,
      { ativo },
      { ativo: !ativo },
      ativo
        ? {
            titulo: `${nome} ativa de novo`,
            texto: meta
              ? "O xcart volta a ler o gasto dela na próxima leitura."
              : "O xcart volta a aceitar o que o script dela envia.",
          }
        : {
            titulo: `${nome} pausada no xcart`,
            texto: `O xcart para de ${meta ? "ler o gasto dela" : "aceitar o envio do script"}. O que já foi lido continua no lucro. Nada muda no ${nomePlataforma}.`,
          }
    );
  }

  async function sincronizar() {
    setSincronizando(true);
    const r = await chamar<SyncResposta>(ROTAS.apiSyncMeta, { method: "POST" });
    setSincronizando(false);
    if (!r.ok) {
      toast.error("Não deu para sincronizar agora", { description: r.erro });
      return;
    }
    const erros = Array.isArray(r.erros) ? r.erros : [];
    if (erros.length > 0) {
      toast.warning(
        `${plural(r.processadas ?? 0, "conta atualizada", "contas atualizadas")}, ${plural(erros.length, "com erro", "com erro")}`,
        { description: erros[0] }
      );
    } else if ((r.processadas ?? 0) === 0 && (r.puladas ?? 0) > 0) {
      toast("As contas já foram lidas há menos de 1 minuto", {
        description: "O gasto desta tela já está atualizado.",
      });
    } else if ((r.processadas ?? 0) === 0) {
      toast("Nenhuma conta para ler", { description: "Só contas ativas e ligadas a uma loja são lidas." });
    } else {
      toast.success(plural(r.processadas ?? 0, "conta atualizada", "contas atualizadas"));
    }
    atualizar();
  }

  function pedir(tipo: Acao["tipo"], c: ContaAnuncioResumo) {
    setAcao({ tipo, conta: c, nome: nomeDaConta(c) });
    setErroAcao(null);
    setDialogoAberto(true);
  }

  async function executar() {
    if (!acao) return;
    const { conta: c, nome, tipo } = acao;
    if (tipo === "remover") {
      const r = await chamar(`${ROTAS.apiContas}/${c.id}`, { method: "DELETE" });
      if (!r.ok) {
        setErroAcao(r.erro);
        throw new Error(r.erro);
      }
      toast.success(`${nome} removida do xcart`);
      atualizar();
      return;
    }
    const r = await chamar<{ script?: string }>(`${ROTAS.apiGoogleContas}/${c.id}/segredo`, {
      method: "POST",
    });
    if (!r.ok || !r.script) {
      const erro = r.ok ? "O servidor não devolveu o script." : r.erro;
      setErroAcao(erro);
      throw new Error(erro);
    }
    toast.success("Script novo gerado", { description: "Substitua o antigo no Google Ads." });
    onScript?.(`Script novo da conta ${formatarCustomerId(c.external_id)}${c.nome ? ` · ${c.nome}` : ""}`, r.script);
    atualizar();
  }

  const colunas: ColunaTabela<Linha>[] = [
    {
      chave: "conta",
      titulo: "Conta",
      ordenarPor: "nomeOrdem",
      celula: (l) => (
        <span className="flex min-w-0 flex-col">
          <span className="max-w-64 truncate font-medium">{l.nome}</span>
          <span className="font-mono text-label font-normal text-t2">{idExibido(l.conta)}</span>
        </span>
      ),
    },
    {
      chave: "moedaFuso",
      titulo: "Moeda · fuso",
      ordenavel: false,
      celula: (l) => (
        <span className="text-t1">
          {[l.conta.moeda, cidadeDoFuso(l.conta.fuso)].filter(Boolean).join(" · ") || "—"}
        </span>
      ),
    },
    {
      chave: "loja",
      titulo: "Loja ligada",
      ordenarPor: "lojaOrdem",
      celula: (l) => {
        const lojaId = l.conta.store_id ?? null;
        return (
          <Select
            value={lojaId ?? NENHUMA}
            onValueChange={(v) => mudarLoja(l.conta, v)}
            disabled={salvando[l.id]}
          >
            <SelectTrigger
              size="sm"
              aria-label={`Loja ligada a ${l.nome}`}
              className={cn("w-full sm:w-44", !lojaId && "border-warn-border text-warn")}
            >
              <SelectValue>
                {() => (lojaId ? (nomeLoja.get(lojaId) ?? "Loja removida") : "Escolher loja")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {lojas.map((loja) => (
                <SelectItem key={loja.id} value={loja.id}>
                  {loja.nome}
                </SelectItem>
              ))}
              <SelectSeparator />
              <SelectItem value={NENHUMA}>Nenhuma loja</SelectItem>
            </SelectContent>
          </Select>
        );
      },
    },
    {
      chave: "hoje",
      titulo: "Gasto hoje",
      alinhar: "direita",
      ordenarPor: "hojeValor",
      celula: (l) => <CelulaGasto g={l.gasto.hoje} />,
    },
    {
      chave: "periodo",
      titulo: "Gasto no período",
      alinhar: "direita",
      ordenarPor: "periodoValor",
      celula: (l) => <CelulaGasto g={l.gasto.periodo} parcial={l.gasto.parcial} />,
    },
    {
      chave: "situacao",
      titulo: "Situação",
      ordenarPor: "situacaoOrdem",
      direcaoInicial: "asc",
      celula: (l) => {
        const d = l.situacao.detalhe ?? "";
        const longo = d.length > 34;
        return (
          <span className="flex flex-col items-start gap-0.5">
            <StatusBadge tom={l.situacao.tom}>{l.situacao.texto}</StatusBadge>
            {d ? (
              <span className="flex max-w-60 items-center gap-0.5 text-label text-t2">
                <span className="truncate">{d}</span>
                {longo ? <Dica rotulo={`Ver a situação completa de ${l.nome}`}>{d}</Dica> : null}
              </span>
            ) : null}
          </span>
        );
      },
    },
    {
      chave: "ativa",
      titulo: "Ativa",
      ordenavel: false,
      celula: (l) => (
        <Switch
          checked={l.conta.ativo}
          onCheckedChange={(v) => alternar(l.conta, v)}
          disabled={salvando[l.id]}
          aria-label={`${meta ? "Ler o gasto de" : "Aceitar o script de"} ${l.nome}`}
        />
      ),
    },
    {
      chave: "acoes",
      titulo: <span className="sr-only">Ações</span>,
      alinhar: "direita",
      ordenavel: false,
      celula: (l) => (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Mais ações para ${l.nome}`}
            className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
          >
            <MoreHorizontalIcon aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {!meta ? (
              <DropdownMenuItem onClick={() => pedir("script", l.conta)}>Gerar novo script</DropdownMenuItem>
            ) : null}
            <DropdownMenuItem variant="destructive" onClick={() => pedir("remover", l.conta)}>
              Remover do xcart
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  const filtrado = busca.trim() !== "" || filtro !== "todas";

  return (
    <Section
      titulo="Contas de anúncio"
      nivel={3}
      espaco="nenhum"
      descricao={`Ligue cada conta a uma loja para o gasto entrar no lucro dela. Horários no ${rotuloFuso(fuso)}.`}
      acoes={
        meta ? (
          <Button size="sm" variant="secondary" pending={sincronizando} onClick={sincronizar}>
            {sincronizando ? null : <RefreshCwIcon aria-hidden />}
            Sincronizar agora
          </Button>
        ) : null
      }
      aria-busy={atualizando || undefined}
    >
      <div className="flex flex-col gap-3 px-4">
        {lojaFiltrada ? (
          <p className="text-label text-t2">
            Mostrando as contas de {lojaFiltrada} e as que ainda não têm loja. Troque a loja na barra do
            topo.
          </p>
        ) : null}
        {erroGasto ? <ErroLeitura tom="warn" titulo="Não deu para ler o gasto agora." detalhe={erroGasto} /> : null}
        {semLoja.length > 0 ? (
          <Callout
            tom="warn"
            titulo={
              semLoja.length === 1
                ? "1 conta sem loja: o gasto dela não entra no Lucro."
                : `${semLoja.length} contas sem loja: o gasto delas não entra no Lucro.`
            }
            acao={
              filtro !== "semLoja" ? (
                <Button size="sm" variant="secondary" onClick={() => setFiltro("semLoja")}>
                  Ver contas sem loja
                </Button>
              ) : null
            }
          >
            Escolha a loja de cada uma na coluna “Loja ligada”.
          </Callout>
        ) : null}
        {fusoDiferente.length > 0 ? (
          <Callout tom="info" titulo="O dia do gasto segue o fuso da conta, não o da loja.">
            {listarNomes(fusoDiferente.map(nomeDaConta))} usa{fusoDiferente.length === 1 ? "" : "m"} outro
            fuso. O dia a dia pode desalinhar algumas horas; o total do período não muda.
          </Callout>
        ) : null}
        {erroFuso ? (
          <p className="text-label text-t2">
            Não deu para conferir o fuso das lojas agora; o aviso de fuso diferente fica de fora.
          </p>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <label className="relative flex min-w-0 sm:w-72">
            <span className="sr-only">Buscar conta por nome ou ID</span>
            <SearchIcon
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-t3"
            />
            <Input
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome ou ID"
              className="h-ctl-sm pl-8 text-dense"
            />
          </label>
          <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
            <Segmented
              rotulo="Filtrar contas"
              valor={filtro}
              onValorChange={setFiltro}
              opcoes={FILTROS.map((f) => ({ valor: f.id, rotulo: `${f.rotulo} (${contagem[f.id]})` }))}
            />
          </div>
        </div>
      </div>

      <div className={cn("transition-opacity", atualizando && "opacity-70")}>
        <DataTable<Linha>
          legenda={`Contas de anúncio do ${nomePlataforma}`}
          colunas={colunas}
          linhas={linhas}
          densidade="confortavel"
          vazio={
            filtrado ? (
              <EmptyState
                variante="simples"
                titulo="Nenhuma conta com esse filtro"
                acao={
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setBusca("");
                      setFiltro("todas");
                    }}
                  >
                    Limpar filtros
                  </Button>
                }
              />
            ) : (
              <EmptyState
                variante="simples"
                titulo={lojaFiltrada ? `Nenhuma conta ligada a ${lojaFiltrada}` : "Nenhuma conta ainda"}
                descricao={lojaFiltrada ? "Escolha “Todas as lojas” na barra do topo para ver as outras." : undefined}
              />
            )
          }
        />
      </div>

      <div className="flex flex-col gap-1 border-t border-border-subtle px-4 py-2.5 text-label text-t2 sm:flex-row sm:justify-between sm:gap-3">
        <span>
          {plural(linhas.length, "conta", "contas")} · gasto no período: {periodo}
        </span>
        <span>
          Gasto em {moeda}, convertido pela cotação de cada dia. “Hoje” é o dia no fuso de cada conta.
        </span>
      </div>

      <ConfirmDialog
        open={dialogoAberto}
        onOpenChange={setDialogoAberto}
        tom={acao?.tipo === "script" ? "normal" : "perigo"}
        titulo={
          acao?.tipo === "script"
            ? `Gerar um novo script para ${acao.nome}?`
            : `Remover ${acao?.nome ?? "a conta"} do xcart?`
        }
        descricao={
          acao?.tipo === "script"
            ? "O script colado hoje no Google Ads para de funcionar. Você vai precisar colar o novo no lugar dele, e ele aparece uma vez só."
            : meta
              ? "O gasto já gravado dela sai do Lucro. Nada muda no Meta. Se o token ainda enxergar a conta, ela volta quando você colar o token de novo."
              : "O gasto já gravado dela sai do Lucro e o script colado no Google Ads para de ser aceito. Nada muda no Google Ads."
        }
        confirmar={acao?.tipo === "script" ? "Gerar novo script" : "Remover conta"}
        mensagemErro={erroAcao ?? undefined}
        onConfirmar={executar}
      />
    </Section>
  );
}
