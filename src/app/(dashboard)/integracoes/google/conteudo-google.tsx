import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { EmptyState } from "@/components/ui/empty-state";
import { CabecalhoPlataforma } from "../cabecalho-plataforma";
import type { DadosAnuncios } from "../dados-anuncios";
import { EnvioCompras } from "../envio-compras";
import { estadoScriptsGoogle, situacaoDaConta } from "../regras";
import { TelaGoogle } from "./tela-google";
import { CardPerfilGoogle } from "./card-perfil-google";

/** O conteudo de Google com os dados ja lidos (a page le; aqui so desenha). */
export function ConteudoGoogle({ d }: { d: DadosAnuncios }) {
  const temConexaoOAuth = (d.conexoes?.length ?? 0) > 0;
  const ligado = d.daPlataforma.length > 0 || temConexaoOAuth;
  const estadoLeitura = estadoScriptsGoogle(d.daPlataforma.map((c) => situacaoDaConta(c, d.agoraMs, d.fuso)));

  const textoEstado = temConexaoOAuth
    ? "Conectado · Login com Google"
    : d.daPlataforma.length > 0
      ? "Conectado · Modo manual"
      : "Não conectado";

  return (
    <>
      <CabecalhoPlataforma
        titulo="Google Ads"
        estado={ligado ? { tom: "ok", texto: textoEstado } : { tom: "neutral", texto: "Não conectado" }}
        dica="As conversões saem do navegador do comprador, pela tag do Google, com o AW- e os rótulos de cada conta cadastrados no Rastreamento."
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

      {d.lojas.length === 0 && d.checkouts.length === 0 ? (
        <EmptyState
          titulo="Conecte uma loja primeiro"
          descricao="O gasto de cada conta de anúncio entra no lucro de uma loja (ou de um checkout). Sem nenhum, não há onde ligar a conta."
          acao={
            <Link href="/stores?conectar=1" className={buttonVariants()}>
              Conectar loja
            </Link>
          }
        />
      ) : (
        <>
          {/* Card estilo UTMify: Conecte seus perfis por aqui / Conectar com Google */}
          <CardPerfilGoogle conexoesIniciais={d.conexoes} />

          <Callout tom="info" titulo="São identificadores diferentes.">
            O ID de cliente (123-456-7890) lê o gasto pelo script ou API; o AW- recebe as compras. Um não substitui o
            outro.
          </Callout>

          <TelaGoogle
            contas={d.contas}
            todas={d.daPlataforma.length}
            lojas={d.lojas}
            checkouts={d.checkouts}
            estadoLeitura={estadoLeitura}
            envio={<EnvioCompras plataforma="google" destinos={d.destinos} lojas={d.lojas} erro={d.erroDestinos} />}
            tabela={{
              gastos: d.gastos,
              erroGasto: d.erroGasto,
              fusosLoja: d.fusosLoja,
              erroFuso: d.erroFuso,
              lojaFiltrada: d.lojaFiltrada?.nome ?? null,
              agoraMs: d.agoraMs,
              fuso: d.fuso,
              moeda: d.moeda,
              periodo: d.periodo,
            }}
          />
        </>
      )}
    </>
  );
}
