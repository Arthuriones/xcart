import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// ============================================================================
// Os crons do vercel.json: minutos espalhados (antes seis jobs disparavam
// juntos as :00 e as :30 e dividiam o banco free com a tela do lojista), sem
// mudar quantas vezes cada um roda.
// ============================================================================

const RAIZ = path.resolve(__dirname, "..");
const vercel = JSON.parse(readFileSync(path.join(RAIZ, "vercel.json"), "utf8")) as {
  crons: { path: string; schedule: string }[];
};

/** Os valores de um campo do cron ("*", "*\/N", "N" ou "a,b,c") dentro de [0, max). */
function valores(campo: string, max: number): number[] {
  if (campo === "*") return Array.from({ length: max }, (_, i) => i);
  if (campo.startsWith("*/")) {
    const passo = Number(campo.slice(2));
    return Array.from({ length: Math.ceil(max / passo) }, (_, i) => i * passo);
  }
  return campo.split(",").map(Number);
}

function agenda(caminho: string) {
  const c = vercel.crons.find((x) => x.path === caminho);
  if (!c) throw new Error(`sem cron para ${caminho}`);
  const [min, hora, dia, mes, semana] = c.schedule.split(" ");
  expect([dia, mes, semana], caminho).toEqual(["*", "*", "*"]);
  return { minutos: valores(min, 60), horas: valores(hora, 24) };
}

// Quantas vezes por dia cada um roda: o que o deslocamento NAO pode mudar.
const POR_DIA: Record<string, number> = {
  "/api/jobs/bulk-import/process": 24,
  "/api/jobs/routes/heal": 24,
  "/api/jobs/tracking/drain": 144,
  "/api/jobs/financeiro/pedidos": 96,
  "/api/jobs/ads/meta": 96,
  "/api/jobs/financeiro/cambio": 4,
  "/api/jobs/alertas": 144,
  "/api/jobs/demonstracao": 96,
  // Regras automaticas de anuncio: 5 min depois do sync do Meta.
  "/api/jobs/ads/regras": 96,
};

describe("vercel.json: crons", () => {
  it("os mesmos jobs, cada um com a mesma frequencia", () => {
    expect(vercel.crons.map((c) => c.path).sort()).toEqual(Object.keys(POR_DIA).sort());
    for (const [caminho, vezes] of Object.entries(POR_DIA)) {
      const { minutos, horas } = agenda(caminho);
      expect(minutos.length * horas.length, caminho).toBe(vezes);
      // Intervalo constante dentro da hora: nada de duas rodadas coladas.
      const passo = 60 / minutos.length;
      minutos.forEach((m, i) => expect(m - minutos[0], caminho).toBe(i * passo));
    }
  });

  it("drain e pedidos seguem na cadencia de antes (o expurgo e a execucao das :00 do drain)", () => {
    expect(vercel.crons.find((c) => c.path === "/api/jobs/tracking/drain")?.schedule).toBe("*/10 * * * *");
    expect(vercel.crons.find((c) => c.path === "/api/jobs/financeiro/pedidos")?.schedule).toBe("*/15 * * * *");
  });

  it("no maximo 3 jobs no mesmo minuto, e so drain e pedidos as :00", () => {
    const porMinuto = new Map<number, string[]>();
    for (const c of vercel.crons) {
      for (const m of agenda(c.path).minutos) porMinuto.set(m, [...(porMinuto.get(m) ?? []), c.path]);
    }
    for (const [m, jobs] of porMinuto) expect(jobs.length, `minuto ${m}: ${jobs.join(", ")}`).toBeLessThanOrEqual(3);
    expect((porMinuto.get(0) ?? []).sort()).toEqual(["/api/jobs/financeiro/pedidos", "/api/jobs/tracking/drain"]);
  });
});
