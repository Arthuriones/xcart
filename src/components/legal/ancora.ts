/**
 * Ancora de uma secao dos documentos legais, para o indice e para link direto
 * (/privacy#retencao-e-exclusao): sem o numero da frente, sem acento, em
 * minusculas e com hifen.
 *
 *   ancoraDaSecao("6. Retenção e exclusão") === "retencao-e-exclusao"
 */
export function ancoraDaSecao(titulo: string): string {
  const base = titulo
    .replace(/^\s*\d+\s*[.)-]?\s*/, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "secao";
}

/**
 * As ancoras de todas as secoes, sem repetir: dois titulos iguais viram
 * "contato" e "contato-2". O id repetido faria o indice levar sempre para a
 * primeira.
 */
export function ancorasUnicas(titulos: string[]): string[] {
  const usadas = new Set<string>();
  return titulos.map((titulo) => {
    const base = ancoraDaSecao(titulo);
    let id = base;
    for (let n = 2; usadas.has(id); n++) id = `${base}-${n}`;
    usadas.add(id);
    return id;
  });
}
