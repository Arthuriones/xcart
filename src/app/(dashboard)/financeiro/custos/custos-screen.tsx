"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { cn } from "@/components/ui/cn";
import { gravarCookie } from "@/components/layout/contexto";
import { COOKIE_LOJA, TODAS, type LojaDoSeletor } from "@/lib/financeiro/tipos";
import type { DadosCustos } from "@/lib/financeiro/custos-queries";
import type { EstadoConexao } from "@/lib/leitura/lojas-estado";
import {
  edicaoInicial,
  formTaxasDe,
  mudou,
  plural,
  semMyshopify,
  taxasMudaram,
  type Edicao,
  type FormTaxas,
  type Situacao,
} from "./apresentar";
import { useAvisoAoSair } from "./aviso-ao-sair";
import { SecaoEmBreve } from "./secao-em-breve";
import { SecaoPlanilha } from "./secao-planilha";
import { SecaoSkus } from "./secao-skus";
import { SecaoTaxas } from "./secao-taxas";

// ============================================================================
// Tela Custos e taxas de UMA loja (cliente).
//
// Quatro blocos, na ordem em que o lucro depende deles: a taxa de pagamento
// vale para TODO pedido, o custo por produto para cada linha, a planilha e
// so um atalho para lancar muitos de uma vez, e o "Em breve".
//
// O que esta sendo digitado mora aqui (taxa, linhas da tabela, planilha
// colada) para a tela saber se ha algo por salvar antes de sair ou trocar de
// loja. Depois de gravar, a pagina e relida do servidor (router.refresh): o
// banco continua sendo a fonte da verdade.
// ============================================================================

export function CustosScreen({
  dados,
  loja,
  conexao,
  variasLojas,
  situacaoInicial,
}: {
  dados: DadosCustos;
  loja: LojaDoSeletor;
  conexao: EstadoConexao | null;
  variasLojas: boolean;
  situacaoInicial: Situacao;
}) {
  const router = useRouter();
  const [trocando, iniciarTroca] = useTransition();

  // Taxa: o formulario e a base (o que esta gravado). A base muda ao salvar.
  const [taxasBase, setTaxasBase] = useState<FormTaxas>(() => formTaxasDe(dados.config));
  const [taxas, setTaxas] = useState<FormTaxas>(taxasBase);
  const [configurada, setConfigurada] = useState(Boolean(dados.config));

  // Tabela: so as linhas tocadas; a que nao foi tocada usa o valor inicial.
  const [edicoes, setEdicoes] = useState<Record<string, Edicao>>({});
  const iniciais = useMemo(
    () => new Map(dados.skus.map((s) => [s.sku, edicaoInicial(s, dados.moedaLoja, dados.hoje)])),
    [dados.skus, dados.moedaLoja, dados.hoje]
  );
  const alterados = useMemo(
    () =>
      Object.entries(edicoes)
        .filter(([sku, e]) => {
          const ini = iniciais.get(sku);
          return ini ? mudou(e, ini) : false;
        })
        .map(([sku]) => sku),
    [edicoes, iniciais]
  );

  const [planilha, setPlanilha] = useState("");

  const taxasSujas = taxasMudaram(taxas, taxasBase);
  const partes = [
    alterados.length > 0 ? plural(alterados.length, "custo alterado", "custos alterados") : null,
    taxasSujas ? "a taxa de pagamento" : null,
    planilha.trim() ? "uma planilha não importada" : null,
  ].filter((p): p is string => Boolean(p));
  const sujo = partes.length > 0;
  const { pedir, dialogo } = useAvisoAoSair(
    sujo,
    `Você tem ${partes.join(", ").replace(/, ([^,]*)$/, " e $1")} sem salvar.`
  );

  function editar(sku: string, campo: keyof Edicao, valor: string) {
    setEdicoes((atual) => {
      const base = atual[sku] ?? iniciais.get(sku);
      if (!base) return atual;
      return { ...atual, [sku]: { ...base, [campo]: valor } };
    });
  }

  function trocarLoja() {
    gravarCookie(COOKIE_LOJA, TODAS);
    iniciarTroca(() => router.refresh());
  }

  const moeda = dados.moedaLoja;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-body font-semibold text-ink">{loja.nome}</span>
          <span className="truncate text-label text-t2">
            <span className="font-mono">{semMyshopify(loja.dominio)}</span>
            {moeda ? ` · moeda da loja ${moeda}` : ""}
          </span>
        </div>
        {variasLojas ? (
          <Button
            variant="secondary"
            size="sm"
            className="ml-auto h-ctl-lg sm:h-ctl-sm"
            pending={trocando}
            onClick={() => pedir(trocarLoja)}
          >
            Trocar loja
          </Button>
        ) : null}
      </div>

      {conexao?.semAcesso ? (
        <Callout
          tom="warn"
          titulo="A Shopify não deixa o xcart ler os pedidos desta loja"
          acao={
            <Link
              href={`/stores/${loja.id}`}
              className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "h-ctl-lg sm:h-ctl-sm")}
            >
              Ver a conexão
            </Link>
          }
        >
          A lista de produtos vendidos parou na última leitura de pedidos ({conexao.detalhe.toLowerCase()}). Os
          custos que você lançar continuam valendo para os pedidos já lidos.
        </Callout>
      ) : null}

      <SecaoTaxas
        storeId={dados.storeId}
        moedaLoja={moeda}
        configurada={configurada}
        form={taxas}
        sujo={taxasSujas}
        onMudar={(campo, valor) => setTaxas((f) => ({ ...f, [campo]: valor }))}
        onSalvo={(gravado) => {
          setTaxasBase(gravado);
          setTaxas(gravado);
          setConfigurada(true);
        }}
      />

      <SecaoSkus
        dados={dados}
        loja={loja}
        edicoes={edicoes}
        iniciais={iniciais}
        alterados={alterados}
        situacaoInicial={situacaoInicial}
        buscarNomes={!conexao?.semAcesso}
        onEditar={editar}
        onDescartar={() => setEdicoes({})}
        onSalvo={() => setEdicoes({})}
      />

      <SecaoPlanilha dados={dados} dominio={loja.dominio} texto={planilha} onTexto={setPlanilha} />

      <SecaoEmBreve />

      {dialogo}
    </div>
  );
}
