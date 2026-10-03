import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { EmptyState } from "@/components/ui/empty-state";
import { CabecalhoPlataforma } from "../cabecalho-plataforma";
import type { DadosAnuncios } from "../dados-anuncios";
import { EnvioCompras } from "../envio-compras";
import { estadoScriptsGoogle, situacaoDaConta } from "../regras";
import { TelaGoogle } from "./tela-google";

/** O conteudo de Google com os dados ja lidos (a page le; aqui so desenha). */
export function ConteudoGoogle({ d }: { d: DadosAnuncios }) {
  const ligado = d.daPlataforma.length > 0;
  const estadoLeitura = estadoScriptsGoogle(d.daPlataforma.map((c) => situacaoDaConta(c, d.agoraMs, d.fuso)));

  return (
    <>
      <CabecalhoPlataforma
        titulo="Google Ads"
        estado={ligado ? { tom: "ok", texto: "Conectado · modo manual" } : { tom: "neutral", texto: "Não ligado" }}
        login="Conectar com Google"
        nota="Quando o Google liberar a API para o xcart, o script vira leitura automática a cada 15 minutos, sem colar nada."
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
      ) : (
        <>
          <Callout tom="info" titulo="São identificadores diferentes.">
            O ID de cliente (123-456-7890) lê o gasto pelo script; o AW- recebe as compras. Um não substitui o
            outro.
          </Callout>
          <TelaGoogle
            contas={d.contas}
            todas={d.daPlataforma.length}
            lojas={d.lojas}
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
