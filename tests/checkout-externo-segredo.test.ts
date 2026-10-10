import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// O token do webhook e a senha do checkout (a Sphere nao assina): a sessao do
// lojista NUNCA le. Aqui se trava a migration (RLS sem policy, grants so do
// service_role) e o codigo (so o service role toca a tabela do segredo, e o
// resumo que vai para a tela nao tem token). E o endpoint publico: 404
// generico para token desconhecido e teto de tamanho do corpo.

const RAIZ = path.resolve(__dirname, "..");
const SQL = readFileSync(path.join(RAIZ, "supabase/migrations/069_checkouts_externos.sql"), "utf8")
  // So o que roda: comentario nao conta como garantia.
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

describe("migration 069: o segredo nao sai pela sessao", () => {
  it("checkout_externo_segredos: RLS ligada e ZERO policy", () => {
    expect(SQL).toMatch(/alter table public\.checkout_externo_segredos enable row level security;/);
    expect(SQL).not.toMatch(/create policy[^;]*on public\.checkout_externo_segredos/);
  });

  it("os dois caminhos de privilegio fechados; so o service_role entra", () => {
    expect(SQL).toMatch(/revoke all on table public\.checkout_externo_segredos from public, anon, authenticated;/);
    const grants = SQL.match(/grant [^;]*on table public\.checkout_externo_segredos to [^;]*;/g) ?? [];
    expect(grants).toEqual(["grant select, insert, update, delete on table public.checkout_externo_segredos to service_role;"]);
  });

  it("as tabelas do lojista: le pela RLS, com WITH CHECK, e a sessao nao escreve", () => {
    for (const t of ["checkouts_externos", "pedidos_externos", "checkout_externo_eventos"]) {
      expect(SQL).toMatch(new RegExp(`alter table public\\.${t} enable row level security;`));
      const policy = SQL.match(new RegExp(`create policy "[^"]+" on public\\.${t}[^;]*;`))?.[0] ?? "";
      expect(policy).toMatch(/using \(\(select auth\.uid\(\)\) = user_id\)/);
      expect(policy).toMatch(/with check/);
    }
    expect(SQL).toMatch(
      /revoke insert, update, delete on table\s+public\.checkouts_externos, public\.pedidos_externos, public\.checkout_externo_eventos\s+from public, anon, authenticated;/
    );
  });

  it("o dono do pedido e o do checkout, mesmo pelo service role (FK composta)", () => {
    expect(SQL).toMatch(/foreign key \(checkout_id, user_id\)\s+references public\.checkouts_externos \(id, user_id\) on delete cascade/);
    expect(SQL).toMatch(/on delete set null \(checkout_id\)/);
    expect(SQL).toMatch(/check \(store_id is null or checkout_id is null\)/);
  });

  it("a policy nova de ad_accounts confere o checkout na linha nova", () => {
    const p = SQL.match(/create policy "Dono le ad_accounts"[^;]*;/)?.[0] ?? "";
    expect(p).toMatch(/with check/);
    expect(p).toMatch(/public\.checkouts_externos c/);
    expect(p).toMatch(/public\.stores s/);
  });
});

function arquivos(dir: string): string[] {
  const saida: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) saida.push(...arquivos(p));
    else if (/\.tsx?$/.test(p)) saida.push(p);
  }
  return saida;
}

describe("codigo: so o service role toca o segredo", () => {
  it("toda leitura de checkout_externo_segredos sai de um cliente admin", () => {
    const usos: string[] = [];
    for (const f of arquivos(path.join(RAIZ, "src"))) {
      const texto = readFileSync(f, "utf8");
      const re = /(\w+)\s*\.from\("checkout_externo_segredos"\)/g;
      for (let m = re.exec(texto); m; m = re.exec(texto)) {
        usos.push(path.relative(RAIZ, f).replace(/\\/g, "/"));
        expect(m[1], `${f}: ${m[0]}`).toBe("admin");
      }
    }
    expect(usos.length).toBeGreaterThan(0);
    // Nenhum arquivo de tela (client) ou leitura de sessao le o segredo.
    expect(usos.some((u) => u.includes("/(dashboard)/"))).toBe(false);
    expect(usos.some((u) => u.startsWith("src/lib/leitura/"))).toBe(false);
  });

  it("o que vai para a tela nao tem token", async () => {
    const { COLUNAS_CHECKOUT, resumoDoCheckout } = await import("@/lib/checkouts-externos/tipos");
    expect(COLUNAS_CHECKOUT).not.toMatch(/token/);
    const r = resumoDoCheckout({
      id: "c",
      user_id: "u",
      plataforma: "sphere",
      nome: "X",
      ativo: true,
      moeda_receita: "EUR",
      fuso: "UTC",
      taxa_aprovacao_padrao: "70.00",
      conta_externa: null,
      notificar_aprovada: false,
      ultimo_evento_em: null,
      ultimo_evento: null,
      ultimo_evento_teste: false,
      ultimo_erro: null,
      ultimo_erro_em: null,
      token: "segredo-que-nao-pode-sair",
    } as never);
    expect(JSON.stringify(r)).not.toMatch(/segredo-que-nao-pode-sair|token/);
    expect(r.taxa_aprovacao_padrao).toBe(70);
  });
});

// ---------------------------------------------------------------------------
// O endpoint publico
// ---------------------------------------------------------------------------

const estado = {
  checkout: null as null | Record<string, unknown>,
  chamadasToken: [] as string[],
};

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/checkouts-externos/notificar", () => ({ notificarPedidoExterno: async () => undefined }));
vi.mock("@/lib/checkouts-externos/repo-supabase", () => ({
  checkoutDoToken: async (_admin: unknown, token: string) => {
    estado.chamadasToken.push(token);
    return /^[A-Za-z0-9_-]{43}$/.test(token) ? estado.checkout : null;
  },
  repositorioSupabase: () => ({
    travarEvento: async () => "ok",
    soltarEvento: async () => undefined,
    lerPedido: async () => null,
    inserirPedido: async () => "ok",
    atualizarPedido: async () => true,
    fixarConta: async () => "ok",
    marcarCheckout: async () => undefined,
  }),
}));
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: (fn: () => unknown) => void fn(),
}));

const TOKEN = "a".repeat(43);

async function post(token: string, corpo: string, headers: Record<string, string> = {}) {
  const { POST } = await import("@/app/api/webhooks/checkout/[token]/route");
  return POST(new Request(`https://user.xcart.app/api/webhooks/checkout/${token}`, { method: "POST", body: corpo, headers }), {
    params: Promise.resolve({ token }),
  });
}

describe("POST /api/webhooks/checkout/[token]", () => {
  beforeEach(() => {
    estado.checkout = null;
    estado.chamadasToken = [];
  });
  afterEach(() => vi.clearAllMocks());

  it("token desconhecido ou torto: 404 generico, igual nos dois casos", async () => {
    const a = await post(TOKEN, "{}");
    const b = await post("nao-e-token", "{}");
    expect(a.status).toBe(404);
    expect(b.status).toBe(404);
    expect(await a.json()).toEqual(await b.json());
  });

  it("corpo acima de 64 KB: 413", async () => {
    estado.checkout = { id: "ck", user_id: "u", plataforma: "sphere", nome: "S", ativo: true, fuso: "UTC", moeda_receita: "EUR", conta_externa: null, notificar_aprovada: false };
    const grande = JSON.stringify({ evento: "pedido.criado", lixo: "x".repeat(65 * 1024) });
    const r = await post(TOKEN, grande);
    expect(r.status).toBe(413);
  });

  it("token certo e corpo da Sphere: 200", async () => {
    estado.checkout = {
      id: "ck",
      user_id: "u",
      plataforma: "sphere",
      nome: "Sphere",
      ativo: true,
      fuso: "Europe/Rome",
      moeda_receita: "EUR",
      conta_externa: null,
      notificar_aprovada: false,
    };
    const agora = new Date().toISOString();
    const r = await post(
      TOKEN,
      JSON.stringify({
        evento: "pedido.criado",
        data_evento: agora,
        pedido: { id: 1, moeda: "EUR", valor: "10.00", criado_em: agora },
        comissao: { valor: "5.00", status: "pending" },
        afiliado: { codigo: "abc" },
      })
    );
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
  });

  it("corpo que nao e JSON: 400", async () => {
    estado.checkout = { id: "ck", user_id: "u", plataforma: "sphere", nome: "S", ativo: true, fuso: "UTC", moeda_receita: "EUR", conta_externa: null, notificar_aprovada: false };
    const r = await post(TOKEN, "nao e json");
    expect(r.status).toBe(400);
  });

  it("GET so diz o que a URL e, sem banco", async () => {
    const { GET } = await import("@/app/api/webhooks/checkout/[token]/route");
    const r = GET();
    expect(r.status).toBe(200);
    expect(estado.chamadasToken).toEqual([]);
  });
});
