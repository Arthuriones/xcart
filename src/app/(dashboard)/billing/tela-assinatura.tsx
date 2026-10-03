import { CREDIT_PACKS } from "@/lib/billing/plans";
import type { LeituraAssinatura } from "@/lib/leitura/assinatura";
import { pacotesComPreco, situacaoDoPlano } from "@/components/billing/regras";
import { ComprarCreditos } from "./comprar-creditos";
import { ErroAssinatura } from "./erro-assinatura";
import { Historico } from "./historico";
import { SecaoCreditos } from "./secao-creditos";
import { SecaoPlano } from "./secao-plano";

/**
 * A tela com os dados ja lidos (a pagina so le e passa para ca). Sem perfil,
 * o estado de erro -- nunca "Free com 0 creditos".
 */
export function TelaAssinatura({ d }: { d: LeituraAssinatura }) {
  if (!d.perfil) return <ErroAssinatura detalhe={d.erros.perfil} />;
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
