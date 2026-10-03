"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowUpRight,
  BarChart3,
  ChevronUp,
  LayoutDashboard,
  LogOut,
  Menu,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";
import clsx from "clsx";
import { LogoXcart } from "@/components/layout/logo";
import { Folha, Pop } from "@/components/layout/sobreposicao";
import { SeletorTema } from "@/components/layout/tema";
import { ITENS_ADMIN, itemAdminAtivo, tituloAdmin, type IdItemAdmin } from "./navegacao-admin";
import { sairDoAdmin } from "./logout";

const ICONE: Record<IdItemAdmin, LucideIcon> = {
  visao: LayoutDashboard,
  usuarios: Users,
  faturamento: TrendingUp,
  uso: BarChart3,
};

function inicial(email: string) {
  return (email.trim()[0] || "?").toUpperCase();
}

/** Selo "Admin" ao lado da logo: deixa claro que este nao e o painel do lojista. */
function SeloAdmin() {
  return (
    <span className="rounded-full border border-border-strong px-1.5 text-label font-semibold leading-4.5 text-t1">
      Admin
    </span>
  );
}

/**
 * A casca do admin (host adm.*): menu lateral no desktop; no celular, topo
 * com o titulo e barra de baixo com as quatro telas e "Mais" (app, tema,
 * sair). O conteudo fica centralizado na mesma largura do app.
 */
export function CascaAdmin({
  email,
  linkApp,
  children,
}: {
  email: string;
  /** Absoluto no host adm.* (ver linkDoApp). */
  linkApp: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const ativo = itemAdminAtivo(pathname);
  const [conta, setConta] = useState(false);
  const [mais, setMais] = useState(false);
  const [saindo, setSaindo] = useState(false);

  function sair() {
    setSaindo(true);
    void sairDoAdmin();
  }

  return (
    <div className="flex min-h-dvh bg-bg font-sans text-ink">
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-100 focus:rounded-control focus:bg-solid focus:px-3 focus:py-2 focus:text-dense focus:text-on-solid"
      >
        Pular para o conteúdo
      </a>

      {/* ---------------- Desktop: menu lateral ---------------- */}
      <aside
        aria-label="Menu do admin"
        className="sticky top-0 hidden h-dvh w-58 shrink-0 flex-col border-r border-border bg-surface md:flex"
      >
        <div className="flex h-14 shrink-0 items-center gap-2 pl-4 pr-3">
          <Link
            href="/admin"
            aria-label="xcart admin, ir para a visão geral"
            className="flex items-center gap-2 rounded-control focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <LogoXcart altura={18} prioridade />
            <SeloAdmin />
          </Link>
        </div>

        <nav aria-label="Telas do admin" className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-3 pt-1">
          {ITENS_ADMIN.map((item) => {
            const on = item.id === ativo?.id;
            const Icone = ICONE[item.id];
            return (
              <Link
                key={item.id}
                href={item.href}
                aria-current={on ? "page" : undefined}
                className={clsx(
                  "flex h-8 items-center gap-2.5 rounded-control px-2 text-dense focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
                  on ? "bg-nav-active font-semibold text-ink" : "text-t1 hover:bg-hover hover:text-ink"
                )}
              >
                <Icone className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
                <span className="min-w-0 flex-1 truncate">{item.rotulo}</span>
              </Link>
            );
          })}
        </nav>

        <div className="flex shrink-0 flex-col gap-1 border-t border-border p-2">
          <a
            href={linkApp}
            className="flex h-8 items-center gap-2.5 rounded-control px-2 text-dense text-t1 hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <ArrowUpRight className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
            Ir para o app
          </a>
          <Pop
            rotulo="Conta"
            aberto={conta}
            aoMudar={setConta}
            lado="top"
            className="w-56 p-1.5"
            gatilho={
              <button
                type="button"
                aria-label={`Conta de ${email}`}
                className="flex h-10 w-full items-center gap-2.5 rounded-control px-2 text-left hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                <span
                  aria-hidden
                  className="grid size-6 shrink-0 place-items-center rounded-full bg-track text-label font-semibold text-t1"
                >
                  {inicial(email)}
                </span>
                <span className="min-w-0 flex-1 truncate text-dense font-medium text-ink">{email}</span>
                <ChevronUp className="size-3.5 shrink-0 text-t3" strokeWidth={1.75} aria-hidden />
              </button>
            }
          >
            <div className="truncate px-2 py-1.5 text-label text-t2">{email}</div>
            <div className="flex flex-col gap-1.5 px-2 pb-2 pt-1">
              <span className="text-label text-t2">Tema</span>
              <SeletorTema />
            </div>
            <div className="my-0.5 h-px bg-border" />
            <button
              type="button"
              onClick={sair}
              disabled={saindo}
              aria-busy={saindo || undefined}
              className="flex h-8 w-full items-center gap-2 rounded-control px-2 text-dense text-err hover:bg-err-bg disabled:cursor-progress"
            >
              <LogOut className="size-4" strokeWidth={1.75} aria-hidden />
              {saindo ? "Saindo…" : "Sair"}
            </button>
          </Pop>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* ---------------- Celular: topo ---------------- */}
        <header className="sticky top-0 z-30 border-b border-border bg-surface md:hidden">
          <div className="flex h-14 items-center gap-2 px-4">
            <Link
              href="/admin"
              aria-label="xcart admin, ir para a visão geral"
              className="flex h-ctl-lg shrink-0 items-center gap-1.5"
            >
              <LogoXcart altura={14} />
              <SeloAdmin />
            </Link>
            <h1 className="ml-1 min-w-0 flex-1 truncate text-section font-semibold text-ink">
              {tituloAdmin(pathname)}
            </h1>
          </div>
        </header>

        <main id="conteudo" tabIndex={-1} className="flex-1 pb-16 outline-none md:pb-0">
          <div className="mx-auto w-full max-w-320 px-4 pb-8 pt-4 md:px-8 md:pb-12 md:pt-6">{children}</div>
        </main>
      </div>

      {/* ---------------- Celular: barra de baixo + "Mais" ---------------- */}
      <nav
        aria-label="Menu do admin"
        className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-stretch justify-around border-t border-border bg-surface px-1 pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {ITENS_ADMIN.map((item) => {
          const on = item.id === ativo?.id;
          const Icone = ICONE[item.id];
          return (
            <Link
              key={item.id}
              href={item.href}
              aria-current={on ? "page" : undefined}
              className={clsx(
                "flex min-w-11 flex-1 flex-col items-center justify-center gap-1 text-label",
                on ? "font-semibold text-ink" : "text-t2 hover:text-ink"
              )}
            >
              <Icone className="size-5" strokeWidth={1.75} aria-hidden />
              <span>{item.curto}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMais(true)}
          aria-haspopup="dialog"
          className="flex min-w-11 flex-1 flex-col items-center justify-center gap-1 text-label text-t2 hover:text-ink"
        >
          <Menu className="size-5" strokeWidth={1.75} aria-hidden />
          <span>Mais</span>
        </button>
      </nav>

      <Folha aberto={mais} aoMudar={setMais} titulo="Menu" rotuloFechar="Fechar menu">
        <div className="flex flex-col gap-3 px-3 pb-4 pt-2">
          <a
            href={linkApp}
            className="flex min-h-ctl-lg items-center gap-3 rounded-control px-2 text-body text-t1 hover:bg-hover hover:text-ink"
          >
            <ArrowUpRight className="size-5 shrink-0" strokeWidth={1.75} aria-hidden />
            <span className="flex-1">Ir para o app</span>
          </a>
          <div className="flex flex-col gap-3 border-t border-border px-2 pt-3">
            <div className="flex items-center gap-2.5">
              <span aria-hidden className="grid size-8 place-items-center rounded-full bg-track font-semibold text-t1">
                {inicial(email)}
              </span>
              <span className="min-w-0 truncate text-body font-medium text-ink">{email}</span>
            </div>
            <SeletorTema grande />
            <button
              type="button"
              onClick={sair}
              disabled={saindo}
              aria-busy={saindo || undefined}
              className="h-ctl-lg rounded-control border border-err-border text-body font-medium text-err hover:bg-err-bg disabled:cursor-progress"
            >
              {saindo ? "Saindo…" : "Sair da conta"}
            </button>
          </div>
        </div>
      </Folha>
    </div>
  );
}
