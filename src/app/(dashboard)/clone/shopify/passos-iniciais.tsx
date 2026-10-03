"use client";

import * as React from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/components/ui/cn";
import type { LojaImportar } from "@/lib/leitura/importar-shopify";
import { GrupoEscolha } from "./escolha";
import { DetalheSuporte } from "./detalhe";
import {
  LIMITE_MAXIMO,
  contar,
  inteiro,
  pareceEndereco,
  pareceLinkDeProduto,
  type ColecaoOrigem,
  type ErroNaTela,
  type Escopo,
} from "./regras";

// ---------------------------------------------------------------- destino

function dominioCurto(dominio: string) {
  return dominio.replace(/\.myshopify\.com$/i, "");
}

export function PassoDestino({
  lojas,
  destinoId,
  setDestinoId,
  tituloId,
}: {
  lojas: LojaImportar[];
  destinoId: string;
  setDestinoId: (id: string) => void;
  tituloId: string;
}) {
  if (lojas.length === 0) {
    return (
      <EmptyState
        titulo="Nenhuma loja conectada"
        descricao="Conecte uma loja Shopify: é nela que os produtos são criados."
        acao={
          <Link href="/stores?conectar=1" className={buttonVariants()}>
            Conectar loja
          </Link>
        }
      />
    );
  }

  // Ativas primeiro; as sem acesso vao para o fim, com o selo.
  const ordenadas = [
    ...lojas.filter((l) => !l.conexao?.semAcesso),
    ...lojas.filter((l) => l.conexao?.semAcesso),
  ];
  const escolhida = lojas.find((l) => l.id === destinoId);

  return (
    <div className="flex flex-col gap-3">
      <GrupoEscolha
        rotuloId={tituloId}
        valor={destinoId}
        onValor={setDestinoId}
        opcoes={ordenadas.map((l) => ({
          valor: l.id,
          titulo: l.nome,
          descricao: <span className="font-mono">{dominioCurto(l.dominio)}</span>,
          extra:
            l.conexao && l.conexao.texto !== "Conectada" ? (
              <StatusBadge tom={l.conexao.tom} texto={l.conexao.texto} />
            ) : undefined,
        }))}
      />
      {escolhida?.conexao?.semAcesso ? (
        <Callout
          tom="warn"
          titulo="Esta loja está sem acesso"
          acao={
            <Link
              href={`/stores?conectar=1&dominio=${encodeURIComponent(escolhida.dominio)}`}
              className={buttonVariants({ variant: "secondary", size: "sm" })}
            >
              Reconectar
            </Link>
          }
        >
          A Shopify não está deixando o xcart entrar nela. A importação pode falhar até a loja ser reconectada.
        </Callout>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- escopo

export function PassoEscopo({
  escopo,
  setEscopo,
  tituloId,
}: {
  escopo: Escopo;
  setEscopo: (e: Escopo) => void;
  tituloId: string;
}) {
  return (
    <GrupoEscolha
      arranjo="grade"
      rotuloId={tituloId}
      valor={escopo}
      onValor={setEscopo}
      opcoes={[
        { valor: "produto", titulo: "Um produto", descricao: "Pelo link direto do produto." },
        { valor: "colecao", titulo: "Uma coleção", descricao: "Os produtos de uma coleção; você escolhe quais." },
        { valor: "loja", titulo: "Loja inteira", descricao: "O catálogo público inteiro; você escolhe quais." },
      ]}
    />
  );
}

// ---------------------------------------------------------------- origem

export type EstadoLeitura = "nao_lido" | "lendo" | "erro" | "lido";

export function PassoOrigem({
  escopo,
  origem,
  setOrigem,
  limite,
  setLimite,
  aoEnter,
  colecoes,
  colecaoHandle,
  setColecao,
  lerColecoes,
  usarLojaInteira,
}: {
  escopo: Escopo;
  origem: string;
  setOrigem: (v: string) => void;
  limite: string;
  setLimite: (v: string) => void;
  /** Enter no campo: segue para o proximo passo. */
  aoEnter: () => void;
  colecoes: { estado: EstadoLeitura; itens: ColecaoOrigem[]; erro: ErroNaTela | null };
  colecaoHandle: string | null;
  setColecao: (c: ColecaoOrigem) => void;
  lerColecoes: () => void;
  usarLojaInteira: () => void;
}) {
  const [tocado, setTocado] = React.useState(false);
  const preenchido = origem.trim().length > 0;
  const erro =
    tocado && preenchido
      ? escopo === "produto" && !pareceLinkDeProduto(origem)
        ? "Esse não é o link de um produto. Ele tem /products/ no endereço."
        : !pareceEndereco(origem)
          ? "Esse link não parece o endereço de uma loja. Cole o endereço completo."
          : null
      : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="imp-origem">{escopo === "produto" ? "Link do produto" : "Link da loja"}</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="imp-origem"
            value={origem}
            onChange={(e) => setOrigem(e.target.value)}
            onBlur={() => setTocado(true)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              setTocado(true);
              if (escopo === "colecao") lerColecoes();
              else aoEnter();
            }}
            placeholder={
              escopo === "produto" ? "https://loja-origem.com/products/nome-do-produto" : "https://loja-origem.com"
            }
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            aria-invalid={erro ? true : undefined}
            aria-describedby="imp-origem-ajuda"
            className="font-mono text-dense"
          />
          {escopo === "colecao" ? (
            <Button
              variant="secondary"
              onClick={() => {
                setTocado(true);
                lerColecoes();
              }}
              pending={colecoes.estado === "lendo"}
              disabled={!pareceEndereco(origem)}
              className="sm:min-w-32"
            >
              {colecoes.estado === "lido" ? "Ler de novo" : "Ler coleções"}
            </Button>
          ) : null}
        </div>
        <p id="imp-origem-ajuda" className={cn("text-label", erro ? "text-err" : "text-t2")}>
          {erro ?? "Lemos só o catálogo público desse endereço. A loja de origem não muda em nada."}
        </p>
      </div>

      {escopo === "loja" ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="imp-limite">Quantos produtos ler, no máximo</Label>
          <Input
            id="imp-limite"
            value={limite}
            onChange={(e) => setLimite(e.target.value.replace(/\D/g, "").slice(0, 4))}
            inputMode="numeric"
            aria-describedby="imp-limite-ajuda"
            className="num w-32 text-right"
          />
          <p id="imp-limite-ajuda" className="text-label text-t2">
            Até {inteiro(LIMITE_MAXIMO)}. Loja grande demora mais para ler. Também funciona com lojas Shoplazza e
            WooCommerce.
          </p>
        </div>
      ) : null}

      {escopo === "colecao" ? (
        <ListaColecoes
          estado={colecoes.estado}
          itens={colecoes.itens}
          erro={colecoes.erro}
          escolhida={colecaoHandle}
          escolher={setColecao}
          tentar={lerColecoes}
          usarLojaInteira={usarLojaInteira}
        />
      ) : null}
    </div>
  );
}

function ListaColecoes({
  estado,
  itens,
  erro,
  escolhida,
  escolher,
  tentar,
  usarLojaInteira,
}: {
  estado: EstadoLeitura;
  itens: ColecaoOrigem[];
  erro: ErroNaTela | null;
  escolhida: string | null;
  escolher: (c: ColecaoOrigem) => void;
  tentar: () => void;
  usarLojaInteira: () => void;
}) {
  const tituloId = React.useId();

  if (estado === "lendo") {
    return (
      <div aria-busy="true" aria-label="Lendo as coleções" className="flex flex-col gap-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-14 rounded-card" />
        ))}
      </div>
    );
  }
  if (estado === "erro" && erro) {
    return (
      <Callout
        tom="err"
        titulo="As coleções não vieram"
        acao={
          <Button size="sm" variant="secondary" onClick={tentar}>
            Tentar de novo
          </Button>
        }
      >
        <p>{erro.texto}</p>
        <DetalheSuporte detalhe={erro.detalhe} />
      </Callout>
    );
  }
  if (estado === "nao_lido") {
    return (
      <EmptyState
        variante="tracejado"
        titulo="Nenhuma coleção lida ainda"
        descricao="Cole o link da loja e use o botão Ler coleções."
      />
    );
  }
  if (itens.length === 0) {
    return (
      <EmptyState
        titulo="Nenhuma coleção pública nessa loja"
        descricao="Importe a loja inteira e escolha os produtos no próximo passo."
        acao={
          <Button variant="secondary" onClick={usarLojaInteira}>
            Importar a loja inteira
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p id={tituloId} className="text-dense font-medium text-ink">
        Escolha a coleção <span className="font-normal text-t2">· {contar(itens.length, "encontrada", "encontradas")}</span>
      </p>
      <div className="max-h-96 overflow-y-auto rounded-card">
        <GrupoEscolha
          rotuloId={tituloId}
          valor={escolhida ?? ""}
          onValor={(h) => {
            const c = itens.find((x) => x.handle === h);
            if (c) escolher(c);
          }}
          opcoes={itens.map((c) => ({
            valor: c.handle,
            titulo: c.title,
            extra:
              typeof c.productsCount === "number" ? (
                <span className="num text-label text-t2">{contar(c.productsCount, "produto", "produtos")}</span>
              ) : undefined,
          }))}
        />
      </div>
    </div>
  );
}
