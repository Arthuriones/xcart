import { Suspense } from "react";
import { CREDIT_PACKS } from "@/lib/billing/plans";
import { lerAssinatura } from "@/lib/leitura/assinatura";
import { pacotesComPreco, situacaoDoPlano } from "@/components/billing/regras";
import { CabecalhoAssinatura } from "./cabecalho";
import { ComprarCreditos } from "./comprar-creditos";
import { ErroAssinatura } from "./erro-assinatura";
import { EsqueletoAssinatura } from "./esqueleto";
import { Historico } from "./historico";
import { SecaoCreditos } from "./secao-creditos";
import { SecaoPlano } from "./secao-plano";

export const dynamic = "force-dynamic";

/**
 * /billing: o plano, o saldo de creditos, a recarga por Pix e o historico.
 *
 * O cabecalho sai na hora; o resto vem de uma leitura so (perfil, uso do mes
 * e compras) no Suspense. Se o perfil nao vem, a tela diz que a leitura falhou
 * -- a antiga mostrava "Free" e 0 creditos. Os fluxos de pagamento (cartao,
 * Pix, cancelar) chamam as mesmas rotas, com os mesmos corpos.
 */
async function Conteudo() {
  const d = await lerAssinatura();
  if (!d.perfil) {
    console.error("[billing] perfil não veio", d.erros.perfil);
    return <ErroAssinatura detalhe={d.erros.perfil} />;
  }
  const perfil = d.perfil;
  const situacao = situacaoDoPlano(perfil, d.agora);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <SecaoPlano
          situacao={situacao}
          temDocumento={perfil.temDocumento}
          noBanco={{
            status: perfil.status,
            cancelaNoFim: perfil.cancelaNoFim,
            fimPeriodo: perfil.fimPeriodo,
            temAssinaturaCartao: perfil.temAssinaturaCartao,
          }}
        />
        <SecaoCreditos
          saldo={perfil.saldo}
          usadosNoMes={d.usadosNoMes}
          inicioDoMes={d.inicioDoMes}
          erroUso={d.erros.uso}
          pro={situacao.pro}
          forma={situacao.forma}
          cobrancaLigada={d.cobrancaDeCreditoLigada}
        />
      </div>
      <ComprarCreditos pacotes={pacotesComPreco(CREDIT_PACKS)} temDocumento={perfil.temDocumento} />
      <Historico compras={d.compras} erro={d.erros.compras} />
    </div>
  );
}

export default function BillingPage() {
  return (
    <>
      <CabecalhoAssinatura />
      <Suspense fallback={<EsqueletoAssinatura />}>
        <Conteudo />
      </Suspense>
    </>
  );
}
