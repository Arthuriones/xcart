import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { filtroResolvido } from "@/lib/filtro-global";
import {
  TODAS,
  type AlertaConfigRow,
  type AlertaRow,
  type LojaDoSeletor,
} from "@/lib/financeiro/tipos";

// ============================================================================
// Leitura da tela /alertas (redesign). So leitura: alertas e config pela
// sessao (RLS); o token do bot so como booleano, lido com service role e
// filtrado pelo usuario da sessao (alerta_config_secrets nao tem policy).
//
// Diferente de src/lib/alertas/queries.ts, cada leitura devolve o PROPRIO
// erro: sem os abertos a tela mostra o estado de erro; sem os resolvidos, a
// config ou os nomes das lojas, o resto continua funcionando com um aviso.
// E a config lida com erro nunca vira "padrao": o formulario do Telegram
// fica travado, senao Salvar gravaria o padrao por cima do que existe.
// ============================================================================

export type ConfigAlertas = Omit<AlertaConfigRow, "updated_at" | "user_id">;

export interface LeituraAlertas {
  lojas: LojaDoSeletor[];
  /** Loja escolhida na barra do topo, ou TODAS. */
  lojaId: string;
  abertos: AlertaRow[];
  resolvidos: AlertaRow[];
  config: ConfigAlertas;
  /** Existe token do bot (do usuario ou da instalacao)? O token nunca sai daqui. */
  temToken: boolean;
  /** O token vem da instalacao, nao do usuario. */
  tokenDaEnv: boolean;
  /** Instante da leitura (ms): base do "aberto ha" sem divergir na hidratacao. */
  agora: number;
  erros: {
    abertos: string | null;
    resolvidos: string | null;
    config: string | null;
    token: string | null;
    lojas: string | null;
  };
}

/** Teto da lista de resolvidos (a tela avisa quando bate). */
export const LIMITE_RESOLVIDOS = 50;

const CONFIG_PADRAO: ConfigAlertas = {
  telegram_chat_id: null,
  ativo: true,
  receber_avisos: true,
  gasto_sem_venda_min: 30,
};

function mensagem(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function lerAlertas(): Promise<LeituraAlertas> {
  const agora = Date.now();
  const user = await getCurrentUser();

  let lojas: LojaDoSeletor[] = [];
  let lojaId = TODAS;
  let erroLojas: string | null = null;
  try {
    const r = await filtroResolvido();
    lojas = r.lojas;
    lojaId = r.filtro.lojaId;
  } catch (e) {
    // Sem a lista de lojas os alertas ainda aparecem (todas as lojas).
    erroLojas = mensagem(e);
  }

  const leitura: LeituraAlertas = {
    lojas,
    lojaId,
    abertos: [],
    resolvidos: [],
    config: CONFIG_PADRAO,
    temToken: false,
    tokenDaEnv: false,
    agora,
    erros: { abertos: null, resolvidos: null, config: null, token: null, lojas: erroLojas },
  };
  if (!user) return leitura;

  const supabase = await createClient();
  const seteDias = new Date(agora - 7 * 86400000).toISOString();
  // Uma loja escolhida: os alertas dela e os da conta inteira (store_id nulo).
  // lojaId ja foi conferido contra as lojas do usuario (uuid), entao entra no
  // `or` sem risco de injecao.
  const umaLoja = lojaId !== TODAS ? lojaId : null;

  let qAbertos = supabase
    .from("alertas")
    .select("*")
    .eq("user_id", user.id)
    .is("resolvido_em", null)
    .order("aberto_em", { ascending: false })
    .limit(200);
  let qResolvidos = supabase
    .from("alertas")
    .select("*")
    .eq("user_id", user.id)
    .not("resolvido_em", "is", null)
    .gte("resolvido_em", seteDias)
    .order("resolvido_em", { ascending: false })
    .limit(LIMITE_RESOLVIDOS);
  if (umaLoja) {
    qAbertos = qAbertos.or(`store_id.is.null,store_id.eq.${umaLoja}`);
    qResolvidos = qResolvidos.or(`store_id.is.null,store_id.eq.${umaLoja}`);
  }

  const lerToken = async (): Promise<{ proprio: boolean; erro: string | null }> => {
    try {
      const { data, error } = await createAdminClient()
        .from("alerta_config_secrets")
        .select("telegram_bot_token")
        .eq("user_id", user.id)
        .maybeSingle();
      const proprio = !!String(
        (data as { telegram_bot_token?: string | null } | null)?.telegram_bot_token || ""
      ).trim();
      return { proprio, erro: error ? error.message : null };
    } catch (e) {
      return { proprio: false, erro: mensagem(e) };
    }
  };

  const [abertos, resolvidos, config, token] = await Promise.all([
    qAbertos,
    qResolvidos,
    supabase
      .from("alerta_config")
      .select("telegram_chat_id, ativo, receber_avisos, gasto_sem_venda_min")
      .eq("user_id", user.id)
      .maybeSingle(),
    lerToken(),
  ]);

  if (abertos.error) leitura.erros.abertos = abertos.error.message;
  else leitura.abertos = (abertos.data || []) as AlertaRow[];

  if (resolvidos.error) leitura.erros.resolvidos = resolvidos.error.message;
  else leitura.resolvidos = (resolvidos.data || []) as AlertaRow[];

  if (config.error) {
    leitura.erros.config = config.error.message;
  } else if (config.data) {
    const c = config.data as ConfigAlertas;
    leitura.config = {
      telegram_chat_id: c.telegram_chat_id,
      ativo: c.ativo,
      receber_avisos: c.receber_avisos,
      gasto_sem_venda_min: Number(c.gasto_sem_venda_min) || 0,
    };
  }

  leitura.erros.token = token.erro;
  const tokenDaEnv = !token.proprio && !!String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
  leitura.temToken = token.proprio || tokenDaEnv;
  leitura.tokenDaEnv = tokenDaEnv;

  return leitura;
}
