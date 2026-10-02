import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { listarContasDoUsuario } from "@/lib/ads/contas";
import { listarLojasDoUsuario } from "@/lib/filtro-global";
import { createClient } from "@/lib/supabase/server";
import { Aviso } from "../../tracking/selo";
import { AnunciosScreen } from "./anuncios-screen";

export const dynamic = "force-dynamic";

// ============================================================================
// Contas de anuncio: de onde vem o gasto que entra no Lucro.
//
// So leitura de banco aqui -- nada de Meta ou Google na renderizacao. O gasto
// chega pelo cron (Meta) e pelo script colado na conta (Google).
// ============================================================================

/**
 * Fuso de cada loja, para avisar quando o dia da conta e o dia da loja nao
 * batem. Vem do sync de pedidos (fin_sync_state): loja que ainda nao
 * sincronizou nao tem fuso, e o aviso simplesmente nao aparece para ela.
 */
async function fusosDasLojas(
  ids: string[]
): Promise<{ fusos: Record<string, string>; erro: string | null }> {
  if (ids.length === 0) return { fusos: {}, erro: null };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fin_sync_state")
    .select("store_id, fuso")
    .in("store_id", ids);
  // O fuso so alimenta um aviso: falhar aqui nao derruba a tela, mas aparece.
  if (error) return { fusos: {}, erro: error.message };
  const fusos: Record<string, string> = {};
  for (const r of (data || []) as { store_id: string; fuso: string | null }[]) {
    if (r.fuso) fusos[String(r.store_id)] = r.fuso;
  }
  return { fusos, erro: null };
}

/**
 * Fora do componente: o relogio (agoraMs) e lido junto com os dados, uma vez,
 * e vai como prop -- o "sem envio ha 3 h" sai igual no HTML e na hidratacao.
 */
async function carregar() {
  const [contas, lojas] = await Promise.all([listarContasDoUsuario(), listarLojasDoUsuario()]);
  const { fusos, erro } = await fusosDasLojas(lojas.map((l) => l.id));
  return { contas, lojas, fusos, erroFuso: erro, agoraMs: Date.now() };
}

async function Conteudo() {
  let dados;
  try {
    dados = await carregar();
  } catch (e) {
    return (
      <Aviso
        tom="err"
        titulo="Não deu para carregar as contas de anúncio."
        detalhe={e instanceof Error ? e.message : String(e)}
      />
    );
  }
  return <AnunciosScreen {...dados} />;
}

function Esqueleto() {
  return (
    <div className="flex flex-col gap-[18px]" aria-busy="true">
      <p className="flex items-center gap-2 text-[12px] text-t3">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        Carregando as contas…
      </p>
      {[0, 1].map((i) => (
        <div
          key={i}
          aria-hidden
          className="h-[180px] rounded-xl border border-border bg-surface"
        />
      ))}
    </div>
  );
}

export default function AnunciosPage() {
  return (
    <div className="flex flex-col gap-[18px]">
      <div>
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink">
          Contas de anúncio
        </h1>
        <p className="mt-1 max-w-[62ch] text-[13px] leading-relaxed text-t2">
          O gasto do Meta e do Google entra no Lucro por loja e por dia. Cada conta
          precisa estar ligada a uma loja.
        </p>
      </div>
      <Suspense fallback={<Esqueleto />}>
        <Conteudo />
      </Suspense>
    </div>
  );
}
