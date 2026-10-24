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
import { FONTES_META, JANELA_ORIGEM_MS, idDe, limparValor } from "@/lib/tracking/utm";

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
  const arquivar = corpoDe(SQL, "tracking_arquivar");

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

  it("do payload, so a marca de teste, o click id (como booleano) e o valor da compra", () => {
    const lidos = caminhosSql(arquivar);
    const permitidos = new Set([
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
  it("no evento com pedido, a campanha segue a origem do pedido; no funil, a gravada vence", () => {
    expect(arquivar).toMatch(/o\.shopify_order_id is not null as com_origem/);
    for (const c of ["campanha_id", "conjunto_id", "anuncio_id"]) {
      expect(arquivar).toContain(`case when n.com_origem then n.${c} else coalesce(a.${c}, n.${c}) end`);
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
  const arquivar = corpoDe(SQL, "tracking_arquivar");

  it("FONTES_META e a mesma lista de utm.ts", () => {
    const lista = arquivar.match(/lower\(btrim\(i\.utm ->> 'source'\)\) in \(([^)]*)\)/)?.[1] ?? "";
    const doSql = lista.split(",").map((v) => v.trim().replace(/^'|'$/g, ""));
    expect(new Set(doSql)).toEqual(new Set(FONTES_META));
  });

  it("o id da UTM (tracking_id_de_utm) e o idDe de utm.ts", () => {
    const corpo = corpoDe(SQL, "tracking_id_de_utm");
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
    const corpo = corpoDe(SQL, "tracking_payload_resumo");
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
  const compactar = corpoDe(SQL, "tracking_compactar_funil");
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
    const pred = corpoDe(SQL, "tracking_arquivar").match(/coalesce\((e\.status = 'enviado' and e\.sent_at is null and .*?), false\) as cancelada/)?.[1];
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
