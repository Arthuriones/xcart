"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronsUpDown, LogOut, Menu, PanelLeft, Search } from "lucide-react";
import clsx from "clsx";
import { LogoXcart } from "@/components/layout/logo";
import { APP_HOME } from "@/lib/app-home";
import { textos } from "@/lib/textos";
import { COOKIE_MENU, gravarCookie } from "./contexto";
import { BARRA_CELULAR, gruposNav, itemAcesoNoMenu, itemAtivo, type ItemNav } from "./navegacao";
import { abrirBusca } from "./paleta-comandos";
import { Folha, Pop } from "./sobreposicao";
import { SeletorTema } from "./tema";

const t = textos("nav");

/** O que o menu mostra alem dos links. Tudo lido no servidor (sidebar-data). */
export interface DadosMenu {
  nome: string;
  email: string;
  /** "Plano Completo"; null = sem tier gravado (ai o menu mostra o e-mail). */
  plano: string | null;
  creditos: number;
  alertas: number;
  /**
   * Tem rota de checkout? Sem rota, o grupo Roteamento sai do menu (continua
   * em Configuracoes > Modulos e na busca).
   */
  temRota: boolean;
  /**
   * Guia de configuracao no caminho escolhido (direto ou com vitrine): so
   * enquanto incompleto e nao dispensado. proximo null = o que falta nao deu
   * para conferir agora.
   */
  guia: { feitos: number; total: number; proximo: string | null } | null;
  /** Menu recolhido, do cookie: a largura certa ja no primeiro desenho. */
  recolhido: boolean;
}

/** "Arthur Ferreira" -> "AF"; um nome so (ou o e-mail) -> a primeira letra. */
function iniciais(nome: string) {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] : "";
  return `${partes[0][0]}${ultima}`.toUpperCase();
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

/** Quanto o contador do item vale agora (0 = nao mostra). */
function valorDoContador(item: ItemNav, dados: DadosMenu): number {
  if (!item.contador) return 0;
  return item.contador === "alertas" ? dados.alertas : dados.creditos;
}

/**
 * O nome do item para o leitor de tela: o rotulo e, se houver, o contador.
 * Vai sempre no aria-label, porque abaixo de 1100 px o rotulo some por CSS.
 */
function nomeAcessivel(item: ItemNav, dados: DadosMenu): string {
  const n = valorDoContador(item, dados);
  if (!n) return item.rotulo;
  if (item.contador === "alertas") return `${item.rotulo}, ${n} ${n === 1 ? "aberto" : "abertos"}`;
  return `${item.rotulo}, ${n.toLocaleString("pt-BR")} ${n === 1 ? "crédito" : "créditos"}`;
}

function Contador({ item, dados, className }: { item: ItemNav; dados: DadosMenu; className?: string }) {
  const valor = valorDoContador(item, dados);
  if (!valor) return null;
  if (item.contador === "alertas") {
    return (
      <span
        aria-hidden
        className={clsx("num rounded-full bg-err-bg px-1.5 text-label font-medium leading-4.5 text-err", className)}
      >
        {valor}
      </span>
    );
  }
  return (
    <span aria-hidden className={clsx("num text-label leading-4.5 text-t3", className)}>
      {valor.toLocaleString("pt-BR")}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Aberto ou recolhido
//
// Recolhido pelo cookie vale em qualquer largura. Aberto pelo cookie so abre
// de 1100 px para cima: abaixo disso o menu fica recolhido (60 px) para o
// painel nao espremer. A regra dos 1100 e de CSS -- o servidor nao sabe a
// largura da janela, e decidir em JavaScript desenharia aberto e depois
// fecharia (pulo). Por isso as classes vem em pares literais (o Tailwind so
// gera a classe que encontra escrita no codigo).
// ---------------------------------------------------------------------------

function classes(recolhido: boolean) {
  if (recolhido) {
    return {
      largura: "w-15",
      flex: "hidden",
      block: "hidden",
      soRecolhido: "",
      centro: "justify-center",
      dica: "hidden group-hover:block group-focus-visible:block",
      rolagem: "overflow-visible",
      grupo: "not-first:pt-3",
      busca: "justify-center",
    };
  }
  return {
    largura: "w-15 min-[1100px]:w-60",
    flex: "hidden min-[1100px]:flex",
    block: "hidden min-[1100px]:block",
    soRecolhido: "min-[1100px]:hidden",
    centro: "justify-center min-[1100px]:justify-start",
    dica: "hidden max-[1100px]:group-hover:block max-[1100px]:group-focus-visible:block",
    // Recolhido, a dica do item sai para a direita: overflow visivel para ela
    // nao ser cortada.
    rolagem: "overflow-visible min-[1100px]:overflow-y-auto",
    // Sem rotulo de grupo, um respiro separa os grupos.
    grupo: "max-[1100px]:not-first:pt-3",
    busca: "justify-center min-[1100px]:justify-start min-[1100px]:pl-2.5 min-[1100px]:pr-1.5",
  };
}

export function Sidebar({ dados }: { dados: DadosMenu }) {
  const pathname = usePathname();
  const router = useRouter();
  const [recolhido, setRecolhido] = useState(dados.recolhido);
  const [mais, setMais] = useState(false);
  const [conta, setConta] = useState(false);

  const grupos = gruposNav(dados.temRota);
  // O menu acende a tela ou Configuracoes, onde mora o que saiu do menu (ai o
  // aria-current e "true", nao "page"). A barra do celular acende a tela em
  // si: Alertas esta nela.
  const aceso = itemAcesoNoMenu(pathname, grupos);
  const ativo = itemAtivo(pathname);
  const c = classes(recolhido);
  const nomeConta = dados.nome || dados.email;

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
      {/* ------- Desktop: menu lateral sobre o fundo quente, recolhivel ------- */}
      <aside
        aria-label={t("mainMenu")}
        className={clsx(
          "sticky top-0 z-40 hidden h-dvh shrink-0 flex-col gap-1 p-2 transition-[width] duration-150 md:flex",
          c.largura
        )}
      >
        {/* Logo e recolher: so de 1100 px para cima, onde recolher muda algo. */}
        <div
          className={clsx(
            "hidden h-11 shrink-0 items-center gap-2 min-[1100px]:flex",
            recolhido ? "justify-center" : "justify-between pl-2 pr-0.5"
          )}
        >
          {!recolhido && (
            <Link href={APP_HOME} aria-label="xcart, ir para o Dashboard" className="flex h-8 items-center">
              <LogoXcart altura={17} />
            </Link>
          )}
          <button
            type="button"
            onClick={alternar}
            aria-label={recolhido ? t("expandMenu") : t("collapseMenu")}
            aria-expanded={!recolhido}
            className="grid size-ctl-sm shrink-0 place-items-center rounded-control text-t3 hover:bg-nav-active hover:text-ink"
          >
            <PanelLeft className="size-4" strokeWidth={1.75} aria-hidden />
          </button>
        </div>

        <button
          type="button"
          onClick={abrirBusca}
          aria-label="Buscar ou ir para (Ctrl K)"
          className={clsx(
            "flex h-ctl-md shrink-0 items-center gap-2 rounded-control border border-border bg-surface text-left text-t3 hover:border-border-strong hover:text-t1",
            c.busca
          )}
        >
          <Search className="size-3.75 shrink-0" strokeWidth={1.75} aria-hidden />
          <span className={clsx("flex-1 truncate text-dense", c.block)}>Buscar ou ir para…</span>
          <kbd
            className={clsx(
              "shrink-0 rounded-sm border border-border bg-surface-2 px-1.25 font-mono text-label leading-4.5 text-t3",
              c.block
            )}
          >
            Ctrl K
          </kbd>
        </button>

        {/* -mx-1 px-1 py-1: folga para o anel de foco (2px + 2px) nao ser
            cortado pela rolagem do menu aberto. */}
        <nav
          aria-label={t("screens")}
          className={clsx("-mx-1 flex min-h-0 flex-1 flex-col px-1 py-1 [scrollbar-width:none]", c.rolagem)}
        >
          {grupos.map((g) => (
            <div key={g.id} className={clsx("flex flex-col gap-px", g.fim && "mt-auto", c.grupo)}>
              {g.rotulo && <div className={clsx("px-2 pb-1 pt-3.5 text-label font-medium text-t3", c.block)}>{g.rotulo}</div>}
              {g.itens.map((item) => {
                const on = item.id === aceso;
                const temAlerta = item.contador === "alertas" && dados.alertas > 0;
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    aria-current={on ? (item.id === ativo ? "page" : true) : undefined}
                    aria-label={nomeAcessivel(item, dados)}
                    className={clsx(
                      "group relative flex h-8 shrink-0 items-center gap-2.5 rounded-control border px-2 text-dense",
                      c.centro,
                      on
                        ? "border-border bg-surface font-medium text-ink hover:text-ink"
                        : "border-transparent text-t1 hover:bg-nav-active hover:text-ink"
                    )}
                  >
                    <item.icone
                      className={clsx("size-4 shrink-0", on ? "text-ink" : "text-t2 group-hover:text-ink")}
                      strokeWidth={1.75}
                      aria-hidden
                    />
                    <span className={clsx("min-w-0 flex-1 truncate", c.block)}>{item.rotulo}</span>
                    <Contador item={item} dados={dados} className={c.block} />
                    {temAlerta && (
                      <span
                        aria-hidden
                        className={clsx(
                          "absolute right-2.25 top-1.5 size-1.75 rounded-full bg-err ring-2 ring-bg",
                          c.soRecolhido
                        )}
                      />
                    )}
                    <span
                      aria-hidden
                      className={clsx(
                        "pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-control bg-solid px-2 py-1 text-label font-normal text-on-solid",
                        c.dica
                      )}
                    >
                      {item.rotulo}
                    </span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {dados.guia && (
          <Link
            href="/setup"
            className={clsx(
              "mb-1 shrink-0 flex-col gap-2 rounded-card border border-border bg-surface p-3 text-ink hover:border-border-strong hover:text-ink",
              c.flex
            )}
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
            <span className="truncate text-label text-t2">
              {dados.guia.proximo ? `Próximo: ${dados.guia.proximo}` : "Falta conferir o que ficou de fora"}
            </span>
          </Link>
        )}

        <div className="shrink-0 border-t border-border pt-2">
          <Pop
            rotulo="Conta"
            aberto={conta}
            aoMudar={setConta}
            lado="top"
            className="w-62 p-1.5"
            gatilho={
              <button
                type="button"
                aria-label={`Conta de ${nomeConta}`}
                className={clsx(
                  "flex h-11 w-full items-center gap-2.5 rounded-control px-2 text-left hover:bg-nav-active",
                  c.centro
                )}
              >
                <span
                  aria-hidden
                  className="grid size-7 shrink-0 place-items-center rounded-full bg-ink text-label font-semibold text-surface"
                >
                  {iniciais(nomeConta)}
                </span>
                <span className={clsx("min-w-0 flex-1 flex-col", c.flex)}>
                  <span className="truncate text-dense font-medium text-ink">{dados.nome || "—"}</span>
                  <span className="truncate text-label text-t3">{dados.plano ?? dados.email}</span>
                </span>
                <ChevronsUpDown className={clsx("size-3.5 shrink-0 text-t3", c.block)} strokeWidth={1.75} aria-hidden />
              </button>
            }
          >
            <div className="flex flex-col px-2 pb-1.5 pt-2">
              <span className="truncate text-dense font-medium text-ink">{dados.nome || "—"}</span>
              <span className="truncate text-label text-t3">{dados.email}</span>
            </div>
            <div className="flex flex-col gap-1.5 px-2 pb-2.5 pt-1">
              <span className="text-label text-t2">{t("theme")}</span>
              <SeletorTema />
            </div>
            <div className="my-0.5 h-px bg-border" />
            <button
              type="button"
              onClick={() => {
                setConta(false);
                abrirBusca();
              }}
              className="flex h-8 w-full items-center justify-between gap-2 rounded-control px-2 text-dense text-ink hover:bg-hover"
            >
              <span>Buscar e atalhos</span>
              <kbd className="rounded-sm border border-border px-1.25 font-mono text-label text-t3">Ctrl K</kbd>
            </button>
            <button
              type="button"
              onClick={() => sair(router)}
              className="flex h-8 w-full items-center gap-2 rounded-control px-2 text-dense text-err hover:bg-err-bg"
            >
              <LogOut className="size-3.75" strokeWidth={1.75} aria-hidden />
              {t("logout")}
            </button>
          </Pop>
        </div>
      </aside>

      {/* ---------------- Celular: barra de baixo + "Mais" ---------------- */}
      <nav
        aria-label={t("mainMenu")}
        className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-stretch border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
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
                  <span className="sr-only">{alertas === 1 ? " alerta aberto" : " alertas abertos"}</span>
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
            !ativoNaBarra || mais ? "font-semibold text-ink" : "text-t2 hover:text-ink"
          )}
        >
          <Menu className="size-5" strokeWidth={1.75} aria-hidden />
          <span>{t("more")}</span>
        </button>
      </nav>

      <Folha
        aberto={mais}
        aoMudar={setMais}
        titulo={t("menu")}
        subtitulo="Todas as telas, conta e tema"
        rotuloFechar="Fechar menu"
      >
        <div className="flex flex-col gap-3 px-4 pb-4 pt-3">
          {grupos.map((g) => (
            <div key={g.id} className="flex flex-col">
              {g.rotulo && <div className="px-2 py-1 text-label font-medium text-t3">{g.rotulo}</div>}
              {g.itens.map((item) => {
                const on = item.id === aceso;
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    onClick={() => setMais(false)}
                    aria-current={on ? (item.id === ativo ? "page" : true) : undefined}
                    aria-label={nomeAcessivel(item, dados)}
                    className={clsx(
                      "flex min-h-ctl-lg items-center gap-3 rounded-control px-2 text-body text-ink hover:bg-hover hover:text-ink",
                      on && "bg-nav-active font-medium"
                    )}
                  >
                    <item.icone className="size-5 shrink-0 text-t2" strokeWidth={1.75} aria-hidden />
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
                className="grid size-8 shrink-0 place-items-center rounded-full bg-ink text-label font-semibold text-surface"
              >
                {iniciais(nomeConta)}
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
