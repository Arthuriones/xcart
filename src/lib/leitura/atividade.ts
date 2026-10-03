import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { filtroResolvido, listarLojasDoUsuario } from "@/lib/filtro-global";
import { TODAS } from "@/lib/financeiro/tipos";
import {
  LIMITE_PAGINA,
  MOTIVOS_CARRINHO,
  ateOCursor,
  fontesVazias,
  montarContexto,
  montarEventos,
  paginar,
  rotasDaLoja,
  type EventoAtividade,
  type LinhaAlerta,
  type LinhaCarrinho,
  type LinhaClone,
  type LinhaCompra,
  type LinhaDestino,
  type LinhaJob,
  type LinhaLoja,
  type LinhaRastreamento,
  type LinhaRota,
  type TipoAtividade,
} from "./atividade-regras";

// ============================================================================
// Leitura da tela Atividade (redesign). So leitura, pela sessao (RLS), e
// sempre com user_id explicito onde a tabela tem a coluna.
//
// Diferente de src/lib/activity/queries.ts (que fica como esta), cada fonte
// devolve o proprio erro: a que falhou entra em `falhas` e a tela avisa
// "parte nao veio", em vez de mostrar a conta vazia. E pagina por cursor
// (?antes=), sem o teto fixo de 40.
//
// Rotas e destinos sao poucos e sao lidos inteiros: dao nome a vitrine e a
// loja de checkout de cada carrinho e decidem o filtro de loja. As outras
// fontes leem no maximo LIMITE_PAGINA linhas ate o cursor.
// ============================================================================

export interface PaginaAtividade {
  itens: EventoAtividade[];
  /** Cursor da proxima pagina; null = nao ha nada mais antigo. */
  proximo: string | null;
  /** Fontes que nao vieram, em palavras ("importações", "alertas"). */
  falhas: string[];
  /** Instante da leitura (ms): base do "há 5 min" sem divergir na hidratacao. */
  agora: number;
}

export interface LeituraAtividade extends PaginaAtividade {
  lojas: { id: string; nome: string }[];
  /** Loja do filtro global, ja conferida, ou TODAS. */
  lojaId: string;
  temRota: boolean;
  tipo: TipoAtividade | null;
}

export interface PedidoAtividade {
  tipo: TipoAtividade | null;
  antes: string | null;
  /**
   * Loja da primeira pagina, para as seguintes seguirem a mesma lista mesmo
   * que o filtro mude em outra aba. Sem ela, vale o filtro global (cookie).
   */
  lojaId?: string;
}

/** Limite das fontes lidas inteiras. Passar disso so corta nome, nunca evento. */
const MAX_ROTAS = 500;
const MAX_DESTINOS = 2000;

type Linhas<T> = { linhas: T[]; erro: boolean; cheia: boolean };

async function ler<T>(
  rotulo: string,
  consulta: PromiseLike<{ data: unknown; error: { message?: string } | null }>,
  limite = LIMITE_PAGINA
): Promise<Linhas<T>> {
  try {
    const { data, error } = await consulta;
    if (error) {
      console.error(`[leitura/atividade] ${rotulo}:`, error.message);
      return { linhas: [], erro: true, cheia: false };
    }
    const linhas = (Array.isArray(data) ? data : []) as T[];
    return { linhas, erro: false, cheia: linhas.length >= limite };
  } catch (e) {
    console.error(`[leitura/atividade] ${rotulo}:`, e);
    return { linhas: [], erro: true, cheia: false };
  }
}

const NADA: Linhas<never> = { linhas: [], erro: false, cheia: false };

/** Erro de banco na lista de lojas LANCA: sem nomes nao ha linha do tempo honesta. */
export async function lerAtividade(pedido: PedidoAtividade): Promise<LeituraAtividade> {
  const agora = Date.now();
  const { tipo, antes } = pedido;

  let lojasBrutas: { id: string; nome: string }[];
  let lojaId: string;
  if (pedido.lojaId === undefined) {
    const r = await filtroResolvido();
    lojasBrutas = r.lojas;
    lojaId = r.filtro.lojaId;
  } else {
    lojasBrutas = await listarLojasDoUsuario();
    lojaId = lojasBrutas.some((l) => l.id === pedido.lojaId) ? pedido.lojaId : TODAS;
  }
  const lojas = lojasBrutas.map((l) => ({ id: l.id, nome: l.nome }));

  const leitura: LeituraAtividade = {
    itens: [],
    proximo: null,
    falhas: [],
    agora,
    lojas,
    lojaId,
    temRota: false,
    tipo,
  };

  const user = await getCurrentUser();
  if (!user) return leitura;

  const supabase = await createClient();
  const umaLoja = lojaId !== TODAS ? lojaId : null;
  const quer = (t: TipoAtividade) => tipo === null || tipo === t;
  const N = LIMITE_PAGINA;

  // --- Rotas, destinos e carrinhos: em cadeia (os carrinhos pedem os ids).
  const cadeiaRotas = async () => {
    const rotas = await ler<LinhaRota>(
      "rotas",
      supabase
        .from("routed_checkout_configs")
        .select("id, source_store_id, target_store_id, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(MAX_ROTAS),
      MAX_ROTAS
    );
    const idsTodas = rotas.linhas.map((r) => r.id);
    const destinos = idsTodas.length
      ? await ler<LinhaDestino>(
          "destinos",
          supabase
            .from("routed_checkout_targets")
            .select("id, route_id, target_store_id, created_at")
            .in("route_id", idsTodas)
            .order("created_at", { ascending: false })
            .limit(MAX_DESTINOS),
          MAX_DESTINOS
        )
      : NADA;

    const daLoja = umaLoja ? rotasDaLoja(rotas.linhas, destinos.linhas, umaLoja) : null;
    const idsCarrinho = daLoja ? idsTodas.filter((id) => daLoja.has(id)) : idsTodas;

    let carrinhos: Linhas<LinhaCarrinho> = NADA;
    if (quer("carrinho") && idsCarrinho.length) {
      let q = supabase
        .from("routed_checkout_fallbacks")
        .select("id, route_config_id, target_id, reason, detail, created_at")
        .in("route_config_id", idsCarrinho)
        .in("reason", [...MOTIVOS_CARRINHO]);
      if (antes) q = q.lte("created_at", antes);
      carrinhos = await ler<LinhaCarrinho>("carrinhos", q.order("created_at", { ascending: false }).limit(N));
    } else if (quer("carrinho") && rotas.erro) {
      carrinhos = { linhas: [], erro: true, cheia: false };
    }
    return { rotas, destinos, daLoja, carrinhos };
  };

  const lerLojas = () => {
    if (!quer("loja")) return Promise.resolve(NADA as Linhas<LinhaLoja>);
    let q = supabase.from("stores").select("id, name, shop_domain, created_at").eq("user_id", user.id);
    if (umaLoja) q = q.eq("id", umaLoja);
    if (antes) q = q.lte("created_at", antes);
    return ler<LinhaLoja>("lojas", q.order("created_at", { ascending: false }).limit(N));
  };

  const lerClones = () => {
    if (!quer("importacao")) return Promise.resolve(NADA as Linhas<LinhaClone>);
    let q = supabase
      .from("clone_runs")
      .select("id, source_domain, target_store_id, action, status, product_count, created_at")
      .eq("user_id", user.id);
    if (umaLoja) q = q.eq("target_store_id", umaLoja);
    if (antes) q = q.lte("created_at", antes);
    return ler<LinhaClone>("importações", q.order("created_at", { ascending: false }).limit(N));
  };

  const lerJobs = () => {
    if (!quer("importacao")) return Promise.resolve(NADA as Linhas<LinhaJob>);
    // So o link de origem sai do progress: o resto (prompt, opcoes) nao vem.
    let q = supabase
      .from("background_jobs")
      .select("id, store_id, status, created_at, origem:progress->>source")
      .eq("user_id", user.id)
      .eq("type", "bulk_import");
    if (umaLoja) q = q.eq("store_id", umaLoja);
    if (antes) q = q.lte("created_at", antes);
    return ler<LinhaJob>("importações em lote", q.order("created_at", { ascending: false }).limit(N));
  };

  const lerAlertas = (coluna: "aberto_em" | "resolvido_em") => {
    if (!quer("alerta")) return Promise.resolve(NADA as Linhas<LinhaAlerta>);
    let q = supabase
      .from("alertas")
      .select("id, store_id, severidade, titulo, aberto_em, resolvido_em")
      .eq("user_id", user.id);
    if (coluna === "resolvido_em") q = q.not("resolvido_em", "is", null);
    if (umaLoja) q = q.eq("store_id", umaLoja);
    if (antes) q = q.lte(coluna, antes);
    return ler<LinhaAlerta>("alertas", q.order(coluna, { ascending: false }).limit(N));
  };

  const lerRastreamento = () => {
    if (!quer("rastreamento")) return Promise.resolve(NADA as Linhas<LinhaRastreamento>);
    let q = supabase
      .from("tracking_destinations")
      .select("id, store_id, plataforma, nome, ativo, created_at")
      .eq("user_id", user.id);
    if (umaLoja) q = q.eq("store_id", umaLoja);
    if (antes) q = q.lte("created_at", antes);
    return ler<LinhaRastreamento>("rastreamento", q.order("created_at", { ascending: false }).limit(N));
  };

  const lerCompras = () => {
    // Compra e da conta, nao de uma loja: com o filtro de loja, fica de fora.
    if (!quer("creditos") || umaLoja) return Promise.resolve(NADA as Linhas<LinhaCompra>);
    let q = supabase
      .from("credit_purchases")
      .select("id, kind, status, method, credits, amount_cents, currency, created_at")
      .eq("user_id", user.id);
    if (antes) q = q.lte("created_at", antes);
    return ler<LinhaCompra>("créditos", q.order("created_at", { ascending: false }).limit(N));
  };

  const [rotaria, lojasR, clones, jobs, abertos, resolvidos, rastreamento, compras] = await Promise.all([
    cadeiaRotas(),
    lerLojas(),
    lerClones(),
    lerJobs(),
    lerAlertas("aberto_em"),
    lerAlertas("resolvido_em"),
    lerRastreamento(),
    lerCompras(),
  ]);

  const { rotas, destinos, daLoja, carrinhos } = rotaria;
  leitura.temRota = rotas.linhas.length > 0;
  const ctx = montarContexto(lojas, rotas.linhas, destinos.linhas);

  // Rotas e destinos foram lidos inteiros: o cursor e o filtro de loja valem
  // aqui. Destino da loja: ela entrou no rodizio, ou e a vitrine da rota.
  const rotasNaPagina = quer("rota")
    ? rotas.linhas.filter((r) => ateOCursor(r.created_at, antes) && (!daLoja || daLoja.has(r.id)))
    : [];
  const destinosNaPagina = quer("rota")
    ? destinos.linhas.filter(
        (d) =>
          ateOCursor(d.created_at, antes) &&
          (!umaLoja || d.target_store_id === umaLoja || ctx.vitrineDaRota.get(d.route_id) === umaLoja)
      )
    : [];

  const fontes = fontesVazias();
  fontes.lojas = lojasR.linhas;
  fontes.rotas = rotasNaPagina;
  fontes.destinos = destinosNaPagina;
  fontes.carrinhos = carrinhos.linhas;
  fontes.clones = clones.linhas;
  fontes.jobs = jobs.linhas;
  fontes.alertasAbertos = abertos.linhas;
  fontes.alertasResolvidos = resolvidos.linhas;
  fontes.rastreamento = rastreamento.linhas;
  fontes.compras = compras.linhas;

  const eventos = montarEventos(fontes, ctx);
  const cheia = [lojasR, carrinhos, clones, jobs, abertos, resolvidos, rastreamento, compras].some((r) => r.cheia);
  const { itens, proximo } = paginar(eventos, N, cheia);

  const falhas: string[] = [];
  if (lojasR.erro) falhas.push("lojas");
  if (quer("rota") && (rotas.erro || destinos.erro)) falhas.push("rotas");
  if (carrinhos.erro) falhas.push("carrinhos");
  if (clones.erro || jobs.erro) falhas.push("importações");
  if (abertos.erro || resolvidos.erro) falhas.push("alertas");
  if (rastreamento.erro) falhas.push("rastreamento");
  if (compras.erro) falhas.push("créditos");

  leitura.itens = itens;
  leitura.proximo = proximo;
  leitura.falhas = falhas;
  return leitura;
}
