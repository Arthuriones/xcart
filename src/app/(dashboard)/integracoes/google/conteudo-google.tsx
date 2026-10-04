import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { CabecalhoPlataforma } from "../cabecalho-plataforma";
import type { DadosAnuncios } from "../dados-anuncios";
import { EnvioCompras } from "../envio-compras";
import { usaDataManager } from "@/lib/tracking/google-url";
import { estadoScriptsGoogle, situacaoDaConta, type Estado } from "../regras";
import { EnvioDataManager, type DadosDataManager } from "./envio-data-manager";
import { TelaGoogle } from "./tela-google";

/** O conteudo de Google com os dados ja lidos (a page le; aqui so desenha). */
export function ConteudoGoogle({ d, dm }: { d: DadosAnuncios; dm: DadosDataManager }) {
  const estadoLeitura = estadoScriptsGoogle(d.daPlataforma.map((c) => situacaoDaConta(c, d.agoraMs, d.fuso)));
  // O foco desta tela e o envio de conversoes; o gasto pelo script e
  // secundario ate a API do Google aprovar o app.
  const apiPronta = dm.temCredencial && dm.destinos.some((x) => x.ativo && usaDataManager(x));
  const estado: Estado = apiPronta
    ? { tom: "ok", texto: "Conversões pela API" }
    : d.destinos.length > 0
      ? { tom: "warn", texto: "Falta configurar a API" }
      : { tom: "neutral", texto: "Não ligado" };

  return (
    <>
      <CabecalhoPlataforma
        titulo="Google Ads"
        estado={estado}
        dica="As conversões saem pela API do Google, com o ID de cliente (123-456-7890) e o ID de cada ação. O AW- identifica a conta no Rastreamento."
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
            dataManager={<EnvioDataManager dados={dm} lojas={d.lojas} />}
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
