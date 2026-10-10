import {
  Activity,
  Bell,
  Bot,
  Calculator,
  CircleDollarSign,
  CreditCard,
  Download,
  History,
  LayoutGrid,
  ListChecks,
  Megaphone,
  Plug,
  Radio,
  Receipt,
  Route,
  Settings,
  Store,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { textos } from "@/lib/textos";
import { hrefAtivo } from "./nav-ativo";
import type { ModoContexto } from "./contexto";

// ============================================================================
// O mapa do app: grupos do menu, o indice de Configuracoes, titulo de cada
// tela, contexto da barra do topo e atalhos "g + letra". Um lugar so -- o
// menu lateral, a barra do celular, o topo, a busca (Ctrl K) e a pagina
// /configuracoes leem daqui.
//
// Tela nova: um item em ITENS (a busca e os atalhos ja a acham), o titulo em
// TITULOS e, se mostra numero, o modo em CONTEXTOS. Fora do menu, ela entra
// no indice de Configuracoes.
// ============================================================================

const t = textos("nav");

export type IdItem =
  | "lucro"
  | "campanhas"
  | "pedidos"
  | "saude"
  | "eventos"
  | "configuracoes"
  | "assinatura"
  | "alertas"
  | "custos"
  | "lojas"
  | "integracoes"
  | "rotas"
  | "visaoRota"
  | "vendasRota"
  | "importar"
  | "atividade"
  | "claude"
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
  /** Outras palavras que acham o item na busca (Ctrl K). */
  busca?: string;
  /** Numero a direita do item. */
  contador?: "creditos" | "alertas";
}

export interface GrupoNav {
  id: string;
  /** null = grupo sem cabecalho. */
  rotulo: string | null;
  itens: ItemNav[];
  /** Vai para o pe do menu lateral (Configuracoes e Assinatura). */
  fim?: boolean;
}

/**
 * Todas as telas, na ordem em que a busca (Ctrl K) e a lista de atalhos as
 * mostram: primeiro as do menu, depois as que moram em Configuracoes.
 */
export const ITENS: Record<IdItem, ItemNav> = {
  lucro: { id: "lucro", href: "/financeiro", rotulo: t("profit"), icone: CircleDollarSign, atalho: "l" },
  campanhas: {
    id: "campanhas",
    href: "/campanhas",
    rotulo: t("campaigns"),
    icone: Megaphone,
    atalho: "k",
    busca: "anúncios campanhas tráfego pago conjuntos criativos cpa roas meta google tiktok",
  },
  pedidos: {
    id: "pedidos",
    href: "/pedidos",
    rotulo: t("orders"),
    icone: Receipt,
    atalho: "p",
    busca: "vendas sku reembolso",
  },
  saude: { id: "saude", href: "/tracking", rotulo: t("trackingHealth"), icone: Activity, atalho: "s" },
  eventos: { id: "eventos", href: "/tracking/eventos", rotulo: t("liveEvents"), icone: Radio, atalho: "e" },
  configuracoes: {
    id: "configuracoes",
    href: "/configuracoes",
    rotulo: t("settings"),
    icone: Settings,
    busca: "módulos contas",
  },
  assinatura: {
    id: "assinatura",
    href: "/billing",
    rotulo: t("billing"),
    icone: CreditCard,
    atalho: "b",
    busca: "plano",
    contador: "creditos",
  },
  // Alertas mora no sino do topo (e na barra do celular), nao no menu lateral.
  alertas: {
    id: "alertas",
    href: "/alertas",
    rotulo: t("alerts"),
    icone: Bell,
    atalho: "a",
    contador: "alertas",
  },
  custos: { id: "custos", href: "/financeiro/custos", rotulo: t("costs"), icone: Calculator, atalho: "c" },
  lojas: { id: "lojas", href: "/stores", rotulo: t("stores"), icone: Store, atalho: "o", busca: "shopify" },
  integracoes: {
    id: "integracoes",
    href: "/integracoes",
    rotulo: t("integrations"),
    icone: Plug,
    atalho: "i",
    busca: "meta google contas de anúncio notificações telegram",
    // As contas de anuncio moram em Integracoes.
    tambem: ["/financeiro/anuncios"],
  },
  rotas: {
    id: "rotas",
    href: "/clone/routed-checkout",
    rotulo: t("routes"),
    icone: Route,
    atalho: "r",
    busca: "roteamento checkout vitrine",
  },
  // Visao da rota e Vendas por rota ficam no grupo Roteamento ate virarem abas
  // do detalhe da rota.
  visaoRota: { id: "visaoRota", href: "/overview", rotulo: t("routeOverview"), icone: LayoutGrid, busca: "roteamento" },
  vendasRota: { id: "vendasRota", href: "/sales", rotulo: t("salesByRoute"), icone: TrendingUp, busca: "roteamento" },
  importar: {
    id: "importar",
    href: "/clone",
    rotulo: t("import"),
    icone: Download,
    atalho: "m",
    // /clone/shopify ja casa por prefixo; /bulk e /multi-site sao origens do
    // Importar com endereco proprio e acendem o mesmo item.
    tambem: ["/bulk", "/multi-site"],
  },
  atividade: { id: "atividade", href: "/activity", rotulo: t("activity"), icone: History, atalho: "t" },
  // O Claude (MCP) mora em Integracoes -> Avancado; /claude redireciona para la.
  claude: {
    id: "claude",
    href: "/integracoes/avancado",
    rotulo: t("claude"),
    icone: Bot,
    busca: "mcp",
    tambem: ["/claude"],
  },
  guia: { id: "guia", href: "/setup", rotulo: t("setupGuide"), icone: ListChecks },
};

/**
 * O menu: Lucro, Rastreamento e Configuracoes -- o que o lojista abre todo
 * dia. Assinatura fica visivel no pe, com o saldo de creditos.
 *
 * Alertas mora no sino. Custos, Lojas, Integracoes e os modulos (Roteamento,
 * Importar, Atividade, Claude e Guia) moram em Configuracoes e na busca.
 * Quem tem rota continua vendo o grupo Roteamento.
 *
 * Campanhas entra aqui quando a tela existir -- nao antes, para o menu nao
 * abrir uma tela "em breve".
 */
export function gruposNav(temRota: boolean): GrupoNav[] {
  // Menu completo: o grupo lucro inclui Dashboard, Campanhas, Pedidos e Custos.
  const grupos: GrupoNav[] = [
    {
      id: "lucro",
      rotulo: t("finance"),
      itens: [ITENS.lucro, ITENS.campanhas, ITENS.pedidos, ITENS.custos],
    },
    {
      id: "rastreamento",
      rotulo: t("trackingGroup"),
      itens: [ITENS.saude, ITENS.eventos, ITENS.alertas],
    },
    {
      id: "operacao",
      rotulo: t("operations"),
      itens: [ITENS.lojas, ITENS.importar, ITENS.atividade],
    },
  ];
  if (temRota) {
    grupos.push({
      id: "roteamento",
      rotulo: t("routingGroup"),
      itens: [ITENS.visaoRota, ITENS.rotas, ITENS.vendasRota],
    });
  }
  grupos.push({
    id: "configuracoes",
    rotulo: t("system"),
    itens: [ITENS.integracoes, ITENS.configuracoes, ITENS.assinatura],
    fim: true,
  });
  return grupos;
}

const TODOS = Object.values(ITENS);

// Cada caminho (href ou "tambem") aponta para o item dono dele.
const DONO = new Map<string, IdItem>();
for (const item of TODOS) {
  DONO.set(item.href, item.id);
  for (const outro of item.tambem ?? []) DONO.set(outro, item.id);
}
const CAMINHOS = [...DONO.keys()];

/** A tela em que se esta, entre todas (menu ou nao): vence o caminho mais longo. */
export function itemAtivo(pathname: string): IdItem | null {
  const caminho = hrefAtivo(pathname, CAMINHOS);
  return caminho ? (DONO.get(caminho) ?? null) : null;
}

/**
 * O item do MENU que acende nesta rota: a propria tela, se esta no menu; senao
 * Configuracoes, onde toda tela fora do menu mora (Contas, Geral ou Modulos).
 * Alertas e a excecao: mora no sino, e nada acende no menu.
 */
export function itemAcesoNoMenu(pathname: string, grupos: GrupoNav[]): IdItem | null {
  const ativo = itemAtivo(pathname);
  if (!ativo) return null;
  if (grupos.some((g) => g.itens.some((i) => i.id === ativo))) return ativo;
  return ativo === "alertas" ? null : "configuracoes";
}

/** Barra de baixo no celular: tres destinos e o "Mais" (o menu inteiro). */
export const BARRA_CELULAR: { item: ItemNav; rotulo: string; acende: IdItem[] }[] = [
  { item: ITENS.lucro, rotulo: t("profit"), acende: ["lucro"] },
  { item: ITENS.saude, rotulo: t("trackingGroup"), acende: ["saude", "eventos"] },
  { item: ITENS.alertas, rotulo: t("alerts"), acende: ["alertas"] },
];

/** "g + letra" -> destino. A letra mora no proprio item. */
export const ATALHOS_G: { tecla: string; item: ItemNav }[] = TODOS.filter(
  (item): item is ItemNav & { atalho: string } => !!item.atalho
).map((item) => ({ tecla: item.atalho!, item }));

// ---------------------------------------------------------------------------
// Indice de /configuracoes: tudo o que saiu do menu, num lugar so.
// ---------------------------------------------------------------------------

export interface LinkConfiguracao {
  rotulo: string;
  href: string;
  dica: string;
}

export const SECOES_CONFIGURACOES: { id: string; titulo: string; links: LinkConfiguracao[] }[] = [
  {
    id: "contas",
    titulo: t("accounts"),
    links: [
      { rotulo: "Meta", href: "/integracoes/meta", dica: "Gasto e envio das compras" },
      { rotulo: "Google", href: "/integracoes/google", dica: "Gasto e envio das compras" },
      { rotulo: "Shopify", href: "/integracoes/shopify", dica: "Acesso de cada loja" },
      { rotulo: ITENS.lojas.rotulo, href: ITENS.lojas.href, dica: "Conectar, ver e remover lojas" },
      { rotulo: "Checkouts", href: "/integracoes/checkouts", dica: "Sphere e outros checkouts externos" },
    ],
  },
  {
    id: "geral",
    titulo: t("general"),
    links: [
      { rotulo: ITENS.custos.rotulo, href: ITENS.custos.href, dica: "Custo do produto e taxa de pagamento" },
      { rotulo: t("notifications"), href: "/integracoes/notificacoes", dica: "Onde os alertas chegam" },
      { rotulo: ITENS.assinatura.rotulo, href: ITENS.assinatura.href, dica: "Plano e créditos de IA" },
    ],
  },
  {
    id: "modulos",
    titulo: t("modules"),
    links: [
      { rotulo: t("routing"), href: ITENS.rotas.href, dica: "Da vitrine à loja de checkout, pelo SKU" },
      { rotulo: ITENS.importar.rotulo, href: ITENS.importar.href, dica: "Produtos de outras lojas para as suas" },
      { rotulo: ITENS.atividade.rotulo, href: ITENS.atividade.href, dica: "O que aconteceu na conta" },
      { rotulo: ITENS.claude.rotulo, href: ITENS.claude.href, dica: "Usar o xcart pelo Claude" },
      { rotulo: ITENS.guia.rotulo, href: ITENS.guia.href, dica: "Os passos para deixar a operação no ar" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Titulo de cada tela (o topo do celular mostra; no desktop o PageHeader).
// ---------------------------------------------------------------------------

const TITULOS: Record<string, string> = {
  "/financeiro": t("profit"),
  "/campanhas": t("campaigns"),
  "/financeiro/custos": t("costs"),
  "/financeiro/anuncios": t("adAccounts"),
  "/pedidos": t("orders"),
  "/tracking": t("trackingHealth"),
  "/tracking/eventos": t("liveEvents"),
  "/alertas": t("alerts"),
  "/stores": t("stores"),
  "/clone": t("import"),
  "/clone/shopify": `${t("import")} da Shopify`,
  "/bulk": t("import"),
  "/multi-site": t("import"),
  "/activity": t("activity"),
  // O mesmo nome do item do menu e do PageHeader do console.
  "/clone/routed-checkout": t("routes"),
  "/overview": t("routeOverview"),
  "/sales": t("salesByRoute"),
  "/integracoes": t("integrations"),
  "/billing": t("billing"),
  "/setup": t("setupGuide"),
  "/claude": t("claude"),
  "/configuracoes": t("settings"),
};
const PREFIXOS_TITULO = Object.keys(TITULOS);

export function tituloDaRota(pathname: string): string {
  const prefixo = hrefAtivo(pathname, PREFIXOS_TITULO);
  return prefixo ? TITULOS[prefixo] : "xcart";
}

// ---------------------------------------------------------------------------
// Contexto da barra do topo, por tela.
//
// So entra aqui a tela que LE o filtro global: "loja" e "fixo" mostram o
// seletor de loja, e uma tela que o ignorasse faria o lojista achar que
// trocou de loja e continuar vendo a outra. Saude dos pixels le a loja da
// barra; a janela de 7 dias mora em src/lib/tracking e por isso e fixa.
// Vendas le a loja da barra; o periodo (7, 30 ou 60 dias) continua na tela.
// ---------------------------------------------------------------------------

const CONTEXTOS: Record<string, ModoContexto> = {
  "/financeiro": { tipo: "completo" },
  "/financeiro/custos": { tipo: "loja" },
  "/financeiro/anuncios": { tipo: "nenhum" },
  // Loja, periodo e moeda da barra, como o Dashboard. Sem "Comparar com": a
  // lista nao compara periodos.
  "/pedidos": { tipo: "completo", semComparar: true },
  "/tracking": { tipo: "fixo", texto: "Últimos 7 dias · período fixo desta tela" },
  "/tracking/eventos": { tipo: "loja" },
  "/alertas": { tipo: "loja" },
  "/activity": { tipo: "loja" },
  "/sales": { tipo: "loja" },
  // Gasto de hoje e do periodo por conta: loja, periodo e moeda da barra.
  "/integracoes/meta": { tipo: "completo" },
  "/integracoes/google": { tipo: "completo" },
};
const PREFIXOS_CONTEXTO = Object.keys(CONTEXTOS);

export function contextoDaRota(pathname: string): ModoContexto {
  const prefixo = hrefAtivo(pathname, PREFIXOS_CONTEXTO);
  return prefixo ? CONTEXTOS[prefixo] : { tipo: "nenhum" };
}
