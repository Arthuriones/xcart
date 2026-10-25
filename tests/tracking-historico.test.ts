import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { RETENCAO_EVENTOS_MS } from "@/lib/leitura/pedidos";
import {
  EVENTOS,
  JANELA_CHECKOUT_EXPRESSO_MS,
  PREFIXO_CHECKOUT_EXPRESSO,
  PREFIXO_RESERVA_DO_CHECKOUT,
  PREFIXOS_DE_RESERVA,
  idDaReservaDoCheckout,
  idDoCheckoutExpresso,
  idDoEventoDeNavegador,
  idDoEventoDoCheckout,
} from "@/lib/tracking/eventos";
import { naJanela } from "@/lib/tracking/origem-pedido";
import { idDoCheckoutDeGarantia } from "@/lib/tracking/purchase";
import { CAMPOS_DO_RESUMO, EVENTOS_DO_DIARIO, RETENCAO } from "@/lib/tracking/retencao";
import { urlSemTtclid } from "@/lib/tracking/tiktok-evento";
import {
  CORTE_PAGINA,
  FONTES_META,
  JANELA_ORIGEM_MS,
  MAX_VALOR_UTM,
  PARAMETROS_URL,
  cliquesDeParametros,
  idDe,
  limparValor,
  niveisDoAnuncio,
  parametrosDaUrl,
  plataformaDe,
  utmDeParametros,
} from "@/lib/tracking/utm";

// ============================================================================
// Fila curta + historico de 12 meses (migration 079).
//
// Sem banco aqui: trava o SQL da 079 contra as regras do TS que ele espelha,
// e trava que nenhum leitor de linha velha da fila le do payload uma chave que
// o resumo dos 8 dias tira. O SQL rodou contra producao so com SELECT em
// 24/10/2026 (uma linha por evento nas 15.564 da fila, resumo igual ao
// payload em todo campo lido nas 45.747 linhas, ids de anuncio iguais aos do
// TS nas 66 UTMs distintas da identidade). As partes SELECT da revisao (a
// reserva cancelada, os dias presos e a juncao do volume no dia) tambem, em
// 24/10: 3 reservas canceladas; 11.491 eventos de volume viram 42 linhas do dia.
//
// A 080 recria o tracking_arquivar (a campanha do funil sai da URL do proprio
// evento, e o trio e um bloco): toda trava dele le a definicao EM VIGOR
// (vigente), e a secao 5 trava a leitura da URL contra o TS.
// ============================================================================

const RAIZ = path.resolve(__dirname, "..");
const PASTA = path.join(RAIZ, "supabase", "migrations");
const MIGRATIONS = readdirSync(PASTA)
  .filter((f) => f.endsWith(".sql"))
  .sort();
const ler = (f: string) => readFileSync(path.join(PASTA, f), "utf8");
const DIA_MS = 864e5;

/** Sem comentario de linha e com espaco normalizado. */
function limpo(sql: string): string {
  return sql
    .split(/\r?\n/)
    .map((l) => l.replace(/--.*$/, ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

const SQL_079 = ler("079_rastreamento_historico.sql");
const SQL = limpo(SQL_079);

/** O corpo ($$ ... $$) da definicao de `nome` em `sql` (ja limpo). */
function corpoDe(sql: string, nome: string): string {
  const inicio = sql.search(new RegExp(`create or replace function public\\.${nome}\\(`, "i"));
  expect(inicio, nome).toBeGreaterThanOrEqual(0);
  const abre = sql.indexOf("$$", inicio);
  const fecha = sql.indexOf("$$", abre + 2);
  return sql.slice(abre + 2, fecha);
}

/** A definicao EM VIGOR: a da ultima migration que recria a funcao. */
function vigente(nome: string): { arquivo: string; corpo: string } {
  const re = new RegExp(`create or replace function public\\.${nome}\\s*\\(`, "i");
  const arquivo = [...MIGRATIONS].reverse().find((f) => re.test(limpo(ler(f))));
  expect(arquivo, nome).toBeDefined();
  return { arquivo: arquivo!, corpo: corpoDe(limpo(ler(arquivo!)), nome) };
}

/** Os caminhos lidos do payload num trecho SQL: "teste", "user_data.fbc"... */
function caminhosSql(sql: string): Set<string> {
  const saida = new Set<string>();
  const re = /\b(?:\w+\.)?p?_?payload\s*->>?\s*'(\w+)'(?:\s*->>?\s*'(\w+)')?/g;
  for (let m = re.exec(sql); m; m = re.exec(sql)) saida.add(m[2] ? `${m[1]}.${m[2]}` : m[1]);
  return saida;
}

const RESUMO = new Set<string>(CAMPOS_DO_RESUMO);

// ---------------------------------------------------------------------------
// 1. O expurgo: os prazos e a ordem
// ---------------------------------------------------------------------------

describe("purge_tracking (079): fila curta", () => {
  const { arquivo, corpo } = vigente("purge_tracking");

  it("a definicao em vigor e a da 079", () => {
    expect(arquivo).toBe("079_rastreamento_historico.sql");
  });

  it("funil entregue sai aos 14 dias, menos o id por checkout", () => {
    const m = corpo.match(
      /delete from public\.tracking_events where store_id = any \(v_lojas\) and status = 'enviado' and lower\(event_name\) <> 'purchase' and position\('_ck_' in event_id\) = 0 and created_at < now\(\) - interval '(\d+) days'/
    );
    expect(Number(m?.[1])).toBe(RETENCAO.funilDias);
    expect(RETENCAO.funilDias).toBe(14);
  });

  it("Purchase entregue e o id por checkout ficam 90 dias, o prazo do 'sem_registro' da tela Pedidos", () => {
    const m = corpo.match(
      /delete from public\.tracking_events where store_id = any \(v_lojas\) and status = 'enviado' and \(lower\(event_name\) = 'purchase' or position\('_ck_' in event_id\) > 0\) and created_at < now\(\) - interval '(\d+) days'/
    );
    expect(Number(m?.[1])).toBe(RETENCAO.compraDias);
    expect(RETENCAO_EVENTOS_MS).toBe(RETENCAO.compraDias * DIA_MS);
    // Os dois DELETE do 'enviado' se completam: todo evento entregue sai por um deles.
    expect(corpo.match(/delete from public\.tracking_events where store_id = any \(v_lojas\) and status = 'enviado'/g)).toHaveLength(2);
  });

  // Um IC (e um AddPaymentInfo) por checkout e o indice unico da fila sobre o
  // `<evento>_ck_<token>`. Apagado aos 14 dias, o comprador que volta ao mesmo
  // checkout mandava um 2o IC com o mesmo event_id, fora das 48 h de dedupe do
  // Meta -- e o IC de garantia da compra por Shop Pay nesse checkout tambem saia.
  it("o marcador do id por checkout e o de idDoEventoDoCheckout, e so ele o tem", () => {
    const marcador = corpo.match(/position\('(\w+)' in event_id\) = 0/)?.[1];
    expect(marcador).toBe("_ck_");
    expect(corpo.match(/position\('(\w+)' in event_id\) > 0/)?.[1]).toBe(marcador);
    const contem = (id: string) => id.includes(marcador!);
    const chaves = EVENTOS.map((e) => e.chave);
    // O formato do _xc_vid do tema (base36 "." base36) e o token do checkout.
    const vid = fc.tuple(fc.stringMatching(/^[a-z0-9]{1,12}$/), fc.stringMatching(/^[a-z0-9]{1,10}$/)).map(([a, b]) => `${a}.${b}`);
    const token = fc.string({ minLength: 1, maxLength: 120 }).filter((t) => t.trim().length > 0);
    fc.assert(
      fc.property(fc.constantFrom(...chaves), token, vid, fc.nat(), (chave, tok, v, ms) => {
        // O pixel (coletor) e o IC de garantia (webhook): o mesmo id, sempre marcado.
        expect(contem(idDoEventoDoCheckout(chave, tok.trim().slice(0, 120)))).toBe(true);
        expect(contem(idDoCheckoutDeGarantia({ id: ms, checkout_token: tok }))).toBe(true);
        // Tema, reservas e garantia sem checkout (app de COD): sem marca, saem aos 14.
        expect(contem(idDoEventoDeNavegador(chave, v, ms))).toBe(false);
        expect(contem(idDoCheckoutExpresso(v, ms))).toBe(false);
        expect(contem(idDaReservaDoCheckout(v, ms))).toBe(false);
        expect(contem(idDoCheckoutDeGarantia({ id: ms, checkout_token: null }))).toBe(false);
      }),
      { numRuns: 2000 }
    );
  });

  it("falhou/pendente: os 30 dias de antes, e o resumo nunca encosta neles", () => {
    const m = corpo.match(
      /delete from public\.tracking_events where store_id = any \(v_lojas\) and status in \('falhou', 'pendente'\) and created_at < now\(\) - interval '(\d+) days'/
    );
    expect(Number(m?.[1])).toBe(RETENCAO.naoSaiuDias);
    expect(RETENCAO.naoSaiuDias).toBe(30);
    // O UPDATE do resumo e o unico UPDATE, e so pega a Purchase ENVIADA.
    const updates = corpo.match(/update public\.tracking_events[^;]*;/g) ?? [];
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatch(/e\.status = 'enviado'/);
    expect(updates[0]).toMatch(/lower\(e\.event_name\) = 'purchase'/);
    expect(updates[0]).not.toMatch(/falhou|pendente/);
  });

  it("o payload da Purchase entregue vira o resumo aos 8 dias, so depois de arquivada", () => {
    const update = corpo.match(/update public\.tracking_events[^;]*;/)?.[0] ?? "";
    expect(update).toMatch(/set payload = public\.tracking_payload_resumo\(e\.payload\)/);
    expect(Number(update.match(/created_at < now\(\) - interval '(\d+) days'/)?.[1])).toBe(RETENCAO.resumoDaCompraDias);
    // Sem UPDATE vazio toda hora: so o que ainda nao e resumo.
    expect(update).toMatch(/e\.payload is distinct from public\.tracking_payload_resumo\(e\.payload\)/);
    // O valor e a campanha saem do payload inteiro: so resume o que ja esta no historico.
    expect(update).toMatch(
      /exists \(select 1 from public\.tracking_historico h where h\.store_id = e\.store_id and h\.chave = md5\(e\.event_id\)::uuid\)/
    );
    // O Meta recusa evento com mais de 7 dias: depois disso o payload inteiro nao volta a sair.
    expect(RETENCAO.resumoDaCompraDias).toBeGreaterThan(7);
  });

  it("o historico guarda 12 meses, por evento e por dia", () => {
    expect(corpo).toMatch(
      new RegExp(
        `delete from public\\.tracking_historico where store_id = any \\(v_lojas\\) and instante < now\\(\\) - interval '${RETENCAO.historicoMeses} months'`
      )
    );
    expect(corpo).toMatch(
      new RegExp(
        `delete from public\\.tracking_historico_diario where store_id = any \\(v_lojas\\) and dia < \\(now\\(\\) - interval '${RETENCAO.historicoMeses} months'\\)::date`
      )
    );
  });

  it("junta o funil de volume no dia DEPOIS dos DELETE da fila e antes do prazo do historico", () => {
    const juntar = corpo.indexOf("perform public.tracking_compactar_funil();");
    expect(juntar).toBeGreaterThan(corpo.lastIndexOf("delete from public.tracking_events"));
    expect(juntar).toBeGreaterThan(corpo.indexOf("update public.tracking_events"));
    expect(juntar).toBeLessThan(corpo.indexOf("delete from public.tracking_historico "));
    expect(corpo.match(/tracking_compactar_funil/g)).toHaveLength(1);
  });

  it("arquiva ANTES de qualquer DELETE: o recente e tudo que pode sair agora", () => {
    const arquivar = corpo.indexOf("perform public.tracking_arquivar(");
    const primeiroDelete = corpo.indexOf("delete from public.tracking_events");
    expect(arquivar).toBeGreaterThanOrEqual(0);
    expect(arquivar).toBeLessThan(primeiroDelete);
    expect(corpo).toMatch(/perform public\.tracking_arquivar\(now\(\) - interval '48 hours', null\)/);
    // A passada de antes do DELETE cobre o MENOR prazo de saida da fila.
    const ate = Number(corpo.match(/perform public\.tracking_arquivar\(null, now\(\) - interval '(\d+) days'\)/)?.[1]);
    expect(ate).toBe(Math.min(RETENCAO.funilDias, RETENCAO.compraDias, RETENCAO.naoSaiuDias));
  });

  it("identidade: o prazo nao muda (decisao pendente)", () => {
    expect(corpo).toMatch(/delete from public\.tracking_identities where expires_at < now\(\);/);
    expect(corpo.match(/tracking_identities/g)).toHaveLength(1);
  });

  it("SECURITY DEFINER, so o service_role executa", () => {
    const def = SQL.match(/create or replace function public\.purge_tracking\(\)([^$]*)as \$\$/)?.[1] ?? "";
    expect(def).toMatch(/security definer/);
    expect(def).toMatch(/set search_path = public, pg_temp/);
    expect(SQL).toContain("revoke all on function public.purge_tracking() from public, anon, authenticated;");
    expect(SQL).toContain("grant execute on function public.purge_tracking() to service_role;");
  });
});

// ---------------------------------------------------------------------------
// 2. O historico: uma linha por evento, sem dado pessoal
// ---------------------------------------------------------------------------

describe("tracking_historico (079): uma linha por evento, sem dado pessoal", () => {
  const tabela = SQL.match(/create table if not exists public\.tracking_historico \((.*?)\); comment on table/)?.[1] ?? "";
  const colunas = tabela
    .split(/,(?![^()]*\))/)
    .map((c) => c.trim().split(" ")[0])
    .filter((c) => c && c !== "primary");
  const arquivar = vigente("tracking_arquivar").corpo;

  it("as colunas sao so as do relatorio", () => {
    expect(colunas).toEqual([
      "store_id",
      "user_id",
      "chave",
      "visitante",
      "instante",
      "teste",
      "com_clique",
      "evento",
      "fonte",
      "campanha_id",
      "conjunto_id",
      "anuncio_id",
      "pedido_id",
      "valor",
      "moeda",
      "destinos",
      "nao_enviados",
    ]);
    expect(tabela).toMatch(/primary key \(store_id, chave\)/);
  });

  it("nenhuma coluna de payload, contato, rede ou click id", () => {
    for (const c of colunas) {
      expect(c).not.toMatch(
        /payload|email|phone|telefone|nome|endereco|cep|ip|agent|fbc|fbp|fbclid|gclid|gbraid|wbraid|ttclid|ttp|token|referrer|event_id|visitor_id|client/
      );
    }
  });

  it("uma linha por (loja, event_id): o agrupamento, a chave e o conflito batem", () => {
    expect(arquivar).toMatch(/from linhas l where not l\.cancelada group by l\.store_id, l\.event_id/);
    expect(arquivar).toMatch(/md5\(ev\.event_id\)::uuid as chave/);
    expect(arquivar).toMatch(/on conflict \(store_id, chave\) do update/);
    // Linha igual nao e regravada: a passada das 48 h le as mesmas linhas toda hora.
    expect(arquivar).toMatch(/where \(h\.visitante, .*?\) is distinct from \(excluded\.visitante,/);
  });

  it("o visitante e o event_id so entram como hash", () => {
    expect(arquivar).toMatch(/case when ev\.visitor_id is not null then md5\(ev\.visitor_id\)::uuid end as visitante/);
    const insert = arquivar.match(/insert into public\.tracking_historico as h \(([^)]*)\)/)?.[1] ?? "";
    expect(insert.split(",").map((c) => c.trim())).toEqual(colunas);
  });

  it("do payload, so a marca de teste, o click id (como booleano), o valor da compra e a URL da pagina", () => {
    const lidos = caminhosSql(arquivar);
    // A URL da pagina (080): a campanha do funil sai dela. As tres chaves estao
    // no resumo, entao valem tambem sobre o payload resumido.
    const urls = ["event_source_url", "page.url", "pageUrl"];
    for (const c of urls) {
      expect(lidos.has(c), c).toBe(true);
      expect(RESUMO.has(c), c).toBe(true);
    }
    const permitidos = new Set([
      ...urls,
      "user_data.fbc",
      "gclid",
      "gbraid",
      "wbraid",
      "user.ttclid",
      "custom_data.value",
      "custom_data.currency",
      "properties.value",
      "properties.currency",
      "value",
      "currency",
    ]);
    expect([...lidos].filter((c) => !permitidos.has(c))).toEqual([]);
    // O click id vira com_clique: nenhum valor dele vai para coluna.
    expect(arquivar).toMatch(/end\), false\) as com_clique/);
    // A marca de teste pela regra unica (055/059).
    expect(arquivar).toContain("public.tracking_evento_teste(l.destination, l.payload)");
    expect(arquivar).not.toMatch(/client_ip_address|client_user_agent|email_sha256|phone_sha256|ip_hash|fbclid|\bfbp\b|\bttp\b/);
  });

  it("da identidade, so a UTM do clique e as chaves do visitante", () => {
    const colunasDaIdentidade = new Set([...arquivar.matchAll(/\bi\.(\w+)/g)].map((m) => m[1]));
    expect([...colunasDaIdentidade].sort()).toEqual(["shopify_client_id", "store_id", "utm", "utm_em", "visitor_id"]);
  });

  it("a loja de demonstracao fica de fora", () => {
    expect(arquivar).toMatch(/with lojas as \( select s\.id, s\.user_id from public\.stores s where not s\.demonstracao \)/);
    expect(arquivar).toMatch(/e\.store_id = any \(array\(select l\.id from lojas l\)\)/);
  });

  it("o backfill roda a fila inteira, antes do expurgo novo existir", () => {
    const backfill = SQL.indexOf("select public.tracking_arquivar(null, null);");
    expect(backfill).toBeGreaterThan(SQL.indexOf("create or replace function public.tracking_arquivar("));
    expect(backfill).toBeLessThan(SQL.indexOf("create or replace function public.purge_tracking("));
  });

  it("RLS: o dono so le; ninguem escreve pela sessao (por evento e por dia)", () => {
    for (const tabela of ["tracking_historico", "tracking_historico_diario"]) {
      expect(SQL).toContain(`alter table public.${tabela} enable row level security;`);
      const policies = SQL.match(new RegExp(`create policy "[^"]+" on public\\.${tabela} [^;]*;`, "g")) ?? [];
      expect(policies, tabela).toHaveLength(1);
      expect(policies[0]).toMatch(/for select to authenticated using \(\(select auth\.uid\(\)\) = user_id\)/);
      expect(SQL).toContain(`revoke all on table public.${tabela} from public, anon, authenticated;`);
      expect(SQL).toContain(`grant select on table public.${tabela} to authenticated;`);
    }
    expect(SQL.match(/create policy /g)).toHaveLength(2);
    expect(SQL).not.toMatch(/grant (insert|update|delete|all)[^;]*tracking_historico\w* to (anon|authenticated)/);
  });

  it("as funcoes novas: so o service_role executa", () => {
    for (const assinatura of [
      "tracking_arquivar(timestamptz, timestamptz)",
      "tracking_compactar_funil()",
      "tracking_payload_resumo(jsonb)",
      "tracking_id_de_utm(text)",
    ]) {
      expect(SQL).toContain(`revoke all on function public.${assinatura} from public, anon, authenticated;`);
      expect(SQL).toContain(`grant execute on function public.${assinatura} to service_role;`);
    }
    expect(SQL).not.toMatch(
      /grant execute on function public\.tracking_(arquivar|compactar_funil|payload_resumo|id_de_utm)\([^)]*\) to [^;]*(anon|authenticated)/
    );
  });

  // A reserva que o begin_checkout do pixel cancelou fechava como 'enviado' sem
  // sent_at -- igual, no historico, a reserva que falhou de verdade, e o
  // checkout ficava com dois IC.
  it("a reserva cancelada nao e evento: nao entra, e sai se ja tinha entrado", () => {
    const pred = arquivar.match(/coalesce\((e\.status = 'enviado' and e\.sent_at is null and .*?), false\) as cancelada/)?.[1];
    expect(pred).toBe(
      `e.status = 'enviado' and e.sent_at is null and e.last_error like 'cancelado:%' and (e.event_id like '${PREFIXO_CHECKOUT_EXPRESSO}%' or e.event_id like '${PREFIXO_RESERVA_DO_CHECKOUT}%')`
    );
    // E exatamente o que o coletor grava ao cancelar (fechamentoDoExpresso).
    const coletor = readFileSync(path.join(RAIZ, "src/app/api/tracking/collect/route.ts"), "utf8");
    const fechamento = coletor.match(/const fechamentoDoExpresso = [\s\S]*?\}\);/)?.[0] ?? "";
    expect(fechamento).toMatch(/status: "enviado",\s*sent_at: null,\s*last_error: `cancelado: /);
    // O teste fecha sem sair tambem como 'enviado' sem sent_at, mas sem o
    // last_error: nao e confundido com cancelamento.
    const teste = readFileSync(path.join(RAIZ, "src/lib/tracking/teste.ts"), "utf8");
    expect(teste).not.toMatch(/last_error/);
    // Fora do agrupamento do evento, e o evento todo cancelado sai do historico.
    expect(arquivar).toMatch(
      /cancelados as \( select l\.store_id, md5\(l\.event_id\)::uuid as chave from linhas l group by l\.store_id, l\.event_id having bool_and\(l\.cancelada\) \)/
    );
    expect(arquivar).toMatch(
      /apagados as \( delete from public\.tracking_historico h using cancelados c where h\.store_id = c\.store_id and h\.chave = c\.chave returning 1 \)/
    );
    expect(arquivar).toMatch(/select \(\(select count\(\*\) from gravados\) \+ \(select count\(\*\) from apagados\)\)::integer;\s*$/);
  });

  // O webhook grava a origem com o atributo do carrinho; o sync a troca pela
  // jornada da Shopify 20-30 min depois. A passada da hora ja tinha gravado a
  // primeira, e o coalesce com o gravado a prendia para sempre.
  it("no evento com pedido, a campanha segue a origem do pedido; no funil, o trio gravado vence, inteiro", () => {
    expect(arquivar).toMatch(/o\.shopify_order_id is not null as com_origem/);
    for (const c of ["campanha_id", "conjunto_id", "anuncio_id"]) {
      // Bloco (080): linha gravada com QUALQUER id fica com os tres dela.
      expect(arquivar).toContain(
        `case when n.com_origem then n.${c} when coalesce(a.campanha_id, a.conjunto_id, a.anuncio_id) is not null then a.${c} else n.${c} end`
      );
      expect(arquivar).not.toContain(`coalesce(a.${c}, n.${c})`);
    }
    // O resto continua monotono: valor e moeda saem do payload, que vira resumo aos 8 dias.
    for (const c of ["pedido_id", "valor", "moeda", "visitante", "evento", "fonte"]) {
      expect(arquivar).toContain(`coalesce(a.${c}, n.${c})`);
    }
    // E a origem so vem do pedido: o funil nao tem pedido_id (o lateral da identidade exige null).
    expect(arquivar).toMatch(/left join public\.fin_order_origem o on ev\.pedido_id is not null and/);
    expect(arquivar).toMatch(/where ev\.pedido_id is null and ev\.visitor_id is not null/);
  });

  it("nenhuma mexida nas RPCs da tela (painel e feed seguem as da 059)", () => {
    expect(SQL).not.toMatch(/function public\.tracking_(painel|feed|evento_teste)/);
  });
});

// ---------------------------------------------------------------------------
// 3. O SQL espelha o TS
// ---------------------------------------------------------------------------

describe("079 x TS: as mesmas regras", () => {
  const arquivar = vigente("tracking_arquivar").corpo;

  it("FONTES_META e a mesma lista de utm.ts", () => {
    const lista = arquivar.match(/lower\(btrim\(i\.utm ->> 'source'\)\) in \(([^)]*)\)/)?.[1] ?? "";
    const doSql = lista.split(",").map((v) => v.trim().replace(/^'|'$/g, ""));
    expect(new Set(doSql)).toEqual(new Set(FONTES_META));
  });

  it("o id da UTM (tracking_id_de_utm) e o idDe de utm.ts", () => {
    const corpo = vigente("tracking_id_de_utm").corpo;
    const padrao = corpo.match(/regexp_match\(p_valor, '([^']+)'\)/)?.[1];
    expect(padrao).toBeDefined();
    expect(corpo).toMatch(/case when p_valor !~ '@'/);
    const re = new RegExp(padrao!);
    // O SQL recebe o valor ja limpo (a identidade so guarda o que passou por limparValor).
    const doSql = (v: string | null) => (v === null || v.includes("@") ? null : (re.exec(v)?.[1] ?? null));
    const texto = fc.string({ unit: fc.constantFrom(..."0123456789|| @abcXYZ_-.{}") , maxLength: 40 });
    fc.assert(
      fc.property(texto, (s) => {
        expect(doSql(limparValor(s))).toBe(idDe(s));
      }),
      { numRuns: 3000 }
    );
    for (const [v, esperado] of [
      ["120252304612740441", "120252304612740441"],
      ["Campanha X|120252304612740441", "120252304612740441"],
      ["a|12345|67890", "67890"],
      ["12345|abc", null],
      ["1234", null],
      ["{{campaign.id}}", null],
      ["x@y.com|123456", null],
    ] as const) {
      expect(idDe(v), v).toBe(esperado);
      expect(doSql(limparValor(v)), v).toBe(esperado);
    }
  });

  it("a janela da UTM e a do toque 'identidade' (naJanela): 7 dias antes, 1 depois", () => {
    expect(arquivar).toMatch(/i\.utm_em >= ev\.instante - interval '7 days' and i\.utm_em <= ev\.instante \+ interval '1 day'/);
    expect(JANELA_ORIGEM_MS).toBe(7 * DIA_MS);
    const t = Date.parse("2026-10-20T12:00:00Z");
    expect(naJanela(new Date(t - 7 * DIA_MS).toISOString(), t)).toBe(true);
    expect(naJanela(new Date(t - 7 * DIA_MS - 1).toISOString(), t)).toBe(false);
    expect(naJanela(new Date(t + DIA_MS).toISOString(), t)).toBe(true);
    expect(naJanela(new Date(t + DIA_MS + 1).toISOString(), t)).toBe(false);
  });

  it("a fonte reconhece as reservas pelos prefixos de eventos.ts", () => {
    expect(PREFIXOS_DE_RESERVA).toEqual([PREFIXO_CHECKOUT_EXPRESSO, PREFIXO_RESERVA_DO_CHECKOUT]);
    expect(arquivar).toContain(`when l.event_id like '${PREFIXO_CHECKOUT_EXPRESSO}%' then 'expresso'`);
    expect(arquivar).toContain(`when l.event_id like '${PREFIXO_RESERVA_DO_CHECKOUT}%' then 'reserva'`);
    const fontes = SQL.match(/fonte text not null check \(fonte in \(([^)]*)\)\)/)?.[1] ?? "";
    const permitidas = new Set(fontes.split(",").map((v) => v.trim().replace(/^'|'$/g, "")));
    // Toda fonte que o CASE produz passa no CHECK (senao o expurgo inteiro lancaria).
    const caso = arquivar.match(/case when lower\(min\(l\.event_name\)\) = 'purchase' then 'webhook'.*? end as fonte/)?.[0] ?? "";
    const usadas = [...caso.matchAll(/(?:then|else) '(\w+)'/g)].map((m) => m[1]);
    expect(new Set(usadas)).toEqual(permitidas);
  });

  it("o resumo guarda exatamente CAMPOS_DO_RESUMO", () => {
    const corpo = vigente("tracking_payload_resumo").corpo;
    const raiz = [...corpo.matchAll(/'(\w+)', p_payload -> '(\w+)'(?! ->)/g)].map((m) => {
      expect(m[1]).toBe(m[2]);
      return m[1];
    });
    const aninhados = [
      ...corpo.matchAll(/'(\w+)', case when jsonb_typeof\(p_payload -> '(\w+)' -> '(\w+)'\) = 'string' then jsonb_build_object\('(\w+)', p_payload -> '(\w+)' -> '(\w+)'\) end/g),
    ].map((m) => {
      expect(new Set([m[1], m[2], m[5]]).size).toBe(1);
      expect(new Set([m[3], m[4], m[6]]).size).toBe(1);
      return `${m[1]}.${m[3]}`;
    });
    expect(new Set([...raiz, ...aninhados])).toEqual(RESUMO);
    expect(raiz.length + aninhados.length).toBe(CAMPOS_DO_RESUMO.length);
    expect(corpo).toMatch(/coalesce\(jsonb_strip_nulls\(/);
  });
});

// ---------------------------------------------------------------------------
// 3b. O funil de volume por dia (tracking_historico_diario)
// ---------------------------------------------------------------------------
//
// Uma linha por view_item por 12 meses dava ~50 MB numa loja como a Softnook,
// mais que a meta inteira. O expurgo junta o volume no dia quando nada dele
// pode mais mudar.

/** Os valores de uma lista SQL `('a', 'b')`. */
const valoresSql = (lista: string) => lista.split(",").map((v) => v.trim().replace(/^'|'$/g, ""));

describe("tracking_historico_diario (079): o funil de volume por dia", () => {
  const tabela =
    SQL.match(/create table if not exists public\.tracking_historico_diario \((.*?)\); comment on table/)?.[1] ?? "";
  const colunas = tabela
    .split(/,(?![^()]*\))/)
    .map((c) => c.trim().split(" ")[0])
    .filter((c) => c && c !== "constraint");
  const compactar = vigente("tracking_compactar_funil").corpo;
  const CHAVE = ["store_id", "dia", "evento", "fonte", "campanha_id", "conjunto_id", "anuncio_id"];

  it("as colunas: a chave natural e as contagens, nada do visitante", () => {
    expect(colunas).toEqual([
      "store_id",
      "user_id",
      "dia",
      "eventos",
      "visitantes",
      "com_clique",
      "testes",
      "nao_enviados",
      "evento",
      "fonte",
      "campanha_id",
      "conjunto_id",
      "anuncio_id",
    ]);
    for (const c of colunas) {
      expect(c).not.toMatch(/payload|email|phone|nome|endereco|\bip\b|agent|fbc|fbp|gclid|ttclid|token|event_id|visitor_id|chave|visitante$/);
    }
    // NULLS NOT DISTINCT: o dia sem campanha tambem e UMA linha (PostgreSQL 15+).
    const chave = tabela.match(/constraint tracking_historico_diario_chave unique nulls not distinct \(([^)]*)\)/)?.[1];
    expect(chave?.split(",").map((c) => c.trim())).toEqual(CHAVE);
  });

  it("so o funil de volume, e a mesma lista em todo lugar (EVENTOS_DO_DIARIO)", () => {
    const chaves = new Set(EVENTOS.map((e) => e.chave));
    for (const e of EVENTOS_DO_DIARIO) expect(chaves.has(e), e).toBe(true);
    // Checkout, pagamento e compra seguem por evento os 12 meses.
    for (const e of ["begin_checkout", "payment_info", "purchase"]) {
      expect(EVENTOS_DO_DIARIO as readonly string[]).not.toContain(e);
    }
    const check = tabela.match(/evento text not null check \(evento in \(([^)]*)\)\)/)?.[1] ?? "";
    expect(valoresSql(check)).toEqual([...EVENTOS_DO_DIARIO]);
    const listas = [...compactar.matchAll(/\b(?:lower\(e\.event_name\)|h\.evento) in \(([^)]*)\)/g)].map((m) => m[1]);
    expect(listas).toHaveLength(2);
    for (const l of listas) expect(valoresSql(l)).toEqual([...EVENTOS_DO_DIARIO]);
    // A fonte aceita tudo que o historico aceita: o valor vem de la.
    const fontes = [...SQL.matchAll(/fonte text not null check \(fonte in \(([^)]*)\)\)/g)].map((m) => m[1]);
    expect(fontes).toHaveLength(2);
    expect(fontes[1]).toBe(fontes[0]);
  });

  it("so dia inteiro, mais velho que o prazo do funil na fila, e sem linha dele na fila", () => {
    const dias = RETENCAO.funilDias;
    expect(compactar).toContain(`h.instante < now() - interval '${dias} days'`);
    expect(compactar).toContain(
      `(h.instante at time zone lj.fuso)::date < ((now() - interval '${dias} days') at time zone lj.fuso)::date`
    );
    // A fila prende o dia: o falhou/pendente fica 30 dias e a passada de 14
    // dias o regravaria no historico -- juntado antes, contaria duas vezes.
    expect(compactar).toMatch(
      /not exists \(select 1 from presos p where p\.store_id = h\.store_id and p\.dia = \(h\.instante at time zone lj\.fuso\)::date\)/
    );
    // presos olha a fila com folga sobre o dia mais novo que pode juntar, e
    // prende tambem o dia de 1 min antes (a linha do 2o destino na virada).
    const folga = Number(compactar.match(/e\.created_at < now\(\) - interval '(\d+) days'/)?.[1]);
    expect(folga).toBeLessThan(dias);
    expect(compactar).toContain("(((e.created_at - interval '1 minute') at time zone lj.fuso)::date)");
    // Inline, o planejador fazia nested loop anti join e relia a fila para
    // cada linha do historico: o ensaio em producao passou de 90 s.
    expect(compactar).toMatch(/presos as materialized \(/);
    expect(SQL).toMatch(/select public\.tracking_arquivar\(null, null\); analyze public\.tracking_historico;/);
    // Fuso da loja so se o banco o conhece: fuso estranho nao derruba o expurgo.
    expect(compactar).toMatch(
      /coalesce\(\(select z\.name from pg_catalog\.pg_timezone_names z where z\.name = f\.fuso limit 1\), 'UTC'\) as fuso/
    );
    expect(compactar).toMatch(/with lojas as \( select s\.id, s\.user_id, .* where not s\.demonstracao \)/);
  });

  it("conta so o que saiu do historico, e cada chave uma vez por instrucao", () => {
    // O DELETE ... RETURNING alimenta o INSERT: o que nao saiu nao conta.
    expect(compactar).toMatch(/saidos as \( delete from public\.tracking_historico h using prontos p where h\.store_id = p\.store_id and h\.chave = p\.chave returning /);
    expect(compactar).toMatch(/from saidos s join lojas lj on lj\.id = s\.store_id group by /);
    // O agrupamento e a chave do ON CONFLICT batem: duas linhas com a mesma
    // chave no INSERT lancariam ("cannot affect row a second time").
    const grupo = compactar.match(/group by (.*?) on conflict/)?.[1] ?? "";
    expect(grupo.split(/,(?![^()]*\))/).map((c) => c.trim())).toEqual([
      "s.store_id",
      "lj.user_id",
      "(s.instante at time zone lj.fuso)::date",
      "s.evento",
      "s.fonte",
      "s.campanha_id",
      "s.conjunto_id",
      "s.anuncio_id",
    ]);
    const conflito = compactar.match(/on conflict \(([^)]*)\) do update/)?.[1];
    expect(conflito?.split(",").map((c) => c.trim())).toEqual(CHAVE);
    // O dono vem da loja (um por loja), nao da linha: a chave fica unica.
    expect(compactar).toMatch(/select s\.store_id, lj\.user_id, \(s\.instante at time zone lj\.fuso\)::date,/);
    // Conflito so soma.
    for (const c of ["eventos", "visitantes", "com_clique", "testes", "nao_enviados"]) {
      expect(compactar).toContain(`d.${c} + excluded.${c}`);
    }
    // INVOKER, como o tracking_arquivar: quem chama e o purge_tracking.
    const def = SQL.match(/create or replace function public\.tracking_compactar_funil\(\)([^$]*)as \$\$/)?.[1] ?? "";
    expect(def).toMatch(/security invoker/);
    expect(def).toMatch(/set search_path = public, pg_temp/);
  });
});

// ---------------------------------------------------------------------------
// 3c. O passo a passo do cabecalho
// ---------------------------------------------------------------------------

describe("079: o passo a passo de quem aplica", () => {
  it("o VACUUM FULL nao espera lock: SKIP_LOCKED, e fora dos minutos do purge", () => {
    const vacuums = SQL_079.split(/\r?\n/).filter((l) => /\bvacuum \(/i.test(l));
    expect(vacuums.length).toBeGreaterThan(0);
    // Na fila do lock, o VACUUM FULL seguraria todo INSERT do coletor atras dele.
    for (const l of vacuums) expect(l).toMatch(/vacuum \(full, analyze, skip_locked\) public\.tracking_events;/);
    // O drain chama o purge_tracking nos 10 primeiros minutos da hora.
    const drain = readFileSync(path.join(RAIZ, "src/app/api/jobs/tracking/drain/route.ts"), "utf8");
    const minutos = drain.match(/getUTCMinutes\(\) < (\d+)/)?.[1];
    expect(minutos).toBeDefined();
    expect(SQL_079).toMatch(new RegExp(`FORA dos ${minutos} primeiros minutos da hora`));
  });

  it("a conferencia (c) e um anti-join que vale a qualquer hora, nao uma contagem", () => {
    const c = SQL_079.match(/-- \(c\)[\s\S]*?(?=-- \(d\))/)?.[0] ?? "";
    const sem = c.replace(/^\s*--/gm, " ").replace(/\s+/g, " ");
    // A contagem contra chaves distintas e tautologica (a PK ja garante).
    expect(sem).not.toMatch(/count\(distinct \(store_id, chave\)\)/);
    expect(sem).toMatch(
      /where not exists \(select 1 from public\.tracking_historico h where h\.store_id = f\.store_id and h\.chave = md5\(f\.event_id\)::uuid\)/
    );
    expect(sem).toMatch(/where not s\.demonstracao/);
    // Sem a reserva cancelada: o mesmo predicado do tracking_arquivar.
    const pred = vigente("tracking_arquivar").corpo.match(/coalesce\((e\.status = 'enviado' and e\.sent_at is null and .*?), false\) as cancelada/)?.[1];
    expect(sem).toContain(`and not (${pred})`);
  });
});

// ---------------------------------------------------------------------------
// 4. Nenhum leitor depende do payload depois dos 8 dias
// ---------------------------------------------------------------------------

function arquivos(dir: string): string[] {
  const saida: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) saida.push(...arquivos(p));
    else if (/\.tsx?$/.test(p)) saida.push(p);
  }
  return saida;
}

/** Os caminhos que um select do PostgREST le do payload: payload->user_data->>fbc -> "user_data.fbc". */
function caminhosPostgrest(texto: string): string[] {
  return [...texto.matchAll(/payload((?:->>?\w+)+)/g)].map((m) => m[1].split(/->>?/).filter(Boolean).join("."));
}

/**
 * Quem le do payload uma chave fora do resumo, e por que pode: so linha que
 * nunca tem mais de 8 dias.
 */
const LEITORES_DE_JANELA_CURTA: Record<string, string> = {
  // As reservas (expresso e clique comum) da janela de 30 min e o IC do
  // comprador nas 24 h antes do pedido: user agent e event_time do clique.
  "src/lib/tracking/checkout-de-garantia.ts": "24 h",
};

describe("nenhum leitor de linha velha depende do payload inteiro", () => {
  const fontes = arquivos(path.join(RAIZ, "src")).filter((f) =>
    readFileSync(f, "utf8").includes('from("tracking_events")')
  );
  const rel = (f: string) => path.relative(RAIZ, f).replace(/\\/g, "/");

  it("acha os leitores de verdade (o teste nao passa vazio)", () => {
    const comPayload = fontes.filter((f) => caminhosPostgrest(readFileSync(f, "utf8")).length > 0).map(rel);
    expect(comPayload).toEqual(
      expect.arrayContaining(["src/lib/leitura/pedidos-banco.ts", "src/lib/tracking/checkout-de-garantia.ts"])
    );
  });

  it("todo caminho do payload num select da fila esta no resumo, ou o leitor e de janela curta", () => {
    const fora: string[] = [];
    for (const f of fontes) {
      const nome = rel(f);
      if (LEITORES_DE_JANELA_CURTA[nome]) continue;
      for (const c of caminhosPostgrest(readFileSync(f, "utf8"))) if (!RESUMO.has(c)) fora.push(`${nome}: ${c}`);
    }
    expect(fora).toEqual([]);
  });

  it("os leitores de janela curta leem mesmo so linha de ate 8 dias", () => {
    const garantia = readFileSync(path.join(RAIZ, "src/lib/tracking/checkout-de-garantia.ts"), "utf8");
    const janela = garantia.match(/JANELA_CHECKOUT_DE_GARANTIA_MS = ([\d\s*]+);/)?.[1];
    const ms = (janela ?? "").split("*").reduce((a, b) => a * Number(b.trim()), 1);
    expect(ms).toBe(DIA_MS);
    expect(ms).toBeLessThan(RETENCAO.resumoDaCompraDias * DIA_MS);
    expect(JANELA_CHECKOUT_EXPRESSO_MS).toBeLessThan(RETENCAO.resumoDaCompraDias * DIA_MS);
    // E toda leitura da fila la e presa a uma dessas janelas (`aPartirDe` e o
    // parametro de `ics`, chamado com `desde` ou `desdeExpresso`).
    const leituras = garantia.match(/\.from\("tracking_events"\)/g)?.length ?? 0;
    expect(leituras).toBeGreaterThan(0);
    expect(garantia.match(/\.gte\("created_at", (desde|desdeExpresso|aPartirDe)\)/g)?.length).toBe(leituras);
    expect(garantia.match(/ics\("\w+", \w+, (\w+)\)/g)?.every((c) => /(desde|desdeExpresso)\)$/.test(c))).toBe(true);
  });

  it("o payload INTEIRO so e lido da linha pendente (o envio e a reserva)", () => {
    const inteiro: string[] = [];
    for (const f of fontes) {
      const texto = readFileSync(f, "utf8");
      for (const m of texto.matchAll(/\.select\(\s*"([^"]*)"/g)) {
        if (/(^|[\s,])payload(\s*,|\s*$)/.test(m[1])) inteiro.push(rel(f));
      }
    }
    // fila.ts: o drain (so 'pendente') e a releitura da reserva antes de mandar.
    expect([...new Set(inteiro)]).toEqual(["src/lib/tracking/fila.ts"]);
    const fila = readFileSync(path.join(RAIZ, "src/lib/tracking/fila.ts"), "utf8");
    expect(fila).toMatch(/"id, store_id, destination, destination_id, event_name, event_id, payload, attempts"\s*\)\s*\.eq\("status", "pendente"\)/);
  });

  it("as RPCs em vigor (painel, feed e a regra de teste) so leem chaves do resumo", () => {
    for (const nome of ["tracking_painel_v2", "tracking_painel", "tracking_feed_v2", "tracking_feed", "tracking_evento_teste"]) {
      const { corpo } = vigente(nome);
      const lidos = [...caminhosSql(corpo)];
      expect(lidos.length, nome).toBeGreaterThan(0);
      expect(lidos.filter((c) => !RESUMO.has(c)), nome).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. A campanha do funil vem da URL do proprio evento (080)
// ---------------------------------------------------------------------------
//
// A 079 tirava a campanha do funil so da identidade, e a ponte nunca grava
// identidade (nao manda clientId): todo page_view ficava sem campanha. A 080
// le a URL do evento pela MESMA regra do TS. Sem banco aqui: o espelho JS de
// baixo segue o SQL passo a passo, com as regex e os numeros tirados do texto
// da 080, e e comparado com o TS em URL gerada nos formatos reais. Em 24/10 o
// SQL da 080, inline, rodou em producao (so SELECT) sobre as URLs da fila e
// sobre URLs geradas por este mesmo gerador: igual ao TS em todas; e a page.url
// do TikTok (urlSemTtclid da original), nunca um id que o TS nao daria.

interface Trio {
  campanha: string | null;
  conjunto: string | null;
  anuncio: string | null;
}

/** A leitura da URL da pagina no TS: a do landing (origem-pedido.ts), com o corte da pagina. */
function anuncioDoTs(url: string): Trio {
  const p = parametrosDaUrl(url, CORTE_PAGINA);
  const utm = utmDeParametros(p);
  const n = niveisDoAnuncio(utm, plataformaDe(utm, cliquesDeParametros(p)));
  return { campanha: n.campanha, conjunto: n.conjunto, anuncio: n.anuncio };
}

/** O 1o grupo de `molde` no trecho SQL. */
function pegar(sql: string, molde: RegExp, nome: string): string {
  const m = sql.match(molde);
  expect(m?.[1], nome).toBeDefined();
  return m![1];
}

/** As alternativas do topo de uma regex (fora de parenteses e colchetes). */
function alternativas(padrao: string): string[] {
  const saida: string[] = [];
  let nivel = 0;
  let colchete = false;
  let atual = "";
  for (let i = 0; i < padrao.length; i++) {
    const c = padrao[i];
    if (c === "\\") {
      atual += c + padrao[++i];
      continue;
    }
    if (colchete) {
      if (c === "]") colchete = false;
    } else if (c === "[") colchete = true;
    else if (c === "(") nivel++;
    else if (c === ")") nivel--;
    else if (c === "|" && nivel === 0) {
      saida.push(atual);
      atual = "";
      continue;
    }
    atual += c;
  }
  saida.push(atual);
  return saida;
}

/**
 * regexp_matches(texto, padrao, 'g') do Postgres: alternativa no topo da regex
 * casa a MAIS LONGA (no JS, a primeira que casa). O espelho nao depende da
 * ordem das alternativas.
 */
function casamentosPg(texto: string, padrao: string): string[] {
  const ramos = alternativas(padrao).map((r) => new RegExp(r, "y"));
  const saida: string[] = [];
  for (let i = 0; i < texto.length; ) {
    let melhor = "";
    for (const r of ramos) {
      r.lastIndex = i;
      const m = r.exec(texto);
      if (m && m[0].length > melhor.length) melhor = m[0];
    }
    if (!melhor) {
      i++;
      continue;
    }
    saida.push(melhor);
    i += melhor.length;
  }
  return saida;
}

const KELVIN = 0x212a;

describe("080: a campanha do funil vem da URL do proprio evento", () => {
  const SQL_080 = ler("080_historico_campanha_do_evento.sql");
  const SQL80 = limpo(SQL_080);
  const arquivar = vigente("tracking_arquivar");
  const anu = vigente("tracking_anuncio_da_url");
  const UTM_TS = readFileSync(path.join(RAIZ, "src/lib/tracking/utm.ts"), "utf8");
  const CHECK_ID = pegar(SQL, /campanha_id text check \(campanha_id is null or campanha_id ~ '([^']+)'\)/, "check");

  // --- O valor (URLSearchParams) ---------------------------------------------
  const PEDACOS = pegar(
    anu.corpo,
    /from regexp_matches\(replace\(f\.valor, '\+', ' '\), '([^']+)', 'g'\) with ordinality t\(m, n\)/,
    "pedacos"
  );
  const BYTES = pegar(anu.corpo, /from regexp_matches\(x\.h, '([^']+)', 'g'\) with ordinality b\(m, n\)/, "bytes");
  const VALIDO = pegar(
    anu.corpo,
    /when \(b\.m\)\[1\] ~ '\^\(\?:([^']+)\)\$' then convert_from\(decode\(\(b\.m\)\[1\], 'hex'\), 'UTF8'\)/,
    "valido"
  );
  const INTEIRO = pegar(
    anu.corpo,
    /when x\.h ~ '\^\(\?:([^']+)\)\+\$' then convert_from\(decode\(x\.h, 'hex'\), 'UTF8'\)/,
    "inteiro"
  );
  const reValido = new RegExp(`^(?:${VALIDO})$`);
  const reInteiro = new RegExp(`^(?:${INTEIRO})+$`);

  function decodificar(texto: string, nul: string): string {
    if (!texto.includes("%")) return texto.replace(/\+/g, " ");
    return casamentosPg(texto.replace(/\+/g, " "), PEDACOS)
      .map((t) => {
        if (!/^%[0-9A-Fa-f]{2}/.test(t)) return t;
        const h = t.replace(/%/g, "").toLowerCase();
        // A sequencia inteira valida, sem o 00: um convert_from so.
        if (reInteiro.test(h)) return Buffer.from(h, "hex").toString("utf8");
        return casamentosPg(h, BYTES)
          .map((b) => (b === "00" ? nul : reValido.test(b) ? Buffer.from(b, "hex").toString("utf8") : "\ufffd"))
          .join("");
      })
      .join("");
  }

  // --- O nome do par: so o que pode ser chave, sem decodificar byte a byte ---
  const RESTRITO = new RegExp(pegar(anu.corpo, /when r\.nome ~ '([^']+)' then replace\(/, "nome restrito"));
  const CADEIA_SQL = pegar(anu.corpo, /then (replace\(replace\([\s\S]*?'%7a', 'z'\)) end as nome/, "cadeia");
  const CADEIA = [...CADEIA_SQL.matchAll(/'(%[0-9a-f]{2})', '([a-z_])'\)/g)].map((m) => [m[1], m[2]] as const);

  function nomeDoPar(cru: string): string | null {
    if (!cru.includes("%")) return cru;
    if (!RESTRITO.test(cru)) return null;
    let s = cru.toLowerCase();
    for (const [de, para] of CADEIA) s = s.split(de).join(para);
    return s;
  }

  // --- A URL (parametrosDaUrl + utmDeParametros + plataformaDe + niveisDoAnuncio)
  const WS = pegar(
    anu.corpo,
    /select regexp_replace\(p_url, '\^\[([^\]]+)\]\+\|\[\1\]\+\$', '', 'g'\) as b/,
    "espaco do JS"
  );
  const C0 = "\\u0001-\\u0020";
  const reTrim = new RegExp(`^[${WS}]+|[${WS}]+$`, "g");
  const trimSql = (s: string) => s.replace(reTrim, "");
  const PREFILTRO = new RegExp(
    pegar(anu.corpo, /and translate\(p_url, chr\(9\) \|\| chr\(10\) \|\| chr\(13\), ''\) ~ '([^']+)'\) x/, "prefiltro")
  );
  const LIMITE_TIKTOK = Number(pegar(anu.corpo, /where not \(p_do_tiktok and char_length\(p_url\) > (\d+)\)/, "limite"));
  const ASTRAL = pegar(
    anu.corpo,
    /char_length\(e\.b\) \+ char_length\(regexp_replace\(e\.b, '([^']+)', '', 'g'\)\) >= \d+ as cortada/,
    "astral"
  );
  const reAstral = new RegExp(ASTRAL, "gu");
  const u16 = (s: string) => [...s].length + [...s.replace(reAstral, "")].length;
  const CORTE = Number(
    pegar(anu.corpo, /char_length\(e\.b\) \+ char_length\(regexp_replace\(e\.b, '[^']+', '', 'g'\)\) >= (\d+) as cortada/, "corte")
  );
  const MAX = Number(
    pegar(anu.corpo, /case when char_length\(w\.t\) \+ char_length\(regexp_replace\(w\.t, '[^']+', '', 'g'\)\) <= (\d+) then w\.t/, "200")
  );
  const CHAVES = new Set(valoresSql(pegar(anu.corpo, /where p\.nome in \(([^)]*)\) order by p\.nome, p\.n/, "chaves")));
  const AEM = new RegExp(pegar(anu.corpo, /from decodificados d where d\.nome = 'fbclid'\), ''\) ~ '([^']+)'/, "fbclid inteiro"));
  const CONTROLE = new RegExp(
    `[${pegar(anu.corpo, /regexp_replace\(regexp_replace\(v\.v, '\[([^\]]+)\]', '', 'g'\),/, "controle")}]`,
    "g"
  );
  const ULTIMA_BARRA = new RegExp(pegar(anu.corpo, /regexp_replace\(substring\(l\.v from '([^']+)'\),/, "barra"));
  const FONTES = new Set(valoresSql(pegar(anu.corpo, /in \(([^)]*)\) from limpos l where l\.nome = 'utm_source'/, "fontes")));
  const reId = new RegExp(CHECK_ID);
  const minuscula = (s: string) =>
    [...s].map((c) => (/[A-Z]/.test(c) ? c.toLowerCase() : c.codePointAt(0) === KELVIN ? "k" : c)).join("");

  /** O slice(0, 200) do JS em codigo de ponto: o caractere partido no fim vira U+FFFD. */
  function fatiar(t: string): string {
    let ate = 0;
    let saida = "";
    let partido = false;
    for (const ch of t) {
      const peso = ch.codePointAt(0)! > 0xffff ? 2 : 1;
      ate += peso;
      if (ate <= MAX) saida += ch;
      else if (ate === MAX + 1 && peso === 2) partido = true;
    }
    return saida + (partido ? "\ufffd" : "");
  }

  const CLIQUES = ["gclid", "gbraid", "wbraid", "fbclid", "ttclid"];

  /**
   * tracking_anuncio_da_url, passo a passo como o SQL. `tiktok` = p_do_tiktok:
   * as leituras com e sem a chave tirada (e o conjunto com o ttclid presente),
   * e cada nivel so sai se todas derem o mesmo id.
   */
  function anuncioComoSql(url: string, tiktok = false): Trio {
    const nada: Trio = { campanha: null, conjunto: null, anuncio: null };
    if (tiktok && [...url].length > LIMITE_TIKTOK) return nada;
    if (!PREFILTRO.test(url.replace(/[\t\n\r]/g, ""))) return nada;
    const b = trimSql(url);
    if (!b.includes("?")) return nada;
    const s = b
      .replace(new RegExp(`^[${C0}]+|[${C0}]+$`, "g"), "")
      .replace(/[\u0009\u000a\u000d]/g, "")
      .split("#")[0];
    if (!s.includes("?")) return nada;
    const q = s.slice(s.indexOf("?") + 1);
    const cortada = tiktok || u16(b) >= CORTE;
    const pares = q
      .split("&")
      .filter((seg) => seg !== "")
      .map((seg) => {
        const cru = seg.split("=")[0];
        return { nome: nomeDoPar(cru), valor: seg.slice(cru.length + 1) };
      });
    const primeiros = new Map<string, string>();
    for (const p of pares) if (p.nome !== null && CHAVES.has(p.nome) && !primeiros.has(p.nome)) primeiros.set(p.nome, p.valor);
    // `ultimo` so tem linha com a URL cortada; o nome pode ser null (nao chave).
    const temUltimo = cortada && pares.length > 0;
    const ultimo = temUltimo ? pares[pares.length - 1].nome : null;
    const decodificados = new Map<string, string>();
    for (const [nome, valor] of primeiros) {
      if (tiktok || nome !== ultimo || nome === "fbclid")
        decodificados.set(nome, decodificar(valor, nome.startsWith("utm") ? "" : "\ufffd"));
    }
    const tirada =
      temUltimo && ultimo !== null && !(ultimo === "fbclid" && AEM.test(decodificados.get("fbclid") ?? "")) ? ultimo : null;
    const valores = [...decodificados].map(([nome, v]) => ({ nome, v, tirado: nome === tirada }));
    const limpos = valores
      .filter((x) => x.nome.startsWith("utm"))
      .map(({ nome, v, tirado }) => {
        const t = trimSql(v.replace(CONTROLE, ""));
        const d = trimSql(u16(t) <= MAX ? t : fatiar(t));
        return { nome, tirado, v: d !== "" && !d.includes("@") ? d : null };
      });
    const ids = limpos
      .filter((l) => l.v !== null)
      .map((l) => ({ nome: l.nome, tirado: l.tirado, fim: trimSql(l.v!.match(ULTIMA_BARRA)![0]) }))
      .filter((i) => reId.test(i.fim));
    const cliques = valores.filter((x) => CLIQUES.includes(x.nome) && trimSql(x.v) !== "");
    const leituras = (tiktok ? [false, true] : [false]).map((comTirado) => {
      const vale = (x: { tirado: boolean }) => comTirado || !x.tirado;
      const id = (nome: string) => ids.find((i) => i.nome === nome && vale(i))?.fim ?? null;
      const tem = (...nomes: string[]) => cliques.some((k) => nomes.includes(k.nome) && vale(k));
      const g = valores.find((x) => x.nome === "gad_campaignid" && vale(x));
      const gad = g ? trimSql(g.v) : null;
      const fonte = limpos.find((l) => l.nome === "utm_source" && vale(l))?.v ?? null;
      const google = tem("gclid", "gbraid", "wbraid");
      const fbclid = tem("fbclid");
      const meio = id("utm_medium");
      const termo = id("utm_term");
      return {
        campanha: id("utm_campaign") ?? id("utm_id") ?? (gad !== null && reId.test(gad) ? gad : null),
        anuncio: id("utm_content"),
        conjunto:
          meio ??
          (google ? null : fbclid ? termo : tem("ttclid") ? null : fonte !== null && FONTES.has(minuscula(fonte)) ? termo : null),
        conjuntoComTtclid: meio ?? (!google && fbclid ? termo : null),
      };
    });
    const igual = (xs: (string | null)[]) => (xs.every((x) => x !== null && x === xs[0]) ? xs[0] : null);
    return {
      campanha: igual(leituras.map((l) => l.campanha)),
      conjunto: igual(tiktok ? leituras.flatMap((l) => [l.conjunto, l.conjuntoComTtclid]) : leituras.map((l) => l.conjunto)),
      anuncio: igual(leituras.map((l) => l.anuncio)),
    };
  }

  // --- O gerador: URLs nos formatos que chegam -------------------------------
  const digitos = fc.oneof(
    fc.stringMatching(/^[0-9]{5,25}$/),
    fc.stringMatching(/^[0-9]{1,4}$/),
    fc.stringMatching(/^[0-9]{26,30}$/),
    fc.constant("120252304612740441")
  );
  const nome = fc.oneof(
    fc.constantFrom(
      "Campanha X",
      "[CBO] BR - Teste 01",
      "Promoção Verão",
      "🔥 Oferta",
      "a",
      "",
      " ",
      "x@y.com",
      "{{campaign.name}}",
      "Instagram_Feed"
    ),
    fc.string({ unit: fc.constantFrom(..."abcXYZ _-.{}@|0123456789ãé\t🔥\u00a0"), maxLength: 30 }),
    // Perto dos 200 do limparValor: o id no fim e cortado como no TS.
    fc.string({ unit: fc.constantFrom(..."abcdefghij 🔥"), minLength: 170, maxLength: 230 })
  );
  const valorUtm = fc.oneof(
    digitos,
    fc.tuple(nome, digitos).map(([n, i]) => `${n}|${i}`),
    fc
      .tuple(nome, fc.constantFrom("", " ", "\u00a0", "\t", "\u3000"), digitos, fc.constantFrom("", " ", "\u3000", "\ufeff"))
      .map(([n, a, i, d]) => `${n}|${a}${i}${d}`),
    nome,
    fc.constantFrom("{{campaign.id}}", "{{adset.name}}|{{adset.id}}", "__CAMPAIGN_ID__", "paid", "cpc", "id", "a|12345|67890")
  );
  const fonte = fc.constantFrom(
    "fb",
    "ig",
    "FB",
    "Facebook",
    "facebook",
    "instagram",
    "an",
    "meta",
    "facebook_ads",
    "google",
    "tiktok",
    "tt",
    " fb ",
    "fb@x",
    "{{site_source_name}}",
    "faceboo\u212a",
    "\u0130g",
    "",
    "email",
    "x".repeat(210)
  );
  const clique = fc.oneof(
    fc.stringMatching(/^[A-Za-z0-9_-]{5,120}$/),
    fc
      .tuple(fc.stringMatching(/^[A-Za-z0-9_-]{5,150}$/), fc.stringMatching(/^[A-Za-z0-9_-]{22}$/))
      .map(([a, b]) => `${a}_aem_${b}`),
    fc.constantFrom("", "%20", "%00", "+", "%C2%A0", "%09")
  );
  const gad = fc.oneof(digitos, fc.constantFrom("", " 12345", "%2012345%20", "abc", "%0912345", "%0112345", "%C2%A012345"));
  /** Como o valor chega: inteiro (encodeURIComponent), hex minusculo, como o form, cru ou meio a meio. */
  const naUrl = fc
    .tuple(
      fc.constantFrom("component", "minuscula", "form", "cru", "misto"),
      fc.array(fc.boolean(), { minLength: 8, maxLength: 8 }),
      fc.constantFrom("", "", "", "%", "%E9", "%ZZ", "%C3", "%00", "%F0%9F", "%7c")
    )
    .map(([modo, sorteio, sobra]) => (cru: string) => {
      const pct = (ch: string, min: boolean) =>
        [...new TextEncoder().encode(ch)]
          .map((b) => "%" + b.toString(16).padStart(2, "0")[min ? "toLowerCase" : "toUpperCase"]())
          .join("");
      if (modo === "form") return new URLSearchParams({ x: cru }).toString().slice(2) + sobra;
      let i = 0;
      let saida = "";
      for (const ch of cru) {
        const s = sorteio[i++ % sorteio.length];
        const cp = ch.codePointAt(0)!;
        const obrigatorio = "&#+%=".includes(ch) || cp > 0xffff || cp < 0x20;
        if (modo === "component") saida += encodeURIComponent(ch);
        else if (modo === "minuscula") saida += encodeURIComponent(ch).replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase());
        else if (modo === "cru") saida += obrigatorio ? pct(ch, false) : ch === " " && s ? "+" : ch;
        else saida += obrigatorio || s ? pct(ch, s) : ch;
      }
      return saida + sobra;
    });
  /** Cada caractere do nome cru ou em %XX (hex maiusculo ou minusculo): o que o nome decodificado vira chave. */
  const codificado = (k: string) =>
    fc.array(fc.constantFrom("cru", "cru", "maiusculo", "minusculo"), { minLength: k.length, maxLength: k.length }).map((modos) =>
      [...k]
        .map((c, i) => {
          const h = c.charCodeAt(0).toString(16);
          return modos[i] === "cru" ? c : `%${modos[i] === "maiusculo" ? h.toUpperCase() : h}`;
        })
        .join("")
    );
  /** O nome da chave: quase sempre como e, as vezes codificado ou torto. */
  const chave = (k: string) =>
    fc.oneof(
      { weight: 6, arbitrary: fc.constantFrom(k, k, k, k, k.replace("_", "%5F"), k.replace("_", "%5f"), k.toUpperCase(), `${k}%20`) },
      { weight: 1, arbitrary: codificado(k) }
    );
  const par = (k: string, v: fc.Arbitrary<string>) => fc.tuple(chave(k), v).map(([n, x]) => `${n}=${x}`);
  const utm = (k: string) => fc.tuple(chave(k), valorUtm, naUrl).map(([n, v, cod]) => `${n}=${cod(v)}`);
  const entrada = fc.oneof(
    utm("utm_campaign"),
    utm("utm_medium"),
    utm("utm_content"),
    utm("utm_term"),
    utm("utm_id"),
    fc.tuple(chave("utm_source"), fonte, naUrl).map(([n, v, cod]) => `${n}=${cod(v)}`),
    par("gad_campaignid", gad),
    par("fbclid", clique),
    par("gclid", clique),
    par("gbraid", clique),
    par("wbraid", clique),
    par("ttclid", clique),
    fc.constantFrom("variant=123", "_pos=1", "x", "", "a=b=c", "fbclid", "_ss=r", "gad_source=1", "%41=1", "%", "%4", "u%74m_x=1")
  );
  /** O automatico do Meta (utm_medium=paid, conjunto no utm_term), com o resto embaralhado em volta. */
  const metaAutomatico = fc
    .tuple(
      fc.constantFrom("fb", "ig", "FB", "facebook"),
      digitos,
      digitos,
      digitos,
      fc.option(clique),
      fc.array(entrada, { maxLength: 4 }),
      fc.nat()
    )
    .map(([fonteMeta, c, s, a, fbclid, outras, ondeOutras]) => {
      const lista = [`utm_source=${fonteMeta}`, "utm_medium=paid", `utm_id=${c}`, `utm_content=${a}`, `utm_term=${s}`, `utm_campaign=${c}`];
      if (fbclid !== null) lista.push(`fbclid=${fbclid}`);
      lista.splice(ondeOutras % (lista.length + 1), 0, ...outras);
      return lista;
    });
  const urlDoEvento = fc
    .record({
      base: fc.constantFrom(
        "https://loja.shop/products/x",
        "https://loja.shop/",
        "https://loja.shop",
        "http://a.myshopify.com/collections/all",
        "https://loja.shop/p?"
      ),
      entradas: fc.oneof(fc.array(entrada, { maxLength: 12 }), metaAutomatico),
      fragmento: fc.constantFrom("", "", "", "#x", "#frag?utm_campaign=99999", "#"),
      // Enche ate perto dos 500 (o corte do coletor) e corta como ele.
      enchimento: fc.option(fc.tuple(fc.nat(), fc.integer({ min: 0, max: 520 }))),
      corte: fc.option(fc.integer({ min: 470, max: 500 })),
      pontas: fc.constantFrom(["", ""], [" ", ""], ["", " "], ["\u00a0", "\t"]),
    })
    .map(({ base, entradas, fragmento, enchimento, corte, pontas }) => {
      const lista = [...entradas];
      if (enchimento) lista.splice(enchimento[0] % (lista.length + 1), 0, `pad=${"x".repeat(enchimento[1])}`);
      let url = `${base}?${lista.join("&")}${fragmento}`;
      if (corte !== null && url.length > corte) url = url.slice(0, corte);
      return `${pontas[0]}${url}${pontas[1]}`;
    });
  /**
   * A URL ORIGINAL de um evento do TikTok, como o coletor a grava (cortada em
   * 500), com o ttclid em qualquer lugar -- inclusive antes das UTMs, como a
   * ponte monta o link (comParametros) -- e perto do corte. O SQL le
   * urlSemTtclid(original), a page.url.
   */
  const urlOriginalTiktok = fc
    .tuple(
      fc.array(
        fc.oneof(
          entrada,
          // UTM com id (o modelo do TikTok, a Utmify), para haver o que perder.
          fc
            .tuple(
              fc.constantFrom("utm_campaign", "utm_medium", "utm_content", "utm_term", "utm_id", "gad_campaignid"),
              fc.constantFrom("", "Nome%7C", "Nome|", "a+b%7c"),
              fc.stringMatching(/^[0-9]{5,25}$/)
            )
            .map(([k, prefixo, id]) => `${k}=${k === "gad_campaignid" ? "" : prefixo}${id}`),
          fc.stringMatching(/^ttclid=E\.C\.P\.[A-Za-z0-9_-]{20,260}$/),
          fc.constantFrom("utm_source=tiktok", "utm_source=fb", "fbclid=IwZX", "ttclid=", "ttclid=%20", "x=%7B%7D|", "_pos=1")
        ),
        { minLength: 1, maxLength: 12 }
      ),
      fc.constantFrom("", "#frag", "#a?utm_campaign=99999"),
      fc.nat(),
      fc.integer({ min: 440, max: 560 }),
      fc.boolean()
    )
    .map(([lista, frag, onde, alvo, encher]) => {
      const base = `https://loja.shop/products/meia?${lista.join("&")}${frag}`;
      if (!encher || base.length >= alvo) return base.slice(0, CORTE_PAGINA);
      const l = [...lista];
      l.splice(onde % (l.length + 1), 0, `pad=${"x".repeat(alvo - base.length)}`);
      return `https://loja.shop/products/meia?${l.join("&")}${frag}`.slice(0, CORTE_PAGINA);
    })
    .filter((u) => {
      try {
        new URL(u);
        return true;
      } catch {
        return false;
      }
    });

  // --- As travas ---------------------------------------------------------------

  it("a definicao em vigor do tracking_arquivar e a da 080; o compactar e o purge seguem os da 079", () => {
    expect(arquivar.arquivo).toBe("080_historico_campanha_do_evento.sql");
    expect(anu.arquivo).toBe("080_historico_campanha_do_evento.sql");
    expect(vigente("tracking_compactar_funil").arquivo).toBe("079_rastreamento_historico.sql");
    expect(vigente("purge_tracking").arquivo).toBe("079_rastreamento_historico.sql");
    expect(SQL80).not.toMatch(
      /function public\.(purge_tracking|tracking_compactar_funil|tracking_payload_resumo|tracking_id_de_utm|tracking_painel|tracking_feed|tracking_evento_teste|tracking_url_decodificar)\b/
    );
    expect(SQL80).not.toMatch(/create table|alter table|create index/);
  });

  it("a URL do evento vem das tres chaves de URL do resumo, na ordem Meta, TikTok, Google", () => {
    const urls = [...arquivar.corpo.matchAll(/(e\.payload (?:->> '\w+'|-> '\w+' ->> '\w+')) as url_(\w+)/g)];
    expect(urls.map((m) => m[2])).toEqual(["meta", "tiktok", "google"]);
    const chaves = urls.map((m) => [...caminhosSql(m[1])][0]);
    expect(chaves).toEqual(["event_source_url", "page.url", "pageUrl"]);
    for (const c of chaves) expect(RESUMO.has(c), c).toBe(true);
    // So a com query serve, e a da primeira plataforma que tem.
    expect(arquivar.corpo).toContain(
      "coalesce(min(l.url_meta) filter (where position('?' in l.url_meta) > 0), min(l.url_tiktok) filter (where position('?' in l.url_tiktok) > 0), min(l.url_google) filter (where position('?' in l.url_google) > 0)) as url"
    );
    // E e a URL que o coletor grava nas duas (origemDaPagina, cortada em CORTE_PAGINA).
    const coletor = readFileSync(path.join(RAIZ, "src/app/api/tracking/collect/route.ts"), "utf8");
    expect(coletor).toMatch(/event_source_url: origemDaPagina/);
    expect(coletor).toMatch(/const url = origemDaPagina \|\| /);
    expect(coletor).toMatch(new RegExp(`origemDaPagina = candidata\\.slice\\(0, ${CORTE_PAGINA}\\)`));
  });

  // A page.url do TikTok e urlSemTtclid(origemDaPagina): sem o ttclid e com a
  // query reescrita. Lida como se fosse a URL do coletor, o tamanho dela nao
  // dizia o corte e o id cortado pela metade era gravado.
  it("a URL escolhida diz ao SQL quando e a page.url do TikTok", () => {
    expect(arquivar.corpo).toContain(
      "min(l.url_meta) filter (where position('?' in l.url_meta) > 0) is null and min(l.url_tiktok) filter (where position('?' in l.url_tiktok) > 0) is not null as url_do_tiktok"
    );
    expect(arquivar.corpo).toContain("from public.tracking_anuncio_da_url(ev.url, ev.url_do_tiktok) u");
    // E a page.url e mesmo a reescrita sem o ttclid (montarEventoDeFunilTiktok).
    const tiktok = readFileSync(path.join(RAIZ, "src/lib/tracking/tiktok-evento.ts"), "utf8");
    expect(tiktok).toMatch(/page: \{ url: urlSemTtclid\(entrada\.url\) \}/);
    expect(urlSemTtclid("https://loja.shop/p?utm_campaign=a%7c12345&ttclid=E.C.P.x&utm_content=b|67890")).toBe(
      "https://loja.shop/p?utm_campaign=a%7C12345&utm_content=b%7C67890"
    );
  });

  it("no funil, a URL do proprio evento vem ANTES da identidade, e o trio e de um lugar so", () => {
    for (const c of ["campanha_id", "conjunto_id", "anuncio_id"]) {
      const caso = pegar(
        arquivar.corpo,
        new RegExp(
          `(case when o\\.shopify_order_id is not null then o\\.${c} when coalesce\\(d\\.campanha_id, d\\.conjunto_id, d\\.anuncio_id\\) is not null then d\\.${c} else .*? end as ${c})`
        ),
        c
      );
      // O else e a identidade, inteira: nenhum nivel dela se mistura com a URL.
      const senao = caso.slice(caso.indexOf(" else "));
      expect(senao).toMatch(/idt\.utm ->> /);
      expect(senao).not.toMatch(/\bd\./);
    }
    // A identidade, como na 079: o lateral so procura no funil.
    expect(arquivar.corpo).toMatch(/where ev\.pedido_id is null and ev\.visitor_id is not null/);
  });

  // Relida toda hora para todo evento das 48 h, a URL custava ~10x o resto da
  // passada (medido: 40 ms -> 470 ms nos 1.100 eventos de 24/10), e o coletor
  // e publico: um IP montava URL cara ate estourar os 8 s do purge, que volta
  // atras inteiro, todas as lojas. O resultado relido ia fora (o bloco).
  it("a URL e lida UMA vez por evento: na primeira passada que o arquiva (e na (null, null) da migration)", () => {
    expect(arquivar.corpo).toContain(
      "left join public.tracking_historico a0 on a0.store_id = ev.store_id and a0.chave = md5(ev.event_id)::uuid"
    );
    const d = pegar(arquivar.corpo, /(left join lateral \( select u\.campanha_id[\s\S]*?\) d on true)/, "d");
    expect(d).toBe(
      "left join lateral ( select u.campanha_id, u.conjunto_id, u.anuncio_id from public.tracking_anuncio_da_url(ev.url, ev.url_do_tiktok) u " +
        "where ev.pedido_id is null and ev.url is not null and (a0.chave is null or (p_desde is null and p_ate is null " +
        "and coalesce(a0.campanha_id, a0.conjunto_id, a0.anuncio_id) is null)) offset 0 ) d on true"
    );
    // O a0 vem antes do lateral (que o le), e nada mais le a URL.
    expect(arquivar.corpo.indexOf("left join public.tracking_historico a0")).toBeLessThan(arquivar.corpo.indexOf(d));
    expect(arquivar.corpo.match(/tracking_anuncio_da_url/g)).toHaveLength(1);
    // O purge (079) so roda passadas com limite: a releitura e so da migration.
    const purge = vigente("purge_tracking").corpo;
    const passadas = [...purge.matchAll(/perform public\.tracking_arquivar\(([^;]*)\);/g)].map((m) => m[1]);
    expect(passadas).toEqual(["now() - interval '48 hours', null", "null, now() - interval '14 days'"]);
    expect(SQL80.match(/select public\.tracking_arquivar\(([^)]*)\);/g)).toEqual(["select public.tracking_arquivar(null, null);"]);
    // E a funcao da URL nao chama funcao SQL nenhuma: nao vira inline (SET
    // search_path), e a chamada de dentro refaria parse e plano a cada URL.
    expect(anu.corpo).not.toMatch(/\bpublic\.|tracking_\w+\(/);
  });

  it("contra o gravado, o trio e um bloco: com qualquer id gravado fica o gravado inteiro", () => {
    const junta = [
      ...arquivar.corpo.matchAll(
        /case when n\.com_origem then n\.(\w+) when coalesce\(a\.campanha_id, a\.conjunto_id, a\.anuncio_id\) is not null then a\.(\w+) else n\.(\w+) end/g
      ),
    ];
    expect(junta.map((m) => m[1])).toEqual(["campanha_id", "conjunto_id", "anuncio_id"]);
    for (const m of junta) expect(new Set([m[1], m[2], m[3]]).size).toBe(1);
    // O exemplo da revisao: (gad, null, null) gravado + (C, S, A) novo = (gad, null, null).
    const juntar = (comOrigem: boolean, a: (string | null)[], n: (string | null)[]) =>
      comOrigem ? n : a.some((x) => x !== null) ? a : n;
    expect(juntar(false, ["2233445566", null, null], ["120201", "120202", "120203"])).toEqual(["2233445566", null, null]);
    expect(juntar(false, [null, null, null], ["120201", "120202", "120203"])).toEqual(["120201", "120202", "120203"]);
    expect(juntar(true, ["120201", "120202", "120203"], ["99999", null, null])).toEqual(["99999", null, null]);
  });

  it("todo id que sai da URL passa pela regex do CHECK (nada lanca no INSERT)", () => {
    const regexDeId = [...anu.corpo.matchAll(/ ~ '(\^\[0-9\][^']*)'/g)].map((m) => m[1]);
    expect(regexDeId.length).toBeGreaterThanOrEqual(2);
    for (const r of regexDeId) expect(r).toBe(CHECK_ID);
    expect(anu.corpo).toMatch(/where f\.fim ~ '\^\[0-9\]\{5,25\}\$'/);
    // As leituras so leem ids (filtrados) e o gad (filtrado); a saida so le as leituras.
    const leituras = pegar(anu.corpo, /(leituras as \([\s\S]*\) select case when)/, "leituras");
    expect(leituras).toMatch(/where g\.g ~ '\^\[0-9\]\{5,25\}\$'/);
    expect(new Set([...leituras.matchAll(/select (\w+\.\w+) from/g)].map((m) => m[1]))).toEqual(new Set(["i.fim", "g.g"]));
    const saida = anu.corpo.slice(anu.corpo.lastIndexOf(") select case when"));
    expect(new Set([...saida.matchAll(/then (\w+\(\w+\.\w+\)) end/g)].map((m) => m[1]))).toEqual(
      new Set(["min(l.campanha)", "min(l.conjunto)", "min(l.anuncio)"])
    );
    // E nenhum cast no caminho.
    expect(anu.corpo).not.toMatch(/::/);
  });

  it("o decodificador so chama convert_from com UTF-8 ja validado, e o 00 sai antes", () => {
    expect(anu.corpo).toMatch(/case when \(b\.m\)\[1\] = '00' then k\.nul when \(b\.m\)\[1\] ~ '\^\(\?:/);
    expect(anu.corpo).toMatch(/case when position\('%' in f\.valor\) = 0 then replace\(f\.valor, '\+', ' '\)/);
    expect(anu.corpo).toMatch(/select case when \(t\.m\)\[1\] ~ '\^%\[0-9A-Fa-f\]\{2\}' then lower\(replace\(\(t\.m\)\[1\], '%', ''\)\) end as h/);
    expect(anu.corpo.match(/convert_from/g)).toHaveLength(2);
    // O caminho rapido e o mesmo UTF-8, sem o 00 (o convert_from recusa).
    expect(INTEIRO).toBe(VALIDO.replace("[0-7][0-9a-f]|", "0[1-9a-f]|[1-7][0-9a-f]|"));
    // Todo caractere (sem os substitutos) cabe nas duas regex de valido...
    const fora: number[] = [];
    const pontos = [...Array(0x10000).keys(), 0x10000, 0x3ffff, 0x40000, 0xfffff, 0x100000, 0x10ffff];
    for (let cp = 0x10000; cp <= 0x10ffff; cp += 251) pontos.push(cp);
    for (const cp of pontos) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const h = Buffer.from(String.fromCodePoint(cp), "utf8").toString("hex");
      if (!reValido.test(h) || reInteiro.test(h) !== (cp !== 0)) fora.push(cp);
    }
    expect(fora).toEqual([]);
    // ...e o que cabe e UTF-8 valido: UM caractere no byte a byte; sem U+0000
    // na sequencia inteira (o convert_from nao lanca).
    const decodificador = new TextDecoder("utf-8", { fatal: true });
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 1, maxLength: 4 }), (bytes) => {
        if (!reValido.test(Buffer.from(bytes).toString("hex"))) return;
        expect([...decodificador.decode(bytes)]).toHaveLength(1);
      }),
      { numRuns: 50000 }
    );
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 1, maxLength: 40 }), (bytes) => {
        if (!reInteiro.test(Buffer.from(bytes).toString("hex"))) return;
        expect(decodificador.decode(bytes)).not.toContain(String.fromCharCode(0));
      }),
      { numRuns: 50000 }
    );
    // Sequencia valida longa (o caso do caminho rapido) tambem acontece.
    expect(reInteiro.test(Buffer.from("Promoção 🔥 ".repeat(20)).toString("hex"))).toBe(true);
  });

  it("o decodificador e o URLSearchParams, byte a byte (U+FFFD por pedaco invalido, como o WHATWG)", () => {
    const pedaco = fc.oneof(
      fc.integer({ min: 0, max: 255 }).map((b) => "%" + b.toString(16).padStart(2, "0")),
      fc.integer({ min: 0, max: 255 }).map((b) => "%" + b.toString(16).padStart(2, "0").toUpperCase()),
      fc.constantFrom("%C3%A9", "%F0%9F%94%A5", "%ED%A0%80", "%E0%80%AF", "%F4%90%80%80", "%E2%82", "%F0%9F%94"),
      fc.constantFrom("%", "%Z", "%ZZ", "+", "|", " ", "é", "a", "0", "=", "~", "🔥")
    );
    fc.assert(
      fc.property(fc.array(pedaco, { maxLength: 24 }), (ps) => {
        const s = ps.join("");
        // U+0000 so aqui: o Postgres nao guarda o caractere (ver o cabecalho).
        // A referencia e o searchParams do new URL(), o que parametrosDaUrl
        // usa: o `new URLSearchParams(texto)` do Node 24 erra o byte invalido
        // antes de emoji ("%80" + emoji vira U+FFFD + "=%").
        // O "&y" no fim: o new URL() tira o espaco do fim da URL inteira.
        expect(decodificar(s, String.fromCharCode(0))).toBe(new URL(`https://x.invalid/?x=${s}&y`).searchParams.get("x"));
      }),
      { numRuns: 20000 }
    );
  });

  // Decodificar o nome de todo par custava uma chamada de funcao por par (243
  // pares numa URL de 500 = 2,1 ms). So nome que PODE ser chave e decodificado,
  // e pelo replace dos 27 %XX de [a-z_].
  it("o nome do par: so o que pode ser chave e decodificado, e igual ao URLSearchParams", () => {
    // A cadeia troca exatamente os %XX que o filtro deixa passar, cada um pelo seu caractere.
    expect(CADEIA.map(([, c]) => c).join("")).toBe("_abcdefghijklmnopqrstuvwxyz");
    for (const [cod, c] of CADEIA) expect(String.fromCharCode(parseInt(cod.slice(1), 16)), cod).toBe(c);
    for (let b = 0; b < 256; b++) {
      const h = b.toString(16).padStart(2, "0");
      const vira = /[a-z_]/.test(String.fromCharCode(b));
      expect(RESTRITO.test(`%${h}`), h).toBe(vira);
      expect(RESTRITO.test(`%${h.toUpperCase()}`), h).toBe(vira);
    }
    for (const k of CHAVES) for (const c of k) expect(/[a-z_]/.test(c), k).toBe(true);
    // Contra o URLSearchParams: nome que decodifica para chave da ela; o resto nao vira chave.
    const unidade = fc.oneof(
      fc.constantFrom(..."abcdgilmnoprstuw_UTM+%~.-0123456789"),
      fc.integer({ min: 0, max: 255 }).map((b) => "%" + b.toString(16).padStart(2, "0")),
      fc.integer({ min: 0x5f, max: 0x7a }).map((b) => "%" + b.toString(16).toUpperCase())
    );
    const cru = fc.oneof(
      fc.array(unidade, { maxLength: 16 }).map((u) => u.join("")),
      fc.constantFrom(...CHAVES).chain((k) => codificado(k))
    );
    let chaves = 0;
    fc.assert(
      fc.property(cru, (n) => {
        const ts = [...new URL(`https://x.invalid/?${n}=v&y`).searchParams.keys()][0];
        const sql = nomeDoPar(n);
        if (CHAVES.has(ts)) {
          chaves++;
          expect(sql, n).toBe(ts);
        } else expect(sql !== null && CHAVES.has(sql), n).toBe(false);
      }),
      { numRuns: 20000 }
    );
    expect(chaves).toBeGreaterThan(2000);
  });

  // Antes de ler a query, uma regex na URL inteira: sem "utm_" nem "gad_c"
  // (cada caractere cru ou %XX), nao ha id -- a maioria das paginas do funil.
  it("o filtro de entrada nunca barra URL que da id no TS", () => {
    expect(PREFILTRO.source).toBe(
      "(?:u|%75)(?:t|%74)(?:m|%6[Dd])(?:_|%5[Ff])|(?:g|%67)(?:a|%61)(?:d|%64)(?:_|%5[Ff])(?:c|%63)"
    );
    // As chaves que dao id sao as utm_* e o gad_campaignid.
    const comId = [...CHAVES].filter((k) => k.startsWith("utm_") || k === "gad_campaignid");
    expect(comId.sort()).toEqual(["gad_campaignid", "utm_campaign", "utm_content", "utm_id", "utm_medium", "utm_source", "utm_term"]);
    fc.assert(
      fc.property(
        fc.constantFrom(...comId).chain((k) => codificado(k)),
        fc.constantFrom("", "\t", "\n", "\r\n"),
        fc.nat(),
        (k, quebra, onde) => {
          const i = onde % (k.length + 1);
          const url = `https://loja.shop/p?${k.slice(0, i)}${quebra}${k.slice(i)}=120252304612740441`;
          if (anuncioDoTs(url).campanha !== null || anuncioDoTs(url).conjunto !== null || anuncioDoTs(url).anuncio !== null) {
            expect(PREFILTRO.test(url.replace(/[\t\n\r]/g, "")), url).toBe(true);
          }
        }
      ),
      { numRuns: 5000 }
    );
    // E o que ele barra o TS tambem nao le.
    for (const url of ["https://loja.shop/products/meia?variant=123&_pos=1", "https://loja.shop/?UTM_CAMPAIGN=12345678"]) {
      expect(PREFILTRO.test(url)).toBe(false);
      expect(anuncioDoTs(url)).toEqual({ campanha: null, conjunto: null, anuncio: null });
    }
  });

  it("o espaco do trim e o do trim() do JS (nao o \\s do Postgres, que depende do locale)", () => {
    const formas = [...anu.corpo.matchAll(/'\^\[([^\]]+)\]\+\|\[([^\]]+)\]\+\$'/g)].map((m) => {
      expect(m[2]).toBe(m[1]);
      return m[1];
    });
    expect(new Set(formas)).toEqual(new Set([WS, C0]));
    expect(anu.corpo).not.toMatch(/\\s|btrim|trim\(/);
    const um = new RegExp(`^[${WS}]$`);
    const diferentes: string[] = [];
    for (let cp = 0; cp <= 0x10ffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const c = String.fromCodePoint(cp);
      if (um.test(c) !== (c.trim() === "")) diferentes.push(cp.toString(16));
    }
    expect(diferentes).toEqual([]);
  });

  it("os numeros e as listas sao os do TS", () => {
    expect(CORTE).toBe(CORTE_PAGINA - Number(pegar(UTM_TS, /bruto\.length >= cortadaEm - (\d+)/, "folga")));
    expect(LIMITE_TIKTOK).toBe(CORTE_PAGINA);
    expect(MAX).toBe(MAX_VALOR_UTM);
    expect(anu.corpo).toContain(
      `filter (where k.ate <= ${MAX_VALOR_UTM}) || case when bool_or(k.ate = ${MAX_VALOR_UTM + 1} and k.peso = 2)`
    );
    expect(anu.corpo).toContain("case when ascii(c.ch) > 65535 then 2 else 1 end as peso");
    expect(AEM.source).toBe(pegar(UTM_TS, /const FBCLID_COMPLETO = \/(.+)\/;/, "FBCLID_COMPLETO"));
    expect(FONTES).toEqual(new Set(FONTES_META));
    const cliques = Object.keys(cliquesDeParametros(new URLSearchParams()));
    expect(cliques.sort()).toEqual([...CLIQUES].sort());
    expect(CHAVES).toEqual(
      new Set([...["source", "medium", "campaign", "content", "term", "id"].map((k) => `utm_${k}`), "gad_campaignid", ...cliques])
    );
    // O limparValor tira [\u0000-\u001f\u007f]; o U+0000 nem existe no texto do Postgres.
    expect(CONTROLE.source).toBe("[\\u0001-\\u001f\\u007f]");
    expect(UTM_TS).toContain('replace(/[\\u0000-\\u001f\\u007f]/g, "")');
    // A ordem da plataforma: Google, Meta, TikTok (plataformaDoClique), depois a fonte.
    expect(anu.corpo).toContain(
      "coalesce(x.meio, case when x.google then null when x.fbclid then x.termo when x.ttclid then null when x.fonte_meta then x.termo end) as conjunto"
    );
    expect(anu.corpo).toContain(
      "exists (select 1 from cliques k where k.nome in ('gclid', 'gbraid', 'wbraid') and (w.com_tirado or not k.tirado)) as google"
    );
    // So a UTM perde o U+0000; nas outras chaves ele e um caractere.
    expect(anu.corpo).toContain("cross join lateral (select case when f.nome like 'utm%' then '' else chr(65533) end as nul) k");
  });

  it("a minuscula da fonte e a do JS no que importa: A-Z e o sinal de Kelvin", () => {
    const m = anu.corpo.match(
      /translate\(l\.v, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' \|\| chr\((\d+)\), 'abcdefghijklmnopqrstuvwxyz(\w)'\)/
    );
    expect(Number(m?.[1])).toBe(KELVIN);
    expect(m?.[2]).toBe("k");
    const viramAscii: number[] = [];
    for (let cp = 0x80; cp <= 0x10ffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      if (/^[a-z_]+$/.test(String.fromCodePoint(cp).toLowerCase())) viramAscii.push(cp);
    }
    expect(viramAscii).toEqual([KELVIN]);
  });

  it("os formatos reais: Meta automatico, Utmify, Google, TikTok, '@', fragmento e o corte", () => {
    const C = "120252304612740441";
    const S = "120252304612740442";
    const A = "120252304612740443";
    const aem = `IwZXh0bgNhZW0BMABhZGlkAasR${"x".repeat(150)}_aem_${"a".repeat(22)}`;
    const casos: [string, Trio][] = [
      // Automatico do Meta: utm_medium=paid, conjunto no utm_term.
      [
        `https://loja.shop/products/x?utm_source=fb&utm_medium=paid&utm_id=${C}&utm_content=${A}&utm_term=${S}&utm_campaign=${C}&fbclid=${aem}`,
        { campanha: C, conjunto: S, anuncio: A },
      ],
      // Utmify ("nome|id", com %7C): conjunto no utm_medium; o utm_term e posicionamento.
      [
        `https://loja.shop/?utm_source=FB&utm_campaign=Camp%20X%7C${C}&utm_medium=Conj%7c${S}&utm_content=Ad+1%7C${A}&utm_term=Instagram_Feed`,
        { campanha: C, conjunto: S, anuncio: A },
      ],
      // Google: so o gad_campaignid; utm_term com digitos nao e conjunto fora do Meta.
      [
        "https://loja.shop/p?gclid=Cj0KCQ&gad_source=1&gad_campaignid=2233445566&utm_term=7654321",
        { campanha: "2233445566", conjunto: null, anuncio: null },
      ],
      // TikTok com ttclid: o utm_term nao e conjunto, mesmo com utm_source=fb.
      [
        `https://loja.shop/p?utm_source=fb&utm_campaign=${C}&utm_term=${S}&ttclid=E.C.P.abc`,
        { campanha: C, conjunto: null, anuncio: null },
      ],
      // "@" derruba o valor inteiro; o utm_id cobre a campanha.
      [`https://loja.shop/p?utm_campaign=x%40y.com%7C${C}&utm_id=${S}`, { campanha: S, conjunto: null, anuncio: null }],
      // Nome codificado ainda e a chave (%75 = u, %5F = _).
      [`https://loja.shop/p?%75tm%5Fcampaign=${C}&UTM_CONTENT=${A}`, { campanha: C, conjunto: null, anuncio: null }],
      // Depois do '#' nao e query.
      [`https://loja.shop/p#a?utm_campaign=${C}`, { campanha: null, conjunto: null, anuncio: null }],
      // Sem query.
      ["https://loja.shop/products/x", { campanha: null, conjunto: null, anuncio: null }],
    ];
    // Cortada em 500 no meio do utm_content: ele sai; o fbclid inteiro no fim fica.
    const longa = `https://loja.shop/p?utm_source=fb&utm_campaign=${C}&utm_term=${S}&pad=${"x".repeat(420)}&utm_content=${A}`.slice(0, 500);
    casos.push([longa, { campanha: C, conjunto: S, anuncio: null }]);
    const comFbclid = `https://loja.shop/p?utm_campaign=${C}&utm_medium=paid&utm_source=ig&utm_term=${S}&pad=${"x".repeat(175)}&fbclid=${aem}`;
    expect(comFbclid.length).toBeGreaterThanOrEqual(CORTE);
    casos.push([comFbclid, { campanha: C, conjunto: S, anuncio: null }]);
    for (const [url, esperado] of casos) {
      expect(anuncioDoTs(url), url).toEqual(esperado);
      expect(anuncioComoSql(url), url).toEqual(esperado);
    }
  });

  it("paridade: o SQL le a URL do evento exatamente como o TS", () => {
    const visto = { campanha: 0, conjuntoPeloTermo: 0, cortadas: 0, longas: 0, nomeCodificado: 0 };
    fc.assert(
      fc.property(urlDoEvento, (url) => {
        const ts = anuncioDoTs(url);
        const sql = anuncioComoSql(url);
        expect(sql, url).toEqual(ts);
        for (const v of Object.values(sql)) if (v !== null) expect(v).toMatch(reId);
        if (sql.campanha) visto.campanha++;
        const termo = idDe(utmDeParametros(parametrosDaUrl(url, CORTE_PAGINA)).term);
        if (sql.conjunto && sql.conjunto === termo) visto.conjuntoPeloTermo++;
        if (u16(trimSql(url)) >= CORTE) visto.cortadas++;
        const p = parametrosDaUrl(url, CORTE_PAGINA);
        if ([...p.keys()].some((k) => k.startsWith("utm_") && (p.get(k) ?? "").length > MAX_VALOR_UTM)) visto.longas++;
        if (/[?&](?:[a-z_]*%[0-9A-Fa-f]{2})+[a-z_]*=/.test(url) && sql.campanha) visto.nomeCodificado++;
      }),
      { numRuns: 6000 }
    );
    // O gerador chega nos casos que importam.
    expect(visto.campanha).toBeGreaterThan(300);
    expect(visto.conjuntoPeloTermo).toBeGreaterThan(30);
    expect(visto.cortadas).toBeGreaterThan(300);
    expect(visto.longas).toBeGreaterThan(30);
    expect(visto.nomeCodificado).toBeGreaterThan(30);
  });

  // O caso da revisao: a original (cortada pelo coletor no meio do utm_content)
  // tem o ttclid no meio; a page.url sai sem ele, curta -- e o corte de 495 nao
  // a via. Gravava '18451234', 8 dos 16 digitos de um anuncio que nao existe.
  it("page.url do TikTok: o id cortado pela metade na original nao sai", () => {
    const ttclid = `E.C.P.Cs${"A".repeat(180)}`;
    const base = (pad: string) =>
      `https://loja.shop/products/meia-compressao-feminina-premium?utm_source=tiktok&utm_medium=1845123456789013&utm_campaign=1845123456789012&ttclid=${ttclid}&pad=${pad}&_pos=1&_sid=abc123&_ss=r&variant=4512345678901&utm_content=1845123456789014`;
    const inicio = base("").indexOf("utm_content=") + "utm_content=".length;
    const original = base("x".repeat(CORTE_PAGINA - 8 - inicio)).slice(0, CORTE_PAGINA);
    expect(original.endsWith("utm_content=18451234")).toBe(true);
    const pagina = urlSemTtclid(original);
    expect(pagina.length).toBeLessThan(CORTE);
    expect(anuncioDoTs(original)).toEqual({ campanha: "1845123456789012", conjunto: "1845123456789013", anuncio: null });
    // A regra do coletor na page.url gravava o pedaco; a do TikTok, nao.
    expect(anuncioComoSql(pagina, false).anuncio).toBe("18451234");
    expect(anuncioComoSql(pagina, true)).toEqual({ campanha: "1845123456789012", conjunto: "1845123456789013", anuncio: null });
    // E o modelo do TikTok (o ttclid vem no fim, depois do utm_term) nao perde nada.
    const modelo = `https://loja.shop/products/meia?${PARAMETROS_URL.tiktok
      .replace("__CAMPAIGN_ID__", "1845123456789012")
      .replace("__AID__", "1845123456789013")
      .replace("__CID__", "1845123456789014")
      .replace("__PLACEMENT__", "placement")}&ttclid=${ttclid}`;
    expect(anuncioComoSql(urlSemTtclid(modelo), true)).toEqual(anuncioDoTs(modelo));
    expect(anuncioDoTs(modelo)).toEqual({ campanha: "1845123456789012", conjunto: "1845123456789013", anuncio: "1845123456789014" });
  });

  it("page.url do TikTok: so pode PERDER um nivel que o TS acha na original, nunca dar outro id", () => {
    const visto = { casos: 0, reescritas: 0, cortadas: 0, comId: 0, iguais: 0, erradasSemARegra: 0 };
    fc.assert(
      fc.property(urlOriginalTiktok, (original) => {
        const pagina = urlSemTtclid(original);
        const ts = anuncioDoTs(original);
        const sql = anuncioComoSql(pagina, true);
        for (const k of ["campanha", "conjunto", "anuncio"] as const) {
          if (sql[k] !== null) expect(sql[k], `${k}: ${original}`).toBe(ts[k]);
        }
        visto.casos++;
        if (pagina !== original) visto.reescritas++;
        if (original.length >= CORTE) visto.cortadas++;
        if (ts.campanha || ts.conjunto || ts.anuncio) visto.comId++;
        if (JSON.stringify(sql) === JSON.stringify(ts)) visto.iguais++;
        const semARegra = anuncioComoSql(pagina, false);
        if ((["campanha", "conjunto", "anuncio"] as const).some((k) => semARegra[k] !== null && semARegra[k] !== ts[k])) {
          visto.erradasSemARegra++;
        }
      }),
      { numRuns: 4000 }
    );
    expect(visto.reescritas).toBeGreaterThan(1000);
    expect(visto.cortadas).toBeGreaterThan(500);
    expect(visto.comId).toBeGreaterThan(2000);
    // A maioria ainda sai inteira; e a regra de antes errava de verdade aqui.
    expect(visto.iguais).toBeGreaterThan(visto.casos / 2);
    expect(visto.erradasSemARegra).toBeGreaterThan(20);
  });

  it("page.url do TikTok: as leituras com e sem o ultimo parametro, e o conjunto com o ttclid", () => {
    expect(anu.corpo).toMatch(/p_do_tiktok or char_length\(e\.b\) \+ char_length\(regexp_replace\(e\.b, '[^']+', '', 'g'\)\) >= \d+ as cortada/);
    expect(anu.corpo).toContain("where p_do_tiktok or f.nome is distinct from (select u.nome from ultimo u) or f.nome = 'fbclid'");
    expect(anu.corpo).toContain("from (values (false), (true)) w(com_tirado)");
    expect(anu.corpo).toContain("where not w.com_tirado or p_do_tiktok");
    expect(anu.corpo).toContain("coalesce(x.meio, case when not x.google and x.fbclid then x.termo end) as conjunto_com_ttclid");
    expect(anu.corpo).toContain(
      "case when count(*) = count(l.conjunto) and min(l.conjunto) = max(l.conjunto) and (not p_do_tiktok or (count(*) = count(l.conjunto_com_ttclid) and min(l.conjunto_com_ttclid) = min(l.conjunto) and max(l.conjunto_com_ttclid) = min(l.conjunto))) then min(l.conjunto) end"
    );
    for (const c of ["campanha", "anuncio"]) {
      expect(anu.corpo).toContain(`case when count(*) = count(l.${c}) and min(l.${c}) = max(l.${c}) then min(l.${c}) end`);
    }
    // Toda subconsulta das leituras escolhe a leitura (com ou sem a tirada).
    const leituras = pegar(anu.corpo, /(leituras as \([\s\S]*\) select case when)/, "leituras");
    const escolhas = leituras.match(/\(w\.com_tirado or not \w\.tirado\)/g) ?? [];
    expect(escolhas).toHaveLength(10);
  });

  it("aplica e confere: privilegios, a passada na fila (com o lock) e o rodape", () => {
    for (const assinatura of ["tracking_anuncio_da_url(text, boolean)", "tracking_arquivar(timestamptz, timestamptz)"]) {
      expect(SQL80).toContain(`revoke all on function public.${assinatura} from public, anon, authenticated;`);
      expect(SQL80).toContain(`grant execute on function public.${assinatura} to service_role;`);
      for (const papel of ["anon", "authenticated", "service_role"]) {
        expect(SQL_080).toContain(`has_function_privilege('${papel}', 'public.${assinatura}', 'execute')`);
      }
    }
    expect(SQL80).not.toMatch(/grant [^;]* to [^;]*(anon|authenticated)/);
    expect(SQL80.match(/create or replace function/g)).toHaveLength(2);
    // A da URL: imutavel, search_path fixo, sem DEFINER.
    const defUrl = SQL80.match(/create or replace function public\.tracking_anuncio_da_url\(([^$]*)as \$\$/)?.[1] ?? "";
    expect(defUrl).toMatch(/^ p_url text, p_do_tiktok boolean, out campanha_id text, out conjunto_id text, out anuncio_id text\) /);
    expect(defUrl).toMatch(/language sql immutable set search_path = public, pg_temp $/);
    expect(defUrl).not.toMatch(/definer/);
    // O tracking_arquivar continua INVOKER, como na 079.
    const def = SQL80.match(/create or replace function public\.tracking_arquivar\(([^$]*)as \$\$/)?.[1] ?? "";
    expect(def).toMatch(/volatile security invoker set search_path = public, pg_temp/);
    // A passada na fila inteira, DEPOIS da funcao nova, com o historico travado
    // contra o purge da hora (um purge com o corpo da 079 devolvia o trio vazio).
    const passada = SQL80.indexOf(
      "set lock_timeout = '10s'; lock table public.tracking_historico in share row exclusive mode; select public.tracking_arquivar(null, null); analyze public.tracking_historico; reset lock_timeout;"
    );
    expect(passada).toBeGreaterThan(SQL80.indexOf("create or replace function public.tracking_arquivar("));
    // O rodape conta o funil com campanha antes x depois.
    expect(SQL_080).toMatch(/count\(\*\) filter \(where campanha_id is not null\) as com_campanha/);
  });
});
