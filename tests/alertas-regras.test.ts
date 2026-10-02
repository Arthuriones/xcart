import { describe, expect, it } from "vitest";
import {
  FALSOS_PARA_RESOLVER,
  LIMITE_MENSAGEM,
  RENOTIFICAR_CRITICO_MS,
  chaveDoAlerta,
  montarMensagem,
  planejar,
  type CondicaoAlerta,
} from "@/lib/alertas/regras";
import type { AlertaRow } from "@/lib/financeiro/tipos";

const AGORA = new Date("2026-10-02T12:00:00Z");
const LOJA = "11111111-1111-4111-8111-111111111111";

function cond(p: Partial<CondicaoAlerta> = {}): CondicaoAlerta {
  return {
    user_id: "u1",
    store_id: LOJA,
    regra: "fila_travada",
    chave: "",
    severidade: "critico",
    titulo: "Fila de envio parada",
    detalhe: "3 eventos esperando",
    ...p,
  };
}

function aberto(p: Partial<AlertaRow> = {}): AlertaRow {
  return {
    id: "a1",
    user_id: "u1",
    store_id: LOJA,
    regra: "fila_travada",
    chave: "",
    severidade: "critico",
    titulo: "Fila de envio parada",
    detalhe: null,
    aberto_em: "2026-10-02T10:00:00Z",
    confirmado_em: "2026-10-02T11:50:00Z",
    falsos_seguidos: 0,
    notificado_em: "2026-10-02T10:00:00Z",
    n_notificacoes: 1,
    silenciado_ate: null,
    resolvido_em: null,
    ...p,
  };
}

const COM_AVISOS = { receberAvisos: true };

describe("planejar", () => {
  it("condicao nova critica abre e notifica", () => {
    const p = planejar([], [cond()], AGORA, { receberAvisos: false });
    expect(p.abrir).toHaveLength(1);
    expect(p.notificarAbertura).toHaveLength(1);
    expect(p.confirmar).toHaveLength(0);
  });

  it("aviso novo com receberAvisos=false abre sem notificar", () => {
    const c = cond({ regra: "pedidos_sync_erro", severidade: "aviso" });
    const p = planejar([], [c], AGORA, { receberAvisos: false });
    expect(p.abrir).toHaveLength(1);
    expect(p.notificarAbertura).toHaveLength(0);
  });

  it("condicao ativa ja aberta confirma e nao renotifica antes de 6 h", () => {
    const a = aberto({ notificado_em: new Date(AGORA.getTime() - 5 * 3600 * 1000).toISOString() });
    const p = planejar([a], [cond({ detalhe: "novo" })], AGORA, COM_AVISOS);
    expect(p.abrir).toHaveLength(0);
    expect(p.confirmar).toEqual([{ id: "a1", titulo: "Fila de envio parada", detalhe: "novo" }]);
    expect(p.renotificar).toHaveLength(0);
  });

  it("renotifica critico depois de 6 h", () => {
    const a = aberto({
      notificado_em: new Date(AGORA.getTime() - RENOTIFICAR_CRITICO_MS - 1000).toISOString(),
    });
    const p = planejar([a], [cond()], AGORA, COM_AVISOS);
    expect(p.renotificar.map((r) => r.id)).toEqual(["a1"]);
  });

  it("silenciado_ate no futuro bloqueia a renotificacao", () => {
    const a = aberto({
      notificado_em: "2026-10-01T00:00:00Z",
      silenciado_ate: new Date(AGORA.getTime() + 3600 * 1000).toISOString(),
    });
    const p = planejar([a], [cond()], AGORA, COM_AVISOS);
    expect(p.confirmar).toHaveLength(1);
    expect(p.renotificar).toHaveLength(0);
  });

  it("aviso nunca renotifica", () => {
    const a = aberto({
      regra: "pedidos_sync_erro",
      severidade: "aviso",
      notificado_em: "2026-09-20T00:00:00Z",
    });
    const c = cond({ regra: "pedidos_sync_erro", severidade: "aviso" });
    const p = planejar([a], [c], AGORA, COM_AVISOS);
    expect(p.confirmar).toHaveLength(1);
    expect(p.renotificar).toHaveLength(0);
  });

  it("aberto sem condicao conta 1 falso e fecha no segundo", () => {
    const p1 = planejar([aberto()], [], AGORA, COM_AVISOS);
    expect(p1.contarFalso).toEqual([{ id: "a1", falsos: 1 }]);
    expect(p1.resolver).toHaveLength(0);

    const p2 = planejar([aberto({ falsos_seguidos: FALSOS_PARA_RESOLVER - 1 })], [], AGORA, COM_AVISOS);
    expect(p2.contarFalso).toHaveLength(0);
    expect(p2.resolver.map((r) => r.id)).toEqual(["a1"]);
  });

  it("a mesma condicao duas vezes abre uma so", () => {
    const p = planejar([], [cond(), cond()], AGORA, COM_AVISOS);
    expect(p.abrir).toHaveLength(1);
  });
});

describe("chaveDoAlerta", () => {
  it("distingue loja nula", () => {
    const daConta = chaveDoAlerta({ store_id: null, regra: "fila_travada", chave: "" });
    const daLoja = chaveDoAlerta({ store_id: LOJA, regra: "fila_travada", chave: "" });
    expect(daConta).not.toBe(daLoja);
    expect(daConta.startsWith("-|")).toBe(true);
  });

  it("aberto da conta inteira nao casa com condicao de loja", () => {
    const a = aberto({ store_id: null });
    const p = planejar([a], [cond()], AGORA, COM_AVISOS);
    expect(p.abrir).toHaveLength(1);
    expect(p.contarFalso).toEqual([{ id: "a1", falsos: 1 }]);
  });
});

describe("montarMensagem", () => {
  const nomeDaLoja = (id: string | null) => (id ? "Lash Bestie · qkgknv-w3" : "todas as lojas");

  it("junta novos e resolvidos", () => {
    const m = montarMensagem({
      novos: [cond({ titulo: "Gastou R$ 50,00 sem vender hoje", detalhe: "confira" })],
      renotificar: [],
      resolvidos: [aberto({ titulo: "Fila de envio parada" })],
      nomeDaLoja,
    });
    expect(m).not.toBeNull();
    expect(m!.silenciosa).toBe(false);
    const linhas = m!.texto.split("\n");
    expect(linhas[0]).toBe("xcart — 1 alerta");
    expect(linhas[1]).toBe("[CRITICO] Gastou R$ 50,00 sem vender hoje — Lash Bestie · qkgknv-w3: confira");
    expect(linhas[2]).toBe("Resolvido: Fila de envio parada — Lash Bestie · qkgknv-w3");
  });

  it("aviso sai como [AVISO] e depois dos criticos", () => {
    const m = montarMensagem({
      novos: [
        cond({ severidade: "aviso", titulo: "Pedidos sem atualizar", detalhe: null }),
        cond({ titulo: "Fila parada", detalhe: null }),
      ],
      renotificar: [],
      resolvidos: [],
      nomeDaLoja,
    });
    const linhas = m!.texto.split("\n");
    expect(linhas[0]).toBe("xcart — 2 alertas");
    expect(linhas[1].startsWith("[CRITICO] Fila parada")).toBe(true);
    expect(linhas[2]).toBe("[AVISO] Pedidos sem atualizar — Lash Bestie · qkgknv-w3");
  });

  it("corta em 4000 com '… e mais N'", () => {
    const novos = Array.from({ length: 100 }, (_, i) =>
      cond({ chave: String(i), titulo: `Alerta ${i}`, detalhe: "x".repeat(200) })
    );
    const m = montarMensagem({ novos, renotificar: [], resolvidos: [], nomeDaLoja });
    expect(m!.texto.length).toBeLessThanOrEqual(LIMITE_MENSAGEM);
    const ultima = m!.texto.split("\n").at(-1)!;
    const casou = ultima.match(/^… e mais (\d+)$/);
    expect(casou).not.toBeNull();
    const mostradas = m!.texto.split("\n").filter((l) => l.startsWith("[CRITICO]")).length;
    expect(mostradas + Number(casou![1])).toBe(100);
  });

  it("so resolvidos da silenciosa=true", () => {
    const m = montarMensagem({
      novos: [],
      renotificar: [],
      resolvidos: [aberto()],
      nomeDaLoja,
    });
    expect(m!.silenciosa).toBe(true);
    expect(m!.texto.split("\n")[0]).toBe("xcart — 1 resolvido");
  });

  it("nada da null", () => {
    expect(montarMensagem({ novos: [], renotificar: [], resolvidos: [], nomeDaLoja })).toBeNull();
  });
});
