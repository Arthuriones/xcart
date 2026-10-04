"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronDown } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Segmented } from "@/components/ui/segmented";
import { StatusBadge, type TomStatus } from "@/components/ui/status-badge";
import { cn } from "@/components/ui/cn";
import { gravarCookie } from "@/components/layout/contexto";
import {
  COOKIE_GUIA_CAMINHO,
  COOKIE_GUIA_DISPENSADO,
  ROTULO_CAMINHO,
  porcentagem,
  type CaminhoGuia,
  type EstadoPasso,
  type Guia,
  type IdPasso,
  type PassoGuia,
} from "@/lib/leitura/guia-passos";

// ============================================================================
// O guia na tela: a barra "X de N" e os passos, cada um abrindo o que fazer
// e o botao para a tela certa. Os dois caminhos chegam prontos do servidor;
// a escolha entre eles (e o desenho da vitrine) so aparece para quem tem rota
// ou ja escolheu a vitrine. Trocar e instantaneo e fica guardado (cookie + URL).
// ============================================================================

const SELO: Record<EstadoPasso, { tom: TomStatus; texto: string }> = {
  feito: { tom: "ok", texto: "Feito" },
  falta: { tom: "neutral", texto: "Falta" },
  atencao: { tom: "warn", texto: "Atenção" },
  aguardando: { tom: "run", texto: "Aguardando" },
  naoConferido: { tom: "neutral", texto: "Não conferido" },
};

const CAMINHOS = [
  { valor: "direto", rotulo: ROTULO_CAMINHO.direto },
  { valor: "vitrine", rotulo: ROTULO_CAMINHO.vitrine },
] as const;

/** Botao pequeno no desktop, alvo de toque de 44px no celular. */
const ALVO = "h-ctl-lg sm:h-ctl-sm";

const EXPLICA_CAMINHO: Record<CaminhoGuia, string> = {
  direto: "O anúncio leva o comprador direto à loja que cobra.",
  vitrine:
    "O anúncio leva à vitrine, e o xcart manda o carrinho para uma loja de checkout pelo SKU.",
};

export function GuiaTela({
  guias,
  caminhoInicial,
  dispensadoInicial,
  escolheCaminho,
  fluxoVitrine,
}: {
  guias: Record<CaminhoGuia, Guia>;
  caminhoInicial: CaminhoGuia;
  dispensadoInicial: boolean;
  /** Mostra "Como você anuncia". Sem rota, o caminho é o direto e a escolha some. */
  escolheCaminho: boolean;
  /** O desenho da vitrine, montado no servidor; só aparece no caminho com vitrine. */
  fluxoVitrine: ReactNode;
}) {
  const router = useRouter();
  const [caminho, setCaminho] = useState<CaminhoGuia>(caminhoInicial);
  const [dispensado, setDispensado] = useState(dispensadoInicial);
  const [atualizando, atualizar] = useTransition();
  // Um passo aberto por caminho; comeca no proximo a fazer.
  const [aberto, setAberto] = useState<Record<CaminhoGuia, IdPasso | null>>(() => ({
    direto: guias.direto.proximo?.id ?? null,
    vitrine: guias.vitrine.proximo?.id ?? null,
  }));

  const guia = guias[caminho];
  const pct = porcentagem(guia);

  function trocarCaminho(novo: CaminhoGuia) {
    setCaminho(novo);
    gravarCookie(COOKIE_GUIA_CAMINHO, novo);
    // Na URL tambem, para o link mandado a alguem abrir no mesmo caminho.
    const params = new URLSearchParams(window.location.search);
    params.set("caminho", novo);
    window.history.replaceState(null, "", `?${params.toString()}`);
  }

  function marcarDispensado(sim: boolean) {
    setDispensado(sim);
    gravarCookie(COOKIE_GUIA_DISPENSADO, sim ? "1" : "0");
    // O menu lateral le o cookie no servidor.
    atualizar(() => router.refresh());
  }

  function alternar(id: IdPasso) {
    setAberto((a) => ({ ...a, [caminho]: a[caminho] === id ? null : id }));
  }

  return (
    <div className="flex flex-col gap-4">
      {guia.naoConferidos > 0 ? (
        <Callout
          tom="warn"
          titulo={
            guia.naoConferidos === 1
              ? "Não deu para conferir 1 passo"
              : `Não deu para conferir ${guia.naoConferidos} passos`
          }
          acao={
            <Button variant="secondary" size="sm" className={ALVO} pending={atualizando} onClick={() => atualizar(() => router.refresh())}>
              Tentar de novo
            </Button>
          }
        >
          O que ficou de fora não conta como feito nem como pendente.
        </Callout>
      ) : guia.completo ? (
        <Callout
          tom="ok"
          titulo="Sua operação está no ar"
          acao={
            <Link href="/financeiro" className={cn(buttonVariants({ variant: "secondary", size: "sm" }), ALVO)}>
              Ver o Lucro
            </Link>
          }
        >
          O lucro, o rastreamento e os alertas já estão valendo.
        </Callout>
      ) : dispensado ? (
        <Callout
          tom="info"
          titulo="Você dispensou o guia"
          acao={
            <Button variant="secondary" size="sm" className={ALVO} pending={atualizando} onClick={() => marcarDispensado(false)}>
              Mostrar de novo
            </Button>
          }
        >
          Ele só aparece nesta tela. Os passos continuam sendo conferidos.
        </Callout>
      ) : null}

      <div className={cn("grid gap-6", caminho === "vitrine" && "lg:grid-cols-[minmax(0,1fr)_300px]")}>
        <section aria-labelledby="guia-progresso" className="min-w-0 rounded-card border border-border bg-surface">
          <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 flex-col gap-1">
              <h2 id="guia-progresso" className="text-section text-ink">
                <span className="num">
                  {guia.feitos} de {guia.total}
                </span>{" "}
                concluídos
              </h2>
              {escolheCaminho ? <p className="text-label text-t2">{EXPLICA_CAMINHO[caminho]}</p> : null}
            </div>
            {escolheCaminho ? (
              <Segmented
                rotulo="Como você anuncia"
                valor={caminho}
                onValorChange={trocarCaminho}
                opcoes={CAMINHOS}
                tamanho="md"
                className="shrink-0"
              />
            ) : null}
          </div>

          <div className="flex items-center gap-3 border-b border-border-subtle px-4 py-3">
            <span
              role="progressbar"
              aria-label="Progresso do guia"
              aria-valuemin={0}
              aria-valuemax={guia.total}
              aria-valuenow={guia.feitos}
              aria-valuetext={`${guia.feitos} de ${guia.total} passos concluídos`}
              className="block h-1.5 flex-1 overflow-hidden rounded-full bg-track"
            >
              <span
                className={cn("block h-full rounded-full", guia.completo ? "bg-ok" : "bg-ink")}
                style={{ width: `${pct}%` }}
              />
            </span>
            <span className="num w-10 text-right text-label text-t2">{pct}%</span>
          </div>

          <ol>
            {guia.passos.map((p, i) => (
              <ItemPasso
                key={`${caminho}-${p.id}`}
                passo={p}
                numero={i + 1}
                proximo={guia.proximo?.id === p.id}
                aberto={aberto[caminho] === p.id}
                onAlternar={() => alternar(p.id)}
              />
            ))}
          </ol>

          {!guia.completo && !dispensado ? (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle px-4 py-3">
              <p className="text-label text-t2">
                {guia.proximo
                  ? // So a primeira letra: "Shopify" e "SKU" continuam como sao.
                    `Próximo: ${guia.proximo.titulo.charAt(0).toLowerCase()}${guia.proximo.titulo.slice(1)}.`
                  : "Falta conferir o que ficou de fora."}
              </p>
              <Button variant="ghost" size="sm" className={ALVO} pending={atualizando} onClick={() => marcarDispensado(true)}>
                Dispensar o guia
              </Button>
            </div>
          ) : null}
        </section>

        {caminho === "vitrine" ? fluxoVitrine : null}
      </div>
    </div>
  );
}

function ItemPasso({
  passo,
  numero,
  proximo,
  aberto,
  onAlternar,
}: {
  passo: PassoGuia;
  numero: number;
  proximo: boolean;
  aberto: boolean;
  onAlternar: () => void;
}) {
  const feito = passo.estado === "feito";
  const selo = SELO[passo.estado];
  const idPainel = `passo-${passo.id}`;

  return (
    <li className={cn("border-b border-border-subtle last:border-b-0", proximo && "bg-surface-2")}>
      <button
        type="button"
        aria-expanded={aberto}
        aria-controls={idPainel}
        onClick={onAlternar}
        className="flex min-h-14 w-full items-start gap-3 px-4 py-3 text-left hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
      >
        <Marcador estado={passo.estado} numero={numero} proximo={proximo} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className={cn("text-dense", feito ? "text-t2 line-through" : "font-medium text-ink")}>
            {passo.titulo}
          </span>
          {passo.detalhe ? <span className="text-label text-t2">{passo.detalhe}</span> : null}
          <StatusBadge tom={selo.tom} texto={selo.texto} className="mt-1 sm:hidden" />
        </span>
        <StatusBadge tom={selo.tom} texto={selo.texto} className="hidden sm:inline-flex" />
        <ChevronDown
          aria-hidden
          className={cn("mt-0.5 size-4 shrink-0 text-t2 transition-transform duration-150", aberto && "rotate-180")}
          strokeWidth={1.75}
        />
      </button>

      {/* Sempre no DOM (hidden quando fechado): o aria-controls aponta para algo que existe. */}
      <div id={idPainel} hidden={!aberto} className="pb-4 pl-12 pr-4">
        <div className="flex flex-col items-start gap-3">
          <p className="max-w-[62ch] text-dense text-t1 text-pretty">{passo.texto}</p>
          {passo.como ? (
            <ol className="flex max-w-[62ch] list-decimal flex-col gap-1 pl-4 text-dense text-t1">
              {passo.como.map((linha) => (
                <li key={linha}>{linha}</li>
              ))}
            </ol>
          ) : null}
          <Link
            href={passo.href}
            className={cn(buttonVariants({ variant: proximo ? "primary" : "secondary", size: "sm" }), ALVO)}
          >
            {passo.cta}
          </Link>
        </div>
      </div>
    </li>
  );
}

/** Numero vira marca de feito: a lista e uma sequencia, o marcador diz ordem e estado. */
function Marcador({ estado, numero, proximo }: { estado: EstadoPasso; numero: number; proximo: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "num mt-px grid size-5 shrink-0 place-items-center rounded-full border text-label",
        estado === "feito"
          ? "border-ok bg-ok text-on-solid"
          : estado === "atencao"
            ? "border-warn-border bg-warn-bg text-warn"
            : proximo
              ? "border-transparent bg-solid text-on-solid"
              : estado === "naoConferido"
                ? "border-dashed border-border-strong text-t2"
                : "border-control-border text-t2"
      )}
    >
      {estado === "feito" ? <Check className="size-3.5" strokeWidth={1.75} /> : numero}
    </span>
  );
}
