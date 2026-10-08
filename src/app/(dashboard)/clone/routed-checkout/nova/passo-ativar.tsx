"use client";

import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Section } from "@/components/ui/section";
import { Spinner } from "@/components/ui/spinner";
import { CodigoManual, Instalador } from "../instalar";
import { codigoDoScript, hrefRota } from "../logica";
import { Progresso } from "@/components/routed-checkout/cartoes";

export interface DiagnosticoRota {
  coveragePercent: number;
  missingSkuCount: number;
  duplicateSkuCount: number;
  duplicateSkus: string[];
  warnings: string[];
  stampedSkuCount: number;
  dedupedSkuCount: number;
  safeToEnable: boolean;
}

export interface FilaImagens {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  total: number;
}

function plural(n: number, um: string, varios: string) {
  return `${n.toLocaleString("pt-BR")} ${n === 1 ? um : varios}`;
}

/** Passo final: o resultado da rota, ligar mesmo assim, instalar na vitrine e as imagens. */
export function PassoAtivar({
  ativando,
  completando,
  rota,
  ligacoes,
  diagnostico,
  criadosNoConserto,
  ligando,
  erroLigar,
  onLigarMesmoAssim,
  origem,
  imagens,
  imagensPct,
  imagensRodando,
  oferecerRefazerImagens,
  onRefazerImagens,
}: {
  ativando: boolean;
  completando: boolean;
  rota: { id: string; token: string; nome: string } | null;
  ligacoes: number;
  diagnostico: DiagnosticoRota | null;
  criadosNoConserto: { produtos: number; variantes: number } | null;
  ligando: boolean;
  erroLigar: string | null;
  onLigarMesmoAssim: () => void;
  origem: string;
  imagens: FilaImagens | null;
  imagensPct: number;
  imagensRodando: boolean;
  oferecerRefazerImagens: boolean;
  onRefazerImagens: () => void;
}) {
  if (ativando && !rota) {
    return (
      <Section titulo="Ativando a rota" aria-busy="true">
        <p className="flex items-center gap-2 text-dense text-t1" aria-live="polite">
          <Spinner size={14} />
          Casando as variantes das duas lojas pelo SKU…
        </p>
      </Section>
    );
  }
  if (!rota) return null;

  const pausada = diagnostico ? !diagnostico.safeToEnable : false;
  const avisos = diagnostico?.warnings ?? [];

  return (
    <div className="flex flex-col gap-4">
      {completando ? (
        <Section titulo="Completando a loja de checkout" aria-busy="true">
          <p className="flex items-center gap-2 text-dense text-t1" aria-live="polite">
            <Spinner size={14} />
            Criando na loja de checkout os produtos que faltavam para a rota fechar 100%…
          </p>
        </Section>
      ) : null}

      {!completando ? (
        pausada ? (
          <Callout
            tom="err"
            titulo={`Rota “${rota.nome}” criada pausada: só ${diagnostico?.coveragePercent ?? 0}% das variantes casaram`}
            acao={
              <Button variant="secondary" size="sm" pending={ligando} onClick={onLigarMesmoAssim}>
                Ligar mesmo assim
              </Button>
            }
          >
            <ListaAvisos avisos={avisos} />
            <p className="mt-1">
              {diagnostico && diagnostico.missingSkuCount > 0
                ? "Preencha o SKU das variantes da vitrine e rode o assistente de novo: a rota casa só pelo SKU."
                : "Confira os produtos apontados acima antes de mandar tráfego."}
            </p>
            {erroLigar ? <p className="mt-1 font-medium text-err">{erroLigar}</p> : null}
          </Callout>
        ) : avisos.length > 0 ? (
          <Callout
            tom="warn"
            titulo={
              diagnostico && diagnostico.coveragePercent < 100
                ? `Rota “${rota.nome}” ligada, com ${diagnostico.coveragePercent}% de cobertura`
                : `Rota “${rota.nome}” ligada: confira os pontos abaixo`
            }
          >
            <ListaAvisos avisos={avisos} />
          </Callout>
        ) : (
          <Callout tom="ok" titulo={`Rota “${rota.nome}” criada`}>
            {plural(ligacoes, "variante ligada", "variantes ligadas")} pelo SKU. Falta só instalar o script na vitrine.
          </Callout>
        )
      ) : null}

      {criadosNoConserto && (criadosNoConserto.produtos > 0 || criadosNoConserto.variantes > 0) ? (
        <Callout tom="info" titulo="O xcart completou a loja de checkout">
          {plural(criadosNoConserto.produtos, "produto criado", "produtos criados")} e{" "}
          {plural(criadosNoConserto.variantes, "variante criada", "variantes criadas")} para os itens da vitrine que
          estavam sem par.
        </Callout>
      ) : null}

      {diagnostico && (diagnostico.stampedSkuCount > 0 || diagnostico.dedupedSkuCount > 0) ? (
        <Callout tom="info" titulo="SKUs corrigidos na vitrine">
          {diagnostico.stampedSkuCount > 0 ? (
            <p>
              {plural(diagnostico.stampedSkuCount, "variante estava", "variantes estavam")} sem SKU (produto criado à mão
              na Shopify). O xcart gerou e gravou o SKU.
            </p>
          ) : null}
          {diagnostico.dedupedSkuCount > 0 ? (
            <p>
              {plural(diagnostico.dedupedSkuCount, "variante usava", "variantes usavam")} um SKU repetido, que mandaria o
              comprador para o produto errado. Cada uma ganhou um SKU próprio.
            </p>
          ) : null}
        </Callout>
      ) : null}

      {diagnostico && diagnostico.duplicateSkus.length > 0 ? (
        <p className="text-label text-t2">
          SKUs repetidos: <span className="font-mono">{diagnostico.duplicateSkus.join(", ")}</span>
          {diagnostico.duplicateSkuCount > diagnostico.duplicateSkus.length
            ? ` e mais ${diagnostico.duplicateSkuCount - diagnostico.duplicateSkus.length}`
            : ""}
        </p>
      ) : null}

      <Section
        titulo="Instalar na vitrine"
        descricao="Sem o script no tema da vitrine, a rota não leva ninguém ao checkout. O xcart instala sozinho."
      >
        {pausada ? (
          // Instalar com a rota pausada trava o checkout da vitrine (o
          // servidor recusa). O botao volta quando a rota liga.
          <p className="text-dense text-t1 text-pretty">
            Ligue a rota antes de instalar. Com ela pausada, o script trava o checkout da vitrine em vez de levar o
            comprador à loja de checkout.
          </p>
        ) : rota.id ? (
          <Instalador rotaId={rota.id} token={rota.token} origem={origem} />
        ) : (
          <CodigoManual codigo={codigoDoScript(origem, rota.token)} />
        )}
      </Section>

      {imagens && imagens.total > 0 ? (
        <Section titulo="Imagens sem marca" descricao="Seguem trocando no servidor: você pode sair desta página.">
          <Progresso valor={imagensPct} rotulo="Imagens trocadas" />
          <p className="text-dense text-t1" aria-live="polite">
            {imagens.completed.toLocaleString("pt-BR")} de {imagens.total.toLocaleString("pt-BR")} trocadas
            {imagens.failed > 0 ? ` · ${plural(imagens.failed, "falhou", "falharam")}` : ""}
            {imagensRodando ? " · em andamento" : " · concluído"}
          </p>
        </Section>
      ) : null}

      {oferecerRefazerImagens ? (
        <Section titulo="Imagens" descricao="Você manteve as imagens originais. Quando quiser, refaça sem marca.">
          <Button variant="secondary" className="self-start" onClick={onRefazerImagens}>
            Refazer imagens sem marca
          </Button>
        </Section>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Link href={rota.id ? hrefRota(rota.id) : "/clone/routed-checkout"} className={buttonVariants({ variant: "primary", size: "lg" })}>
          Ver a rota
        </Link>
        <Link
          href={rota.id ? hrefRota(rota.id, "diagnostico") : "/clone/routed-checkout"}
          className="rounded-sm text-dense font-medium text-brand underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          Testar a rota
        </Link>
      </div>
    </div>
  );
}

function ListaAvisos({ avisos }: { avisos: string[] }) {
  if (avisos.length === 0) return null;
  return (
    <ul className="flex list-disc flex-col gap-0.5 pl-4">
      {avisos.map((a) => (
        <li key={a}>{a}</li>
      ))}
    </ul>
  );
}
