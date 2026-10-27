import type { BomQuando } from "@/components/ui/variacao";
import type { PontoDia } from "@/lib/leitura/serie-diaria";

// ============================================================================
// Periodo que termina hoje (Hoje, 7 dias, 30 dias, Este mes): o ultimo dia
// ainda corre e o periodo anterior esta completo. As 10h o lucro de hoje
// "cai 70%" contra ontem inteiro, todo dia. A variacao continua a mesma, mas
// sem verde nem vermelho, e o texto diz que o anterior e inteiro. So a
// apresentacao: o periodo anterior e os numeros nao mudam.
// ============================================================================

/** O ultimo dia do periodo e hoje: o calculo o marca como parcial. */
export function terminaHoje(atual: PontoDia[]): boolean {
  return atual.length > 0 && atual[atual.length - 1].parcial;
}

/** O "bom" da variacao: neutro (sem cor) quando o periodo termina hoje. */
export function bomComParcial(bom: BomQuando, parcial: boolean): BomQuando {
  return parcial ? "neutro" : bom;
}

/** "vs. R$ 1.200,00 em 26/10", e o aviso de que o anterior esta completo quando o periodo termina hoje. */
export function textoDoAnterior(
  valor: string,
  rotuloAnterior: string,
  o: { umDia: boolean; parcial: boolean }
): string {
  const base = `vs. ${valor} em ${rotuloAnterior}`;
  if (!o.parcial) return base;
  return o.umDia ? `${base} (dia inteiro)` : `${base} (hoje parcial)`;
}
