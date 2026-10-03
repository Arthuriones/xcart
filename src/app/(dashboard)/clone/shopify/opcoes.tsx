"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRightIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Segmented } from "@/components/ui/segmented";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/components/ui/cn";
import { nomeIdioma } from "@/lib/leitura/lojas-estado";
import type { LojaImportar } from "@/lib/leitura/importar-shopify";
import { GrupoEscolha } from "./escolha";
import { instrucoesTemEfeito, montarInstrucoes, quantidadeValida, type Opcoes, type PartesInstrucoes } from "./regras";

// ============================================================================
// Passo "Opções": sete grupos com os nomes do Importar -- Publicação,
// Tradução, IA de texto, IA de imagem, Estoque, Duplicados e Rota. Cada
// texto diz o que a opcao FAZ de verdade na API de hoje (ex.: a traducao de
// cores e tamanhos e sempre para portugues; com troca de marca o produto entra
// so com a foto principal).
// ============================================================================

function Grupo({
  titulo,
  descricao,
  children,
}: {
  titulo: string;
  descricao?: React.ReactNode;
  children: React.ReactNode;
}) {
  const id = React.useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 rounded-card border border-border p-4">
      <div className="flex flex-col gap-0.5">
        <h3 id={id} className="text-dense font-semibold text-ink">
          {titulo}
        </h3>
        {descricao ? <p className="text-label text-t2">{descricao}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function PassoOpcoes({
  opcoes: o,
  mudar,
  destino,
  lojas,
}: {
  opcoes: Opcoes;
  mudar: (parcial: Partial<Opcoes>) => void;
  destino: LojaImportar | null;
  lojas: LojaImportar[];
}) {
  const idioma = nomeIdioma(destino?.idioma);
  const vitrines = lojas.filter((l) => l.id !== destino?.id);
  const trocaMarca = o.marcas !== "manter";
  const semLogo = destino ? !destino.temLogo : false;
  const quantidadeErrada = o.estoque === "fixo" && !quantidadeValida(o.quantidade);

  return (
    <div className="flex flex-col gap-4">
      <Grupo titulo="Publicação">
        <Switch
          rotulo="Publicar na loja ao criar"
          descricao="Desligado, o produto entra como rascunho e o cliente não vê."
          checked={o.publicar}
          onCheckedChange={(v) => mudar({ publicar: v })}
        />
      </Grupo>

      <Grupo titulo="Tradução">
        <Switch
          rotulo="Traduzir nome e descrição"
          descricao={idioma ? `Para o idioma da loja de destino (${idioma}).` : "Para o idioma da loja de destino."}
          checked={o.traduzir}
          onCheckedChange={(v) => mudar({ traduzir: v })}
        />
        {o.traduzir && destino && !destino.temNicho ? (
          <Callout
            tom="warn"
            titulo="A loja de destino está sem nicho"
            acao={
              <Link href={`/stores/${destino.id}`} className={buttonVariants({ variant: "secondary", size: "sm" })}>
                Completar a loja
              </Link>
            }
          >
            Sem o nicho a tradução não roda, e o produto entra com o texto original.
          </Callout>
        ) : null}
        <Switch
          rotulo="Traduzir cores e tamanhos"
          descricao="Sempre para português: blue vira azul, S vira P."
          checked={o.traduzirVariacoes}
          onCheckedChange={(v) => mudar({ traduzirVariacoes: v })}
        />
      </Grupo>

      <Grupo titulo="IA de texto" descricao="O que fazer com as marcas no nome, na descrição e na foto principal.">
        <GrupoEscolha
          rotulo="Marcas"
          valor={o.marcas}
          onValor={(m) => mudar({ marcas: m })}
          opcoes={[
            { valor: "manter", titulo: "Manter como está", descricao: "Nome, descrição e fotos iguais aos da origem." },
            {
              valor: "tirar",
              titulo: "Tirar as marcas",
              descricao: "A IA tira marcas e logos do texto e da foto principal, inclusive a do próprio produto.",
            },
            {
              valor: "origem",
              titulo: "Manter a marca, tirar a origem",
              descricao: "A marca do produto fica; saem as menções à loja de origem e ao fornecedor.",
            },
          ]}
        />
        {o.marcas === "tirar" ? (
          <Switch
            rotulo="Trocar o nome por um genérico"
            descricao="Air Jordan vira Tênis esportivo."
            checked={o.nomeGenerico}
            onCheckedChange={(v) => mudar({ nomeGenerico: v })}
          />
        ) : null}
        {trocaMarca ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="imp-instr-marca">O que a IA deve preservar ou tirar (opcional)</Label>
            <Textarea
              id="imp-instr-marca"
              rows={2}
              value={o.instrucoesMarcas}
              onChange={(e) => mudar({ instrucoesMarcas: e.target.value })}
              placeholder="Ex.: tirar só o patch da FIFA e manter o escudo do time."
              className="min-h-16"
            />
          </div>
        ) : null}
        <InstrucoesIa
          partes={o.instrucoesIa}
          mudar={(p) => mudar({ instrucoesIa: { ...o.instrucoesIa, ...p } })}
          temEfeito={instrucoesTemEfeito(o)}
        />
      </Grupo>

      <Grupo titulo="IA de imagem">
        {trocaMarca ? (
          <Callout tom="info" titulo="A foto principal é refeita com IA">
            Depois de criar cada produto, em segundo plano: 1 crédito por produto. O produto entra só com a foto
            principal.
          </Callout>
        ) : (
          <p className="text-dense text-t1">As fotos vêm como estão na origem.</p>
        )}
        <Switch
          rotulo="Aplicar a logo da loja nas imagens"
          descricao={
            trocaMarca
              ? "Não vale com troca de marca: a foto principal é refeita pela IA."
              : semLogo
                ? "Esta loja ainda não tem logo cadastrada."
                : "A logo da loja de destino entra em cada imagem do produto."
          }
          checked={o.logo && !trocaMarca && !semLogo}
          disabled={trocaMarca || semLogo}
          onCheckedChange={(v) => mudar({ logo: v })}
        />
        {semLogo && !trocaMarca && destino ? (
          <Link
            href={`/stores/${destino.id}`}
            className="w-fit rounded-sm text-label text-brand underline underline-offset-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            Cadastrar a logo da loja
          </Link>
        ) : null}
      </Grupo>

      <Grupo titulo="Estoque">
        <Segmented
          rotulo="Estoque"
          tamanho="md"
          valor={o.estoque}
          onValorChange={(v) => mudar({ estoque: v })}
          opcoes={[
            { valor: "livre", rotulo: "Sem controle" },
            { valor: "fixo", rotulo: "Estoque inicial" },
          ]}
        />
        {o.estoque === "livre" ? (
          <p className="text-label text-t2">A Shopify nunca marca o produto como esgotado.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="imp-qtd">Quantidade de cada variação</Label>
            <Input
              id="imp-qtd"
              value={o.quantidade}
              onChange={(e) => mudar({ quantidade: e.target.value.replace(/\D/g, "").slice(0, 7) })}
              inputMode="numeric"
              aria-invalid={quantidadeErrada || undefined}
              aria-describedby="imp-qtd-ajuda"
              className="num w-32 text-right"
            />
            <p id="imp-qtd-ajuda" className={cn("text-label", quantidadeErrada ? "text-err" : "text-t2")}>
              {quantidadeErrada ? "Informe um número inteiro." : "A Shopify passa a controlar e baixa a cada venda."}
            </p>
          </div>
        )}
      </Grupo>

      <Grupo
        titulo="Duplicados"
        descricao="Conta como repetido o produto com o mesmo nome ou o mesmo endereço na loja de destino."
      >
        <GrupoEscolha
          rotulo="Produto que já existe na loja de destino"
          valor={o.duplicados}
          onValor={(d) => mudar({ duplicados: d })}
          opcoes={[
            { valor: "pular", titulo: "Pular o que já existe", descricao: "Nada é criado em dobro." },
            { valor: "criar", titulo: "Criar mesmo assim", descricao: "Cria uma cópia nova ao lado da que já existe." },
          ]}
        />
      </Grupo>

      <Grupo titulo="Rota" descricao="Só para quem usa vitrine: o checkout da vitrine cai nesta loja, ligado pelo SKU.">
        <Switch
          rotulo="Preparar a rota de checkout"
          descricao={
            vitrines.length === 0
              ? "Precisa de outra loja conectada para ser a vitrine."
              : "No fim, grava a ligação entre a vitrine e a loja de destino."
          }
          checked={o.rota}
          disabled={vitrines.length === 0}
          onCheckedChange={(v) => mudar({ rota: v })}
        />
        {o.rota && vitrines.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <Label id="imp-vitrine-rotulo">Loja vitrine</Label>
            <Select
              value={o.vitrineId || null}
              onValueChange={(v) => {
                if (typeof v === "string") mudar({ vitrineId: v });
              }}
            >
              <SelectTrigger
                aria-labelledby="imp-vitrine-rotulo"
                aria-describedby="imp-vitrine-ajuda"
                aria-invalid={!o.vitrineId || undefined}
                className="sm:w-80"
              >
                <SelectValue>
                  {() => vitrines.find((l) => l.id === o.vitrineId)?.nome ?? "Escolha a vitrine"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {vitrines.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p id="imp-vitrine-ajuda" className="text-label text-t2">
              A loja que recebe o anúncio. Ela precisa vender os mesmos SKUs da origem.
            </p>
          </div>
        ) : null}
      </Grupo>
    </div>
  );
}

/** Instrucoes livres para a IA, recolhidas: abrem quando a pessoa pede. */
function InstrucoesIa({
  partes,
  mudar,
  temEfeito,
}: {
  partes: PartesInstrucoes;
  mudar: (p: Partial<PartesInstrucoes>) => void;
  temEfeito: boolean;
}) {
  const preenchidas = montarInstrucoes(partes) !== "";
  const [aberto, setAberto] = React.useState(preenchidas);
  const id = React.useId();

  return (
    <div className="flex flex-col gap-3 border-t border-border-subtle pt-3">
      <button
        type="button"
        aria-expanded={aberto}
        aria-controls={id}
        onClick={() => setAberto((v) => !v)}
        className="flex min-h-9 w-fit items-center gap-1.5 rounded-control text-dense font-medium text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        <ChevronRightIcon
          aria-hidden
          className={cn("size-4 text-t2 transition-transform duration-150 motion-reduce:transition-none", aberto && "rotate-90")}
        />
        Instruções para a IA
        <span className="font-normal text-t2">· {preenchidas ? "preenchidas" : "opcional"}</span>
      </button>
      {!temEfeito ? (
        <p className="text-label text-t2">Só valem com a tradução ou a troca de marca ligada.</p>
      ) : null}
      {aberto ? (
        <div id={id} className="grid gap-3 md:grid-cols-3">
          <CampoInstrucao
            id={`${id}-img`}
            rotulo="Imagens"
            valor={partes.imagens}
            mudar={(v) => mudar({ imagens: v })}
            exemplo="Ex.: fundo branco, sem textos nem selos do vendedor."
          />
          <CampoInstrucao
            id={`${id}-txt`}
            rotulo="Nome, descrição e SEO"
            valor={partes.textos}
            mudar={(v) => mudar({ textos: v })}
            exemplo="Ex.: tom direto, tópicos curtos, sem prometer originalidade."
          />
          <CampoInstrucao
            id={`${id}-ger`}
            rotulo="Regras gerais"
            valor={partes.gerais}
            mudar={(v) => mudar({ gerais: v })}
            exemplo="Ex.: manter as variações e não inventar garantia."
          />
        </div>
      ) : null}
    </div>
  );
}

function CampoInstrucao({
  id,
  rotulo,
  valor,
  mudar,
  exemplo,
}: {
  id: string;
  rotulo: string;
  valor: string;
  mudar: (v: string) => void;
  exemplo: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{rotulo}</Label>
      <Textarea id={id} rows={3} value={valor} onChange={(e) => mudar(e.target.value)} placeholder={exemplo} />
    </div>
  );
}
