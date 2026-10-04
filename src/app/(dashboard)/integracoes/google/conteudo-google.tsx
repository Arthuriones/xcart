import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { CabecalhoPlataforma } from "../cabecalho-plataforma";
import type { DadosAnuncios } from "../dados-anuncios";
import { EnvioCompras } from "../envio-compras";
import { estadoScriptsGoogle, situacaoDaConta, type Estado } from "../regras";
import { TelaGoogle } from "./tela-google";

/** O conteudo de Google com os dados ja lidos (a page le; aqui so desenha). */
export function ConteudoGoogle({ d }: { d: DadosAnuncios }) {
  const estadoLeitura = estadoScriptsGoogle(d.daPlataforma.map((c) => situacaoDaConta(c, d.agoraMs, d.fuso)));
  // As conversoes saem do navegador, pela tag do Google: basta um AW- ativo.
  const estado: Estado = d.destinos.some((x) => x.ativo)
    ? { tom: "ok", texto: "Tag do Google ativa" }
    : { tom: "neutral", texto: "Não ligado" };

  return (
    <>
      <CabecalhoPlataforma
        titulo="Google Ads"
        estado={estado}
        dica="As conversões saem do navegador do comprador, pela tag do Google, com o AW- e os rótulos de cada conta cadastrados no Rastreamento."
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
