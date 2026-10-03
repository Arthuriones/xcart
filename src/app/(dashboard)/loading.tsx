import { EsqueletoTela } from "@/components/layout/estados";

/**
 * Carregando entre telas: o menu e o topo ficam, so o conteudo vira
 * esqueleto. Cada tela pode ter o proprio loading.tsx com a geometria dela.
 */
export default function DashboardLoading() {
  return <EsqueletoTela />;
}
