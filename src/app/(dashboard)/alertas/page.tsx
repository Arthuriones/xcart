import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Callout } from "@/components/ui/callout";
import { lerAlertas } from "@/lib/leitura/alertas";
import { FUSO_RELATORIO_PADRAO, ROTULO_REGRA } from "@/lib/financeiro/tipos";
import { TELA_NOTIFICACOES, abaDe, destinoDoAlerta, nomeDaLoja } from "./apresentar";
import { CabecalhoAlertas } from "./cabecalho";
import { EsqueletoAlertas } from "./esqueleto";
import { SecaoResolvidos } from "./secao-resolvidos";
import { TelaAlertas, type AlertaNaTela } from "./tela-alertas";

export const dynamic = "force-dynamic";

/**
 * /alertas: o que esta quebrado agora e o que fechou em 7 dias. So le banco
 * (alertas, config, lojas); fica no Suspense para o cabecalho aparecer na hora.
 *
 * A aba vem de ?aba= e e lida no cliente (tela-alertas.tsx): trocar de aba
 * nao volta ao servidor. Link antigo para ?aba=regras ou ?aba=canal vai para
 * Notificacoes, onde as regras e o Telegram estao agora.
 */
async function Conteudo() {
  const d = await lerAlertas();

  const fuso = FUSO_RELATORIO_PADRAO;
  const lojasIndisponiveis = !!d.erros.lojas;
  const doUsuario = new Set(d.lojas.map((l) => l.id));

  const abertos: AlertaNaTela[] = d.abertos.map((a) => {
    const lojaId = a.store_id && doUsuario.has(a.store_id) ? a.store_id : null;
    return {
      id: a.id,
      severidade: a.severidade === "critico" ? "critico" : "aviso",
      regraRotulo: ROTULO_REGRA[a.regra] ?? "Alerta",
      titulo: a.titulo,
      detalhe: a.detalhe,
      loja: nomeDaLoja(a.store_id, d.lojas, lojasIndisponiveis),
      lojaId,
      aberto_em: a.aberto_em,
      confirmado_em: a.confirmado_em,
      silenciado_ate: a.silenciado_ate,
      n_notificacoes: Number(a.n_notificacoes) || 0,
      destino: destinoDoAlerta(a.regra, a.titulo, lojaId),
    };
  });

  const telegramPronto =
    !d.erros.config && !!d.config.telegram_chat_id && d.temToken && d.config.ativo;

  return (
    <div className="flex flex-col gap-4">
      {lojasIndisponiveis && (
        <Callout tom="warn" titulo="Os nomes das lojas não vieram">
          Os alertas aparecem sem o nome da loja. Atualize a tela para tentar de novo.
        </Callout>
      )}
      <TelaAlertas
        abertos={abertos}
        erroAbertos={d.erros.abertos}
        agora={d.agora}
        fuso={fuso}
        lojaAtual={d.lojaId}
        telegramPronto={telegramPronto}
        nResolvidos={d.erros.resolvidos ? null : d.resolvidos.length}
        resolvidos={
          <SecaoResolvidos
            resolvidos={d.resolvidos}
            lojas={d.lojas}
            lojasIndisponiveis={lojasIndisponiveis}
            fuso={fuso}
            erro={d.erros.resolvidos}
          />
        }
      />
    </div>
  );
}

export default async function AlertasPage({
  searchParams,
}: {
  searchParams: Promise<{ [chave: string]: string | string[] | undefined }>;
}) {
  const aba = abaDe((await searchParams).aba);
  if (aba === "regras" || aba === "canal") redirect(TELA_NOTIFICACOES);
  return (
    <>
      <CabecalhoAlertas />
      <Suspense fallback={<EsqueletoAlertas />}>
        <Conteudo />
      </Suspense>
    </>
  );
}
