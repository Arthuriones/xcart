"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Section } from "@/components/ui/section";
import { Segmented } from "@/components/ui/segmented";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/components/ui/cn";
import type { LojaDestino } from "@/lib/leitura/importar";
import { enfileirar } from "./api";
import { ListaFila, useFila } from "./fila";
import {
  MAX_LINKS,
  PADRAO,
  POR_LINK,
  corpoDoLote,
  faltaParaEnviar,
  lerLinks,
  plural,
  problemasDoLote,
  resumoDasOpcoes,
  tetoDeProdutos,
  usaIaDeImagem,
  type CampoLote,
  type ModoEstoque,
  type OpcoesLote,
  type Origem,
} from "./regras";

// ============================================================================
// Importar em lote: /bulk (AliExpress, lojas Shopify e links soltos) e
// /multi-site (Nuvemshop, WooCommerce e outros sites). A mesma tela com outra
// origem: o que muda e o texto de ajuda, o teto de produtos por link e o
// corpo do POST (corpoDoLote), que e o mesmo de antes em cada origem.
//
// Os links vao para a fila do servidor: o lojista pode sair da tela.
// ============================================================================

const TEXTO: Record<
  Origem,
  { ajudaLinks: string; exemplo: string; limparTitulo: string; limparDescricao: string; vazio: string }
> = {
  links: {
    ajudaLinks:
      "Um por linha: produto do AliExpress, produto ou coleção de uma loja Shopify, ou o endereço da loja inteira.",
    exemplo: "https://pt.aliexpress.com/item/1005…\nhttps://loja.com/products/camiseta\nloja-exemplo.myshopify.com",
    limparTitulo: "Limpar referências ao fornecedor",
    limparDescricao:
      "Tira AliExpress, nome do vendedor e marca d’água do texto e das fotos. A marca do produto continua.",
    vazio: "Os links que você colar aparecem aqui, com o andamento de cada um.",
  },
  sites: {
    ajudaLinks: "Um por linha: página de produto ou de categoria de Nuvemshop, WooCommerce ou loja própria.",
    exemplo:
      "https://loja.lojavirtualnuvem.com.br/produtos/camiseta\nhttps://site.com/produto/modelo\nhttps://marca.com/categoria/camisetas",
    limparTitulo: "Limpar referências à loja de origem",
    limparDescricao:
      "Tira o nome da loja de origem, selos e marca d’água do texto e das fotos. A marca do produto continua.",
    vazio: "Os links que você colar aparecem aqui, com o andamento de cada um.",
  },
};

const ORDEM_CAMPOS: CampoLote[] = ["loja", "links", "fotos", "quantidade"];

function rotuloPorLink(v: string | null): string {
  const n = Number(v) || 1;
  return n === 1 ? "1 produto" : `${n} produtos`;
}

export function ImportacaoEmLote({
  origem,
  lojas,
  lojaInicial,
}: {
  origem: Origem;
  lojas: LojaDestino[];
  /** Loja ja escolhida (?loja= ou a unica com acesso); "" = nenhuma. */
  lojaInicial: string;
}) {
  const id = React.useId();
  const texto = TEXTO[origem];
  const comAcesso = lojas.filter((l) => !l.semAcesso);
  const semAcesso = lojas.filter((l) => l.semAcesso);
  const nomePorId = React.useMemo(() => new Map(lojas.map((l) => [l.id, l.nome])), [lojas]);

  const [lojaId, setLojaId] = React.useState(lojaInicial);
  const [links, setLinks] = React.useState("");
  const [o, setO] = React.useState<OpcoesLote>(PADRAO[origem]);
  const [tentou, setTentou] = React.useState(false);
  const [enviando, setEnviando] = React.useState(false);
  const [erroEnvio, setErroEnvio] = React.useState<string | null>(null);
  const fila = useFila(lojaId);

  const lista = React.useMemo(() => lerLinks(links), [links]);
  const problemas = problemasDoLote(origem, lojaId, lista, o);
  // Erro aparece depois da primeira tentativa; links demais, na hora.
  const erro = (c: CampoLote) =>
    tentou || (c === "links" && lista.length > MAX_LINKS) ? problemas[c] : undefined;
  const falta = tentou ? faltaParaEnviar(problemas, lista.length) : null;
  const iaDeImagem = usaIaDeImagem(o, origem);

  function muda<K extends keyof OpcoesLote>(campo: K, valor: OpcoesLote[K]) {
    setO((antes) => ({ ...antes, [campo]: valor }));
    setErroEnvio(null);
  }

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setTentou(true);
    setErroEnvio(null);
    const primeiro = ORDEM_CAMPOS.find((c) => problemas[c]);
    if (primeiro) {
      document.getElementById(`${id}-${primeiro}`)?.focus();
      return;
    }
    setEnviando(true);
    const r = await enfileirar(corpoDoLote(origem, lojaId, lista, o));
    setEnviando(false);
    if (!r.ok) {
      setErroEnvio(r.erro);
      return;
    }
    const n = Number(r.dados.queued) || r.dados.jobs?.length || lista.length;
    toast.success(n === 1 ? "1 link entrou na fila." : `${n} links entraram na fila.`, {
      description: "Pode sair desta tela: a importação continua.",
      action: {
        label: "Ver fila",
        onClick: () => {
          const calmo = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          document.getElementById("fila")?.scrollIntoView({ behavior: calmo ? "auto" : "smooth", block: "start" });
        },
      },
    });
    setLinks("");
    setTentou(false);
    await fila.recarregar();
    // Como antes: alem do que o servidor ja comecou, adianta os proximos 5.
    void fila.continuar(true);
  }

  const lojaEscolhida = lojaId ? (nomePorId.get(lojaId) ?? null) : null;

  return (
    <div className="flex flex-col gap-6">
      {comAcesso.length === 0 ? (
        <Callout
          tom="warn"
          titulo={lojas.length ? "Nenhuma loja com acesso para receber produtos" : "Nenhuma loja conectada"}
          acao={
            <Link href="/stores?conectar=1" className={buttonVariants({ variant: "secondary", size: "sm" })}>
              Conectar loja
            </Link>
          }
        >
          {lojas.length
            ? "O app foi desinstalado das suas lojas. Reconecte uma para importar."
            : "Conecte a loja Shopify que vai receber os produtos."}
        </Callout>
      ) : null}

      <form
        onSubmit={enviar}
        noValidate
        className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]"
      >
        <div className="flex min-w-0 flex-col gap-4">
          <Section titulo="Links e destino" descricao={`Até ${MAX_LINKS} links por vez.`}>
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,200px)]">
              <div className="flex min-w-0 flex-col gap-1.5">
                <Label htmlFor={`${id}-loja`}>Loja de destino</Label>
                <Select
                  value={lojaId || null}
                  onValueChange={(v) => {
                    setLojaId(v ?? "");
                    setErroEnvio(null);
                  }}
                  disabled={comAcesso.length === 0}
                >
                  <SelectTrigger
                    id={`${id}-loja`}
                    aria-invalid={erro("loja") ? true : undefined}
                    aria-describedby={erro("loja") ? `${id}-loja-erro` : undefined}
                  >
                    <SelectValue placeholder="Escolha a loja">
                      {(v: string | null) => (v ? (nomePorId.get(v) ?? "Escolha a loja") : "Escolha a loja")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {comAcesso.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate">{l.nome}</span>
                          <span className="truncate text-label text-t2">{l.dominio}</span>
                        </span>
                      </SelectItem>
                    ))}
                    {semAcesso.length ? (
                      <SelectGroup>
                        <SelectLabel>Sem acesso: app desinstalado</SelectLabel>
                        {semAcesso.map((l) => (
                          <SelectItem key={l.id} value={l.id} disabled>
                            <span className="truncate">{l.nome}</span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ) : null}
                  </SelectContent>
                </Select>
                {erro("loja") ? (
                  <p id={`${id}-loja-erro`} className="text-label text-err">
                    {erro("loja")}
                  </p>
                ) : null}
              </div>

              <div className="flex min-w-0 flex-col gap-1.5">
                <Label htmlFor={`${id}-porlink`}>Produtos por link</Label>
                <Select value={o.porLink} onValueChange={(v) => muda("porLink", v ?? "1")}>
                  <SelectTrigger id={`${id}-porlink`} aria-describedby={`${id}-porlink-ajuda`}>
                    <SelectValue>{(v: string | null) => rotuloPorLink(v)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {POR_LINK[origem].map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {rotuloPorLink(String(n))}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p id={`${id}-porlink-ajuda`} className="text-label text-t2">
                  Vale para link de loja ou categoria. Link de produto traz só ele.
                </p>
              </div>
            </div>

            <div className="flex min-w-0 flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <Label htmlFor={`${id}-links`}>Links para importar</Label>
                <span
                  className={cn(
                    "num text-label",
                    lista.length > MAX_LINKS ? "font-semibold text-err" : "text-t2"
                  )}
                >
                  {lista.length} de {MAX_LINKS}
                </span>
              </div>
              <Textarea
                id={`${id}-links`}
                rows={7}
                value={links}
                onChange={(e) => {
                  setLinks(e.target.value);
                  setErroEnvio(null);
                }}
                placeholder={texto.exemplo}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                aria-invalid={erro("links") ? true : undefined}
                aria-describedby={cn(`${id}-links-ajuda`, erro("links") && `${id}-links-erro`)}
                className="font-mono text-dense"
              />
              <p id={`${id}-links-ajuda`} className="text-label text-t2">
                {texto.ajudaLinks}
              </p>
              {erro("links") ? (
                <p id={`${id}-links-erro`} className="text-label text-err">
                  {erro("links")}
                </p>
              ) : null}
            </div>
          </Section>

          <Section titulo="Opções" descricao="Valem para todos os links deste lote.">
            <div className="flex flex-col gap-4">
            <Grupo titulo="Publicação">
              <Opcao
                rotulo="Publicar na loja virtual"
                descricao="Desligado, o produto é criado mas fica fora da loja até você publicar."
                checked={o.publicar}
                onCheckedChange={(v) => muda("publicar", v)}
              />
            </Grupo>

            <Grupo titulo="Tradução">
              <Opcao
                rotulo="Traduzir título e descrição"
                descricao="Para o idioma da loja de destino, com IA."
                checked={o.traduzir}
                onCheckedChange={(v) => muda("traduzir", v)}
              />
              <Opcao
                rotulo="Traduzir cores e tamanhos"
                descricao="Os nomes das variações também mudam de idioma."
                checked={o.traduzirVariacoes}
                onCheckedChange={(v) => muda("traduzirVariacoes", v)}
              />
            </Grupo>

            <Grupo titulo="Categoria">
              <Opcao
                rotulo="Preencher a categoria da Shopify"
                descricao="Usa a lista de categorias da própria Shopify."
                checked={o.categoria}
                onCheckedChange={(v) => muda("categoria", v)}
              />
              {o.categoria ? (
                <div className="pl-12.5">
                  <Opcao
                    rotulo="Usar IA quando não achar a categoria"
                    checked={o.categoriaComIa}
                    onCheckedChange={(v) => muda("categoriaComIa", v)}
                  />
                </div>
              ) : null}
            </Grupo>

            <Grupo titulo="Marca e fotos">
              {origem === "links" ? (
                <Opcao
                  rotulo="Tirar a marca do produto"
                  descricao="Título e descrição genéricos e fotos refeitas com IA, sem logotipo. Desliga a limpeza abaixo."
                  checked={o.tirarMarca}
                  onCheckedChange={(v) =>
                    setO((a) => ({ ...a, tirarMarca: v, limparReferencias: v ? false : a.limparReferencias }))
                  }
                />
              ) : null}
              <Opcao
                rotulo={texto.limparTitulo}
                descricao={
                  origem === "links" ? `${texto.limparDescricao} Desliga a opção acima.` : texto.limparDescricao
                }
                checked={o.limparReferencias}
                onCheckedChange={(v) =>
                  setO((a) => ({ ...a, limparReferencias: v, tirarMarca: v ? false : a.tirarMarca }))
                }
              />
              <Opcao
                rotulo="Aplicar o logo da loja nas fotos"
                descricao="Usa o logo cadastrado na loja de destino."
                checked={o.aplicarLogo}
                onCheckedChange={(v) => muda("aplicarLogo", v)}
              />

              {iaDeImagem ? (
                <div className="flex flex-col gap-4 rounded-control border border-border-subtle bg-surface-2 p-3">
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <Label htmlFor={`${id}-instrucoes`}>
                      Instruções para a IA <span className="font-normal text-t2">(opcional)</span>
                    </Label>
                    <Textarea
                      id={`${id}-instrucoes`}
                      rows={3}
                      maxLength={1200}
                      value={o.instrucoesIa}
                      onChange={(e) => muda("instrucoesIa", e.target.value)}
                      placeholder="Ex.: tirar só o selo do campeonato e manter o escudo do time."
                      aria-describedby={`${id}-instrucoes-ajuda`}
                      className="text-dense"
                    />
                    <p id={`${id}-instrucoes-ajuda`} className="text-label text-t2">
                      Valem para todos os produtos deste lote.
                    </p>
                  </div>
                  <div className="flex min-w-0 flex-col gap-1.5 sm:max-w-64">
                    <Label htmlFor={`${id}-fotos`}>Fotos refeitas por produto</Label>
                    <Input
                      id={`${id}-fotos`}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={20}
                      value={o.fotosComIa}
                      onChange={(e) => muda("fotosComIa", e.target.value)}
                      aria-invalid={erro("fotos") ? true : undefined}
                      aria-describedby={cn(`${id}-fotos-ajuda`, erro("fotos") && `${id}-fotos-erro`)}
                      className="num"
                    />
                    <p id={`${id}-fotos-ajuda`} className="text-label text-t2">
                      De 1 a 20. As outras fotos entram como estão; menos fotos, menos uso de IA.
                    </p>
                    {erro("fotos") ? (
                      <p id={`${id}-fotos-erro`} className="text-label text-err">
                        {erro("fotos")}
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </Grupo>

            <Grupo titulo="Estoque">
              <Segmented<ModoEstoque>
                rotulo="Estoque ao importar"
                valor={o.estoque}
                onValorChange={(v) => muda("estoque", v)}
                opcoes={[
                  { valor: "not_tracked", rotulo: "Sem controle" },
                  { valor: "tracked", rotulo: "Definir quantidade" },
                ]}
                tamanho="md"
              />
              <p className="text-label text-t2">
                {o.estoque === "not_tracked"
                  ? "A Shopify não conta o estoque e o produto nunca aparece esgotado. É o recomendado."
                  : "O produto entra com esta quantidade em estoque."}
              </p>
              {o.estoque === "tracked" ? (
                <div className="flex min-w-0 flex-col gap-1.5 sm:max-w-64">
                  <Label htmlFor={`${id}-quantidade`}>Quantidade</Label>
                  <Input
                    id={`${id}-quantidade`}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={o.quantidade}
                    onChange={(e) => muda("quantidade", e.target.value)}
                    aria-invalid={erro("quantidade") ? true : undefined}
                    aria-describedby={erro("quantidade") ? `${id}-quantidade-erro` : undefined}
                    className="num"
                  />
                  {erro("quantidade") ? (
                    <p id={`${id}-quantidade-erro`} className="text-label text-err">
                      {erro("quantidade")}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </Grupo>
            </div>
          </Section>
        </div>

        <aside aria-label="Resumo da importação" className="min-w-0 lg:sticky lg:top-20">
          <Section titulo="Resumo">
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-dense">
              <dt className="text-t2">Loja</dt>
              <dd className={cn("truncate", lojaEscolhida ? "text-ink" : "text-t2")}>
                {lojaEscolhida ?? "Nenhuma escolhida"}
              </dd>
              <dt className="text-t2">Links</dt>
              <dd className="num text-ink">
                {lista.length} de {MAX_LINKS}
              </dd>
              <dt className="text-t2">Produtos</dt>
              <dd className="num text-ink">
                {lista.length ? `até ${plural(tetoDeProdutos(lista.length, o.porLink), "produto", "produtos")}` : "—"}
              </dd>
            </dl>
            <ul aria-label="Opções ligadas" className="flex flex-wrap gap-1.5">
              {resumoDasOpcoes(origem, o).map((s) => (
                <li key={s}>
                  <Badge variant="outline">{s}</Badge>
                </li>
              ))}
            </ul>
            {falta ? (
              <p role="alert" className="text-dense text-err">
                {falta}
              </p>
            ) : null}
            {erroEnvio ? (
              <p role="alert" className="text-dense text-err">
                {erroEnvio}
              </p>
            ) : null}
            <Button type="submit" size="lg" pending={enviando} className="w-full">
              Iniciar importação
            </Button>
            <p className="text-label text-t2">
              Os links entram numa fila no servidor. Pode sair desta tela que a importação continua.
            </p>
          </Section>
        </aside>
      </form>

      <ListaFila
        fila={fila}
        lojas={lojas}
        mostrarLoja={!lojaId}
        descricao={lojaEscolhida ? `Últimas importações de ${lojaEscolhida}` : "Últimas importações de todas as lojas"}
        vazio={{
          titulo: lojaEscolhida ? "Nada importado para esta loja ainda" : "Nenhuma importação por link ainda",
          descricao: texto.vazio,
        }}
      />
    </div>
  );
}

/**
 * Liga/desliga com rotulo e descricao. O aria-label repete o rotulo: o Switch
 * da fundacao e um <span role="switch"> dentro de <label>, e o leitor de tela
 * nao herda o nome do label que o envolve (so elemento nativo herda).
 */
function Opcao(props: {
  rotulo: string;
  descricao?: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return <Switch {...props} aria-label={props.rotulo} />;
}

/** Um grupo de opcoes: fieldset com o nome do grupo, separado por linha fina. */
function Grupo({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-border-subtle pt-4 first:border-t-0 first:pt-0">
      <fieldset className="flex min-w-0 flex-col gap-3">
        <legend className="mb-3 text-dense font-semibold text-ink">{titulo}</legend>
        {children}
      </fieldset>
    </div>
  );
}
