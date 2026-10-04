"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";
import clsx from "clsx";
import { toast } from "sonner";
import { BarList } from "@/components/ui/bar-list";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiCard } from "@/components/ui/kpi-card";
import { Section } from "@/components/ui/section";
import { Sheet } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge, type TomStatus } from "@/components/ui/status-badge";
import { gravarCookie } from "@/components/layout/contexto";
import { COOKIE_LOJA } from "@/lib/financeiro/tipos";
import type { DiagnosticoLoja } from "@/lib/tracking/diagnostico";
import type { LojaTracking } from "@/lib/tracking/queries";
import { DetalheLoja } from "./detalhe-loja";
import { PorConta } from "./por-conta";
import { respostaJson } from "./resposta";
import {
  NOME_CURTO,
  PLATAFORMAS,
  ROTULO_DA_SAUDE,
  TOM_DA_SAUDE,
  formatarFracao,
  formatarInteiro,
  linhaDaLoja,
  ordenarLinhas,
  resumoDaTela,
  textoCobertura,
  textoDaColuna,
  textoPrecisam,
  type LinhaLoja,
  type TomSaude,
} from "./resumo";

// ============================================================================
// Rastreamento: as lojas da mais urgente para a mais tranquila, um problema e
// um botao por loja, o que cada conta recebeu (de anuncio x total) e o
// detalhe no painel lateral.
//
// A pergunta e "esta chegando?", nao "esta configurado?": o endpoint do Google
// responde 200 mesmo quando ignora o conteudo, entao so a comparacao com os
// pedidos denuncia que o envio quebrou.
//
// Estado so local: a loja aberta, "Mostrar testes" e os ajustes depois de uma
// acao. Os numeros vem do servidor (router.refresh depois de cada mudanca).
// ============================================================================

/** Ate quantas lojas desligadas aparecem sem precisar abrir. */
const DESLIGADAS_VISIVEIS = 3;

const COR_BARRA: Record<TomSaude, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  err: "bg-err",
  neutral: "bg-t4",
};

export interface SaudeScreenProps {
  lojas: LojaTracking[];
  diagnostico: Record<string, DiagnosticoLoja>;
  /** Lojas cuja conferencia na Shopify falhou nesta carga. */
  falharam: string[];
  /** Lojas que nao aparecem: app desinstalado e envio desligado. */
  ocultas: number;
  /** A barra do topo escolheu uma loja. */
  lojaEscolhida: boolean;
  /** Muda a cada carga do servidor: os ajustes locais valem ate a proxima. */
  geradoEm: number;
  /** ?loja= na URL: abre o detalhe dessa loja. */
  abrirInicial: string | null;
}

interface Ajustes {
  base: number;
  diag: Record<string, DiagnosticoLoja>;
  rechecadas: string[];
}

export function SaudeScreen({
  lojas,
  diagnostico,
  falharam,
  ocultas,
  lojaEscolhida,
  geradoEm,
  abrirInicial,
}: SaudeScreenProps) {
  const router = useRouter();
  const [atualizando, startTransition] = useTransition();
  const [aberta, setAberta] = useState<string | null>(
    abrirInicial && lojas.some((l) => l.storeId === abrirInicial) ? abrirInicial : null
  );
  const [mostrarDesligadas, setMostrarDesligadas] = useState(false);
  const [rechecando, setRechecando] = useState<string | null>(null);
  // Teste fica fora das contagens por padrao; o painel da loja segue a mesma escolha.
  const [mostrarTestes, setMostrarTestes] = useState(false);

  // Ajustes locais (nova conferencia de uma loja, script instalado) valem ate
  // o servidor mandar numeros novos.
  const [ajustes, setAjustes] = useState<Ajustes>({ base: geradoEm, diag: {}, rechecadas: [] });
  if (ajustes.base !== geradoEm) setAjustes({ base: geradoEm, diag: {}, rechecadas: [] });

  const diag = useMemo(() => ({ ...diagnostico, ...ajustes.diag }), [diagnostico, ajustes.diag]);
  const falhas = useMemo(
    () => new Set(falharam.filter((id) => !ajustes.rechecadas.includes(id))),
    [falharam, ajustes.rechecadas]
  );

  const linhas = useMemo(
    () => ordenarLinhas(lojas.map((l) => linhaDaLoja(l, diag[l.storeId] ?? null, l.ligado))),
    [lojas, diag]
  );
  const resumo = useMemo(() => resumoDaTela(linhas, diag), [linhas, diag]);

  function atualizar() {
    startTransition(() => router.refresh());
  }

  function verEventos(storeId: string) {
    // A loja vai para a barra do topo: Eventos ao vivo abre filtrado nela.
    // Navegacao inteira de proposito: a barra mora no layout, que a navegacao
    // do App Router reaproveita -- ela continuaria mostrando a loja antiga.
    gravarCookie(COOKIE_LOJA, storeId);
    window.location.assign("/tracking/eventos");
  }

  async function rechecar(l: LojaTracking) {
    setRechecando(l.storeId);
    try {
      const r = await fetch(`/api/leitura/tracking-diagnostico?loja=${encodeURIComponent(l.storeId)}`, {
        cache: "no-store",
      });
      const j = await respostaJson(r, "A Shopify não respondeu agora.");
      if (!("diagnostico" in j)) throw new Error("A Shopify não respondeu agora.");
      const novo = (j.diagnostico ?? null) as DiagnosticoLoja | null;
      setAjustes((a) => ({
        ...a,
        diag: novo ? { ...a.diag, [l.storeId]: novo } : a.diag,
        rechecadas: a.rechecadas.includes(l.storeId) ? a.rechecadas : [...a.rechecadas, l.storeId],
      }));
      const linha = linhaDaLoja(l, novo, l.ligado);
      toast.success(`${l.nome} conferida`, {
        description:
          linha.saude === "ok"
            ? "Tudo certo nos últimos 7 dias."
            : (linha.principal?.texto ?? ROTULO_DA_SAUDE[linha.saude]),
      });
    } catch (e) {
      toast.error(`Ainda não deu para conferir ${l.nome}`, {
        description: e instanceof Error ? e.message : "Tente de novo em instantes.",
      });
    } finally {
      setRechecando(null);
    }
  }

  function ajustarDiag(storeId: string, patch: Partial<DiagnosticoLoja>) {
    setAjustes((a) => {
      const atual = a.diag[storeId] ?? diagnostico[storeId];
      if (!atual) return a;
      return { ...a, diag: { ...a.diag, [storeId]: { ...atual, ...patch } } };
    });
  }

  // ---- vazios ---------------------------------------------------------------

  if (lojas.length === 0) {
    return (
      <EmptyState
        titulo={
          lojaEscolhida
            ? "Esta loja não aparece aqui"
            : ocultas > 0
              ? "Nenhuma loja aparece aqui"
              : "Nenhuma loja conectada"
        }
        descricao={
          lojaEscolhida
            ? "O app foi desinstalado dela e o envio de compras está desligado."
            : ocultas > 0
              ? `${ocultas === 1 ? "A loja conectada está" : `As ${ocultas} lojas conectadas estão`} com o app desinstalado e o envio desligado.`
              : "Conecte uma loja Shopify para ver se as compras chegam ao Meta e ao Google."
        }
        acao={
          <Link href="/stores" className={buttonVariants({ variant: "primary" })}>
            {lojaEscolhida || ocultas > 0 ? "Ver em Lojas" : "Conectar loja"}
          </Link>
        }
      />
    );
  }

  const ligadas = linhas.filter((l) => l.loja.ligado);
  const desligadas = linhas.filter((l) => !l.loja.ligado);
  const mostrarTodas =
    lojaEscolhida || ligadas.length === 0 || desligadas.length <= DESLIGADAS_VISIVEIS || mostrarDesligadas;
  const visiveis = mostrarTodas ? linhas : ligadas;
  const linhaAberta = aberta ? linhas.find((l) => l.loja.storeId === aberta) : undefined;

  // Primeiro uso: a melhor loja para comecar e a que ja pode ligar.
  const primeira =
    desligadas.find((l) => l.principal?.acao?.tipo === "ligar") ?? desligadas[0] ?? null;

  return (
    <div className="flex flex-col gap-6">
      {ligadas.length === 0 ? (
        <EmptyState
          selo="Primeiro uso"
          titulo={
            lojaEscolhida ? "Esta loja ainda não envia compras" : "Nenhuma loja enviando compras ainda"
          }
          descricao="Ligue o Meta ou o Google numa loja para ver as compras chegando aqui."
          acao={
            primeira ? (
              <Button onClick={() => setAberta(primeira.loja.storeId)}>Ligar rastreamento</Button>
            ) : undefined
          }
        />
      ) : (
        <section
          aria-label="Resumo dos últimos 7 dias"
          className="grid grid-cols-2 gap-3 lg:grid-cols-4"
        >
          <KpiCard
            rotulo="Lojas rastreando"
            valor={`${resumo.rastreando} de ${resumo.total}`}
            detalhe={
              resumo.semDestino === 0
                ? "todas com destino"
                : `${resumo.semDestino} sem nenhum destino`
            }
          />
          <KpiCard
            rotulo="Pedidos na Shopify"
            valor={resumo.pedidos === null ? null : formatarInteiro(resumo.pedidos)}
            motivoSemDado="A Shopify não respondeu"
            detalhe={
              resumo.pedidos === null
                ? undefined
                : resumo.lojasSemPedidos > 0
                  ? `parcial · ${resumo.lojasSemPedidos} ${resumo.lojasSemPedidos === 1 ? "loja sem resposta" : "lojas sem resposta"}`
                  : "lojas rastreando · 7 dias"
            }
            definicao="Pedidos dos últimos 7 dias que deveriam virar compra: sem pedido de teste, de PDV, rascunho ou de valor zero."
          />
          <KpiCard
            rotulo="Compras enviadas"
            valor={resumo.enviadas === null ? null : formatarInteiro(resumo.enviadas)}
            motivoSemDado="Não deu para contar agora"
            detalhe={
              resumo.enviadas === null
                ? undefined
                : (textoCobertura(resumo.porPlataforma) ?? "nos últimos 7 dias")
            }
            definicao="Vendas que o xcart enviou para pelo menos um destino em 7 dias. A porcentagem de cada plataforma compara, pedido a pedido, com os pedidos da Shopify desde que o destino foi ligado."
          />
          <KpiCard
            rotulo="Precisam de você"
            valor={formatarInteiro(resumo.paradas + resumo.atencao)}
            estado={
              resumo.paradas > 0
                ? { tom: "err", texto: "Parado" }
                : resumo.atencao > 0
                  ? { tom: "warn", texto: "Atenção" }
                  : { tom: "ok", texto: "Tudo certo" }
            }
            detalhe={textoPrecisam(resumo)}
          />
        </section>
      )}

      <Section
        titulo={lojaEscolhida ? "Loja escolhida" : "Lojas, da mais urgente para a mais tranquila"}
        descricao={
          lojaEscolhida
            ? "Para ver todas, escolha Todas as lojas na barra do topo."
            : "Compras que chegaram, sobre os pedidos da Shopify · últimos 7 dias"
        }
        espaco="nenhum"
        acoes={
          atualizando ? (
            <span role="status" className="flex items-center gap-1.5 text-label text-t2">
              <Spinner size={12} /> Atualizando
            </span>
          ) : undefined
        }
      >
        <div
          aria-hidden
          className="hidden grid-cols-[minmax(180px,1.1fr)_minmax(150px,1fr)_minmax(150px,1fr)_minmax(240px,1.7fr)_16px] gap-5 border-y border-border bg-surface-2 px-4 py-2.5 text-label font-semibold text-t1 md:grid"
        >
          <span>Loja</span>
          <span>Meta · compras</span>
          <span>Google · compras</span>
          <span>O que fazer</span>
          <span />
        </div>
        <ul className="border-t border-border md:border-t-0">
          {visiveis.map((l) => (
            <LinhaDaLoja
              key={l.loja.storeId}
              linha={l}
              falhou={falhas.has(l.loja.storeId)}
              rechecando={rechecando === l.loja.storeId}
              abrir={() => setAberta(l.loja.storeId)}
              rechecar={() => void rechecar(l.loja)}
            />
          ))}
        </ul>
        {!mostrarTodas && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle px-4 py-3">
            <span className="text-dense text-t1">
              {desligadas.length} lojas sem rastreamento
            </span>
            <Button
              size="sm"
              variant="secondary"
              aria-expanded={false}
              onClick={() => setMostrarDesligadas(true)}
            >
              Mostrar
            </Button>
          </div>
        )}
        {mostrarDesligadas && desligadas.length > DESLIGADAS_VISIVEIS && !lojaEscolhida && (
          <div className="flex justify-end border-t border-border-subtle px-4 py-2">
            <Button
              size="sm"
              variant="ghost"
              aria-expanded
              onClick={() => setMostrarDesligadas(false)}
            >
              Esconder lojas sem rastreamento
            </Button>
          </div>
        )}
        {ocultas > 0 && !lojaEscolhida && (
          <p className="border-t border-border-subtle bg-surface-2 px-4 py-2.5 text-label text-t2">
            {ocultas === 1
              ? "1 loja com o app desinstalado não aparece aqui. "
              : `${ocultas} lojas com o app desinstalado não aparecem aqui. `}
            <Link href="/stores" className="font-medium text-ink underline underline-offset-2">
              Ver em Lojas
            </Link>
          </p>
        )}
      </Section>

      <PorConta
        lojas={lojas}
        mostrarTestes={mostrarTestes}
        onMostrarTestes={setMostrarTestes}
      />

      {ligadas.length > 0 && <Comparativo resumo={resumo} />}

      <Sheet open={Boolean(linhaAberta)} onOpenChange={(v) => !v && setAberta(null)}>
        {linhaAberta && (
          <DetalheLoja
            key={linhaAberta.loja.storeId}
            linha={linhaAberta}
            diag={diag[linhaAberta.loja.storeId] ?? null}
            falhou={falhas.has(linhaAberta.loja.storeId)}
            mostrarTestes={mostrarTestes}
            rechecando={rechecando === linhaAberta.loja.storeId}
            aoMudar={atualizar}
            rechecar={() => void rechecar(linhaAberta.loja)}
            ajustarDiag={(patch) => ajustarDiag(linhaAberta.loja.storeId, patch)}
            verEventos={() => verEventos(linhaAberta.loja.storeId)}
          />
        )}
      </Sheet>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Uma loja da lista
// ---------------------------------------------------------------------------

function LinhaDaLoja({
  linha,
  falhou,
  rechecando,
  abrir,
  rechecar,
}: {
  linha: LinhaLoja;
  falhou: boolean;
  rechecando: boolean;
  abrir: () => void;
  rechecar: () => void;
}) {
  const { loja, saude, principal, problemas, colunas } = linha;

  const nome = (
    <button
      type="button"
      onClick={abrir}
      data-linha-alvo=""
      aria-label={`Abrir detalhe de ${loja.nome}`}
      className="w-fit max-w-full truncate text-left text-body font-semibold text-ink after:absolute after:inset-0 focus-visible:outline-none"
    >
      {loja.nome}
    </button>
  );

  if (falhou) {
    // A conferencia desta loja falhou; as outras estao atualizadas.
    return (
      <li className="relative border-b border-border-subtle last:border-b-0 has-[[data-linha-alvo]:focus-visible]:outline-2 has-[[data-linha-alvo]:focus-visible]:-outline-offset-2 has-[[data-linha-alvo]:focus-visible]:outline-focus">
        <div role="alert" className="flex flex-wrap items-center gap-3 p-4">
          <span className="flex min-w-50 flex-1 flex-col">
            {nome}
            <span className="truncate text-label text-t2">{loja.dominio}</span>
          </span>
          <span className="min-w-55 flex-[2] text-dense text-t1 text-pretty">
            Não conseguimos checar esta loja agora. As outras lojas estão atualizadas.
          </span>
          <Button
            size="sm"
            variant="secondary"
            pending={rechecando}
            onClick={rechecar}
            className="relative z-10"
          >
            Tentar de novo
          </Button>
        </div>
      </li>
    );
  }

  // Tudo certo e nenhum pedido para comparar: diz isso, em vez de so "nada a fazer".
  const pedidosZero =
    saude === "ok" &&
    PLATAFORMAS.some((p) => colunas[p].tipo === "razao") &&
    PLATAFORMAS.every((p) => {
      const c = colunas[p];
      return c.tipo !== "razao" || c.esperados === 0;
    });
  const texto =
    principal?.texto ??
    (pedidosZero ? "Nada a fazer. Nenhum pedido nos últimos 7 dias." : "Nada a fazer agora.");
  const mais = principal && principal.tom !== "neutral" ? problemas.length - 1 : 0;

  return (
    <li
      className={cn(
        "relative border-b border-border-subtle last:border-b-0 hover:bg-hover",
        "has-[[data-linha-alvo]:focus-visible]:outline-2 has-[[data-linha-alvo]:focus-visible]:-outline-offset-2 has-[[data-linha-alvo]:focus-visible]:outline-focus"
      )}
    >
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 p-4 md:grid-cols-[minmax(180px,1.1fr)_minmax(150px,1fr)_minmax(150px,1fr)_minmax(240px,1.7fr)_16px] md:items-center md:gap-5">
        <div className="col-span-2 flex min-w-0 flex-col gap-1.5 md:col-span-1">
          <StatusBadge tom={TOM_DA_SAUDE[saude] as TomStatus} texto={ROTULO_DA_SAUDE[saude]} />
          {nome}
          <span className="-mt-1 truncate text-label text-t2">{loja.dominio}</span>
        </div>

        {PLATAFORMAS.map((p) => {
          const t = textoDaColuna(colunas[p], p);
          return (
            <div key={p} className="flex min-w-0 flex-col gap-1.5">
              <span className="text-label font-semibold text-t1 md:sr-only">
                {NOME_CURTO[p]} · compras
              </span>
              <span
                className={clsx(
                  "num text-dense font-medium",
                  t.tom === "err" ? "text-err" : colunas[p].tipo === "desligado" ? "text-t2" : "text-ink"
                )}
              >
                {t.texto}
              </span>
              {t.fracao !== null && (
                <span aria-hidden className="block h-1.5 overflow-hidden rounded-full bg-track">
                  <span
                    className={cn("block h-full rounded-full", COR_BARRA[t.tom])}
                    style={{ width: `${Math.round(t.fracao * 100)}%` }}
                  />
                </span>
              )}
              <span className="text-label text-t2">{t.sub}</span>
            </div>
          );
        })}

        <div className="col-span-2 flex min-w-0 flex-wrap items-center justify-between gap-3 md:col-span-1">
          <span className="min-w-40 flex-1 text-dense text-ink text-pretty">
            {texto}
            {mais > 0 && <span className="text-t2"> E mais {mais} no detalhe.</span>}
          </span>
          {principal?.acao && (
            <Button size="sm" onClick={abrir} className="relative z-10">
              {principal.acao.rotulo}
            </Button>
          )}
        </div>

        <ChevronRight aria-hidden className="hidden size-4 text-t3 md:block" />
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Pedidos x compras enviadas
// ---------------------------------------------------------------------------

function Comparativo({ resumo }: { resumo: ReturnType<typeof resumoDaTela> }) {
  const pedidos = resumo.pedidosComparaveis;
  const fora = resumo.lojasForaDaCobertura;
  return (
    <Section
      titulo="Pedidos e compras enviadas"
      descricao={
        "Lojas rastreando, pedido a pedido · últimos 7 dias · o Google vai pela tag no navegador e é contado no Google Ads" +
        (fora > 0 ? ` · ${fora === 1 ? "1 loja sem conferência ficou" : `${fora} lojas sem conferência ficaram`} de fora` : "")
      }
    >
      {pedidos ? (
        <BarList
          rotulo="Pedidos e compras enviadas por plataforma"
          maximo={pedidos}
          itens={[
            {
              id: "pedidos",
              rotulo: "Pedidos na Shopify",
              valor: pedidos,
              valorTexto: formatarInteiro(pedidos),
              cor: "chart-1",
            },
            // So o Meta: o Google vai pela tag no navegador, sem contagem no
            // servidor -- quem conta e o Google Ads.
            ...(["meta"] as const).map((p) => {
              const c = resumo.porPlataforma[p];
              return {
                id: p,
                rotulo: `Enviadas ao ${NOME_CURTO[p]} pelo xcart`,
                valor: c ? c.chegaram : null,
                valorTexto: c ? formatarInteiro(c.chegaram) : undefined,
                detalhe: c
                  ? c.esperados > 0
                    ? `de ${formatarInteiro(c.esperados)} · ${formatarFracao(c.chegaram / c.esperados)}`
                    : "nenhum pedido esperado"
                  : "nenhum destino recebendo",
                cor: "chart-2" as const,
              };
            }),
          ]}
        />
      ) : (
        <EmptyState
          variante="simples"
          titulo="Nada para comparar ainda"
          descricao="Nenhum pedido conferido nas lojas rastreando nos últimos 7 dias."
          className="py-4"
        />
      )}
    </Section>
  );
}
