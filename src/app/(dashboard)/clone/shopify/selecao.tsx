"use client";

import * as React from "react";
import { ImageIcon, SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/components/ui/cn";
import { Caixa } from "./escolha";
import { DetalheSuporte } from "./detalhe";
import type { EstadoLeitura } from "./passos-iniciais";
import {
  ROTULO_ORDEM,
  alternarGrupo,
  categoriasDoCatalogo,
  contar,
  estadoDoGrupo,
  filtrarCatalogo,
  indexar,
  inteiro,
  miniatura,
  precoNaTela,
  primeiroSku,
  type ColecaoOrigem,
  type ErroNaTela,
  type Ordem,
  type ProdutoOrigem,
} from "./regras";

/** Linhas desenhadas por vez: catalogo de milhares nao trava a tela. */
const LOTE = 200;
/** Categorias a mostra antes do "ver todas". */
const CATEGORIAS_VISIVEIS = 12;

export interface Catalogo {
  produtos: ProdutoOrigem[];
  colecoes: ColecaoOrigem[];
  dominio: string;
}

export function PassoSelecao({
  estado,
  catalogo,
  erro,
  dominio,
  marcados,
  setMarcados,
  ler,
  cancelarLeitura,
  voltarOrigem,
}: {
  estado: EstadoLeitura;
  catalogo: Catalogo | null;
  erro: ErroNaTela | null;
  dominio: string;
  marcados: string[];
  setMarcados: React.Dispatch<React.SetStateAction<string[]>>;
  ler: () => void;
  cancelarLeitura: () => void;
  voltarOrigem: () => void;
}) {
  if (estado === "lendo") {
    return (
      <div className="flex flex-col gap-3">
        <div
          role="status"
          className="flex flex-wrap items-center gap-x-2.5 gap-y-2 rounded-control border border-run-border bg-run-bg px-3 py-2.5 text-dense text-run"
        >
          <span aria-hidden className="size-2 shrink-0 animate-xc-pulse rounded-full bg-run" />
          <span className="min-w-0 flex-1">
            Lendo o catálogo de <span className="font-mono">{dominio}</span>… Loja grande pode levar um minuto.
          </span>
          <Button size="sm" variant="secondary" onClick={cancelarLeitura}>
            Cancelar leitura
          </Button>
        </div>
        <div aria-hidden className="flex flex-col gap-2">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-15 rounded-card" />
          ))}
        </div>
      </div>
    );
  }

  if (estado === "erro" && erro) {
    return (
      <Callout
        tom="err"
        titulo="O catálogo não veio"
        acao={
          <Button size="sm" variant="secondary" onClick={ler}>
            Tentar de novo
          </Button>
        }
      >
        <p>{erro.texto}</p>
        <DetalheSuporte detalhe={erro.detalhe} />
      </Callout>
    );
  }

  if (estado !== "lido" || !catalogo) {
    return (
      <EmptyState
        titulo="O catálogo ainda não foi lido"
        descricao="A leitura leva alguns segundos e não muda nada na origem."
        acao={<Button onClick={ler}>Ler catálogo</Button>}
      />
    );
  }

  if (catalogo.produtos.length === 0) {
    return (
      <EmptyState
        titulo="Nenhum produto público nessa origem"
        descricao="Confira o link ou escolha outra coleção."
        acao={
          <Button variant="secondary" onClick={voltarOrigem}>
            Voltar para a origem
          </Button>
        }
      />
    );
  }

  return <Lista catalogo={catalogo} marcados={marcados} setMarcados={setMarcados} />;
}

function Lista({
  catalogo,
  marcados,
  setMarcados,
}: {
  catalogo: Catalogo;
  marcados: string[];
  setMarcados: React.Dispatch<React.SetStateAction<string[]>>;
}) {
  const [busca, setBusca] = React.useState("");
  // O campo responde a cada tecla; a lista alcanca depois.
  const termo = React.useDeferredValue(busca);
  const [ordem, setOrdem] = React.useState<Ordem>("origem");
  const [cats, setCats] = React.useState<string[]>([]);
  const [todasCats, setTodasCats] = React.useState(false);
  const [mostrar, setMostrar] = React.useState(LOTE);

  const indice = React.useMemo(() => indexar(catalogo.produtos), [catalogo.produtos]);
  const categorias = React.useMemo(
    () => categoriasDoCatalogo(catalogo.produtos, catalogo.colecoes),
    [catalogo.produtos, catalogo.colecoes]
  );
  const visiveis = React.useMemo(() => filtrarCatalogo(indice, termo, cats, ordem), [indice, termo, cats, ordem]);
  const handlesVisiveis = React.useMemo(() => visiveis.map((p) => p.handle), [visiveis]);
  const marcadosSet = React.useMemo(() => new Set(marcados), [marcados]);
  const grupo = estadoDoGrupo(handlesVisiveis, marcadosSet);
  const nVariacoes = React.useMemo(
    () => catalogo.produtos.reduce((s, p) => s + (p.variants?.length || 0), 0),
    [catalogo.produtos]
  );
  const filtrando = busca.trim() !== "" || cats.length > 0;

  const alternar = React.useCallback(
    (handle: string) =>
      setMarcados((atual) =>
        atual.includes(handle) ? atual.filter((h) => h !== handle) : [...atual, handle]
      ),
    [setMarcados]
  );

  function limparFiltros() {
    setBusca("");
    setCats([]);
    setMostrar(LOTE);
  }

  const catsNaTela = todasCats ? categorias : categorias.slice(0, CATEGORIAS_VISIVEIS);

  return (
    <div className="flex flex-col gap-4">
      {/* O que foi lido, em quatro numeros. */}
      <dl className="grid grid-cols-2 overflow-hidden rounded-card border border-border sm:grid-cols-4">
        {(
          [
            ["Produtos", catalogo.produtos.length],
            ["Variações", nVariacoes],
            ["Categorias", categorias.length],
            ["Selecionados", marcados.length],
          ] as const
        ).map(([rotulo, valor], i) => (
          <div
            key={rotulo}
            className={cn(
              "flex flex-col gap-0.5 border-border-subtle px-4 py-3",
              i % 2 === 1 && "border-l",
              i >= 2 && "border-t sm:border-t-0",
              i === 2 && "sm:border-l"
            )}
          >
            <dt className="text-label text-t2">{rotulo}</dt>
            <dd className="num text-section text-ink">{inteiro(valor)}</dd>
          </div>
        ))}
      </dl>

      {/* Busca e ordem */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-t2" />
          <Input
            type="search"
            value={busca}
            onChange={(e) => {
              setBusca(e.target.value);
              setMostrar(LOTE);
            }}
            aria-label="Buscar produto"
            placeholder="Buscar por nome, endereço ou SKU"
            className="pl-9"
          />
        </div>
        <Select
          value={ordem}
          onValueChange={(v) => {
            if (v) setOrdem(v as Ordem);
          }}
        >
          <SelectTrigger aria-label="Ordenar a lista" className="sm:w-52">
            <SelectValue>{() => ROTULO_ORDEM[ordem]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(ROTULO_ORDEM) as Ordem[]).map((o) => (
              <SelectItem key={o} value={o}>
                {ROTULO_ORDEM[o]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Categorias: filtro de varias escolhas, em botoes que ficam pressionados. */}
      {categorias.length > 0 ? (
        <div role="group" aria-label="Filtrar por categoria" className="flex flex-wrap items-center gap-2">
          {catsNaTela.map((c) => {
            const on = cats.includes(c.handle);
            return (
              <button
                key={c.handle}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  setCats((atual) => (on ? atual.filter((h) => h !== c.handle) : [...atual, c.handle]));
                  setMostrar(LOTE);
                }}
                className={cn(
                  "inline-flex h-ctl-md max-w-full items-center gap-1.5 rounded-control border px-3 text-label transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus sm:h-ctl-sm",
                  on
                    ? "border-ink bg-surface-2 font-semibold text-ink"
                    : "border-border bg-surface text-t1 hover:border-border-strong hover:bg-hover"
                )}
              >
                <span className="truncate">{c.titulo}</span>
                <span className="num text-t2">{inteiro(c.n)}</span>
              </button>
            );
          })}
          {categorias.length > CATEGORIAS_VISIVEIS ? (
            <Button variant="link" size="sm" onClick={() => setTodasCats((v) => !v)}>
              {todasCats ? "Mostrar menos" : `Ver todas as ${inteiro(categorias.length)}`}
            </Button>
          ) : null}
        </div>
      ) : null}

      {filtrando ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-label text-t2">
          <span aria-live="polite">{contar(visiveis.length, "produto na lista", "produtos na lista")}</span>
          <Button variant="ghost" size="sm" onClick={limparFiltros}>
            Limpar filtros
          </Button>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-card border border-border">
        {visiveis.length === 0 ? (
          <EmptyState
            variante="simples"
            titulo="Nenhum produto com esses filtros"
            descricao="A seleção feita antes continua guardada."
            acao={
              <Button variant="secondary" onClick={limparFiltros}>
                Limpar filtros
              </Button>
            }
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border-subtle bg-surface-2 px-3 py-1.5">
              <button
                type="button"
                role="checkbox"
                aria-checked={grupo}
                onClick={() => setMarcados((atual) => alternarGrupo(atual, handlesVisiveis, grupo !== true))}
                className="flex min-h-11 items-center gap-2.5 rounded-control pr-2 text-dense font-medium text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus sm:min-h-9"
              >
                <Caixa estado={grupo} />
                {filtrando ? "Todos da lista" : "Todos"}
                <span className="num font-normal text-t2">({inteiro(visiveis.length)})</span>
              </button>
              <span className="text-label text-t2">Preço na moeda da loja de origem</span>
            </div>
            <ul aria-label="Produtos da origem" className="divide-y divide-border-subtle">
              {visiveis.slice(0, mostrar).map((p) => (
                <Linha key={p.handle} produto={p} marcado={marcadosSet.has(p.handle)} alternar={alternar} />
              ))}
            </ul>
            {visiveis.length > mostrar ? (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle px-3 py-2.5">
                <span className="text-label text-t2">
                  Mostrando {inteiro(mostrar)} de {inteiro(visiveis.length)}
                </span>
                <Button variant="secondary" size="sm" onClick={() => setMostrar((m) => m + LOTE)}>
                  Mostrar mais {inteiro(Math.min(LOTE, visiveis.length - mostrar))}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

const Linha = React.memo(function Linha({
  produto,
  marcado,
  alternar,
}: {
  produto: ProdutoOrigem;
  marcado: boolean;
  alternar: (handle: string) => void;
}) {
  const foto = miniatura(produto.images?.[0]?.src);
  const sku = primeiroSku(produto);
  const nVar = produto.variants?.length || 0;
  return (
    <li className="[contain-intrinsic-size:auto_60px] [content-visibility:auto]">
      <button
        type="button"
        role="checkbox"
        aria-checked={marcado}
        onClick={() => alternar(produto.handle)}
        className="flex min-h-15 w-full items-center gap-3 bg-surface px-3 py-2 text-left transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
      >
        <Caixa estado={marcado} />
        <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-control border border-border-subtle bg-surface-2">
          {foto ? (
            // Foto vem da loja de origem (qualquer dominio): <img> simples, sob demanda.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={foto} alt="" loading="lazy" decoding="async" width={44} height={44} className="size-full object-cover" />
          ) : (
            <ImageIcon aria-hidden className="size-4 text-t3" />
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-dense font-medium text-ink">{produto.title}</span>
          <span className="truncate text-label text-t2">
            {contar(nVar, "variação", "variações")} ·{" "}
            {sku ? <span className="font-mono">SKU {sku}</span> : "sem SKU"}
          </span>
        </span>
        <span className="num shrink-0 text-right text-dense text-ink">{precoNaTela(produto)}</span>
      </button>
    </li>
  );
});
