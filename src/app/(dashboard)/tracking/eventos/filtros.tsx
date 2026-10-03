"use client";

import { useState, type FormEvent } from "react";
import { CheckIcon, XIcon } from "lucide-react";
import type { EventoFeed } from "@/lib/financeiro/tipos";
import { Pop } from "@/components/layout/sobreposicao";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DIMENSOES,
  MAX_NOME_VISAO,
  MAX_VISOES,
  ORDEM_STATUS,
  STATUS_TELA,
  VISAO_ATUAL,
  VISOES_FIXAS,
  alternarValor,
  filtroVazio,
  opcoesDe,
  rotuloChip,
  type Dimensao,
  type Filtro,
  type TomEvento,
  type Visao,
} from "./logica";

// ============================================================================
// Contadores, visoes salvas e chips de filtro. Tudo filtra as linhas JA
// carregadas, no navegador (#33: filtrar no servidor pede migration).
// ============================================================================

const FOCO = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

const TOM_CONTADOR: Record<TomEvento, { base: string; marcado: string }> = {
  ok: { base: "border-ok-border text-ok", marcado: "bg-ok-bg" },
  run: { base: "border-run-border text-run", marcado: "bg-run-bg" },
  err: { base: "border-err-border text-err", marcado: "bg-err-bg" },
};

/** "Nas 100 linhas carregadas: 92 enviados · 3 na fila · 5 falhas", clicaveis. */
export function Contadores({
  total,
  contagem,
  filtro,
  onFiltro,
}: {
  total: number;
  contagem: Record<EventoFeed["status"], number>;
  filtro: Filtro;
  onFiltro: (f: Filtro) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Contagem nas linhas carregadas"
      className="flex flex-wrap items-center gap-2 text-label text-t2"
    >
      <span>Nas {total} linhas carregadas:</span>
      {ORDEM_STATUS.map((s) => {
        const st = STATUS_TELA[s];
        const n = contagem[s];
        const marcado = filtro.status.length === 1 && filtro.status[0] === s;
        const tom = TOM_CONTADOR[st.tom];
        return (
          <button
            key={s}
            type="button"
            aria-pressed={marcado}
            onClick={() => onFiltro({ ...filtro, status: marcado ? [] : [s] })}
            className={cn(
              "num inline-flex h-ctl-sm items-center gap-1.5 rounded-full border px-2.5 text-label font-semibold",
              tom.base,
              marcado ? tom.marcado : "bg-transparent hover:bg-hover",
              FOCO
            )}
          >
            <span aria-hidden className="size-1.5 rounded-full bg-current" />
            {n} {n === 1 ? st.um : st.varios}
          </button>
        );
      })}
    </div>
  );
}

/** Abas de visao: as fixas, as salvas neste navegador e o filtro nao salvo. */
export function Visoes({
  ativa,
  salvas,
  onFiltro,
  onSalvar,
  onExcluir,
}: {
  ativa: string;
  salvas: Visao[];
  onFiltro: (f: Filtro) => void;
  onSalvar: (nome: string) => void;
  onExcluir: (id: string) => void;
}) {
  const salvaAtiva = salvas.find((v) => v.id === ativa);
  const aba = (on: boolean) =>
    cn(
      "-mb-px flex h-10 shrink-0 items-center whitespace-nowrap border-b-2 px-2.5 text-dense focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus",
      on ? "border-ink font-semibold text-ink" : "border-transparent text-t2 hover:text-ink"
    );

  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-border px-4 [scrollbar-width:none]">
      <div role="group" aria-label="Visões" className="flex items-center gap-1">
        {[...VISOES_FIXAS, ...salvas].map((v) => (
          <button
            key={v.id}
            type="button"
            aria-pressed={ativa === v.id}
            onClick={() => onFiltro(v.filtro)}
            className={aba(ativa === v.id)}
          >
            {v.nome}
          </button>
        ))}
        {ativa === VISAO_ATUAL && (
          <span className={aba(true)} aria-current="true">
            Filtro atual (não salvo)
          </span>
        )}
      </div>
      {ativa === VISAO_ATUAL && (
        <SalvarVisao cheio={salvas.length >= MAX_VISOES} onSalvar={onSalvar} />
      )}
      {salvaAtiva && (
        <Button
          variant="ghost"
          size="sm"
          className="ml-2 shrink-0 text-t1"
          onClick={() => onExcluir(salvaAtiva.id)}
        >
          Excluir visão
        </Button>
      )}
    </div>
  );
}

function SalvarVisao({ cheio, onSalvar }: { cheio: boolean; onSalvar: (nome: string) => void }) {
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState("");

  function salvar(ev: FormEvent) {
    ev.preventDefault();
    const limpo = nome.trim();
    if (!limpo || cheio) return;
    onSalvar(limpo.slice(0, MAX_NOME_VISAO));
    setNome("");
    setAberto(false);
  }

  return (
    <Pop
      aberto={aberto}
      aoMudar={setAberto}
      rotulo="Salvar visão"
      className="w-72 p-3"
      gatilho={
        <button
          type="button"
          className={cn(
            "ml-2 h-ctl-sm shrink-0 whitespace-nowrap rounded-control border border-dashed border-control-border px-2.5 text-label text-t1 hover:border-border-strong hover:text-ink",
            FOCO
          )}
        >
          Salvar visão
        </button>
      }
    >
      {cheio ? (
        <p className="text-dense text-t1">
          Você já tem {MAX_VISOES} visões salvas. Exclua uma para salvar outra.
        </p>
      ) : (
        <form onSubmit={salvar} className="flex flex-col gap-2">
          <Label htmlFor="nome-visao">Nome da visão</Label>
          <Input
            id="nome-visao"
            value={nome}
            onChange={(ev) => setNome(ev.target.value)}
            maxLength={MAX_NOME_VISAO}
            placeholder="Ex.: Falhas do Meta"
            autoComplete="off"
            required
          />
          <p className="text-label text-t2">Fica salva só neste navegador.</p>
          <div className="mt-1 flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button type="submit" size="sm" disabled={!nome.trim()}>
              Salvar
            </Button>
          </div>
        </form>
      )}
    </Pop>
  );
}

/** As opcoes de um chip. So monta com o popover aberto: conta 500 linhas. */
function Opcoes({
  dim,
  eventos,
  filtro,
  onFiltro,
}: {
  dim: Dimensao;
  eventos: EventoFeed[];
  filtro: Filtro;
  onFiltro: (f: Filtro) => void;
}) {
  const opcoes = opcoesDe(dim, eventos, filtro);
  if (!opcoes.length) {
    return <p className="px-2 py-3 text-label text-t2">Nenhuma opção nas linhas carregadas.</p>;
  }
  return (
    <div className="flex max-h-72 flex-col overflow-y-auto">
      {opcoes.map((o) => (
        <button
          key={o.valor}
          type="button"
          role="checkbox"
          aria-checked={o.marcada}
          onClick={() => onFiltro(alternarValor(filtro, dim, o.valor))}
          className="flex min-h-9 w-full items-center gap-2.5 rounded-control px-2 py-1.5 text-left text-dense text-ink hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
        >
          <span
            aria-hidden
            className={cn(
              "grid size-4 shrink-0 place-items-center rounded-sm border",
              o.marcada ? "border-transparent bg-solid text-on-solid" : "border-control-border"
            )}
          >
            {o.marcada && <CheckIcon className="size-3" strokeWidth={3} />}
          </span>
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{o.rotulo}</span>
          <span className="num text-label text-t2">{o.n}</span>
        </button>
      ))}
    </div>
  );
}

function Chip({
  dim,
  rotulo,
  eventos,
  filtro,
  onFiltro,
}: {
  dim: Dimensao;
  rotulo: string;
  eventos: EventoFeed[];
  filtro: Filtro;
  onFiltro: (f: Filtro) => void;
}) {
  const ativo = filtro[dim].length > 0;
  return (
    <div className="flex items-center">
      <Pop
        rotulo={`Filtrar por ${rotulo}`}
        className="w-64 p-1.5"
        gatilho={
          <button
            type="button"
            className={cn(
              "flex h-ctl-sm max-w-70 items-center whitespace-nowrap border text-dense",
              ativo
                ? "rounded-l-full border-info-border bg-info-bg pl-2.5 pr-2 text-info"
                : "rounded-full border-dashed border-control-border px-2.5 text-t1 hover:border-border-strong hover:text-ink",
              FOCO
            )}
          >
            <span className="truncate">{rotuloChip(dim, filtro, eventos)}</span>
          </button>
        }
      >
        <div role="group" aria-label={rotulo}>
          <Opcoes dim={dim} eventos={eventos} filtro={filtro} onFiltro={onFiltro} />
        </div>
      </Pop>
      {ativo && (
        <button
          type="button"
          aria-label={`Remover filtro ${rotulo}`}
          onClick={() => onFiltro({ ...filtro, [dim]: [] })}
          className={cn(
            "grid h-ctl-sm w-7 place-items-center rounded-r-full border border-l-0 border-info-border bg-info-bg text-info hover:bg-hover",
            FOCO
          )}
        >
          <XIcon aria-hidden className="size-3.5" strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}

/** A fileira de chips, "Limpar filtros" e o aviso de que so vale no carregado. */
export function Chips({
  eventos,
  filtro,
  onFiltro,
  temFiltro,
}: {
  eventos: EventoFeed[];
  filtro: Filtro;
  onFiltro: (f: Filtro) => void;
  temFiltro: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-3">
      {DIMENSOES.map((d) => (
        <Chip
          key={d.id}
          dim={d.id}
          rotulo={d.rotulo}
          eventos={eventos}
          filtro={filtro}
          onFiltro={onFiltro}
        />
      ))}
      {temFiltro && (
        <Button variant="link" size="sm" onClick={() => onFiltro(filtroVazio())}>
          Limpar filtros
        </Button>
      )}
      <div className="flex-1" />
      {temFiltro && (
        <span className="text-label text-t2">Filtrando as {eventos.length} linhas carregadas</span>
      )}
    </div>
  );
}
