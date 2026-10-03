import type { ReactNode } from "react";
import { DataTable, type ColunaTabela } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Section } from "@/components/ui/section";
import { StatusBadge } from "@/components/ui/status-badge";
import { LIMITE_COMPRAS, type CompraDoHistorico } from "@/lib/leitura/assinatura";
import {
  brl,
  dataHora,
  formaDaCompra,
  rotuloCompra,
  situacaoDaCompra,
} from "@/components/billing/regras";
import { BotaoTentarDeNovo } from "./erro-assinatura";

type Linha = {
  id: string;
  quando: string;
  quandoValor: number;
  compra: string;
  forma: string;
  valor: string;
  valorCentavos: number;
  situacao: ReactNode;
  situacaoTexto: string;
};

// Sem `celula` (funcao): a tabela e client e a lista vem pronta do servidor.
const COLUNAS: ColunaTabela<Linha>[] = [
  { chave: "quando", titulo: "Data", ordenarPor: "quandoValor", direcaoInicial: "desc" },
  { chave: "compra", titulo: "Compra" },
  { chave: "forma", titulo: "Forma" },
  { chave: "valor", titulo: "Valor", alinhar: "direita", ordenarPor: "valorCentavos" },
  { chave: "situacao", titulo: "Situação", ordenarPor: "situacaoTexto" },
];

/**
 * Historico de compras (#29, parte que ja tem dado): recargas e meses de Pro
 * pagos por Pix, e as recargas antigas no cartao. A cobranca mensal da
 * assinatura no cartao nao fica nesta lista -- a tela diz isso. Recibo,
 * aviso de saldo baixo e recarga automatica dependem de backend: "Em breve".
 */
export function Historico({
  compras,
  erro,
}: {
  compras: CompraDoHistorico[] | null;
  erro: string | null;
}) {
  const linhas: Linha[] = (compras ?? []).map((c) => {
    const s = situacaoDaCompra(c.status);
    return {
      id: c.id,
      quando: dataHora(c.criadaEm) ?? "—",
      quandoValor: new Date(c.criadaEm).getTime() || 0,
      compra: rotuloCompra(c),
      forma: formaDaCompra(c),
      valor: brl(c.amountCents),
      valorCentavos: c.amountCents,
      situacao: <StatusBadge tom={s.tom} texto={s.texto} />,
      situacaoTexto: s.texto,
    };
  });

  return (
    <div className="flex flex-col gap-3">
      <Section
        titulo="Histórico de compras"
        descricao={`As ${LIMITE_COMPRAS} mais recentes, no horário de São Paulo. A mensalidade do cartão não aparece aqui.`}
        espaco="nenhum"
      >
        {compras === null ? (
          <EmptyState
            variante="simples"
            role="alert"
            titulo="Não deu para carregar o histórico"
            descricao="Suas compras continuam registradas. Tente de novo em instantes."
            acao={
              <div className="flex flex-col items-center gap-2">
                <BotaoTentarDeNovo variante="secondary" />
                {erro ? (
                  <details className="text-label text-t2">
                    <summary className="cursor-pointer">Detalhes para o suporte</summary>
                    <p className="mt-1 max-w-110 break-words font-mono">{erro}</p>
                  </details>
                ) : null}
              </div>
            }
            className="min-h-40"
          />
        ) : (
          <DataTable
            colunas={COLUNAS}
            linhas={linhas}
            legenda="Compras de créditos e de meses do Pro, da mais recente para a mais antiga"
            ordenacaoInicial={[{ chave: "quando", direcao: "desc" }]}
            vazio={
              <EmptyState
                variante="simples"
                titulo="Nenhuma compra ainda"
                descricao="As recargas e os meses pagos por Pix aparecem aqui."
                className="min-h-40"
              />
            }
          />
        )}
      </Section>

      <EmptyState
        variante="tracejado"
        selo="Em breve"
        titulo="Recibo, aviso de saldo baixo e recarga automática"
        descricao="Ainda não estão disponíveis. Por enquanto, as compras ficam no histórico acima."
        className="py-6"
      />
    </div>
  );
}
