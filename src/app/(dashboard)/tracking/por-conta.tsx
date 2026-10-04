"use client";

import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { Dica } from "@/components/ui/dica";
import { Section } from "@/components/ui/section";
import { STATUS, StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import type { DestinoNaTela, LojaTracking } from "@/lib/tracking/queries";
import type { ChaveEvento } from "@/lib/tracking/eventos";
import { EVENTOS_DATA_MANAGER } from "@/lib/tracking/google-url";
import {
  EVENTOS_DA_GRADE,
  NOME_CURTO,
  comprasQueOMetaDiz,
  contasDaTela,
  formatarInteiro,
  testesNaTela,
  type LinhaConta,
} from "./resumo";
import { ROTULO_EVENTO, emModoTeste, numerosDoEvento, plural, type NumerosEvento } from "./saude";

// ============================================================================
// "Por conta": o que cada conta recebeu em 7 dias, evento a evento.
//
// O numero grande e o DE ANUNCIO -- com clique e sem teste --, o que se compara
// com o Gerenciador. O total enviado fica embaixo, em cinza. A falha nunca vai
// para o cinza: aparece em vermelho, com o numero e o motivo.
//
// Uma linha por CONTA, nunca por plataforma: as 2 contas Google da Softnook
// recebem o mesmo evento, e somadas dobrariam o numero.
// ============================================================================

/** O motivo da falha, sem deixar uma resposta de 2 KB tomar a tela. */
function curto(texto: string, max = 220): string {
  return texto.length > max ? `${texto.slice(0, max - 1)}…` : texto;
}

/**
 * Por que o destino nao manda este evento, para a caixa da grade. Pela Data
 * Manager so compra, carrinho e checkout tem acao: os outros "nao se aplicam"
 * -- nao ha o que configurar, entao `resolve` e false e a caixa nao fica
 * amarela.
 */
export function semEnvioDoEvento(
  d: Pick<DestinoNaTela, "acoes">,
  chave: ChaveEvento
): { texto: string; resolve: boolean } {
  if (!d.acoes) return { texto: "sem rótulo", resolve: true };
  return (EVENTOS_DATA_MANAGER as readonly string[]).includes(chave)
    ? { texto: "sem ação", resolve: true }
    : { texto: "não se aplica", resolve: false };
}

/**
 * Os numeros de um evento: de anuncio em destaque, total em cinza, falha em
 * vermelho. Leitura que falhou e "—", nunca zero.
 */
export function ValorDoEvento({
  n,
  semContagem,
  grande = false,
  extra,
  semEnvio = "sem rótulo",
}: {
  n: NumerosEvento;
  /** O texto quando o destino nao manda o evento. Ver `semEnvioDoEvento`. */
  semEnvio?: string;
  /** A contagem da fila falhou nesta carga. */
  semContagem: boolean;
  grande?: boolean;
  /** Linha a mais embaixo (ex.: o que o Meta diz). */
  extra?: ReactNode;
}) {
  const valor = cn("num text-ink", grande ? "text-page" : "text-section");
  // Neutro: no Google, deixar um evento sem rotulo pode ser escolha. O cartao
  // do destino pinta a caixa de amarelo quando isso e o que falta.
  if (!n.envia) {
    return <span className="text-dense text-t2">{semEnvio}</span>;
  }
  if (semContagem) {
    return (
      <>
        <span className={valor}>—</span>
        <span className="text-label text-t2">sem contagem agora</span>
      </>
    );
  }
  return (
    <>
      <span className={valor}>
        {n.deAnuncio === null ? "—" : formatarInteiro(n.deAnuncio)}
        <span className="sr-only"> de anúncio</span>
      </span>
      <span className="num text-label text-t2">de {formatarInteiro(n.total)} registrados</span>
      {n.falhas > 0 && (
        <span className="num text-label font-semibold text-err">
          {n.falhas === 1 ? "1 falhou" : `${formatarInteiro(n.falhas)} falharam`}
        </span>
      )}
      {extra}
    </>
  );
}

function LinhaDaConta({
  linha,
  mostrarTestes,
  comLoja,
}: {
  linha: LinhaConta;
  mostrarTestes: boolean;
  comLoja: boolean;
}) {
  const { loja, destino } = linha;
  const c = destino.contagem;
  const metaDiz = comprasQueOMetaDiz(linha);
  // Sem apelido, a conta ja e o titulo: nao repete embaixo.
  const sub = [comLoja ? loja.nome : null, destino.nome ? destino.conta : null].filter(Boolean);

  return (
    <li className="grid grid-cols-2 gap-x-4 gap-y-3 border-b border-border-subtle p-4 last:border-b-0 md:grid-cols-[minmax(180px,1.4fr)_repeat(4,minmax(0,1fr))] md:gap-5">
      <div className="col-span-2 flex min-w-0 flex-col gap-0.5 md:col-span-1">
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="shrink-0 rounded-sm border border-border-strong px-1.5 text-label font-semibold text-t1">
            {NOME_CURTO[destino.plataforma]}
          </span>
          <span className="min-w-0 truncate text-dense font-semibold text-ink">
            {destino.nome || destino.conta}
          </span>
          {emModoTeste(destino) && <StatusBadge {...STATUS.destino.modoTeste} />}
        </span>
        {sub.length > 0 && <span className="truncate text-label text-t2">{sub.join(" · ")}</span>}
      </div>

      {EVENTOS_DA_GRADE.map((chave) => (
        <div key={chave} className="flex min-w-0 flex-col gap-0.5">
          <span className="text-label text-t1 md:sr-only">{ROTULO_EVENTO[chave]}</span>
          <ValorDoEvento
            n={numerosDoEvento(destino, chave, mostrarTestes)}
            semContagem={loja.contagemIndisponivel}
            semEnvio={semEnvioDoEvento(destino, chave).texto}
            grande
            extra={
              chave === "purchase" && metaDiz !== null ? (
                <span className="num text-label text-t2">
                  o Meta diz {formatarInteiro(metaDiz)}
                </span>
              ) : null
            }
          />
        </div>
      ))}

      {c.falharam > 0 && (
        <p className="col-span-2 flex items-start gap-1.5 text-label text-err md:col-span-5">
          <CircleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
          <span className="min-w-0 [overflow-wrap:anywhere]">
            {plural(c.falharam, "envio falhou", "envios falharam")} em 7 dias
            {c.ultimoErro ? `: “${curto(c.ultimoErro)}”` : ". A plataforma não disse o motivo."}
          </span>
        </p>
      )}
    </li>
  );
}

export function PorConta({
  lojas,
  mostrarTestes,
  onMostrarTestes,
}: {
  lojas: LojaTracking[];
  mostrarTestes: boolean;
  onMostrarTestes: (v: boolean) => void;
}) {
  const contas = contasDaTela(lojas);
  if (contas.length === 0) return null;
  const testes = testesNaTela(contas);
  const comLoja = new Set(contas.map((c) => c.loja.storeId)).size > 1;

  return (
    <Section
      titulo="Por conta"
      descricao={
        <span className="inline-flex flex-wrap items-center gap-x-1">
          Em destaque, de anúncio · em cinza, o total enviado · últimos 7 dias
          <Dica rotulo="Por que não bate exatamente com o Gerenciador">
            De anúncio é o evento com clique de anúncio, sem testes: aproxima o Gerenciador, mas
            não iguala. O Google conta pela data do clique, e Carrinho e Checkout secundários só
            aparecem em “Todas as conv.”. O Meta conta até 7 dias depois do clique e 1 dia
            depois da visualização, inclusive sem clique. Teste é a visita pelo link com
            ?xcart_teste=1 ou o clique com TESTE no identificador.
          </Dica>
        </span>
      }
      espaco="nenhum"
      acoes={
        testes > 0 || mostrarTestes ? (
          <Switch
            rotulo={`Mostrar testes (${formatarInteiro(testes)})`}
            checked={mostrarTestes}
            onCheckedChange={onMostrarTestes}
          />
        ) : undefined
      }
    >
      <div
        aria-hidden
        className="hidden grid-cols-[minmax(180px,1.4fr)_repeat(4,minmax(0,1fr))] gap-5 border-y border-border bg-surface-2 px-4 py-2.5 text-label font-semibold text-t1 md:grid"
      >
        <span>Conta</span>
        {EVENTOS_DA_GRADE.map((chave) => (
          <span key={chave}>{ROTULO_EVENTO[chave]}</span>
        ))}
      </div>
      <ul className="border-t border-border md:border-t-0">
        {contas.map((linha) => (
          <LinhaDaConta
            key={linha.destino.id}
            linha={linha}
            mostrarTestes={mostrarTestes}
            comLoja={comLoja}
          />
        ))}
      </ul>
    </Section>
  );
}
