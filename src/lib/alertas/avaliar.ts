import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import {
  diaNoFuso,
  formatarDinheiro,
  paraNumero,
  type AlertaConfigRow,
  type AlertaRow,
  type RegraAlerta,
} from "@/lib/financeiro/tipos";
import {
  chaveDoAlerta,
  montarMensagem,
  planejar,
  type CondicaoAlerta,
} from "@/lib/alertas/regras";
import { enviarTelegram, tokenDoBot } from "@/lib/alertas/telegram";
import { RE_DESINSTALADO } from "@/lib/leitura/lojas-estado";

// ============================================================================
// O cron de alertas: le o banco, decide e manda UMA mensagem por usuario.
//
// Toda regra usa so dado que ja esta no banco (fila de rastreamento, estado
// dos syncs, gasto, pedidos). Nada aqui chama Shopify, Meta ou Google: o cron
// roda a cada 10 min para todas as lojas, e um alerta que dependesse de API
// externa falharia justamente quando a API estivesse fora -- que e quando ele
// mais importa.
//
// So LE tracking_events, tracking_configs, tracking_destinations e stores.
// Escreve em `alertas`.
// ============================================================================

type Admin = ReturnType<typeof createAdminClient>;

const MIN = 60_000;
const HORA = 60 * MIN;

interface LojaAlerta {
  id: string;
  user_id: string;
  name: string | null;
  shop_domain: string | null;
  uninstalled_at: string | null;
}

export interface ColetaDetalhada {
  condicoes: CondicaoAlerta[];
  /** Regra que falhou nesta execucao: seus abertos nao contam falso. */
  regrasComFalha: Set<RegraAlerta>;
  lojas: Map<string, LojaAlerta>;
  erros: string[];
}

function cortar(texto: string | null | undefined, n: number): string | null {
  const t = String(texto ?? "").trim();
  if (!t) return null;
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`;
}

function nomePlataforma(p: string | null | undefined): string {
  if (p === "google") return "Google";
  if (p === "ga4") return "GA4";
  if (p === "tiktok") return "TikTok";
  return "Meta";
}

export async function coletarCondicoesDetalhado(
  admin: Admin,
  agora: Date
): Promise<ColetaDetalhada> {
  const condicoes: CondicaoAlerta[] = [];
  const regrasComFalha = new Set<RegraAlerta>();
  const erros: string[] = [];

  // Sem lojas nao ha dono para nenhum alerta: aqui a falha derruba a execucao
  // (melhor do que fechar todo alerta aberto por "nada encontrado").
  const { data: lojasCruas, error: erroLojas } = await admin
    .from("stores")
    .select("id, user_id, name, shop_domain, uninstalled_at");
  if (erroLojas) throw new Error(`Falha ao ler as lojas: ${erroLojas.message}`);
  const lojas = new Map<string, LojaAlerta>();
  for (const l of (lojasCruas || []) as LojaAlerta[]) lojas.set(String(l.id), l);
  const donoDa = (storeId: string | null | undefined) =>
    storeId ? lojas.get(String(storeId))?.user_id ?? null : null;

  const rodar = async (regra: RegraAlerta, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      regrasComFalha.add(regra);
      const msg = e instanceof Error ? e.message : String(e);
      erros.push(`${regra}: ${msg}`);
      console.error(`[alertas] regra ${regra} falhou:`, msg);
    }
  };

  const desdeUmaHora = new Date(agora.getTime() - HORA).toISOString();

  // ---- R1: app desinstalado com rastreamento ligado ----------------------
  await rodar("app_desinstalado", async () => {
    const desinstaladas = [...lojas.values()].filter((l) => l.uninstalled_at);
    if (desinstaladas.length === 0) return;
    const { data, error } = await admin
      .from("tracking_configs")
      .select("store_id, enabled")
      .in(
        "store_id",
        desinstaladas.map((l) => l.id)
      )
      .eq("enabled", true);
    if (error) throw new Error(error.message);
    for (const c of (data || []) as { store_id: string }[]) {
      const loja = lojas.get(String(c.store_id));
      if (!loja) continue;
      condicoes.push({
        user_id: loja.user_id,
        store_id: loja.id,
        regra: "app_desinstalado",
        chave: "",
        severidade: "critico",
        titulo: "App desinstalado com rastreamento ligado",
        detalhe:
          "Sem o app, as compras param de chegar no Google e no Meta. Reinstale o app ou desligue o rastreamento da loja.",
      });
    }
  });

  // ---- R2: token do CAPI recusado (erro 190) -----------------------------
  const destinosComToken190 = new Set<string>();
  await rodar("meta_capi_token", async () => {
    type Linha = {
      store_id: string;
      destination_id: string | null;
      last_error: string | null;
      response?: { error?: { code?: number | string } } | null;
    };
    let linhas: Linha[] = [];
    const filtrado = await admin
      .from("tracking_events")
      .select("store_id, destination_id, last_error, created_at")
      .eq("destination", "meta")
      .eq("status", "falhou")
      .gte("created_at", desdeUmaHora)
      .eq("response->error->>code", "190")
      .order("created_at", { ascending: false })
      .limit(200);
    if (!filtrado.error) {
      linhas = (filtrado.data || []) as Linha[];
    } else {
      // Fallback: o filtro por caminho JSON foi recusado. Busca a resposta e
      // filtra aqui -- mais bytes, mesmo resultado.
      const cru = await admin
        .from("tracking_events")
        .select("store_id, destination_id, last_error, created_at, response")
        .eq("destination", "meta")
        .eq("status", "falhou")
        .gte("created_at", desdeUmaHora)
        .order("created_at", { ascending: false })
        .limit(200);
      if (cru.error) throw new Error(cru.error.message);
      linhas = ((cru.data || []) as Linha[]).filter(
        (l) => String(l.response?.error?.code ?? "") === "190"
      );
    }

    const grupos = new Map<string, { linha: Linha; n: number }>();
    for (const l of linhas) {
      const k = `${l.store_id}|${l.destination_id ?? ""}`;
      const g = grupos.get(k);
      if (g) g.n += 1;
      else grupos.set(k, { linha: l, n: 1 });
    }
    for (const { linha, n } of grupos.values()) {
      const dono = donoDa(linha.store_id);
      if (!dono) continue;
      if (linha.destination_id) destinosComToken190.add(String(linha.destination_id));
      condicoes.push({
        user_id: dono,
        store_id: String(linha.store_id),
        regra: "meta_capi_token",
        chave: String(linha.destination_id ?? ""),
        severidade: "critico",
        titulo: "Token do Meta (CAPI) recusado",
        detalhe: `${plural(n, "evento recusado", "eventos recusados")} na última hora (erro 190: token vencido ou revogado). Gere um token novo no Gerenciador de Eventos e cole em Rastreamento.`,
      });
    }
  });

  // ---- R3: compra que falhou no envio -------------------------------------
  // So o servidor (Meta e TikTok): o Google sai do navegador (tag do Google),
  // fora da fila, e linha 'google' antiga que a fila fecha como 'falhou' nao e
  // compra perdida. O token recusado do TikTok cai aqui, com a mensagem dele
  // ("40001: ...") -- o Meta tem a R2 propria.
  await rodar("envio_falhando", async () => {
    const colunas = "id, store_id, destination, destination_id, last_error, created_at";
    const recentes = await admin
      .from("tracking_events")
      .select(colunas)
      .eq("event_name", "Purchase")
      .in("destination", ["meta", "tiktok"])
      .eq("status", "falhou")
      .gte("created_at", desdeUmaHora)
      .order("created_at", { ascending: false })
      .limit(500);
    if (recentes.error) throw new Error(recentes.error.message);
    type Linha = {
      id: string;
      store_id: string;
      destination: string;
      destination_id: string | null;
      last_error: string | null;
      created_at: string | null;
    };
    const linhas = (recentes.data || []) as Linha[];
    const grupos = new Map<string, { linha: Linha; n: number }>();
    for (const l of linhas) {
      const k = `${l.store_id}|${l.destination_id ?? l.destination}`;
      const g = grupos.get(k);
      // Ordenado do mais novo: o primeiro de cada grupo traz o ultimo erro.
      if (g) g.n += 1;
      else grupos.set(k, { linha: l, n: 1 });
    }
    for (const { linha, n } of grupos.values()) {
      const dono = donoDa(linha.store_id);
      if (!dono) continue;
      // Token recusado ja tem alerta proprio, com a instrucao certa.
      if (linha.destination_id && destinosComToken190.has(String(linha.destination_id))) continue;
      condicoes.push({
        user_id: dono,
        store_id: String(linha.store_id),
        regra: "envio_falhando",
        chave: String(linha.destination_id ?? linha.destination),
        severidade: "critico",
        titulo: `${plural(n, "compra não chegou", "compras não chegaram")} no ${nomePlataforma(linha.destination)}`,
        detalhe: cortar(linha.last_error, 200),
      });
    }
  });

  // ---- R4: fila de envio parada -------------------------------------------
  await rodar("fila_travada", async () => {
    const limite = new Date(agora.getTime() - 30 * MIN).toISOString();
    const { data, error } = await admin
      .from("tracking_events")
      .select("store_id")
      .eq("status", "pendente")
      .lt("next_attempt_at", limite)
      .limit(200);
    if (error) throw new Error(error.message);
    const porLoja = new Map<string, number>();
    for (const l of (data || []) as { store_id: string }[]) {
      porLoja.set(String(l.store_id), (porLoja.get(String(l.store_id)) || 0) + 1);
    }
    for (const [storeId, n] of porLoja) {
      const dono = donoDa(storeId);
      if (!dono) continue;
      condicoes.push({
        user_id: dono,
        store_id: storeId,
        regra: "fila_travada",
        chave: "",
        severidade: "critico",
        titulo: "Fila de envio parada",
        detalhe: `${plural(n, "evento esperando", "eventos esperando")} há mais de 30 min — o cron de envio parece parado.`,
      });
    }
  });

  // ---- R4b: rastreamento parado -------------------------------------------
  // O snippet do tema e o Web Pixel deixam linha na fila COM visitor_id (o
  // webhook de compra, nao). Loja que mandou evento na semana e nada em 24 h:
  // tema trocado, snippet apagado ou loja sem visita. So loja com Meta ou
  // TikTok ativo: o Google sai do navegador e nao deixa rastro no banco, entao
  // loja so com Google nunca teria linha -- e alertaria por engano.
  await rodar("rastreamento_parado", async () => {
    const { data: cfgs, error } = await admin
      .from("tracking_configs")
      .select("store_id")
      .eq("enabled", true);
    if (error) throw new Error(error.message);
    const ligadas = ((cfgs || []) as { store_id: string }[])
      .map((c) => String(c.store_id))
      // Desinstalada ja tem a R1, com a instrucao certa.
      .filter((id) => lojas.has(id) && !lojas.get(id)!.uninstalled_at);
    if (ligadas.length === 0) return;

    const { data: doServidor, error: erroDestinos } = await admin
      .from("tracking_destinations")
      .select("store_id")
      .in("store_id", ligadas)
      .in("plataforma", ["meta", "tiktok"])
      .eq("ativo", true);
    if (erroDestinos) throw new Error(erroDestinos.message);
    const comServidor = [
      ...new Set(((doServidor || []) as { store_id: string }[]).map((m) => String(m.store_id))),
    ];

    // A semana so barra a ABERTURA (loja parada ha muito nao "parou agora").
    // Alerta ja aberto continua ate o evento voltar, por mais velho que fique.
    const { data: abertos, error: erroAbertos } = await admin
      .from("alertas")
      .select("store_id")
      .eq("regra", "rastreamento_parado")
      .is("resolvido_em", null);
    if (erroAbertos) throw new Error(erroAbertos.message);
    const jaAberto = new Set(((abertos || []) as { store_id: string }[]).map((a) => String(a.store_id)));
    const seteDias = agora.getTime() - 7 * 24 * HORA;
    const limite = agora.getTime() - 24 * HORA;
    // Uma leitura por loja ligada, limit 1 no indice (store_id, created_at):
    // cresce com o numero de lojas, nao com o trafego. Em lotes de 10.
    const ultimos: { storeId: string; em: string | null }[] = [];
    for (let i = 0; i < comServidor.length; i += 10) {
      const lote = await Promise.all(
        comServidor.slice(i, i + 10).map(async (storeId) => {
          const { data, error: e } = await admin
            .from("tracking_events")
            .select("created_at")
            .eq("store_id", storeId)
            .not("visitor_id", "is", null)
            .order("created_at", { ascending: false })
            .limit(1);
          if (e) throw new Error(e.message);
          const em = ((data || []) as { created_at: string | null }[])[0]?.created_at ?? null;
          return { storeId, em };
        })
      );
      ultimos.push(...lote);
    }

    for (const { storeId, em } of ultimos) {
      const t = em ? Date.parse(em) : NaN;
      const aberto = jaAberto.has(storeId);
      if (Number.isFinite(t) ? t >= limite || (t < seteDias && !aberto) : !aberto) continue;
      const loja = lojas.get(storeId);
      if (!loja) continue;
      const horas = Number.isFinite(t) ? Math.floor((agora.getTime() - t) / HORA) : null;
      const ha = horas === null ? "mais de 30 dias" : horas < 48 ? `${horas} h` : `${Math.floor(horas / 24)} dias`;
      condicoes.push({
        user_id: loja.user_id,
        store_id: storeId,
        regra: "rastreamento_parado",
        chave: "",
        severidade: "aviso",
        titulo: "Rastreamento sem eventos há 24 h",
        detalhe: `Último evento há ${ha}. O código saiu do tema ou a loja ficou sem visitas.`,
      });
    }
  });

  // ---- R5: sync de pedidos com erro ou atrasado ---------------------------
  // Lido aqui e reaproveitado na R7 (pedidos frescos + fuso da loja).
  type Sync = {
    store_id: string;
    user_id: string;
    fuso: string | null;
    ultimo_erro: string | null;
    ultimo_sync_ok_em: string | null;
    updated_at: string | null;
    carga_inicial_ok: boolean | null;
  };
  let syncs: Sync[] | null = null;
  await rodar("pedidos_sync_erro", async () => {
    const { data, error } = await admin
      .from("fin_sync_state")
      .select("store_id, user_id, fuso, ultimo_erro, ultimo_sync_ok_em, updated_at, carga_inicial_ok");
    if (error) throw new Error(error.message);
    syncs = (data || []) as Sync[];
    const limite = agora.getTime() - 2 * HORA;
    for (const s of syncs) {
      const loja = lojas.get(String(s.store_id));
      if (!loja || loja.uninstalled_at) continue;
      // Loja que nunca leu pedido com sucesso (chave errada, loja fechada,
      // app nunca instalado): nao "parou", nunca funcionou. A tela Lojas ja
      // mostra a conexao; aqui so viraria um aviso eterno sem dono.
      if (!s.ultimo_sync_ok_em) continue;
      // "App nao esta instalado": a loja tirou o app sem o webhook marcar.
      // Nao e sync atrasado que se resolve sozinho, e o erro cru da Shopify
      // nao diz o que fazer. Continua UM aviso (aviso nao renotifica; o
      // aberto so troca de texto), dizendo o que a tela Lojas e o Lucro dizem.
      if (RE_DESINSTALADO.test(s.ultimo_erro ?? "")) {
        condicoes.push({
          user_id: loja.user_id,
          store_id: loja.id,
          regra: "pedidos_sync_erro",
          chave: "",
          severidade: "aviso",
          titulo: "App desinstalado",
          detalhe:
            "A Shopify diz que o app não está instalado nesta loja: pedidos e compras param de chegar. Reinstale o app ou remova a loja em Lojas.",
        });
        continue;
      }
      const okEm = s.ultimo_sync_ok_em ? Date.parse(s.ultimo_sync_ok_em) : null;
      const atualizado = s.updated_at ? Date.parse(s.updated_at) : 0;
      const atrasado = okEm !== null ? okEm < limite : atualizado < limite;
      if (!s.ultimo_erro && !atrasado) continue;
      condicoes.push({
        user_id: loja.user_id,
        store_id: loja.id,
        regra: "pedidos_sync_erro",
        chave: "",
        severidade: "aviso",
        titulo: "Pedidos da Shopify sem atualizar",
        detalhe: s.ultimo_erro
          ? cortar(s.ultimo_erro, 200)
          : "A última leitura de pedidos com sucesso foi há mais de 2 h: o lucro desta loja pode estar desatualizado.",
      });
    }
  });

  // ---- R6 e R7: contas de anuncio -----------------------------------------
  type Conta = {
    id: string;
    user_id: string;
    store_id: string | null;
    plataforma: "meta" | "google";
    external_id: string;
    nome: string | null;
    fuso: string | null;
    ultimo_sync_ok_em: string | null;
    ultimo_erro: string | null;
    created_at: string | null;
  };
  let contas: Conta[] | null = null;
  const lerContas = async () => {
    if (contas) return contas;
    const { data, error } = await admin
      .from("ad_accounts")
      .select(
        "id, user_id, store_id, plataforma, external_id, nome, fuso, ultimo_sync_ok_em, ultimo_erro, created_at"
      )
      .eq("ativo", true)
      .not("store_id", "is", null);
    if (error) throw new Error(error.message);
    contas = (data || []) as Conta[];
    return contas;
  };

  await rodar("ads_sync_atrasado", async () => {
    for (const c of await lerContas()) {
      // Gasto do Google nao e lido hoje (decisao de 04/10): conta Google
      // parada nao e problema de ninguem.
      if (c.plataforma === "google") continue;
      const loja = lojas.get(String(c.store_id));
      if (!loja) continue;
      const okEm = c.ultimo_sync_ok_em ? Date.parse(c.ultimo_sync_ok_em) : null;
      const criada = c.created_at ? Date.parse(c.created_at) : 0;
      const atrasado =
        okEm !== null ? agora.getTime() - okEm > 90 * MIN : agora.getTime() - criada > 2 * HORA;
      if (!c.ultimo_erro && !atrasado) continue;
      const nome = c.nome || c.external_id;
      const plataforma = nomePlataforma(c.plataforma);
      condicoes.push({
        user_id: c.user_id,
        store_id: String(c.store_id),
        regra: "ads_sync_atrasado",
        chave: String(c.id),
        severidade: "critico",
        titulo: `Gasto do ${plataforma} sem atualizar: ${nome}`,
        detalhe: c.ultimo_erro
          ? cortar(c.ultimo_erro, 200)
          : okEm === null
            ? "A conta ainda não recebeu nenhum dado de gasto."
            : "A leitura do gasto no Meta não roda com sucesso há mais de 90 min.",
      });
    }
  });

  await rodar("gastou_sem_vender", async () => {
    const frescas = (await lerContas()).filter((c) => {
      if (!c.ultimo_sync_ok_em) return false;
      const tol = c.plataforma === "google" ? 2 * HORA : 45 * MIN;
      return agora.getTime() - Date.parse(c.ultimo_sync_ok_em) <= tol;
    });
    if (frescas.length === 0) return;

    const hojeDaConta = new Map(frescas.map((c) => [c.id, diaNoFuso(agora, c.fuso)]));
    const dias = [...new Set(hojeDaConta.values())];
    const { data: gastos, error } = await admin
      .from("ad_spend_daily")
      .select("ad_account_id, data, moeda, gasto")
      .in(
        "ad_account_id",
        frescas.map((c) => c.id)
      )
      .eq("nivel", "conta")
      .in("data", dias);
    if (error) throw new Error(error.message);

    // (loja) -> (moeda|dia) -> soma
    const somas = new Map<string, Map<string, { moeda: string; dia: string; total: number }>>();
    const contaPorId = new Map(frescas.map((c) => [c.id, c]));
    for (const g of (gastos || []) as {
      ad_account_id: string;
      data: string;
      moeda: string;
      gasto: number | string;
    }[]) {
      const conta = contaPorId.get(String(g.ad_account_id));
      if (!conta?.store_id) continue;
      const dia = String(g.data).slice(0, 10);
      if (hojeDaConta.get(conta.id) !== dia) continue;
      const porLoja = somas.get(conta.store_id) ?? new Map();
      const k = `${g.moeda}|${dia}`;
      const atual = porLoja.get(k) ?? { moeda: String(g.moeda), dia, total: 0 };
      atual.total += paraNumero(g.gasto);
      porLoja.set(k, atual);
      somas.set(conta.store_id, porLoja);
    }
    if (somas.size === 0) return;

    const donos = [...new Set([...somas.keys()].map((s) => donoDa(s)).filter(Boolean))] as string[];
    const { data: configs, error: erroCfg } = await admin
      .from("alerta_config")
      .select("user_id, gasto_sem_venda_min")
      .in("user_id", donos);
    if (erroCfg) throw new Error(erroCfg.message);
    const minimoDe = new Map(
      ((configs || []) as { user_id: string; gasto_sem_venda_min: number | string }[]).map((c) => [
        String(c.user_id),
        paraNumero(c.gasto_sem_venda_min),
      ])
    );

    // Pedidos frescos: sem isso, "nao vendeu" pode ser so "nao leu ainda".
    let estados: Sync[] = syncs ?? [];
    if (!syncs) {
      const { data, error: e2 } = await admin
        .from("fin_sync_state")
        .select("store_id, user_id, fuso, ultimo_erro, ultimo_sync_ok_em, updated_at, carga_inicial_ok");
      if (e2) throw new Error(e2.message);
      estados = (data || []) as Sync[];
    }
    const syncDa = new Map(estados.map((s) => [String(s.store_id), s]));

    for (const [storeId, porMoeda] of somas) {
      const loja = lojas.get(storeId);
      if (!loja) continue;
      const minimo = minimoDe.has(loja.user_id) ? minimoDe.get(loja.user_id)! : 30;
      const acima = [...porMoeda.values()]
        .filter((s) => s.total > 0 && s.total >= minimo)
        .sort((a, b) => b.total - a.total)[0];
      if (!acima) continue;

      const sync = syncDa.get(storeId);
      // Carga inicial em curso: os pedidos de hoje sao os ultimos a chegar
      // (ordem por updated_at), entao "sem venda hoje" ainda nao quer dizer nada.
      if (!sync?.carga_inicial_ok || !sync.ultimo_sync_ok_em) continue;
      if (agora.getTime() - Date.parse(sync.ultimo_sync_ok_em) > 45 * MIN) continue;

      const hojeDaLoja = diaNoFuso(agora, sync.fuso);
      const { data: vendas, error: e3 } = await admin
        .from("fin_orders")
        .select("shopify_order_id")
        .eq("store_id", storeId)
        .eq("tipo", "venda")
        .gt("liquido_pago", 0)
        .eq("dia_local", hojeDaLoja)
        .limit(1);
      if (e3) throw new Error(e3.message);
      if ((vendas || []).length > 0) continue;

      const valor = formatarDinheiro(acima.total, acima.moeda);
      condicoes.push({
        user_id: loja.user_id,
        store_id: storeId,
        regra: "gastou_sem_vender",
        // O dia na chave: amanha e outro alerta, nao a continuacao deste.
        chave: acima.dia,
        severidade: "critico",
        titulo: `Gastou ${valor} sem vender hoje`,
        detalhe: `Nenhuma venda paga hoje e o gasto em anúncio já passou de ${formatarDinheiro(minimo, acima.moeda)}. Confira o checkout, o pagamento e as campanhas.`,
      });
    }
  });

  return { condicoes, regrasComFalha, lojas, erros };
}

export async function coletarCondicoes(admin: Admin, agora: Date): Promise<CondicaoAlerta[]> {
  return (await coletarCondicoesDetalhado(admin, agora)).condicoes;
}

const CONFIG_PADRAO: Omit<AlertaConfigRow, "user_id"> = {
  telegram_chat_id: null,
  ativo: true,
  receber_avisos: true,
  gasto_sem_venda_min: 30,
};

export async function avaliarEEnviar(
  admin: Admin,
  agora = new Date()
): Promise<{ usuarios: number; abertos: number; resolvidos: number; enviados: number; erros: string[] }> {
  const coleta = await coletarCondicoesDetalhado(admin, agora);
  const erros = [...coleta.erros];
  const agoraIso = agora.toISOString();

  const { data: abertosCrus, error: erroAbertos } = await admin
    .from("alertas")
    .select("*")
    .is("resolvido_em", null)
    .limit(5000);
  if (erroAbertos) throw new Error(`Falha ao ler os alertas abertos: ${erroAbertos.message}`);
  const abertos = (abertosCrus || []) as AlertaRow[];

  const usuarios = [
    ...new Set([...coleta.condicoes.map((c) => c.user_id), ...abertos.map((a) => a.user_id)]),
  ];
  if (usuarios.length === 0) {
    return { usuarios: 0, abertos: 0, resolvidos: 0, enviados: 0, erros };
  }

  const { data: configsCruas, error: erroCfg } = await admin
    .from("alerta_config")
    .select("user_id, telegram_chat_id, ativo, receber_avisos, gasto_sem_venda_min")
    .in("user_id", usuarios);
  if (erroCfg) erros.push(`alerta_config: ${erroCfg.message}`);
  const configDe = new Map(
    ((configsCruas || []) as AlertaConfigRow[]).map((c) => [String(c.user_id), c])
  );

  const nomeDaLoja = (id: string | null) => {
    if (!id) return "todas as lojas";
    const l = coleta.lojas.get(id);
    if (!l) return "loja removida";
    const dominio = String(l.shop_domain || "").replace(/\.myshopify\.com$/i, "");
    return l.name && dominio ? `${l.name} · ${dominio}` : l.name || dominio || "loja";
  };

  let totalAbertos = 0;
  let totalResolvidos = 0;
  let enviados = 0;

  for (const userId of usuarios) {
    const cfg = { ...CONFIG_PADRAO, ...(configDe.get(userId) || {}), user_id: userId };
    const ativas = coleta.condicoes.filter((c) => c.user_id === userId);
    // Regra que nao rodou nao e problema resolvido: os abertos dela ficam
    // de fora do plano (nem confirmam, nem contam falso).
    const meus = abertos.filter(
      (a) => a.user_id === userId && !coleta.regrasComFalha.has(a.regra)
    );
    const plano = planejar(meus, ativas, agora, { receberAvisos: !!cfg.receber_avisos });

    // ---- abrir --------------------------------------------------------------
    const abertasAgora = new Set<string>();
    for (const c of plano.abrir) {
      const { error } = await admin.from("alertas").insert({
        user_id: c.user_id,
        store_id: c.store_id,
        regra: c.regra,
        chave: c.chave,
        severidade: c.severidade,
        titulo: c.titulo,
        detalhe: c.detalhe,
        aberto_em: agoraIso,
        confirmado_em: agoraIso,
      });
      if (!error) {
        abertasAgora.add(chaveDoAlerta(c));
        totalAbertos += 1;
      } else if (error.code !== "23505") {
        // 23505 = outra execucao abriu o mesmo alerta: ela avisa, esta nao.
        erros.push(`abrir ${c.regra}: ${error.message}`);
      }
    }

    // ---- confirmar / contar falso / resolver -------------------------------
    for (const c of plano.confirmar) {
      const { error } = await admin
        .from("alertas")
        .update({
          confirmado_em: agoraIso,
          falsos_seguidos: 0,
          titulo: c.titulo,
          detalhe: c.detalhe,
        })
        .eq("id", c.id);
      if (error) erros.push(`confirmar ${c.id}: ${error.message}`);
    }
    for (const f of plano.contarFalso) {
      const { error } = await admin
        .from("alertas")
        .update({ falsos_seguidos: f.falsos })
        .eq("id", f.id);
      if (error) erros.push(`falso ${f.id}: ${error.message}`);
    }
    if (plano.resolver.length > 0) {
      const { error } = await admin
        .from("alertas")
        .update({ resolvido_em: agoraIso, falsos_seguidos: 0 })
        .in(
          "id",
          plano.resolver.map((r) => r.id)
        );
      if (error) erros.push(`resolver: ${error.message}`);
      else totalResolvidos += plano.resolver.length;
    }

    // ---- Telegram -------------------------------------------------------------
    if (!cfg.ativo || !cfg.telegram_chat_id) continue;
    const novos = plano.notificarAbertura.filter((c) => abertasAgora.has(chaveDoAlerta(c)));
    // "Resolvido" so do que o lojista chegou a receber: avisar o fim de um
    // alerta que ele nunca viu e ruido.
    const resolvidos = plano.resolver.filter((r) => (Number(r.n_notificacoes) || 0) > 0);
    const mensagem = montarMensagem({
      novos,
      renotificar: plano.renotificar,
      resolvidos,
      nomeDaLoja,
    });
    if (!mensagem) continue;

    let token: string | null = null;
    try {
      token = await tokenDoBot(admin, userId);
    } catch (e) {
      erros.push(`token do bot: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!token) continue;

    const envio = await enviarTelegram(token, cfg.telegram_chat_id, mensagem.texto, mensagem.silenciosa);
    if (!envio.ok) {
      // Nao marca notificado: a proxima rodada tenta de novo.
      erros.push(`telegram ${userId.slice(0, 8)}: ${envio.erro ?? "falhou"}`);
      continue;
    }
    enviados += 1;

    // ---- marcar notificado (so depois do envio OK) --------------------------
    for (const a of plano.renotificar) {
      const { error } = await admin
        .from("alertas")
        .update({ notificado_em: agoraIso, n_notificacoes: (Number(a.n_notificacoes) || 0) + 1 })
        .eq("id", a.id);
      if (error) erros.push(`notificado ${a.id}: ${error.message}`);
    }
    for (const c of novos) {
      let q = admin
        .from("alertas")
        .update({ notificado_em: agoraIso, n_notificacoes: 1 })
        .eq("user_id", c.user_id)
        .eq("regra", c.regra)
        .eq("chave", c.chave)
        .is("resolvido_em", null);
      q = c.store_id ? q.eq("store_id", c.store_id) : q.is("store_id", null);
      const { error } = await q;
      if (error) erros.push(`notificado ${c.regra}: ${error.message}`);
    }
  }

  return {
    usuarios: usuarios.length,
    abertos: totalAbertos,
    resolvidos: totalResolvidos,
    enviados,
    erros,
  };
}
