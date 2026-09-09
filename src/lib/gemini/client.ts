import { GoogleGenerativeAI, type Part } from "@google/generative-ai";
import { safeFetch } from "@/lib/net/safe-url";
import {
  comTempoLimite,
  MAX_TOKENS_TEXTO_LONGO,
  TIMEOUT_TEXTO_MS,
} from "@/lib/ai/limites";
import { marketContextBlock } from "@/lib/gemini/market-profile";
import type {
  AliExpressProduct,
  OptimizationResult,
  ShopifyTaxonomySuggestion,
  StoreContext,
  StorePolicy,
  StoreSetup,
} from "@/types";

/**
 * O cliente nasce na PRIMEIRA chamada, nao no import.
 *
 * Ler process.env no topo do modulo parece inofensivo porque no Next o env ja
 * esta carregado antes de qualquer import. Fora dele nao esta: num script de
 * operacao, `import { healRoute }` hoista acima do `config({ path: ".env.local" })`
 * e o cliente nascia com a chave vazia -- sem erro, so respondendo mal.
 *
 * Foi assim que 64 produtos entraram na dark store com o nome da marca no
 * titulo E no vendor, que e exatamente o que a neutralizacao existe para
 * evitar. Adiar a leitura fecha a porta para a familia inteira desse bug.
 */
let genAICache: GoogleGenerativeAI | null = null;

function genAIClient() {
  if (!genAICache) {
    const chave = process.env.GEMINI_API_KEY;
    // Falhar alto: sem chave, a alternativa e devolver texto nao neutralizado
    // e mandar produto de marca para a loja que cobra.
    if (!chave) throw new Error("GEMINI_API_KEY ausente: nao da para chamar a IA.");
    genAICache = new GoogleGenerativeAI(chave);
  }
  return genAICache;
}

/**
 * Ponto unico das 6 chamadas deste arquivo -- e por isso o lugar certo para os
 * tetos.
 *
 * Nenhuma delas tinha `maxOutputTokens` nem prazo. Numa importacao de 250
 * produtos isso multiplica por 250, e o gatilho de uma resposta longa pode vir
 * do proprio conteudo de origem, que o lojista nao controla. Sem prazo, uma
 * chamada pendurada segura o slot da funcao serverless e trava a fila atras.
 */
const model = {
  generateContent: (
    ...args: Parameters<ReturnType<GoogleGenerativeAI["getGenerativeModel"]>["generateContent"]>
  ) =>
    comTempoLimite(
      genAIClient()
        .getGenerativeModel({
          model: "gemini-2.5-flash",
          generationConfig: { maxOutputTokens: MAX_TOKENS_TEXTO_LONGO },
        })
        .generateContent(...args),
      TIMEOUT_TEXTO_MS,
      "geracao de texto"
    ),
};

function targetLanguage(context?: StoreContext) {
  return context?.targetLanguage || "pt-BR";
}

export async function optimizeProduct(
  product: AliExpressProduct,
  context: StoreContext,
  customPrompt?: string
): Promise<OptimizationResult> {
  const language = targetLanguage(context);
  const normalizedCustomPrompt = customPrompt?.trim();
  const prompt = `Você é um copywriter especialista em e-commerce para lojas Shopify.

Sua tarefa: transformar este produto importado de uma origem externa em um produto profissional para vender no Brasil.

Loja: "${context.name}"
Nicho: "${context.niche}"
Público-alvo: "${context.targetAudience || "Não especificado"}"
Voz da marca: "${context.brandVoice || "Profissional e confiante"}"
Sobre a loja: "${context.storeDescription || "Não especificado"}"
Idioma final obrigatório: "${language}"

Produto original:
- Título: ${product.title}
- Descrição: ${product.description || "Sem descrição"}
- Preço: US$${product.price}
- Avaliação: ${product.rating || "N/A"} estrelas
- Pedidos: ${product.orders || "N/A"}
- Especificações: ${JSON.stringify(product.specs)}

REGRAS OBRIGATÓRIAS:
1. TUDO no idioma final obrigatório "${language}". Não misture idiomas.
2. Título: máximo 70 caracteres, com palavra-chave principal, sem chinês/caracteres estranhos, sem nome de marketplace/fornecedor
3. Descrição: HTML formatado e profissional com:
   - Headline chamativa com benefício principal
   - 3-5 bullet points com benefícios (usar emojis ✅ nos bullets)
   - Especificações técnicas em tabela HTML simples
   - Call-to-action final
   - NÃO mencionar China, AliExpress, Shopee, Temu, marketplace, importação, dropshipping ou fornecedor original
   - Tom: confiante, profissional, focado em benefícios
4. Tags: 5-8 tags em português, relevantes para SEO no Brasil
5. SEO Title: máximo 60 caracteres, em português
6. SEO Description: máximo 155 caracteres, em português, com call-to-action
${normalizedCustomPrompt ? `
INSTRUCOES PERSONALIZADAS DO USUARIO (PRIORIDADE ALTA):
${normalizedCustomPrompt}
- Siga estas instrucoes sempre que forem compativeis com as regras obrigatorias.
` : ""}

Responda APENAS em JSON válido neste formato:
{
  "title": "...",
  "description": "<html formatado>",
  "tags": ["tag1", "tag2"],
  "seoTitle": "...",
  "seoDescription": "..."
}`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  return parseJsonResponse<OptimizationResult>(text);
}
export async function generateStorePolicies(
  context: StoreContext
): Promise<StorePolicy[]> {
  const language = targetLanguage(context);
  const prompt = `Gere polÃ­ticas profissionais e completas para a loja Shopify "${context.name}" no nicho "${context.niche}".

PÃºblico-alvo: "${context.targetAudience || "NÃ£o especificado"}"
Voz da marca: "${context.brandVoice || "Profissional e confiante"}"
Sobre a loja: "${context.storeDescription || "NÃ£o especificado"}"
Idioma final obrigatÃ³rio: "${language}"

Gere 4 polÃ­ticas no idioma final obrigatÃ³rio:
1. PolÃ­tica de Reembolso
2. PolÃ­tica de Privacidade
3. Termos de ServiÃ§o
4. PolÃ­tica de Envio

Contexto da loja (derivado do idioma configurado — NAO assuma Brasil):
${marketContextBlock(language)}
- Rastreamento disponivel para todos os pedidos
- Cite a base legal de consumo e a lei de protecao de dados indicadas acima,
  e NAO cite legislacao de outro pais

Cada polÃ­tica deve:
- Ser profissional e transmitir confianÃ§a
- Estar formatada em HTML limpo
- Ser completa mas objetiva
- Usar linguagem acessÃ­vel
- Estar 100% no idioma final obrigatÃ³rio "${language}"

Responda APENAS em JSON vÃ¡lido:
[
  { "type": "refund", "title": "PolÃ­tica de Reembolso", "body": "<html>" },
  { "type": "privacy", "title": "PolÃ­tica de Privacidade", "body": "<html>" },
  { "type": "terms", "title": "Termos de ServiÃ§o", "body": "<html>" },
  { "type": "shipping", "title": "PolÃ­tica de Envio", "body": "<html>" }
]`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  return parseJsonResponse<StorePolicy[]>(text);
}

export async function suggestThemeImprovements(
  context: StoreContext,
  currentTheme: string
): Promise<string> {
  const language = targetLanguage(context);
  const prompt = `VocÃª Ã© um especialista em design e conversÃ£o de lojas Shopify.

Loja: "${context.name}"
Nicho: "${context.niche}"
PÃºblico-alvo: "${context.targetAudience || "NÃ£o especificado"}"
Voz da marca: "${context.brandVoice || "Profissional e confiante"}"
Sobre a loja: "${context.storeDescription || "NÃ£o especificado"}"
Tema atual: "${currentTheme}"
Idioma da resposta: "${language}"

Contexto de mercado (derivado do idioma da loja — adapte badges de pagamento,
moeda, prazos e provas sociais a ESTE mercado, nao ao Brasil):
${marketContextBlock(language)}

Contexto: o tema atual tem elementos de conversao como:
- BotÃ£o "Comprar Agora" verde (#16c789) direto pro checkout
- Countdown timer de ofertas
- Barra de escassez ("Restam X unidades")
- Calculadora de frete por CEP
- Badges de pagamento (Visa, Mastercard, PIX, etc)
- SeÃ§Ãµes de confianÃ§a (devoluÃ§Ã£o, envio nacional)
- Parcelamento em atÃ© 12x
- Frete grÃ¡tis acima de R$200
- Fonte Montserrat

Sugira melhorias ESPECÃFICAS e PRÃTICAS para aumentar conversÃ£o. Inclua:
1. Melhorias na pÃ¡gina de produto (acima da dobra)
2. Melhorias na homepage (hero, produtos em destaque)
3. Elementos de prova social e confianÃ§a
4. OtimizaÃ§Ãµes mobile
5. Cores e tipografia que funcionam no nicho "${context.niche}"

Seja direto e prÃ¡tico. Cada sugestÃ£o deve ser acionÃ¡vel.
Responda no idioma "${language}", formatado em Markdown.`;

  const result = await model.generateContent(prompt);
  return result.response.text();
}

export async function generateStoreSetup(
  context: StoreContext
): Promise<StoreSetup> {
  const storeName = context.name;
  const niche = context.niche;
  const language = targetLanguage(context);
  const prompt = `VocÃª Ã© um especialista em configuraÃ§Ã£o de lojas Shopify brasileiras de dropshipping usando o tema Vessel.

Gere a configuraÃ§Ã£o COMPLETA da loja "${storeName}" no nicho "${niche}".

PÃºblico-alvo: "${context.targetAudience || "NÃ£o especificado"}"
Voz da marca: "${context.brandVoice || "Profissional e confiante"}"
Sobre a loja: "${context.storeDescription || "NÃ£o especificado"}"
Idioma final obrigatÃ³rio para polÃ­ticas, pÃ¡ginas, menus, FAQ e copyright: "${language}"

CONTEXTO DO TEMA VESSEL:
- Header usa menu com handle "main-menu"
- Footer usa menu com handle "footer"
- Footer tem bloco de links de polÃ­ticas que renderiza automaticamente das polÃ­ticas do Shopify
- PolÃ­ticas sÃ£o publicadas via shopPolicyUpdate mutation (tipos: refund, privacy, terms, shipping)
- PÃ¡ginas adicionais (Sobre, Contato, FAQ) sÃ£o Shopify Pages
- BotÃ£o CTA verde (#16c789), countdown timer, barra de escassez, badges de pagamento
- Parcelamento 12x, frete grÃ¡tis acima de R$200

GERE:

1. **4 PolÃ­ticas** (refund, privacy, terms, shipping):
   - HTML limpo e profissional
   - Use EXATAMENTE o contexto de mercado abaixo (derivado do idioma da loja;
     NAO assuma Brasil e NAO cite legislacao de outro pais):
${marketContextBlock(language)}
   - Rastreamento disponivel para todos os pedidos

2. **Menu principal** (handle: main-menu):
   - InÃ­cio (/)
   - CatÃ¡logo (/collections/all)
   - Sobre (/pages/sobre)
   - Contato (/pages/contato)
   - Rastreamento (/pages/rastreamento)

3. **Menu footer** (handle: footer):
   - PolÃ­tica de Privacidade (/policies/privacy-policy)
   - Termos de ServiÃ§o (/policies/terms-of-service)
   - PolÃ­tica de Reembolso (/policies/refund-policy)
   - PolÃ­tica de Envio (/policies/shipping-policy)
   - Contato (/pages/contato)

4. **PÃ¡ginas** (Shopify Pages):
   - **Sobre**: histÃ³ria profissional da marca no nicho "${niche}", tom confiante e aspiracional
   - **Contato**: formulÃ¡rio conceitual com email placeholder (contato@${storeName.toLowerCase().replace(/\s+/g, "")}.com) e canal de mensagem usual do mercado
   - **Rastreamento**: explica como rastrear pedidos passo a passo, usando o prazo de entrega do contexto de mercado acima, link para 17track.net
   - **FAQ**: perguntas frequentes sobre prazo de entrega, formas de pagamento, trocas/devoluÃ§Ãµes, como escolher tamanho, seguranÃ§a do site

5. **Copyright**: "2025 ${storeName} - Todos os Direitos Reservados"

REGRAS:
- TUDO no idioma final obrigatÃ³rio "${language}"
- Tom profissional, transmitir confianÃ§a
- HTML limpo sem CSS inline excessivo, usar tags semÃ¢nticas (h2, h3, p, ul, li)
- NÃƒO mencionar China, AliExpress, importaÃ§Ã£o, dropshipping
- PolÃ­ticas devem parecer de uma marca estabelecida no mercado indicado acima
- FAQ deve abordar duvidas reais de compradores online desse mercado

Responda APENAS em JSON vÃ¡lido:
{
  "policies": [
    { "type": "refund", "title": "PolÃ­tica de Reembolso", "body": "<html>" },
    { "type": "privacy", "title": "PolÃ­tica de Privacidade", "body": "<html>" },
    { "type": "terms", "title": "Termos de ServiÃ§o", "body": "<html>" },
    { "type": "shipping", "title": "PolÃ­tica de Envio", "body": "<html>" }
  ],
  "mainMenu": {
    "title": "Main menu",
    "handle": "main-menu",
    "items": [
      { "title": "InÃ­cio", "url": "/" },
      { "title": "CatÃ¡logo", "url": "/collections/all" },
      { "title": "Sobre", "url": "/pages/sobre" },
      { "title": "Contato", "url": "/pages/contato" },
      { "title": "Rastreamento", "url": "/pages/rastreamento" }
    ]
  },
  "footerMenu": {
    "title": "Footer",
    "handle": "footer",
    "items": [
      { "title": "PolÃ­tica de Privacidade", "url": "/policies/privacy-policy" },
      { "title": "Termos de ServiÃ§o", "url": "/policies/terms-of-service" },
      { "title": "PolÃ­tica de Reembolso", "url": "/policies/refund-policy" },
      { "title": "PolÃ­tica de Envio", "url": "/policies/shipping-policy" },
      { "title": "Contato", "url": "/pages/contato" }
    ]
  },
  "pages": [
    { "title": "Sobre", "handle": "sobre", "body": "<html>" },
    { "title": "Contato", "handle": "contato", "body": "<html>" },
    { "title": "Rastreamento", "handle": "rastreamento", "body": "<html>" },
    { "title": "FAQ", "handle": "faq", "body": "<html>" }
  ],
  "copyright": "2025 ${storeName} - Todos os Direitos Reservados"
}`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  return parseJsonResponse<StoreSetup>(text);
}

export async function generateImageEditPrompt(
  originalImageUrl: string,
  productTitle: string,
  context?: StoreContext
): Promise<string> {
  const brandContext = context
    ? `\nContexto da marca: Loja "${context.name}" no nicho "${context.niche}". Idioma da loja: ${targetLanguage(context)}. ${context.brandVoice ? `Estilo: ${context.brandVoice}.` : ""} ${context.storeDescription || ""}`
    : "";

  const prompt = `VocÃª Ã© um especialista em descriÃ§Ã£o de imagens para e-commerce.

Analise a imagem de produto disponÃ­vel nesta URL: ${originalImageUrl}

Produto: "${productTitle}"${brandContext}

Sua tarefa: criar uma descriÃ§Ã£o DETALHADA da imagem para que um modelo de geraÃ§Ã£o de imagens possa recriar esta foto de produto de forma limpa e profissional, SEM:
- Logos ou marcas d'Ã¡gua de marketplace, fornecedor ou loja de origem
- Textos em chinÃªs
- Watermarks de qualquer tipo
- Fundos poluÃ­dos

A descriÃ§Ã£o deve incluir:
1. Produto principal: o que Ã©, cor, formato, materiais visÃ­veis
2. Ã‚ngulo da foto: frontal, lateral, 45 graus, flat lay, etc.
3. Fundo: cor sÃ³lida (branco preferÃ­vel), gradiente, ou contexto de uso
4. IluminaÃ§Ã£o: suave, direcional, estÃºdio, natural
5. ComposiÃ§Ã£o: centralizado, com espaÃ§o negativo, close-up, etc.
6. Detalhes relevantes: texturas, acabamentos, elementos decorativos

Formato da resposta: um parÃ¡grafo Ãºnico e detalhado em inglÃªs, otimizado como prompt para geraÃ§Ã£o de imagem. Comece com "Product photography of..." e seja especÃ­fico sobre cada detalhe visual.

Responda APENAS com o prompt de imagem, sem explicaÃ§Ãµes adicionais.`;

  const result = await model.generateContent(prompt);
  return result.response.text().trim();
}

async function imagePartFromUrl(url?: string | null): Promise<Part | null> {
  const imageUrl = String(url || "").trim();
  if (!imageUrl) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    // URL de imagem vinda de produto importado -- ou seja, de fora. safeFetch
    // resolve o DNS e recusa rede interna antes de conectar.
    const response = await safeFetch(imageUrl, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) return null;

    const mimeType = response.headers.get("content-type")?.split(";")[0] || "image/jpeg";
    if (!mimeType.startsWith("image/")) return null;

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > 7 * 1024 * 1024) return null;

    return {
      inlineData: {
        mimeType,
        data: bytes.toString("base64"),
      },
    };
  } catch {
    return null;
  }
}

export async function suggestShopifyTaxonomy(
  input: {
    title: string;
    descriptionHtml?: string;
    tags?: string[];
    options?: { name: string; values: string[] }[];
    sourceCategory?: string | null;
    sourceAttributes?: { name: string; value: string }[];
    sourceCategoryTrusted?: boolean;
    imageUrl?: string | null;
  },
  context?: StoreContext | null
): Promise<ShopifyTaxonomySuggestion> {
  const plainDescription = (input.descriptionHtml || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1200);
  const prompt = `Voce e um especialista em cadastro Shopify e taxonomia de produtos.

Classifique o produto para a Shopify Standard Product Taxonomy.

Contexto da loja:
- Nicho: ${context?.niche || "Nao informado"}
- Publico: ${context?.targetAudience || "Nao informado"}
- Idioma da loja: ${context?.targetLanguage || "pt-BR"}

Produto:
- Titulo: ${input.title}
- Descricao: ${plainDescription || "Sem descricao"}
- Tags: ${(input.tags || []).join(", ") || "Sem tags"}
- Categoria na fonte: ${input.sourceCategory || "Nao informada"}
- Categoria na fonte e confiavel?: ${input.sourceCategoryTrusted === false ? "Nao, pode estar errada" : "Sim, use como pista forte"}
- Opcoes/variantes: ${JSON.stringify(input.options || [])}
- Atributos encontrados na fonte: ${JSON.stringify(input.sourceAttributes || [])}
- Imagem principal enviada para analise visual?: ${input.imageUrl ? "Sim" : "Nao"}

Responda APENAS JSON valido.

Regras:
1. "categorySearch" deve ser uma busca curta em ingles para a categoria mais especifica da Shopify, por exemplo "Women's Coats", "Women's Jackets", "Ski Pants", "Dog Beds".
2. "productType" deve ser um tipo curto no idioma da loja, por exemplo "Casaco feminino".
3. Se a categoria na fonte nao for confiavel, trate-a apenas como contexto fraco. Se conflitar com titulo, descricao, tags ou opcoes, ignore a categoria na fonte e reclassifique pelo produto real.
4. "attributes" deve conter apenas atributos relevantes e confiaveis para o produto. Priorize: product_subtype, gender, size, color, material, age_group, pattern.
5. Para roupas, calcados, acessorios e joias, sempre preencha age_group quando a imagem/texto permitir. Se a imagem nao mostra claramente produto de bebe/crianca, use age_group "Adulto". So use "Bebe" ou "Infantil" quando texto OU imagem indicarem claramente tamanho/uso infantil.
6. Se um atributo existir na fonte, use o valor da fonte somente se ele for coerente com o produto. Nao chute tamanho/cor especifica se nao aparecer no titulo, descricao, opcoes ou imagens textuais.
7. Se o titulo tiver "snow jacket", "ski jacket", "insulated jacket", "snowboard jacket" ou equivalente, classifique como outerwear/coats/jackets. Nunca use lingerie, underwear, undershirts ou roupas intimas.
8. Se o titulo tiver "snow pants", "ski pants", "snowboard pants" ou equivalente, classifique como pants/bottoms/outerwear. Nunca use lingerie, underwear ou ceroulas.
9. Quando a imagem foi enviada, use a imagem para confirmar o tipo visual do produto, cor dominante, genero aparente, faixa etaria visual e se e roupa externa, roupa intima, calcado, joia etc. Se texto e imagem conflitarem, privilegie a imagem para tipo/categoria visual.
10. Nunca classifique em Baby, Children's, Kids, Toddler ou Infant se a imagem/texto nao indicarem claramente produto infantil. Na duvida, escolha uma categoria adulta/generica de Apparel & Accessories.
11. Para valores multiplos, use array.

Formato:
{
  "categorySearch": "...",
  "productType": "...",
  "attributes": [
    { "name": "Subtipo", "key": "product_subtype", "value": "Pulseira" },
    { "name": "Genero", "key": "gender", "value": "Feminino" },
    { "name": "Cor", "key": "color", "value": ["Preto", "Azul"] }
  ]
}`;

  const imagePart = await imagePartFromUrl(input.imageUrl);
  const result = await model.generateContent(
    imagePart ? [{ text: prompt }, imagePart] : prompt
  );
  const parsed = parseJsonResponse<ShopifyTaxonomySuggestion>(result.response.text());

  return {
    categorySearch: String(parsed.categorySearch || "").trim(),
    productType: String(parsed.productType || "").trim(),
    attributes: Array.isArray(parsed.attributes) ? parsed.attributes : [],
  };
}

function sanitizeJsonString(str: string): string {
  // Remove control characters (except \n, \r, \t which are valid in JSON strings)
  return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

function parseJsonResponse<T>(text: string): T {
  // Remover markdown code blocks se presentes
  const cleaned = sanitizeJsonString(
    text
      .replace(/```json\s*/gi, "")
      .replace(/```\s*/g, "")
      .trim()
  );

  // Tentar parse direto
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Fallback: extrair JSON do texto
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrayMatch) return JSON.parse(arrayMatch[0]) as T;

    const objMatch = cleaned.match(/\{[\s\S]*\}/);
    if (objMatch) return JSON.parse(objMatch[0]) as T;

    throw new Error("A IA nÃ£o retornou JSON vÃ¡lido. Tente novamente.");
  }
}
