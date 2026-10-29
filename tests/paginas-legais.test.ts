import { describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { RETENCAO } from "@/lib/tracking/retencao";

// So o texto importa aqui: o layout (topo e rodape da landing) nao sobe no
// vitest e ja e coberto por legal-ancora.test.ts.
vi.mock("@/components/legal/legal-page", () => ({ LegalPage: () => null }));

import PrivacyPage from "@/app/privacy/page";
import TermsPage from "@/app/terms/page";
import DataDeletionPage, { metadata as metadataExclusao } from "@/app/data-deletion/page";
import UserDataDeletionPage, { metadata as metadataUserExclusao } from "@/app/user-data-deletion/page";

interface Secao {
  title: string;
  body: string[];
}
interface Props {
  updatedAt: string;
  sections: Secao[];
}

const props = (pagina: () => ReactElement) => pagina().props as Props;
const secao = (p: Props, titulo: string) => {
  const s = p.sections.find((x) => x.title.endsWith(titulo));
  expect(s, `secao "${titulo}"`).toBeDefined();
  return (s as Secao).body.join(" ");
};
const texto = (p: Props) => p.sections.map((s) => `${s.title} ${s.body.join(" ")}`).join(" ");

const PAGINAS = { privacy: PrivacyPage, terms: TermsPage, "data-deletion": DataDeletionPage };

describe("exclusão de dados (Google Play e App Store pedem caminho direto)", () => {
  const p = props(DataDeletionPage);
  const comoPedir = secao(p, "Como solicitar exclusão");

  it("dá o caminho no app e o caminho no site", () => {
    expect(comoPedir).toContain("No app do xcart");
    expect(comoPedir).toContain("Conta, toque em Excluir conta");
    expect(comoPedir).toContain("user.xcart.app");
    expect(comoPedir).toContain("Configurações e, na seção Conta, clique em Excluir conta");
  });

  it("diz que os aparelhos do app saem junto e o que pode ficar", () => {
    expect(secao(p, "O que será removido")).toContain("token de notificação");
    expect(secao(p, "O que pode ficar")).toContain("AbacatePay");
  });

  it("mantém a revogação na Meta (a Meta pede a página de instruções)", () => {
    expect(secao(p, "Revogar acesso na Meta")).toContain("Apps e Sites");
  });

  it("/user-data-deletion é a mesma página", () => {
    expect(UserDataDeletionPage).toBe(DataDeletionPage);
    expect(metadataUserExclusao).toBe(metadataExclusao);
  });
});

describe("privacidade cita o app de celular", () => {
  const p = props(PrivacyPage);
  const app = secao(p, "App de celular");

  it("token de push: para que serve e quando sai", () => {
    expect(app).toContain("token de notificação");
    expect(app).toContain("sai da conta no app ou exclui a conta");
  });

  it("sem rastreamento de terceiros nem anúncio, e o login é o do site", () => {
    expect(app).toContain("não tem rastreamento de terceiros nem anúncios");
    expect(app).toContain("O login é o mesmo do site");
  });

  it("os prazos do rastreamento são os do expurgo (retencao.ts)", () => {
    const rastreamento = secao(p, "Rastreamento de conversões");
    expect(rastreamento).toContain(`${RETENCAO.funilDias} dias`);
    expect(rastreamento).toContain(`em ${RETENCAO.naoSaiuDias}`);
    expect(rastreamento).toContain(`as compras e os eventos de checkout ficam ${RETENCAO.compraDias} dias`);
    expect(rastreamento).toContain(`${RETENCAO.historicoMeses} meses`);
  });

  it("aponta para a página de exclusão", () => {
    expect(secao(p, "Retenção e exclusão")).toContain("/data-deletion");
  });
});

describe("as três páginas", () => {
  it.each(Object.entries(PAGINAS))("%s: parágrafo único por seção (é a key do React)", (_, pagina) => {
    for (const s of props(pagina).sections) {
      expect(new Set(s.body).size, s.title).toBe(s.body.length);
    }
  });

  it.each(Object.entries(PAGINAS))("%s: seções numeradas em ordem", (_, pagina) => {
    const numeros = props(pagina).sections.map((s) => Number(s.title.split(".")[0]));
    expect(numeros).toEqual(numeros.map((_, i) => i + 1));
  });

  it("os termos citam o app sem compra dentro dele", () => {
    expect(texto(props(TermsPage))).toContain("Não há compra dentro do app");
  });
});
