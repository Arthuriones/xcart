import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { nomeDaPlataforma } from "@/lib/checkouts-externos/tipos";
import { RESUMO_CHECKOUT_EXTERNO } from "@/lib/conectar-operacao";
import { FUSO_RELATORIO_PADRAO } from "@/lib/financeiro/tipos";
import { lerCheckoutsDaTela, type CheckoutsDaTela } from "@/lib/leitura/checkouts";
import { estadoDoCheckout, rotuloAfiliados } from "../integracoes/regras";

// ============================================================================
// Os checkouts externos na tela Lojas: tudo o que esta conectado num lugar
// so, como no seletor do topo. So leitura -- cadastrar, pausar, trocar a URL
// e remover continuam em Integracoes > Checkouts ("Gerenciar").
// ============================================================================

const ROTA_CHECKOUTS = "/integracoes/checkouts";
const LINK = "font-medium text-ink underline underline-offset-2 hover:text-t1";

/**
 * O relogio e lido junto com os dados, fora do componente (que fica puro).
 * Sem os eventos: a lista nao usa, e a tabela deles falhar nao deve apagar os
 * checkouts desta tela.
 */
async function ler(): Promise<{ dados: CheckoutsDaTela; agoraMs: number }> {
  const dados = await lerCheckoutsDaTela({ comEventos: false });
  return { dados, agoraMs: Date.now() };
}

export async function CheckoutsDaConta() {
  let lido: Awaited<ReturnType<typeof ler>>;
  try {
    lido = await ler();
  } catch (erro) {
    // Erro nao vira "nenhum checkout": diz que a leitura falhou.
    console.error("[stores] falha ao ler os checkouts", erro);
    return (
      <p className="mt-6 text-dense text-t2">
        Não deu para ler os checkouts externos agora.{" "}
        <Link href={ROTA_CHECKOUTS} className={LINK}>
          Abrir Checkouts
        </Link>
      </p>
    );
  }
  const { dados, agoraMs } = lido;
  if (dados.semMigration) return null;

  const { checkouts, contas } = dados;
  if (checkouts.length === 0) {
    return (
      <p className="mt-6 text-dense text-t2">
        Tem checkout fora da Shopify?{" "}
        <Link href={`${ROTA_CHECKOUTS}?novo=1`} className={LINK}>
          Conectar checkout
        </Link>
      </p>
    );
  }

  return (
    <section
      aria-labelledby="lojas-checkouts"
      className="mt-6 flex min-w-0 flex-col overflow-hidden rounded-card border border-border bg-surface"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id="lojas-checkouts" className="text-section text-ink">
            Checkouts externos ({checkouts.length})
          </h2>
          <p className="text-label text-t2">{RESUMO_CHECKOUT_EXTERNO}</p>
        </div>
        <Link href={ROTA_CHECKOUTS} className={buttonVariants({ variant: "secondary", size: "sm" })}>
          Gerenciar
        </Link>
      </div>
      <ul>
        {checkouts.map((c) => {
          const e = estadoDoCheckout(c, agoraMs, FUSO_RELATORIO_PADRAO);
          return (
            <li
              key={c.id}
              className="flex flex-col gap-2 border-t border-border-subtle px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-dense font-semibold text-ink">{c.nome}</span>
                <span className="text-label text-t2">
                  {nomeDaPlataforma(c.plataforma)}
                  {rotuloAfiliados(contas[c.id])} · comissão em {c.moeda_receita}
                </span>
              </span>
              <span className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
                <StatusBadge tom={e.tom}>{e.texto}</StatusBadge>
                {e.detalhe ? <span className="line-clamp-1 text-label text-t1">{e.detalhe}</span> : null}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
