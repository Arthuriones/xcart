import { PageHeader } from "@/components/layout/page-header";
import { BotaoCanais } from "./tela-alertas";

/** O mesmo cabecalho na pagina e no loading.tsx: nada pula quando os dados chegam. */
export function CabecalhoAlertas() {
  return (
    <PageHeader
      title="Alertas"
      description="O que está quebrado agora em vendas, rastreamento e gasto, com o atalho para resolver. Os avisos chegam pelo Telegram."
    >
      <BotaoCanais />
    </PageHeader>
  );
}
