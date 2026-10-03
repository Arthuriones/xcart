import { hrefAtivo } from "@/components/layout/nav-ativo";
import { APP_HOME } from "@/lib/app-home";

// ============================================================================
// Navegacao do admin (host adm.*): os quatro destinos, qual acende, o titulo
// do topo no celular e o link de volta para o app. Puro, testado em
// tests/admin-navegacao.test.ts.
// ============================================================================

export type IdItemAdmin = "visao" | "usuarios" | "faturamento" | "uso";

export interface ItemAdmin {
  id: IdItemAdmin;
  href: string;
  /** Nome no menu e titulo da tela: o mesmo texto nos dois lugares. */
  rotulo: string;
  /** Rotulo da barra de baixo no celular (cabe em 75px). */
  curto: string;
}

export const ITENS_ADMIN: readonly ItemAdmin[] = [
  { id: "visao", href: "/admin", rotulo: "Visão geral", curto: "Visão" },
  { id: "usuarios", href: "/admin/users", rotulo: "Usuários", curto: "Usuários" },
  { id: "faturamento", href: "/admin/faturamento", rotulo: "Faturamento", curto: "Faturamento" },
  { id: "uso", href: "/admin/usage", rotulo: "Uso e custos", curto: "Uso" },
];

/** O item aceso: vence o href mais longo ("/admin" casa com tudo). */
export function itemAdminAtivo(pathname: string): ItemAdmin | null {
  const href = hrefAtivo(
    pathname,
    ITENS_ADMIN.map((i) => i.href)
  );
  return ITENS_ADMIN.find((i) => i.href === href) ?? null;
}

/** Titulo do topo no celular. */
export function tituloAdmin(pathname: string): string {
  return itemAdminAtivo(pathname)?.rotulo ?? "Admin";
}

/**
 * Para onde vai o "Ir para o app".
 *
 * No host adm.* o middleware manda qualquer caminho fora de /admin de volta
 * para /admin -- um link relativo para /financeiro nunca sairia do admin. Ali
 * o link e absoluto: NEXT_PUBLIC_APP_URL quando existe, senao o mesmo dominio
 * com "user." no lugar de "adm." (a mesma regra do middleware). Em localhost e
 * nas previas da Vercel admin e app dividem o host, e o relativo basta.
 */
export function linkDoApp(host: string | null | undefined, urlApp?: string | null): string {
  const h = (host ?? "").trim().toLowerCase();
  if (!h.startsWith("adm.")) return APP_HOME;
  const base = urlApp?.trim()
    ? urlApp.trim().replace(/\/+$/, "")
    : `https://user.${h.slice(4)}`;
  return `${base}${APP_HOME}`;
}
