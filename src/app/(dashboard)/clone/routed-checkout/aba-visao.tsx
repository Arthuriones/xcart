import Link from "next/link";
import { ArrowDownIcon, ArrowRightIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Section } from "@/components/ui/section";
import { StatusBadge } from "@/components/ui/status-badge";
import { mapaVelho } from "@/components/routed-checkout/target-state";
import { quandoFoi } from "@/lib/leitura/lojas-estado";
import type { GraphRoute, GraphStore } from "@/lib/checkout-routes/graph";
import { ROTULO_FORA_DO_AR, ehMotivoForaDoAr } from "@/lib/checkout-routes/loja-fora-do-ar";
import type { FunilDaRota } from "@/lib/checkout-routes/sensor";
import { FunilDaRotaView } from "./funil";
import { Instalador } from "./instalar";
import {
  ESTRATEGIAS,
  avisosDaConferencia,
  estadoDaLoja,
  estadoInstalacao,
  hrefRota,
  lojasRecebendo,
} from "./logica";

const LINK_BASE =
  "rounded-sm font-medium text-brand underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";
const LINK = `${LINK_BASE} text-dense`;

function idade(horas: number) {
  const dias = Math.floor(horas / 24);
  if (dias >= 1) return dias === 1 ? "há 1 dia" : `há ${dias} dias`;
  return `há ${Math.max(1, Math.round(horas))} h`;
}

/** O aviso mais grave da rota, um so (o resto aparece no Diagnostico). */
function AvisoDaRota({ rota, agora }: { rota: GraphRoute; agora: number }) {
  if (rota.lastHeal && !rota.lastHeal.ok) {
    // Loja fora do ar: o titulo diz o que e ("Vitrine com senha") em vez do
    // generico. A frase ja traz a loja e o que fazer.
    const motivo = ehMotivoForaDoAr(rota.lastHeal.motivo) ? rota.lastHeal.motivo : null;
    return (
      <Callout
        tom="err"
        titulo={motivo ? ROTULO_FORA_DO_AR[motivo] : "A última checagem automática achou um problema"}
        acao={
          <Link href={hrefRota(rota.id, "diagnostico")} scroll={false} className={buttonVariants({ variant: "secondary", size: "sm" })}>
            Ver diagnóstico
          </Link>
        }
      >
        {rota.lastHeal.message || "Teste a rota para ver o que falta e corrigir."}
      </Callout>
    );
  }
  if (rota.enabled && lojasRecebendo(rota) === 0) {
    return (
      <Callout
        tom="err"
        titulo="Nenhuma loja de checkout está recebendo comprador"
        acao={
          <Link href={hrefRota(rota.id, "lojas")} scroll={false} className={buttonVariants({ variant: "secondary", size: "sm" })}>
            Ajustar lojas
          </Link>
        }
      >
        Com a rota ligada assim, o comprador cai no checkout da vitrine, que não cobra.
      </Callout>
    );
  }
  // O mapa de SKU nao cresce sozinho quando o lojista cadastra produto novo na
  // vitrine: so cresce quando o conserto roda. Sem este aviso o produto novo
  // simplesmente nao roteia, em silencio. So vale em rota no ar.
  const velho = rota.enabled ? mapaVelho(rota.targets, agora) : null;
  if (velho) {
    return (
      <Callout
        tom="warn"
        titulo={velho.nunca ? "O mapa de produtos ainda não foi conferido" : `Mapa de produtos conferido ${idade(velho.horas)}`}
        acao={
          <Link
            href={hrefRota(rota.id, "diagnostico", { conferir: "1" })}
            scroll={false}
            className={buttonVariants({ variant: "secondary", size: "sm" })}
          >
            Conferir agora
          </Link>
        }
      >
        Produto cadastrado na vitrine depois disso ainda não é levado ao checkout: o comprador sai pelo
        checkout da própria vitrine, que não cobra.
      </Callout>
    );
  }
  if (!rota.enabled) {
    return (
      <Callout tom="info" titulo="Rota pausada">
        Ela não recebe comprador e continua conectada. As lojas e os produtos ligados ficam guardados.
      </Callout>
    );
  }
  return null;
}

function Fato({ rotulo, valor, sub }: { rotulo: string; valor: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-card border border-border bg-surface p-4">
      <dt className="text-label text-t2">{rotulo}</dt>
      <dd className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-section text-ink">{valor}</span>
        {sub ? <span className="truncate text-label text-t2">{sub}</span> : null}
      </dd>
    </div>
  );
}

/** Aba Visao: o estado da rota, para onde vai o comprador e a instalacao. */
export function AbaVisao({
  rota,
  lojas,
  sinal,
  origem,
  agora,
  funil,
}: {
  rota: GraphRoute;
  lojas: Map<string, GraphStore>;
  sinal: { em: string | null; erro: boolean };
  origem: string;
  agora: number;
  /** Funil dos ultimos 7 dias (leitura/funil-rota.ts); ausente = nao mostra. */
  funil?: { dado: FunilDaRota | null; erro: boolean };
}) {
  const vitrine = lojas.get(rota.sourceStoreId);
  const ligados = rota.targets.reduce((maior, t) => Math.max(maior, t.mappedSkuCount), 0);
  const estrategia = ESTRATEGIAS.find((e) => e.valor === rota.rotationStrategy) ?? ESTRATEGIAS[0];
  const instalacao = estadoInstalacao(sinal.em, sinal.erro);
  const quando = quandoFoi(sinal.em, new Date(agora));

  return (
    <div className="flex flex-col gap-4">
      <AvisoDaRota rota={rota} agora={agora} />

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Fato rotulo="Vitrine" valor={vitrine?.name || "Loja removida"} sub={<span className="font-mono">{vitrine?.shopDomain || "—"}</span>} />
        <Fato
          rotulo="Divisão"
          valor={rota.targets.length > 1 ? estrategia.rotulo : "Uma loja só"}
          sub={rota.targets.length === 1 ? "1 loja de checkout" : `${rota.targets.length} lojas de checkout`}
        />
        <Fato
          rotulo="SKUs ligados"
          valor={<span className="num">{ligados.toLocaleString("pt-BR")}</span>}
          sub={ligados === 0 ? "nenhum produto ligado" : "na loja com o maior mapa"}
        />
        <Fato
          rotulo="Carrinhos"
          valor={<span className="num">{rota.routedCount30d.toLocaleString("pt-BR")}</span>}
          sub="levados ao checkout em 30 dias"
        />
      </dl>

      {funil ? <FunilDaRotaView funil={funil.dado} erro={funil.erro} /> : null}

      <Section
        titulo="Para onde vai o comprador"
        descricao={
          rota.targets.length > 1
            ? `${estrategia.rotulo}. ${estrategia.dica}`
            : "Todo comprador da vitrine vai para esta loja de checkout."
        }
        acoes={
          <Link href={hrefRota(rota.id, "lojas")} scroll={false} className={LINK}>
            Mudar a divisão
          </Link>
        }
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="flex min-w-0 flex-col gap-0.5 rounded-card border border-border bg-surface-2 px-3 py-2.5 md:w-56 md:shrink-0">
            <span className="text-label text-t2">Vitrine</span>
            <span className="truncate text-dense font-medium text-ink">{vitrine?.name || "Loja removida"}</span>
            <span className="truncate font-mono text-label text-t2">{vitrine?.shopDomain || "—"}</span>
          </div>
          <span aria-hidden className="flex justify-center text-t3 md:shrink-0">
            <ArrowDownIcon className="size-4 md:hidden" />
            <ArrowRightIcon className="hidden size-4 md:block" />
          </span>
          <ul className="flex min-w-0 flex-1 flex-col gap-2" aria-label="Lojas de checkout">
            {rota.targets.map((t) => {
              const loja = lojas.get(t.storeId);
              const selo = estadoDaLoja(rota.enabled, t);
              const fatia = rota.enabled ? t.sharePercent : 0;
              return (
                <li key={t.id} className="flex min-w-0 flex-col gap-1.5 rounded-card border border-border px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="min-w-0 flex-1 truncate text-dense font-medium text-ink">
                      {loja?.name || "Loja removida"}
                    </span>
                    <StatusBadge tom={selo.tom} texto={selo.texto} />
                    <span className="num w-11 text-right text-dense font-semibold text-ink">{fatia}%</span>
                  </div>
                  <div
                    role="img"
                    aria-label={`${fatia}% do tráfego`}
                    className="h-1.5 overflow-hidden rounded-full bg-track"
                  >
                    <div
                      className={selo.tom === "ok" ? "h-full rounded-full bg-solid" : "h-full rounded-full bg-border-strong"}
                      style={{ width: `${fatia}%` }}
                    />
                  </div>
                  {/* Contado pelo conserto e NAO mexido: preco diferente pode
                      ser de proposito; variante parada o lojista resolve la. */}
                  {avisosDaConferencia(t.conserto).map((aviso) => (
                    <details key={aviso.texto} className="text-label text-t1">
                      <summary className="cursor-pointer rounded-sm text-warn focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                        {aviso.texto}
                      </summary>
                      {aviso.exemplos.length > 0 ? (
                        <ul className="mt-1 flex flex-col gap-0.5 pl-4 text-t2">
                          {aviso.exemplos.map((e, i) => (
                            <li key={`${i}-${e}`} className="break-words">
                              {e}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </details>
                  ))}
                </li>
              );
            })}
          </ul>
        </div>
      </Section>

      <Section
        titulo="Instalação na vitrine"
        descricao="Sem o script no tema da vitrine, a rota não leva ninguém ao checkout."
        acoes={
          <Link href={hrefRota(rota.id, "instalacao")} scroll={false} className={LINK}>
            Ver instalação
          </Link>
        }
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <StatusBadge tom={instalacao.tom} texto={instalacao.texto} tamanho="md" />
          <span className="text-dense text-t1">
            {sinal.erro
              ? "Não deu para ler o sinal do script agora."
              : quando
                ? `Último sinal da vitrine: ${quando}.`
                : "Nenhum sinal nos últimos 30 dias: o script não está no tema ou ninguém abriu produto ou carrinho da vitrine."}
          </span>
        </div>
        <Instalador
          rotaId={rota.id}
          token={rota.publicToken}
          origem={origem}
          comCodigo={false}
          variante={sinal.em ? "secondary" : "primary"}
          rotulo={sinal.em ? "Reinstalar na vitrine" : "Instalar na vitrine"}
        />
      </Section>

      <p className="text-label text-t2 text-pretty">
        Em rota, a compra nasce na loja de checkout e sai sem a origem do anúncio: é proposital, para as
        duas lojas não aparecerem ligadas. As vendas por loja de checkout estão em{" "}
        <Link href="/sales" className={LINK_BASE}>
          Vendas por rota
        </Link>
        .
      </p>
    </div>
  );
}
