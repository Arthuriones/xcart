import { describe, expect, it } from "vitest";
import { ITENS_ADMIN, itemAdminAtivo, linkDoApp, tituloAdmin } from "@/app/admin/navegacao-admin";
import { APP_HOME } from "@/lib/app-home";

describe("menu do admin: qual item acende", () => {
  it("a raiz acende so a visao geral", () => {
    expect(itemAdminAtivo("/admin")?.id).toBe("visao");
  });

  it("subtela acende a propria, nao a visao geral (vence o href mais longo)", () => {
    expect(itemAdminAtivo("/admin/users")?.id).toBe("usuarios");
    expect(itemAdminAtivo("/admin/users/0b8f-uuid")?.id).toBe("usuarios");
    expect(itemAdminAtivo("/admin/faturamento")?.id).toBe("faturamento");
    expect(itemAdminAtivo("/admin/usage")?.id).toBe("uso");
  });

  it("prefixo parecido nao casa", () => {
    expect(itemAdminAtivo("/admin/usersx")?.id).toBe("visao");
    expect(itemAdminAtivo("/financeiro")).toBeNull();
  });

  it("titulo do topo no celular e o mesmo nome do menu", () => {
    expect(tituloAdmin("/admin/usage")).toBe("Uso e custos");
    expect(tituloAdmin("/admin/users/abc")).toBe("Usuários");
    expect(tituloAdmin("/outra")).toBe("Admin");
  });

  it("rotulos curtos cabem na barra de baixo", () => {
    for (const item of ITENS_ADMIN) expect(item.curto.length).toBeLessThanOrEqual(11);
  });
});

describe("linkDoApp: o caminho de volta para o app", () => {
  it("no host adm.* troca para user.* (o middleware prende tudo em /admin)", () => {
    expect(linkDoApp("adm.xcart.com.br")).toBe(`https://user.xcart.com.br${APP_HOME}`);
    expect(linkDoApp("ADM.xcart.com.br")).toBe(`https://user.xcart.com.br${APP_HOME}`);
  });

  it("NEXT_PUBLIC_APP_URL vence quando existe, sem barra dobrada", () => {
    expect(linkDoApp("adm.xcart.com.br", "https://app.exemplo.com/")).toBe(`https://app.exemplo.com${APP_HOME}`);
  });

  it("localhost e previa da Vercel: mesmo host, link relativo (a env de producao nao manda para fora)", () => {
    expect(linkDoApp("localhost:3000", "https://user.xcart.com.br")).toBe(APP_HOME);
    expect(linkDoApp("xcart-git-x.vercel.app")).toBe(APP_HOME);
    expect(linkDoApp(null)).toBe(APP_HOME);
  });
});
