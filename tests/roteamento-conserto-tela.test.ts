import { describe, expect, it } from "vitest";
import {
  estadoDoTema,
  fraseDoConserto,
  pendenciaDoConserto,
  pendenciasDoConserto,
  temaFicouParaTras,
} from "@/app/(dashboard)/clone/routed-checkout/logica";

// A tela do Diagnostico e da aba Lojas depois das travas do conserto e do
// reenvio automatico ao tema.

describe("conserto que nao criou por causa da trava", () => {
  const barrado = {
    pendingProductCount: 9,
    pendingVariantCount: 12,
    creationBlockedReason: "esta loja de checkout está fora do rodízio",
  };

  it("mostra o que falta, o motivo e o botao de confirmar", () => {
    const p = pendenciaDoConserto(barrado);
    expect(p?.botao).toBe("Criar 9 produtos na loja de checkout");
    expect(p?.texto).toBe(
      "9 produtos da vitrine faltam na loja de checkout e não foram criados sozinhos: esta loja de checkout está fora do rodízio."
    );
  });

  it("singular e so variante", () => {
    expect(pendenciaDoConserto({ pendingProductCount: 1, pendingVariantCount: 1, creationBlockedReason: "x" })?.botao).toBe(
      "Criar 1 produto na loja de checkout"
    );
    expect(
      pendenciaDoConserto({ pendingProductCount: 0, pendingVariantCount: 3, creationBlockedReason: "x" })?.texto
    ).toContain("3 variantes da vitrine faltam");
  });

  it("sem pendencia: nada", () => {
    expect(pendenciaDoConserto({ pendingProductCount: 0, pendingVariantCount: 0, creationBlockedReason: "x" })).toBeNull();
    expect(pendenciaDoConserto({ pendingProductCount: 3 })).toBeNull();
  });

  it("a frase nao diz 'Corrigida.' quando nada foi criado e sobrou pendencia", () => {
    expect(fraseDoConserto({ ...barrado, stampedSkuCount: 2 })).toBe(
      "Corrigida: 2 SKUs gravados na vitrine. 9 produtos da vitrine faltam na loja de checkout e não foram criados sozinhos: esta loja de checkout está fora do rodízio."
    );
    expect(fraseDoConserto(barrado)).toMatch(/^Os pares que já existiam foram ligados\. 9 produtos/);
  });
});

describe("reenvio ao tema depois de mudar loja ou divisao", () => {
  it("so pede o botao quando o reenvio automatico nao chegou", () => {
    expect(temaFicouParaTras({ estado: "atualizado" })).toBe(false);
    expect(temaFicouParaTras({ estado: "em_dia" })).toBe(false);
    expect(temaFicouParaTras({ estado: "sem_config_url" })).toBe(false);
    expect(temaFicouParaTras({ estado: "falhou" })).toBe(true);
    expect(temaFicouParaTras({ estado: "sem_script" })).toBe(true);
    expect(temaFicouParaTras({ estado: "script_de_outra_rota" })).toBe(true);
    // Resposta sem o campo (servidor antigo): melhor mostrar o botao.
    expect(temaFicouParaTras(undefined)).toBe(true);
  });
});

describe("aba Instalacao: o config no tema", () => {
  it("diz se o tema esta em dia, desatualizado ou com o script de outra rota", () => {
    expect(estadoDoTema(null)).toBeNull();
    expect(estadoDoTema({ estado: "atualizado" })?.tom).toBe("ok");
    expect(estadoDoTema({ estado: "sem_config_url" })?.tom).toBe("ok");
    expect(estadoDoTema({ estado: "script_de_outra_rota" })?.tom).toBe("warn");
    expect(estadoDoTema({ estado: "falhou", mensagem: "Shopify REST 403" })?.texto).toBe(
      "Não deu para levar a configuração ao tema (Shopify REST 403). Instale de novo."
    );
  });
});

describe("pendencia por loja de checkout (rodizio)", () => {
  const resposta = {
    pendingProductCount: 49,
    pendingVariantCount: 60,
    creationBlockedReason: "são 49 produtos de uma vez",
    targets: [
      {
        targetId: "t-a",
        targetStoreName: "Loja A",
        pendingProductCount: 40,
        pendingVariantCount: 50,
        creationBlockedReason: "são 40 produtos de uma vez",
      },
      {
        targetId: "t-b",
        targetStoreName: "Loja B",
        pendingProductCount: 9,
        pendingVariantCount: 10,
        creationBlockedReason: "esta loja de checkout está fora do rodízio",
      },
      { targetId: "t-c", targetStoreName: "Loja C", pendingProductCount: 0, pendingVariantCount: 0 },
    ],
  };

  it("um botao por loja, com o nome dela e o motivo DELA", () => {
    const p = pendenciasDoConserto(resposta);
    expect(p.map((x) => x.targetId)).toEqual(["t-a", "t-b"]);
    expect(p[0].botao).toBe("Criar 40 produtos em Loja A");
    expect(p[1].botao).toBe("Criar 9 produtos em Loja B");
    expect(p[1].texto).toBe(
      "9 produtos da vitrine faltam na loja de checkout Loja B e não foram criados sozinhos: esta loja de checkout está fora do rodízio."
    );
  });

  it("uma loja so: o botao leva o targetId, sem nome no texto", () => {
    const p = pendenciasDoConserto({ ...resposta, targets: [resposta.targets[1]] });
    expect(p).toHaveLength(1);
    expect(p[0].targetId).toBe("t-b");
    expect(p[0].botao).toBe("Criar 9 produtos na loja de checkout");
  });

  it("resposta sem targets (rota antiga): um item sem id", () => {
    const p = pendenciasDoConserto({ pendingProductCount: 2, creationBlockedReason: "x" });
    expect(p).toEqual([expect.objectContaining({ targetId: null, produtos: 2 })]);
  });
});

describe("frase do conserto: par tirado e produto misturado", () => {
  it("conta o par morto/errado tirado do mapa", () => {
    expect(fraseDoConserto({ removedPairCount: 3 })).toBe("Corrigida: 3 pares apagados ou errados tirados do mapa.");
  });

  it("produto misturado aparece mesmo quando nada mudou", () => {
    expect(fraseDoConserto({ noop: true, mixedBlockedVariantCount: 2 })).toContain(
      "2 variantes ficaram sem par: o produto da loja de checkout onde elas entrariam mistura produtos da vitrine"
    );
    expect(fraseDoConserto({ noop: true })).toBe("Nada para corrigir: a rota já estava certa.");
  });
});
