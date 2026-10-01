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

  // "00" e o prefixo de discagem internacional da Europa e da maior parte do
  // mundo: "0033 6 12..." e o "+33 6 12..." escrito de outro jeito. Tratado
  // como nacional, perdia os zeros e ganhava o DDI do pedido de novo --
  // "3333612345678". O SDK oficial do Meta tira o "00" do mesmo jeito.
  if (digitos.startsWith("00")) return digitos.slice(2) || null;

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

// Fora de literal de regex: `\p{...}` e ES2018 e o tsconfig mira ES2017. O Node
// do runtime suporta.
//
// \p{M} (marcas combinantes) fica. Em devanagari, tailandes e tamil as vogais
// sao marcas que o NFC nao compoe: sem \p{M}, "सुनील" (Sunil) virava "सनल"
// (Sanal, outro nome). Nas escritas latinas o NFC ja juntou o acento a letra,
// entao nada muda ali.
const NAO_LETRA = new RegExp("[^\\p{L}\\p{M}]", "gu");
const NAO_LETRA_NEM_DIGITO = new RegExp("[^\\p{L}\\p{M}\\p{N}]", "gu");

/**
 * As formas de um nome que valem hashear: com acento e sem.
 *
 * A documentacao do Meta manda nome acentuado em UTF-8 ("Valéry" -> "valéry",
 * com o hash publicado), e o SDK oficial so faz trim e minusculo. A forma sem
 * acento ("valery") casa quando o cadastro do lado do Meta tambem nao tem
 * acento -- comum, porque muita gente digita sem. Mandar uma so perde o outro
 * grupo. O campo aceita LISTA e o Meta casa por qualquer item, entao vao as
 * duas quando diferem; nome sem acento continua um hash so.
 *
 * Escrita nao latina ("田中") nao tem forma sem acento: a de UTF-8 e a unica,
 * e antes o campo nem saia.
 */
export function variantesDoNome(nome: string | null | undefined): string[] {
  const utf8 = (nome || "").trim().toLowerCase().normalize("NFC").replace(NAO_LETRA, "");
  return [...new Set([utf8, normalizarNome(nome)])].filter((v): v is string => Boolean(v));
}

/** Mesma ideia de variantesDoNome, para a cidade ("Orléans": "orléans" e "orleans"). */
export function variantesDaCidade(cidade: string | null | undefined): string[] {
  const utf8 = (cidade || "")
    .trim()
    .toLowerCase()
    .normalize("NFC")
    .replace(NAO_LETRA_NEM_DIGITO, "");
  return [...new Set([utf8, normalizarCidade(cidade)])].filter((v): v is string =>
    Boolean(v)
  );
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
  /**
   * O pais do lugar de onde o telefone veio, quando difere de `pais`. Ausente =
   * `pais`. Existe porque o telefone pode vir do endereco de entrega e o pais
   * do pedido, da cobranca -- e o DDI tem que ser o do telefone.
   */
  paisDoTelefone?: string | null;
  primeiroNome?: string | null;
  sobrenome?: string | null;
  cidade?: string | null;
  estado?: string | null;
  cep?: string | null;
  pais?: string | null;
  /**
   * Ids estaveis desta pessoa. Varios de proposito.
   *
   * O Meta aceita `external_id` como LISTA e tenta casar por qualquer um. Isso
   * importa porque o funil e a compra conhecem identificadores diferentes: no
   * carrinho so existe o id de visitante do nosso cookie; no pedido existe
   * tambem o customer id da Shopify. Mandando so um de cada lado, o Meta nao
   * liga o carrinho a venda da MESMA pessoa -- e a ligacao e justamente o que
   * ele usa para atribuir e para montar publico semelhante.
   */
  externalIds?: (string | null | undefined)[];
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

  const telefone = normalizarTelefone(dados.telefone, dados.paisDoTelefone || pais);
  if (telefone) saida.ph = [sha256(telefone)];

  // Com acento e sem, quando diferem: ver variantesDoNome.
  const fn = variantesDoNome(dados.primeiroNome);
  if (fn.length) saida.fn = fn.map(sha256);

  const ln = variantesDoNome(dados.sobrenome);
  if (ln.length) saida.ln = ln.map(sha256);

  const ct = variantesDaCidade(dados.cidade);
  if (ct.length) saida.ct = ct.map(sha256);

  const st = normalizarEstado(dados.estado);
  if (st) saida.st = [sha256(st)];

  const zp = normalizarCep(dados.cep, pais);
  if (zp) saida.zp = [sha256(zp)];

  const pa = normalizarPais(pais);
  if (pa) saida.country = [sha256(pa)];

  // external_id nao tem formato definido pelo Meta: sao ids nossos, estaveis.
  // Hasheados porque identificam pessoa.
  const exts: string[] = [];
  for (const bruto of dados.externalIds || []) {
    const h = hashOuNulo(bruto);
    // Repetido nao ajuda e gasta espaco do payload.
    if (h && !exts.includes(h)) exts.push(h);
  }
  if (exts.length) saida.external_id = exts;

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

/**
 * So os digitos do AW-XXXXXXXXX do Google Ads.
 *
 * O lojista copia "AW-123456789" do painel, mas o caminho do endpoint de
 * conversao leva so o numero. Aceitar os dois formatos evita o erro mais bobo
 * possivel -- colar como veio e a conversao nunca chegar.
 */
export function apenasNumeroDaConversao(id: string): string | null {
  const m = (id || "").trim().match(/(\d{6,})/);
  return m ? m[1] : null;
}
