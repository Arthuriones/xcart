import { passoDoNovo, plataformaDoNovo } from "@/lib/checkouts-externos/tipos";
import { plataformasDaConta } from "@/lib/checkouts-externos/liberadas";
import { PARAM_DE, voltarParaEscolha } from "@/lib/conectar-operacao";
import { lerCheckoutsDaTela } from "@/lib/leitura/checkouts";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { CabecalhoPlataforma } from "../cabecalho-plataforma";
import { ErroLeitura } from "../erro-leitura";
import { CheckoutsTela } from "./checkouts-tela";

export const dynamic = "force-dynamic";

// ============================================================================
// Integracoes -> Checkouts: os checkouts externos (Cakto e Sphere Affiliates).
// O lojista cadastra, copia a URL do webhook para a plataforma (na Cakto,
// cola o secret dela aqui) e ve os eventos chegando. Cada checkout vira uma
// "loja" no seletor do topo e no Dashboard: de venda (Cakto) ou de comissao
// (Sphere). Ver src/lib/checkouts-externos/.
//
// ?novo=cakto, ?novo=sphere (ou ?novo=1) abre o "Conectar checkout" ao chegar, ja no passo
// certo; e a porta do "Conectar operação" (/conectar), que manda &de=conectar
// para o Voltar devolver a escolha.
//
// A escolha de plataforma e a da CONTA (plataformasDaConta): o Eve so na do
// Arthur. Quem decide e o servidor; a tela recebe a lista pronta, sem os ids.
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
  // getCurrentUser e o mesmo (cache por requisicao) que a leitura usa. Falhou: so a lista publica.
  const [r, sp, user] = await Promise.all([carregar(), searchParams, getCurrentUser().catch(() => null)]);
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
      plataformas={plataformasDaConta(user?.id)}
      abrirEm={passoDoNovo(sp.novo)}
      plataformaNovo={plataformaDoNovo(sp.novo)}
      voltar={voltarParaEscolha(sp[PARAM_DE])}
    />
  );
}
