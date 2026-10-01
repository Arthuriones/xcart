import { describe, expect, it } from "vitest";
import { idiomaDoHtml } from "../src/lib/stores/idioma-da-loja";

// O idioma da IA sai do <html lang> da propria loja. Medido nas lojas reais:
// lashbestie.shop e softnookstore.shop declaram "en", gotoku-ya.shop "ja" --
// e as tres estavam cadastradas como pt-BR.

describe("idiomaDoHtml", () => {
  it("le o lang do html de um tema Shopify", () => {
    expect(idiomaDoHtml('<!doctype html><html class="js" lang="en">')).toBe("en-US");
    expect(idiomaDoHtml('<html class="js" lang="ja">')).toBe("ja-JP");
  });

  it("aceita variante regional e mapeia para a opcao da tela", () => {
    expect(idiomaDoHtml('<html lang="pt-BR">')).toBe("pt-BR");
    expect(idiomaDoHtml("<html lang='es-MX'>")).toBe("es-ES");
    expect(idiomaDoHtml("<html lang=fr_CA>")).toBe("fr-FR");
  });

  it("idioma fora da lista nao vira palpite", () => {
    // Errar o idioma e pior que o padrao: ninguem confere.
    expect(idiomaDoHtml('<html lang="ko">')).toBeNull();
  });

  it("sem lang, sem idioma", () => {
    expect(idiomaDoHtml("<html class='js'>")).toBeNull();
    expect(idiomaDoHtml("")).toBeNull();
  });

  it("nao confunde atributo parecido", () => {
    expect(idiomaDoHtml('<html data-lang="en" lang="de">')).toBe("de-DE");
  });
});
