import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createClient } from "@/lib/supabase/server";
import { contarAlertasAbertos } from "@/lib/leitura/notificacoes";
import { lerFotoGuia, lerGuiaDaConta } from "@/lib/leitura/guia-configuracao";
import { COOKIE_GUIA_DISPENSADO } from "@/lib/leitura/guia-passos";
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
  const [user, guiaDaConta, foto, creditos, alertas, rotas] = await Promise.all([
    getCurrentUser(),
    dispensado ? null : lerGuiaDaConta().catch(() => null),
    dispensado ? null : lerFotoGuia().catch(() => null),
    lerCreditos(),
    contarAlertasAbertos().catch(() => 0),
    dispensado ? contarRotas() : null,
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
        creditos,
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

/** Saldo de creditos pela sessao; falha vira 0 (contador vazio). */
async function lerCreditos(): Promise<number> {
  const user = await getCurrentUser();
  if (!user) return 0;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("ai_credits")
    .eq("id", user.id)
    .maybeSingle();
  return error ? 0 : Number(data?.ai_credits ?? 0);
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

/** O menu enquanto os numeros nao chegaram: mesma largura, sem pulo. */
export function SidebarSkeleton({ recolhido }: { recolhido: boolean }) {
  return (
    <aside
      aria-hidden
      className={
        "sticky top-0 hidden h-dvh shrink-0 border-r border-border bg-surface md:block " +
        (recolhido ? "w-15" : "w-58")
      }
    />
  );
}
