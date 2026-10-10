import { DIAS_SEM_RETORNO, type AmostraEntrega } from "@/lib/financeiro/contra-entrega";
import { somarDias, type Intervalo } from "@/lib/financeiro/tipos";
import type { PedidoExternoRow } from "./tipos";

// ============================================================================
// A taxa de APROVACAO de um checkout externo: a mesma regra da taxa de entrega
// do contra entrega (contra-entrega.ts), com a amostra propria. Dos pedidos
// dos ultimos 60 dias (sem a ultima semana): aprovados e pagos contra
// expirados e revertidos, e pendente ha mais de 21 dias conta como perdido
// (COD que ninguem marcou). Com menos de 20, vale a taxa padrao do checkout.
//
// Puro: testado em tests/financeiro-checkout-externo.test.ts.
// ============================================================================

export function contarAmostraExterna(
  pedidos: Pick<PedidoExternoRow, "checkout_id" | "situacao" | "dia_local">[],
  intervalo: Intervalo,
  hoje: string
): Record<string, AmostraEntrega> {
  const limite = somarDias(hoje, -DIAS_SEM_RETORNO);
  const saida: Record<string, AmostraEntrega> = {};
  for (const p of pedidos) {
    const dia = String(p.dia_local).slice(0, 10);
    if (dia < intervalo.desde || dia > intervalo.ate) continue;
    const a = (saida[p.checkout_id] ??= { entregues: 0, recusados: 0, semRetorno: 0 });
    if (p.situacao === "aprovado" || p.situacao === "pago") a.entregues += 1;
    else if (p.situacao === "expirado" || p.situacao === "revertido") a.recusados += 1;
    else if (dia < limite) a.semRetorno = (a.semRetorno ?? 0) + 1;
  }
  return saida;
}
