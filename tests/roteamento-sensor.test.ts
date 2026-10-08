import { describe, expect, it } from "vitest";
import {
  chaveDoEscape,
  classificarFalha,
  decidirTopico,
  detalheDoEscape,
  ehNossoEndpoint,
  inicioDaContagem,
  itensDoCheckout,
  lerInscricao,
  montarFunil,
  precisaConferir,
  type EntradaDoFunil,
  type InscricaoWebhook,
} from "@/lib/checkout-routes/sensor";
import {
  consertoFalhando,
  credencialRevogada,
  lerUltimoConserto,
  lojaForaNoConserto,
  motivoDaFalha,
  proximoUltimoConserto,
} from "@/lib/checkout-routes/ultimo-conserto";
import { blocosDoFunil, lojasSemAviso } from "@/app/(dashboard)/clone/routed-checkout/logica";
import { CHECKOUT_DE_EXEMPLO, DADOS_DO_COMPRADOR } from "./_checkout-de-exemplo";

const AGORA = Date.parse("2026-10-08T12:00:00Z");
const HORA = 3_600_000;
const ha = (h: number) => new Date(AGORA - h * HORA).toISOString();

describe("escape: o checkout que nasceu na vitrine", () => {
  it("so sai SKU, variante e quantidade do payload", () => {
    expect(itensDoCheckout(CHECKOUT_DE_EXEMPLO)).toEqual([
      { sku: "IPOD2008PINK", varianteId: "808950810", quantidade: 1 },
      { sku: null, varianteId: "49148385", quantidade: 2 },
    ]);
  });

  it("o detalhe gravado nao carrega nada do comprador", () => {
    const detalhe = detalheDoEscape(itensDoCheckout(CHECKOUT_DE_EXEMPLO));
    expect(detalhe).toBe("3 itens: IPOD2008PINK x1 · v49148385 x2");
    for (const pessoal of DADOS_DO_COMPRADOR) {
      expect(detalhe).not.toContain(pessoal);
    }
  });

  it("payload torto nao lanca e nao inventa item", () => {
    expect(itensDoCheckout(null)).toEqual([]);
    expect(itensDoCheckout({ line_items: "x" })).toEqual([]);
    expect(itensDoCheckout({ line_items: [{ sku: "A", quantity: -3 }] })).toEqual([
      { sku: "A", varianteId: null, quantidade: 1 },
    ]);
    expect(itensDoCheckout({ line_items: [{ variant_id: "abc" }] })).toEqual([]);
  });

  it("detalhe longo cabe na coluna e diz quantos sobraram", () => {
    const itens = Array.from({ length: 50 }, (_, i) => ({ sku: `SKU-MUITO-COMPRIDO-${i}`, varianteId: null, quantidade: 1 }));
    const d = detalheDoEscape(itens);
    expect(d.length).toBeLessThanOrEqual(500);
    expect(d).toMatch(/\+\d+$/);
  });

  it("a trava por checkout e estavel e nao guarda o token cru", () => {
    const a = chaveDoEscape("loja-1", "tok-abc");
    expect(a).toBe(chaveDoEscape("loja-1", "tok-abc"));
    expect(a).not.toContain("tok-abc");
    expect(a).not.toBe(chaveDoEscape("loja-2", "tok-abc"));
    expect(a.startsWith("checkout:loja-1:")).toBe(true);
  });
});

describe("inscricao dos webhooks", () => {
  const nossa = (topico: string, url = "https://user.xcart.app/api/shopify/webhooks") => ({
    topico,
    url,
    criadoEm: "2026-09-30T22:04:21Z",
  });

  it("inscricao em host antigo nosso vale (nao duplica a entrega)", () => {
    expect(ehNossoEndpoint("https://shopify-creator-chi.vercel.app/api/shopify/webhooks")).toBe(true);
    expect(ehNossoEndpoint("https://outro.app/webhooks")).toBe(false);
    expect(ehNossoEndpoint(null)).toBe(false);
    expect(
      decidirTopico({
        topico: "ORDERS_CREATE",
        escopos: [],
        inscricoes: [nossa("ORDERS_CREATE", "https://shopify-creator-chi.vercel.app/api/shopify/webhooks")],
      })
    ).toEqual({ acao: "ja_inscrito", desde: "2026-09-30T22:04:21Z" });
  });

  it("sem read_orders nem tenta inscrever", () => {
    expect(decidirTopico({ topico: "CHECKOUTS_CREATE", escopos: ["read_products"], inscricoes: [nossa("APP_UNINSTALLED")] })).toEqual({
      acao: "sem_escopo",
    });
  });

  it("com read_orders e sem a inscricao do topico, inscreve", () => {
    expect(
      decidirTopico({ topico: "ORDERS_CREATE", escopos: ["read_orders"], inscricoes: [nossa("CHECKOUTS_CREATE")] })
    ).toEqual({ acao: "inscrever" });
  });

  it("erro da Shopify vira estado e frase curta", () => {
    expect(classificarFalha("Shopify GraphQL error: ACCESS_DENIED read_orders").estado).toBe("sem_permissao");
    expect(classificarFalha("This app is not approved to subscribe to webhook topics containing protected customer data").estado).toBe(
      "sem_permissao"
    );
    expect(classificarFalha("Shopify API error: 402 Payment Required").estado).toBe("loja_fora");
    expect(classificarFalha("[API] Invalid API key or access token").motivo).toMatch(/reconecte/);
    expect(classificarFalha("socket hang up").estado).toBe("falhou");
  });

  it("confere no maximo 1x por dia", () => {
    const ok: InscricaoWebhook = { em: ha(2), estado: "inscrito", desde: ha(100) };
    expect(precisaConferir(ok, AGORA)).toBe(false);
    expect(precisaConferir({ ...ok, em: ha(25) }, AGORA)).toBe(true);
    expect(precisaConferir({ em: ha(2), estado: "falhou" }, AGORA)).toBe(false);
    expect(precisaConferir(null, AGORA)).toBe(true);
    expect(precisaConferir({ em: "lixo", estado: "inscrito" }, AGORA)).toBe(true);
  });

  it("le o que foi gravado e ignora lixo", () => {
    expect(lerInscricao({ webhook_pedidos: { em: ha(1), estado: "sem_permissao", motivo: "x" } }, "webhook_pedidos")).toEqual({
      em: ha(1),
      estado: "sem_permissao",
      motivo: "x",
    });
    expect(lerInscricao({ webhook_pedidos: { em: ha(1), estado: "outro" } }, "webhook_pedidos")).toBeNull();
    expect(lerInscricao(null, "webhook_pedidos")).toBeNull();
  });
});

describe("funil da rota", () => {
  const inscrito = (desdeH: number): InscricaoWebhook => ({ em: ha(1), estado: "inscrito", desde: ha(desdeH) });
  const semPermissao: InscricaoWebhook = { em: ha(1), estado: "sem_permissao", motivo: "falta a permissão de pedidos (read_orders) no app da loja" };

  const entrada = (over: Partial<EntradaDoFunil> = {}): EntradaDoFunil => ({
    agora: AGORA,
    roteados: 316,
    erros: { cart_checkout_error: 14, direct_checkout_error: 0 },
    vitrine: { nome: "NORAH", inscricao: inscrito(24 * 30), escapes: 4, desde: AGORA - 7 * 24 * HORA },
    lojas: [{ nome: "NORAH OUTLET", inscricao: inscrito(24 * 30) }],
    pedidos: { n: 40, desde: AGORA - 7 * 24 * HORA, roteadosDesde: 316 },
    ...over,
  });

  it("com os avisos ligados, conta e calcula a conversao", () => {
    const f = montarFunil(entrada());
    expect(f.roteados).toBe(316);
    expect(f.escapes).toEqual({ tipo: "contando", n: 4, desde: null });
    expect(f.pedidos).toMatchObject({ tipo: "contando", n: 40, conversao: 12.7 });
    expect(f.totalErros).toBe(14);
    expect(f.erros).toEqual([{ motivo: "cart_checkout_error", rotulo: "ao levar o carrinho", n: 14 }]);
  });

  it("loja sem orders/create mostra o motivo, nunca '0 pedidos'", () => {
    const f = montarFunil(
      entrada({
        lojas: [{ nome: "NORAH OUTLET", inscricao: semPermissao }],
        pedidos: { n: null, desde: null, roteadosDesde: 316 },
      })
    );
    expect(f.pedidos).toEqual({ tipo: "sem_aviso", lojas: [{ nome: "NORAH OUTLET", motivo: semPermissao.motivo }] });
    const pedidos = blocosDoFunil(f).find((b) => b.rotulo === "Pedidos");
    expect(pedidos).toEqual({ rotulo: "Pedidos", valor: "—", sub: "loja sem aviso de pedidos" });
    expect(lojasSemAviso(f)).toEqual([{ nome: "NORAH OUTLET", motivo: semPermissao.motivo }]);
  });

  it("uma de duas lojas sem aviso ja tira a contagem (seria meio numero)", () => {
    const f = montarFunil(
      entrada({
        lojas: [
          { nome: "A", inscricao: inscrito(500) },
          { nome: "B", inscricao: semPermissao },
        ],
      })
    );
    expect(f.pedidos.tipo).toBe("sem_aviso");
  });

  it("nunca conferido fica 'conferindo', nao zero", () => {
    const f = montarFunil(entrada({ vitrine: { nome: "V", inscricao: null, escapes: null, desde: null } }));
    expect(f.escapes).toEqual({ tipo: "conferindo" });
    expect(blocosDoFunil(f)[1]).toEqual({ rotulo: "Caíram na vitrine", valor: "—", sub: "conferindo o sensor" });
  });

  it("aviso ligado no meio da semana: a janela encurta e diz desde quando", () => {
    const inicio = inicioDaContagem([inscrito(48)], AGORA);
    expect(inicio).toBe(AGORA - 48 * HORA);
    const f = montarFunil(entrada({ pedidos: { n: 9, desde: inicio, roteadosDesde: 90 } }));
    expect(f.pedidos).toMatchObject({ tipo: "contando", n: 9, conversao: 10, desde: ha(48) });
    expect(blocosDoFunil(f)[3].sub).toBe("10% dos carrinhos desde 06/10");
  });

  it("inicio da contagem: so com todas as lojas inscritas", () => {
    expect(inicioDaContagem([inscrito(500), semPermissao], AGORA)).toBeNull();
    expect(inicioDaContagem([inscrito(500), null], AGORA)).toBeNull();
    expect(inicioDaContagem([], AGORA)).toBeNull();
    expect(inicioDaContagem([inscrito(500)], AGORA)).toBe(AGORA - 7 * 24 * HORA);
  });

  it("sem carrinho levado nao inventa conversao", () => {
    const f = montarFunil(entrada({ roteados: 0, pedidos: { n: 3, desde: AGORA - 7 * 24 * HORA, roteadosDesde: 0 } }));
    expect(f.pedidos).toMatchObject({ tipo: "contando", n: 3, conversao: null });
    expect(blocosDoFunil(f)[3].sub).toBe("na loja de checkout");
  });

  it("contagem que falhou vira '—', nao zero", () => {
    const f = montarFunil(entrada({ roteados: null, erros: { cart_checkout_error: null, direct_checkout_error: 0 } }));
    const blocos = blocosDoFunil(f);
    expect(blocos[0].valor).toBe("—");
    expect(blocos[2]).toEqual({ rotulo: "Erros do script", valor: "—", sub: "sem leitura agora" });
  });
});

describe("falhas seguidas do conserto", () => {
  it("conta as passadas com falha e zera no sucesso", () => {
    const um = proximoUltimoConserto(null, { at: ha(3), ok: false, message: "x" });
    expect(um.falhas).toBe(1);
    const dois = proximoUltimoConserto(um, { at: ha(2), ok: false, message: "x" });
    const tres = proximoUltimoConserto(dois, { at: ha(1), ok: false, message: "x" });
    expect(tres.falhas).toBe(3);
    expect(consertoFalhando(dois)).toBe(false);
    expect(consertoFalhando(tres)).toBe(true);
    expect(proximoUltimoConserto(tres, { at: ha(0), ok: true }).falhas).toBe(0);
  });

  it("registro antigo sem contador, com falha, conta como uma", () => {
    const antigo = lerUltimoConserto({ last_heal: { at: ha(5), ok: false, message: "y" } });
    expect(proximoUltimoConserto(antigo, { at: ha(1), ok: false }).falhas).toBe(2);
  });

  it("credencial revogada alerta na primeira passada", () => {
    const u = proximoUltimoConserto(null, {
      at: ha(1),
      ok: false,
      message: "Loja vitrine (x.myshopify.com): As credenciais dessa loja foram revogadas ou expiraram. Reconecte a loja em Lojas.",
    });
    expect(credencialRevogada(u)).toBe(true);
    expect(consertoFalhando(u)).toBe(true);
    expect(motivoDaFalha("O app foi removido de x.myshopify.com. Reinstale para voltar a rotear.")).toBe("sem_app");
  });

  it("loja pausada e 'loja fora', mas nao e credencial", () => {
    const u = proximoUltimoConserto(null, { at: ha(1), ok: false, motivo: "loja_pausada", message: "pausada ou sem plano" });
    expect(lojaForaNoConserto(u)).toBe(true);
    expect(credencialRevogada(u)).toBe(false);
    expect(consertoFalhando(u)).toBe(false);
  });

  it("motivo cru do store-health (gravado antes do vocabulario tipado) vira o tipado", () => {
    const u = lerUltimoConserto({ last_heal: { at: ha(1), ok: false, motivo: "congelada", lado: "checkout" } });
    expect(u?.motivo).toBe("loja_pausada");
    expect(lerUltimoConserto({ last_heal: { at: ha(1), ok: false, motivo: "sem_acesso" } })?.motivo).toBe("sem_app");
    expect(lerUltimoConserto({ last_heal: { at: ha(1), ok: false, motivo: "erro" } })?.motivo).toBeUndefined();
    expect(motivoDaFalha("A vitrine x está com senha: o xcart não consegue ler os produtos dela.")).toBe("vitrine_fechada");
  });
});
