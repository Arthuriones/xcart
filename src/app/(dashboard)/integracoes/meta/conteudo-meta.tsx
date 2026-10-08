import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { CabecalhoPlataforma } from "../cabecalho-plataforma";
import { ContasTabela } from "../contas-tabela";
import type { DadosAnuncios } from "../dados-anuncios";
import { EnvioCompras } from "../envio-compras";
import { estadoTokenMeta } from "../regras";
import { Callout } from "@/components/ui/callout";
import { CardPerfilMeta } from "./card-perfil-meta";

/** O conteudo de Meta com os dados ja lidos (a page le; aqui so desenha). */
export function ConteudoMeta({ d }: { d: DadosAnuncios }) {
  const temConexaoOAuth = (d.conexoes?.length ?? 0) > 0;
  const temContas = d.daPlataforma.length > 0;
  const ligado = temConexaoOAuth || temContas;

  const textoEstado = temConexaoOAuth
    ? "Conectado · Login com Facebook"
    : temContas
      ? "Conectado · Modo manual"
      : "Não conectado";

  return (
    <>
      <CabecalhoPlataforma
        titulo="Meta Ads"
        estado={ligado ? { tom: "ok", texto: textoEstado } : { tom: "neutral", texto: "Não conectado" }}
        dica={
          ligado
            ? "São duas permissões diferentes: a de leitura só vê quanto você gastou; a de conversões só envia as compras ao pixel. Uma não substitui a outra."
            : undefined
        }
        acao={
          <Link
            href="/campanhas"
            className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-t1 hover:bg-surface-2 hover:text-ink transition w-fit"
          >
            <span>Ver campanhas</span>
            <span aria-hidden="true">&rarr;</span>
          </Link>
        }
      />

      {d.lojas.length === 0 ? (
        <EmptyState
          titulo="Conecte uma loja primeiro"
          descricao="O gasto de cada conta de anúncio entra no lucro de uma loja. Sem loja, não há onde ligar a conta."
          acao={
            <Link href="/stores?conectar=1" className={buttonVariants()}>
              Conectar loja
            </Link>
          }
        />
      ) : (
        <>
          {/* Card estilo UTMify: Conecte seus perfis por aqui / Adicionar perfil */}
          <CardPerfilMeta
            conexoesIniciais={d.conexoes}
            contasCount={d.daPlataforma.length}
            estadoToken={estadoTokenMeta(d.daPlataforma)}
            temContasPlataforma={temContas}
          />

          <Callout tom="info" titulo="São duas permissões diferentes.">
            A de leitura só vê quanto você gastou; a de conversões só envia as compras ao pixel. Uma não
            substitui a outra.
          </Callout>

          {/* Envio de compras ao Pixel / CAPI */}
          <EnvioCompras plataforma="meta" destinos={d.destinos} lojas={d.lojas} erro={d.erroDestinos} />

          {/* Tabela de contas de anuncio para vincular as lojas */}
          {temContas && (
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
          )}
        </>
      )}
    </>
  );
}
