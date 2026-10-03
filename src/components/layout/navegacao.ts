import {
  Activity,
  Bell,
  Calculator,
  CircleDollarSign,
  CreditCard,
  Download,
  History,
  ListChecks,
  Plug,
  Plus,
  Radio,
  Route,
  Store,
  type LucideIcon,
} from "lucide-react";
import { textos } from "@/lib/textos";
import { hrefAtivo } from "./nav-ativo";
import type { ModoContexto } from "./contexto";

// ============================================================================
// O mapa do app: grupos do menu, titulo de cada tela, contexto da barra do
// topo e atalhos "g + letra". Um lugar so -- o menu lateral, a barra do
// celular, o topo e a busca (Ctrl K) leem daqui.
//
// Tela nova: um item em ITENS (se entra no menu), o titulo em TITULOS e, se
// mostra numero, o modo em CONTEXTOS.
// ============================================================================

const t = textos("nav");

export type IdItem =
  | "lucro"
  | "custos"
  | "saude"
  | "eventos"
  | "alertas"
  | "lojas"
  | "importar"
  | "atividade"
  | "rotas"
  | "integracoes"
  | "assinatura"
  | "guia";

export interface ItemNav {
  id: IdItem;
  href: string;
  rotulo: string;
  icone: LucideIcon;
  /** Letra do atalho "g + letra". */
  atalho?: string;
  /** Outras rotas que acendem este item (telas antigas que vao se juntar a ele). */
  tambem?: string[];
  /** Numero a direita do item. */
  contador?: "lojas" | "creditos" | "alertas";
  /** Item de convite (ex.: "Ativar roteamento"): cor mais apagada. */
  convite?: boolean;
}

export interface GrupoNav {
  id: string;
  /** null = grupo sem cabecalho (Alertas fica sozinho). */
  rotulo: string | null;
  itens: ItemNav[];
}

export const ITENS: Record<IdItem, ItemNav> = {
  lucro: { id: "lucro", href: "/financeiro", rotulo: t("profit"), icone: CircleDollarSign, atalho: "l" },
  custos: { id: "custos", href: "/financeiro/custos", rotulo: t("costs"), icone: Calculator, atalho: "c" },
  saude: { id: "saude", href: "/tracking", rotulo: t("trackingHealth"), icone: Activity, atalho: "s" },
  eventos: { id: "eventos", href: "/tracking/eventos", rotulo: t("liveEvents"), icone: Radio, atalho: "e" },
  alertas: {
    id: "alertas",
    href: "/alertas",
    rotulo: t("alerts"),
    icone: Bell,
    atalho: "a",
    contador: "alertas",
  },
  lojas: { id: "lojas", href: "/stores", rotulo: t("stores"), icone: Store, atalho: "o", contador: "lojas" },
  importar: {
    id: "importar",
    href: "/clone",
    rotulo: t("import"),
    icone: Download,
    atalho: "m",
    // /clone/shopify ja casa por prefixo; /bulk e /multi-site vao virar
    // origens do Importar e, ate la, acendem o mesmo item.
    tambem: ["/bulk", "/multi-site"],
  },
  atividade: { id: "atividade", href: "/activity", rotulo: t("activity"), icone: History, atalho: "t" },
  rotas: {
    id: "rotas",
    href: "/clone/routed-checkout",
    rotulo: t("routes"),
    icone: Route,
    atalho: "r",
    // Visao da rota e Vendas por rota viram abas do detalhe da rota.
    tambem: ["/overview", "/sales"],
  },
  integracoes: {
    id: "integracoes",
    href: "/integracoes",
    rotulo: t("integrations"),
    icone: Plug,
    atalho: "i",
    // Contas de anuncio e Claude (MCP) vao morar em Integracoes.
    tambem: ["/financeiro/anuncios", "/claude"],
  },
  assinatura: {
    id: "assinatura",
    href: "/billing",
    rotulo: t("billing"),
    icone: CreditCard,
    atalho: "b",
    contador: "creditos",
  },
  guia: { id: "guia", href: "/setup", rotulo: t("setupGuide"), icone: ListChecks },
};

/**
 * Os seis grupos, na ordem do trabalho do lojista: dinheiro, rastreamento, o
 * que quebrou, a operacao, a rota (modulo) e a conta.
 *
 * Roteamento e modulo recolhido: quem nao tem rota ve so "Ativar roteamento",
 * sem checklist nem "Sem rota". Leva ao console atual.
 */
export function gruposNav(temRota: boolean): GrupoNav[] {
  const rota: ItemNav = temRota
    ? ITENS.rotas
    : { ...ITENS.rotas, rotulo: t("enableRouting"), icone: Plus, convite: true, atalho: undefined };
  return [
    { id: "lucro", rotulo: t("profit"), itens: [ITENS.lucro, ITENS.custos] },
    { id: "rastreamento", rotulo: t("trackingGroup"), itens: [ITENS.saude, ITENS.eventos] },
    { id: "alertas", rotulo: null, itens: [ITENS.alertas] },
    { id: "operacao", rotulo: t("operation"), itens: [ITENS.lojas, ITENS.importar, ITENS.atividade] },
    { id: "roteamento", rotulo: t("routingGroup"), itens: [rota] },
    {
      id: "configuracoes",
      rotulo: t("settings"),
      itens: [ITENS.integracoes, ITENS.assinatura, ITENS.guia],
    },
  ];
}

const TODOS = Object.values(ITENS);

// Cada caminho (href ou "tambem") aponta para o item dono dele.
const DONO = new Map<string, IdItem>();
for (const item of TODOS) {
  DONO.set(item.href, item.id);
  for (const outro of item.tambem ?? []) DONO.set(outro, item.id);
}
const CAMINHOS = [...DONO.keys()];

/** O item do menu que acende nesta rota: vence o caminho mais longo. */
export function itemAtivo(pathname: string): IdItem | null {
  const caminho = hrefAtivo(pathname, CAMINHOS);
  return caminho ? (DONO.get(caminho) ?? null) : null;
}

/** Barra de baixo no celular: quatro destinos e o "Mais". */
export const BARRA_CELULAR: { item: ItemNav; rotulo: string; acende: IdItem[] }[] = [
  { item: ITENS.lucro, rotulo: t("profit"), acende: ["lucro"] },
  { item: ITENS.saude, rotulo: t("trackingGroup"), acende: ["saude", "eventos"] },
  { item: ITENS.alertas, rotulo: t("alerts"), acende: ["alertas"] },
  { item: ITENS.lojas, rotulo: t("stores"), acende: ["lojas"] },
];

/** "g + letra" -> destino. A letra mora no proprio item. */
export const ATALHOS_G: { tecla: string; item: ItemNav }[] = TODOS.filter(
  (item): item is ItemNav & { atalho: string } => !!item.atalho
).map((item) => ({ tecla: item.atalho!, item }));

// ---------------------------------------------------------------------------
// Titulo de cada tela (o topo do celular mostra; no desktop o PageHeader).
// ---------------------------------------------------------------------------

const TITULOS: Record<string, string> = {
  "/financeiro": t("profit"),
  "/financeiro/custos": t("costs"),
  "/financeiro/anuncios": t("adAccounts"),
  "/tracking": t("trackingHealth"),
  "/tracking/eventos": t("liveEvents"),
  "/alertas": t("alerts"),
  "/stores": t("stores"),
  "/clone": t("import"),
  "/bulk": t("import"),
  "/multi-site": t("import"),
  "/activity": t("activity"),
  "/clone/routed-checkout": t("routing"),
  "/overview": t("routeOverview"),
  "/sales": t("salesByRoute"),
  "/integracoes": t("integrations"),
  "/billing": t("billing"),
  "/setup": t("setupGuide"),
  "/claude": t("claude"),
};
const PREFIXOS_TITULO = Object.keys(TITULOS);

export function tituloDaRota(pathname: string): string {
  const prefixo = hrefAtivo(pathname, PREFIXOS_TITULO);
  return prefixo ? TITULOS[prefixo] : "xcart";
}

// ---------------------------------------------------------------------------
// Contexto da barra do topo, por tela.
//
// So entra aqui a tela que LE o filtro global. Uma tela com filtro proprio
// (Saude dos pixels e Vendas, hoje) que ganhasse o seletor faria o lojista
// achar que trocou de loja e continuar vendo a outra. Quando Saude dos pixels
// passar a ler a loja da barra: "/tracking": { tipo: "fixo", texto: ... }.
// ---------------------------------------------------------------------------

const CONTEXTOS: Record<string, ModoContexto> = {
  "/financeiro": { tipo: "completo" },
  "/financeiro/custos": { tipo: "loja" },
  "/financeiro/anuncios": { tipo: "nenhum" },
  "/tracking/eventos": { tipo: "loja" },
  "/alertas": { tipo: "loja" },
};
const PREFIXOS_CONTEXTO = Object.keys(CONTEXTOS);

export function contextoDaRota(pathname: string): ModoContexto {
  const prefixo = hrefAtivo(pathname, PREFIXOS_CONTEXTO);
  return prefixo ? CONTEXTOS[prefixo] : { tipo: "nenhum" };
}
