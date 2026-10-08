import { describe, expect, it } from "vitest";
import { decidirAviso } from "@/lib/billing/evento-assinatura";

// Um aviso de assinatura de cartao (webhook ou a sincronizacao da Assinatura)
// so mexe no perfil quando e da assinatura do perfil, ou de uma nova que esta
// pagando. E o tier sai do valor so quando a assinatura e nova ou o perfil nao
// tem tier -- a mudanca feita pelo suporte nao se desfaz no proximo aviso.

const perfil = (p: Partial<Parameters<typeof decidirAviso>[0]> = {}) => ({
  pagou_subscription_id: "sub_B",
  subscription_status: "active",
  plano: "lojas3",
  ...p,
});

describe("decidirAviso", () => {
  it("o cancelamento da tentativa abandonada não tira o acesso de quem paga a nova", () => {
    const d = decidirAviso(perfil(), { id: "sub_A", status: "canceled", amount: 7990 });
    expect(d).toMatchObject({ aplicar: false, plano: null });
  });

  it("o cartão antigo de quem passou para o Pix não mexe no perfil", () => {
    const pix = perfil({ pagou_subscription_id: null, subscription_status: "active", plano: "ilimitado" });
    for (const status of ["canceled", "cancel_scheduled", "past_due", "incomplete"]) {
      expect(decidirAviso(pix, { id: "sub_velha", status, amount: 7990 }).aplicar).toBe(false);
    }
  });

  it("assinatura nova que está pagando entra quando o perfil não tem outra viva", () => {
    // A gravacao do /subscribe se perdeu: o webhook adota a assinatura.
    const semNada = perfil({ pagou_subscription_id: null, subscription_status: null, plano: null });
    expect(decidirAviso(semNada, { id: "sub_C", status: "active", amount: 16990 })).toEqual({
      aplicar: true,
      plano: "ilimitado",
      motivo: null,
    });
    // A do perfil ficou parada no 1o pagamento.
    const parada = perfil({ pagou_subscription_id: "sub_A", subscription_status: "incomplete" });
    expect(decidirAviso(parada, { id: "sub_C", status: "active", amount: 7990 })).toMatchObject({
      aplicar: true,
      plano: "loja1",
    });
  });

  it("duas assinaturas vivas: fica a do perfil (e o log avisa)", () => {
    const d = decidirAviso(perfil(), { id: "sub_C", status: "active", amount: 16990 });
    expect(d.aplicar).toBe(false);
    expect(d.motivo).toMatch(/duas assinaturas/);
  });

  it("a assinatura do perfil sempre aplica o status", () => {
    for (const status of ["active", "past_due", "cancel_scheduled", "canceled"]) {
      expect(decidirAviso(perfil(), { id: "sub_B", status, amount: 11990 }).aplicar).toBe(true);
    }
  });

  it("na mesma assinatura com tier gravado, o tier do perfil fica (o suporte pode ter mudado)", () => {
    expect(decidirAviso(perfil({ plano: "ilimitado" }), { id: "sub_B", status: "active", amount: 11990 }).plano).toBeNull();
  });

  it("na mesma assinatura sem tier gravado, o tier sai do valor; o R$ 89 antigo não grava nada", () => {
    const semTier = perfil({ plano: null });
    expect(decidirAviso(semTier, { id: "sub_B", status: "active", amount: 11990 }).plano).toBe("lojas3");
    expect(decidirAviso(semTier, { id: "sub_B", status: "active", amount: 8900 }).plano).toBeNull();
    // Coluna ainda ausente (064 pendente): idem.
    const semColuna = { pagou_subscription_id: "sub_B", subscription_status: "active" };
    expect(decidirAviso(semColuna, { id: "sub_B", status: "active", amount: 7990 }).plano).toBe("loja1");
  });
});
