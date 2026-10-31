import { View } from "react-native";
import { Cartao, Divisor, LinhaValor, Texto } from "@/components/ui";
import { dinheiro, inteiro, relativo, vezes } from "@/lib/formato";
import { ESPACO, useCores } from "@/lib/tema";
import type { Campanhas } from "@/lib/tipos";
import { corDoLucro, corDoRoas } from "./linha-campanha";
import { quantidadeDoNivel, type NivelLista } from "./regras";

// ============================================================================
// A linha de total da lista (o mesmo total do site: as somas das linhas
// visiveis, refeitas no servidor). Em loja de contra entrega os rotulos dizem
// "previsto", como a tabela do site.
// ============================================================================

export function TotalCampanhas({
  total,
  nivel,
  moeda,
  periodo,
  contraEntrega,
  sincronizadoEm,
}: {
  total: NonNullable<Campanhas["total"]>;
  nivel: NivelLista;
  moeda: string;
  periodo: string;
  contraEntrega: boolean;
  sincronizadoEm: string | null;
}) {
  const c = useCores();
  const quando = relativo(sincronizadoEm);
  return (
    <Cartao>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: ESPACO[3] }}>
        <Texto variante="rotulo" cor={c.t2} estilo={{ flexShrink: 1 }} linhas={2}>
          Total · {quantidadeDoNivel(nivel, total.quantidade)}
          {periodo ? ` · ${periodo}` : ""}
        </Texto>
        {quando ? (
          <Texto variante="rotulo" cor={c.t3}>
            Atualizado {quando}
          </Texto>
        ) : null}
      </View>
      <View style={{ gap: 2 }}>
        <Texto variante="rotulo" cor={c.t2}>
          {contraEntrega ? "Lucro previsto" : "Lucro"}
        </Texto>
        <Texto variante="kpi" numero cor={corDoLucro(c, total.lucro)}>
          {dinheiro(total.lucro, moeda)}
        </Texto>
      </View>
      <Divisor />
      <LinhaValor rotulo="Gasto" valor={dinheiro(total.gastos, moeda)} />
      <LinhaValor rotulo={contraEntrega ? "Faturamento previsto" : "Faturamento"} valor={dinheiro(total.faturamento, moeda)} />
      <LinhaValor rotulo={contraEntrega ? "ROAS previsto" : "ROAS"} valor={vezes(total.roas)} cor={corDoRoas(c, total.roasTom)} />
      <LinhaValor rotulo={contraEntrega ? "Pedidos gerados" : "Vendas"} valor={inteiro(total.vendas)} />
    </Cartao>
  );
}
