import type { SupabaseClient } from "@supabase/supabase-js";
import { profileHasAccess } from "@/lib/billing/access";
import {
  PLANO_BASE,
  ehPlanoId,
  planoPorId,
  proximoPlano,
  type PlanoId,
} from "@/lib/billing/plans";

// ============================================================================
// Limite de lojas por plano. Funcao UNICA: toda rota que liga rastreamento ou
// poe loja no roteamento passa por aqui, e a tela de Assinatura le o uso daqui.
//
// O que conta:
//  - rastreamento: lojas do usuario com tracking_configs.enabled = true;
//  - roteamento: lojas distintas nas rotas do usuario -- a vitrine de cada rota
//    e cada loja de checkout (routed_checkout_targets). Rota sem nenhuma linha
//    de destino conta a loja de checkout da propria rota (o destino legado que
//    o loader usa).
// Loja desinstalada CONTA nos dois. Se nao contasse, desinstalar o app, ligar
// outra loja e reinstalar abria vaga -- e `uninstalled_at` o proprio usuario
// consegue gravar pela API do Supabase. Para liberar a vaga: desligar o
// rastreamento da loja (a tela de Rastreamento mostra a desinstalada que ainda
// esta ligada) ou tirar a loja da rota.
//
// Checkout externo (Sphere e afins, migration 069) NAO conta em nenhum dos
// dois: nao tem tracking_configs nem entra em rota, entao lerUso nem o ve, e
// POST /api/checkouts nao chama conferirLigarRastreamento/conferirRoteamento.
// O teto dele e so contra abuso (MAX_CHECKOUTS em
// src/lib/checkouts-externos/tipos.ts). Se um dia virar limite de plano, o
// lugar e LimitesPlano em plans.ts -- nao misture com as lojas daqui.
//
// Conectar loja NAO tem limite. O limite so barra uma ativacao NOVA: nada que
// ja esta ligado acima do limite e desligado (quem passou do limite continua
// com o que tem, e so nao liga mais).
//
// Admin e acesso liberado a mao: sem limite. Assinante sem tier gravado
// (Stripe ou Pagou a R$ 89, de antes dos planos) e conta sem assinatura: os
// limites do 1 Loja.
// ============================================================================

export interface PerfilParaLimites {
  is_admin?: boolean | null;
  access_granted?: boolean | null;
  plan?: string | null;
  /** profiles.plano (migration 064). Ausente = legado. */
  plano?: string | null;
  payment_provider?: string | null;
  pagou_subscription_id?: string | null;
  current_period_end?: string | null;
}

/** De onde vem o limite: liberado a mao, tier pago, Pro antigo ou sem plano. */
export type OrigemDoLimite = "liberado" | "plano" | "legado" | "sem_plano";

export interface LimitesDaConta {
  origem: OrigemDoLimite;
  /** O plano cujos limites valem. null so em "liberado". */
  plano: PlanoId | null;
  /** null = sem limite. */
  rastreamento: number | null;
  /** null = sem limite. */
  roteamento: number | null;
}

export function limitesDoPerfil(p: PerfilParaLimites | null): LimitesDaConta {
  if (p && (p.is_admin === true || p.access_granted === true)) {
    return { origem: "liberado", plano: null, rastreamento: null, roteamento: null };
  }
  const base = planoPorId(PLANO_BASE)!;
  // profileHasAccess ja confere o Pro por Pix vencido: venceu, vira sem plano.
  if (p && profileHasAccess(p)) {
    const tier = ehPlanoId(p.plano) ? planoPorId(p.plano)! : null;
    if (tier) return { origem: "plano", plano: tier.id, ...tier.limites };
    return { origem: "legado", plano: base.id, ...base.limites };
  }
  return { origem: "sem_plano", plano: base.id, ...base.limites };
}

// ---------------------------------------------------------------------------
// Contagem (pura)
// ---------------------------------------------------------------------------

export interface LinhaRota {
  id: string;
  source_store_id: string | null;
  target_store_id: string | null;
}

export interface LinhaDestino {
  route_id: string;
  target_store_id: string | null;
}

/** Lojas distintas no roteamento, so entre as do usuario (instaladas ou nao). */
export function lojasNoRoteamento(
  rotas: readonly LinhaRota[],
  destinos: readonly LinhaDestino[],
  donas: ReadonlySet<string>
): Set<string> {
  const comDestino = new Set(destinos.map((d) => d.route_id));
  const ids = new Set<string>();
  for (const r of rotas) {
    if (r.source_store_id) ids.add(r.source_store_id);
    // Sem linha de destino, o loader roteia pelo destino legado da rota.
    if (!comDestino.has(r.id) && r.target_store_id) ids.add(r.target_store_id);
  }
  const daConta = new Set(rotas.map((r) => r.id));
  for (const d of destinos) {
    if (d.target_store_id && daConta.has(d.route_id)) ids.add(d.target_store_id);
  }
  return new Set([...ids].filter((id) => donas.has(id)));
}

/** Lojas do usuario (instaladas ou nao) com o rastreamento ligado. */
export function lojasComRastreamento(
  configs: readonly { store_id: string; enabled: boolean | null }[],
  donas: ReadonlySet<string>
): Set<string> {
  return new Set(
    configs.filter((c) => c.enabled === true && donas.has(c.store_id)).map((c) => c.store_id)
  );
}

/**
 * A mudanca passa do limite? So se o conjunto DEPOIS tiver mais lojas que o
 * limite E trouxer loja que nao estava antes. Quem ja esta acima (porque o
 * plano mudou) segue com o que tem: tirar loja ou mexer nas que ja estao passa.
 */
export function passaDoLimite(
  antes: ReadonlySet<string>,
  depois: ReadonlySet<string>,
  limite: number | null
): boolean {
  if (limite === null) return false;
  if (depois.size <= limite) return false;
  for (const id of depois) if (!antes.has(id)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Mensagens (puras)
// ---------------------------------------------------------------------------

/**
 * A frase do bloqueio: o que o plano cobre e para onde ir.
 * "Seu plano cobre 1 loja com rastreamento. Para ligar mais, mude para o 3 Lojas em Assinatura."
 */
export function mensagemDeLimite(
  tipo: "rastreamento" | "roteamento",
  limites: LimitesDaConta
): string {
  const limite = tipo === "rastreamento" ? limites.rastreamento : limites.roteamento;
  const n = limite ?? 0;
  const cobre =
    tipo === "rastreamento"
      ? n === 1
        ? "1 loja com rastreamento"
        : `${n} lojas com rastreamento`
      : `até ${n} ${n === 1 ? "loja" : "lojas"} no roteamento`;
  const verbo = tipo === "rastreamento" ? "ligar mais" : "usar mais lojas";
  const proximo = limites.plano ? proximoPlano(limites.plano) : null;
  const destino = proximo ? proximo.nome : "outro plano";

  if (limites.origem === "sem_plano") {
    return `Sem assinatura, o xcart cobre ${cobre}. Para ${verbo}, assine o ${destino} em Assinatura.`;
  }
  return `Seu plano cobre ${cobre}. Para ${verbo}, mude para o ${destino} em Assinatura.`;
}

/** "1/1 lojas com rastreamento · 2/6 no roteamento". */
export function resumoDoUso(
  limites: Pick<LimitesDaConta, "rastreamento" | "roteamento">,
  uso: { rastreamento: number; roteamento: number }
): string {
  const lojas = (n: number) => (n === 1 ? "loja" : "lojas");
  const rastreio =
    limites.rastreamento === null
      ? `${uso.rastreamento} ${lojas(uso.rastreamento)} com rastreamento`
      : `${uso.rastreamento}/${limites.rastreamento} lojas com rastreamento`;
  const rota =
    limites.roteamento === null
      ? `${uso.roteamento} no roteamento`
      : `${uso.roteamento}/${limites.roteamento} no roteamento`;
  return `${rastreio} · ${rota}`;
}

/** A conta esta acima de algum limite (plano mudou depois de ligar)? */
export function acimaDoLimite(
  limites: Pick<LimitesDaConta, "rastreamento" | "roteamento">,
  uso: { rastreamento: number; roteamento: number }
): boolean {
  return (
    (limites.rastreamento !== null && uso.rastreamento > limites.rastreamento) ||
    (limites.roteamento !== null && uso.roteamento > limites.roteamento)
  );
}

// ---------------------------------------------------------------------------
// Leitura do banco
// ---------------------------------------------------------------------------

const COLUNAS_PERFIL =
  "is_admin, access_granted, plan, payment_provider, pagou_subscription_id, current_period_end";

/**
 * O erro de coluna `plano` inexistente (migration 064 pendente). Sao DOIS
 * codigos: na leitura o Postgres responde 42703; num insert/update com a chave
 * o PostgREST recusa antes, com PGRST204 ("Could not find the 'plano' column
 * ... in the schema cache"). Reconhecer so o primeiro deixava a escrita do
 * perfil falhar em silencio depois de o cartao ser cobrado.
 */
export function semColunaPlano(e: { code?: string; message?: string } | null | undefined): boolean {
  if (!e || (e.code !== "42703" && e.code !== "PGRST204")) return false;
  return !e.message || /\bplano\b/.test(e.message);
}

/**
 * Le com a coluna `plano` e, se ela ainda nao existe, sem ela. `ler` recebe o
 * pedaco do select (", plano" ou "") e monta a consulta.
 */
export async function lerComPlano<R extends { error: { code?: string; message?: string } | null }>(
  ler: (colunaPlano: string) => PromiseLike<R>
): Promise<R> {
  const r = await ler(", plano");
  return semColunaPlano(r.error) ? ler("") : r;
}

/**
 * O perfil com o tier. Se a coluna `plano` ainda nao existe (migration 064 nao
 * aplicada), le sem ela: a conta cai no legado, nunca num erro.
 */
export async function lerPerfilParaLimites(
  db: SupabaseClient,
  userId: string
): Promise<PerfilParaLimites | null> {
  const r = await lerComPlano((plano) =>
    db.from("profiles").select(`${COLUNAS_PERFIL}${plano}`).eq("id", userId).maybeSingle()
  );
  if (r.error) throw new Error(r.error.message);
  return (r.data as PerfilParaLimites | null) ?? null;
}

/**
 * Grava no perfil. Se a coluna `plano` ainda nao existe, grava o resto: quem
 * pagou nao pode ficar sem o Pro porque a migration atrasou -- cai no legado.
 */
export async function atualizarPerfil(
  db: SupabaseClient,
  userId: string,
  campos: Record<string, unknown>
) {
  const r = await db.from("profiles").update(campos).eq("id", userId);
  if (!semColunaPlano(r.error) || !("plano" in campos)) return r;
  const resto = { ...campos };
  delete resto.plano;
  return db.from("profiles").update(resto).eq("id", userId);
}

export interface LeituraDeUso {
  /** Todas as lojas do usuario, instaladas ou nao. */
  donas: Set<string>;
  rastreamento: Set<string>;
  rotas: LinhaRota[];
  destinos: LinhaDestino[];
  roteamento: Set<string>;
}

/** O uso atual da conta. Funciona com o cliente admin ou com o da sessao (RLS). */
export async function lerUso(db: SupabaseClient, userId: string): Promise<LeituraDeUso> {
  const [lojas, rotas] = await Promise.all([
    db.from("stores").select("id").eq("user_id", userId),
    db
      .from("routed_checkout_configs")
      .select("id, source_store_id, target_store_id")
      .eq("user_id", userId),
  ]);
  if (lojas.error) throw new Error(lojas.error.message);
  if (rotas.error) throw new Error(rotas.error.message);

  const donas = new Set(((lojas.data || []) as { id: string }[]).map((l) => l.id));
  const linhasRota = (rotas.data || []) as LinhaRota[];
  const idsRota = linhasRota.map((r) => r.id);

  const [configs, destinos] = await Promise.all([
    donas.size
      ? db
          .from("tracking_configs")
          .select("store_id, enabled")
          .eq("enabled", true)
          .in("store_id", [...donas])
      : Promise.resolve({ data: [], error: null }),
    idsRota.length
      ? db
          .from("routed_checkout_targets")
          .select("route_id, target_store_id")
          .in("route_id", idsRota)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (configs.error) throw new Error(configs.error.message);
  if (destinos.error) throw new Error(destinos.error.message);

  const linhasDestino = (destinos.data || []) as LinhaDestino[];
  return {
    donas,
    rastreamento: lojasComRastreamento(
      (configs.data || []) as { store_id: string; enabled: boolean | null }[],
      donas
    ),
    rotas: linhasRota,
    destinos: linhasDestino,
    roteamento: lojasNoRoteamento(linhasRota, linhasDestino, donas),
  };
}

// ---------------------------------------------------------------------------
// As travas (servidor)
// ---------------------------------------------------------------------------

export type Checagem =
  | { ok: true }
  | {
      ok: false;
      /** 403 = limite do plano; 503 = nao deu para conferir. */
      status: 403 | 503;
      codigo: "limite_do_plano" | "limite_indisponivel";
      mensagem: string;
    };

const FALHA: Checagem = {
  ok: false,
  status: 503,
  codigo: "limite_indisponivel",
  mensagem: "Não deu para conferir o limite do plano agora. Tente de novo em instantes.",
};

function bloqueio(tipo: "rastreamento" | "roteamento", limites: LimitesDaConta): Checagem {
  return {
    ok: false,
    status: 403,
    codigo: "limite_do_plano",
    mensagem: mensagemDeLimite(tipo, limites),
  };
}

/**
 * Corpo JSON padrao do bloqueio: `error` e o que as telas ja mostram; `code`
 * segue o "subscribe_required" do clone, para a tela oferecer "Ver planos".
 */
export function corpoDoBloqueio(c: Exclude<Checagem, { ok: true }>) {
  return { error: c.mensagem, code: c.codigo };
}

/**
 * Pode LIGAR o rastreamento desta loja? Ja ligada passa sempre. Quem chama ja
 * conferiu que a loja e do usuario; desinstalada ou nao, ela entra na conta.
 */
export async function conferirLigarRastreamento(
  db: SupabaseClient,
  userId: string,
  storeId: string
): Promise<Checagem> {
  try {
    const limites = limitesDoPerfil(await lerPerfilParaLimites(db, userId));
    if (limites.rastreamento === null) return { ok: true };
    const uso = await lerUso(db, userId);
    const depois = new Set(uso.rastreamento).add(storeId);
    return passaDoLimite(uso.rastreamento, depois, limites.rastreamento)
      ? bloqueio("rastreamento", limites)
      : { ok: true };
  } catch (e) {
    console.error("[limites] rastreamento", e instanceof Error ? e.message : e);
    return FALHA;
  }
}

/**
 * Pode por estas lojas no roteamento? `adicionar` sao as lojas que a mudanca
 * acrescenta (vitrine e checkout de uma rota nova, ou a loja de checkout nova
 * de uma rota). `trocarRota` e a edicao das lojas de uma rota existente.
 */
export async function conferirRoteamento(
  db: SupabaseClient,
  userId: string,
  mudanca: {
    adicionar?: readonly string[];
    trocarRota?: { id: string; source_store_id: string; target_store_id: string };
  }
): Promise<Checagem> {
  try {
    const limites = limitesDoPerfil(await lerPerfilParaLimites(db, userId));
    if (limites.roteamento === null) return { ok: true };
    const uso = await lerUso(db, userId);

    let depois: Set<string>;
    if (mudanca.trocarRota) {
      const t = mudanca.trocarRota;
      const rotas = uso.rotas.map((r) => (r.id === t.id ? { ...r, ...t } : r));
      depois = lojasNoRoteamento(rotas, uso.destinos, uso.donas);
    } else {
      depois = new Set(uso.roteamento);
    }
    for (const id of mudanca.adicionar || []) if (uso.donas.has(id)) depois.add(id);

    return passaDoLimite(uso.roteamento, depois, limites.roteamento)
      ? bloqueio("roteamento", limites)
      : { ok: true };
  } catch (e) {
    console.error("[limites] roteamento", e instanceof Error ? e.message : e);
    return FALHA;
  }
}
