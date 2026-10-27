import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { avisoDoPuxar, sincronizar } from "../src/app/(dashboard)/financeiro/pendencias";

// ============================================================================
// "Atualizar agora" / "Puxar agora" do Lucro (pendencias.tsx):
//   - toast verde "Numeros atualizados" so quando leu alguma loja ou conta;
//     tudo pulado (lido ha menos de um minuto, ou o cron lendo agora) e toast
//     neutro, porque a tela nao muda;
//   - o toast espera o refresh da tela: sai do efeito, quando o pendente da
//     transicao volta a false, nao logo depois do POST.
// ============================================================================

const RAIZ = path.resolve(__dirname, "..");

function resposta(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
}

function stubFetch(pedidos: Response | Error, meta: Response | Error) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const r = url.includes("meta") ? meta : pedidos;
      if (r instanceof Error) throw r;
      return r;
    })
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("avisoDoPuxar", () => {
  it("leu alguma coisa: verde", () => {
    expect(avisoDoPuxar({ falhou: false, lidas: 2, linhas: ["Pedidos: 2 lojas lidas", "Meta: 0 contas lidas"] })).toEqual({
      tom: "ok",
      titulo: "Números atualizados",
      descricao: "Pedidos: 2 lojas lidas\nMeta: 0 contas lidas",
    });
  });

  it("nada lido e nada falhou: neutro, nunca 'Números atualizados'", () => {
    const a = avisoDoPuxar({ falhou: false, lidas: 0, linhas: ["x"] });
    expect(a.tom).toBe("neutro");
    expect(a.titulo).toBe("Nada novo para ler agora");
  });

  it("falha vence: aviso, mesmo com algo lido", () => {
    expect(avisoDoPuxar({ falhou: true, lidas: 3, linhas: [] }).tom).toBe("aviso");
    expect(avisoDoPuxar({ falhou: true, lidas: 0, linhas: [] }).titulo).toBe("Atualização incompleta");
  });
});

describe("sincronizar + avisoDoPuxar", () => {
  it("as duas rotas pularam tudo (trava do cron ou lido ha pouco): neutro", async () => {
    stubFetch(
      resposta({ ok: true, processadas: 0, puladas: 1, erros: [] }),
      resposta({ ok: true, processadas: 0, puladas: 2, erros: [] })
    );
    const r = await sincronizar();
    expect(r).toMatchObject({ falhou: false, lidas: 0 });
    expect(r.linhas[0]).toMatch(/^Pedidos: lido há menos de um minuto ou sendo lido agora/);
    expect(avisoDoPuxar(r).tom).toBe("neutro");
  });

  it("pedidos leu, Meta pulou: verde", async () => {
    stubFetch(
      resposta({ ok: true, processadas: 1, puladas: 0, erros: [] }),
      resposta({ ok: true, processadas: 0, puladas: 1, erros: [] })
    );
    const r = await sincronizar();
    expect(r).toMatchObject({ falhou: false, lidas: 1 });
    expect(r.linhas[0]).toBe("Pedidos: 1 loja lida");
    expect(avisoDoPuxar(r).titulo).toBe("Números atualizados");
  });

  it("sem loja nem conta (0 lidas, 0 puladas): neutro", async () => {
    stubFetch(
      resposta({ ok: true, processadas: 0, puladas: 0, erros: [] }),
      resposta({ ok: true, processadas: 0, puladas: 0, erros: [] })
    );
    expect(avisoDoPuxar(await sincronizar()).tom).toBe("neutro");
  });

  it("rede caiu numa rota: aviso", async () => {
    stubFetch(resposta({ ok: true, processadas: 2, puladas: 0, erros: [] }), new TypeError("Failed to fetch"));
    const r = await sincronizar();
    expect(r.falhou).toBe(true);
    expect(r.lidas).toBe(2);
    expect(avisoDoPuxar(r).tom).toBe("aviso");
  });
});

describe("o toast espera o refresh", () => {
  const fonte = readFileSync(path.join(RAIZ, "src", "app", "(dashboard)", "financeiro", "pendencias.tsx"), "utf8");

  it("o pendente da transicao entra no estado do botao", () => {
    expect(fonte).not.toMatch(/const \[, startTransition\] = useTransition\(\)/);
    expect(fonte).toMatch(/const \[recarregando, startTransition\] = useTransition\(\)/);
    expect(fonte).toMatch(/const puxando = lendo \|\| recarregando;/);
  });

  it("nenhum toast dentro do puxar: so no efeito, depois do refresh", () => {
    const puxar = fonte.match(/async function puxar\(\) \{[\s\S]*?\n  \}\n/)?.[0] ?? "";
    expect(puxar).toContain("router.refresh()");
    expect(puxar).not.toMatch(/toast|mostrarAviso/);
    const efeito = fonte.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[lendo, recarregando\]\);/)?.[0] ?? "";
    expect(efeito).toMatch(/if \(lendo \|\| recarregando \|\| !aviso\.current\) return;/);
    expect(efeito).toContain("mostrarAviso(aviso.current)");
  });
});
