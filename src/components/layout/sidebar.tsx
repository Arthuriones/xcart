"use client";

import { usePathname } from "next/navigation";
import { textos } from "@/lib/textos";
import {
  Activity,
  ChevronDown,
  CreditCard,
  Download,
  LayoutGrid,
  ListChecks,
  LogOut,
  Store,
  TrendingUp,
  Terminal,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Numero a direita: quantas lojas, quantos creditos. */
  counter?: "stores" | "credits";
}

interface NavSection {
  /** Chave de traducao; ausente = grupo sem cabecalho. */
  label?: string;
  items: NavItem[];
}

// A ordem e a do design: o que se configura uma vez em cima, a operacao no
// meio, a conta embaixo.
const NAV: NavSection[] = [
  {
    items: [
      { href: "/setup", label: "setup", icon: ListChecks },
      { href: "/overview", label: "overview", icon: LayoutGrid },
    ],
  },
  {
    label: "operations",
    items: [
      { href: "/stores", label: "connectedStores", icon: Store, counter: "stores" },
      { href: "/sales", label: "sales", icon: TrendingUp },
      { href: "/clone/routed-checkout", label: "routing", icon: Waypoints },
      { href: "/clone/shopify", label: "importProducts", icon: Download },
    ],
  },
  {
    items: [
      { href: "/activity", label: "activity", icon: Activity },
      { href: "/billing", label: "billing", icon: CreditCard, counter: "credits" },
      { href: "/claude", label: "claude", icon: Terminal },
    ],
  },
];

const MOBILE = [
  NAV[1].items[1], // roteamento
  NAV[1].items[0], // lojas
  NAV[1].items[2], // importar
  NAV[0].items[1], // visao geral
];

function initial(nome: string) {
  return (nome.trim()[0] || "?").toUpperCase();
}

export interface SidebarData {
  nome: string;
  email: string;
  stores: number;
  credits: number;
  percent: number;
  nextLabel: string;
}

export function Sidebar({ dados }: { dados: SidebarData }) {
  const pathname = usePathname();
  const router = useRouter();
  const t = textos("nav");

  const contadores = { stores: dados.stores, credits: dados.credits };
  // O medidor some quando a operacao esta pronta: cravado em 100% vira ruido
  // permanente.
  const progresso =
    dados.percent < 100 ? { pct: dados.percent, next: dados.nextLabel } : null;


  function ativo(href: string) {
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  async function sair() {
    // Rota de API em vez do cliente Supabase: ver src/app/api/auth/logout.
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <>
      <aside className="fixed left-0 top-0 z-40 hidden h-screen w-[216px] flex-col border-r border-border bg-surface md:flex">
        <div className="flex h-14 shrink-0 items-center gap-2.5 px-4">
          <Link
            href="/overview"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--solid)] text-[11px] font-bold tracking-tight text-[var(--on-solid)]"
            aria-label="xcart"
          >
            X
          </Link>
          <span className="min-w-0">
            <span className="block text-[12.5px] font-semibold leading-tight text-ink">
              XCART
            </span>
            <span className="block truncate text-[10.5px] leading-tight text-t3">
              {contadores.stores === 1
                ? "1 loja conectada"
                : `${contadores.stores} lojas conectadas`}
            </span>
          </span>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-2.5">
          {NAV.map((secao, i) => (
            <div key={secao.label ?? `s${i}`} className={i === 0 ? "" : "mt-3"}>
              {secao.label && (
                <div className="px-2 pb-[5px] pt-3.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-t4">
                  {t(secao.label)}
                </div>
              )}
              <div className="flex flex-col gap-px">
                {secao.items.map((item) => {
                  const on = ativo(item.href);
                  const valor = item.counter ? contadores[item.counter] : null;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "group flex items-center gap-[9px] rounded-md px-2 py-1.5 text-[13px] transition-colors",
                        on
                          ? "bg-[var(--nav-active)] font-medium text-ink"
                          : "text-t2 hover:bg-hover hover:text-ink"
                      )}
                    >
                      <item.icon
                        className={cn("h-[15px] w-[15px] shrink-0", on ? "text-ink" : "text-t3")}
                        strokeWidth={1.75}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1 truncate">{t(item.label)}</span>
                      {valor ? (
                        <span className="font-mono text-[10px] tabular-nums text-t4">
                          {valor}
                        </span>
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Progresso da configuracao. Some quando a operacao esta pronta --
            um medidor cravado em 100% vira ruido permanente. */}
        {progresso && (
          <Link
            href="/setup"
            className="mx-2.5 mb-2 shrink-0 rounded-lg border border-border bg-surface-2 px-3 py-2.5 transition-colors hover:border-[var(--border-strong)]"
          >
            <span className="flex items-baseline justify-between gap-2">
              <span className="text-[11.5px] font-medium text-ink">{t("setup")}</span>
              <span className="font-mono text-[11px] tabular-nums text-t2">
                {progresso.pct}%
              </span>
            </span>
            <span className="mt-1.5 block h-[3px] overflow-hidden rounded-full bg-[var(--track)]">
              <span
                className="block h-full rounded-full bg-[var(--brand)] transition-[width] duration-500"
                style={{ width: `${progresso.pct}%` }}
              />
            </span>
            <span className="mt-1.5 block truncate text-[10.5px] text-t3">
              {progresso.next}
            </span>
          </Link>
        )}

        <div className="shrink-0 border-t border-border px-2.5 py-2">
          <DropdownMenu>
            <DropdownMenuTrigger className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-hover focus-visible:outline-none">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--track)] text-[10.5px] font-semibold text-t1">
                {initial(dados.nome)}
              </span>
              <span className="min-w-0 flex-1 truncate text-[12px] text-ink">
                {dados.nome || "—"}
              </span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-t4" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top" className="w-[206px]">
              {/* O Group NAO e decoracao: DropdownMenuLabel renderiza
                  Menu.GroupLabel do Base UI, que LANCA se nao achar um
                  Menu.Group acima. Sem ele, abrir este menu derrubava a
                  pagina inteira. */}
              <DropdownMenuGroup>
                <DropdownMenuLabel className="truncate text-[11px] font-normal text-t3">
                  {dados.email}
                </DropdownMenuLabel>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={sair}>
                <LogOut className="mr-2 h-3.5 w-3.5" />
                {t("logout")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="mt-1.5 flex items-center justify-between px-2">
            <span className="text-[9.5px] font-semibold uppercase tracking-[0.13em] text-t4">
              {t("theme")}
            </span>
            <ThemeToggle />
          </div>
        </div>
      </aside>

      <nav className="fixed inset-x-0 bottom-0 z-50 flex h-14 items-center justify-around border-t border-border bg-surface px-2 md:hidden">
        {MOBILE.map((item) => {
          const on = ativo(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex h-full min-w-[56px] flex-col items-center justify-center gap-1 transition-colors",
                on ? "text-ink" : "text-t3"
              )}
            >
              <item.icon className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden />
              <span className="text-[9.5px] font-medium">{t(item.label)}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
