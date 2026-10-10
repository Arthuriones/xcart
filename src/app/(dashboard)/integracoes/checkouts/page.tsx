import { passoDoNovo } from "@/lib/checkouts-externos/tipos";
import { PARAM_DE, voltarParaEscolha } from "@/lib/conectar-operacao";
import { lerCheckoutsDaTela } from "@/lib/leitura/checkouts";
import { CabecalhoPlataforma } from "../cabecalho-plataforma";
import { ErroLeitura } from "../erro-leitura";
import { CheckoutsTela } from "./checkouts-tela";

export const dynamic = "force-dynamic";

// ============================================================================
// Integracoes -> Checkouts: os checkouts externos (Sphere Affiliates primeiro).
// O lojista cadastra, copia a URL do webhook para a plataforma e ve os
// eventos chegando. Cada checkout vira uma "loja" de comissao no seletor do
// topo e no Dashboard. Ver src/lib/checkouts-externos/.
//
// ?novo=sphere (ou ?novo=1) abre o "Conectar checkout" ao chegar, ja no passo
// certo; e a porta do "Conectar operação" (/conectar), que manda &de=conectar
// para o Voltar devolver a escolha.
// ============================================================================

/** O relogio e lido junto com os dados: "último evento há 5 min" sai igual no HTML e na hidratacao. */
async function carregar() {
  try {
    const dados = await lerCheckoutsDaTela();
    return { ok: true as const, dados, agoraMs: Date.now() };
  } catch (e) {
    return { ok: false as const, erro: e instanceof Error ? e.message : String(e) };
  }
}

export default async function CheckoutsPage({
  searchParams,
}: {
  searchParams: Promise<{ [chave: string]: string | string[] | undefined }>;
}) {
  const [r, sp] = await Promise.all([carregar(), searchParams]);
  if (!r.ok) {
    return (
      <>
        <CabecalhoPlataforma titulo="Checkouts" estado={{ tom: "neutral", texto: "Sem leitura" }} />
        <ErroLeitura titulo="Não deu para carregar os checkouts." detalhe={r.erro} />
      </>
    );
  }
  return (
    <CheckoutsTela
      {...r.dados}
      agoraMs={r.agoraMs}
      abrirEm={passoDoNovo(sp.novo)}
      voltar={voltarParaEscolha(sp[PARAM_DE])}
    />
  );
}
