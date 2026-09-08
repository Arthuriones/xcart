/**
 * Da a vitrine Culture Kings um frete que funciona na Australia.
 *
 * O perfil de entrega veio da loja chilena e ninguem trocou os valores. Com a
 * loja passada para AUD, as taxas continuaram com os NUMEROS em peso:
 *
 *   Domestic (CL)                 4.000  -> A$ 4.000
 *   International (inclui AU)    18.000  -> A$ 18.000
 *
 * Ou seja: o australiano chegava no checkout e via dezoito mil dolares de
 * frete. Nao e "faltando preencher", e uma venda impossivel.
 *
 * O conserto cria uma zona Australia com taxa em AUD e TIRA a AU da zona
 * International -- a Shopify recusa o mesmo pais em duas zonas do mesmo
 * perfil, entao as duas coisas tem que ir na mesma chamada.
 *
 * Uso:  npx tsx scripts/consertar-frete-culture-kings.ts [--aplicar]
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { shopifyGraphQL } from "../src/lib/shopify/client";

config({ path: ".env.local" });

const VITRINE = "vvq0qq-ih.myshopify.com";
const APLICAR = process.argv.includes("--aplicar");

/** Frete gratis a partir daqui. A mediana do catalogo e A$180. */
const GRATIS_ACIMA = 150;
const TAXA_PADRAO = "9.95";

(async () => {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: loja } = await admin
    .from("stores").select("shop_domain, client_id, client_secret, access_token")
    .eq("shop_domain", VITRINE).single();
  const creds = {
    shopDomain: loja!.shop_domain, clientId: loja!.client_id,
    clientSecret: loja!.client_secret, accessToken: loja!.access_token,
  };

  const d = await shopifyGraphQL(creds, `{
    deliveryProfiles(first:5){ nodes { id name default
      profileLocationGroups { locationGroup { id }
        locationGroupZones(first:20){ nodes {
          zone { id name countries { id code { countryCode } } }
          methodDefinitions(first:10){ nodes { id name active rateProvider { ... on DeliveryRateDefinition { price { amount currencyCode } } } } }
        } } } } }
  }`);

  const perfil = d.deliveryProfiles.nodes.find((p: { default: boolean }) => p.default);
  if (!perfil) throw new Error("sem perfil padrao");
  const grupo = perfil.profileLocationGroups[0];
  const zonas = grupo.locationGroupZones.nodes;

  const intl = zonas.find((z: { zone: { name: string } }) => z.zone.name === "International");
  const jaTemAU = zonas.find((z: { zone: { countries: { code: { countryCode: string } }[] } }) =>
    z.zone.countries.some((c) => c.code.countryCode === "AU")
  );

  console.log("perfil:", perfil.name);
  zonas.forEach((z: { zone: { name: string; countries: { code: { countryCode: string } }[] }; methodDefinitions: { nodes: { name: string; rateProvider?: { price?: { amount: string; currencyCode: string } } }[] } }) => {
    const taxas = z.methodDefinitions.nodes
      .map((m) => `${m.name} ${m.rateProvider?.price?.amount ?? "?"} ${m.rateProvider?.price?.currencyCode ?? ""}`)
      .join(" / ");
    console.log(`   ${z.zone.name} [${z.zone.countries.length} paises] -> ${taxas || "sem taxa"}`);
  });

  if (!jaTemAU) {
    console.log("\nAU nao esta em zona nenhuma.");
  } else {
    console.log(`\nAU esta hoje na zona "${jaTemAU.zone.name}".`);
  }

  if (!APLICAR) {
    console.log("\nvai criar: zona Australia com");
    console.log(`   Free Shipping — pedidos a partir de A$${GRATIS_ACIMA}`);
    console.log(`   Standard Shipping — A$${TAXA_PADRAO}`);
    console.log("e tirar AU da International.");
    console.log("\n--- ensaio. Rode com --aplicar. ---");
    return;
  }

  // A AU sai da International na MESMA chamada em que entra na zona nova:
  // a Shopify recusa o mesmo pais em duas zonas do mesmo perfil.
  const paisesIntlSemAU = intl
    ? intl.zone.countries
        .filter((c: { code: { countryCode: string } }) => c.code.countryCode !== "AU")
        // includeAllProvinces e obrigatorio: sem ele a Shopify recusa paises
        // com estado/emirado ("United Arab Emirates must have at least one
        // province associated").
        .map((c: { code: { countryCode: string } }) => ({
          code: c.code.countryCode,
          includeAllProvinces: true,
        }))
    : [];

  const variaveis = {
    id: perfil.id,
    profile: {
      locationGroupsToUpdate: [
        {
          id: grupo.locationGroup.id,
          ...(intl
            ? {
                zonesToUpdate: [
                  {
                    id: intl.zone.id,
                    name: "Rest of world",
                    countries: paisesIntlSemAU,
                  },
                ],
              }
            : {}),
          zonesToCreate: [
            {
              name: "Australia",
              countries: [{ code: "AU", includeAllProvinces: true }],
              methodDefinitionsToCreate: [
                {
                  name: "Free Shipping",
                  description: `Free on orders over $${GRATIS_ACIMA}`,
                  active: true,
                  rateDefinition: { price: { amount: 0, currencyCode: "AUD" } },
                  priceConditionsToCreate: [
                    { operator: "GREATER_THAN_OR_EQUAL_TO", criteria: { amount: GRATIS_ACIMA, currencyCode: "AUD" } },
                  ],
                },
                {
                  name: "Standard Shipping",
                  description: "3–7 business days to metro areas",
                  active: true,
                  rateDefinition: { price: { amount: Number(TAXA_PADRAO), currencyCode: "AUD" } },
                  priceConditionsToCreate: [
                    { operator: "LESS_THAN_OR_EQUAL_TO", criteria: { amount: GRATIS_ACIMA, currencyCode: "AUD" } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };

  const r = await shopifyGraphQL(
    creds,
    `mutation($id:ID!,$profile:DeliveryProfileInput!){
      deliveryProfileUpdate(id:$id, profile:$profile){
        profile { id }
        userErrors { field message }
      }
    }`,
    variaveis
  );
  const erros = r.deliveryProfileUpdate?.userErrors || [];
  if (erros.length) {
    console.log("\nERROS:");
    erros.forEach((e: { field: string[]; message: string }) => console.log("   ", e.field?.join("."), e.message));
    return;
  }
  console.log("\nzona Australia criada e AU removida da International.");
})();
