import { Suspense } from "react";
import { ErroAdmin } from "../estados-admin";
import { periodoDaUrl, type PeriodoFaturamento } from "../formato";
import { lerFaturamento } from "../ler-api";
import { CabecalhoFaturamento, EsqueletoFaturamento } from "./partes";
import { Faturamento } from "./vista";

export const dynamic = "force-dynamic";
// Pergunta ao vivo a cada loja de checkout: com dezenas de lojas passa facil
// do teto padrao (o mesmo de /api/admin/revenue).
export const maxDuration = 120;

/**
 * /admin/faturamento: quanto os clientes venderam nas lojas de checkout, por
 * cliente e por loja. Le GET /api/admin/revenue no servidor; o periodo fica na
 * URL (?periodo=7|30|60) e cada troca mostra o esqueleto ate as lojas
 * responderem.
 */
export default async function AdminFaturamentoPage({
  searchParams,
}: {
  searchParams: Promise<{ [chave: string]: string | string[] | undefined }>;
}) {
  const periodo = periodoDaUrl((await searchParams).periodo);
  return (
    <>
      <CabecalhoFaturamento periodo={periodo} />
      <Suspense key={periodo} fallback={<EsqueletoFaturamento />}>
        <Conteudo periodo={periodo} />
      </Suspense>
    </>
  );
}

async function Conteudo({ periodo }: { periodo: PeriodoFaturamento }) {
  const r = await lerFaturamento(periodo);
  if (!r.ok) {
    return (
      <ErroAdmin
        titulo="Não deu para perguntar às lojas agora"
        descricao="Nada foi alterado. A Shopify pode estar lenta; tente de novo em instantes."
        detalhe={r.detalhe}
      />
    );
  }
  return <Faturamento g={r.dados} periodo={periodo} />;
}
