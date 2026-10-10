import { PLATAFORMAS_CHECKOUT } from "@/lib/checkouts-externos/tipos";
import { textos } from "@/lib/textos";

// ============================================================================
// "Conectar operação": a porta unica para por uma operacao no xcart. A tela
// /conectar pergunta O QUE conectar e manda para o fluxo que ja existe, aberto
// no passo certo: o assistente da loja Shopify (/stores?conectar=1) e o
// cadastro do checkout externo (Integracoes > Checkouts, ?novo=<plataforma>).
// Nenhum formulario mora aqui.
//
// Opcao nova (outro tipo de operacao, outra plataforma de checkout) e uma
// linha a mais nesta lista; a plataforma de checkout que ficar ativa em
// PLATAFORMAS_CHECKOUT ganha o botao sozinha. Puro: a tela, os CTAs do app e
// o vitest leem daqui.
// ============================================================================

export const ROTA_CONECTAR_OPERACAO = "/conectar";
export const ROTULO_CONECTAR_OPERACAO = textos("nav")("connectOperation");

/**
 * Quem sai de /conectar leva `de=conectar` na URL, e o "Voltar" do primeiro
 * passo do fluxo devolve a escolha. O destino e fixo: nunca um endereco que
 * veio da URL.
 */
export const PARAM_DE = "de";
const DE_CONECTAR = "conectar";

export function voltarParaEscolha(de: string | string[] | null | undefined): string | null {
  return de === DE_CONECTAR ? ROTA_CONECTAR_OPERACAO : null;
}

export interface DestinoConectar {
  id: string;
  nome: string;
  /** Uma linha curta. Vazia nas "Em breve". */
  descricao: string;
  /** null = em breve: aparece apagado, sem link nem foco. */
  href: string | null;
  cta: string;
}

export interface OpcaoConectar {
  id: "loja" | "checkout";
  titulo: string;
  texto: string;
  /** O que a operacao traz, em itens curtos. */
  traz: string[];
  nota?: string;
  /** O selo "2 conectadas" / "1 conectado". */
  contagem: { um: string; varios: string };
  destinos: DestinoConectar[];
}

const DE = `${PARAM_DE}=${DE_CONECTAR}`;

export const OPCOES_CONECTAR: OpcaoConectar[] = [
  {
    id: "loja",
    titulo: "Loja Shopify",
    texto: "Pedidos, custos e lucro de cada venda, mais o rastreamento das compras.",
    traz: ["Pedidos dos últimos 60 dias", "Rastreamento no Meta, Google e TikTok", "Lucro por produto e por campanha"],
    nota: "A vitrine e a loja de checkout do roteamento também são lojas Shopify.",
    contagem: { um: "conectada", varios: "conectadas" },
    destinos: [
      {
        id: "shopify",
        nome: "Shopify",
        descricao: "Leva uns 5 minutos.",
        href: `/stores?conectar=1&${DE}`,
        cta: "Conectar loja",
      },
    ],
  },
  {
    id: "checkout",
    titulo: "Checkout externo",
    texto: "Pedido que acontece fora da Shopify e paga comissão.",
    traz: ["Comissão em Recebido e A receber", "Cada pedido com a situação dele", "Gasto do Meta e do Google no lucro"],
    contagem: { um: "conectado", varios: "conectados" },
    destinos: PLATAFORMAS_CHECKOUT.map((p) => ({
      id: p.id,
      nome: p.nome,
      descricao: p.ativa ? p.descricao : "",
      href: p.ativa ? `/integracoes/checkouts?novo=${p.id}&${DE}` : null,
      cta: "Conectar",
    })),
  },
];

/** "1 conectada", "3 conectados". Zero ou leitura que falhou: sem selo. */
export function rotuloContagem(n: number | null, contagem: OpcaoConectar["contagem"]): string | null {
  if (n === null || !Number.isFinite(n) || n <= 0) return null;
  return `${n} ${n === 1 ? contagem.um : contagem.varios}`;
}
