import { FALSOS_PARA_RESOLVER, RENOTIFICAR_CRITICO_MS } from "@/lib/alertas/regras";
import {
  somarDias,
  diaNoFuso,
  type AlertaRow,
  type LojaDoSeletor,
  type RegraAlerta,
  type SeveridadeAlerta,
} from "@/lib/financeiro/tipos";

// ============================================================================
// Tela de Alertas: tudo que e texto, ordem e destino, sem React e sem banco.
// Roda no servidor e no navegador; travado por tests/alertas-tela.test.ts.
//
// As regras (o que abre e fecha um alerta) moram em src/lib/alertas/ e NAO
// mudam aqui: este arquivo so explica em palavras de lojista o que elas ja
// fazem, com os mesmos limites.
// ============================================================================

/**
 * De quanto em quanto tempo o cron confere. Vem do vercel.json
 * ("/api/jobs/alertas", "*\/10 * * * *"); o teste compara os dois.
 */
export const INTERVALO_VERIFICACAO_MIN = 10;

const MIN = 60_000;
const HORA = 60 * MIN;

// ---------------------------------------------------------------------------
// Abas
// ---------------------------------------------------------------------------

/**
 * A tela mostra so "abertos" e "resolvidos" (Historico). "regras" e "canal"
 * continuam sendo reconhecidas para o link antigo (?aba=canal) ir para
 * Notificacoes, onde as regras e o Telegram estao agora.
 */
export const ABAS = ["abertos", "resolvidos", "regras", "canal"] as const;
export type Aba = (typeof ABAS)[number];

/** Onde as regras e o Telegram se configuram. */
export const TELA_NOTIFICACOES = "/integracoes/notificacoes";

/** ?aba= da URL; lixo cai em "abertos". */
export function abaDe(valor: unknown): Aba {
  const v = Array.isArray(valor) ? valor[0] : valor;
  return (ABAS as readonly string[]).includes(String(v)) ? (v as Aba) : "abertos";
}

// ---------------------------------------------------------------------------
// Tempo
// ---------------------------------------------------------------------------

/** "menos de 1 min", "42 min", "2 h 22 min", "2 h", "3 d 4 h". Negativo vira 0. */
export function duracaoTexto(ms: number): string {
  const total = Math.max(0, Math.floor(ms / MIN));
  if (total < 1) return "menos de 1 min";
  if (total < 60) return `${total} min`;
  if (total < 24 * 60) {
    const h = Math.floor(total / 60);
    const m = total % 60;
    return m ? `${h} h ${String(m).padStart(2, "0")} min` : `${h} h`;
  }
  const d = Math.floor(total / (24 * 60));
  const h = Math.floor((total % (24 * 60)) / 60);
  return h ? `${d} d ${h} h` : `${d} d`;
}

function partes(instante: number, fuso: string) {
  const opcoes: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  };
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("pt-BR", { ...opcoes, timeZone: fuso });
  } catch {
    fmt = new Intl.DateTimeFormat("pt-BR", { ...opcoes, timeZone: "UTC" });
  }
  const p = fmt.formatToParts(instante);
  const v = (tipo: string) => p.find((x) => x.type === tipo)?.value ?? "";
  return { dia: v("day"), mes: v("month"), hora: v("hour"), minuto: v("minute") };
}

/** "14:30" no fuso. */
export function horaCurta(iso: string, fuso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const p = partes(t, fuso);
  return `${p.hora}:${p.minuto}`;
}

/** "01/10, 20:15" no fuso. Montado por partes: o ICU muda a pontuacao. */
export function dataHoraCurta(iso: string | null, fuso: string): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "—";
  const p = partes(t, fuso);
  return `${p.dia}/${p.mes}, ${p.hora}:${p.minuto}`;
}

/** Ate quando dura o silencio: "hoje, 18:00", "amanhã, 14:31" ou "05/10, 14:31". */
export function ateQuando(iso: string, agora: number, fuso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const hoje = diaNoFuso(new Date(agora), fuso);
  const dia = diaNoFuso(new Date(t), fuso);
  const p = partes(t, fuso);
  const hora = `${p.hora}:${p.minuto}`;
  if (dia === hoje) return `hoje, ${hora}`;
  if (dia === somarDias(hoje, 1)) return `amanhã, ${hora}`;
  return `${p.dia}/${p.mes}, ${hora}`;
}

// ---------------------------------------------------------------------------
// Abertos
// ---------------------------------------------------------------------------

export function estaSilenciado(silenciadoAte: string | null | undefined, agora: number): boolean {
  if (!silenciadoAte) return false;
  const t = Date.parse(silenciadoAte);
  return Number.isFinite(t) && t > agora;
}

type Ordenavel = Pick<AlertaRow, "id" | "severidade" | "aberto_em">;

/** Critico antes de aviso; dentro de cada um, o mais novo primeiro. */
export function ordenarAbertos<T extends Ordenavel>(lista: T[]): T[] {
  const peso = (s: SeveridadeAlerta) => (s === "critico" ? 0 : 1);
  return [...lista].sort((a, b) => {
    const s = peso(a.severidade) - peso(b.severidade);
    if (s !== 0) return s;
    const t = (Date.parse(b.aberto_em) || 0) - (Date.parse(a.aberto_em) || 0);
    if (t !== 0) return t;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Silenciar so cala o Telegram: o alerta continua aberto. Na tela, o
 * silenciado sai da lista principal e vai para "Silenciados".
 * `silencio` e o que o lojista acabou de fazer nesta tela (vence o servidor).
 */
export function separarAbertos<T extends Ordenavel & Pick<AlertaRow, "silenciado_ate">>(
  lista: T[],
  silencio: Record<string, string | null>,
  agora: number
): { ativos: T[]; silenciados: (T & { ate: string })[] } {
  const ativos: T[] = [];
  const silenciados: (T & { ate: string })[] = [];
  for (const a of ordenarAbertos(lista)) {
    const ate = a.id in silencio ? silencio[a.id] : a.silenciado_ate;
    if (ate && estaSilenciado(ate, agora)) silenciados.push({ ...a, ate });
    else ativos.push(a);
  }
  return { ativos, silenciados };
}

/** "avisado 3 vezes no Telegram". */
export function textoAvisos(n: number | null | undefined): string {
  const v = Number(n) || 0;
  if (v <= 0) return "ainda sem aviso no Telegram";
  return v === 1 ? "avisado 1 vez no Telegram" : `avisado ${v} vezes no Telegram`;
}

/** O confirmado mais recente entre os abertos: uma verificacao que de fato rodou. */
export function ultimaConfirmacao(lista: Pick<AlertaRow, "confirmado_em">[]): string | null {
  let melhor: string | null = null;
  let t = -Infinity;
  for (const a of lista) {
    const v = Date.parse(a.confirmado_em);
    if (Number.isFinite(v) && v > t) {
      t = v;
      melhor = a.confirmado_em;
    }
  }
  return melhor;
}

// ---------------------------------------------------------------------------
// Lojas
// ---------------------------------------------------------------------------

/**
 * Nome com o dominio (o nome gravado pode ser velho; o dominio myshopify nao
 * muda). store_id nulo = alerta da conta inteira.
 */
export function nomeDaLoja(
  storeId: string | null,
  lojas: LojaDoSeletor[],
  lojasIndisponiveis = false
): string {
  if (!storeId) return "Todas as lojas";
  const l = lojas.find((x) => x.id === storeId);
  if (!l) return lojasIndisponiveis ? "Loja" : "Loja removida";
  const dominio = l.dominio.replace(/\.myshopify\.com$/i, "");
  if (!l.nome || l.nome === l.dominio) return dominio || "Loja";
  return dominio ? `${l.nome} · ${dominio}` : l.nome;
}

// ---------------------------------------------------------------------------
// Resolver: para onde cada regra leva
// ---------------------------------------------------------------------------

export interface Destino {
  href: string;
  /** Nome da tela, para o leitor de tela: "Resolver em Lojas". */
  tela: string;
}

const DESTINOS: Record<RegraAlerta, Destino> = {
  // Reinstalar o app ou desligar o rastreamento da loja.
  app_desinstalado: { href: "/stores", tela: "Lojas" },
  // O token do CAPI se cola no destino Meta do rastreamento.
  meta_capi_token: { href: "/tracking", tela: "Rastreamento" },
  // A compra que falhou aparece com o erro no feed.
  envio_falhando: { href: "/tracking/eventos", tela: "Eventos ao vivo" },
  fila_travada: { href: "/tracking/eventos", tela: "Eventos ao vivo" },
  // Erro de leitura de pedido e quase sempre permissao/token da loja.
  pedidos_sync_erro: { href: "/stores", tela: "Lojas" },
  ads_sync_atrasado: { href: "/integracoes/meta", tela: "Integrações · Meta" },
  gastou_sem_vender: { href: "/financeiro", tela: "Dashboard" },
  // O detalhe da loja no Rastreamento mostra o tema e o ultimo evento.
  rastreamento_parado: { href: "/tracking", tela: "Rastreamento" },
  // Roteamento: a chave do alerta e o id da rota (destinoDoAlerta abre ela).
  roteamento_script_sumiu: { href: "/clone/routed-checkout", tela: "Rotas" },
  roteamento_escape_vitrine: { href: "/clone/routed-checkout", tela: "Rotas" },
  roteamento_conserto_falhando: { href: "/clone/routed-checkout", tela: "Rotas" },
};

/** Para qual aba da rota cada alerta de roteamento leva. */
const ABA_DO_ROTEAMENTO: Partial<Record<RegraAlerta, string>> = {
  roteamento_script_sumiu: "instalacao",
  roteamento_escape_vitrine: "diagnostico",
  roteamento_conserto_falhando: "diagnostico",
};

/**
 * `titulo` separa Meta de Google no ads_sync_atrasado: o cron grava
 * "Gasto do Google sem atualizar: ..." (avaliar.ts), e a conta do Google so
 * aparece em Integracoes -> Google.
 *
 * `lojaId` (so loja do usuario) abre o rastreamento parado ja no detalhe dela.
 * `chave` (o id da rota nos alertas de roteamento) abre a rota na aba certa.
 */
export function destinoDoAlerta(
  regra: RegraAlerta,
  titulo?: string | null,
  lojaId?: string | null,
  chave?: string | null
): Destino {
  const aba = ABA_DO_ROTEAMENTO[regra];
  if (aba && chave) {
    return {
      href: `/clone/routed-checkout?rota=${encodeURIComponent(chave)}&aba=${aba}`,
      tela: "Rotas",
    };
  }
  if (regra === "ads_sync_atrasado" && titulo?.startsWith("Gasto do Google")) {
    return { href: "/integracoes/google", tela: "Integrações · Google" };
  }
  if (regra === "rastreamento_parado" && lojaId) {
    return { href: `/tracking?loja=${encodeURIComponent(lojaId)}`, tela: "Rastreamento" };
  }
  return DESTINOS[regra] ?? { href: "/tracking", tela: "Rastreamento" };
}

// ---------------------------------------------------------------------------
// Regras em palavras de lojista (os limites sao os de avaliar.ts)
// ---------------------------------------------------------------------------

export interface RegraNaTela {
  regra: RegraAlerta;
  titulo: string;
  explicacao: string;
  severidade: SeveridadeAlerta;
  /** Quando dispara. Para "gastou sem vender" depende do limite gravado. */
  quando: string;
}

/** 30 -> "30,00". */
export function formatarLimite(valor: number): string {
  return (Number(valor) || 0).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Numero digitado em pt-BR: "30,5" e "1.234,56" (virgula decimal), "30.5"
 * e "1.000" (ponto de milhar quando vem em grupos de 3). Vazio ou lixo: null.
 */
export function lerNumero(texto: string): number | null {
  const limpo = texto.trim().replace(/\s/g, "");
  if (!limpo) return null;
  let normal = limpo;
  if (limpo.includes(",")) normal = limpo.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(limpo)) normal = limpo.replace(/\./g, "");
  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
}

export function regrasNaTela(gastoMinimo: number): RegraNaTela[] {
  return [
    {
      regra: "app_desinstalado",
      titulo: "App desinstalado com rastreamento ligado",
      explicacao: "A loja tirou o app, mas o rastreamento continua ligado: as compras param de chegar.",
      severidade: "critico",
      quando: "Na verificação seguinte",
    },
    {
      regra: "meta_capi_token",
      titulo: "Token do Meta recusado",
      explicacao: "O Meta recusou as compras porque o token de conversões venceu ou foi revogado.",
      severidade: "critico",
      quando: "Na primeira recusa da última hora",
    },
    {
      regra: "envio_falhando",
      titulo: "Compra que não chegou",
      explicacao: "Uma compra paga falhou de vez no envio para o Meta ou o Google.",
      severidade: "critico",
      quando: "Na primeira falha da última hora",
    },
    {
      regra: "fila_travada",
      titulo: "Fila de envio parada",
      explicacao: "Compras e eventos esperando para sair, sem andar.",
      severidade: "critico",
      quando: "Depois de 30 min parada",
    },
    {
      regra: "rastreamento_parado",
      titulo: "Rastreamento sem eventos",
      explicacao: "A loja mandava visitas, carrinhos e checkouts e parou: o código pode ter saído do tema.",
      severidade: "aviso",
      quando: "Depois de 24 h sem evento",
    },
    {
      regra: "roteamento_script_sumiu",
      titulo: "Script do roteamento sumiu",
      explicacao:
        "A vitrine dava sinal do script e parou: sem ele o comprador cai no checkout da vitrine, que não cobra.",
      severidade: "critico",
      quando: "Depois de 6 h sem sinal, se havia sinal nas 72 h",
    },
    {
      regra: "roteamento_escape_vitrine",
      titulo: "Carrinhos caindo no checkout da vitrine",
      explicacao: "A Shopify avisou checkouts abertos na própria vitrine, que não cobra.",
      severidade: "critico",
      quando: "A partir de 3 em 24 h",
    },
    {
      regra: "roteamento_conserto_falhando",
      titulo: "Conserto da rota falhando",
      explicacao: "A checagem automática da rota falhou seguidas vezes, ou perdeu o acesso a uma das lojas.",
      severidade: "critico",
      quando: "Na 3ª falha seguida, ou na hora sem acesso",
    },
    {
      regra: "pedidos_sync_erro",
      titulo: "Pedidos da Shopify sem atualizar",
      explicacao: "A leitura de pedidos deu erro ou parou: o lucro da loja fica atrasado.",
      severidade: "aviso",
      quando: "Com erro, ou depois de 2 h",
    },
    {
      regra: "ads_sync_atrasado",
      titulo: "Gasto de anúncio sem atualizar",
      explicacao: "O gasto do Meta ou do Google parou de chegar, ou a conta deu erro.",
      severidade: "critico",
      quando: "Meta depois de 90 min · Google depois de 3 h",
    },
    {
      regra: "gastou_sem_vender",
      titulo: "Gastou sem vender hoje",
      explicacao:
        "O gasto do dia passou do limite e a loja não tem nenhuma venda paga. Só confere com gasto e pedidos lidos nos últimos 45 min.",
      severidade: "critico",
      quando: `A partir de ${formatarLimite(gastoMinimo)} na moeda da conta`,
    },
  ];
}

/** Rodape das regras: reenvio e fechamento, com os numeros de regras.ts. */
export function textoCicloDeVida(): string {
  const horas = Math.round(RENOTIFICAR_CRITICO_MS / HORA);
  const vezes = FALSOS_PARA_RESOLVER === 2 ? "duas" : String(FALSOS_PARA_RESOLVER);
  return (
    `Crítico avisa de novo a cada ${horas} horas enquanto continuar aberto; aviso, só quando abre. ` +
    `Um alerta fecha sozinho depois de ${vezes} verificações seguidas sem o problema.`
  );
}

/** Quanto o fechamento pode atrasar em relacao ao fim real do problema. */
export function folgaDoFechamentoMin(): number {
  return FALSOS_PARA_RESOLVER * INTERVALO_VERIFICACAO_MIN;
}

// ---------------------------------------------------------------------------
// Resolvidos
// ---------------------------------------------------------------------------

/** Do aberto ao resolvido; null quando falta uma das pontas. */
export function duracaoMs(abertoEm: string, resolvidoEm: string | null): number | null {
  const a = Date.parse(abertoEm);
  const r = resolvidoEm ? Date.parse(resolvidoEm) : NaN;
  if (!Number.isFinite(a) || !Number.isFinite(r)) return null;
  return Math.max(0, r - a);
}

// ---------------------------------------------------------------------------
// Erros em palavras humanas (a mensagem crua vai para "Detalhes")
// ---------------------------------------------------------------------------

/** Falha ao silenciar ou voltar a avisar. */
export function erroDeSilenciar(status: number, erro?: string | null): string {
  if (status === 401) return "Sua sessão expirou. Entre de novo para silenciar.";
  if (status === 404) return "Este alerta não existe mais. Atualize a tela.";
  if (status === 0) return "Sem conexão. Confira a internet e tente de novo.";
  if (status === 400 && erro) return erro;
  return "Não deu para salvar agora. Tente de novo em instantes.";
}

/** Falha ao salvar ou testar o Telegram. */
export function erroDoTelegram(status: number, erro?: string | null): string {
  if (status === 401) return "Sua sessão expirou. Entre de novo para salvar.";
  if (status === 0) return "Sem conexão. Confira a internet e tente de novo.";
  if (status >= 500) return "Não deu para salvar agora. Tente de novo em instantes.";
  const e = String(erro || "");
  const baixo = e.toLowerCase();
  if (baixo.includes("chat not found")) {
    return "O Telegram não achou esse chat. Mande /start para o seu bot e confira o chat id.";
  }
  if (baixo.includes("unauthorized")) {
    return "O Telegram recusou o token do bot. Copie de novo o token que o @BotFather mandou.";
  }
  if (baixo.includes("blocked by the user") || baixo.includes("can't initiate")) {
    return "O bot não pode falar com você ainda. Abra a conversa com o bot e mande /start.";
  }
  if (baixo.includes("too many requests")) {
    return "O Telegram pediu para esperar um pouco. Tente de novo em 1 minuto.";
  }
  if (baixo.includes("falar com o telegram")) {
    return "O Telegram não respondeu. Tente de novo em instantes.";
  }
  return e || "Não deu para salvar agora. Tente de novo em instantes.";
}
