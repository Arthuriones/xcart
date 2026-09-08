import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  hashRotationKey,
  pickTarget,
  rotationOrderKey,
} from "@/lib/checkout-routes/rotation";
import type { RouteTarget } from "@/lib/checkout-routes/rotation";

/**
 * O sorteio do rodizio existe DUAS vezes: em src/lib/checkout-routes/rotation.ts
 * (servidor) e dentro de public/routed-checkout-loader.js (inline, no tema da
 * vitrine). O CLAUDE.md e o proprio loader avisam que as duas precisam decidir
 * igual -- se o inline manda o comprador para a loja A e a API para a loja B,
 * ele troca de checkout no meio da compra e o carrinho se perde.
 *
 * Nada garantia isso alem de disciplina. Estes testes leem o loader do disco,
 * extraem o codigo real dele e comparam com o servidor. Se alguem mexer num
 * lado so, o teste quebra aqui e nao numa venda.
 */

const loaderSrc = readFileSync(
  path.resolve(__dirname, "../public/routed-checkout-loader.js"),
  "utf8"
);

/** Recorta uma funcao do loader pelo nome, casando chaves. */
function extrairFuncao(nome: string): string {
  const inicio = loaderSrc.indexOf(`function ${nome}(`);
  if (inicio === -1) throw new Error(`funcao ${nome} nao encontrada no loader`);
  let nivel = 0;
  let vistoAbre = false;
  for (let i = inicio; i < loaderSrc.length; i += 1) {
    const c = loaderSrc[i];
    if (c === "{") {
      nivel += 1;
      vistoAbre = true;
    } else if (c === "}") {
      nivel -= 1;
      if (vistoAbre && nivel === 0) return loaderSrc.slice(inicio, i + 1);
    }
  }
  throw new Error(`nao consegui fechar a funcao ${nome}`);
}

describe("hash do rodizio", () => {
  const hashDoLoader = new Function(
    `${extrairFuncao("hashRotationKey")}; return hashRotationKey;`
  )() as (key: string) => number;

  it("loader e servidor produzem o mesmo hash", () => {
    const chaves = [
      "",
      "a",
      "rc_abc123",
      "550e8400-e29b-41d4-a716-446655440000",
      "chave com espaco e acento: ção",
      "0".repeat(500),
      String.fromCharCode(0x10000), // fora do BMP: charCodeAt le surrogate
    ];
    for (const chave of chaves) {
      expect(hashDoLoader(chave), `chave: ${JSON.stringify(chave)}`).toBe(
        hashRotationKey(chave)
      );
    }
  });

  it("o hash cabe em 32 bits sem sinal", () => {
    for (let i = 0; i < 200; i += 1) {
      const h = hashRotationKey(`chave-${i}`);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe("ordem da fila do sorteio", () => {
  /**
   * O bug que este teste tranca: o servidor ordenava por `target.id` e o loader
   * por `target.id || target.domain`. Como o embed-config manda `id: null` de
   * proposito para rota legada (embed-config.ts), as duas filas podiam sair em
   * ordem diferente -- e a fila e o que decide quem leva o carrinho.
   */
  /** O comparador REAL do loader, recortado do arquivo servido em producao. */
  const comparadorDoLoader = (() => {
    const trecho = loaderSrc.slice(
      loaderSrc.indexOf("pool.sort("),
      loaderSrc.indexOf("pool.sort(") + 240
    );
    const corpo = trecho.slice(trecho.indexOf("function"), trecho.lastIndexOf("}") + 1);
    return new Function(`return ${corpo}`)() as (
      a: { target: Alvo },
      b: { target: Alvo }
    ) => number;
  })();

  type Alvo = { id: string | null; domain: string };

  const casos: { nome: string; alvos: Alvo[] }[] = [
    {
      nome: "ids presentes",
      alvos: [
        { id: "zzz", domain: "aaa.myshopify.com" },
        { id: "aaa", domain: "zzz.myshopify.com" },
      ],
    },
    {
      // Este e o caso que quebrava: embed-config manda id null em rota legada.
      nome: "id null (rota legada)",
      alvos: [
        { id: null, domain: "zeta.myshopify.com" },
        { id: null, domain: "alfa.myshopify.com" },
        { id: null, domain: "meio.myshopify.com" },
      ],
    },
    {
      nome: "mistura de id e null",
      alvos: [
        { id: null, domain: "bbb.myshopify.com" },
        { id: "aaa", domain: "zzz.myshopify.com" },
        { id: null, domain: "ccc.myshopify.com" },
      ],
    },
  ];

  for (const caso of casos) {
    it(`loader e servidor ordenam igual: ${caso.nome}`, () => {
      const doLoader = [...caso.alvos]
        .map((target) => ({ target }))
        .sort(comparadorDoLoader)
        .map((c) => c.target.domain);

      const doServidor = [...caso.alvos]
        .sort((a, b) => rotationOrderKey(a).localeCompare(rotationOrderKey(b)))
        .map((t) => t.domain);

      expect(doServidor).toEqual(doLoader);
    });
  }

  it("com id vazio, as duas filas concordam", () => {
    const alvos = [
      { id: "", domain: "zeta.myshopify.com" },
      { id: "", domain: "alfa.myshopify.com" },
      { id: "", domain: "meio.myshopify.com" },
    ];
    const fila = [...alvos].sort((a, b) =>
      rotationOrderKey(a).localeCompare(rotationOrderKey(b))
    );
    expect(fila.map((t) => t.domain)).toEqual([
      "alfa.myshopify.com",
      "meio.myshopify.com",
      "zeta.myshopify.com",
    ]);
  });
});

function alvo(over: Partial<RouteTarget> & { id: string }): RouteTarget {
  return {
    domain: `${over.id}.myshopify.com`,
    enabled: true,
    weight: 1,
    skuMap: {},
    variantMap: {},
    ...over,
  } as RouteTarget;
}

describe("pickTarget: o rodizio nao pode custar linha do carrinho", () => {
  const linhas = [
    { sku: "SKU-1", quantity: 1 },
    { sku: "SKU-2", quantity: 1 },
  ];

  it("prefere quem cobre o carrinho inteiro, mesmo com peso menor", () => {
    const completo = alvo({
      id: "b-completo",
      weight: 1,
      skuMap: { "SKU-1": "111", "SKU-2": "222" },
    });
    const parcial = alvo({
      id: "a-parcial",
      weight: 99,
      skuMap: { "SKU-1": "333" },
    });

    const pick = pickTarget([parcial, completo], linhas, {
      rotationKey: "comprador-x",
    });
    expect(pick?.chosen.target.id).toBe("b-completo");
  });

  it("nao escolhe ninguem quando nenhum destino cobre nada", () => {
    const vazio = alvo({ id: "sem-mapa", skuMap: {} });
    expect(pickTarget([vazio], linhas, {})).toBeNull();
  });

  it("ignora destino desligado", () => {
    const ligado = alvo({ id: "ligado", skuMap: { "SKU-1": "1", "SKU-2": "2" } });
    const desligado = alvo({
      id: "desligado",
      enabled: false,
      skuMap: { "SKU-1": "9", "SKU-2": "9" },
    });
    const pick = pickTarget([desligado, ligado], linhas, { rotationKey: "k" });
    expect(pick?.chosen.target.id).toBe("ligado");
  });

  it("peso 0 volta a valer se for o unico que cobre o carrinho", () => {
    const so = alvo({ id: "unico", weight: 0, skuMap: { "SKU-1": "1", "SKU-2": "2" } });
    const pick = pickTarget([so], linhas, {});
    expect(pick?.chosen.target.id).toBe("unico");
    expect(pick?.reason).toBe("best_coverage_fallback");
  });

  it("sticky: a mesma chave cai sempre no mesmo destino", () => {
    const alvos = ["a", "b", "c"].map((id) =>
      alvo({ id, skuMap: { "SKU-1": "1", "SKU-2": "2" } })
    );
    const primeiro = pickTarget(alvos, linhas, {
      rotationKey: "comprador-fixo",
      strategy: "sticky",
    })?.chosen.target.id;

    for (let i = 0; i < 25; i += 1) {
      // Embaralha a entrada: a ordem que vem do banco nao pode mudar o sorteio.
      const baralho = [...alvos].sort(() => Math.random() - 0.5);
      expect(
        pickTarget(baralho, linhas, {
          rotationKey: "comprador-fixo",
          strategy: "sticky",
        })?.chosen.target.id
      ).toBe(primeiro);
    }
  });

  it("o peso manda na divisao do trafego", () => {
    const alvos = [
      alvo({ id: "pesado", weight: 9, skuMap: { "SKU-1": "1", "SKU-2": "2" } }),
      alvo({ id: "leve", weight: 1, skuMap: { "SKU-1": "1", "SKU-2": "2" } }),
    ];
    const conta: Record<string, number> = { pesado: 0, leve: 0 };
    for (let i = 0; i < 4000; i += 1) {
      const pick = pickTarget(alvos, linhas, { rotationKey: `chave-${i}` });
      conta[pick!.chosen.target.id] += 1;
    }
    const fatiaPesado = conta.pesado / 4000;
    // 90% esperado; a folga cobre a granularidade do hash.
    expect(fatiaPesado).toBeGreaterThan(0.85);
    expect(fatiaPesado).toBeLessThan(0.95);
  });
});
