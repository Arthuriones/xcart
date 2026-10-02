import { Suspense } from "react";
import Link from "next/link";
import { CircleAlert } from "lucide-react";
import { lerFiltroGlobal } from "@/lib/filtro-global";
import { getFinanceiro } from "@/lib/financeiro/queries";
import { TOM } from "@/app/(dashboard)/tracking/selo";
import { FinanceiroScreen } from "./financeiro-screen";

export const dynamic = "force-dynamic";

/**
 * A tela le so o banco (pedidos e gasto ja copiados pelos crons), mas sao seis
 * leituras paginadas: fica dentro do Suspense, com o titulo FORA para aparecer
 * na hora. A key do Suspense e o filtro -- trocar loja/periodo/moeda no seletor
 * mostra o esqueleto de novo em vez de deixar o numero velho na tela.
 */
async function Conteudo() {
  let dados: Awaited<ReturnType<typeof getFinanceiro>>;
  try {
    dados = await getFinanceiro();
  } catch (e) {
    // Erro de banco aparece; nunca vira zero. Zero diria "nao vendeu".
    const mensagem = e instanceof Error ? e.message : String(e);
    return <Erro mensagem={mensagem} />;
  }

  if (dados.vazio) return <SemLojas />;
  return <FinanceiroScreen dados={dados} />;
}

function Erro({ mensagem }: { mensagem: string }) {
  const t = TOM.err;
  return (
    <div
      className="flex flex-wrap items-start gap-x-3 gap-y-1.5 rounded-lg border px-3.5 py-2.5"
      style={{ borderColor: t.borda, background: t.fundo }}
    >
      <CircleAlert aria-hidden className="mt-px h-4 w-4 shrink-0" style={{ color: t.cor }} />
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-medium text-ink">Não deu para calcular o lucro agora</div>
        <p className="mt-0.5 break-words text-[12px] text-t2">{mensagem}</p>
      </div>
      {/* <a> e nao <Link>: recarrega a pagina inteira, inclusive o layout. */}
      <a
        href="/financeiro"
        className="w-full shrink-0 rounded-md border bg-surface px-2.5 py-1 text-center text-[12px] font-medium text-ink hover:border-[var(--border-strong)] sm:ml-auto sm:w-auto"
        style={{ borderColor: t.borda }}
      >
        Tentar de novo
      </a>
    </div>
  );
}

function SemLojas() {
  return (
    <div className="rounded-lg border border-dashed border-[var(--border-strong)] bg-surface px-6 py-11 text-center">
      <div className="text-[15px] font-semibold text-ink">Conecte uma loja para ver o lucro</div>
      <p className="mx-auto mb-4 mt-1.5 max-w-[420px] text-[12.5px] text-t2">
        O xcart lê os pedidos da Shopify e cruza com o gasto do Meta e do Google. Assim que
        a primeira loja estiver conectada, o faturamento, o custo e o lucro de cada dia
        aparecem aqui.
      </p>
      <Link
        href="/stores"
        className="inline-flex h-[30px] items-center rounded-md bg-[var(--solid)] px-[13px] text-[12.5px] font-semibold text-[var(--on-solid)] transition-colors hover:bg-[var(--solid-hover)]"
      >
        Conectar loja
      </Link>
    </div>
  );
}

function Esqueleto() {
  // Blocos parados, sem pulsar: e leitura de banco, coisa de um segundo.
  return (
    <div className="flex flex-col gap-[18px]" aria-busy="true" aria-label="Carregando">
      <div aria-hidden className="h-[30px] w-full max-w-[520px] rounded-md bg-surface-2" />
      <div aria-hidden className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[96px] bg-surface" />
        ))}
      </div>
      <div aria-hidden className="h-[46px] rounded-lg border border-border bg-surface" />
      <div aria-hidden className="h-[260px] rounded-lg border border-border bg-surface" />
    </div>
  );
}

export default async function FinanceiroPage() {
  // So o cookie (sem banco): serve de key para o Suspense.
  const filtro = await lerFiltroGlobal();
  return (
    <div className="flex flex-col gap-[18px]">
      <div>
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink">
          Lucro
        </h1>
        <p className="mt-1 max-w-[62ch] text-[13px] leading-relaxed text-t2">
          Quanto cada loja deixou depois de produto, frete do fornecedor, taxa e anúncio.
        </p>
      </div>
      <Suspense key={JSON.stringify(filtro)} fallback={<Esqueleto />}>
        <Conteudo />
      </Suspense>
    </div>
  );
}
