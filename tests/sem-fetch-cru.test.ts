import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Este teste existe porque eu deixei passar a mesma coisa duas vezes.
 *
 * Na primeira varredura de SSRF, `proxy-fetch`, `apply-logo` e o scraper do
 * AliExpress foram corrigidos e eu declarei o assunto encerrado. Faltavam
 * cinco, e um deles era o pior de todos:
 *
 *   src/app/api/image/generate/route.ts
 *     const { imageUrl } = await request.json();
 *     const imgRes = await fetch(imageUrl);   // <- direto do corpo do POST
 *
 * Qualquer usuario autenticado pedia http://169.254.169.254/latest/meta-data/
 * e o servidor buscava. Revisao a olho nao pega isso de forma confiavel: sao
 * ~40 chamadas de fetch no repo e a maioria e legitima.
 *
 * Entao a regra passa a ser mecanica: em src/, `fetch(` so pode aparecer nos
 * arquivos abaixo. Qualquer outro tem que usar safeFetch, que resolve o DNS e
 * revalida cada redirect.
 */

/**
 * Onde `fetch` cru e permitido, e por que.
 *
 * Cada entrada e uma decisao, nao uma isencao por conveniencia: ou o endereco
 * e constante no codigo, ou a validacao acontece imediatamente antes.
 */
const PERMITIDOS: Record<string, string> = {
  "src/lib/net/safe-url.ts":
    "e a propria implementacao do safeFetch -- o fetch cru daqui e o que roda depois da checagem de DNS",
  "src/lib/import/proxy-fetch.ts":
    "monta a URL do proxy Bright Data (host constante) e o caminho direto ja passa por safeFetch",
  "src/lib/shopify/client.ts":
    "host vem de hostDaLoja(), que chama assertShopDomainPublico (parser + DNS) na linha anterior",
  "src/lib/aliexpress/scraper.ts":
    "endpoint fixo da API do Bright Data (api.brightdata.com), sem entrada do usuario",
  "src/lib/billing/pagou.ts": "BASE e a URL da API do Pagou, vinda de env",
};

const RAIZ = path.resolve(__dirname, "..", "src");

function arquivosTs(dir: string): string[] {
  const saida: string[] = [];
  for (const entrada of readdirSync(dir)) {
    const p = path.join(dir, entrada);
    if (statSync(p).isDirectory()) saida.push(...arquivosTs(p));
    else if (/\.tsx?$/.test(p)) saida.push(p);
  }
  return saida;
}

/** `fetch(` que nao seja safeFetch nem metodo de objeto (ex.: `.fetch(`). */
const FETCH_CRU = /(?<![.\w])fetch\s*\(/;

describe("nenhum fetch cru fora da lista", () => {
  const arquivos = arquivosTs(RAIZ);

  it("acha arquivos para analisar", () => {
    expect(arquivos.length).toBeGreaterThan(50);
  });

  it("todo fetch de servidor passa por safeFetch", () => {
    const infratores: string[] = [];

    for (const abs of arquivos) {
      const rel = path.relative(path.resolve(__dirname, ".."), abs);
      if (rel in PERMITIDOS) continue;

      const fonte = readFileSync(abs, "utf8");

      // Componente de cliente roda no NAVEGADOR: o fetch sai da maquina do
      // usuario, para a propria API. Nao ha rede interna do outro lado, entao
      // safeFetch nao faz sentido la (e nem funcionaria: usa node:dns).
      if (/^\s*["']use client["']/m.test(fonte)) continue;

      const linhas = fonte.split("\n");
      linhas.forEach((linha, i) => {
        if (!FETCH_CRU.test(linha)) return;
        // Chamada para a propria API (caminho relativo ou origem do app) nao e
        // destino escolhido pelo usuario.
        if (/["'`]\/api\//.test(linha) || /appUrl|origin\b|NEXT_PUBLIC_APP_URL/.test(linha)) {
          return;
        }
        infratores.push(`${rel}:${i + 1}  ${linha.trim().slice(0, 80)}`);
      });
    }

    expect(
      infratores,
      `fetch cru fora da lista de permitidos. Use safeFetch de @/lib/net/safe-url, ` +
        `ou justifique em PERMITIDOS neste arquivo:\n${infratores.join("\n")}`
    ).toEqual([]);
  });

  it("a lista de permitidos nao tem entrada morta", () => {
    // Um arquivo que sumiu ou parou de usar fetch nao pode continuar
    // permitido: a proxima pessoa leria a lista como se ainda valesse.
    for (const [rel, motivo] of Object.entries(PERMITIDOS)) {
      const abs = path.resolve(__dirname, "..", rel);
      expect(motivo.length, `${rel} precisa de motivo escrito`).toBeGreaterThan(20);
      const conteudo = readFileSync(abs, "utf8");
      expect(FETCH_CRU.test(conteudo), `${rel} nao usa mais fetch cru`).toBe(true);
    }
  });
});
