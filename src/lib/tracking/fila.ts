import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  enviarParaMeta,
  proximaTentativaEm,
  MAX_TENTATIVAS,
  type EventoCapi,
} from "@/lib/tracking/meta-capi";
import { rotuloDoEvento } from "@/lib/tracking/eventos";
import type { Destino } from "@/lib/tracking/destinos";
import {
  ESPERA_DO_CLIQUE_MS,
  PRAZO_DO_DIAGNOSTICO_MS,
  PRIMEIRA_CONFERENCIA_MS,
  acaoDoEvento,
  cliqueParaGoogle,
  decidirCliqueDeOutraConta,
  ehEventoDeTeste,
  lerDiagnostico,
  montarCorpoDataManager,
  proximaConferenciaEm,
  transactionIdDoEvento,
  usaDataManager,
} from "@/lib/tracking/google-url";

// ============================================================================
// Fila de saida do rastreamento.
//
// O evento nasce 'pendente' no banco ANTES de qualquer chamada de rede. Se o
// envio falhar -- token vencido, limite de taxa, rede -- a linha continua la e
// o cron tenta de novo. Enviar direto e so logar o erro perderia conversao
// exatamente nos momentos em que mais se vende, que e quando o Meta limita.
// ============================================================================

/**
 * O interruptor da loja.
 *
 * Isto e tudo o que sobrou de `tracking_configs` para o caminho de envio: pixel,
 * conta, rotulo e token viraram LINHA em `tracking_destinations` na migration
 * 043, porque a loja pode ter cinco contas de Google e dois pixels Meta. Quem
 * resolve destino e `src/lib/tracking/destinos.ts`.
 *
 * O interruptor continua valendo por cima de todos eles: desligar a loja para o
 * envio sem precisar desativar destino por destino.
 */
export async function rastreamentoLigado(
  admin: ReturnType<typeof createAdminClient>,
  storeId: string
): Promise<boolean> {
  const { data, error } = await admin
    .from("tracking_configs")
    .select("enabled")
    .eq("store_id", storeId)
    .maybeSingle();
  // Erro de banco NAO e "desligado". Tratar como desligado fazia o webhook
  // responder 200 'rastreamento desligado' num soluco do Supabase -- e com 200
  // a Shopify nao reentrega, entao a compra sumia de vez.
  if (error) throw new Error(`falha ao ler o interruptor da loja: ${error.message}`);
  return Boolean(data?.enabled);
}

/**
 * Coloca o evento na fila.
 *
 * O indice unico (store_id, destination, event_id) E a trava contra duplicata:
 * reentrega de webhook e retentativa nossa nao podem virar duas conversoes.
 * Colisao devolve `duplicado`, sem erro -- e o caminho normal.
 */
export async function enfileirar(
  admin: ReturnType<typeof createAdminClient>,
  entrada: {
    storeId: string;
    destination: "meta" | "google" | "ga4";
    /** Qual conta. Entra na chave de dedupe junto com store_id e event_id. */
    destinationId?: string | null;
    /**
     * Serve de fonte do nome e da chave de dedupe, iguais para todo destino.
     *
     * Só estes dois campos, e não `EventoCapi` inteiro: o evento de funil que
     * vem do navegador não tem user_data nem custom_data para preencher, e
     * exigir o tipo completo obrigaria o coletor a inventar campos.
     */
    evento: { event_name: string; event_id: string };
    orderId?: string | null;
    /** Só nos eventos de navegador. Alimenta o teto de abuso do coletor. */
    visitorId?: string | null;
    /** De onde a sessao veio. So diagnostico -- nao vai para destino nenhum. */
    referrer?: string | null;
    /** Token do checkout da Shopify, nos eventos que o Web Pixel manda. */
    checkoutToken?: string | null;
    /** O que vai para a API do destino. Omitido = o proprio evento (Meta). */
    payload?: unknown;
  }
): Promise<{ id: string | null; duplicado: boolean }> {
  const { data, error } = await admin
    .from("tracking_events")
    .insert({
      store_id: entrada.storeId,
      destination: entrada.destination,
      destination_id: entrada.destinationId ?? null,
      event_name: entrada.evento.event_name,
      event_id: entrada.evento.event_id,
      order_id: entrada.orderId ?? null,
      visitor_id: entrada.visitorId ?? null,
      referrer: entrada.referrer ?? null,
      checkout_token: entrada.checkoutToken ?? null,
      payload: (entrada.payload ?? entrada.evento) as Record<string, unknown>,
    })
    .select("id")
    .single();

  // 23505 = unique_violation: ja estava na fila.
  if (error?.code === "23505") return { id: null, duplicado: true };
  if (error) throw new Error(`falha ao enfileirar: ${error.message}`);
  return { id: data?.id ?? null, duplicado: false };
}

/**
 * Tenta entregar uma linha da fila e grava o desfecho.
 *
 * Dirigido por DESTINO, nao por plataforma. A loja pode ter cinco contas Google
 * e dois pixels Meta, e cada linha da fila sabe de qual delas e -- o
 * `destination_id` tambem entra na chave de deduplicacao, senao dois destinos
 * da mesma plataforma colidiriam e o segundo sumiria como "duplicado".
 *
 * Todo destino ativo recebe todo evento que ele aceita. No Google, com varias
 * contas na loja, so a dona do clique aceita: pela Data Manager as outras
 * respondem CLICK_NOT_FOUND no diagnostico, e `conferirDiagnosticos` marca
 * "nao e desta conta" quando uma irma aceitou -- nao e erro. Pelo ping antigo
 * nao ha resposta nenhuma.
 *
 * Erro permanente (token invalido, rotulo ausente) vai direto para 'falhou':
 * insistir so queima chamada e esconde o problema atras de uma fila que nunca
 * esvazia. O lojista precisa ver 'falhou' com o motivo.
 */
export async function entregar(
  admin: ReturnType<typeof createAdminClient>,
  linha: {
    id: string;
    store_id: string;
    destination: string;
    destination_id?: string | null;
    /** Decide QUAL rotulo usar: um por conversion action no Google. */
    event_name: string;
    payload: unknown;
    attempts: number;
    /**
     * So o cron passa os tres abaixo (le a linha do banco). O coletor e o
     * webhook chamam logo depois de enfileirar, sem eles -- e o Google pela
     * Data Manager so AGENDA nessa hora (6 h), entao nao precisa.
     */
    event_id?: string | null;
    checkout_token?: string | null;
    created_at?: string | null;
  },
  /**
   * O que o chamador JA carregou.
   *
   * Existe por escala, nao por elegancia. O caminho quente -- o coletor, que
   * roda em todo pageview de toda loja -- ja leu o destino (com token) e o
   * interruptor da loja antes de chegar aqui. Sem isto, `entregar` relia os
   * dois: mais TRES idas ao banco por destino, em cima de um pageview que ja
   * fazia dezessete.
   *
   * O cron continua chamando sem nada: la so existe o id da linha, e reler e
   * justamente o certo -- a configuracao pode ter mudado desde que o evento
   * entrou na fila.
   */
  jaCarregado?: {
    destino?: Destino | null;
    lojaLigada?: boolean;
  }
): Promise<{ ok: boolean; motivo?: string; agendado?: boolean }> {
  const tentativas = linha.attempts + 1;

  const desistir = async (motivo: string) => {
    await admin
      .from("tracking_events")
      .update({ status: "falhou", attempts: tentativas, last_error: motivo })
      .eq("id", linha.id);
    return { ok: false, motivo };
  };

  if (!linha.destination_id) {
    // Linha de antes da migration 043. Nao ha como saber para QUAL conta ela
    // ia; reentregar chutando mandaria conversao para a conta errada.
    return desistir("linha sem destino: anterior aos destinos por conta");
  }

  const { destinoPorId, destinoAceita, porQueRecusa } = await import(
    "@/lib/tracking/destinos"
  );
  const destino =
    jaCarregado?.destino ?? (await destinoPorId(admin, linha.destination_id));
  if (!destino) return desistir("destino removido");

  // O interruptor da loja continua valendo por cima dos destinos.
  const ligada =
    jaCarregado?.lojaLigada ?? (await rastreamentoLigado(admin, linha.store_id));
  if (!ligada) {
    return desistir("rastreamento desligado para esta loja");
  }

  if (!destinoAceita(destino, linha.event_name)) {
    return desistir(porQueRecusa(destino, linha.event_name) || "destino nao aceita");
  }

  const gravarSucesso = async (
    resposta: Record<string, unknown> | null,
    aviso?: string | null
  ) => {
    await admin
      .from("tracking_events")
      .update({
        status: "enviado",
        attempts: tentativas,
        sent_at: new Date().toISOString(),
        last_error: aviso ?? null,
        response: resposta,
      })
      .eq("id", linha.id);
    return { ok: true };
  };

  const gravarFalha = async (
    erro: string,
    podeTentarDeNovo: boolean,
    resposta: Record<string, unknown> | null
  ) => {
    const acabou = !podeTentarDeNovo || tentativas >= MAX_TENTATIVAS;
    await admin
      .from("tracking_events")
      .update({
        status: acabou ? "falhou" : "pendente",
        attempts: tentativas,
        next_attempt_at: proximaTentativaEm(tentativas).toISOString(),
        last_error: erro.slice(0, 500),
        response: resposta,
      })
      .eq("id", linha.id);
    return { ok: false, motivo: erro };
  };

  // ---- Meta ---------------------------------------------------------------
  if (destino.plataforma === "meta") {
    const r = await enviarParaMeta(
      destino.conta,
      destino.token!,
      [linha.payload as EventoCapi],
      { testEventCode: destino.testEventCode }
    );
    // Aviso para quem le a linha. A TELA nao depende dele: a RPC conta o sem
    // clique pelo payload (migration 051), entao reescrever esta frase nao
    // muda contagem nenhuma.
    const semClique = !(linha.payload as EventoCapi)?.user_data?.fbc;
    return r.ok
      ? gravarSucesso(
          (r.corpo ?? null) as Record<string, unknown> | null,
          // Sem fbc o Meta ainda casa por _fbp, IP, user agent e e-mail: o
          // que falta e so o clique no anuncio dele.
          semClique ? "sem fbc: nao veio de clique em anuncio do Meta" : null
        )
      : gravarFalha(
          r.erro ?? "falha desconhecida",
          r.podeTentarDeNovo,
          (r.corpo ?? null) as Record<string, unknown> | null
        );
  }

  // ---- Google pela Data Manager -------------------------------------------
  if (usaDataManager(destino)) {
    return entregarNaDataManager(admin, linha, destino, tentativas, gravarFalha);
  }

  // ---- Google pelo ping antigo (destino sem customer_id + acoes) ----------
  const { enviarParaGoogleAds } = await import("@/lib/tracking/google-ads");
  const conv = linha.payload as {
    gclid?: string | null;
    gbraid?: string | null;
    wbraid?: string | null;
    auid?: string | null;
    pageUrl?: string | null;
    orderId?: string;
    value?: number;
    currency?: string;
  };

  // Qualquer um dos tres serve de atribuicao; nenhum significa conversao que o
  // Google nao tem como ligar a anuncio.
  const temClique = conv.gclid || conv.gbraid || conv.wbraid || null;

  const r = await enviarParaGoogleAds({
    conversionId: destino.conta,
    label: rotuloDoEvento(destino.labels, linha.event_name)!,
    gclid: conv.gclid,
    gbraid: conv.gbraid,
    wbraid: conv.wbraid,
    auid: conv.auid,
    pageUrl: conv.pageUrl,
    orderId: conv.orderId,
    value: conv.value,
    currency: conv.currency,
  });

  const resposta = { url: r.url, status: r.status } as Record<string, unknown>;

  // "enviado" aqui e "o Google aceitou a requisicao". O endpoint responde 200
  // mesmo ignorando -- a confirmacao de verdade so existe na tela do Google
  // Ads. Guardar a URL permite repetir a chamada na mao para investigar.
  return r.ok
    ? gravarSucesso(
        resposta,
        temClique ? null : "sem gclid/gbraid/wbraid: conversao sem atribuicao a anuncio"
      )
    : gravarFalha(r.erro ?? "falha desconhecida", r.podeTentarDeNovo, resposta);
}

/** O que o coletor e o webhook gravam para o Google (purchase.ts, collect). */
interface PayloadGoogle {
  gclid?: string | null;
  gbraid?: string | null;
  wbraid?: string | null;
  orderId?: string | null;
  value?: number | null;
  currency?: string | null;
  /** Gravado pelo coletor quando o visitante esta em modo teste. */
  teste?: unknown;
  /** 'concedido' | 'negado' | ausente, lido da Customer Privacy API. */
  consentimento?: unknown;
}

type LinhaDaFila = Parameters<typeof entregar>[1];
type GravarFalha = (
  erro: string,
  podeTentarDeNovo: boolean,
  resposta: Record<string, unknown> | null
) => Promise<{ ok: boolean; motivo?: string }>;

/**
 * Envio pela Data Manager API.
 *
 * TRES SAIDAS SEM ENVIO, todas de proposito:
 *
 *   - teste ou sem click id: a linha termina como 'enviado' SEM sent_at, com o
 *     motivo ao lado. Nao e falha (nao ha o que consertar, e 'falhou' de compra
 *     sem clique dispararia o alerta de compra perdida a cada venda organica),
 *     e nao fica pendente para sempre;
 *   - antes de 6 h do evento: so reagenda. O Google recusa clique recente
 *     (TOO_RECENT_CLICK), e e por isso que o envio "na hora" do coletor e do
 *     webhook vira so agendamento para este destino. O Meta segue na hora.
 *
 * Depois do envio a linha fica 'enviado' com o requestId em response.dm e
 * `conferir_em` marcado: o diagnostico (se CONTOU) sai em
 * `conferirDiagnosticos`, 30 min a 24 h depois.
 */
async function entregarNaDataManager(
  admin: ReturnType<typeof createAdminClient>,
  linha: LinhaDaFila,
  destino: Destino,
  tentativas: number,
  gravarFalha: GravarFalha
): Promise<{ ok: boolean; motivo?: string; agendado?: boolean }> {
  const p = (linha.payload ?? {}) as PayloadGoogle;

  const fecharSemEnviar = async (situacao: string, aviso: string) => {
    await admin
      .from("tracking_events")
      .update({ status: "enviado", last_error: aviso, response: { dm: { situacao } } })
      .eq("id", linha.id);
    return { ok: true, motivo: aviso };
  };

  if (ehEventoDeTeste(p)) return fecharSemEnviar("teste", "teste: não vai ao Google");
  const clique = cliqueParaGoogle(p);
  if (!clique) {
    return fecharSemEnviar("sem_clique", "sem gclid/wbraid/gbraid: não vai ao Google");
  }

  const criadoMs = linha.created_at ? Date.parse(linha.created_at) : NaN;
  const quando = Number.isFinite(criadoMs) ? criadoMs : Date.now();
  const liberaEm = quando + ESPERA_DO_CLIQUE_MS;
  if (Date.now() < liberaEm) {
    await admin
      .from("tracking_events")
      .update({ next_attempt_at: new Date(liberaEm).toISOString() })
      .eq("id", linha.id);
    return { ok: false, motivo: "aguardando 6 h: o Google recusa clique recente", agendado: true };
  }

  const { enviarAoDataManager } = await import("@/lib/tracking/google-dm");
  const r = await enviarAoDataManager(
    montarCorpoDataManager({
      customerId: destino.customerId!,
      loginCustomerId: destino.loginCustomerId,
      // `destinoAceita` ja garantiu que o evento tem acao.
      acao: acaoDoEvento(destino.acoes, linha.event_name)!,
      clique,
      transactionId: transactionIdDoEvento({
        event_name: linha.event_name,
        event_id: linha.event_id,
        checkout_token: linha.checkout_token,
        payload: p,
      }),
      quando: new Date(quando),
      valor: p.value,
      moeda: p.currency,
      consentimento: p.consentimento,
    })
  );

  if (!r.ok) {
    return gravarFalha(r.erro ?? "falha desconhecida", r.podeTentarDeNovo, {
      dm: { status: r.status, erro: r.corpo ?? null },
    });
  }

  const agora = Date.now();
  await admin
    .from("tracking_events")
    .update({
      status: "enviado",
      attempts: tentativas,
      sent_at: new Date(agora).toISOString(),
      last_error: null,
      response: {
        dm: {
          requestId: r.requestId ?? null,
          situacao: r.requestId ? "processando" : "sem_diagnostico",
          enviadoEm: new Date(agora).toISOString(),
          conferencias: 0,
          avisos: (r.corpo as { fieldWarnings?: unknown } | null)?.fieldWarnings ?? null,
        },
      },
      conferir_em: r.requestId ? new Date(agora + PRIMEIRA_CONFERENCIA_MS).toISOString() : null,
    })
    .eq("id", linha.id);
  return { ok: true };
}

/** Uma passada da fila. Chamado pelo cron. */
export async function drenarFila(limite = 50): Promise<{
  pegos: number;
  enviados: number;
  falharam: number;
  /** Google pela Data Manager esperando as 6 h. Nao e falha. */
  agendados: number;
}> {
  const admin = createAdminClient();
  const { data: linhas } = await admin
    .from("tracking_events")
    .select(
      "id, store_id, destination, destination_id, event_id, event_name, checkout_token, payload, attempts, created_at"
    )
    .eq("status", "pendente")
    .lte("next_attempt_at", new Date().toISOString())
    .order("next_attempt_at", { ascending: true })
    .limit(limite);

  let enviados = 0;
  let falharam = 0;
  let agendados = 0;
  for (const linha of linhas || []) {
    // Uma linha com erro de banco nao pode abortar a rodada: as outras 49 nao
    // tem nada a ver com ela. A linha continua 'pendente' e volta na proxima.
    try {
      const r = await entregar(admin, linha);
      if (r.ok) enviados += 1;
      else if (r.agendado) agendados += 1;
      else falharam += 1;
    } catch (e) {
      console.error("[tracking/drain] falha ao entregar linha", linha.id, e);
      falharam += 1;
    }
  }
  return { pegos: (linhas || []).length, enviados, falharam, agendados };
}

// ============================================================================
// Diagnostico da Data Manager
//
// O envio devolve so o requestId. Se a conversao CONTOU, o Google diz depois,
// pelo requestStatus:retrieve: de 30 min a 24 h. O cron de 10 min confere as
// linhas com `conferir_em` vencido, com espera crescente (30 min, 1 h, 2 h...),
// e so entao marca o resultado em response.dm.situacao:
//
//   ok                 contou (ou ja estava la: transactionId repetido)
//   nao_e_desta_conta  outra conta Google da MESMA loja aceitou o clique
//   sem_consentimento  o visitante recusou; descartar e o certo
//   sem_diagnostico    24 h sem resposta: fica 'enviado', sem confirmacao
//   falhou             recusa de verdade -> status 'falhou', motivo na linha
//
// Sem status novo na constraint da 035: a linha continua 'enviado' ou vira
// 'falhou', que e o que painel, alertas e expurgo ja entendem.
// ============================================================================

interface SituacaoDm {
  requestId?: string | null;
  situacao?: string;
  enviadoEm?: string;
  conferencias?: number;
  motivo?: string;
  [campo: string]: unknown;
}

interface LinhaConferida {
  id: string;
  store_id: string;
  event_id: string;
  attempts: number | null;
  sent_at: string | null;
  response: { dm?: SituacaoDm } | null;
}

/** Espera de quem nao achou o clique enquanto a conta irma nao responde. */
const ESPERA_DA_IRMA_MS = 60 * 60 * 1000;

async function conferirUma(
  admin: ReturnType<typeof createAdminClient>,
  linha: LinhaConferida,
  agora: number
): Promise<string> {
  const dm: SituacaoDm = linha.response?.dm ?? {};
  const enviadoMs = Date.parse(dm.enviadoEm || linha.sent_at || "");
  const prazoEsgotado =
    !Number.isFinite(enviadoMs) || agora - enviadoMs > PRAZO_DO_DIAGNOSTICO_MS;
  const conferencias = (Number(dm.conferencias) || 0) + 1;

  const gravar = async (campos: Record<string, unknown>, novo: Partial<SituacaoDm>) => {
    await admin
      .from("tracking_events")
      .update({
        ...campos,
        response: {
          ...(linha.response ?? {}),
          dm: { ...dm, ...novo, conferencias, conferidoEm: new Date(agora).toISOString() },
        },
      })
      .eq("id", linha.id);
  };
  const desistirDeConferir = async (motivo?: string) => {
    await gravar({ conferir_em: null }, { situacao: "sem_diagnostico", ...(motivo ? { motivo } : {}) });
    return "sem_diagnostico";
  };

  if (!dm.requestId) return desistirDeConferir();

  let desfecho: ReturnType<typeof lerDiagnostico>;
  if (dm.situacao === "clique_nao_achado") {
    // O Google ja respondeu; falta so saber se uma irma aceitou.
    desfecho = { tipo: "clique_de_outra_conta", motivo: dm.motivo || "o Google não achou o clique" };
  } else {
    const { consultarEnvio } = await import("@/lib/tracking/google-dm");
    const r = await consultarEnvio(dm.requestId);
    if (!r.ok) {
      // Rede ou credencial: a resposta do Google continua la para ler depois.
      if (prazoEsgotado) return desistirDeConferir(r.erro);
      await gravar({ conferir_em: proximaConferenciaEm(conferencias, agora).toISOString() }, {
        motivo: r.erro,
      });
      return "aguardando";
    }
    desfecho = lerDiagnostico(r.corpo);
  }

  switch (desfecho.tipo) {
    case "ok":
      await gravar({ conferir_em: null, last_error: desfecho.aviso ?? null }, { situacao: "ok" });
      return "ok";

    case "esperar":
      if (prazoEsgotado) return desistirDeConferir();
      await gravar({ conferir_em: proximaConferenciaEm(conferencias, agora).toISOString() }, {});
      return "aguardando";

    case "reenviar": {
      // TOO_RECENT_CLICK: nao entrou, entao reenviar com o mesmo transactionId
      // nao duplica. Volta para a fila 6 h para frente.
      const acabou = (linha.attempts ?? 0) >= MAX_TENTATIVAS;
      await gravar(
        {
          status: acabou ? "falhou" : "pendente",
          conferir_em: null,
          next_attempt_at: new Date(agora + ESPERA_DO_CLIQUE_MS).toISOString(),
          last_error: desfecho.motivo,
        },
        { situacao: acabou ? "falhou" : "reenviar", motivo: desfecho.motivo }
      );
      return acabou ? "falhou" : "reenviar";
    }

    case "sem_consentimento":
      await gravar(
        { conferir_em: null, last_error: desfecho.motivo },
        { situacao: "sem_consentimento", motivo: desfecho.motivo }
      );
      return "sem_consentimento";

    case "clique_de_outra_conta": {
      const { data: irmas, error } = await admin
        .from("tracking_events")
        .select("status, response")
        .eq("store_id", linha.store_id)
        .eq("destination", "google")
        .eq("event_id", linha.event_id)
        .neq("id", linha.id);
      if (error) throw new Error(`falha ao ler as contas irmãs: ${error.message}`);

      const decisao = decidirCliqueDeOutraConta(
        (irmas || []).map((i) => ({
          status: String(i.status),
          situacao: ((i.response as { dm?: SituacaoDm } | null)?.dm?.situacao as string) ?? null,
        })),
        prazoEsgotado
      );
      if (decisao === "nao_e_desta_conta") {
        await gravar(
          { conferir_em: null, last_error: "clique de outra conta Google desta loja" },
          { situacao: "nao_e_desta_conta", motivo: desfecho.motivo }
        );
        return "nao_e_desta_conta";
      }
      if (decisao === "esperar") {
        await gravar(
          { conferir_em: new Date(agora + ESPERA_DA_IRMA_MS).toISOString() },
          { situacao: "clique_nao_achado", motivo: desfecho.motivo }
        );
        return "aguardando";
      }
      await gravar(
        { status: "falhou", conferir_em: null, last_error: desfecho.motivo.slice(0, 500) },
        { situacao: "falhou", motivo: desfecho.motivo }
      );
      return "falhou";
    }

    case "falhou":
      await gravar(
        { status: "falhou", conferir_em: null, last_error: desfecho.motivo.slice(0, 500) },
        { situacao: "falhou", motivo: desfecho.motivo }
      );
      return "falhou";
  }
}

/** Uma passada de diagnostico. Chamado pelo cron, depois de drenar a fila. */
export async function conferirDiagnosticos(
  limite = 20
): Promise<{ conferidos: number; desfechos: Record<string, number> }> {
  const admin = createAdminClient();
  const agora = Date.now();
  const { data, error } = await admin
    .from("tracking_events")
    .select("id, store_id, event_id, attempts, sent_at, response")
    .lte("conferir_em", new Date(agora).toISOString())
    .order("conferir_em", { ascending: true })
    .limit(limite);
  // Antes da migration 054 a coluna nao existe. Quem chama trata o erro sem
  // derrubar a drenagem, que ja rodou.
  if (error) throw new Error(`falha ao ler os diagnosticos: ${error.message}`);

  const desfechos: Record<string, number> = {};
  for (const linha of (data || []) as LinhaConferida[]) {
    try {
      const d = await conferirUma(admin, linha, agora);
      desfechos[d] = (desfechos[d] ?? 0) + 1;
    } catch (e) {
      console.error("[tracking/drain] falha ao conferir diagnostico", linha.id, e);
      desfechos.erro = (desfechos.erro ?? 0) + 1;
    }
  }
  return { conferidos: (data || []).length, desfechos };
}
