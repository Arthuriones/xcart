import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { filtroResolvido } from "@/lib/filtro-global";
import {
  TODAS,
  type AlertaConfigRow,
  type AlertaRow,
  type FiltroGlobal,
  type LojaDoSeletor,
} from "@/lib/financeiro/tipos";

// ============================================================================
// Leitura da tela /alertas. Alertas e config pela sessao (RLS); o token do bot
// so como booleano, lido com service role (a tabela nao tem policy).
// ============================================================================

export interface AlertasDaTela {
  filtro: FiltroGlobal;
  lojas: LojaDoSeletor[];
  abertos: AlertaRow[];
  resolvidos: AlertaRow[];
  config: Omit<AlertaConfigRow, "updated_at">;
  /** Existe token do bot (do usuario ou da env)? O token em si nunca sai daqui. */
  temToken: boolean;
  /** O token vem da env da instalacao, nao do usuario. */
  tokenDaEnv: boolean;
  erro: string | null;
}

export async function getAlertas(): Promise<AlertasDaTela> {
  const { filtro, lojas } = await filtroResolvido();
  const user = await getCurrentUser();
  const configPadrao = {
    user_id: user?.id ?? "",
    telegram_chat_id: null,
    ativo: true,
    receber_avisos: true,
    gasto_sem_venda_min: 30,
  };
  const vazio: AlertasDaTela = {
    filtro,
    lojas,
    abertos: [],
    resolvidos: [],
    config: configPadrao,
    temToken: false,
    tokenDaEnv: false,
    erro: null,
  };
  if (!user) return vazio;

  const supabase = await createClient();
  const seteDias = new Date(Date.now() - 7 * 86400000).toISOString();
  // Uma loja escolhida: os dela e os da conta inteira (store_id nulo).
  // lojaId ja foi conferido contra as lojas do usuario (uuid), entao entra no
  // filtro sem risco de injecao no `or`.
  const umaLoja = filtro.lojaId !== TODAS ? filtro.lojaId : null;

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
    .limit(50);
  if (umaLoja) {
    qAbertos = qAbertos.or(`store_id.is.null,store_id.eq.${umaLoja}`);
    qResolvidos = qResolvidos.or(`store_id.is.null,store_id.eq.${umaLoja}`);
  }

  const [abertos, resolvidos, config] = await Promise.all([
    qAbertos,
    qResolvidos,
    supabase
      .from("alerta_config")
      .select("user_id, telegram_chat_id, ativo, receber_avisos, gasto_sem_venda_min")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  let temTokenProprio = false;
  let erroToken: string | null = null;
  try {
    const { data, error } = await createAdminClient()
      .from("alerta_config_secrets")
      .select("telegram_bot_token")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) erroToken = error.message;
    temTokenProprio = !!String(
      (data as { telegram_bot_token?: string | null } | null)?.telegram_bot_token || ""
    ).trim();
  } catch (e) {
    erroToken = e instanceof Error ? e.message : String(e);
  }
  const tokenDaEnv = !temTokenProprio && !!String(process.env.TELEGRAM_BOT_TOKEN || "").trim();

  const erro =
    abertos.error?.message || resolvidos.error?.message || config.error?.message || erroToken;

  const cfg = (config.data as AlertaConfigRow | null) ?? null;
  return {
    filtro,
    lojas,
    abertos: (abertos.data || []) as AlertaRow[],
    resolvidos: (resolvidos.data || []) as AlertaRow[],
    config: cfg
      ? {
          user_id: cfg.user_id,
          telegram_chat_id: cfg.telegram_chat_id,
          ativo: cfg.ativo,
          receber_avisos: cfg.receber_avisos,
          gasto_sem_venda_min: Number(cfg.gasto_sem_venda_min) || 0,
        }
      : configPadrao,
    temToken: temTokenProprio || tokenDaEnv,
    tokenDaEnv,
    erro: erro ? `Não foi possível ler os alertas: ${erro}` : null,
  };
}
