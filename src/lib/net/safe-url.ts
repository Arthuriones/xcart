import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Trava contra SSRF nos fetch que usam URL vinda do usuario.
 *
 * ============================ POR QUE ISTO EXISTE ============================
 *
 * O xcart importa catalogo de "qualquer site": o usuario cola um endereco e o
 * SERVIDOR busca. Sem trava, isso e um proxy aberto de dentro da infra.
 *
 * A validacao que existia (normalizeShopDomain) so olhava o formato do nome.
 * Passavam, comprovadamente:
 *
 *   metadata.google.internal      -> servico de metadados da nuvem
 *   admin.svc.cluster.local       -> servico interno
 *   169.254.169.254.nip.io        -> nip.io resolve para o link-local
 *   10.0.0.1.sslip.io             -> mesma ideia, rede privada
 *
 * Nome nao basta: o que decide para onde a conexao vai e o IP RESOLVIDO. Por
 * isso a checagem aqui resolve o DNS e olha o endereco.
 *
 * ============================== E O REDIRECT ==============================
 *
 * Validar so a primeira URL tambem nao basta: um host publico pode responder
 * 302 para http://169.254.169.254 e o fetch segue sozinho. Por isso
 * safeFetch usa redirect "manual" e revalida CADA salto.
 *
 * Nao usa biblioteca: node:dns e node:net ja resolvem, e uma dependencia a
 * mais aqui seria superficie extra num arquivo cuja funcao e reduzir
 * superficie.
 */

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

/** Faixas que nunca sao destino legitimo de importacao. */
function ipEhPrivado(ip: string): boolean {
  const versao = isIP(ip);

  if (versao === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || // "este" host
      a === 10 || // privada
      a === 127 || // loopback
      (a === 169 && b === 254) || // link-local (metadados da nuvem)
      (a === 172 && b >= 16 && b <= 31) || // privada
      (a === 192 && b === 168) || // privada
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 192 && b === 0) || // IETF
      a >= 224 // multicast e reservado
    );
  }

  if (versao === 6) {
    const v = ip.toLowerCase();
    if (v === "::" || v === "::1") return true;
    if (v.startsWith("fe80")) return true; // link-local
    if (v.startsWith("fc") || v.startsWith("fd")) return true; // unique local
    // IPv4 mapeado em IPv6 (::ffff:127.0.0.1) burla a checagem se nao abrir.
    const mapeado = v.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapeado) return ipEhPrivado(mapeado[1]);
    return false;
  }

  return true; // nao e IP reconhecivel: nega
}

/** Sufixos que so existem dentro de rede privada. */
const SUFIXOS_INTERNOS = [
  ".internal",
  ".local",
  ".localhost",
  ".localdomain",
  ".home.arpa",
  ".cluster.local",
];

export interface UrlSeguraOk {
  url: URL;
  /** IPs para onde o host resolveu, ja aprovados. */
  ips: string[];
}

/**
 * Aprova (ou recusa) uma URL como destino de fetch no servidor.
 *
 * Lanca UnsafeUrlError com o motivo -- a mensagem e mostrada ao usuario, entao
 * diz o que houve sem expor topologia interna.
 */
export async function assertUrlPublica(entrada: string): Promise<UrlSeguraOk> {
  let url: URL;
  try {
    url = new URL(entrada);
  } catch {
    throw new UnsafeUrlError("Endereço inválido.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    // file:, data:, gopher:, ftp: -- nenhum tem uso legitimo aqui.
    throw new UnsafeUrlError("Use um endereço http ou https.");
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (!host) throw new UnsafeUrlError("Endereço sem domínio.");
  if (host === "localhost" || !host.includes(".")) {
    throw new UnsafeUrlError("Endereço não é público.");
  }
  if (SUFIXOS_INTERNOS.some((s) => host.endsWith(s))) {
    throw new UnsafeUrlError("Endereço não é público.");
  }

  // Host escrito como IP: decide sem consultar DNS.
  if (isIP(host)) {
    if (ipEhPrivado(host)) throw new UnsafeUrlError("Endereço não é público.");
    return { url, ips: [host] };
  }

  // O nome pode ser publico e apontar para dentro (nip.io, sslip.io, um A
  // record apontando para 10.x). Quem manda e o IP resolvido.
  let enderecos: { address: string }[];
  try {
    enderecos = await lookup(host, { all: true });
  } catch {
    throw new UnsafeUrlError("Não consegui resolver esse domínio.");
  }

  if (enderecos.length === 0) {
    throw new UnsafeUrlError("Não consegui resolver esse domínio.");
  }

  // TODOS precisam ser publicos: um host com dois A records, um publico e um
  // privado, escolheria o privado em metade das conexoes.
  for (const { address } of enderecos) {
    if (ipEhPrivado(address)) {
      throw new UnsafeUrlError("Endereço não é público.");
    }
  }

  return { url, ips: enderecos.map((e) => e.address) };
}

/** Versao que devolve boolean, para filtrar lista sem try/catch. */
export async function urlEhPublica(entrada: string): Promise<boolean> {
  try {
    await assertUrlPublica(entrada);
    return true;
  } catch {
    return false;
  }
}

const MAX_REDIRECTS = 5;

/**
 * fetch que valida a URL e CADA redirecionamento.
 *
 * Seguir redirect automaticamente anularia a checagem: basta o host publico
 * responder 302 para o link-local. Aqui cada salto passa pela mesma trava.
 */
export async function safeFetch(
  entrada: string,
  init?: RequestInit
): Promise<Response> {
  let alvo = entrada;

  for (let salto = 0; salto <= MAX_REDIRECTS; salto += 1) {
    const { url } = await assertUrlPublica(alvo);

    const resposta = await fetch(url, { ...init, redirect: "manual" });

    const ehRedirect =
      resposta.status >= 300 && resposta.status < 400 && resposta.headers.has("location");
    if (!ehRedirect) return resposta;

    const destino = resposta.headers.get("location") || "";
    // Location pode ser relativo.
    alvo = new URL(destino, url).toString();
  }

  throw new UnsafeUrlError("O endereço redirecionou vezes demais.");
}
