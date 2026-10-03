"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import { gravarCookie } from "@/components/layout/contexto";
import { COOKIE_LOJA } from "@/lib/financeiro/tipos";
import { fmtInteiro, pendenciasDaLoja, plural, semMyshopify, type ResumoCustosLoja } from "./apresentar";

// ============================================================================
// "Todas as lojas" na barra: custo e taxa sao por loja, entao a tela mostra o
// progresso de cada uma e pede para escolher. Escolher grava a loja na barra
// do topo (o mesmo cookie) -- vale para as outras telas tambem.
//
// Ativas primeiro, a que mais falta fazer no topo. As sem acesso ficam num
// grupo recolhido: o custo delas ainda vale para os pedidos ja lidos.
// ============================================================================

export interface LojaParaEscolher {
  id: string;
  nome: string;
  dominio: string;
  semAcesso: boolean;
  /** Linha de apoio da conexao ("Falta a permissão de pedidos"). */
  conexao: string | null;
  /** null = nao deu para ler os custos desta loja. */
  resumo: ResumoCustosLoja | null;
}

function ordenar(lojas: LojaParaEscolher[]): LojaParaEscolher[] {
  return [...lojas].sort(
    (a, b) => pendenciasDaLoja(b.resumo) - pendenciasDaLoja(a.resumo) || a.nome.localeCompare(b.nome, "pt-BR")
  );
}

export function EscolherLoja({ lojas }: { lojas: LojaParaEscolher[] }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [escolhida, setEscolhida] = useState<string | null>(null);
  const [verSemAcesso, setVerSemAcesso] = useState(false);

  const ativas = ordenar(lojas.filter((l) => !l.semAcesso));
  const semAcesso = ordenar(lojas.filter((l) => l.semAcesso));

  function escolher(id: string) {
    setEscolhida(id);
    gravarCookie(COOKIE_LOJA, id);
    iniciar(() => router.refresh());
  }

  const cartao = (l: LojaParaEscolher) => (
    <li key={l.id}>
      <CartaoLoja loja={l} carregando={pendente && escolhida === l.id} desabilitado={pendente} onEscolher={escolher} />
    </li>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-section text-ink">Escolha a loja</h2>
        <p className="max-w-[62ch] text-dense text-t1">
          Cada loja tem os próprios custos e a própria taxa: o mesmo SKU pode vir de fornecedores diferentes. A loja
          escolhida também passa a valer na barra do topo.
        </p>
      </div>

      {ativas.length > 0 ? (
        <ul aria-label="Lojas ativas" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {ativas.map(cartao)}
        </ul>
      ) : (
        <p className="text-dense text-t2">Nenhuma loja ativa: todas estão sem acesso aos pedidos.</p>
      )}

      {semAcesso.length > 0 && (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            aria-expanded={verSemAcesso || ativas.length === 0}
            aria-controls="custos-sem-acesso"
            onClick={() => setVerSemAcesso((v) => !v)}
            className="flex min-h-ctl-lg w-fit items-center gap-2 rounded-control px-1 text-dense text-t1 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <ChevronRight
              aria-hidden
              className={cn(
                "size-4 shrink-0 transition-transform motion-reduce:transition-none",
                (verSemAcesso || ativas.length === 0) && "rotate-90"
              )}
            />
            <span>
              <strong className="font-semibold text-ink">{plural(semAcesso.length, "loja sem acesso", "lojas sem acesso")}</strong>{" "}
              · o custo delas ainda vale para os pedidos já lidos
            </span>
          </button>
          {(verSemAcesso || ativas.length === 0) && (
            <ul id="custos-sem-acesso" aria-label="Lojas sem acesso" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {semAcesso.map(cartao)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function CartaoLoja({
  loja: l,
  carregando,
  desabilitado,
  onEscolher,
}: {
  loja: LojaParaEscolher;
  carregando: boolean;
  desabilitado: boolean;
  onEscolher: (id: string) => void;
}) {
  const r = l.resumo;
  const pct = r && r.vendidos > 0 ? Math.round((r.comCusto / r.vendidos) * 100) : 0;
  const completo = r !== null && r.vendidos > 0 && r.comCusto === r.vendidos;

  let progresso: string;
  if (!r) progresso = "Não deu para ler os custos desta loja agora.";
  else if (r.vendidos === 0) {
    progresso = r.sincronizado ? "Nenhuma venda nos últimos 60 dias." : "Os pedidos desta loja ainda não foram lidos.";
  } else {
    progresso = `${fmtInteiro(r.comCusto)} de ${plural(r.vendidos, "produto vendido", "produtos vendidos")} com custo`;
  }

  return (
    <button
      type="button"
      onClick={() => onEscolher(l.id)}
      disabled={desabilitado}
      aria-busy={carregando || undefined}
      className={cn(
        "flex h-full w-full flex-col gap-3 rounded-card border border-border bg-surface p-4 text-left transition-colors",
        "hover:border-border-strong hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
        "disabled:cursor-progress",
        desabilitado && !carregando && "opacity-60"
      )}
    >
      <span className="flex w-full items-start gap-2">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-body font-semibold text-ink">{l.nome}</span>
          <span className="truncate font-mono text-label text-t2">{semMyshopify(l.dominio)}</span>
        </span>
        {carregando ? (
          <Spinner size={16} />
        ) : (
          <ChevronRight aria-hidden className="mt-0.5 size-4 shrink-0 text-t2" />
        )}
      </span>

      <span className="flex flex-col gap-1.5">
        <span className="text-dense text-t1">{progresso}</span>
        {r && r.vendidos > 0 ? (
          <span
            role="progressbar"
            aria-label={`Produtos com custo em ${l.nome}`}
            aria-valuemin={0}
            aria-valuemax={r.vendidos}
            aria-valuenow={r.comCusto}
            aria-valuetext={`${pct}%`}
            className="block h-1.5 w-full overflow-hidden rounded-full bg-track"
          >
            <span
              className={cn("block h-full rounded-full", completo ? "bg-ok" : "bg-warn")}
              style={{ width: `${pct}%` }}
            />
          </span>
        ) : null}
      </span>

      <span className="mt-auto flex flex-wrap gap-1.5">
        {r ? (
          r.taxa ? (
            <StatusBadge tom="ok">Taxa configurada</StatusBadge>
          ) : (
            <StatusBadge tom="warn">Sem taxa de pagamento</StatusBadge>
          )
        ) : null}
        {completo ? <StatusBadge tom="ok">Todos com custo</StatusBadge> : null}
        {r && r.vendidos > r.comCusto ? (
          <StatusBadge tom="warn">{plural(r.vendidos - r.comCusto, "sem custo", "sem custo")}</StatusBadge>
        ) : null}
        {l.semAcesso && l.conexao ? <StatusBadge tom="neutral">{l.conexao}</StatusBadge> : null}
      </span>
    </button>
  );
}
