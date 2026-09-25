import { createHash } from "node:crypto";

// ============================================================================
// Normalizacao e hash dos sinais de identificacao.
//
// O Meta compara HASH com HASH. Se normalizarmos diferente do que ele
// normaliza, o hash muda e o casamento simplesmente nao acontece -- sem erro,
// sem aviso, so um Event Match Quality baixo que ninguem sabe explicar.
// "Joao@Gmail.com " e "joao@gmail.com" sao a mesma pessoa e produzem hashes
// diferentes se o trim e o lowercase nao vierem antes.
//
// Por isso tudo aqui e funcao pura: da para testar contra os exemplos da
// documentacao sem subir nada.
// ============================================================================

export function sha256(valor: string): string {
  return createHash("sha256").update(valor, "utf8").digest("hex");
}

/** Hash so do que tem conteudo -- string vazia viraria um hash constante que
 *  casa com todo mundo e envenena o match. */
function hashOuNulo(valor: string | null | undefined): string | null {
  const limpo = (valor || "").trim();
  return limpo ? sha256(limpo) : null;
}

export function normalizarEmail(email: string | null | undefined): string | null {
  const limpo = (email || "").trim().toLowerCase();
  // Sem arroba nao e e-mail; mandar lixo hashado so suja o match.
  if (!limpo || !limpo.includes("@")) return null;
  return limpo;
}

/**
 * Codigo de pais -> prefixo telefonico, para os mercados onde o xcart opera.
 *
 * Existe porque o Meta quer o telefone COM codigo de pais e sem o '+', e nem
 * toda loja guarda assim. Pais fora desta lista cai no caminho conservador
 * (ver normalizarTelefone).
 */
const DDI: Record<string, string> = {
  BR: "55", US: "1", CA: "1", GB: "44", IE: "353", PT: "351", ES: "34",
  FR: "33", DE: "49", IT: "39", JP: "81", CL: "56", AR: "54", MX: "52",
  CO: "57", PE: "51", UY: "598", PY: "595", AU: "61", NZ: "64",
};

/**
 * Telefone em E.164 sem o '+', que e o formato que o Meta espera.
 *
 * O caso chato e o telefone nacional: "11 98765-4321" no Brasil precisa virar
 * "5511987654321". Para isso e preciso saber o pais -- e o zero inicial, que e
 * prefixo de tronco nacional e nao existe no numero internacional, tem que
 * cair antes de colar o DDI.
 *
 * Sem pais conhecido, devolvemos so os digitos: um numero que ja venha
 * internacional continua certo, e um nacional vira hash que nao casa -- o que
 * e melhor do que colar um DDI errado e casar com a pessoa errada.
 */
export function normalizarTelefone(
  telefone: string | null | undefined,
  pais?: string | null
): string | null {
  const bruto = (telefone || "").trim();
  if (!bruto) return null;

  const jaInternacional = bruto.startsWith("+");
  let digitos = bruto.replace(/\D/g, "");
  if (!digitos) return null;

  if (jaInternacional) return digitos;

  const ddi = pais ? DDI[pais.trim().toUpperCase()] : undefined;
  if (!ddi) return digitos;

  if (digitos.startsWith(ddi)) return digitos;
  // Tronco nacional: 0 na frente nao existe no formato internacional.
  digitos = digitos.replace(/^0+/, "");
  return ddi + digitos;
}

/** Nome: minusculo, sem acento, so letras. O Meta remove pontuacao antes de
 *  hashear; manter "d'avila" e "davila" como coisas diferentes perderia match. */
export function normalizarNome(nome: string | null | undefined): string | null {
  const limpo = (nome || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z]/g, "");
  return limpo || null;
}

/** Cidade: minusculo, sem acento, sem espaco nem pontuacao ("Sao Paulo" -> "saopaulo"). */
export function normalizarCidade(cidade: string | null | undefined): string | null {
  const limpo = (cidade || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
  return limpo || null;
}

/**
 * Estado: sigla em minusculo.
 *
 * A Shopify manda tanto "SP" quanto "Sao Paulo" dependendo do pais e de como o
 * comprador digitou. Quando vier por extenso, mandamos normalizado do mesmo
 * jeito -- o Meta aceita, e inventar uma tabela de siglas para o mundo inteiro
 * daria mais erro que acerto.
 */
export function normalizarEstado(estado: string | null | undefined): string | null {
  return normalizarCidade(estado);
}

/**
 * CEP: minusculo, sem espaco nem hifen. Nos EUA, so os 5 primeiros digitos --
 * o ZIP+4 nao casa com o cadastro do Meta.
 */
export function normalizarCep(
  cep: string | null | undefined,
  pais?: string | null
): string | null {
  const limpo = (cep || "").trim().toLowerCase().replace(/[\s-]/g, "");
  if (!limpo) return null;
  if ((pais || "").trim().toUpperCase() === "US") {
    const digitos = limpo.replace(/\D/g, "");
    return digitos.slice(0, 5) || null;
  }
  return limpo;
}

/** Pais: ISO-3166-1 alfa-2 em minusculo. */
export function normalizarPais(pais: string | null | undefined): string | null {
  const limpo = (pais || "").trim().toLowerCase();
  return /^[a-z]{2}$/.test(limpo) ? limpo : null;
}

export interface DadosPessoais {
  email?: string | null;
  telefone?: string | null;
  primeiroNome?: string | null;
  sobrenome?: string | null;
  cidade?: string | null;
  estado?: string | null;
  cep?: string | null;
  pais?: string | null;
  /** Id estavel do comprador na loja (customer id da Shopify). */
  externalId?: string | null;
}

/** O bloco `user_data` do CAPI, com todo campo de PII ja em SHA-256. */
export interface UserData {
  em?: string[];
  ph?: string[];
  fn?: string[];
  ln?: string[];
  ct?: string[];
  st?: string[];
  zp?: string[];
  country?: string[];
  external_id?: string[];
  fbp?: string;
  fbc?: string;
  client_ip_address?: string;
  client_user_agent?: string;
}

/**
 * Monta o user_data do CAPI.
 *
 * Mandar so fbp/fbc e o erro que trava o Event Match Quality em 4: sao dois
 * sinais, e o Meta pontua pela QUANTIDADE de sinais que conferem. Cada campo a
 * mais -- nome, cidade, CEP -- sobe a nota, e todos saem do proprio pedido.
 *
 * IP e user agent vao em CLARO de proposito: o Meta os usa para geolocalizar e
 * casar sessao, e hashear ali quebraria o match.
 */
export function montarUserData(
  dados: DadosPessoais,
  sinais: {
    fbp?: string | null;
    fbc?: string | null;
    clientIp?: string | null;
    userAgent?: string | null;
  } = {}
): UserData {
  const pais = dados.pais;
  const saida: UserData = {};

  const email = normalizarEmail(dados.email);
  if (email) saida.em = [sha256(email)];

  const telefone = normalizarTelefone(dados.telefone, pais);
  if (telefone) saida.ph = [sha256(telefone)];

  const fn = normalizarNome(dados.primeiroNome);
  if (fn) saida.fn = [sha256(fn)];

  const ln = normalizarNome(dados.sobrenome);
  if (ln) saida.ln = [sha256(ln)];

  const ct = normalizarCidade(dados.cidade);
  if (ct) saida.ct = [sha256(ct)];

  const st = normalizarEstado(dados.estado);
  if (st) saida.st = [sha256(st)];

  const zp = normalizarCep(dados.cep, pais);
  if (zp) saida.zp = [sha256(zp)];

  const pa = normalizarPais(pais);
  if (pa) saida.country = [sha256(pa)];

  // external_id nao tem formato definido pelo Meta: e um id nosso, estavel.
  // Hasheamos porque identifica pessoa.
  const ext = hashOuNulo(dados.externalId);
  if (ext) saida.external_id = [ext];

  if (sinais.fbp) saida.fbp = sinais.fbp;
  if (sinais.fbc) saida.fbc = sinais.fbc;
  if (sinais.clientIp) saida.client_ip_address = sinais.clientIp;
  if (sinais.userAgent) saida.client_user_agent = sinais.userAgent;

  return saida;
}

/**
 * Monta o `fbc` quando o cookie `_fbc` nao existe mas o `fbclid` esta na mao.
 *
 * Formato: fb.1.{timestamp_ms_do_clique}.{fbclid}
 *
 * Acontece o tempo todo: o comprador chega pelo anuncio, o pixel do navegador
 * nao roda (bloqueador, ITP, aba fechada antes), e o clique so sobrevive
 * porque guardamos o fbclid. Sem reconstruir o fbc aqui, essa venda perde a
 * ligacao com o anuncio que a gerou.
 */
export function montarFbc(
  fbclid: string | null | undefined,
  quandoMs: number = Date.now()
): string | null {
  const limpo = (fbclid || "").trim();
  if (!limpo) return null;
  return `fb.1.${Math.floor(quandoMs)}.${limpo}`;
}

/** Quantos sinais de match o evento leva -- e o que o Meta pontua no EMQ. */
export function contarSinais(userData: UserData): number {
  return Object.values(userData).filter((v) =>
    Array.isArray(v) ? v.length > 0 : Boolean(v)
  ).length;
}
