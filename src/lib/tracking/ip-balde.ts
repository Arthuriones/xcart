import { createHmac } from "node:crypto";

// ============================================================================
// A chave do teto por IP do coletor publico (/api/tracking/collect).
//
// O teto da loja e um balde so por hora, e storeId/shop estao no HTML do tema.
// Uma origem sozinha, trocando o visitorId a cada POST, enchia o balde de
// outra pessoa -- e dai ate a hora virar todo evento real caia em "teto da
// loja". O teto por IP limita quanto do balde uma origem consegue gastar.
//
// Nao fecha o ataque, encarece: quem tem proxy rotativo segue passando. O que
// muda e que um script numa maquina so nao derruba mais o funil de ninguem.
// ============================================================================

/**
 * O endereco que conta como "uma origem".
 *
 * IPv4 inteiro. IPv6 pelo /64: uma conexao residencial ou movel recebe um /64
 * inteiro, e quem conta pelo endereco completo deixa a mesma maquina trocar de
 * IP a cada requisicao. Qualquer coisa fora do formato devolve null -- e sem
 * chave nao ha teto por IP (o evento segue pelos outros tetos).
 */
export function chaveDoIp(bruto: string | null | undefined): string | null {
  let ip = (bruto || "").trim().toLowerCase();
  if (!ip || ip.length > 64) return null;
  // [2001:db8::1]:443 e a zona (%eth0) nao fazem parte do endereco.
  ip = ip.replace(/^\[([^\]]+)\](?::\d+)?$/, "$1").replace(/%.*$/, "");

  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?::\d+)?$/);
  if (v4) {
    const partes = v4.slice(1, 5).map(Number);
    return partes.some((n) => n > 255) ? null : partes.join(".");
  }

  const mapeado = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapeado) return chaveDoIp(mapeado[1]);

  if (!ip.includes(":") || !/^[0-9a-f:]+$/.test(ip)) return null;
  const metades = ip.split("::");
  if (metades.length > 2) return null;
  const esquerda = metades[0] ? metades[0].split(":") : [];
  const direita = metades.length === 2 && metades[1] ? metades[1].split(":") : [];
  const zeros = metades.length === 2 ? 8 - esquerda.length - direita.length : 0;
  // `::` vale pelo menos um grupo; sem `::`, sao exatamente oito.
  if (metades.length === 2 ? zeros < 1 : esquerda.length !== 8) return null;
  const grupos = [...esquerda, ...Array<string>(zeros).fill("0"), ...direita];
  if (grupos.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return `${grupos
    .slice(0, 4)
    .map((g) => parseInt(g, 16).toString(16))
    .join(":")}::/64`;
}

/**
 * O que vai para a coluna `ip_hash` (migration 065): HMAC da chave, nao o IP.
 *
 * Com segredo do servidor, e nao sha256 puro: IPv4 sao 4 bilhoes de valores, e
 * hash sem segredo se desfaz por forca bruta em minutos.
 */
export function hashDoIp(
  bruto: string | null | undefined,
  segredo: string = process.env.SUPABASE_SERVICE_ROLE_KEY || "xcart-ip"
): string | null {
  const chave = chaveDoIp(bruto);
  if (!chave) return null;
  return createHmac("sha256", segredo).update(`ip:${chave}`).digest("hex").slice(0, 32);
}

/** O IP de quem chamou: o primeiro do x-forwarded-for, que a Vercel reescreve. */
export function ipDaRequisicao(headers: Headers): string | null {
  return (
    (headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    headers.get("x-real-ip") ||
    null
  );
}
