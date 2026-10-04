"use client";

import { useId } from "react";
import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup } from "@/components/ui/radio-group";
import { Section } from "@/components/ui/section";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { BotaoConectar } from "@/app/(dashboard)/stores/conectar-loja";
import {
  IDIOMAS,
  MODOS,
  ocupadasPorOutros,
  type Escolha,
  type EstadoEstimativa,
  type Modo,
} from "./regras";

export type Loja = { id: string; nome: string; dominio: string };

export interface Opcoes {
  neutralize: boolean;
  imageMode: "queue" | "none";
  genericizeText: boolean;
  instructions: string;
  translate: boolean;
  translateVariants: boolean;
  outputLanguage: string;
  inventoryTracked: boolean;
  inventoryQuantity: string;
}

const PAPEIS: Record<keyof Escolha, { rotulo: string; ajuda: (modo: Modo) => string }> = {
  origemCopia: {
    rotulo: "Copiar os produtos de",
    ajuda: () => "Uma loja de checkout sua que já tem os produtos sem marca.",
  },
  vitrine: {
    rotulo: "Vitrine",
    ajuda: () => "Recebe o tráfego do anúncio. O comprador põe no carrinho aqui.",
  },
  checkout: {
    rotulo: "Loja de checkout",
    ajuda: (modo) =>
      modo === "reuse"
        ? "A loja nova, que recebe a cópia dos produtos e cobra o comprador."
        : modo === "connect"
          ? "Já tem os produtos. É onde o comprador paga."
          : "Recebe os produtos criados a partir da vitrine e cobra o comprador.",
  },
};

function SeletorLoja({
  papel,
  modo,
  lojas,
  escolha,
  onEscolher,
}: {
  papel: keyof Escolha;
  modo: Modo;
  lojas: Loja[];
  escolha: Escolha;
  onEscolher: (papel: keyof Escolha, id: string) => void;
}) {
  const id = useId();
  const ocupadas = ocupadasPorOutros(papel, modo, escolha);
  const info = PAPEIS[papel];
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>{info.rotulo}</Label>
      <Select value={escolha[papel] || null} onValueChange={(v) => onEscolher(papel, typeof v === "string" ? v : "")}>
        <SelectTrigger id={id} aria-describedby={`${id}-ajuda`}>
          <SelectValue placeholder="Escolha uma loja">
            {(v: string | null) => lojas.find((l) => l.id === v)?.nome ?? "Escolha uma loja"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {lojas.map((l) => {
            const ocupada = ocupadas.includes(l.id);
            return (
              <SelectItem key={l.id} value={l.id} disabled={ocupada}>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{l.nome}</span>
                  <span className="truncate font-mono text-label text-t2">
                    {ocupada ? "já escolhida em outro papel" : l.dominio}
                  </span>
                </span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      <p id={`${id}-ajuda`} className="text-label text-t2">
        {info.ajuda(modo)}
      </p>
    </div>
  );
}

/** Uma linha de opcao com Switch, como nas opcoes do Importar. */
function LinhaOpcao({
  rotulo,
  descricao,
  ligado,
  onMudar,
  children,
}: {
  rotulo: string;
  descricao: string;
  ligado: boolean;
  onMudar: (v: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-border-subtle py-3 first:pt-0 last:border-b-0 last:pb-0">
      <Switch rotulo={rotulo} descricao={descricao} checked={ligado} onCheckedChange={onMudar} />
      {ligado && children ? <div className="flex flex-col gap-3 pl-12.5">{children}</div> : null}
    </div>
  );
}

export function PassoLojas({
  lojas,
  modo,
  onModo,
  escolha,
  onEscolher,
  opcoes,
  onOpcao,
  estimativa,
  problema,
  onComecar,
}: {
  lojas: Loja[];
  modo: Modo;
  onModo: (m: Modo) => void;
  escolha: Escolha;
  onEscolher: (papel: keyof Escolha, id: string) => void;
  opcoes: Opcoes;
  onOpcao: <K extends keyof Opcoes>(chave: K, valor: Opcoes[K]) => void;
  /** null = nao se aplica (sem recriar imagem). */
  estimativa: EstadoEstimativa | null;
  problema: string | null;
  onComecar: () => void;
}) {
  const idInstrucoes = useId();
  const idEstoque = useId();
  const idIdioma = useId();
  const falta = estimativa?.tipo === "falta";
  const papeis: (keyof Escolha)[] = modo === "reuse" ? ["origemCopia", "checkout", "vitrine"] : ["vitrine", "checkout"];

  return (
    <div className="flex flex-col gap-4">
      {lojas.length < 2 ? (
        <Callout tom="warn" titulo="Falta loja conectada" acao={<BotaoConectar variante="secondary">Conectar loja</BotaoConectar>}>
          Uma rota liga duas lojas Shopify: a vitrine e a loja de checkout. Você tem{" "}
          {lojas.length === 1 ? "1 loja conectada" : "nenhuma loja conectada"}.
        </Callout>
      ) : null}

      <Section titulo="Como montar a loja de checkout">
        <RadioGroup rotulo="Como montar a loja de checkout" arranjo="grade" valor={modo} onValor={onModo} opcoes={MODOS} />
      </Section>

      <Section titulo="Lojas" descricao="Cada loja tem um papel só. A mesma loja não pode ser vitrine e checkout.">
        <div className={papeis.length === 3 ? "grid gap-4 md:grid-cols-3" : "grid gap-4 md:grid-cols-2"}>
          {papeis.map((p) => (
            <SeletorLoja key={p} papel={p} modo={modo} lojas={lojas} escolha={escolha} onEscolher={onEscolher} />
          ))}
        </div>
      </Section>

      {modo === "generate" ? (
        <Section titulo="Como os produtos entram" descricao="Vale para todos os produtos criados nesta rota.">
          <div className="flex flex-col">
            <LinhaOpcao
              rotulo="Tirar a marca"
              descricao="Remove marcas do título, da descrição e, se você quiser, da imagem."
              ligado={opcoes.neutralize}
              onMudar={(v) => onOpcao("neutralize", v)}
            >
              <RadioGroup
                rotulo="Imagens"
                arranjo="grade"
                className="sm:grid-cols-2"
                valor={opcoes.imageMode}
                onValor={(v) => onOpcao("imageMode", v)}
                opcoes={[
                  {
                    valor: "queue",
                    titulo: "Recriar a imagem sem marca",
                    descricao: "Uma imagem por produto, trocada aos poucos depois que os produtos entram.",
                  },
                  {
                    valor: "none",
                    titulo: "Manter a imagem original",
                    descricao: "Mais rápido. Dá para refazer as imagens depois, pela própria rota.",
                  },
                ]}
              />
              <Switch
                rotulo="Trocar o nome por um genérico"
                descricao="Air Jordan vira Tênis esportivo."
                checked={opcoes.genericizeText}
                onCheckedChange={(v) => onOpcao("genericizeText", v)}
              />
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={idInstrucoes}>Instruções extras (opcional)</Label>
                <Textarea
                  id={idInstrucoes}
                  rows={2}
                  value={opcoes.instructions}
                  onChange={(e) => onOpcao("instructions", e.target.value)}
                  placeholder="Ex.: manter o escudo do time, remover só o selo do vendedor."
                  className="min-h-16 text-dense"
                />
              </div>
            </LinhaOpcao>
            <LinhaOpcao
              rotulo="Traduzir produto"
              descricao="Título e descrição no idioma escolhido abaixo."
              ligado={opcoes.translate}
              onMudar={(v) => onOpcao("translate", v)}
            />
            <LinhaOpcao
              rotulo="Traduzir variações"
              descricao="Cores e tamanhos no idioma escolhido abaixo (blue → azul, S → P)."
              ligado={opcoes.translateVariants}
              onMudar={(v) => onOpcao("translateVariants", v)}
            />
          </div>
          <div className="flex max-w-sm flex-col gap-1.5">
            <Label htmlFor={idIdioma}>Idioma dos produtos</Label>
            <Select value={opcoes.outputLanguage} onValueChange={(v) => onOpcao("outputLanguage", typeof v === "string" ? v : "pt-BR")}>
              <SelectTrigger id={idIdioma} aria-describedby={`${idIdioma}-ajuda`}>
                <SelectValue>{(v: string) => IDIOMAS.find((i) => i.valor === v)?.rotulo ?? v}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {IDIOMAS.map((i) => (
                  <SelectItem key={i.valor} value={i.valor}>
                    {i.rotulo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p id={`${idIdioma}-ajuda`} className="text-label text-t2">
              Título, descrição, tags e SEO saem neste idioma.
            </p>
          </div>
        </Section>
      ) : null}

      {modo !== "connect" ? (
        <Section titulo="Estoque">
          <Switch
            rotulo="Controlar estoque"
            descricao="Desligado, a Shopify vende sem limite de quantidade."
            checked={opcoes.inventoryTracked}
            onCheckedChange={(v) => onOpcao("inventoryTracked", v)}
          />
          {opcoes.inventoryTracked ? (
            <div className="flex max-w-40 flex-col gap-1.5 pl-12.5">
              <Label htmlFor={idEstoque}>Quantidade por variante</Label>
              <Input
                id={idEstoque}
                inputMode="numeric"
                value={opcoes.inventoryQuantity}
                onChange={(e) => onOpcao("inventoryQuantity", e.target.value)}
                className="num text-right"
              />
            </div>
          ) : null}
        </Section>
      ) : null}

      <div className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4">
        {estimativa ? (
          estimativa.tipo === "falta" ? (
            <Callout
              tom="err"
              titulo="Faltam créditos para recriar as imagens"
              acao={
                <Link href="/billing" className={buttonVariants({ variant: "secondary", size: "sm" })}>
                  Comprar créditos
                </Link>
              }
            >
              {estimativa.texto} Compre créditos ou escolha manter a imagem original.
            </Callout>
          ) : (
            <p aria-live="polite" className="text-dense text-t1">
              {estimativa.tipo === "calculando" ? "Calculando quantos produtos a vitrine tem…" : estimativa.texto}
            </p>
          )
        ) : null}
        {modo === "connect" ? (
          <p className="text-dense text-t1 text-pretty">
            O xcart casa as variantes das duas lojas pelo SKU. Se sobrar produto da vitrine sem par, ele cria esse
            produto na loja de checkout para a rota fechar.
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button size="lg" disabled={Boolean(problema) || falta} onClick={onComecar}>
            {modo === "connect"
              ? "Conectar pelo SKU e ativar"
              : modo === "reuse"
                ? "Copiar para a loja de checkout"
                : "Criar os produtos na loja de checkout"}
            <ArrowRightIcon aria-hidden />
          </Button>
          <Link
            href="/clone/routed-checkout"
            className="rounded-sm text-dense font-medium text-brand underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            Cancelar
          </Link>
          {problema ? (
            <span aria-live="polite" className="text-dense text-t2">
              {problema}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
