"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronUp, Keyboard, LogOut, Menu, PanelLeft } from "lucide-react";
import clsx from "clsx";
import { LogoXcart } from "@/components/layout/logo";
import { APP_HOME } from "@/lib/app-home";
import { textos } from "@/lib/textos";
import { COOKIE_MENU, gravarCookie } from "./contexto";
import { BARRA_CELULAR, gruposNav, itemAtivo, type ItemNav } from "./navegacao";
import { Folha, Pop } from "./sobreposicao";
import { SeletorTema } from "./tema";

const t = textos("nav");

/** O que o menu mostra alem dos links. Tudo lido no servidor (sidebar-data). */
export interface DadosMenu {
  nome: string;
  email: string;
  lojas: number;
  creditos: number;
  alertas: number;
  /** Tem rota de checkout? Sem rota, Roteamento vira "Ativar roteamento". */
  temRota: boolean;
  /** Guia de configuracao: so enquanto incompleto e so para quem usa rota. */
  guia: { feitos: number; total: number; proximo: string } | null;
  /** Menu recolhido, do cookie: a largura certa ja no primeiro desenho. */
  recolhido: boolean;
}

function inicial(nome: string) {
  return (nome.trim()[0] || "?").toUpperCase();
}

/** Abre a lista de atalhos (ela mora no topo, junto da busca). */
export function abrirAtalhos() {
  window.dispatchEvent(new Event("xcart:atalhos"));
}

async function sair(router: ReturnType<typeof useRouter>) {
  // Rota de API em vez do cliente Supabase: ver src/app/api/auth/logout.
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
  router.push("/login");
  router.refresh();
}

function Contador({ item, dados }: { item: ItemNav; dados: DadosMenu }) {
  if (!item.contador) return null;
  const valor = { lojas: dados.lojas, creditos: dados.creditos, alertas: dados.alertas }[
    item.contador
  ];
  if (!valor) return null;
  if (item.contador === "alertas") {
    return (
      <span className="num rounded-full bg-err-bg px-1.5 text-label font-medium leading-4.5 text-err">
        {valor}
        <span className="sr-only"> abertos</span>
      </span>
    );
  }
  return <span className="num text-label text-t2">{valor.toLocaleString("pt-BR")}</span>;
}

export function Sidebar({ dados }: { dados: DadosMenu }) {
  const pathname = usePathname();
  const router = useRouter();
  const [recolhido, setRecolhido] = useState(dados.recolhido);
  const [mais, setMais] = useState(false);
  const [conta, setConta] = useState(false);

  const ativo = itemAtivo(pathname);
  const grupos = gruposNav(dados.temRota);
  const aberto = !recolhido;

  function alternar() {
    const proximo = !recolhido;
    setRecolhido(proximo);
    setConta(false);
    gravarCookie(COOKIE_MENU, proximo ? "1" : "0");
  }

  const pct = dados.guia ? Math.round((dados.guia.feitos / dados.guia.total) * 100) : 0;
  const ativoNaBarra = BARRA_CELULAR.find((b) => ativo && b.acende.includes(ativo));

  return (
    <>
      {/* ---------------- Desktop: menu lateral recolhivel ---------------- */}
      <aside
        aria-label={t("mainMenu")}
        className={clsx(
          "sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-150 md:flex",
          aberto ? "w-58" : "w-15"
        )}
      >
        <div
          className={clsx(
            "flex h-14 shrink-0 items-center gap-2",
            aberto ? "justify-between pl-4 pr-3" : "justify-center"
          )}
        >
          {aberto && (
            <Link href={APP_HOME} aria-label="xcart, ir para o Lucro" className="w-fit">
              <LogoXcart altura={18} prioridade />
            </Link>
          )}
          <button
            type="button"
            onClick={alternar}
            aria-label={aberto ? t("collapseMenu") : t("expandMenu")}
            aria-expanded={aberto}
            className="grid size-ctl-sm place-items-center rounded-control text-t2 hover:bg-hover hover:text-ink"
          >
            <PanelLeft className="size-4" strokeWidth={1.75} aria-hidden />
          </button>
        </div>

        <nav
          aria-label={t("screens")}
          className={clsx(
            "flex flex-1 flex-col gap-4 px-2 pb-3 pt-1",
            // Recolhido, a dica do item sai para a direita: overflow visivel
            // para ela nao ser cortada.
            aberto ? "overflow-y-auto" : "overflow-visible"
          )}
        >
          {grupos.map((g) => (
            <div key={g.id} className="flex flex-col gap-0.5">
              {g.rotulo && aberto && (
                <div className="px-2 pb-1 text-label font-medium text-t3">{g.rotulo}</div>
              )}
              {g.itens.map((item) => {
                const on = item.id === ativo;
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    aria-current={on ? "page" : undefined}
                    aria-label={
                      aberto
                        ? undefined
                        : item.contador === "alertas" && dados.alertas > 0
                          ? `${item.rotulo}, ${dados.alertas} abertos`
                          : item.rotulo
                    }
                    className={clsx(
                      "group relative flex h-8 items-center gap-2.5 rounded-control px-2 text-dense",
                      on
                        ? "bg-nav-active font-semibold text-ink"
                        : item.convite
                          ? "text-t3 hover:bg-hover hover:text-ink"
                          : "text-t1 hover:bg-hover hover:text-ink"
                    )}
                  >
                    <item.icone className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
                    {aberto ? (
                      <>
                        <span className="min-w-0 flex-1 truncate">{item.rotulo}</span>
                        <Contador item={item} dados={dados} />
                      </>
                    ) : (
                      <>
                        {item.contador === "alertas" && dados.alertas > 0 && (
                          <span
                            aria-hidden
                            className="absolute right-1 top-1 size-2 rounded-full bg-err"
                          />
                        )}
                        <span
                          aria-hidden
                          className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 hidden -translate-y-1/2 whitespace-nowrap rounded-control bg-solid px-2 py-1 text-label font-normal text-on-solid group-hover:block group-focus-visible:block"
                        >
                          {item.rotulo}
                        </span>
                      </>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {dados.guia && aberto && (
          <Link
            href="/setup"
            className="mx-3 mb-3 flex shrink-0 flex-col gap-2 rounded-card border border-border bg-surface-2 p-3 text-ink hover:border-border-strong"
          >
            <span className="flex items-baseline justify-between gap-2">
              <span className="text-label font-semibold">{t("setupGuide")}</span>
              <span className="num text-label text-t2">
                {dados.guia.feitos} de {dados.guia.total}
              </span>
            </span>
            <span
              role="progressbar"
              aria-label="Progresso do guia"
              aria-valuemin={0}
              aria-valuemax={dados.guia.total}
              aria-valuenow={dados.guia.feitos}
              className="block h-1 overflow-hidden rounded-full bg-track"
            >
              <span className="block h-full rounded-full bg-ink" style={{ width: `${pct}%` }} />
            </span>
            <span className="truncate text-label text-t2">Próximo: {dados.guia.proximo}</span>
          </Link>
        )}

        <div className="shrink-0 border-t border-border p-2">
          <Pop
            rotulo="Conta"
            aberto={conta}
            aoMudar={setConta}
            lado="top"
            className="w-56 p-1.5"
            gatilho={
              <button
                type="button"
                aria-label={`Conta de ${dados.nome || dados.email}`}
                className={clsx(
                  "flex h-10 w-full items-center gap-2.5 rounded-control px-2 text-left hover:bg-hover",
                  !aberto && "justify-center"
                )}
              >
                <span
                  aria-hidden
                  className="grid size-6 shrink-0 place-items-center rounded-full bg-track text-label font-semibold text-t1"
                >
                  {inicial(dados.nome || dados.email)}
                </span>
                {aberto && (
                  <>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-dense font-medium text-ink">
                        {dados.nome || "—"}
                      </span>
                      <span className="truncate text-label text-t3">{dados.email}</span>
                    </span>
                    <ChevronUp className="size-3.5 shrink-0 text-t3" strokeWidth={1.75} aria-hidden />
                  </>
                )}
              </button>
            }
          >
            <div className="truncate px-2 py-1.5 text-label text-t3">{dados.email}</div>
            <div className="flex flex-col gap-1.5 px-2 pb-2 pt-1">
              <span className="text-label text-t2">{t("theme")}</span>
              <SeletorTema />
            </div>
            <div className="my-0.5 h-px bg-border" />
            <button
              type="button"
              onClick={() => {
                setConta(false);
                abrirAtalhos();
              }}
              className="flex h-8 w-full items-center justify-between gap-2 rounded-control px-2 text-dense text-ink hover:bg-hover"
            >
              <span className="flex items-center gap-2">
                <Keyboard className="size-4 text-t2" strokeWidth={1.75} aria-hidden />
                {t("shortcuts")}
              </span>
              <kbd className="rounded-control border border-border px-1.5 font-mono text-label text-t2">?</kbd>
            </button>
            <button
              type="button"
              onClick={() => sair(router)}
              className="flex h-8 w-full items-center gap-2 rounded-control px-2 text-dense text-err hover:bg-err-bg"
            >
              <LogOut className="size-4" strokeWidth={1.75} aria-hidden />
              {t("logout")}
            </button>
          </Pop>
        </div>
      </aside>

      {/* ---------------- Celular: barra de baixo + "Mais" ---------------- */}
      <nav
        aria-label={t("mainMenu")}
        className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-stretch justify-around border-t border-border bg-surface px-1 pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {BARRA_CELULAR.map((b) => {
          const on = b === ativoNaBarra;
          const alertas = b.item.contador === "alertas" ? dados.alertas : 0;
          return (
            <Link
              key={b.item.id}
              href={b.item.href}
              aria-current={on ? "page" : undefined}
              className={clsx(
                "relative flex min-w-11 flex-1 flex-col items-center justify-center gap-1 text-label",
                on ? "font-semibold text-ink" : "text-t2 hover:text-ink"
              )}
            >
              <b.item.icone className="size-5" strokeWidth={1.75} aria-hidden />
              <span>{b.rotulo}</span>
              {alertas > 0 && (
                <span className="num absolute left-[calc(50%+6px)] top-2 h-4.5 min-w-4.5 rounded-full bg-err px-1 text-center text-label font-semibold leading-4.5 text-surface">
                  {alertas}
                  <span className="sr-only"> alertas abertos</span>
                </span>
              )}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMais(true)}
          aria-haspopup="dialog"
          className={clsx(
            "flex min-w-11 flex-1 flex-col items-center justify-center gap-1 text-label",
            !ativoNaBarra ? "font-semibold text-ink" : "text-t2 hover:text-ink"
          )}
        >
          <Menu className="size-5" strokeWidth={1.75} aria-hidden />
          <span>{t("more")}</span>
        </button>
      </nav>

      <Folha aberto={mais} aoMudar={setMais} titulo={t("menu")} rotuloFechar="Fechar menu">
        <div className="flex flex-col gap-4 px-3 pb-4 pt-2">
          {grupos.map((g) => (
            <div key={g.id} className="flex flex-col">
              {g.rotulo && <div className="px-2 py-1 text-label font-medium text-t3">{g.rotulo}</div>}
              {g.itens.map((item) => {
                const on = item.id === ativo;
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    onClick={() => setMais(false)}
                    aria-current={on ? "page" : undefined}
                    className={clsx(
                      "flex min-h-ctl-lg items-center gap-3 rounded-control px-2 text-body",
                      on
                        ? "bg-nav-active font-semibold text-ink"
                        : item.convite
                          ? "text-t3 hover:bg-hover"
                          : "text-t1 hover:bg-hover hover:text-ink"
                    )}
                  >
                    <item.icone className="size-5 shrink-0" strokeWidth={1.75} aria-hidden />
                    <span className="flex-1">{item.rotulo}</span>
                    <Contador item={item} dados={dados} />
                  </Link>
                );
              })}
            </div>
          ))}

          <div className="flex flex-col gap-3 border-t border-border px-2 pt-3">
            <div className="flex items-center gap-2.5">
              <span
                aria-hidden
                className="grid size-8 place-items-center rounded-full bg-track font-semibold text-t1"
              >
                {inicial(dados.nome || dados.email)}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-body font-medium text-ink">{dados.nome || "—"}</span>
                <span className="truncate text-label text-t3">{dados.email}</span>
              </span>
            </div>
            <SeletorTema grande />
            <button
              type="button"
              onClick={() => sair(router)}
              className="h-ctl-lg rounded-control border border-err-border text-body font-medium text-err hover:bg-err-bg"
            >
              {t("logoutAccount")}
            </button>
          </div>
        </div>
      </Folha>
    </>
  );
}
