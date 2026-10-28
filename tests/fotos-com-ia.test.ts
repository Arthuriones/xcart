import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FRASE_IA_FORA, FRASE_SEM_FOTOS, ehIaDeImagemFora, erroDoJobDeImagem } from "../src/lib/ai/erro-ia-imagem";
import { creditos, rotuloCompra } from "../src/components/billing/regras";

// ============================================================================
// Fotos com IA (o credito de IA, na tela): o erro que o lojista le e a
// renovacao que soma.
// ============================================================================

describe("erro da IA de imagem", () => {
  it("o 429 do saldo pre-pago do Google vira a nossa frase (o texto cru dizia que eram as fotos DELE)", () => {
    const cru =
      '{"error":{"code":429,"message":"Your prepayment credits are depleted. Please go to AI Studio to manage your project and billing.","status":"RESOURCE_EXHAUSTED"}}';
    expect(erroDoJobDeImagem(cru)).toEqual({ texto: FRASE_IA_FORA, iaFora: true });
    expect(FRASE_IA_FORA).toMatch(/Nada foi descontado/);
    expect(FRASE_IA_FORA).not.toMatch(/Gemini|Google|prepayment/i);
  });

  it("cota e limite tambem sao nossos", () => {
    expect(ehIaDeImagemFora("RESOURCE_EXHAUSTED: quota exceeded")).toBe(true);
    expect(ehIaDeImagemFora("got status: 429 Too Many Requests")).toBe(true);
  });

  it("erro do produto segue com a mensagem original", () => {
    expect(erroDoJobDeImagem("Product does not exist")).toEqual({ texto: "Product does not exist", iaFora: false });
    // 503 de demanda alta nao e saldo: retenta como antes, sem alerta.
    expect(ehIaDeImagemFora('{"error":{"code":503,"message":"This model is currently experiencing high demand."}}')).toBe(false);
    // Numero que so contem 429 no meio nao conta.
    expect(ehIaDeImagemFora("produto 14290 sem imagem")).toBe(false);
  });

  it("sem saldo do lojista diz onde comprar", () => {
    expect(FRASE_SEM_FOTOS).toBe("Suas fotos com IA acabaram. Compre mais em Assinatura e refaça a troca.");
  });
});

describe("a unidade na tela e foto", () => {
  it("formata em fotos, nao em creditos", () => {
    expect(creditos(1)).toBe("1 foto");
    expect(creditos(1200)).toBe("1.200 fotos");
    expect(rotuloCompra({ kind: "credits", credits: 50, method: "pix", provider: "abacatepay", status: "paid" })).toBe(
      "50 fotos com IA"
    );
  });
});

describe("082: a renovacao soma", () => {
  const sql = readFileSync(path.join(__dirname, "../supabase/migrations/082_renovacao_soma_fotos.sql"), "utf8");
  it("soma ao saldo em vez de sobrescrever (a renovacao apagava foto comprada)", () => {
    expect(sql).toMatch(/set ai_credits = coalesce\(ai_credits, 0\) \+ greatest\(p_amount, 0\)/);
    expect(sql).not.toMatch(/set ai_credits = p_amount/);
  });
  it("continua so do service role", () => {
    expect(sql).toMatch(/security definer/);
    expect(sql).toMatch(/revoke execute on function public\.reset_ai_credits\(uuid, integer, timestamptz\) from public, anon, authenticated/);
    expect(sql).toMatch(/grant execute on function public\.reset_ai_credits\(uuid, integer, timestamptz\) to service_role/);
  });
});

describe("083: as fotos do plano entram uma vez por periodo", () => {
  const sql = readFileSync(path.join(__dirname, "../supabase/migrations/083_fotos_uma_vez_por_periodo.sql"), "utf8");
  it("a soma so acontece quando o periodo e outro (reentrega do Stripe e aviso duplicado nao somam de novo)", () => {
    expect(sql).toMatch(/and ai_credits_periodo is distinct from p_period_end/);
    expect(sql).toMatch(/ai_credits_periodo = p_period_end/);
  });
  it("quem ja tem periodo entra com ele como creditado", () => {
    expect(sql).toMatch(/set ai_credits_periodo = current_period_end/);
  });
  it("continua so do service role", () => {
    expect(sql).toMatch(/revoke execute on function public\.reset_ai_credits\(uuid, integer, timestamptz\) from public, anon, authenticated/);
  });
});
