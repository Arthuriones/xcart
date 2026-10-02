import { Suspense } from "react";
import Link from "next/link";
import { CircleAlert } from "lucide-react";
import { filtroResolvido } from "@/lib/filtro-global";
import { carregarCustos } from "@/lib/financeiro/custos-queries";
import { TODAS } from "@/lib/financeiro/tipos";
import { CustosScreen, EscolherLoja } from "./custos-screen";

export const dynamic = "force-dynamic";

// ============================================================================
// Custos e taxas: o que sai de cada venda alem do anuncio.
//
// Custo e POR LOJA (o mesmo SKU pode ter fornecedor diferente em cada loja),
// entao com "todas as lojas" no seletor a tela pede para escolher uma em vez
// de misturar custos de lojas diferentes numa tabela so.
// ============================================================================

const VAZIO_CAIXA =
  "rounded-xl border border-dashed border-[var(--border-strong)] bg-surface px-8 py-11 text-center";
const VAZIO_CTA =
  "mt-4 inline-flex h-[30px] items-center rounded-md bg-[var(--solid)] px-[13px] text-[12.5px] font-semibold text-[var(--on-solid)] hover:bg-[var(--solid-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/40";

function CaixaErro({ mensagem }: { mensagem: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-xl border px-4 py-3"
      style={{ borderColor: "var(--err-border)", background: "var(--err-bg)" }}
    >
      <CircleAlert aria-hidden className="mt-px h-4 w-4 shrink-0" style={{ color: "var(--err)" }} />
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-ink">Não deu para carregar os custos</p>
        <p className="mt-0.5 break-words text-[12px] text-t2">{mensagem}</p>
      </div>
    </div>
  );
}

async function Conteudo() {
  // Erro de banco aparece na tela; nunca vira "nenhuma loja" ou "sem custos".
  let resolvido: Awaited<ReturnType<typeof filtroResolvido>> | null = null;
  let erro: string | null = null;
  try {
    resolvido = await filtroResolvido();
  } catch (e) {
    erro = e instanceof Error ? e.message : String(e);
  }
  if (!resolvido) return <CaixaErro mensagem={erro ?? "Erro desconhecido."} />;
  const { filtro, lojas } = resolvido;

  if (lojas.length === 0) {
    return (
      <div className={VAZIO_CAIXA}>
        <p className="text-[15px] font-semibold text-ink">Nenhuma loja conectada</p>
        <p className="mx-auto mt-1.5 max-w-[400px] text-[12.5px] text-t2">
          Conecte uma loja Shopify para lançar o custo dos produtos e a taxa de pagamento.
          É com isso que o xcart calcula o lucro de cada venda.
        </p>
        <Link href="/stores" className={VAZIO_CTA}>
          Conectar loja
        </Link>
      </div>
    );
  }

  const loja = filtro.lojaId === TODAS ? null : lojas.find((l) => l.id === filtro.lojaId) ?? null;
  if (!loja) return <EscolherLoja lojas={lojas} />;

  let dados: Awaited<ReturnType<typeof carregarCustos>> | null = null;
  try {
    dados = await carregarCustos(loja.id);
  } catch (e) {
    erro = e instanceof Error ? e.message : String(e);
  }
  if (!dados) return <CaixaErro mensagem={erro ?? "Erro desconhecido."} />;
  return <CustosScreen key={loja.id} dados={dados} loja={loja} />;
}

function Esqueleto() {
  // Blocos parados: e leitura de banco, coisa de um segundo.
  return (
    <div className="flex flex-col gap-[18px]" aria-busy="true">
      <div aria-hidden className="h-[150px] rounded-xl border border-border bg-surface" />
      <div aria-hidden className="h-[260px] rounded-xl border border-border bg-surface" />
      <div aria-hidden className="h-[120px] rounded-xl border border-border bg-surface" />
    </div>
  );
}

export default function CustosPage() {
  return (
    <div className="flex flex-col gap-[18px]">
      <div>
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink">
          Custos e taxas
        </h1>
        <p className="mt-1 max-w-[62ch] text-[13px] leading-relaxed text-t2">
          O que sai de cada venda além do anúncio: produto, frete do fornecedor e taxa de
          pagamento. É daqui que sai o lucro.
        </p>
      </div>
      <Suspense fallback={<Esqueleto />}>
        <Conteudo />
      </Suspense>
    </div>
  );
}
