import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Toaster } from "@/components/ui/sonner";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { CascaAdmin } from "./casca-admin";
import { AcessoRestrito } from "./acesso-restrito";
import { linkDoApp } from "./navegacao-admin";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "xcart admin" };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [{ data: profile }, cabecalhos] = await Promise.all([
    createAdminClient().from("profiles").select("is_admin").eq("id", user.id).single(),
    headers(),
  ]);
  const linkApp = linkDoApp(cabecalhos.get("host"), process.env.NEXT_PUBLIC_APP_URL);

  // Conta logada sem permissao de admin: mostra um aviso explicito em vez de
  // redirecionar para /login. O redirect criava um loop infinito (login ->
  // /stores -> middleware manda para /admin -> layout devolve para /login),
  // fazendo parecer que o admin estava fora do ar quando na verdade era a
  // conta errada.
  if (!profile?.is_admin) {
    return <AcessoRestrito email={user.email ?? "—"} linkApp={linkApp} />;
  }

  return (
    <>
      <CascaAdmin email={user.email ?? "—"} linkApp={linkApp}>
        {children}
      </CascaAdmin>
      <Toaster />
    </>
  );
}
