"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import type { DadosImportar } from "@/lib/leitura/importar-shopify";
import { abortado, lerColecoes, postarClone, postarJson } from "./api";
import { AvisoAoSair } from "./aviso-saida";
import { PainelExecucao, type Execucao, type Falha } from "./execucao";
import { PassoOpcoes } from "./opcoes";
import { PassoDestino, PassoEscopo, PassoOrigem, type EstadoLeitura } from "./passos-iniciais";
import { PassoRevisao, type EstadoPrevia } from "./revisao";
import { PassoSelecao, type Catalogo } from "./selecao";
import { Trilha } from "./trilha";
import {
  LIMITE_PADRAO,
  OPCOES_PADRAO,
  TAMANHO_LOTE,
  contar,
  dominioDoLink,
  emAndamento,
  erroNaTela,
  estimarCreditos,
  inteiro,
  lerLimite,
  montarCorpo,
  passoAnterior,
  proximoPasso,
  resumoOpcoes,
  travaDoPasso,
  travaParaIniciar,
  type ColecaoOrigem,
  type ErroNaTela,
  type Escopo,
  type IdPasso,
  type Opcoes,
  type ProdutoOrigem,
  type ProdutoTransformado,
  type Situacao,
} from "./regras";

// ============================================================================
// O assistente "Importar de uma loja Shopify": seis passos (Destino, Escopo,
// Origem, Seleção, Opções, Revisão), o progresso e o resultado. Todo o estado
// e local desta tela. As chamadas sao as mesmas da tela antiga, com os mesmos
// corpos (montarCorpo, em regras.ts).
//
// A importacao continua sendo um laco NESTE navegador, em lotes de 5: por
// isso o aviso ao sair (AvisoAoSair) enquanto ela roda.
// ============================================================================

type Leitura<T> = { estado: EstadoLeitura; chave: string; dados: T | null; erro: ErroNaTela | null };

const NADA_LIDO = { estado: "nao_lido" as const, chave: "", dados: null, erro: null };

const TITULOS: Record<IdPasso, (escopo: Escopo) => { titulo: string; dica: string }> = {
  destino: () => ({ titulo: "Para qual loja vai importar?", dica: "Os produtos são criados nesta loja." }),
  escopo: () => ({
    titulo: "Quanto do catálogo?",
    dica: "Define o link que vamos pedir no próximo passo. As variações vêm junto com cada produto.",
  }),
  origem: (e) => ({
    titulo:
      e === "produto"
        ? "Cole o link do produto"
        : e === "colecao"
          ? "Cole o link da loja e escolha a coleção"
          : "Cole o link da loja de origem",
    dica: "Funciona com qualquer loja Shopify pública.",
  }),
  selecao: () => ({ titulo: "Escolha os produtos", dica: "" }),
  opcoes: () => ({ titulo: "Como os produtos entram", dica: "Vale para todos os produtos desta importação." }),
  revisao: () => ({ titulo: "Revise e importe", dica: "Dá para interromper a qualquer momento." }),
};

/** Erro no meio do laco, ja com a frase da tela. */
class ErroImportacao extends Error {
  constructor(readonly naTela: ErroNaTela) {
    super(naTela.texto);
  }
}

type RespostaLeitura = {
  products?: ProdutoOrigem[];
  collections?: ColecaoOrigem[];
  sourceDomain?: string;
  transformedPreview?: ProdutoTransformado | null;
};

type RespostaLote = {
  attempted?: number;
  createdCount?: number;
  skippedCount?: number;
  failedCount?: number;
  neutralizedCount?: number;
  logoAppliedCount?: number;
  skuMap?: Record<string, string>;
  variantMap?: Record<string, string>;
  failed?: { sourceHandle?: string; handle?: string; error?: string }[];
};

export function Assistente({ dados, escopoInicial }: { dados: DadosImportar; escopoInicial: Escopo }) {
  const { lojas, saldo, cobrando } = dados;
  const ativas = lojas.filter((l) => !l.conexao?.semAcesso);

  const [passo, setPasso] = React.useState<IdPasso>("destino");
  // So ja vem marcada quando nao ha escolha a fazer.
  const [destinoId, setDestinoId] = React.useState(() => (ativas.length === 1 ? ativas[0].id : ""));
  const [escopo, setEscopo] = React.useState<Escopo>(escopoInicial);
  const [origem, setOrigem] = React.useState("");
  const [limite, setLimite] = React.useState(String(LIMITE_PADRAO));
  const [colecoes, setColecoes] = React.useState<Leitura<ColecaoOrigem[]>>(NADA_LIDO);
  const [colecao, setColecao] = React.useState<ColecaoOrigem | null>(null);
  const [catalogo, setCatalogo] = React.useState<Leitura<Catalogo>>(NADA_LIDO);
  const [marcados, setMarcados] = React.useState<string[]>([]);
  const [opcoes, setOpcoes] = React.useState<Opcoes>(OPCOES_PADRAO);
  const [previa, setPrevia] = React.useState<Leitura<ProdutoTransformado>>(NADA_LIDO);
  const [execucao, setExecucao] = React.useState<Execucao | null>(null);

  const leituraRef = React.useRef<AbortController | null>(null);
  const importacaoRef = React.useRef<AbortController | null>(null);
  const tituloRef = React.useRef<HTMLHeadingElement>(null);

  const destino = lojas.find((l) => l.id === destinoId) ?? null;
  // Sem rota, a primeira loja: e o que a tela antiga mandava em sourceStoreId.
  const vitrineId = opcoes.rota ? opcoes.vitrineId : (lojas[0]?.id ?? "");
  const nomeVitrine = lojas.find((l) => l.id === opcoes.vitrineId)?.nome ?? null;

  // Cada leitura vale para o que estava na tela quando foi feita. Mudou o
  // link, o escopo, a colecao ou o teto: a leitura fica velha sozinha.
  const dominio = dominioDoLink(origem);
  const colecoesValidas = colecoes.chave === dominio ? colecoes : NADA_LIDO;
  const colecaoValida =
    colecao && colecoesValidas.estado === "lido" && colecoesValidas.dados?.some((c) => c.handle === colecao.handle)
      ? colecao
      : null;
  const chaveCatalogo = [escopo, origem.trim().toLowerCase(), colecaoValida?.handle ?? "", lerLimite(limite)].join("|");
  const catalogoValido = catalogo.chave === chaveCatalogo ? catalogo : NADA_LIDO;
  const lido = catalogoValido.estado === "lido" ? catalogoValido.dados : null;

  const marcadosSet = React.useMemo(() => new Set(marcados), [marcados]);
  const escolhidos = React.useMemo(
    () => (lido ? lido.produtos.filter((p) => marcadosSet.has(p.handle)) : []),
    [lido, marcadosSet]
  );

  const situacao: Situacao = {
    passo,
    escopo,
    destinoId,
    origem,
    colecaoEscolhida: Boolean(colecaoValida),
    catalogo: catalogoValido.estado,
    nCatalogo: lido?.produtos.length ?? 0,
    nMarcados: escolhidos.length,
    opcoes,
  };
  const trava = travaDoPasso(situacao);

  function corpo(acao: "preview" | "apply") {
    return montarCorpo({
      origem,
      acao,
      escopo,
      destinoId,
      vitrineId,
      limite,
      opcoes,
      colecaoHandle: colecaoValida?.handle ?? null,
    });
  }

  // A cada passo o foco vai para o titulo dele: o leitor de tela anuncia onde
  // a pessoa esta, e o Tab segue dali. Na primeira abertura, nao.
  const primeiraVez = React.useRef(true);
  const fase = execucao?.fase ?? null;
  React.useEffect(() => {
    if (primeiraVez.current) {
      primeiraVez.current = false;
      return;
    }
    tituloRef.current?.focus();
  }, [passo, fase]);

  // ------------------------------------------------------------ leituras

  async function lerCatalogo() {
    leituraRef.current?.abort();
    const controle = new AbortController();
    leituraRef.current = controle;
    const chave = chaveCatalogo;
    setCatalogo({ estado: "lendo", chave, dados: null, erro: null });
    try {
      // Mesmo corpo do "Ler catalogo" de antes (fica no historico).
      const r = await postarClone<RespostaLeitura>(corpo("preview"), controle.signal);
      if (!r.ok) {
        setCatalogo({ estado: "erro", chave, dados: null, erro: erroNaTela(r.status, r.dados.error, "ler", r.dados.code) });
        return;
      }
      const produtos = Array.isArray(r.dados.products) ? r.dados.products : [];
      setCatalogo({
        estado: "lido",
        chave,
        erro: null,
        dados: {
          produtos,
          colecoes: Array.isArray(r.dados.collections) ? r.dados.collections : [],
          dominio: r.dados.sourceDomain || dominio,
        },
      });
      // Tudo marcado de saida, como antes: desmarca-se o que nao quer.
      setMarcados(produtos.map((p) => p.handle));
    } catch (erro) {
      if (abortado(erro)) {
        setCatalogo((c) => (c.chave === chave ? { ...NADA_LIDO, chave } : c));
        return;
      }
      setCatalogo({ estado: "erro", chave, dados: null, erro: erroNaTela(500, null, "ler") });
    } finally {
      if (leituraRef.current === controle) leituraRef.current = null;
    }
  }

  async function lerColecoesDaOrigem() {
    if (!origem.trim()) return;
    const chave = dominio;
    setColecoes({ estado: "lendo", chave, dados: null, erro: null });
    try {
      const r = await lerColecoes<{ collections?: ColecaoOrigem[] }>(origem);
      if (!r.ok) {
        setColecoes({ estado: "erro", chave, dados: null, erro: erroNaTela(r.status, r.dados.error, "colecoes") });
        return;
      }
      setColecoes({ estado: "lido", chave, dados: Array.isArray(r.dados.collections) ? r.dados.collections : [], erro: null });
    } catch {
      setColecoes({ estado: "erro", chave, dados: null, erro: erroNaTela(500, null, "colecoes") });
    }
  }

  // A previa vale para as opcoes do momento em que foi gerada.
  const handlePrevia = escopo !== "produto" ? (escolhidos[0]?.handle ?? null) : null;
  const chavePrevia = JSON.stringify([corpo("preview"), handlePrevia]);

  async function gerarPrevia() {
    const chave = chavePrevia;
    setPrevia({ estado: "lendo", chave, dados: null, erro: null });
    try {
      // Mesmo corpo da "Visualizar 1 produto" de antes.
      const r = await postarClone<RespostaLeitura>({
        ...corpo("preview"),
        transformPreview: true,
        recordRun: false,
        limit: 1,
        pageSize: 1,
        ...(handlePrevia ? { productHandles: [handlePrevia] } : {}),
      });
      if (!r.ok || !r.dados.transformedPreview) {
        setPrevia({
          estado: "erro",
          chave,
          dados: null,
          erro: erroNaTela(r.ok ? 404 : r.status, r.dados.error ?? "Nenhum produto encontrado", "previa", r.dados.code),
        });
        return;
      }
      setPrevia({ estado: "lido", chave, dados: r.dados.transformedPreview, erro: null });
    } catch {
      setPrevia({ estado: "erro", chave, dados: null, erro: erroNaTela(500, null, "previa") });
    }
  }

  const estadoPrevia: EstadoPrevia = {
    estado: previa.estado,
    dados: previa.dados,
    erro: previa.erro,
    velha: previa.estado === "lido" && previa.chave !== chavePrevia,
  };

  // ------------------------------------------------------------ navegacao

  function irPara(p: IdPasso) {
    setPasso(p);
  }

  function avancar() {
    if (trava) return;
    const prox = proximoPasso(passo, escopo);
    if (!prox) return;
    setPasso(prox);
    // Antes dava para avancar a Selecao sem ter lido nada. Agora a leitura
    // comeca ao entrar nela, e o Continuar so solta com o catalogo lido.
    if (prox === "selecao" && catalogoValido.estado !== "lido" && catalogoValido.estado !== "lendo") {
      void lerCatalogo();
    }
  }

  function voltar() {
    const ant = passoAnterior(passo, escopo);
    if (ant) setPasso(ant);
  }

  function trocarEscopo(novo: Escopo) {
    setEscopo(novo);
    setColecao(null);
  }

  // ------------------------------------------------------------ importar

  async function iniciar() {
    const bloqueio = travaParaIniciar(situacao);
    if (bloqueio) {
      setPasso(bloqueio.passo);
      return;
    }
    if (!destino) return;

    const controle = new AbortController();
    importacaoRef.current = controle;
    const signal = controle.signal;
    const corpoApply = corpo("apply");
    const fotos = opcoes.marcas !== "manter";

    let estado: Execucao = {
      fase: escopo === "produto" ? "preparando" : "importando",
      atual: 0,
      total: escopo === "produto" ? 1 : escolhidos.length,
      criados: 0,
      pulados: 0,
      falhas: 0,
      listaFalhas: [],
      erro: null,
      rota: "nao",
      rotaErro: null,
      fotosNaFila: false,
    };
    const publicar = (parcial: Partial<Execucao>) => {
      estado = { ...estado, ...parcial };
      setExecucao(estado);
    };
    publicar({});

    const soma = {
      tentados: 0,
      neutralizados: 0,
      logos: 0,
      skuMap: {} as Record<string, string>,
      variantMap: {} as Record<string, string>,
    };
    let dominioRun = lido?.dominio || dominio;

    try {
      let produtosRun: ProdutoOrigem[];
      let colecoesRun: ColecaoOrigem[];
      let handles: string[];
      let total: number;

      if (escopo === "produto") {
        // Como antes: le o produto (sem historico) para saber o dominio e as
        // colecoes dele, e importa numa pagina so.
        const r = await postarClone<RespostaLeitura>({ ...corpo("preview"), limit: lerLimite(limite), recordRun: false }, signal);
        if (!r.ok) throw new ErroImportacao(erroNaTela(r.status, r.dados.error, "ler", r.dados.code));
        produtosRun = Array.isArray(r.dados.products) ? r.dados.products : [];
        colecoesRun = Array.isArray(r.dados.collections) ? r.dados.collections : [];
        dominioRun = r.dados.sourceDomain || dominioRun;
        if (produtosRun.length === 0) throw new ErroImportacao(erroNaTela(404, "Nenhum produto encontrado", "ler"));
        handles = [];
        total = 1;
      } else {
        produtosRun = lido?.produtos ?? [];
        colecoesRun = lido?.colecoes ?? [];
        handles = escolhidos.map((p) => p.handle);
        total = handles.length;
      }
      const titulos = new Map(produtosRun.map((p) => [p.handle, p.title]));
      publicar({ fase: "importando", total });

      const paginas = Math.ceil(total / TAMANHO_LOTE);
      for (let pagina = 1; pagina <= paginas; pagina += 1) {
        if (signal.aborted) throw new DOMException("Interrompida", "AbortError");
        const lote = handles.slice((pagina - 1) * TAMANHO_LOTE, pagina * TAMANHO_LOTE);
        const colecoesDoLote = Object.fromEntries(
          produtosRun
            .filter((p) => (lote.length > 0 ? lote.includes(p.handle) : p.collectionHandles?.length))
            .map((p) => [p.handle, p.collectionHandles || []])
        );
        const r = await postarClone<RespostaLote>(
          {
            ...corpoApply,
            ...(lote.length > 0
              ? { productHandles: lote, limit: lote.length }
              : { page: pagina, pageSize: TAMANHO_LOTE, limit: TAMANHO_LOTE }),
            collections: colecoesRun.map((c) => ({ handle: c.handle, title: c.title })),
            productCollections: colecoesDoLote,
            createRoutingConfig: false,
            recordRun: false,
          },
          signal
        );
        if (!r.ok) throw new ErroImportacao(erroNaTela(r.status, r.dados.error, "importar", r.dados.code));

        const tentados = Number(r.dados.attempted || 0);
        if (tentados === 0) break;
        soma.tentados += tentados;
        soma.neutralizados += Number(r.dados.neutralizedCount || 0);
        soma.logos += Number(r.dados.logoAppliedCount || 0);
        Object.assign(soma.skuMap, r.dados.skuMap || {});
        Object.assign(soma.variantMap, r.dados.variantMap || {});
        const novas: Falha[] = (Array.isArray(r.dados.failed) ? r.dados.failed : []).map((f) => {
          const handle = f?.sourceHandle || f?.handle || "";
          return {
            handle,
            titulo: titulos.get(handle) || handle || "Produto sem identificação",
            motivo: f?.error || "A Shopify não informou o motivo.",
          };
        });
        publicar({
          atual: Math.min(soma.tentados, total),
          criados: estado.criados + Number(r.dados.createdCount || 0),
          pulados: estado.pulados + Number(r.dados.skippedCount || 0),
          falhas: estado.falhas + Number(r.dados.failedCount || 0),
          listaFalhas: novas.length > 0 ? [...estado.listaFalhas, ...novas] : estado.listaFalhas,
        });
      }

      // Uma linha de historico com o total (cada lote vai sem historico).
      try {
        await postarJson("/api/shopify/clone/finalize", {
          sourceDomain: dominioRun || origem,
          targetStoreId: destinoId,
          createdCount: estado.criados,
          skippedCount: estado.pulados,
          failedCount: estado.falhas,
          neutralizedCount: soma.neutralizados,
          logoAppliedCount: soma.logos,
          failures: estado.listaFalhas.map((f) => ({ handle: f.handle || "(sem handle)", error: f.motivo })),
        });
      } catch {
        // Historico e best-effort: nunca derruba a importacao.
      }

      if (opcoes.rota && vitrineId && destinoId) {
        publicar({ fase: "rota" });
        const r = await postarJson<{ config?: unknown }>(
          "/api/checkout-routes",
          {
            name: `Clone ${dominioRun || origem} -> ${destino.dominio || "destino"}`,
            sourceStoreId: vitrineId,
            targetStoreId: destinoId,
            mode: "enterprise_static",
            skuMap: soma.skuMap,
            variantMap: soma.variantMap,
            settings: { generatedBy: "shopify_clone_batched" },
          },
          signal
        );
        publicar(
          r.ok
            ? { rota: "criada" }
            : { rota: "falhou", rotaErro: erroNaTela(r.status, r.dados.error, "importar", r.dados.code) }
        );
      }

      publicar({ fase: "concluida", fotosNaFila: fotos && estado.criados > 0 });
    } catch (erro) {
      if (abortado(erro)) {
        publicar({ fase: "interrompida", fotosNaFila: fotos && estado.criados > 0 });
      } else {
        publicar({
          fase: "erro",
          fotosNaFila: fotos && estado.criados > 0,
          erro:
            erro instanceof ErroImportacao
              ? erro.naTela
              : erroNaTela(500, erro instanceof Error ? erro.message : null, "importar"),
        });
      }
    } finally {
      if (importacaoRef.current === controle) importacaoRef.current = null;
    }
  }

  function interromper() {
    importacaoRef.current?.abort();
  }

  /** Outra importacao: mesmo destino e mesmas opcoes, origem do zero. */
  function novaImportacao() {
    setExecucao(null);
    setOrigem("");
    setColecao(null);
    setColecoes(NADA_LIDO);
    setCatalogo(NADA_LIDO);
    setMarcados([]);
    setPrevia(NADA_LIDO);
    setPasso("origem");
  }

  function voltarParaRevisao() {
    setExecucao(null);
    setPasso("revisao");
  }

  // ------------------------------------------------------------ tela

  const rodando = execucao ? emAndamento(execucao.fase) : false;
  const { titulo, dica } = TITULOS[passo](escopo);
  const dicaSelecao = lido
    ? `${inteiro(escolhidos.length)} de ${contar(lido.produtos.length, "produto selecionado", "produtos selecionados")} · origem ${lido.dominio}`
    : "Lemos o catálogo público da origem para você escolher o que entra.";

  const nProdutos = escopo === "produto" ? 1 : escolhidos.length;
  const nVariacoes = escopo === "produto" ? null : escolhidos.reduce((s, p) => s + (p.variants?.length || 0), 0);
  const linhasRevisao = [
    { rotulo: "Destino", valor: destino?.nome ?? "—" },
    { rotulo: "Origem", valor: <span className="font-mono">{lido?.dominio || dominio || "—"}</span> },
    {
      rotulo: "Escopo",
      valor: escopo === "produto" ? "Um produto" : escopo === "colecao" ? `Coleção ${colecaoValida?.title ?? "—"}` : "Loja inteira",
    },
    {
      rotulo: "Produtos",
      valor: (
        <span className="num">
          {contar(nProdutos, "produto", "produtos")}
          {nVariacoes !== null ? ` · ${contar(nVariacoes, "variação", "variações")}` : ""}
        </span>
      ),
    },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-[13rem_minmax(0,1fr)] lg:items-start lg:gap-6">
      <div className="lg:sticky lg:top-4">
        <Trilha
          passo={passo}
          escopo={escopo}
          concluida={execucao !== null}
          bloqueada={rodando}
          irPara={irPara}
        />
      </div>

      <div className="min-w-0 rounded-card border border-border bg-surface">
        {execucao && destino ? (
          <PainelExecucao
            execucao={execucao}
            destino={destino}
            tituloRef={tituloRef}
            interromper={interromper}
            nova={novaImportacao}
            voltar={voltarParaRevisao}
          />
        ) : (
          <>
            <div className="flex flex-col gap-4 p-4 sm:p-5">
              <div className="flex flex-col gap-1">
                <h2 id="imp-passo-titulo" ref={tituloRef} tabIndex={-1} className="text-section text-ink outline-none">
                  {titulo}
                </h2>
                <p className="text-dense text-t2">{passo === "selecao" ? dicaSelecao : dica}</p>
              </div>

              {passo === "destino" ? (
                <PassoDestino lojas={lojas} destinoId={destinoId} setDestinoId={setDestinoId} tituloId="imp-passo-titulo" />
              ) : null}
              {passo === "escopo" ? (
                <PassoEscopo escopo={escopo} setEscopo={trocarEscopo} tituloId="imp-passo-titulo" />
              ) : null}
              {passo === "origem" ? (
                <PassoOrigem
                  escopo={escopo}
                  origem={origem}
                  setOrigem={setOrigem}
                  limite={limite}
                  setLimite={setLimite}
                  aoEnter={avancar}
                  colecoes={{
                    estado: colecoesValidas.estado,
                    itens: colecoesValidas.dados ?? [],
                    erro: colecoesValidas.erro,
                  }}
                  colecaoHandle={colecaoValida?.handle ?? null}
                  setColecao={setColecao}
                  lerColecoes={() => void lerColecoesDaOrigem()}
                  usarLojaInteira={() => trocarEscopo("loja")}
                />
              ) : null}
              {passo === "selecao" ? (
                <PassoSelecao
                  estado={catalogoValido.estado}
                  catalogo={lido}
                  erro={catalogoValido.erro}
                  dominio={dominio}
                  marcados={marcados}
                  setMarcados={setMarcados}
                  ler={() => void lerCatalogo()}
                  cancelarLeitura={() => leituraRef.current?.abort()}
                  voltarOrigem={() => setPasso("origem")}
                />
              ) : null}
              {passo === "opcoes" ? (
                <PassoOpcoes
                  opcoes={opcoes}
                  mudar={(parcial) => setOpcoes((o) => ({ ...o, ...parcial }))}
                  destino={destino}
                  lojas={lojas}
                />
              ) : null}
              {passo === "revisao" ? (
                <PassoRevisao
                  linhas={linhasRevisao}
                  escolhas={resumoOpcoes(opcoes, nomeVitrine)}
                  estimativa={estimarCreditos(nProdutos, opcoes.marcas)}
                  saldo={saldo}
                  cobrando={cobrando}
                  marcas={opcoes.marcas}
                  previa={estadoPrevia}
                  gerarPrevia={() => void gerarPrevia()}
                />
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-b-card border-t border-border bg-surface-2 px-4 py-3 sm:px-5">
              {passo !== "destino" ? (
                <Button variant="secondary" onClick={voltar}>
                  Voltar
                </Button>
              ) : null}
              {passo === "revisao" ? (
                <Button onClick={() => void iniciar()} disabled={lojas.length === 0}>
                  {escopo === "produto" ? "Importar o produto" : `Importar ${contar(nProdutos, "produto", "produtos")}`}
                </Button>
              ) : (
                <Button
                  onClick={avancar}
                  disabled={Boolean(trava)}
                  focusableWhenDisabled
                  aria-describedby={trava ? "imp-trava" : undefined}
                >
                  Continuar
                </Button>
              )}
              {trava && passo !== "revisao" ? (
                <p id="imp-trava" className="text-label text-t2" aria-live="polite">
                  {trava}
                </p>
              ) : null}
            </div>
          </>
        )}
      </div>

      <AvisoAoSair ativo={rodando} interromper={interromper} />
    </div>
  );
}
