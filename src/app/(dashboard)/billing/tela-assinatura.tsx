import { CREDIT_PACKS, PLANO_BASE, ehPlanoId } from "@/lib/billing/plans";
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
export function TelaAssinatura({ d, querComprar = false }: { d: LeituraAssinatura; querComprar?: boolean }) {
  if (!d.perfil) return <ErroAssinatura detalhe={d.erros.perfil} />;
  const perfil = d.perfil;
  const situacao = situacaoDoPlano(perfil, d.agora);
  // As fotos com IA se gastam no roteamento e na importacao com troca de
  // marca: quem so rastreia ve uma linha, sem saldo nem compra. Mostra tudo com
  // rota, com uso no mes, com compra de fotos no historico ou vindo de um
  // "Comprar fotos" (?comprar=1). Saldo NAO entra: a renovacao soma (082), e
  // todo Pro passa de 20 no segundo mes.
  const comprouFotos = (d.compras ?? []).some((c) => c.kind === "credits" && c.status === "paid");
  const comFotos = d.temRota || (d.usadosNoMes ?? 0) > 0 || comprouFotos || querComprar;

  const plano = (
    <SecaoPlano
      situacao={situacao}
      temDocumento={perfil.temDocumento}
      uso={d.uso}
      // Plano anterior (fora da venda) renova nele mesmo, pelo mesmo preco;
      // o Pro antigo (sem tier), no 1 Loja, que tem os mesmos limites.
      planoAtual={ehPlanoId(perfil.tier) ? perfil.tier : PLANO_BASE}
      noBanco={{
        status: perfil.status,
        cancelaNoFim: perfil.cancelaNoFim,
        fimPeriodo: perfil.fimPeriodo,
        temAssinaturaCartao: perfil.temAssinaturaCartao,
      }}
    />
  );

  if (!comFotos) {
    return (
      <div className="flex flex-col gap-4">
        {plano}
        <p className="text-label text-t2">
          Fotos com IA: {perfil.saldo.toLocaleString("pt-BR")} {perfil.saldo === 1 ? "disponível" : "disponíveis"}.
          Usadas para tirar a marca das fotos no roteamento e na importação.
        </p>
        <Historico compras={d.compras} erro={d.erros.compras} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {plano}
        <SecaoCreditos
          saldo={perfil.saldo}
          usadosNoMes={d.usadosNoMes}
          inicioDoMes={d.inicioDoMes}
          erroUso={d.erros.uso}
          pro={situacao.pro}
          cobrancaLigada={d.cobrancaDeCreditoLigada}
        />
      </div>
      <ComprarCreditos pacotes={pacotesComPreco(CREDIT_PACKS)} temDocumento={perfil.temDocumento} />
      <Historico compras={d.compras} erro={d.erros.compras} />
    </div>
  );
}
