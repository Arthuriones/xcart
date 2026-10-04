import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// ============================================================================
// O envio para a plataforma de anuncio roda DENTRO da requisicao do visitante
// (coletor) e do webhook da Shopify.
//
// Sem teto de espera, um destino lento prende a funcao ate o limite da
// plataforma. E a concorrencia da Vercel e COMPARTILHADA entre todas as lojas:
// o Meta lento viraria indisponibilidade para todo mundo, nao so para a loja
// daquele evento. E o problema classico de vizinho barulhento.
//
// Estes testes travam o teto nos dois caminhos de saida. Nao ha como exercitar
// o timeout de verdade aqui: `assertUrlPublica` recusa loopback de proposito
// (defesa de SSRF), entao nao da para subir um servidor lento local e apontar
// para ele.
// ============================================================================

function lerFonte(...partes: string[]) {
  return readFileSync(path.join(process.cwd(), ...partes), "utf8");
}

describe("toda saida de rastreamento tem teto de espera", () => {
  it("o Meta passa timeoutMs no envio de evento", () => {
    const fonte = lerFonte("src", "lib", "tracking", "meta-capi.ts");
    expect(fonte).toContain("timeoutMs: TIMEOUT_MS");
    // O teto tem que ser menor que o limite de funcao da Vercel, senao nao
    // protege de nada.
    const m = fonte.match(/const TIMEOUT_MS = (\d+);/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThan(0);
    expect(Number(m![1])).toBeLessThanOrEqual(10000);
  });

  it("safeFetch aceita o teto sem impor um padrao", () => {
    // Sem padrao de proposito: o mesmo safeFetch importa catalogo por proxy,
    // que legitimamente demora. Um padrao global quebraria a importacao.
    const fonte = lerFonte("src", "lib", "net", "safe-url.ts");
    expect(fonte).toContain("timeoutMs?: number");
    expect(fonte).toContain("AbortSignal.timeout(timeoutMs)");
    expect(fonte).not.toMatch(/timeoutMs\s*=\s*\d+/);
  });

  it("estourar o teto conta como 'vale tentar de novo', nao como perda", () => {
    // O AbortError cai no catch de rede. Se virasse erro permanente, cada
    // lentidao da plataforma descartaria a conversao em vez de reenfileirar.
    //
    // So a funcao que ENTREGA evento importa aqui. meta-capi.ts tem outra
    // funcao com catch proprio -- a que confere credencial -- e ela nao vai
    // para fila nenhuma, entao nao tem (nem precisa de) `podeTentarDeNovo`.
    const entregadores: [string, string][] = [
      // O Google saiu do servidor: vai pela tag do navegador (google-tag.ts).
      ["meta-capi.ts", "export async function enviarParaMeta"],
    ];

    for (const [arquivo, assinatura] of entregadores) {
      const fonte = lerFonte("src", "lib", "tracking", arquivo);
      const ini = fonte.indexOf(assinatura);
      expect(ini, `${arquivo}: ${assinatura} nao encontrada`).toBeGreaterThan(-1);

      // Ate a proxima declaracao exportada, que e onde a funcao acaba.
      const seguinte = fonte.indexOf("\nexport ", ini + assinatura.length);
      const corpo = fonte.slice(ini, seguinte === -1 ? undefined : seguinte);

      expect(corpo).toContain("} catch (e)");
      expect(corpo).toContain("podeTentarDeNovo: true");
      expect(corpo).toMatch(/timeoutMs:/);
    }
  });
});
