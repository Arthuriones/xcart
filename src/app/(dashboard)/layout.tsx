import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { SidebarData, SidebarSkeleton } from "@/components/layout/sidebar-data";
import { TopoDados, TopoEsqueleto } from "@/components/layout/topo-dados";
import { COOKIE_MENU } from "@/components/layout/contexto";
import { Toaster } from "@/components/ui/sonner";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { userHasAccess } from "@/lib/billing/access";
import { textos } from "@/lib/textos";

export const dynamic = "force-dynamic";

/**
 * A casca do painel: menu lateral (barra de baixo no celular), topo com a
 * barra de contexto, busca e sino, e o conteudo centralizado.
 *
 * Menu e topo leem banco dentro de <Suspense>: a tela aparece sem esperar
 * por eles. A pagina rola na janela (nao num painel interno), entao o menu e
 * o topo sao sticky.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Trava de acesso: sem acesso (free nao liberado) cai na pagina /no-access.
  // So bloqueia quando ACCESS_CONTROL_ENABLED=true; senao userHasAccess()=true.
  const user = await getCurrentUser();
  if (user && !(await userHasAccess(user.id))) {
    redirect("/no-access");
  }
  const recolhido = (await cookies()).get(COOKIE_MENU)?.value === "1";
  const t = textos("nav");

  return (
    <div className="flex min-h-dvh bg-bg font-sans text-ink">
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-100 focus:rounded-control focus:bg-solid focus:px-3 focus:py-2 focus:text-dense focus:text-on-solid"
      >
        {t("skipToContent")}
      </a>
      <Suspense fallback={<SidebarSkeleton recolhido={recolhido} />}>
        <SidebarData />
      </Suspense>
      <div className="flex min-w-0 flex-1 flex-col">
        <Suspense fallback={<TopoEsqueleto />}>
          <TopoDados />
        </Suspense>
        <main id="conteudo" tabIndex={-1} className="flex-1 pb-16 outline-none md:pb-0">
          <div className="mx-auto w-full max-w-320 px-4 pb-8 pt-4 md:px-8 md:pb-12 md:pt-6">
            {children}
          </div>
        </main>
      </div>
      <Toaster />
    </div>
  );
}
