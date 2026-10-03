import { Suspense } from "react";
import { ErroAdmin } from "../estados-admin";
import { lerAnalise } from "../ler-api";
import { CabecalhoUso, EsqueletoUso } from "./partes";
import { Uso } from "./vista";

export const dynamic = "force-dynamic";

/**
 * /admin/usage: quanto a IA custou (por dia e por tipo de acao, 30 dias), a
 * receita do mes e a margem. Le GET /api/admin/analytics no servidor. Cada
 * numero diz a moeda: receita em real, custo de IA em dolar (a moeda em que
 * e cobrado) com o convertido ao lado.
 */
export default function AdminUsoPage() {
  return (
    <>
      <CabecalhoUso />
      <Suspense fallback={<EsqueletoUso />}>
        <Conteudo />
      </Suspense>
    </>
  );
}

async function Conteudo() {
  const r = await lerAnalise();
  if (!r.ok) return <ErroAdmin titulo="Não deu para carregar uso e custos" detalhe={r.detalhe} />;
  return <Uso a={r.dados} lidoEm={r.lidoEm} />;
}
