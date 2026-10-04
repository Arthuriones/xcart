import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { configDataManagerDe } from "@/lib/tracking/destinos";
import { podeUsarDataManager, temCredencialDoGoogle } from "@/lib/tracking/google-dm";
import { CabecalhoPlataforma } from "../cabecalho-plataforma";
import { carregarAnuncios, type DadosAnuncios } from "../dados-anuncios";
import { ErroLeitura } from "../erro-leitura";
import { ConteudoGoogle } from "./conteudo-google";
import type { DadosDataManager } from "./envio-data-manager";

export const dynamic = "force-dynamic";

// ============================================================================
// Integracoes -> Google. O ID de cliente e o script leem o gasto; a mesma conta,
// com uma acao "Importar de cliques" por evento, recebe as conversoes pela Data
// Manager API. O AW- (Saude dos pixels) continua sendo o destino e o
// remarketing. Era a metade Google de /financeiro/anuncios.
// ============================================================================

/**
 * A configuracao da Data Manager dos destinos que a tela ja mostra. Os ids vem
 * de `d.destinos`, ja filtrados pelas lojas do usuario.
 */
async function lerDataManager(d: DadosAnuncios): Promise<DadosDataManager> {
  // A service account e do dono do xcart (GOOGLE_DM_DONOS). Para os outros
  // lojistas a secao nem aparece: os passos da Vercel nao valem para eles.
  const {
    data: { user },
  } = await (await createClient()).auth.getUser();
  const liberado = podeUsarDataManager(user?.id);
  const temCredencial = temCredencialDoGoogle() && liberado;
  if (!liberado) return { destinos: [], temCredencial, liberado, erro: null };
  if (d.erroDestinos) return { destinos: [], temCredencial, liberado, erro: d.erroDestinos };
  try {
    const config = await configDataManagerDe(
      createAdminClient(),
      d.destinos.map((x) => x.id)
    );
    // A unica conta Google ligada a loja vira sugestao do ID do cliente.
    const contasDaLoja = new Map<string, string[]>();
    for (const c of d.daPlataforma) {
      if (!c.store_id) continue;
      contasDaLoja.set(c.store_id, [...(contasDaLoja.get(c.store_id) ?? []), c.external_id]);
    }
    return {
      temCredencial,
      liberado,
      erro: null,
      destinos: d.destinos.map((x) => {
        const c = config.get(x.id);
        const contas = contasDaLoja.get(x.storeId) ?? [];
        return {
          id: x.id,
          storeId: x.storeId,
          nome: x.nome,
          conta: x.conta,
          ativo: x.ativo,
          customerId: c?.customerId ?? null,
          loginCustomerId: c?.loginCustomerId ?? null,
          acoes: c?.acoes ?? {},
          sugestao: contas.length === 1 ? contas[0] : null,
        };
      }),
    };
  } catch (e) {
    return { destinos: [], temCredencial, liberado, erro: e instanceof Error ? e.message : String(e) };
  }
}

export default async function GooglePage() {
  const r = await carregarAnuncios("google");
  if (!r.ok) {
    return (
      <>
        <CabecalhoPlataforma titulo="Google Ads" estado={{ tom: "neutral", texto: "Sem leitura" }} />
        <ErroLeitura titulo="Não deu para carregar as contas do Google." detalhe={r.erro} />
      </>
    );
  }
  return <ConteudoGoogle d={r.dados} dm={await lerDataManager(r.dados)} />;
}
