import { describe, expect, it } from "vitest";
import {
  ESPERA_LOJA_FORA_DO_AR_MS,
  cronPodeTentar,
  foraDoAr,
  lerConsertoDoDestino,
  mensagemForaDoAr,
  motivoDaSaude,
} from "@/lib/checkout-routes/loja-fora-do-ar";
import { conferirPares, type ParParaConferir } from "@/lib/checkout-routes/conserto-regras";
import {
  avisosDaConferencia,
  estadoDaLoja,
  estadoDaRota,
  fraseDoConserto,
} from "@/app/(dashboard)/clone/routed-checkout/logica";

// ============================================================================
// As regras sem rede de "loja que o conserto nao atende" e da conferencia dos
// pares (preco diferente, variante que o checkout nao vende), e o que a tela
// mostra a partir delas.
// ============================================================================

const AGORA = Date.parse("2026-10-08T12:00:00Z");

describe("motivo tipado a partir da saude da loja", () => {
  it("402 = pausada; app removido ou credencial = sem app; 404 = fechada", () => {
    expect(motivoDaSaude("congelada")).toBe("loja_pausada");
    expect(motivoDaSaude("desinstalado")).toBe("sem_app");
    expect(motivoDaSaude("sem_acesso")).toBe("sem_app");
    expect(motivoDaSaude("nao_encontrada")).toBe("loja_fechada");
  });

  it("erro generico (rede) nao vira motivo: pode ser passageiro", () => {
    expect(motivoDaSaude("erro")).toBeNull();
    expect(motivoDaSaude(undefined)).toBeNull();
  });

  it("a frase diz a loja, o lado e o que fazer", () => {
    expect(mensagemForaDoAr("vitrine_fechada", "vitrine", "zapas.myshopify.com")).toContain(
      "A vitrine zapas.myshopify.com está com senha"
    );
    expect(mensagemForaDoAr("loja_pausada", "checkout", "pay.myshopify.com")).toContain("não abre para o comprador");
    expect(mensagemForaDoAr("sem_app", "checkout", "pay.myshopify.com")).toContain("Reconecte a loja em Lojas");
  });
});

describe("espera do cron", () => {
  it("sem espera marcada: pode", () => {
    expect(cronPodeTentar({}, AGORA)).toBe(true);
    expect(cronPodeTentar(null, AGORA)).toBe(true);
    expect(cronPodeTentar({ last_heal: { ok: false } }, AGORA)).toBe(true);
  });

  it("dentro das 12 h: nao pode; depois: pode", () => {
    const settings = { last_heal: foraDoAr("loja_pausada", "checkout", AGORA) };
    expect(cronPodeTentar(settings, AGORA + 60_000)).toBe(false);
    expect(cronPodeTentar(settings, AGORA + ESPERA_LOJA_FORA_DO_AR_MS - 1)).toBe(false);
    expect(cronPodeTentar(settings, AGORA + ESPERA_LOJA_FORA_DO_AR_MS)).toBe(true);
  });

  it("data ilegivel no jsonb nao trava o destino para sempre", () => {
    expect(cronPodeTentar({ last_heal: { proximaTentativa: "amanha" } }, AGORA)).toBe(true);
    expect(cronPodeTentar({ last_heal: { proximaTentativa: 123 } }, AGORA)).toBe(true);
  });
});

function par(
  over: Partial<Omit<ParParaConferir, "checkout">> & { checkout?: Partial<ParParaConferir["checkout"]> } = {}
): ParParaConferir {
  return {
    produto: "Tenis",
    variante: "40",
    sku: "t40",
    precoVitrine: "199.90",
    ...over,
    checkout: { produto: "Calcado esportivo", preco: "199.90", status: "ACTIVE", naLojaVirtual: true, disponivel: true, ...over.checkout },
  };
}

describe("conferencia dos pares", () => {
  it("compara em centavos: 199.9 e 199.90 sao o mesmo preco", () => {
    const c = conferirPares([par({ checkout: { preco: "199.9" } })], { vitrine: "BRL", checkout: "BRL" });
    expect(c.precoDiferente).toEqual({ total: 0, moeda: "BRL", exemplos: [] });
  });

  it("conta todos e guarda so 3 exemplos", () => {
    const pares = Array.from({ length: 5 }, (_, i) => par({ sku: `t${i}`, checkout: { preco: "149.90" } }));
    const c = conferirPares(pares, { vitrine: "BRL", checkout: "BRL" });
    expect(c.precoDiferente?.total).toBe(5);
    expect(c.precoDiferente?.exemplos).toHaveLength(3);
    expect(c.precoDiferente?.exemplos[0]).toMatchObject({ vitrine: "199.90", checkout: "149.90" });
  });

  it("moeda diferente ou desconhecida: nao compara", () => {
    const pares = [par({ checkout: { preco: "10.00" } })];
    expect(conferirPares(pares, { vitrine: "BRL", checkout: "USD" }).precoDiferente).toBeNull();
    expect(conferirPares(pares, { vitrine: "BRL", checkout: undefined }).precoDiferente).toBeNull();
  });

  it("uma variante, um motivo: inativo ganha de fora da loja e de sem estoque", () => {
    const c = conferirPares(
      [
        par({ sku: "1", checkout: { status: "DRAFT", naLojaVirtual: false, disponivel: false } }),
        par({ sku: "2", checkout: { naLojaVirtual: false, disponivel: false } }),
        par({ sku: "3", checkout: { disponivel: false } }),
        par({ sku: "4" }),
      ],
      { vitrine: "BRL", checkout: "BRL" }
    );
    expect(c.indisponiveis).toMatchObject({ total: 3, inativo: 1, foraDaLoja: 1, semEstoque: 1 });
    expect(c.indisponiveis.exemplos.map((e) => e.motivo)).toEqual(["inativo", "fora_da_loja", "sem_estoque"]);
    expect(c.conferidas).toBe(4);
  });

  it("campo que nao veio da Shopify nao conta como problema", () => {
    const c = conferirPares([par({ checkout: { status: null, naLojaVirtual: undefined, disponivel: undefined } })], {});
    expect(c.indisponiveis.total).toBe(0);
  });
});

describe("leitura do settings.last_heal do destino", () => {
  it("le o fora do ar e a conferencia gravados pelo conserto", () => {
    const c = lerConsertoDoDestino({
      at: "2026-10-08T10:00:00Z",
      ok: false,
      motivo: "loja_pausada",
      lado: "checkout",
      conferencia: {
        precoDiferente: { total: 2, moeda: "BRL", exemplos: [{ produto: "Tenis", variante: "40", sku: "t", vitrine: "1.00", checkout: "2.00" }] },
        indisponiveis: { total: 1, inativo: 1, foraDaLoja: 0, semEstoque: 0, exemplos: [{ produto: "X", variante: "", sku: "s", motivo: "inativo" }] },
      },
    });
    expect(c?.foraDoAr).toEqual({ motivo: "loja_pausada", lado: "checkout" });
    expect(c?.precoDiferente?.total).toBe(2);
    expect(c?.indisponiveis?.exemplos[0].motivo).toBe("inativo");
  });

  it("jsonb torto nao derruba a tela", () => {
    expect(lerConsertoDoDestino(null)).toBeNull();
    expect(lerConsertoDoDestino("x")).toBeNull();
    const c = lerConsertoDoDestino({ motivo: "toString", lado: "checkout", conferencia: { precoDiferente: { total: "9" }, indisponiveis: { exemplos: [{ motivo: "outro" }] } } });
    expect(c?.foraDoAr).toBeNull();
    expect(c?.precoDiferente).toBeNull();
    expect(c?.indisponiveis?.exemplos).toEqual([]);
  });
});

describe("o que a tela mostra", () => {
  const alvo = { enabled: true, weight: 1, mappedSkuCount: 10 };

  it("loja de checkout fora do ar ganha o selo do motivo", () => {
    const conserto = { foraDoAr: { motivo: "loja_pausada" as const, lado: "checkout" as const } };
    expect(estadoDaLoja(true, { ...alvo, conserto: { ...conserto, at: null, precoDiferente: null, indisponiveis: null } })).toEqual({
      tom: "err",
      texto: "Pausada pela Shopify",
    });
    expect(
      estadoDaLoja(true, {
        ...alvo,
        conserto: { at: null, foraDoAr: { motivo: "sem_app", lado: "checkout" }, precoDiferente: null, indisponiveis: null },
      }).texto
    ).toBe("App desconectado");
  });

  it("vitrine com senha nao marca a loja de checkout (o aviso e da rota)", () => {
    const conserto = { at: null, foraDoAr: { motivo: "vitrine_fechada" as const, lado: "vitrine" as const }, precoDiferente: null, indisponiveis: null };
    expect(estadoDaLoja(true, { ...alvo, conserto }).texto).toBe("Recebendo");
  });

  it("loja de checkout ligada e fora do ar deixa a rota em Atenção", () => {
    const conserto = { at: null, foraDoAr: { motivo: "loja_pausada" as const, lado: "checkout" as const }, precoDiferente: null, indisponiveis: null };
    const t = { enabled: true, mappedSkuCount: 10, lastHealedAt: new Date(AGORA - 3_600_000).toISOString() };
    expect(estadoDaRota({ enabled: true, lastHeal: { at: "", ok: true }, targets: [{ ...t, conserto }] }, AGORA)).toBe("atencao");
    expect(estadoDaRota({ enabled: true, lastHeal: { at: "", ok: true }, targets: [{ ...t, conserto: null }] }, AGORA)).toBe("ativa");
  });

  it("loja pausada pelo lojista continua 'Pausada', rota pausada continua 'Rota pausada'", () => {
    const conserto = { at: null, foraDoAr: { motivo: "loja_pausada" as const, lado: "checkout" as const }, precoDiferente: null, indisponiveis: null };
    expect(estadoDaLoja(true, { ...alvo, enabled: false, conserto }).texto).toBe("Pausada");
    expect(estadoDaLoja(false, { ...alvo, conserto }).texto).toBe("Rota pausada");
  });

  it("N variantes com preco diferente da vitrine, com os exemplos em moeda", () => {
    const avisos = avisosDaConferencia({
      precoDiferente: {
        total: 12,
        moeda: "BRL",
        exemplos: [{ produto: "Tenis", variante: "40", sku: "t40", vitrine: "199.90", checkout: "189.90" }],
      },
      indisponiveis: { total: 0, inativo: 0, foraDaLoja: 0, semEstoque: 0, exemplos: [] },
    });
    expect(avisos).toHaveLength(1);
    expect(avisos[0].texto).toBe("12 variantes com preço diferente da vitrine");
    expect(avisos[0].exemplos[0]).toMatch(/^Tenis \/ 40: R\$\s?199,90 na vitrine, R\$\s?189,90 aqui$/);
  });

  it("variantes que o checkout nao vende, com o motivo de cada exemplo", () => {
    const avisos = avisosDaConferencia({
      precoDiferente: null,
      indisponiveis: {
        total: 3,
        inativo: 1,
        foraDaLoja: 0,
        semEstoque: 2,
        exemplos: [{ produto: "Calcado", variante: "40", sku: "s", motivo: "sem_estoque" }],
      },
    });
    expect(avisos[0].texto).toBe("3 variantes que o checkout não vende (1 com produto inativo, 2 sem estoque)");
    expect(avisos[0].exemplos).toEqual(["Calcado / 40: sem estoque"]);
  });

  it("nada contado: nada a dizer", () => {
    expect(avisosDaConferencia(null)).toEqual([]);
    expect(
      avisosDaConferencia({
        precoDiferente: { total: 0, moeda: "BRL", exemplos: [] },
        indisponiveis: { total: 0, inativo: 0, foraDaLoja: 0, semEstoque: 0, exemplos: [] },
      })
    ).toEqual([]);
  });

  it("Corrigir com uma loja de checkout fora do ar: a frase diz qual", () => {
    const frase = fraseDoConserto({
      noop: false,
      lojasForaDoAr: [{ targetId: "b", mensagem: "A loja de checkout b.myshopify.com está pausada ou sem plano na Shopify." }],
    });
    expect(frase).toContain("As outras lojas de checkout já estavam certas.");
    expect(frase).toContain("b.myshopify.com está pausada");
  });
});
