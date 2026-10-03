import Link from "next/link";
import { ArrowRightIcon, GlobeIcon, LinkIcon, StoreIcon, type LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Section } from "@/components/ui/section";
import type { LojaDestino } from "@/lib/leitura/importar";
import { BotaoTentarDeNovo } from "../bulk/estados";
import { FilaTodas } from "./fila-todas";

// ============================================================================
// Importar (/clone): o primeiro passo -- de onde vem o produto -- e a fila do
// que ja foi importado por link. Cada origem leva a uma tela que ja existia:
//   Loja Shopify (e Shoplazza, mesmo motor) -> /clone/shopify
//   AliExpress, lojas Shopify e links soltos -> /bulk
//   Nuvemshop, WooCommerce e outros sites    -> /multi-site
// O roteamento saiu daqui: tem item proprio no menu (Rotas).
// ============================================================================

const ORIGENS: {
  href: string;
  Icone: LucideIcon;
  titulo: string;
  descricao: string;
  pontos: string[];
}[] = [
  {
    href: "/clone/shopify",
    Icone: StoreIcon,
    titulo: "Loja Shopify",
    descricao:
      "Copie um produto, uma coleção ou a loja inteira de uma loja Shopify aberta ao público. Também funciona com lojas Shoplazza.",
    pontos: ["Prévia antes de importar", "Escolha produto a produto", "Com a tela aberta"],
  },
  {
    href: "/bulk",
    Icone: LinkIcon,
    titulo: "AliExpress e links soltos",
    descricao:
      "Cole até 20 links de produto do AliExpress, de lojas Shopify ou o endereço de uma loja inteira.",
    pontos: ["Até 20 links por vez", "Roda numa fila"],
  },
  {
    href: "/multi-site",
    Icone: GlobeIcon,
    titulo: "Nuvemshop, WooCommerce e outros sites",
    descricao: "Lojas próprias e páginas de produto com dados públicos, até 20 links por vez.",
    pontos: ["Até 20 links por vez", "Roda numa fila"],
  },
];

/**
 * `lojas` null = a leitura falhou. As origens aparecem do mesmo jeito (nao
 * dependem das lojas); o aviso diz o que houve.
 */
export function CentralImportacao({ lojas }: { lojas: LojaDestino[] | null }) {
  const comAcesso = lojas?.filter((l) => !l.semAcesso).length ?? 0;
  return (
    <>
      <PageHeader
        title="Importar"
        description="Escolha de onde vêm os produtos. Eles entram numa das suas lojas Shopify conectadas."
      />

      <div className="flex flex-col gap-6">
        {lojas === null ? (
          <Callout tom="err" titulo="Não deu para carregar suas lojas" acao={<BotaoTentarDeNovo variante="secondary" />}>
            Suas lojas continuam conectadas: foi a leitura que falhou.
          </Callout>
        ) : comAcesso === 0 ? (
          <Callout
            tom="warn"
            titulo={lojas.length ? "Nenhuma loja com acesso para receber produtos" : "Nenhuma loja conectada"}
            acao={
              <Link href="/stores?conectar=1" className={buttonVariants({ variant: "secondary", size: "sm" })}>
                Conectar loja
              </Link>
            }
          >
            {lojas.length
              ? "O app foi desinstalado das suas lojas. Reconecte uma para importar."
              : "Conecte a loja Shopify que vai receber os produtos."}
          </Callout>
        ) : null}

        <Section titulo="De onde importar" descricao="Os produtos são criados na loja que você escolher no próximo passo.">
          <ul className="grid gap-3 md:grid-cols-3">
            {ORIGENS.map((o) => (
              <li key={o.href} className="min-w-0">
                <Link
                  href={o.href}
                  className="group flex h-full flex-col gap-3 rounded-card border border-border bg-surface p-4 transition-colors hover:border-border-strong hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="grid size-9 place-items-center rounded-control border border-border-subtle bg-surface-2 text-ink">
                      <o.Icone aria-hidden className="size-5" strokeWidth={1.75} />
                    </span>
                    <ArrowRightIcon
                      aria-hidden
                      className="size-4 text-t2 transition-transform group-hover:translate-x-0.5 group-hover:text-ink motion-reduce:transition-none"
                    />
                  </span>
                  <h3 className="text-section text-ink">{o.titulo}</h3>
                  <p className="text-dense text-t1 text-pretty">{o.descricao}</p>
                  <span className="mt-auto flex flex-wrap gap-1.5 pt-1">
                    {o.pontos.map((p) => (
                      <Badge key={p} variant="outline">
                        {p}
                      </Badge>
                    ))}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>

        <FilaTodas lojas={lojas} />
      </div>
    </>
  );
}
