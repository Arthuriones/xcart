import type { SupabaseClient } from "@supabase/supabase-js";
import { profileHasAccess } from "@/lib/billing/access";
import { tabelaAusente } from "@/lib/checkouts-externos/tipos";
import {
  PLANO_BASE,
  ehPlanoId,
  planoPorId,
  planoQueCobre,
  quantas,
  type ContagemDeUso,
  type LimitesPlano,
  type PlanoId,
} from "@/lib/billing/plans";

// ============================================================================
// Limite de lojas por plano. Funcao UNICA: toda rota que liga rastreamento ou
// poe loja no roteamento passa por aqui, e a tela de Assinatura le o uso daqui.
//
// O que conta:
//  - rastreamento: lojas do usuario com tracking_configs.enabled = true, mais
//    os checkouts externos com rastreamento ligado (abaixo). Limite 0 = o plano
//    nao inclui rastreamento (o Roteamento).
//  - vitrines: as vitrines distintas das rotas do usuario (source_store_id);
//  - lojas de checkout: as distintas entre os destinos de cada rota
//    (routed_checkout_targets). Rota sem nenhuma linha de destino conta a loja
//    de checkout da propria rota (o destino legado que o loader usa);
//  - roteamento: vitrines e checkouts juntas, distintas -- o teto dos planos
//    anteriores (1 Loja, 3 Lojas). Os de hoje limitam cada lado a parte.
// Loja desinstalada CONTA em todos. Se nao contasse, desinstalar o app, ligar
// outra loja e reinstalar abria vaga -- e `uninstalled_at` o proprio usuario
// consegue gravar pela API do Supabase. Para liberar a vaga: desligar o
// rastreamento da loja (a tela de Rastreamento mostra a desinstalada que ainda
// esta ligada) ou tirar a loja da rota.
//
// Checkout externo (Cakto, Sphere... migration 069) e uma "operacao" como a
// loja (decisao de 19/10/2026): com o rastreamento LIGADO -- um destino Meta
// ou TikTok ativo em checkout_externo_destinos (073) -- ele ocupa uma vaga do
// MESMO limite de rastreamento das lojas, com a chave `checkout:<id>` no
// conjunto (chaveDoCheckout). Cadastrar checkout nao conta, e ele nunca entra
// no roteamento. Sem a 073, nenhum checkout conta (a tabela nao existe).
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

/** Os limites que valem para a conta (null = sem limite em cada um). */
export interface LimitesDaConta extends LimitesPlano {
  origem: OrigemDoLimite;
  /** O plano cujos limites valem. null so em "liberado". */
  plano: PlanoId | null;
}

const SEM_LIMITE: LimitesPlano = { rastreamento: null, vitrines: null, checkouts: null, roteamento: null };

export function limitesDoPerfil(p: PerfilParaLimites | null): LimitesDaConta {
  if (p && (p.is_admin === true || p.access_granted === true)) {
    return { origem: "liberado", plano: null, ...SEM_LIMITE };
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

/**
 * O plano anterior (fora da venda) que esta conta pode pagar de novo por Pix,
 * pelo mesmo preco: o que ela tem valendo agora. O Pro antigo sem tier renova
 * no PLANO_BASE, que tem os mesmos limites. null = so os planos a venda.
 */
export function planoAnteriorDaConta(p: PerfilParaLimites | null): PlanoId | null {
  if (!p || p.plan !== "pro" || !profileHasAccess(p)) return null;
  const tier = planoPorId(p.plano);
  if (!tier) return PLANO_BASE;
  return tier.aVenda ? null : tier.id;
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

/** Vitrines e lojas de checkout distintas, so entre as do usuario (instaladas ou nao). */
export function ladosDoRoteamento(
  rotas: readonly LinhaRota[],
  destinos: readonly LinhaDestino[],
  donas: ReadonlySet<string>
): { vitrines: Set<string>; checkouts: Set<string> } {
  const comDestino = new Set(destinos.map((d) => d.route_id));
  const daConta = new Set(rotas.map((r) => r.id));
  const vitrines = new Set<string>();
  const checkouts = new Set<string>();
  for (const r of rotas) {
    if (r.source_store_id && donas.has(r.source_store_id)) vitrines.add(r.source_store_id);
    // Sem linha de destino, o loader roteia pelo destino legado da rota.
    if (!comDestino.has(r.id) && r.target_store_id && donas.has(r.target_store_id)) {
      checkouts.add(r.target_store_id);
    }
  }
  for (const d of destinos) {
    if (d.target_store_id && daConta.has(d.route_id) && donas.has(d.target_store_id)) {
      checkouts.add(d.target_store_id);
    }
  }
  return { vitrines, checkouts };
}

/** Lojas distintas no roteamento (vitrines e checkouts juntas). */
export function lojasNoRoteamento(
  rotas: readonly LinhaRota[],
  destinos: readonly LinhaDestino[],
  donas: ReadonlySet<string>
): Set<string> {
  const { vitrines, checkouts } = ladosDoRoteamento(rotas, destinos, donas);
  return new Set([...vitrines, ...checkouts]);
}

/**
 * A chave do checkout no conjunto do rastreamento. Prefixada: o id do
 * checkout nunca colide com o de uma loja, e os dois contam no mesmo limite.
 */
export function chaveDoCheckout(checkoutId: string): string {
  return `checkout:${checkoutId}`;
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

export type TipoDeLimite = "rastreamento" | "vitrines" | "checkouts" | "roteamento";

const COBRE: Record<TipoDeLimite, (n: number) => string> = {
  rastreamento: (n) => `${quantas(n, "operação", "operações")} com rastreamento (loja ou checkout)`,
  vitrines: (n) => `${quantas(n, "vitrine", "vitrines")} no roteamento`,
  checkouts: (n) => `${quantas(n, "loja de checkout", "lojas de checkout")} no roteamento`,
  roteamento: (n) => `${quantas(n, "loja", "lojas")} no roteamento`,
};

const VERBO: Record<TipoDeLimite, string> = {
  rastreamento: "ligar mais",
  vitrines: "usar mais vitrines",
  checkouts: "usar mais lojas de checkout",
  roteamento: "usar mais lojas",
};

/**
 * A frase do bloqueio: o que o plano cobre e para onde ir.
 * "Seu plano cobre 1 vitrine no roteamento. Para usar mais vitrines, mude para o Completo em Assinatura."
 *
 * `depois` e o uso da conta com a mudanca: o plano sugerido e o primeiro a
 * venda onde TUDO cabe (quem tem 7 vitrines nao e mandado para o Completo).
 * Sem ele, so a dimensao barrada conta.
 */
export function mensagemDeLimite(
  tipo: TipoDeLimite,
  limites: LimitesDaConta,
  depois?: ContagemDeUso
): string {
  const n = limites[tipo] ?? 0;
  const alvo: ContagemDeUso = depois ?? {
    rastreamento: 0,
    vitrines: 0,
    checkouts: 0,
    roteamento: 0,
    [tipo]: n + 1,
  };
  const proximo = planoQueCobre(alvo, limites.plano);
  const destino = proximo ? proximo.nome : "outro plano";

  if (tipo === "rastreamento" && n === 0) {
    const nome = limites.plano ? planoPorId(limites.plano)?.nome : null;
    const quem = nome ? `O plano ${nome}` : "Seu plano";
    if (!proximo) return `${quem} não inclui rastreamento. Para ligar, mude de plano em Assinatura.`;
    const r = proximo.limites.rastreamento;
    const inclui = r === null ? "rastreamento sem limite" : quantas(r, "operação", "operações");
    return `${quem} não inclui rastreamento. O ${proximo.nome} inclui ${inclui}. Mude em Assinatura.`;
  }

  const cobre = COBRE[tipo](n);
  if (limites.origem === "sem_plano") {
    return `Sem assinatura, o xcart cobre ${cobre}. Para ${VERBO[tipo]}, assine o ${destino} em Assinatura.`;
  }
  return `Seu plano cobre ${cobre}. Para ${VERBO[tipo]}, mude para o ${destino} em Assinatura.`;
}

/** "2/6 lojas no roteamento"; sem limite, so o numero: "2 lojas no roteamento". */
function usoDe(n: number, limite: number | null, um: string, varios: string): string {
  if (limite === null) return `${n} ${n === 1 ? um : varios}`;
  return `${n}/${limite} ${limite === 1 ? um : varios}`;
}

/**
 * "1/5 operações com rastreamento · 1/5 vitrines e 2/5 lojas de checkout no roteamento"
 * (os anteriores: "1/1 operação com rastreamento · 2/6 lojas no roteamento").
 */
export function resumoDoUso(limites: LimitesPlano, uso: ContagemDeUso): string {
  const rastreio =
    limites.rastreamento === 0 && uso.rastreamento === 0
      ? "Rastreamento não incluso"
      : usoDe(uso.rastreamento, limites.rastreamento, "operação com rastreamento", "operações com rastreamento");
  const rota =
    limites.roteamento !== null
      ? usoDe(uso.roteamento, limites.roteamento, "loja no roteamento", "lojas no roteamento")
      : `${usoDe(uso.vitrines, limites.vitrines, "vitrine", "vitrines")} e ${usoDe(
          uso.checkouts,
          limites.checkouts,
          "loja de checkout",
          "lojas de checkout"
        )} no roteamento`;
  return `${rastreio} · ${rota}`;
}

/** A conta esta acima de algum limite (plano mudou depois de ligar)? */
export function acimaDoLimite(limites: LimitesPlano, uso: ContagemDeUso): boolean {
  const acima = (limite: number | null, n: number) => limite !== null && n > limite;
  return (
    acima(limites.rastreamento, uso.rastreamento) ||
    acima(limites.vitrines, uso.vitrines) ||
    acima(limites.checkouts, uso.checkouts) ||
    acima(limites.roteamento, uso.roteamento)
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
 * O banco nao aceita o tier na escrita: sem a coluna (064 pendente) ou com o
 * CHECK antigo, que nao conhece os planos de 24/10 (23514, 078 pendente). Nos
 * dois casos quem escreve grava o resto: quem pagou nao fica sem o Pro porque
 * a migration atrasou -- cai nos limites do Pro antigo, e o proximo aviso da
 * Pagou grava o tier (o perfil sem tier aceita o tier pelo valor).
 */
export function bancoRecusouPlano(e: { code?: string; message?: string } | null | undefined): boolean {
  if (semColunaPlano(e)) return true;
  return !!e && e.code === "23514" && /plano/.test(e.message ?? "");
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
 * Grava no perfil. Se o banco recusa o tier (coluna ausente ou CHECK antigo),
 * grava o resto: quem pagou nao pode ficar sem o Pro porque a migration
 * atrasou -- cai no legado.
 */
export async function atualizarPerfil(
  db: SupabaseClient,
  userId: string,
  campos: Record<string, unknown>
) {
  const r = await db.from("profiles").update(campos).eq("id", userId);
  if (!bancoRecusouPlano(r.error) || !("plano" in campos)) return r;
  const resto = { ...campos };
  delete resto.plano;
  return db.from("profiles").update(resto).eq("id", userId);
}

export interface LeituraDeUso {
  /** Todas as lojas do usuario, instaladas ou nao. */
  donas: Set<string>;
  /** Lojas (o id) e checkouts (chaveDoCheckout) com o rastreamento ligado. */
  rastreamento: Set<string>;
  rotas: LinhaRota[];
  destinos: LinhaDestino[];
  vitrines: Set<string>;
  checkouts: Set<string>;
  /** vitrines e checkouts juntas. */
  roteamento: Set<string>;
}

/** O uso lido, em numeros. */
export function contagemDoUso(u: Pick<LeituraDeUso, "rastreamento" | "vitrines" | "checkouts" | "roteamento">): ContagemDeUso {
  return {
    rastreamento: u.rastreamento.size,
    vitrines: u.vitrines.size,
    checkouts: u.checkouts.size,
    roteamento: u.roteamento.size,
  };
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

  const [configs, destinos, rastreioCheckout] = await Promise.all([
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
    // Checkout com destino ativo (073). O user_id da linha e o do checkout
    // (FK composta), entao o filtro basta, com o admin ou com a sessao.
    db.from("checkout_externo_destinos").select("checkout_id").eq("user_id", userId).eq("ativo", true),
  ]);
  if (configs.error) throw new Error(configs.error.message);
  if (destinos.error) throw new Error(destinos.error.message);
  // Sem a 073 a tabela nao existe: nenhum checkout rastreia (nao e erro).
  if (rastreioCheckout.error && !tabelaAusente(rastreioCheckout.error)) {
    throw new Error(rastreioCheckout.error.message);
  }

  const rastreamento = lojasComRastreamento(
    (configs.data || []) as { store_id: string; enabled: boolean | null }[],
    donas
  );
  for (const d of (rastreioCheckout.error ? [] : rastreioCheckout.data || []) as { checkout_id: string }[]) {
    rastreamento.add(chaveDoCheckout(String(d.checkout_id)));
  }

  const linhasDestino = (destinos.data || []) as LinhaDestino[];
  const { vitrines, checkouts } = ladosDoRoteamento(linhasRota, linhasDestino, donas);
  return {
    donas,
    rastreamento,
    rotas: linhasRota,
    destinos: linhasDestino,
    vitrines,
    checkouts,
    roteamento: new Set([...vitrines, ...checkouts]),
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

function bloqueio(tipo: TipoDeLimite, limites: LimitesDaConta, depois: ContagemDeUso): Checagem {
  return {
    ok: false,
    status: 403,
    codigo: "limite_do_plano",
    mensagem: mensagemDeLimite(tipo, limites, depois),
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
 * Pode LIGAR o rastreamento desta loja -- ou deste checkout externo
 * (`{ checkoutId }`)? Ja ligado passa sempre. Quem chama ja conferiu que a
 * loja (ou o checkout) e do usuario; loja desinstalada entra na conta. No
 * plano sem rastreamento (limite 0), toda ativacao nova e recusada.
 */
export async function conferirLigarRastreamento(
  db: SupabaseClient,
  userId: string,
  alvo: string | { checkoutId: string }
): Promise<Checagem> {
  try {
    const limites = limitesDoPerfil(await lerPerfilParaLimites(db, userId));
    if (limites.rastreamento === null) return { ok: true };
    const uso = await lerUso(db, userId);
    const chave = typeof alvo === "string" ? alvo : chaveDoCheckout(alvo.checkoutId);
    const depois = new Set(uso.rastreamento).add(chave);
    return passaDoLimite(uso.rastreamento, depois, limites.rastreamento)
      ? bloqueio("rastreamento", limites, { ...contagemDoUso(uso), rastreamento: depois.size })
      : { ok: true };
  } catch (e) {
    console.error("[limites] rastreamento", e instanceof Error ? e.message : e);
    return FALHA;
  }
}

/**
 * Pode por estas lojas no roteamento? `vitrine` e `checkout` sao as lojas da
 * mudanca (as duas de uma rota nova, ou a loja de checkout nova de uma rota
 * existente -- a vitrine dela ja conta). `trocarRota` e a edicao das lojas de
 * uma rota existente. Vitrines, lojas de checkout e o total (dos planos
 * anteriores) sao conferidos cada um contra o seu limite.
 */
export async function conferirRoteamento(
  db: SupabaseClient,
  userId: string,
  mudanca: {
    vitrine?: string | null;
    checkout?: string | null;
    trocarRota?: { id: string; source_store_id: string; target_store_id: string };
  }
): Promise<Checagem> {
  try {
    const limites = limitesDoPerfil(await lerPerfilParaLimites(db, userId));
    if (limites.vitrines === null && limites.checkouts === null && limites.roteamento === null) {
      return { ok: true };
    }
    const uso = await lerUso(db, userId);

    const t = mudanca.trocarRota;
    const rotas = t ? uso.rotas.map((r) => (r.id === t.id ? { ...r, ...t } : r)) : uso.rotas;
    const { vitrines, checkouts } = ladosDoRoteamento(rotas, uso.destinos, uso.donas);
    if (mudanca.vitrine && uso.donas.has(mudanca.vitrine)) vitrines.add(mudanca.vitrine);
    if (mudanca.checkout && uso.donas.has(mudanca.checkout)) checkouts.add(mudanca.checkout);
    const total = new Set([...vitrines, ...checkouts]);

    const depois = contagemDoUso({ rastreamento: uso.rastreamento, vitrines, checkouts, roteamento: total });
    if (passaDoLimite(uso.vitrines, vitrines, limites.vitrines)) return bloqueio("vitrines", limites, depois);
    if (passaDoLimite(uso.checkouts, checkouts, limites.checkouts)) return bloqueio("checkouts", limites, depois);
    if (passaDoLimite(uso.roteamento, total, limites.roteamento)) return bloqueio("roteamento", limites, depois);
    return { ok: true };
  } catch (e) {
    console.error("[limites] roteamento", e instanceof Error ? e.message : e);
    return FALHA;
  }
}
