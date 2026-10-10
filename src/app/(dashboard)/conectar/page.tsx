import { Suspense } from "react";
import Link from "next/link";
import { CheckIcon, ShoppingCart } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import {
  OPCOES_CONECTAR,
  ROTULO_CONECTAR_OPERACAO,
  rotuloContagem,
  type OpcaoConectar,
} from "@/lib/conectar-operacao";
import { lerCheckoutsDoUsuario, listarLojasDoUsuario } from "@/lib/filtro-global";
import { CaixaLogo } from "../tracking/logos";

export const dynamic = "force-dynamic";

// ============================================================================
// Conectar operação: primeiro O QUE conectar, depois o fluxo que ja existe
// (ver src/lib/conectar-operacao.ts). A tela abre na hora: so o selo "N
// conectadas" le o banco, por Suspense, e some se a leitura falhar.
// ============================================================================

export default function ConectarPage() {
  return (
    <>
      <PageHeader
        title={ROTULO_CONECTAR_OPERACAO}
        description="Escolha o que conectar. Uma conta pode ter várias lojas e checkouts."
      />
      <ul className="grid gap-4 md:grid-cols-2">
        {OPCOES_CONECTAR.map((op) => (
          <Cartao key={op.id} opcao={op} />
        ))}
      </ul>
      <p className="mt-6 text-dense text-t2">
        Contas de anúncio vêm depois: o gasto entra no lucro de uma loja ou de um checkout.{" "}
        <Link href="/integracoes/meta" className="font-medium text-ink underline underline-offset-2">
          Meta
        </Link>{" "}
        ·{" "}
        <Link href="/integracoes/google" className="font-medium text-ink underline underline-offset-2">
          Google
        </Link>
      </p>
    </>
  );
}

function Icone({ id }: { id: OpcaoConectar["id"] }) {
  if (id === "loja") return <CaixaLogo marca="shopify" />;
  return (
    <span
      aria-hidden
      className="grid size-8.5 shrink-0 place-items-center rounded-card border border-border bg-surface text-t1"
    >
      <ShoppingCart className="size-4.5" strokeWidth={1.75} />
    </span>
  );
}

function Cartao({ opcao }: { opcao: OpcaoConectar }) {
  const idTitulo = `conectar-${opcao.id}`;
  return (
    <li className="flex min-w-0 flex-col rounded-card border border-border bg-surface">
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <span className="flex min-w-0 items-center gap-2.5">
            <Icone id={opcao.id} />
            <h2 id={idTitulo} className="text-section text-ink">
              {opcao.titulo}
            </h2>
          </span>
          <Suspense fallback={null}>
            <Selo opcao={opcao} />
          </Suspense>
        </div>
        <p className="text-dense text-t1">{opcao.texto}</p>
        <ul className="flex flex-col gap-1.5">
          {opcao.traz.map((item) => (
            <li key={item} className="flex items-start gap-2 text-dense text-t1">
              <CheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-ok" strokeWidth={2} />
              {item}
            </li>
          ))}
        </ul>
        {opcao.nota ? <p className="text-label text-t2">{opcao.nota}</p> : null}
      </div>

      <ul aria-labelledby={idTitulo} className="mt-auto border-t border-border-subtle">
        {opcao.destinos.map((d) => (
          <li
            key={d.id}
            className="flex min-h-14 items-center justify-between gap-3 border-b border-border-subtle px-4 py-2.5 last:border-b-0"
          >
            <span className="flex min-w-0 flex-col">
              <span className={cn("text-dense font-medium", d.href ? "text-ink" : "text-t2")}>{d.nome}</span>
              {d.href && d.descricao ? <span className="text-label text-t2">{d.descricao}</span> : null}
            </span>
            {d.href ? (
              <Link
                href={d.href}
                aria-label={`${d.cta} ${d.nome}`}
                className={buttonVariants({ className: "shrink-0" })}
              >
                {d.cta}
              </Link>
            ) : (
              <span className="shrink-0 text-label text-t2">Em breve</span>
            )}
          </li>
        ))}
      </ul>
    </li>
  );
}

/** "2 conectadas": le o que o topo ja leu (cache por requisicao). Falhou, sem selo. */
async function Selo({ opcao }: { opcao: OpcaoConectar }) {
  let n: number | null = null;
  try {
    n = opcao.id === "loja" ? (await listarLojasDoUsuario()).length : (await lerCheckoutsDoUsuario()).length;
  } catch (e) {
    console.error("[conectar] contagem", opcao.id, e);
  }
  const rotulo = rotuloContagem(n, opcao.contagem);
  return rotulo ? <Badge variant="neutral">{rotulo}</Badge> : null;
}
