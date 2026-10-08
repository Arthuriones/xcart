import { describe, expect, it } from "vitest";
import {
  estadoDoTema,
  fraseDoConserto,
  pendenciaDoConserto,
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
