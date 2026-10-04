import { describe, expect, it, vi } from "vitest";

// avaliar.ts tem "server-only" e fala com o Supabase: aqui um cliente falso
// que responde por tabela, so com o que a regra do rastreamento parado le.
vi.mock("server-only", () => ({}));

import { coletarCondicoesDetalhado } from "@/lib/alertas/avaliar";

const AGORA = new Date("2026-10-04T12:00:00Z");
const HORA = 3_600_000;
const LOJA = "11111111-1111-4111-8111-111111111111";

type Filtro = [string, ...unknown[]];

interface Cenario {
  ligado?: boolean;
  desinstalada?: boolean;
  meta?: boolean;
  /** created_at do ultimo evento do tema na semana; null = nenhum. */
  ultimoEvento?: string | null;
  /** Ja ha alerta aberto desta regra para a loja. */
  aberto?: boolean;
}

function admin(c: Cenario) {
  const resolver = (tabela: string, f: Filtro[]): unknown[] => {
    const tem = (m: string, ...args: unknown[]) =>
      f.some((x) => x[0] === m && args.every((a, i) => x[i + 1] === a));
    if (tabela === "stores") {
      return [
        {
          id: LOJA,
          user_id: "u1",
          name: "Loja",
          shop_domain: "loja.myshopify.com",
          uninstalled_at: c.desinstalada ? "2026-10-01T00:00:00Z" : null,
        },
      ];
    }
    if (tabela === "tracking_configs") {
      return c.ligado === false ? [] : [{ store_id: LOJA, enabled: true }];
    }
    if (tabela === "alertas") {
      return c.aberto && tem("eq", "regra", "rastreamento_parado") ? [{ store_id: LOJA }] : [];
    }
    if (tabela === "tracking_destinations") return c.meta === false ? [] : [{ store_id: LOJA }];
    if (tabela === "tracking_events") {
      // So a leitura da regra: ultimo evento com visitante.
      if (!tem("not", "visitor_id", "is", null)) return [];
      const ultimo = c.ultimoEvento ?? null;
      return ultimo ? [{ created_at: ultimo }] : [];
    }
    return [];
  };

  return {
    from(tabela: string) {
      const filtros: Filtro[] = [];
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "gte", "lt", "not", "is", "order", "limit"]) {
        q[m] = (...args: unknown[]) => {
          filtros.push([m, ...args]);
          return q;
        };
      }
      q.then = (ok: (v: unknown) => unknown, erro: (e: unknown) => unknown) =>
        Promise.resolve({ data: resolver(tabela, filtros), error: null }).then(ok, erro);
      return q;
    },
  } as unknown as Parameters<typeof coletarCondicoesDetalhado>[0];
}

async function parado(c: Cenario) {
  const r = await coletarCondicoesDetalhado(admin(c), AGORA);
  expect(r.erros).toEqual([]);
  return r.condicoes.filter((x) => x.regra === "rastreamento_parado");
}

const ha = (h: number) => new Date(AGORA.getTime() - h * HORA).toISOString();

describe("rastreamento parado", () => {
  it("abre aviso quando o ultimo evento da semana passou de 24 h", async () => {
    const c = await parado({ ultimoEvento: ha(30) });
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({
      user_id: "u1",
      store_id: LOJA,
      chave: "",
      severidade: "aviso",
      titulo: "Rastreamento sem eventos há 24 h",
    });
    expect(c[0].detalhe).toContain("30 h");
  });

  it("some quando volta evento (resolve sozinho)", async () => {
    expect(await parado({ ultimoEvento: ha(2) })).toHaveLength(0);
  });

  it("sem evento na semana nao e 'parou agora'", async () => {
    expect(await parado({ ultimoEvento: null })).toHaveLength(0);
    expect(await parado({ ultimoEvento: ha(24 * 8) })).toHaveLength(0);
  });

  it("alerta aberto nao fecha sozinho depois de 7 dias parado", async () => {
    expect(await parado({ ultimoEvento: ha(24 * 8), aberto: true })).toHaveLength(1);
    expect(await parado({ ultimoEvento: null, aberto: true })).toHaveLength(1);
    expect(await parado({ ultimoEvento: ha(2), aberto: true })).toHaveLength(0);
  });

  it("ignora loja desligada, desinstalada ou sem Meta ativo", async () => {
    expect(await parado({ ultimoEvento: ha(30), ligado: false })).toHaveLength(0);
    expect(await parado({ ultimoEvento: ha(30), desinstalada: true })).toHaveLength(0);
    expect(await parado({ ultimoEvento: ha(30), meta: false })).toHaveLength(0);
  });

  it("mais de 2 dias vira dias no detalhe", async () => {
    const [c] = await parado({ ultimoEvento: ha(24 * 3 + 5) });
    expect(c.detalhe).toContain("3 dias");
  });
});
