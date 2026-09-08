import type { NextConfig } from "next";
/**
 * Cabecalhos de seguranca.
 *
 * O app nao mandava nenhum -- so o HSTS que a Vercel poe sozinha. Sem eles o
 * painel podia ser embutido em iframe de terceiro (clickjacking: o lojista
 * clica achando que esta noutro site e a acao vale na loja dele), e o
 * navegador ficava livre para adivinhar tipo de conteudo.
 *
 * Sem CSP com script-src por enquanto, de proposito: o app usa estilo inline e
 * o Next injeta script inline no bootstrap. Uma CSP escrita no chute vira duas
 * coisas ruins -- quebra a tela ou nasce cheia de 'unsafe-inline' e nao protege
 * nada. Fica frame-ancestors, que e a parte que ja da para cravar com certeza.
 */
const securityHeaders = [
  // Clickjacking: ninguem embute o painel.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  // Sem adivinhacao de tipo: um upload que "parece" HTML nao vira HTML.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Nao vaza o caminho interno do painel para site de terceiro.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // O app nao usa nada disso.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
];

const nextConfig: NextConfig = {
  // "standalone" so no Docker, que precisa do bundle com as dependencias
  // rastreadas (o Dockerfile copia .next/standalone). Na Vercel ele e
  // redundante -- ela tem o proprio formato de saida -- e a partir do Next 16.3
  // quebra o build la:
  //
  //   Error: ENOENT ... '.next/next-server.js.nft.json'
  //
  // Opt-IN por BUILD_STANDALONE em vez de opt-out por VERCEL de proposito: o
  // .env.local deste projeto tem VERCEL="1" (sobrou de um `vercel env pull`) e
  // o Next carrega esse arquivo no build, entao "nao estou na Vercel" nao e um
  // sinal confiavel aqui. Uma flag propria e explicita nao tem esse problema.
  ...(process.env.BUILD_STANDALONE === "1" ? { output: "standalone" as const } : {}),
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // O loader e servido para o tema da vitrine, em outro dominio. Os
        // cabecalhos acima continuam valendo nele e NAO atrapalham: frame-
        // ancestors e X-Frame-Options tratam de iframe, e o loader entra por
        // <script src>. O que falta aqui e so cache -- ele muda pouco e e
        // baixado em toda visita de comprador.
        source: "/routed-checkout-loader.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=300, must-revalidate" },
        ],
      },
    ];
  },
  turbopack: { root: __dirname },
  serverExternalPackages: ["playwright-core", "@sparticuz/chromium", "undici"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "ae01.alicdn.com" },
      { protocol: "https", hostname: "*.aliexpress.com" },
      { protocol: "https", hostname: "cdn.shopify.com" },
    ],
  },
};

export default nextConfig;
