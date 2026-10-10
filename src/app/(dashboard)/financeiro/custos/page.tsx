import { Suspense } from "react";
import Link from "next/link";
import { Store } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { filtroResolvido, lerFiltroGlobal } from "@/lib/filtro-global";
import { SoLojasShopify } from "@/components/layout/so-lojas-shopify";
import { carregarCustos } from "@/lib/financeiro/custos-queries";
import { lerConexoes, lerCustosDasLojas } from "@/lib/leitura/custos-lojas";
import { resumirCustos, type Situacao } from "./apresentar";
import { CabecalhoCustos } from "./cabecalho";
import { CustosScreen } from "./custos-screen";
import { ErroCustos } from "./erro-custos";
import { EscolherLoja, type LojaParaEscolher } from "./escolher-loja";
import { EsqueletoCustos } from "./esqueleto";

export const dynamic = "force-dynamic";

// ============================================================================
// Custos e taxas: o que sai de cada venda alem do anuncio.
//
// Custo e POR LOJA (o mesmo SKU pode ter fornecedor diferente em cada loja),
// entao com "Todas as lojas" na barra a tela mostra o progresso de cada loja
// e pede para escolher uma, em vez de misturar custos numa tabela so. Com uma
// loja so na conta, ela ja vem escolhida.
//
// Le so o banco (carregarCustos, sem mudar nada). As rotas que gravam sao as
// de sempre: POST/DELETE /api/financeiro/custos e POST /api/financeiro/config.
//
// ?situacao=semCusto abre a tabela ja filtrada (e o link "Cadastrar custos"
// dos avisos do Lucro). O resto do filtro e do cliente.
// ============================================================================

function mensagem(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function Conteudo({ situacaoInicial }: { situacaoInicial: Situacao }) {
  let resolvido: Awaited<ReturnType<typeof filtroResolvido>>;
  try {
    resolvido = await filtroResolvido();
  } catch (e) {
    console.error("[custos] lojas", e);
    // Erro de banco aparece; nunca vira "nenhuma loja" ou "sem custos".
    return <ErroCustos detalhe={mensagem(e)} />;
  }
  const { filtro, lojas } = resolvido;
  // Checkout externo nao tem custo por SKU: a comissao ja e liquida.
  if (resolvido.checkout) return <SoLojasShopify checkout={resolvido.checkout.nome} />;
  if (lojas.length === 0) return <SemLojas />;

  const escolhida = lojas.find((l) => l.id === filtro.lojaId) ?? (lojas.length === 1 ? lojas[0] : null);

  if (!escolhida) {
    const custos = await lerCustosDasLojas(lojas);
    const paraEscolher: LojaParaEscolher[] = custos.map((c) => ({
      id: c.loja.id,
      nome: c.loja.nome,
      dominio: c.loja.dominio,
      semAcesso: c.conexao?.semAcesso ?? false,
      conexao: c.conexao?.detalhe ?? null,
      resumo: c.dados ? resumirCustos(c.dados) : null,
    }));
    return <EscolherLoja lojas={paraEscolher} />;
  }

  const [dados, conexoes] = await Promise.allSettled([
    carregarCustos(escolhida.id),
    lerConexoes([escolhida.id]),
  ]);
  if (dados.status === "rejected") {
    console.error("[custos] loja", dados.reason);
    return <ErroCustos detalhe={mensagem(dados.reason)} />;
  }
  const conexao = conexoes.status === "fulfilled" ? (conexoes.value?.get(escolhida.id) ?? null) : null;

  return (
    <CustosScreen
      key={escolhida.id}
      dados={dados.value}
      loja={escolhida}
      conexao={conexao}
      variasLojas={lojas.length > 1}
      situacaoInicial={situacaoInicial}
    />
  );
}

function SemLojas() {
  return (
    <EmptyState
      icone={<Store />}
      titulo="Conecte uma loja para lançar custos"
      descricao="O custo de cada produto e a taxa de pagamento entram no lucro de cada venda."
      acao={
        <Link href="/stores?conectar=1" className={buttonVariants({})}>
          Conectar loja
        </Link>
      }
      className="min-h-80"
    />
  );
}

export default async function CustosPage({
  searchParams,
}: {
  searchParams: Promise<{ [chave: string]: string | string[] | undefined }>;
}) {
  // So cookie (sem banco): serve de key para o Suspense. Trocar de loja na
  // barra mostra o esqueleto de novo em vez de deixar a tabela velha na tela.
  const [filtro, sp] = await Promise.all([lerFiltroGlobal(), searchParams]);
  const situacao: Situacao = sp.situacao === "semCusto" ? "semCusto" : "todos";
  return (
    <>
      <CabecalhoCustos />
      <Suspense key={filtro.lojaId} fallback={<EsqueletoCustos />}>
        <Conteudo situacaoInicial={situacao} />
      </Suspense>
    </>
  );
}
