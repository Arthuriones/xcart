import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { CabecalhoPlataforma } from "../cabecalho-plataforma";
import { ContasTabela } from "../contas-tabela";
import type { DadosAnuncios } from "../dados-anuncios";
import { EnvioCompras } from "../envio-compras";
import { estadoTokenMeta } from "../regras";
import { AssistenteMeta, CartaoTokenMeta } from "./token-meta";

/** O conteudo de Meta com os dados ja lidos (a page le; aqui so desenha). */
export function ConteudoMeta({ d }: { d: DadosAnuncios }) {
  const ligado = d.daPlataforma.length > 0;
  return (
    <>
      <CabecalhoPlataforma
        titulo="Meta Ads"
        estado={ligado ? { tom: "ok", texto: "Conectado · modo manual" } : { tom: "neutral", texto: "Não ligado" }}
        dica={
          ligado
            ? "São duas permissões diferentes: a de leitura só vê quanto você gastou; a de conversões só envia as compras ao pixel. Uma não substitui a outra."
            : undefined
        }
      />

      {d.lojas.length === 0 ? (
        <EmptyState
          titulo="Conecte uma loja primeiro"
          descricao="O gasto de cada conta de anúncio entra no lucro de uma loja. Sem loja, não há onde ligar a conta."
          acao={
            <Link href="/stores" className={buttonVariants()}>
              Conectar loja
            </Link>
          }
        />
      ) : !ligado ? (
        <AssistenteMeta />
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <CartaoTokenMeta estado={estadoTokenMeta(d.daPlataforma)} contas={d.daPlataforma.length} />
            <EnvioCompras plataforma="meta" destinos={d.destinos} lojas={d.lojas} erro={d.erroDestinos} />
          </div>
          <ContasTabela
            plataforma="meta"
            contas={d.contas}
            lojas={d.lojas}
            gastos={d.gastos}
            erroGasto={d.erroGasto}
            fusosLoja={d.fusosLoja}
            erroFuso={d.erroFuso}
            lojaFiltrada={d.lojaFiltrada?.nome ?? null}
            agoraMs={d.agoraMs}
            fuso={d.fuso}
            moeda={d.moeda}
            periodo={d.periodo}
          />
        </>
      )}
    </>
  );
}
