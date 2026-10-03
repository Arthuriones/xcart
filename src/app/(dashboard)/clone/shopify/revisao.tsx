"use client";

import * as React from "react";
import Link from "next/link";
import { CircleCheckIcon, ImageIcon, InfoIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/components/ui/cn";
import { DetalheSuporte } from "./detalhe";
import type { EstadoLeitura } from "./passos-iniciais";
import {
  contar,
  inteiro,
  miniatura,
  situacaoCreditos,
  tirarHtml,
  type ErroNaTela,
  type Marcas,
  type ProdutoTransformado,
} from "./regras";

export interface EstadoPrevia {
  estado: EstadoLeitura;
  dados: ProdutoTransformado | null;
  erro: ErroNaTela | null;
  /** As opcoes mudaram depois de gerar: a previa e de antes. */
  velha: boolean;
}

export function PassoRevisao({
  linhas,
  escolhas,
  estimativa,
  saldo,
  cobrando,
  marcas,
  previa,
  gerarPrevia,
}: {
  linhas: { rotulo: string; valor: React.ReactNode }[];
  escolhas: string[];
  estimativa: number;
  saldo: number | null;
  cobrando: boolean;
  marcas: Marcas;
  previa: EstadoPrevia;
  gerarPrevia: () => void;
}) {
  const creditos = situacaoCreditos(estimativa, saldo, cobrando);

  return (
    <div className="flex flex-col gap-5">
      <dl className="overflow-hidden rounded-card border border-border">
        {linhas.map((l) => (
          <div
            key={l.rotulo}
            className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-border-subtle px-4 py-2.5 last:border-b-0"
          >
            <dt className="text-dense text-t2">{l.rotulo}</dt>
            <dd className="min-w-0 text-right text-dense font-medium break-words text-ink">{l.valor}</dd>
          </div>
        ))}
      </dl>

      <section aria-labelledby="imp-rev-opcoes" className="flex flex-col gap-2">
        <h3 id="imp-rev-opcoes" className="text-dense font-semibold text-ink">
          Opções
        </h3>
        <ul className="flex flex-wrap gap-1.5">
          {escolhas.map((e) => (
            <li key={e}>
              <Badge variant="outline">{e}</Badge>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="imp-rev-creditos" className="flex flex-col gap-3 rounded-card border border-border p-4">
        <h3 id="imp-rev-creditos" className="text-dense font-semibold text-ink">
          Créditos
        </h3>
        <dl className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-0.5">
            <dt className="text-label text-t2">Estimativa</dt>
            <dd className="num text-section text-ink">
              {estimativa === 0 ? "Nenhum" : `até ${contar(estimativa, "crédito", "créditos")}`}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-label text-t2">Seu saldo</dt>
            <dd className="num text-section text-ink">{saldo === null ? "—" : inteiro(saldo)}</dd>
          </div>
        </dl>
        {creditos.tom === "warn" ? (
          <Callout
            tom="warn"
            titulo={creditos.texto}
            acao={
              <Link href="/billing" className={buttonVariants({ variant: "secondary", size: "sm" })}>
                Comprar créditos
              </Link>
            }
          />
        ) : (
          <p className={cn("flex items-start gap-1.5 text-label", creditos.tom === "ok" ? "text-ok" : "text-t2")}>
            {creditos.tom === "ok" ? (
              <CircleCheckIcon aria-hidden className="mt-px size-3.5 shrink-0" />
            ) : (
              <InfoIcon aria-hidden className="mt-px size-3.5 shrink-0" />
            )}
            {creditos.texto}
          </p>
        )}
        {estimativa > 0 ? (
          <p className="text-label text-t2">
            Só a foto principal refeita com IA gasta crédito. Produto que já existe e é pulado não gasta.
          </p>
        ) : null}
      </section>

      <section aria-labelledby="imp-rev-previa" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <h3 id="imp-rev-previa" className="text-dense font-semibold text-ink">
              Conferir um produto antes
            </h3>
            <p className="text-label text-t2">
              Mostra o primeiro produto com as opções escolhidas. Nada é criado na loja.
            </p>
          </div>
          <Button variant="secondary" onClick={gerarPrevia} pending={previa.estado === "lendo"}>
            {previa.dados ? "Gerar de novo" : "Gerar prévia"}
          </Button>
        </div>
        <Previa previa={previa} marcas={marcas} />
      </section>
    </div>
  );
}

function Previa({ previa, marcas }: { previa: EstadoPrevia; marcas: Marcas }) {
  if (previa.estado === "lendo") {
    return (
      <div aria-busy="true" aria-label="Gerando a prévia" className="grid gap-3 sm:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="flex h-44 flex-col gap-3 rounded-card border border-border p-3">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="size-16 rounded-control" />
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ))}
      </div>
    );
  }
  if (previa.estado === "erro" && previa.erro) {
    return (
      <Callout tom="err" titulo="A prévia não saiu">
        <p>{previa.erro.texto}</p>
        <DetalheSuporte detalhe={previa.erro.detalhe} />
      </Callout>
    );
  }
  if (!previa.dados) return null;

  const d = previa.dados;
  const descricao = tirarHtml(d.transformed.descriptionHtml || "");
  const antes = d.source.images?.[0]?.src;
  const depois = d.transformed.images?.[0]?.src;

  return (
    <div className="flex flex-col gap-3">
      {previa.velha ? (
        <p className="text-label text-warn">As opções mudaram depois desta prévia. Gere de novo para conferir.</p>
      ) : null}
      <div className={cn("grid gap-3 sm:grid-cols-2", previa.velha && "opacity-70")}>
        <Lado rotulo="Antes" foto={antes} titulo={d.source.title} />
        <Lado
          rotulo="Depois"
          foto={depois}
          titulo={d.transformed.title}
          extra={
            <>
              <p className="line-clamp-3 text-label text-t1">{descricao || "Sem descrição."}</p>
              {d.transformed.tags.length > 0 ? (
                <ul className="flex flex-wrap gap-1">
                  {d.transformed.tags.slice(0, 6).map((t) => (
                    <li key={t}>
                      <Badge variant="neutral">{t}</Badge>
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="text-label text-t2">
                {contar(d.transformed.variants.length, "variação", "variações")} ·{" "}
                {contar(d.transformed.images.length, "imagem", "imagens")}
                {d.logoAppliedCount > 0 ? " · com a logo" : ""}
              </p>
            </>
          }
        />
      </div>
      {marcas !== "manter" ? (
        <p className="text-label text-t2">
          A foto principal é refeita depois, em segundo plano. Aqui aparece a foto original.
        </p>
      ) : null}
      {d.warnings.length > 0 ? (
        <Callout tom="warn" titulo={`${contar(d.warnings.length, "aviso", "avisos")} na prévia`}>
          A IA não conseguiu tudo neste produto. Na importação, o que falhar fica como na origem.
        </Callout>
      ) : null}
    </div>
  );
}

function Lado({
  rotulo,
  foto,
  titulo,
  extra,
}: {
  rotulo: string;
  foto: string | undefined;
  titulo: string;
  extra?: React.ReactNode;
}) {
  const src = miniatura(foto, 192);
  return (
    <figure className="flex min-w-0 flex-col gap-2 rounded-card border border-border p-3">
      <figcaption className="text-label font-semibold text-t2">{rotulo}</figcaption>
      <span className="grid size-24 place-items-center overflow-hidden rounded-control border border-border-subtle bg-surface-2">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" loading="lazy" width={96} height={96} className="size-full object-cover" />
        ) : (
          <ImageIcon aria-hidden className="size-5 text-t3" />
        )}
      </span>
      <p className="text-dense font-semibold text-ink">{titulo}</p>
      {extra}
    </figure>
  );
}
