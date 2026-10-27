import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createClient } from "@/lib/supabase/server";
import { contarAlertasAbertos } from "@/lib/leitura/notificacoes";
import { lerFotoGuia, lerGuiaDaConta } from "@/lib/leitura/guia-configuracao";
import { COOKIE_GUIA_DISPENSADO } from "@/lib/leitura/guia-passos";
import { lerComPlano, limitesDoPerfil, type PerfilParaLimites } from "@/lib/billing/limites";
import { nomeNaTela, planoPorId } from "@/lib/billing/plans";
import { COOKIE_MENU } from "./contexto";
import { Sidebar, type DadosMenu } from "./sidebar";

/**
 * Busca os dados do menu no servidor e entrega prontos.
 *
 * Vive separado do layout de proposito: o layout renderiza isto dentro de um
 * <Suspense>, entao a pagina aparece sem esperar as consultas. Quando estava
 * no proprio layout, os arredondamentos ao banco seguravam a TELA INTEIRA a
 * cada navegacao para desenhar uma barrinha.
 *
 * Falha de leitura vira contador vazio, nunca menu quebrado: sem numero e
 * melhor que sem menu.
 */
export async function SidebarData() {
  // A foto do guia so serve ao cartao: com o guia dispensado (cookie) ela nem
  // e lida. lerGuiaDaConta e lerFotoGuia sao cache() por requisicao: a foto e
  // lida uma vez so, e de novo nenhuma quando a pagina aberta e o proprio
  // /setup.
  const jar = await cookies();
  const dispensado = jar.get(COOKIE_GUIA_DISPENSADO)?.value === "1";
  // Login fora do ar (getCurrentUser lanca) tambem vira menu sem nome, nao
  // casca quebrada: o erro subiria ate src/app/error.tsx, acima do layout.
  const [user, guiaDaConta, foto, perfil, alertas, rotas] = await Promise.all([
    getCurrentUser().catch(() => null),
    dispensado ? null : lerGuiaDaConta().catch(() => null),
    dispensado ? null : lerFotoGuia().catch(() => null),
    lerPerfil().catch(() => PERFIL_VAZIO),
    contarAlertasAbertos().catch(() => 0),
    dispensado ? contarRotas().catch(() => null) : null,
  ]);
  const meta = (user?.user_metadata || {}) as { full_name?: string; name?: string };
  // Leitura que falhou (null) nao esconde o grupo Roteamento de quem tem rota.
  // Com a foto lida, as rotas vem dela; senao, da contagem.
  const temRota = dispensado ? rotas !== 0 : foto?.rotas ? foto.rotas.length > 0 : true;

  return (
    <Sidebar
      dados={{
        nome: meta.full_name || meta.name || user?.email || "",
        email: user?.email || "",
        plano: perfil.plano,
        creditos: perfil.creditos,
        alertas,
        temRota,
        guia: cartaoDoGuia(guiaDaConta),
        recolhido: jar.get(COOKIE_MENU)?.value === "1",
      }}
    />
  );
}

/**
 * O cartao do guia: a mesma regra e o mesmo numero da tela /setup, no caminho
 * escolhido (direto ou com vitrine). Some quando completa ou quando o lojista
 * dispensou -- e o que o aviso "Ele sai do menu e do Lucro" promete.
 */
function cartaoDoGuia(conta: Awaited<ReturnType<typeof lerGuiaDaConta>> | null): DadosMenu["guia"] {
  if (!conta || conta.dispensado) return null;
  const guia = conta.guias[conta.caminho];
  if (guia.completo || guia.total === 0) return null;
  const titulo = guia.proximo?.titulo ?? null;
  return {
    feitos: guia.feitos,
    total: guia.total,
    // So a primeira letra, como na tela: "Shopify" e "SKU" continuam como sao.
    proximo: titulo ? `${titulo.charAt(0).toLowerCase()}${titulo.slice(1)}` : null,
  };
}

const PERFIL_VAZIO = { creditos: 0, plano: null };

// As colunas que limitesDoPerfil le para saber se a assinatura ainda vale.
const COLUNAS_ACESSO =
  "is_admin, access_granted, plan, payment_provider, pagou_subscription_id, abacatepay_subscription_id, subscription_status, current_period_end";

/**
 * Saldo de creditos e o nome do plano ("Plano Completo"), numa leitura so do
 * perfil pela sessao. Falha vira contador vazio e plano null -- o menu mostra
 * o e-mail no lugar do plano. O nome so sai com o tier VALENDO (a mesma regra
 * dos limites): `profiles.plano` nao e limpo quando a assinatura cai para free
 * (cancelou, cartao recusado, Pix vencido), entao le-lo sozinho mostrava um
 * plano que a conta nao tem mais. Sem tier (Pro antigo, acesso liberado, sem
 * assinatura) tambem e null: nenhum nome de plano inventado.
 */
async function lerPerfil(): Promise<{ creditos: number; plano: string | null }> {
  const user = await getCurrentUser();
  if (!user) return PERFIL_VAZIO;
  const supabase = await createClient();
  // Sem a coluna plano (064 pendente), le sem ela: a conta cai no legado.
  const { data, error } = await lerComPlano((plano) =>
    supabase
      .from("profiles")
      .select(`ai_credits, ${COLUNAS_ACESSO}${plano}`)
      .eq("id", user.id)
      .maybeSingle()
  );
  if (error || !data) return PERFIL_VAZIO;
  const perfil = data as PerfilParaLimites & { ai_credits?: number | null };
  const limites = limitesDoPerfil(perfil);
  const plano = limites.origem === "plano" ? planoPorId(limites.plano) : null;
  return {
    creditos: Number(perfil.ai_credits ?? 0),
    plano: plano ? `Plano ${nomeNaTela(plano)}` : null,
  };
}

/** Quantas rotas de checkout o usuario tem; null quando a leitura falha. */
async function contarRotas(): Promise<number | null> {
  const user = await getCurrentUser();
  if (!user) return 0;
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("routed_checkout_configs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);
  return error ? null : (count ?? 0);
}

/**
 * O menu enquanto os numeros nao chegaram: o proprio Sidebar, com os dados
 * vazios. Os links do menu e a barra de baixo do celular saem no primeiro
 * byte, sem esperar perfil, alertas e o guia (que pode esperar o tema na
 * Shopify); contadores, conta e o cartao do guia entram depois. Antes era um
 * <aside> vazio e "hidden" no celular: la nao havia navegacao nenhuma ate o
 * menu terminar de ler.
 *
 * Quem tem rota ve o grupo Roteamento entrar depois, acima do grupo do pe.
 */
export function SidebarSkeleton({ recolhido }: { recolhido: boolean }) {
  return (
    <Sidebar
      dados={{
        nome: "",
        email: "",
        plano: null,
        creditos: 0,
        alertas: 0,
        temRota: false,
        guia: null,
        recolhido,
        carregando: true,
      }}
    />
  );
}
