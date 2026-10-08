"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { ArrowRightIcon, CheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { cn } from "@/components/ui/cn";
import { Section } from "@/components/ui/section";
import { AvisoAoSair } from "./aviso-sair";
import { Progresso } from "@/components/routed-checkout/cartoes";
import { plural } from "@/lib/leitura/lojas-estado";
import { PassoAtivar, type DiagnosticoRota, type FilaImagens } from "./passo-ativar";
import { PassoLojas, type Loja, type Opcoes } from "./passo-lojas";
import {
  avisosDaConexao,
  avisosDoTeste,
  estimativaCreditos,
  nomePadrao,
  passosDoModo,
  porcento,
  posicaoNaTrilha,
  problemaDaEscolha,
  type Escolha,
  type Modo,
} from "./regras";

// O dialogo de imagens so existe depois de um clique.
const SwapImagesDialog = dynamic(
  () => import("@/components/routed-checkout/swap-images-dialog").then((m) => m.SwapImagesDialog),
  { ssr: false }
);

// ============================================================================
// Assistente "Conectar vitrine à loja de checkout", em pagina propria.
//
// As chamadas e os corpos sao os de sempre:
//   POST /api/checkout-routes/create-destination (contagem e lotes)
//   POST /api/checkout-routes                      (Gerar: cria a rota)
//   POST /api/checkout-routes/connect-by-sku        (Reaproveitar e Só conectar)
//   POST /api/checkout-routes/repair + /health      (completa o que sobrou)
//   PATCH /api/checkout-routes/toggle               (liga a rota)
//   GET/POST /api/jobs/neutralize-images            (fila de imagens)
// O que mudou foi a apresentacao: pagina inteira, trilha por modo, papeis
// que nao repetem loja, credito que bloqueia, resultado na tela (sem 3
// toasts por etapa) e a instalacao automatica como passo final.
// ============================================================================

interface DestinationResult {
  createdCount: number;
  skippedCount: number;
  failedCount: number;
  imageQueueCount: number;
  skuMap: Record<string, string>;
  variantMap: Record<string, string>;
  failedDetails?: { sourceHandle: string; error: string }[];
}

type Lote = {
  processed: number;
  total: number;
  created: number;
  skipped: number;
  failed: number;
  canceled?: boolean;
};

type BatchData = {
  error?: string;
  createdCount?: number;
  skippedCount?: number;
  failedCount?: number;
  imageQueueCount?: number;
  skuMap?: Record<string, string>;
  variantMap?: Record<string, string>;
  failed?: { sourceHandle: string; error: string }[];
  totalCount?: number | null;
  nextCursor?: string | null;
  hasMore?: boolean;
};

const OPCOES_INICIAIS: Opcoes = {
  neutralize: true,
  imageMode: "queue",
  genericizeText: true,
  instructions: "",
  translate: false,
  translateVariants: false,
  outputLanguage: "pt-BR",
  inventoryTracked: false,
  inventoryQuantity: "100",
};

export function Assistente({ lojas, origem }: { lojas: Loja[]; origem: string }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [passo, setPasso] = useState<1 | 2 | 3>(1);
  const [modo, setModo] = useState<Modo>("generate");
  // Papeis comecam vazios: pre-preencher facilitava inverter vitrine e checkout.
  const [escolha, setEscolha] = useState<Escolha>({ vitrine: "", checkout: "", origemCopia: "" });
  const [opcoes, setOpcoes] = useState<Opcoes>(OPCOES_INICIAIS);

  // Saldo de creditos e tamanho da vitrine (estimativa antes de gastar).
  const [saldo, setSaldo] = useState<{ valor: number | null; cobrando: boolean; falhou: boolean } | null>(null);
  const [contagem, setContagem] = useState<{ chave: string; produtos: number | null } | null>(null);

  // Passo 2
  const [criando, setCriando] = useState(false);
  const [lote, setLote] = useState<Lote | null>(null);
  const [destino, setDestino] = useState<DestinationResult | null>(null);
  const [erroCriar, setErroCriar] = useState<string | null>(null);
  const [imagens, setImagens] = useState<FilaImagens | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Passo 3
  const [ativando, setAtivando] = useState(false);
  const [completando, setCompletando] = useState(false);
  const [rota, setRota] = useState<{ id: string; token: string; nome: string } | null>(null);
  const [casadas, setCasadas] = useState<number | null>(null);
  const [diagnostico, setDiagnostico] = useState<DiagnosticoRota | null>(null);
  const [criadosNoConserto, setCriadosNoConserto] = useState<{ produtos: number; variantes: number } | null>(null);
  const [ligando, setLigando] = useState(false);
  const [erroLigar, setErroLigar] = useState<string | null>(null);
  const [erroAtivar, setErroAtivar] = useState<string | null>(null);
  const [refazerImagens, setRefazerImagens] = useState(false);
  const rotaPedidaRef = useRef(false);

  const nome = (id: string) => lojas.find((l) => l.id === id)?.nome ?? "";
  const vitrine = nome(escolha.vitrine);
  const checkout = nome(escolha.checkout);

  // ------------------------------------------------------------- leituras

  useEffect(() => {
    let vivo = true;
    fetch("/api/billing/me")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("billing"))))
      .then((d: { aiCredits?: unknown; billingEnforced?: unknown }) => {
        if (!vivo) return;
        setSaldo({
          valor: typeof d.aiCredits === "number" ? d.aiCredits : null,
          cobrando: d.billingEnforced === true,
          falhou: false,
        });
      })
      .catch(() => {
        if (vivo) setSaldo({ valor: null, cobrando: false, falhou: true });
      });
    return () => {
      vivo = false;
    };
  }, []);

  // 1 credito = 1 imagem = 1 produto. So conta quando vai recriar imagem.
  const estimaImagens =
    modo === "generate" && opcoes.neutralize && opcoes.imageMode === "queue" && Boolean(escolha.vitrine) && Boolean(escolha.checkout);
  const chaveContagem = `${escolha.vitrine}|${escolha.checkout}`;

  useEffect(() => {
    if (!estimaImagens) return;
    let vivo = true;
    fetch("/api/checkout-routes/create-destination", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceStoreId: escolha.vitrine, targetStoreId: escolha.checkout, countOnly: true }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { totalCount?: unknown } | null) => {
        if (vivo) setContagem({ chave: chaveContagem, produtos: typeof d?.totalCount === "number" ? d.totalCount : null });
      })
      .catch(() => {
        if (vivo) setContagem({ chave: chaveContagem, produtos: null });
      });
    return () => {
      vivo = false;
    };
  }, [estimaImagens, chaveContagem, escolha.vitrine, escolha.checkout]);

  useEffect(() => () => pararPoll(), []);

  const produtos = contagem?.chave === chaveContagem ? contagem.produtos : null;
  const estimativa = !estimaImagens
    ? null
    : contagem?.chave === chaveContagem && produtos === null
      ? { tipo: "semLeitura" as const, texto: "Não deu para contar os produtos da vitrine agora. Cada produto usa 1 crédito." }
      : saldo === null
        ? { tipo: "calculando" as const }
        : estimativaCreditos({ produtos, saldo: saldo.valor, cobrando: saldo.cobrando, saldoFalhou: saldo.falhou });

  // ------------------------------------------------------------- imagens

  function pararPoll() {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  }

  async function atualizarFilaImagens(storeId: string) {
    if (!storeId) return;
    pararPoll();
    try {
      const r = await fetch(`/api/jobs/neutralize-images?storeId=${encodeURIComponent(storeId)}`);
      const d = await r.json();
      if (!r.ok || !d.progress) return;
      const p = d.progress as FilaImagens;
      setImagens(p.total > 0 ? p : null);
      if (p.pending > 0 || p.processing > 0) {
        if (p.pending > 0 && p.processing === 0) {
          fetch("/api/jobs/neutralize-images", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ storeId }),
          }).catch(() => {});
        }
        pollRef.current = setTimeout(() => atualizarFilaImagens(storeId), 5000);
      }
    } catch {
      // a fila e so acompanhamento: sem ela o processo segue no servidor
    }
  }

  // ------------------------------------------------------------- passo 2

  async function criarDestino() {
    const { vitrine: sourceStoreId, checkout: targetStoreId, origemCopia: reuseFromStoreId } = escolha;
    if (problemaDaEscolha(modo, escolha, lojas.length)) return;

    const controller = new AbortController();
    abortRef.current = controller;
    setCriando(true);
    setErroCriar(null);
    setPasso(2);
    setLote({ processed: 0, total: 0, created: 0, skipped: 0, failed: 0 });

    // Reaproveitar copia a loja de checkout ja sem marca (sem IA).
    const basePayload =
      modo === "reuse"
        ? {
            sourceStoreId: reuseFromStoreId,
            targetStoreId,
            inventoryMode: opcoes.inventoryTracked ? "tracked" : "not_tracked",
            inventoryQuantity: Number(opcoes.inventoryQuantity) || 0,
            neutralizeProducts: false,
            translateProducts: false,
            translateVariantOptions: false,
          }
        : {
            sourceStoreId,
            targetStoreId,
            inventoryMode: opcoes.inventoryTracked ? "tracked" : "not_tracked",
            inventoryQuantity: Number(opcoes.inventoryQuantity) || 0,
            neutralizeProducts: opcoes.neutralize,
            imageNeutralizeMode: opcoes.imageMode,
            aiMediaLimit: 1,
            genericizeText: opcoes.genericizeText,
            neutralizationInstructions: opcoes.instructions,
            translateProducts: opcoes.translate,
            translateVariantOptions: opcoes.translateVariants,
            targetLanguage: opcoes.outputLanguage,
          };

    const agg = {
      created: 0,
      skipped: 0,
      failed: 0,
      imageQueueCount: 0,
      skuMap: {} as Record<string, string>,
      variantMap: {} as Record<string, string>,
      failedDetails: [] as { sourceHandle: string; error: string }[],
    };
    const resultado = (): DestinationResult => ({
      createdCount: agg.created,
      skippedCount: agg.skipped,
      failedCount: agg.failed,
      imageQueueCount: agg.imageQueueCount,
      skuMap: agg.skuMap,
      variantMap: agg.variantMap,
      failedDetails: agg.failedDetails,
    });
    let cursor: string | null = null;
    let total = 0;
    let first = true;
    let enfileirouImagens = false;

    try {
      // Contagem rapida primeiro: a barra aparece com "0 de N" antes do
      // primeiro lote pesado de IA.
      try {
        const countRes = await fetch("/api/checkout-routes/create-destination", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({ ...basePayload, countOnly: true }),
        });
        const countData = (await countRes.json()) as { totalCount?: number | null };
        if (countRes.ok && typeof countData.totalCount === "number") {
          total = countData.totalCount;
          first = false;
          setLote({ processed: 0, total, created: 0, skipped: 0, failed: 0 });
        }
      } catch {
        // Sem contagem previa: o primeiro lote pede withCount.
      }

      // Um lote com ate 3 tentativas em erro passageiro (rede, 5xx). Cancelar
      // e erro 4xx (ex.: perfil da loja incompleto) sobem na hora.
      const buscarLote = async (): Promise<BatchData> => {
        let ultimo: Error | null = null;
        for (let tentativa = 1; tentativa <= 3; tentativa += 1) {
          if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
          try {
            const res: Response = await fetch("/api/checkout-routes/create-destination", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              signal: controller.signal,
              body: JSON.stringify({ ...basePayload, cursor, withCount: first }),
            });
            const data = (await res.json().catch(() => ({}))) as BatchData;
            if (res.ok) return data;
            if (res.status >= 400 && res.status < 500) {
              const fatal = new Error(data.error || "A loja recusou a criação dos produtos.");
              fatal.name = "FatalRequestError";
              throw fatal;
            }
            throw new Error(data.error || "O servidor demorou para responder.");
          } catch (err) {
            if (
              controller.signal.aborted ||
              (err instanceof DOMException && err.name === "AbortError") ||
              (err instanceof Error && err.name === "FatalRequestError")
            ) {
              throw err;
            }
            ultimo = err instanceof Error ? err : new Error("A conexão caiu.");
            if (tentativa < 3) await new Promise((resolve) => setTimeout(resolve, tentativa * 1500));
          }
        }
        throw ultimo || new Error("Não deu para criar os produtos.");
      };

      for (;;) {
        if (controller.signal.aborted) break;
        const data = await buscarLote();
        agg.created += data.createdCount || 0;
        agg.skipped += data.skippedCount || 0;
        agg.failed += data.failedCount || 0;
        agg.imageQueueCount += data.imageQueueCount || 0;
        Object.assign(agg.skuMap, data.skuMap || {});
        Object.assign(agg.variantMap, data.variantMap || {});
        if (data.failed?.length) agg.failedDetails.push(...data.failed);
        if (first && typeof data.totalCount === "number") total = data.totalCount;
        first = false;
        if (data.imageQueueCount) enfileirouImagens = true;
        setLote({
          processed: agg.created + agg.skipped + agg.failed,
          total,
          created: agg.created,
          skipped: agg.skipped,
          failed: agg.failed,
        });
        cursor = data.nextCursor || null;
        if (!data.hasMore) break;
      }

      const cancelado = controller.signal.aborted;
      setLote((atual) => (atual ? { ...atual, canceled: cancelado } : atual));
      setDestino(resultado());
      if (enfileirouImagens) void atualizarFilaImagens(targetStoreId);
    } catch (error) {
      const abortou = controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError");
      if (abortou) {
        setLote((atual) => (atual ? { ...atual, canceled: true } : atual));
        setDestino(resultado());
        if (enfileirouImagens) void atualizarFilaImagens(targetStoreId);
      } else {
        // Fica no passo 2 mostrando o erro e o que ja foi criado: tentar de
        // novo continua de onde parou (a API pula o que ja existe).
        setErroCriar(error instanceof Error ? error.message : "Não deu para criar os produtos.");
        if (agg.created + agg.skipped > 0) {
          setDestino(resultado());
          if (enfileirouImagens) void atualizarFilaImagens(targetStoreId);
        }
      }
    } finally {
      setCriando(false);
      abortRef.current = null;
    }
  }

  // ------------------------------------------------------------- passo 3

  async function ativarRota() {
    if (rotaPedidaRef.current) return;
    rotaPedidaRef.current = true;
    setAtivando(true);
    setErroAtivar(null);
    setPasso(3);
    const { vitrine: sourceStoreId, checkout: targetStoreId } = escolha;
    const name = nomePadrao(vitrine, checkout);

    try {
      if (modo === "reuse" || modo === "connect") {
        // Vitrine e loja de checkout ja tem os produtos: casa pelo SKU e cria a rota.
        const res = await fetch("/api/checkout-routes/connect-by-sku", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, sourceStoreId, targetStoreId }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Não deu para casar as lojas pelo SKU.");
        if (!data.route?.public_token) {
          throw new Error("Nenhuma variante casou pelo SKU. Confira se a vitrine já tem os produtos importados.");
        }
        setCasadas(data.matchedCount || 0);
        let diag: DiagnosticoRota = {
          coveragePercent: data.coveragePercent ?? 100,
          missingSkuCount: data.missingSkuCount ?? 0,
          duplicateSkuCount: data.duplicateSkuCount ?? 0,
          duplicateSkus: data.duplicateSkus || [],
          warnings: avisosDaConexao(data),
          stampedSkuCount: data.stampedSkuCount ?? 0,
          dedupedSkuCount: data.dedupedSkuCount ?? 0,
          safeToEnable: data.safeToEnable !== false,
        };
        setDiagnostico(diag);
        setRota({ id: data.route.id || "", token: data.route.public_token, nome: name });
        startTransition(() => router.refresh());

        // Sobrou produto sem par: cria o que falta agora (o mesmo conserto do
        // "Corrigir" da rota), em vez de deixar a cobertura baixa.
        //
        // So com o par de lojas aprovado pelo diagnostico. Rota que nasceu
        // pausada (cobertura < 90% ou SKU repetido) e justamente o caso da loja
        // errada: completar ali despejava a vitrine inteira numa loja de
        // checkout de outro nicho. O lojista ve o aviso e decide no Diagnostico.
        if ((data.unmatchedCount ?? 0) > 0 && data.route?.id && data.safeToEnable === true) {
          const completado = await completarDestino(data.route.id);
          if (completado) {
            diag = { ...diag, ...completado };
            setDiagnostico(diag);
            setCasadas(completado.matchedCount);
          }
        }
        return;
      }

      const res = await fetch("/api/checkout-routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          sourceStoreId,
          targetStoreId,
          mode: "enterprise_static",
          skuMap: destino?.skuMap || {},
          variantMap: destino?.variantMap || {},
          settings: { generatedBy: "connect_wizard" },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Não deu para criar a rota.");
      setRota({ id: data.config?.id || "", token: data.config?.public_token || "", nome: name });
      startTransition(() => router.refresh());
    } catch (error) {
      setErroAtivar(error instanceof Error ? error.message : "Não deu para criar a rota.");
      rotaPedidaRef.current = false;
      // "Só conectar" nao tem passo 2: volta para as lojas.
      setPasso(modo === "connect" ? 1 : 2);
    } finally {
      setAtivando(false);
    }
  }

  // Cria na loja de checkout o que so existe na vitrine e devolve a cobertura
  // recalculada. Falhar aqui nao derruba a rota: so fica o aviso.
  async function completarDestino(id: string) {
    setCompletando(true);
    try {
      // criarFaltantes: o lojista escolheu este par no assistente e o
      // diagnostico aprovou (so chega aqui com safeToEnable). Sem isto, mais
      // de 20 produtos faltando esperariam confirmacao no Diagnostico.
      const res = await fetch("/api/checkout-routes/repair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, criarFaltantes: true }),
      });
      const reparo = await res.json().catch(() => ({}));
      if (!res.ok) return null;
      setCriadosNoConserto({ produtos: reparo.createdProductCount || 0, variantes: reparo.extendedCount || 0 });

      const saude = await fetch("/api/checkout-routes/health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const h = await saude.json().catch(() => ({}));
      if (!saude.ok) return null;

      const avisos = avisosDoTeste(h);
      // A rota so liga sozinha quando o conserto fechou tudo.
      const seguro = avisos.length === 0;
      if (seguro) {
        await fetch("/api/checkout-routes/toggle", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, enabled: true }),
        });
      }
      return {
        coveragePercent: h.coveragePercent ?? 100,
        warnings: avisos,
        safeToEnable: seguro,
        matchedCount: h.mappedCount ?? 0,
      };
    } catch {
      return null;
    } finally {
      setCompletando(false);
    }
  }

  // O lojista pode discordar do diagnostico e ligar assim mesmo -- o que nao
  // pode e ligar sem ter visto o aviso.
  async function ligarMesmoAssim() {
    if (!rota?.id || ligando) return;
    setLigando(true);
    setErroLigar(null);
    try {
      const res = await fetch("/api/checkout-routes/toggle", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: rota.id, enabled: true }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.config?.enabled !== true) throw new Error("toggle");
      setDiagnostico((d) => (d ? { ...d, safeToEnable: true } : d));
      startTransition(() => router.refresh());
    } catch {
      setErroLigar("Não deu para ligar a rota. Ela continua pausada; tente de novo.");
    } finally {
      setLigando(false);
    }
  }

  // ------------------------------------------------------------- tela

  const trilha = passosDoModo(modo);
  const atual = posicaoNaTrilha(modo, passo);
  const ocupado = criando || ativando || completando;
  const problema = problemaDaEscolha(modo, escolha, lojas.length);
  const imagensFeitas = imagens ? imagens.completed + imagens.failed : 0;
  const imagensRodando = imagens ? imagens.pending + imagens.processing > 0 : false;
  const ligacoes =
    modo === "generate" ? Object.keys(destino?.variantMap || {}).length : (casadas ?? 0);

  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <AvisoAoSair ativo={ocupado} aoSair={() => abortRef.current?.abort()} />

      <ol aria-label="Passos" className="flex flex-wrap items-center gap-x-2 gap-y-2">
        {trilha.map((rotulo, i) => {
          const n = i + 1;
          const feito = n < atual || (n === atual && n === trilha.length && Boolean(rota) && !ocupado);
          const corrente = n === atual && !feito;
          return (
            <li key={rotulo} aria-current={corrente ? "step" : undefined} className="flex items-center gap-2">
              <span
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-full border text-label font-semibold",
                  feito && "border-ok-border bg-ok-bg text-ok",
                  corrente && "border-ink bg-solid text-on-solid",
                  !feito && !corrente && "border-border-strong bg-surface text-t2"
                )}
              >
                {feito ? <CheckIcon aria-hidden className="size-3.5" /> : n}
              </span>
              <span className={cn("text-dense", corrente ? "font-semibold text-ink" : "text-t2")}>
                {rotulo}
                {feito ? <span className="sr-only"> (feito)</span> : null}
              </span>
              {n < trilha.length ? <span aria-hidden className="mx-1 h-px w-6 bg-border-strong" /> : null}
            </li>
          );
        })}
      </ol>

      {erroAtivar && passo !== 3 ? (
        <Callout tom="err" titulo="A rota não foi criada">
          {erroAtivar}
        </Callout>
      ) : null}

      {passo === 1 ? (
        <PassoLojas
          lojas={lojas}
          modo={modo}
          onModo={setModo}
          escolha={escolha}
          onEscolher={(papel, id) => setEscolha((e) => ({ ...e, [papel]: id }))}
          opcoes={opcoes}
          onOpcao={(chave, valor) => setOpcoes((o) => ({ ...o, [chave]: valor }))}
          estimativa={estimativa}
          problema={problema}
          onComecar={modo === "connect" ? ativarRota : criarDestino}
        />
      ) : null}

      {passo === 2 ? (
        <PassoCriar
          modo={modo}
          checkout={checkout}
          criando={criando}
          lote={lote}
          destino={destino}
          erro={erroCriar}
          imagens={imagens}
          imagensPct={porcento(imagensFeitas, imagens?.total ?? 0)}
          imagensRodando={imagensRodando}
          onCancelar={() => abortRef.current?.abort()}
          onTentarDeNovo={criarDestino}
          onVoltar={() => {
            setErroCriar(null);
            setPasso(1);
          }}
          onAtivar={ativarRota}
        />
      ) : null}

      {passo === 3 ? (
        <PassoAtivar
          ativando={ativando}
          completando={completando}
          rota={rota}
          ligacoes={ligacoes}
          diagnostico={diagnostico}
          criadosNoConserto={criadosNoConserto}
          ligando={ligando}
          erroLigar={erroLigar}
          onLigarMesmoAssim={ligarMesmoAssim}
          origem={origem}
          imagens={imagens}
          imagensPct={porcento(imagensFeitas, imagens?.total ?? 0)}
          imagensRodando={imagensRodando}
          oferecerRefazerImagens={modo === "generate" && opcoes.neutralize && opcoes.imageMode === "none"}
          onRefazerImagens={() => setRefazerImagens(true)}
        />
      ) : null}

      {refazerImagens ? (
        <SwapImagesDialog open onOpenChange={(v) => !v && setRefazerImagens(false)} storeId={escolha.checkout} storeLabel={checkout} />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

function PassoCriar({
  modo,
  checkout,
  criando,
  lote,
  destino,
  erro,
  imagens,
  imagensPct,
  imagensRodando,
  onCancelar,
  onTentarDeNovo,
  onVoltar,
  onAtivar,
}: {
  modo: Modo;
  checkout: string;
  criando: boolean;
  lote: Lote | null;
  destino: DestinationResult | null;
  erro: string | null;
  imagens: FilaImagens | null;
  imagensPct: number;
  imagensRodando: boolean;
  onCancelar: () => void;
  onTentarDeNovo: () => void;
  onVoltar: () => void;
  onAtivar: () => void;
}) {
  const verbo = modo === "reuse" ? "Copiando" : "Criando";
  const pct = lote ? porcento(lote.processed, lote.total) : 0;
  const falhas = destino?.failedDetails ?? [];

  return (
    <div className="flex flex-col gap-4">
      {criando ? (
        <Section
          titulo={`${verbo} os produtos em ${checkout || "a loja de checkout"}`}
          descricao="Lojas grandes levam alguns minutos. Se você sair desta página, a criação para; o que já foi criado fica salvo."
          aria-busy="true"
          acoes={
            <Button variant="secondary" size="sm" onClick={onCancelar}>
              Cancelar
            </Button>
          }
        >
          {lote && lote.total > 0 ? <Progresso valor={pct} rotulo="Produtos processados" /> : null}
          <p aria-live="polite" className="text-dense text-t1">
            {lote && lote.total > 0
              ? `${lote.processed.toLocaleString("pt-BR")} de ${plural(lote.total, "produto", "produtos")}`
              : lote && lote.processed > 0
                ? `${plural(lote.processed, "produto", "produtos")} até agora`
                : "Contando os produtos da origem…"}
            {lote && (lote.created > 0 || lote.failed > 0)
              ? ` · ${plural(lote.created, "criado", "criados")}${lote.skipped ? ` · ${plural(lote.skipped, "já existia", "já existiam")}` : ""}${lote.failed ? ` · ${lote.failed.toLocaleString("pt-BR")} com falha` : ""}`
              : ""}
          </p>
        </Section>
      ) : null}

      {erro && !criando ? (
        <Callout
          tom="err"
          titulo="A criação parou"
          acao={
            <span className="flex gap-1">
              <Button variant="ghost" size="sm" onClick={onVoltar}>
                Voltar
              </Button>
              <Button size="sm" onClick={onTentarDeNovo}>
                Tentar de novo
              </Button>
            </span>
          }
        >
          {erro}
          {lote && lote.processed > 0
            ? ` Os ${lote.created.toLocaleString("pt-BR")} já criados ficaram salvos; tentar de novo continua de onde parou.`
            : ""}
        </Callout>
      ) : null}

      {destino && !erro && !criando ? (
        <>
          {lote?.canceled ? (
            <Callout tom="info" titulo="Criação cancelada">
              Os produtos já criados ficaram na loja de checkout. Você pode ativar a rota com eles ou tentar de novo.
            </Callout>
          ) : null}
          <dl className="grid grid-cols-3 gap-3">
            {[
              { rotulo: modo === "reuse" ? "Copiados" : "Criados", valor: destino.createdCount },
              { rotulo: "Já existiam", valor: destino.skippedCount },
              { rotulo: "Variantes ligadas", valor: Object.keys(destino.variantMap).length },
            ].map((f) => (
              <div key={f.rotulo} className="flex flex-col gap-1 rounded-card border border-border bg-surface p-4">
                <dt className="text-label text-t2">{f.rotulo}</dt>
                <dd className="num text-kpi text-ink">{f.valor.toLocaleString("pt-BR")}</dd>
              </div>
            ))}
          </dl>

          {destino.failedCount > 0 ? (
            <Callout
              tom="warn"
              titulo={destino.failedCount === 1 ? "1 produto falhou" : `${destino.failedCount.toLocaleString("pt-BR")} produtos falharam`}
              acao={
                <Button variant="secondary" size="sm" onClick={onTentarDeNovo}>
                  Tentar de novo os que falharam
                </Button>
              }
            >
              {falhas.length > 0 ? (
                <ul className="flex flex-col gap-0.5 font-mono text-label">
                  {falhas.slice(0, 5).map((f, i) => (
                    <li key={`${f.sourceHandle}-${i}`} className="break-words">
                      {f.sourceHandle}: {f.error}
                    </li>
                  ))}
                  {falhas.length > 5 ? <li className="font-sans">e mais {falhas.length - 5}</li> : null}
                </ul>
              ) : null}
            </Callout>
          ) : null}

          {imagens && imagens.total > 0 ? (
            <Section titulo="Imagens sem marca" descricao="Seguem trocando no servidor: pode ativar a rota enquanto isso.">
              <Progresso valor={imagensPct} rotulo="Imagens trocadas" />
              <p aria-live="polite" className="text-dense text-t1">
                {imagens.completed.toLocaleString("pt-BR")} de {imagens.total.toLocaleString("pt-BR")} trocadas
                {imagens.failed > 0 ? ` · ${imagens.failed.toLocaleString("pt-BR")} com falha` : ""}
                {imagensRodando ? " · em andamento" : " · concluído"}
              </p>
            </Section>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button size="lg" onClick={onAtivar}>
              Ativar rota
              <ArrowRightIcon aria-hidden />
            </Button>
            <Button variant="ghost" onClick={onVoltar}>
              Voltar
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
