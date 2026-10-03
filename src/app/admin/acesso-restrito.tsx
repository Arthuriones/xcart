import { ShieldAlert } from "lucide-react";
import { LogoXcart } from "@/components/layout/logo";
import { Toaster } from "@/components/ui/sonner";
import { AdminLogout } from "./logout";

/**
 * Conta logada sem permissao de admin: diz qual conta e, e oferece sair
 * (trocar de conta) ou voltar para o painel da loja.
 */
export function AcessoRestrito({ email, linkApp }: { email: string; linkApp: string }) {
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
          A conta <strong className="font-semibold break-all text-ink">{email}</strong> não tem permissão de
          administrador.
        </p>
        <p className="text-body text-t1 text-pretty">
          Saia e entre com a conta de administrador, ou volte para o painel da sua loja.
        </p>
        <div className="mt-2 flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
          <a
            href={linkApp}
            className="inline-flex h-ctl-lg items-center justify-center rounded-control border border-border-strong bg-surface px-4 text-dense font-medium text-ink hover:border-control-border hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus sm:h-ctl-md"
          >
            Ir para o app
          </a>
          <AdminLogout rotulo="Sair e trocar de conta" variant="primary" size="md" className="max-sm:h-ctl-lg" />
        </div>
      </div>
      <Toaster />
    </main>
  );
}
