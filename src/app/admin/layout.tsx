import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { LogoXcart } from "@/components/layout/logo";
import { Toaster } from "@/components/ui/sonner";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { CascaAdmin } from "./casca-admin";
import { AdminLogout } from "./logout";
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
    return (
      <main className="flex min-h-dvh items-center justify-center bg-bg px-4 py-12 font-sans text-ink">
        <div className="flex w-full max-w-md flex-col items-center gap-3 rounded-card border border-border bg-surface p-6 text-center">
          <LogoXcart altura={18} prioridade />
          <span
            aria-hidden
            className="mt-2 grid size-11 place-items-center rounded-full border border-warn-border bg-warn-bg text-warn"
          >
            <ShieldAlert className="size-5" strokeWidth={1.75} />
          </span>
          <h1 className="text-page font-semibold text-ink">Acesso restrito</h1>
          <p className="text-body text-t1 text-pretty">
            A conta <strong className="font-semibold break-all text-ink">{user.email}</strong> não tem
            permissão de administrador.
          </p>
          <p className="text-body text-t1 text-pretty">
            Saia e entre com a conta de administrador, ou volte para o painel da sua loja.
          </p>
          <div className="mt-2 flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
            <a
              href={linkApp}
              className="inline-flex h-ctl-md items-center justify-center rounded-control border border-border-strong bg-surface px-4 text-dense font-medium text-ink hover:border-control-border hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              Ir para o app
            </a>
            <AdminLogout rotulo="Sair e trocar de conta" variant="primary" size="md" />
          </div>
        </div>
        <Toaster />
      </main>
    );
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
