import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { ROTULO_PERIODO, rotuloIntervalo, type Comparacao } from "@/components/layout/contexto";
import { TODAS } from "@/lib/financeiro/tipos";
import type { DadosFinanceiro } from "@/lib/financeiro/queries";
import { pontoDeLinha, type SerieDiaria } from "@/lib/leitura/serie-diaria";
import type { PorProduto } from "@/lib/leitura/por-produto";
import type { LinhaCampanha } from "@/lib/leitura/por-campanha";
import { Cascata } from "./cascata";
import { ComoCalculamos } from "./como-calculamos";
import { DetalharPor } from "./detalhar-por";
import { Indicadores } from "./indicadores";
import { montarPendencias, nomeDaLoja } from "./lucro-dados";
import { Pendencias } from "./pendencias";

// ============================================================================
// A tela Lucro, montada no servidor: pendencias, KPIs + grafico (com a
// cascata ao lado), "Detalhar por" e "Como calculamos". So as partes que
// reagem a clique sao client components.
//
// `dados` vem de getFinanceiro (o calculo de sempre). `extras` sao as leituras
// novas (serie do periodo anterior, produto, campanha): se falharem, a tela
// abre igual e so as partes que dependem delas mostram o erro.
// ============================================================================

export type DadosLucro = Extract<DadosFinanceiro, { vazio: false }>;

export interface ExtrasLucro {
  serie: SerieDiaria;
  produtos: PorProduto;
  campanhas: LinhaCampanha[];
}

export function FinanceiroScreen({
  dados,
  comparacao,
  extras,
  erroExtras,
}: {
  dados: DadosLucro;
  comparacao: Comparacao;
  extras: ExtrasLucro | null;
  erroExtras: string | null;
}) {
  const { resultado: r, filtro } = dados;
  const moeda = r.moeda;
  const lojaEscolhida = filtro.lojaId !== TODAS ? dados.lojas.find((l) => l.id === filtro.lojaId) : undefined;
  const rotuloLoja = lojaEscolhida ? nomeDaLoja(lojaEscolhida) : "Todas as lojas";
  const contexto = `${rotuloLoja} · ${ROTULO_PERIODO[filtro.periodo]} (${rotuloIntervalo(r.intervalos.atual)}) · ${moeda}`;

  const negadas = new Set(dados.estados.filter((e) => e.ultimo_erro_tipo === "negado").map((e) => e.store_id));
  const pendencias = montarPendencias({
    lojas: dados.lojas,
    lojaIds: dados.lojaIds,
    estados: dados.estados,
    contas: dados.contas,
    avisos: r.avisos,
    coberturaCusto: r.atual.coberturaCusto,
    porLoja: r.porLoja.map((l) => ({ storeId: l.storeId, receita: l.receita, pedidos: l.pedidos })),
  });

  // porDia vem do mais novo para o mais antigo; o grafico quer o contrario.
  const pontos = [...r.porDia].reverse().map(pontoDeLinha);
  const lucroPorLoja = new Map((extras?.serie.porLoja ?? []).map((l) => [l.storeId, l.lucro]));

  return (
    <div className="flex flex-col gap-6">
      {lojaEscolhida && negadas.has(lojaEscolhida.id) && (
        <Callout
          tom="err"
          role="alert"
          titulo={`Sem acesso aos pedidos de ${rotuloLoja}`}
          acao={
            <Link href="/stores" className={buttonVariants({ size: "sm" })}>
              Reconectar loja
            </Link>
          }
        >
          A Shopify não deixa ler os pedidos desta loja. Os números abaixo só têm o que foi lido antes de
          perder o acesso.
        </Callout>
      )}

      <Pendencias itens={pendencias} />

      <Indicadores
        moeda={moeda}
        atual={r.atual}
        anterior={r.anterior}
        comparar={comparacao}
        rotuloAnterior={rotuloIntervalo(r.intervalos.anterior)}
        pontos={pontos}
        pontosAnteriores={extras ? extras.serie.anterior : null}
        contexto={contexto}
        cascata={<Cascata atual={r.atual} moeda={moeda} contexto={contexto} />}
      />

      <DetalharPor
        moeda={moeda}
        intervalo={r.intervalos.atual}
        rotuloLoja={rotuloLoja}
        mostrarLoja={filtro.lojaId === TODAS && dados.lojaIds.length >= 2}
        lojas={r.porLoja.map((l) => ({
          linha: l,
          semAcesso: negadas.has(l.storeId),
          lucroPorDia: lucroPorLoja.get(l.storeId) ?? null,
        }))}
        total={r.atual}
        dias={r.porDia}
        produtos={extras ? extras.produtos : null}
        campanhas={extras ? extras.campanhas : null}
        erroExtras={erroExtras}
      />

      <ComoCalculamos />
    </div>
  );
}
