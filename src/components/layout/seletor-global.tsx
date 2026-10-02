"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  COOKIE_LOJA,
  COOKIE_MOEDA,
  COOKIE_PERIODO,
  MOEDAS_RELATORIO,
  PERIODOS,
  TODAS,
  linhaDeCookie,
  type FiltroGlobal,
  type LojaDoSeletor,
  type MoedaRelatorio,
  type PeriodoId,
} from "@/lib/financeiro/tipos";
import { hrefAtivo } from "@/components/layout/nav-ativo";
import { cn } from "@/lib/utils";

// ============================================================================
// Seletor global de loja, periodo e moeda, no topo.
//
// Grava em cookie e pede ao servidor para renderizar de novo (router.refresh):
// a pagina le o cookie com cookies(). Ver src/lib/filtro-global.ts para o
// porque de cookie e nao URL.
//
// So aparece nas telas que LEEM o filtro. As telas antigas (/tracking, /sales)
// tem filtros proprios em useState; um seletor que elas ignorassem faria o
// lojista achar que mudou a loja e continuar vendo a outra.
// ============================================================================

interface Controles {
  loja?: boolean;
  periodo?: boolean;
  moeda?: boolean;
}

// Vence o prefixo mais longo: /financeiro/custos nao herda periodo e moeda de
// /financeiro (custo e por SKU, nao por periodo).
const CONTROLES: Record<string, Controles> = {
  "/financeiro/anuncios": {},
  "/financeiro/custos": { loja: true },
  "/financeiro": { loja: true, periodo: true, moeda: true },
  "/tracking/eventos": { loja: true },
  "/alertas": { loja: true },
};

const PREFIXOS = Object.keys(CONTROLES);

const CLASSE_SELECT =
  "h-[28px] rounded-md border border-[var(--control-border)] bg-surface px-2 text-[12px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/40";

function rotuloDaLoja(l: LojaDoSeletor): string {
  const dominio = l.dominio.replace(/\.myshopify\.com$/i, "");
  // stores.name e velho em algumas lojas: o dominio vai sempre junto.
  return l.nome && l.nome !== l.dominio ? `${l.nome} · ${dominio}` : dominio;
}

export function SeletorGlobal({
  lojas,
  filtro,
}: {
  lojas: LojaDoSeletor[];
  filtro: FiltroGlobal;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [pendente, startTransition] = useTransition();

  // Estado local para o select responder na hora; o servidor confirma no
  // refresh. Quando as props mudam (outro refresh, outra aba gravou o cookie),
  // o estado volta a seguir o servidor -- ajuste durante o render, sem efeito.
  const [valores, setValores] = useState<FiltroGlobal>(filtro);
  const [anterior, setAnterior] = useState<FiltroGlobal>(filtro);
  if (
    anterior.lojaId !== filtro.lojaId ||
    anterior.periodo !== filtro.periodo ||
    anterior.moeda !== filtro.moeda
  ) {
    setAnterior(filtro);
    setValores(filtro);
  }

  const prefixo = hrefAtivo(pathname, PREFIXOS);
  if (!prefixo) return null;
  const controles = CONTROLES[prefixo];
  if (!controles.loja && !controles.periodo && !controles.moeda) return null;

  // Cookie com loja apagada ou de outra conta: a pagina ja trata como "todas"
  // (filtroResolvido); o select mostra o mesmo, em vez de um valor sem opcao.
  const lojaAtual = lojas.some((l) => l.id === valores.lojaId) ? valores.lojaId : TODAS;

  function gravar(cookie: string, valor: string, proximo: FiltroGlobal) {
    setValores(proximo);
    document.cookie = linhaDeCookie(cookie, valor);
    startTransition(() => router.refresh());
  }

  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-1.5 transition-opacity",
        pendente && "opacity-60"
      )}
      aria-busy={pendente}
    >
      {controles.loja && (
        <select
          aria-label="Loja"
          value={lojaAtual}
          onChange={(e) =>
            gravar(COOKIE_LOJA, e.target.value, { ...valores, lojaId: e.target.value })
          }
          className={cn(CLASSE_SELECT, "min-w-0 max-w-[150px] truncate sm:max-w-[220px]")}
        >
          <option value={TODAS}>Todas as lojas</option>
          {lojas.map((l) => (
            <option key={l.id} value={l.id}>
              {rotuloDaLoja(l)}
            </option>
          ))}
        </select>
      )}
      {controles.periodo && (
        <select
          aria-label="Período"
          value={valores.periodo}
          onChange={(e) =>
            gravar(COOKIE_PERIODO, e.target.value, {
              ...valores,
              periodo: e.target.value as PeriodoId,
            })
          }
          className={cn(CLASSE_SELECT, "shrink-0")}
        >
          {PERIODOS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.rotulo}
            </option>
          ))}
        </select>
      )}
      {controles.moeda && (
        <select
          aria-label="Moeda do relatório"
          value={valores.moeda}
          onChange={(e) =>
            gravar(COOKIE_MOEDA, e.target.value, {
              ...valores,
              moeda: e.target.value as MoedaRelatorio,
            })
          }
          className={cn(CLASSE_SELECT, "hidden shrink-0 sm:block")}
        >
          {MOEDAS_RELATORIO.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
