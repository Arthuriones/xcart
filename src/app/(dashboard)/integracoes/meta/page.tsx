import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { EmptyState } from "@/components/ui/empty-state";
import { CabecalhoPlataforma } from "../cabecalho-plataforma";
import { ContasTabela } from "../contas-tabela";
import { carregarAnuncios } from "../dados-anuncios";
import { EnvioCompras } from "../envio-compras";
import { ErroLeitura } from "../erro-leitura";
import { estadoTokenMeta } from "../regras";
import { AssistenteMeta, CartaoTokenMeta } from "./token-meta";

export const dynamic = "force-dynamic";

// ============================================================================
// Integracoes -> Meta. Lado a lado o que LE o gasto (token de leitura, por
// conta de anuncio) e o que ENVIA as compras (token de conversoes, por pixel,
// configurado em Saude dos pixels). Embaixo, as contas com loja, gasto e
// situacao. Era a metade Meta de /financeiro/anuncios.
// ============================================================================

const NOTA_LOGIN = "Até lá, o caminho é o modo manual: um token de leitura colado aqui.";

export default async function MetaPage() {
  const r = await carregarAnuncios("meta");
  if (!r.ok) {
    return (
      <>
        <CabecalhoPlataforma titulo="Meta Ads" estado={{ tom: "neutral", texto: "Sem leitura" }} />
        <ErroLeitura titulo="Não deu para carregar as contas do Meta." detalhe={r.erro} />
      </>
    );
  }
  const d = r.dados;
  const ligado = d.daPlataforma.length > 0;

  return (
    <>
      <CabecalhoPlataforma
        titulo="Meta Ads"
        estado={ligado ? { tom: "ok", texto: "Conectado · modo manual" } : { tom: "neutral", texto: "Não ligado" }}
        login="Conectar com Facebook"
        nota={NOTA_LOGIN}
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
          <Callout tom="info" titulo="São duas permissões diferentes.">
            A de leitura só vê quanto você gastou; a de conversões só envia as compras ao pixel. Uma não
            substitui a outra.
          </Callout>
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
