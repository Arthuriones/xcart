"use client";

import { Ellipsis } from "lucide-react";
import type { StoreRow } from "@/lib/stores/queries";

/**
 * Grade da tabela de lojas. As larguras vieram do HTML do design, não de
 * estimativa: 1.6fr para o nome, colunas fixas para os dados e 34px para o
 * menu. Repetida no cabeçalho e nas linhas -- por isso mora numa constante.
 */
const GRADE =
  "grid-cols-[minmax(0,1.6fr)_92px_96px_108px_minmax(0,0.8fr)_34px] gap-3";

export function sincronizado(iso: string | null) {
  if (!iso) return "—";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min} min atrás`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h atrás`;
  return `${Math.round(h / 24)} d atrás`;
}

export interface LinhaLoja extends StoreRow {
  /** Estado no roteamento, quando a loja participa de alguma rota. */
  routeState: "ok" | "paused" | "attention" | "none";
}

export const ESTADO: Record<
  LinhaLoja["routeState"],
  { texto: string; cor: string; fundo: string }
> = {
  ok: { texto: "Ativo", cor: "var(--ok)", fundo: "var(--ok-bg)" },
  paused: { texto: "Pausado", cor: "var(--t2)", fundo: "var(--track)" },
  attention: { texto: "Atenção", cor: "var(--warn)", fundo: "var(--warn-bg)" },
  none: { texto: "Sem rota", cor: "var(--t3)", fundo: "var(--track)" },
};

/**
 * Bolinha de estado. Fica separada da palavra porque o design coloca uma de
 * cada lado do nome no cartao da vitrine (bolinha, nome, palavra) e as duas
 * juntas num selo na tabela.
 */
export function PontoEstado({
  estado,
  tamanho = 6,
}: {
  estado: LinhaLoja["routeState"];
  tamanho?: number;
}) {
  return (
    <span
      className="shrink-0 rounded-full"
      style={{ width: tamanho, height: tamanho, background: ESTADO[estado].cor }}
      aria-hidden
    />
  );
}

/**
 * Estado no roteamento como selo: bolinha + palavra, nunca so a cor.
 *
 * A cor e a palavra saem do mesmo mapa que a vitrine usa, entao as duas telas
 * dizem a mesma coisa. Antes o cartao da vitrine tinha texto fixo
 * ("Conectada", sempre em verde) e mentia quando a rota estava parada.
 */
export function EstadoLoja({ estado }: { estado: LinhaLoja["routeState"] }) {
  const { texto, cor, fundo } = ESTADO[estado];
  return (
    <span
      className="inline-flex items-center gap-1.5 justify-self-start rounded px-[7px] py-0.5 text-[11.5px] font-medium"
      style={{ color: cor, background: fundo }}
    >
      <span
        className="h-[5px] w-[5px] rounded-full"
        style={{ background: cor }}
        aria-hidden
      />
      {texto}
    </span>
  );
}

/**
 * Contagem de catalogo. Nunca conferido mostra travessao, nao zero: sao
 * coisas diferentes, e "0 produtos" assustaria a toa.
 */
export function contagem(loja: {
  product_count: number | null;
  variant_count: number | null;
}) {
  return loja.product_count ?? loja.variant_count ?? null;
}

export function StoreTable({
  lojas,
  onAbrir,
  onAlternar,
}: {
  lojas: LinhaLoja[];
  onAbrir: (loja: LinhaLoja) => void;
  onAlternar?: (loja: LinhaLoja) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div
        className={`grid ${GRADE} border-b border-border bg-surface-2 px-3.5 py-2 text-[11px] font-semibold tracking-[0.02em] text-t3`}
      >
        <div>Loja</div>
        <div>Conexão</div>
        <div>Produtos</div>
        <div>Última sync</div>
        <div>Rota</div>
        <div />
      </div>

      {lojas.map((loja) => {
        return (
          <div
            key={loja.id}
            className={`grid ${GRADE} min-h-[44px] items-center border-b border-[var(--border-subtle)] bg-surface px-3.5 transition-colors last:border-b-0 hover:bg-surface-2`}
          >
            <button
              type="button"
              onClick={() => onAbrir(loja)}
              className="min-w-0 py-2 text-left"
            >
              <span className="block truncate text-[12.5px] font-semibold text-ink">
                {loja.name}
              </span>
              <span className="block truncate font-mono text-[10.5px] text-t3">
                {loja.shop_domain}
              </span>
            </button>

            <EstadoLoja estado={loja.routeState} />

            <span className="text-[12px] tabular-nums text-t1">
              {contagem(loja) ?? "—"}
            </span>

            <span className="text-[12px] text-t3">
              {sincronizado(loja.catalog_synced_at)}
            </span>

            <span className="flex items-center gap-2">
              {loja.routeState !== "none" && onAlternar && (
                <button
                  type="button"
                  onClick={() => onAlternar(loja)}
                  className="h-6 rounded-[5px] border border-border bg-surface px-2 text-[11.5px] font-semibold text-t2 transition-colors hover:border-[var(--border-strong)]"
                >
                  {loja.routeState === "paused" ? "Voltar" : "Parar"}
                </button>
              )}
            </span>

            <button
              type="button"
              onClick={() => onAbrir(loja)}
              className="justify-self-end rounded-[5px] p-1 text-t4 transition-colors hover:bg-hover hover:text-ink"
              aria-label={`Mais ações para ${loja.name}`}
            >
              <Ellipsis className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
