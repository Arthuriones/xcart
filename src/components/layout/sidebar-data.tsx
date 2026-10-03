import { cookies } from "next/headers";
import { getSetupStatus } from "@/lib/setup/status";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createClient } from "@/lib/supabase/server";
import { contarAlertasAbertos } from "@/lib/leitura/notificacoes";
import { COOKIE_MENU } from "./contexto";
import { Sidebar } from "./sidebar";

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
  const [user, status, alertas, rotas, jar] = await Promise.all([
    getCurrentUser(),
    getSetupStatus(),
    contarAlertasAbertos().catch(() => 0),
    contarRotas(),
    cookies(),
  ]);
  const meta = (user?.user_metadata || {}) as { full_name?: string; name?: string };
  // Leitura que falhou (null) nao vira "Ativar roteamento" para quem tem rota.
  const temRota = rotas !== 0;

  // O guia de hoje so conhece a operacao com vitrine: para quem anuncia direto
  // na loja de checkout ele nunca chega a 100% e virava um cartao eterno. Fica
  // so para quem tem rota, e some quando completa.
  const passos = status.steps.length;
  const feitos = status.steps.filter((s) => s.done).length;
  const guia =
    temRota && passos > 0 && feitos < passos && status.next
      ? { feitos, total: passos, proximo: status.next.title.toLowerCase() }
      : null;

  return (
    <Sidebar
      dados={{
        nome: meta.full_name || meta.name || user?.email || "",
        email: user?.email || "",
        lojas: status.storeCount,
        creditos: status.credits,
        alertas,
        temRota,
        guia,
        recolhido: jar.get(COOKIE_MENU)?.value === "1",
      }}
    />
  );
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
