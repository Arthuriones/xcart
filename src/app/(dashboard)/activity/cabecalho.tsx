import { PageHeader } from "@/components/layout/page-header";

/** O mesmo cabecalho na pagina e no loading.tsx: nada pula quando os dados chegam. */
export function CabecalhoAtividade() {
  return (
    <PageHeader
      title="Atividade"
      description="O que aconteceu na conta, do mais recente para o mais antigo. Cada linha abre o que ela mudou."
    />
  );
}
