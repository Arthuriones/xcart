import { describe, expect, it } from "vitest";
import {
  foiLido,
  momentoAtualizado,
  montarFaixa,
  rotuloLeitura,
  type Pendencia,
} from "@/app/(dashboard)/financeiro/lucro-dados";

// A faixa do topo do Lucro (uma linha so) e o "Pedidos e gasto lidos ha X".

const p = (id: string, tom: Pendencia["tom"], extra: Partial<Pendencia> = {}): Pendencia => ({
  id,
  tom,
  titulo: id,
  ...extra,
});

const custo = p("custo", "warn", { acao: { rotulo: "Cadastrar custos", href: "/custos" } });

describe("montarFaixa", () => {
  it("sem nada: sem linha", () => {
    expect(montarFaixa([], [], null)).toEqual({ linha: null, resto: [], total: 0, escondidas: 0 });
  });

  it("sem custo: a mais grave na linha, o resto atras do link, o N conta a linha", () => {
    const f = montarFaixa([p("conta-erro", "err"), p("taxa", "warn"), p("sem-cotacao", "warn")], [], null);
    expect(f.linha?.id).toBe("conta-erro");
    expect(f.resto.map((x) => x.id)).toEqual(["taxa", "sem-cotacao"]);
    expect(f.total).toBe(3);
  });

  it("o aviso de custo e a linha e leva o resto; so a critica passa na frente dele", () => {
    const so = montarFaixa([p("taxa", "warn")], [], custo);
    expect(so.linha?.id).toBe("custo");
    expect(so.resto.map((x) => x.id)).toEqual(["taxa"]);
    expect(so.total).toBe(2);

    const comCritica = montarFaixa([p("desinstalado", "err"), p("taxa", "warn")], [], custo);
    expect(comCritica.linha?.id).toBe("desinstalado");
    expect(comCritica.resto.map((x) => x.id)).toEqual(["custo", "taxa"]);
  });

  it("dispensada sai e conta como escondida; a que nao e dispensavel fica", () => {
    const itens = [p("sem-conta-anuncio:a", "warn", { dispensavel: true }), p("taxa", "warn")];
    const f = montarFaixa(itens, ["sem-conta-anuncio:a", "taxa"], null);
    expect(f.linha?.id).toBe("taxa");
    expect(f.resto).toEqual([]);
    expect(f.escondidas).toBe(1);

    const tudoDispensado = montarFaixa([itens[0]], ["sem-conta-anuncio:a"], null);
    expect(tudoDispensado.linha).toBeNull();
    expect(tudoDispensado.escondidas).toBe(1);
  });
});

describe("rotuloLeitura", () => {
  const agora = Date.parse("2026-10-27T12:00:00Z");

  it("diz so o que o filtro le", () => {
    expect(rotuloLeitura(agora - 12 * 60_000, agora, { pedidos: true, gasto: true })).toBe(
      "Pedidos e gasto lidos há 12 min"
    );
    expect(rotuloLeitura(agora - 3 * 3_600_000, agora, { pedidos: true, gasto: false })).toBe("Pedidos lidos há 3 h");
    expect(rotuloLeitura(agora - 10_000, agora, { pedidos: false, gasto: true })).toBe("Gasto lido agora");
  });

  it("nada lido, ou nada que se leia (so checkout externo): sem frase", () => {
    expect(rotuloLeitura(null, agora, { pedidos: true, gasto: true })).toBeNull();
    expect(rotuloLeitura(agora, agora, { pedidos: false, gasto: false })).toBeNull();
  });

  it("conta ligada que nunca leu: a hora e a dos pedidos e a frase nao diz gasto", () => {
    const pedidos = ["2026-10-27T11:58:00Z"];
    const gasto = [null];
    const lido = { pedidos: foiLido(pedidos), gasto: foiLido(gasto) };
    expect(lido).toEqual({ pedidos: true, gasto: false });
    expect(rotuloLeitura(momentoAtualizado(pedidos, gasto), agora, lido)).toBe("Pedidos lidos há 2 min");
  });

  it("loja sem rodada ok e conta lida: so o gasto", () => {
    const pedidos = [null, "lixo"];
    const gasto = ["2026-10-27T11:00:00Z"];
    const lido = { pedidos: foiLido(pedidos), gasto: foiLido(gasto) };
    expect(rotuloLeitura(momentoAtualizado(pedidos, gasto), agora, lido)).toBe("Gasto lido há 1 h");
  });
});
