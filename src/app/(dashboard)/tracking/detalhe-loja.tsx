"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Check, ExternalLink, Minus, Plus, X } from "lucide-react";
import clsx from "clsx";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dica } from "@/components/ui/dica";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import {
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import type { DestinoNaTela } from "@/lib/tracking/queries";
import type { DiagnosticoLoja } from "@/lib/tracking/diagnostico";
import { CartaoDestino, FormularioDestino } from "./destinos-ui";
import { respostaJson } from "./resposta";
import {
  ROTULO_DA_SAUDE,
  TOM_DA_SAUDE,
  type Acao,
  type LinhaLoja,
  type Problema,
  type TomSaude,
} from "./resumo";
import {
  aceitamCompra,
  quando,
  recebemCompra,
  textoProblema,
  vereditoDoDestino,
  type Plataforma,
} from "./saude";

// ============================================================================
// Detalhe de uma loja, no painel lateral do Rastreamento.
//
// De cima para baixo: o que fazer (um problema, um botao), o interruptor do
// envio, os pre-requisitos que moram na Shopify e os destinos. Cada acao
// atualiza a tela -- nada de "recarregue a pagina".
//
// O codigo que o lojista copia (pixel do checkout) e as chamadas de instalar e
// de destino sao as mesmas de antes; mudou so a apresentacao.
// ============================================================================

const CAIXA_TOM: Record<TomSaude, string> = {
  err: "border-err-border bg-err-bg",
  warn: "border-warn-border bg-warn-bg",
  ok: "border-ok-border bg-ok-bg",
  neutral: "border-border bg-surface-2",
};
const TEXTO_TOM: Record<TomSaude, string> = {
  err: "text-err",
  warn: "text-warn",
  ok: "text-ok",
  neutral: "text-t1",
};

function rolarAte(id: string) {
  const alvo = document.getElementById(id);
  if (!alvo) return;
  const calmo = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  alvo.scrollIntoView({ block: "start", behavior: calmo ? "auto" : "smooth" });
}

// ---------------------------------------------------------------------------
// Pre-requisitos
// ---------------------------------------------------------------------------

type TomPre = "ok" | "err" | "warn" | "neutral";

const ICONE_PRE: Record<TomPre, { caixa: string; Icone: typeof Check; nome: string }> = {
  ok: { caixa: "border-ok bg-ok text-surface", Icone: Check, nome: "Certo" },
  err: { caixa: "border-err-border bg-err-bg text-err", Icone: X, nome: "Faltando" },
  warn: { caixa: "border-warn-border bg-warn-bg text-warn", Icone: Minus, nome: "Atenção" },
  neutral: { caixa: "border-neutral-border bg-neutral-bg text-neutral", Icone: Minus, nome: "Sem dado" },
};

function LinhaPre({
  id,
  tom,
  titulo,
  sub,
  acao,
  destacado,
  children,
}: {
  id: string;
  tom: TomPre;
  titulo: ReactNode;
  sub: ReactNode;
  acao?: ReactNode;
  destacado?: boolean;
  children?: ReactNode;
}) {
  const { caixa, Icone, nome } = ICONE_PRE[tom];
  return (
    <li
      id={id}
      className={cn(
        "scroll-mt-4 border-b border-border-subtle last:border-b-0",
        destacado && "animate-xc-flash"
      )}
    >
      <div className="flex flex-wrap items-center gap-3 p-3">
        <span
          className={cn("grid size-5 shrink-0 place-items-center rounded-full border", caixa)}
          role="img"
          aria-label={nome}
        >
          <Icone aria-hidden className="size-3" strokeWidth={3} />
        </span>
        <span className="flex min-w-45 flex-1 flex-col gap-0.5">
          <span className="text-dense font-medium text-ink">{titulo}</span>
          <span className="text-label text-t2 text-pretty">{sub}</span>
        </span>
        {acao && <span className="ml-8 flex items-center gap-2 sm:ml-0">{acao}</span>}
      </div>
      {children}
    </li>
  );
}

/**
 * O Custom Pixel do checkout: copiar e colar, nao um botao que instala.
 *
 * `webPixelCreate` pela Admin API responde "No extension found" -- so funciona
 * para app com Web Pixel Extension publicada pelo Shopify CLI. Enquanto o
 * xcart nao tiver essa extensao, colar no admin e o unico caminho. Depois de
 * colado, o pixel se anuncia no primeiro evento e a linha passa sozinha para
 * "Instalado" -- por isso nao ha botao de "ja instalei".
 */
function PixelDoCheckout({
  storeId,
  ativo,
  desatualizado,
  aberto,
  setAberto,
  destacado,
}: {
  storeId: string;
  ativo: boolean;
  desatualizado: boolean;
  aberto: boolean;
  setAberto: (v: boolean) => void;
  destacado: boolean;
}) {
  const estado: "falta" | "antigo" | "atual" = !ativo ? "falta" : desatualizado ? "antigo" : "atual";
  const [codigo, setCodigo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const pedido = useRef(false);
  const areaId = `pixel-codigo-${storeId}`;

  async function buscar() {
    pedido.current = true;
    setErro(null);
    try {
      const r = await fetch(`/api/tracking/pixel?storeId=${encodeURIComponent(storeId)}`);
      const j = await respostaJson(r, "Não deu para gerar o código.");
      if (typeof j.codigo !== "string") throw new Error("Não deu para gerar o código.");
      setCodigo(j.codigo);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não deu para gerar o código.");
      pedido.current = false;
    }
  }

  // Busca quando abre (pelo botao da linha ou pelo "O que fazer").
  useEffect(() => {
    if (!aberto || codigo || pedido.current) return;
    const id = setTimeout(() => void buscar(), 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);

  useEffect(() => {
    if (!copiado) return;
    const id = setTimeout(() => setCopiado(false), 2000);
    return () => clearTimeout(id);
  }, [copiado]);

  async function copiar() {
    if (!codigo) return;
    try {
      await navigator.clipboard.writeText(codigo);
      setCopiado(true);
    } catch {
      toast.error("Não deu para copiar. Selecione o código e copie na mão.");
    }
  }

  return (
    <LinhaPre
      id={`pre-pixel-${storeId}`}
      tom={estado === "atual" ? "ok" : "warn"}
      destacado={destacado}
      titulo={
        <span className="inline-flex items-center gap-1">
          Pixel do checkout
          <Dica rotulo="Para que serve o pixel do checkout">
            O checkout da Shopify não é tema, então o script do xcart não entra lá: sem este
            pixel, Checkout é só o clique no botão e Pagamento não existe. Ele avisa o xcart, e o
            envio sai do servidor; com ele instalado, o checkout que vinha do tema é ignorado.
            Depois de salvar na Shopify, esta linha passa sozinha para Instalado no próximo
            checkout.
          </Dica>
        </span>
      }
      sub={
        estado === "atual"
          ? "Instalado: Checkout e Pagamento vêm do checkout da Shopify."
          : estado === "antigo"
            ? "Código antigo: troque o código do pixel que já existe, não crie um segundo."
            : "Falta instalar: sem ele o checkout e os dados de pagamento não são medidos."
      }
      acao={
        <Button
          size="sm"
          variant="secondary"
          aria-expanded={aberto}
          aria-controls={areaId}
          onClick={() => setAberto(!aberto)}
        >
          {aberto ? "Ocultar código" : estado === "atual" ? "Ver código" : "Ver código para colar"}
        </Button>
      }
    >
      {aberto && (
        <div id={areaId} className="flex flex-col gap-2.5 px-3 pb-3 sm:pl-11">
          {estado === "antigo" ? (
            <ol className="flex list-decimal flex-col gap-1 pl-4.5 text-dense text-t1">
              <li>Na Shopify, abra Configurações › Eventos do cliente.</li>
              <li>Abra o pixel do xcart e apague o código que está lá.</li>
              <li>Cole o código abaixo e clique em Salvar.</li>
            </ol>
          ) : (
            <ol className="flex list-decimal flex-col gap-1 pl-4.5 text-dense text-t1">
              <li>Na Shopify, abra Configurações › Eventos do cliente.</li>
              <li>Clique em Adicionar pixel personalizado e dê o nome “xcart”.</li>
              <li>Cole o código abaixo, salve e clique em Conectar.</li>
            </ol>
          )}

          {erro ? (
            <p role="alert" className="flex flex-wrap items-center gap-2 text-dense text-err">
              {erro}
              <Button size="sm" variant="secondary" onClick={() => void buscar()}>
                Tentar de novo
              </Button>
            </p>
          ) : !codigo ? (
            <p className="flex items-center gap-2 text-dense text-t2">
              <Spinner size={14} /> Gerando o código desta loja…
            </p>
          ) : (
            <div className="relative rounded-control border border-border bg-surface-2">
              {/* Uma linha so, com o id da loja: a logica mora em /xcart-pixel.js. */}
              <pre
                aria-label="Código do pixel do checkout"
                tabIndex={0}
                className="overflow-x-auto p-3 pr-32 font-mono text-label whitespace-pre text-ink focus-visible:outline-2 focus-visible:outline-focus"
              >
                {codigo}
              </pre>
              <Button
                size="sm"
                variant="secondary"
                onClick={copiar}
                className="absolute top-2 right-2"
              >
                {copiado ? "Copiado" : "Copiar código"}
              </Button>
              <span role="status" className="sr-only">
                {copiado ? "Código copiado" : ""}
              </span>
            </div>
          )}
        </div>
      )}
    </LinhaPre>
  );
}

// ---------------------------------------------------------------------------
// O painel
// ---------------------------------------------------------------------------

export interface DetalheLojaProps {
  linha: LinhaLoja;
  diag: DiagnosticoLoja | null;
  /** A conferencia desta loja falhou nesta carga. */
  falhou: boolean;
  /** "Mostrar testes" da tela: os numeros dos destinos seguem a mesma escolha. */
  mostrarTestes: boolean;
  rechecando: boolean;
  /** Busca de novo os numeros no servidor. */
  aoMudar: () => void;
  rechecar: () => void;
  /** Ajuste local do diagnostico depois de instalar o script (sem esperar a Shopify). */
  ajustarDiag: (patch: Partial<DiagnosticoLoja>) => void;
  verEventos: () => void;
}

export function DetalheLoja({
  linha,
  diag,
  falhou,
  mostrarTestes,
  rechecando,
  aoMudar,
  rechecar,
  ajustarDiag,
  verEventos,
}: DetalheLojaProps) {
  const { loja, saude, problemas, principal } = linha;
  const tom = TOM_DA_SAUDE[saude];
  const id = loja.storeId;

  const [editando, setEditando] = useState<DestinoNaTela | null>(null);
  const [adicionando, setAdicionando] = useState<Plataforma | null>(null);
  const [pixelAberto, setPixelAberto] = useState(false);
  const [destaque, setDestaque] = useState<string | null>(null);
  const [instalando, setInstalando] = useState<"script" | "remarketing" | null>(null);
  const [envio, setEnvio] = useState<boolean | null>(null);
  const [confirmarDesligar, setConfirmarDesligar] = useState(false);

  // O interruptor responde na hora; quando o servidor confirma, volta a seguir a prop.
  if (envio !== null && envio === loja.ligado) setEnvio(null);
  const ligadoNaTela = envio ?? loja.ligado;

  useEffect(() => {
    if (!destaque) return;
    const t = setTimeout(() => setDestaque(null), 2000);
    return () => clearTimeout(t);
  }, [destaque]);

  const temGoogle = loja.destinos.some((d) => d.plataforma === "google" && d.ativo);
  // Varias contas da mesma plataforma e seguro, e o motivo nao e obvio.
  const variasContas = (["google", "meta"] as const).some(
    (p) => loja.destinos.filter((d) => d.plataforma === p).length > 1
  );
  const podeLigar = aceitamCompra(loja).length > 0;
  const recebem = new Set(recebemCompra(loja).map((d) => d.id));
  // Sem o app, ou com o envio desligado, a Shopify nao foi consultada.
  const alcancavel = loja.ligado && !loja.desinstalada;

  function destacar(alvo: string, elemento: string) {
    setDestaque(alvo);
    requestAnimationFrame(() => rolarAte(elemento));
  }

  async function instalarScript(remarketing: boolean) {
    setInstalando(remarketing ? "remarketing" : "script");
    try {
      // Reinstalar o script sem pedir o remarketing tiraria a tag de quem ja tem.
      const manterRemarketing = remarketing || (diag?.temRemarketing === true && temGoogle);
      const r = await fetch("/api/tracking/snippet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId: id, remarketing: manterRemarketing }),
      });
      const j = await respostaJson(r, "Não deu para gravar no tema.");
      toast.success(remarketing ? "Remarketing ligado no tema" : "Script gravado no tema", {
        description: j.mudou
          ? `Gravado no tema publicado “${j.temaNome}”.`
          : "O tema publicado já estava assim.",
      });
      ajustarDiag({
        temSnippet: true,
        snippetComId: true,
        ...(manterRemarketing ? { temRemarketing: true } : {}),
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não deu para gravar no tema.");
    } finally {
      setInstalando(null);
    }
  }

  async function mudarEnvio(ligar: boolean) {
    setEnvio(ligar);
    try {
      const r = await fetch("/api/tracking/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId: id, enabled: ligar }),
      });
      await respostaJson(r, "Não deu para salvar.");
      toast.success(ligar ? "Envio de compras ligado" : "Envio de compras desligado", {
        description: ligar
          ? "Cada pedido novo vira compra nos destinos desta loja."
          : "As compras desta loja param de chegar ao Meta e ao Google.",
      });
      aoMudar();
    } catch (e) {
      setEnvio(null);
      toast.error(e instanceof Error ? e.message : "Não deu para salvar.");
      throw e;
    }
  }

  function agir(a: Acao) {
    switch (a.tipo) {
      case "editar-destino": {
        const d = loja.destinos.find((x) => x.id === a.destinoId);
        if (d) setEditando(d);
        return;
      }
      case "ver-destino":
        if (a.destinoId) destacar(a.destinoId, `destino-${a.destinoId}`);
        return;
      case "webhook":
        destacar("webhook", `pre-webhook-${id}`);
        return;
      case "script":
        void instalarScript(false);
        return;
      case "pixel":
        setPixelAberto(true);
        destacar("pixel", `pre-pixel-${id}`);
        return;
      case "recarregar":
        aoMudar();
        return;
      case "rechecar":
        rechecar();
        return;
      case "ligar":
        void mudarEnvio(true).catch(() => {});
        return;
      case "eventos":
        verEventos();
        return;
      default:
        return;
    }
  }

  /** O botao de um problema. Funcao, nao componente: nao remonta a cada render. */
  function botaoAcao(acao: Acao, primario: boolean) {
    const variante = primario ? "primary" : "secondary";
    if (acao.tipo === "abrir-lojas") {
      return (
        <Link href="/stores" className={buttonVariants({ variant: variante, size: "md" })}>
          {acao.rotulo}
        </Link>
      );
    }
    if (acao.tipo === "adicionar-destino") {
      return <MenuAdicionar rotulo={acao.rotulo} variante={variante} onEscolher={setAdicionando} />;
    }
    const pendente =
      (acao.tipo === "script" && instalando === "script") ||
      (acao.tipo === "rechecar" && rechecando) ||
      (acao.tipo === "ligar" && envio === true);
    return (
      <Button variant={variante} pending={pendente} onClick={() => agir(acao)}>
        {acao.rotulo}
      </Button>
    );
  }

  // ---- pre-requisitos ------------------------------------------------------

  const semConferir = !loja.ligado
    ? "Ligue o envio de compras para conferir."
    : loja.desinstalada
      ? "Reinstale o app nesta loja para conferir."
      : falhou || !diag
        ? "Não deu para verificar agora."
        : null;

  const aviso: { tom: TomPre; sub: ReactNode } = semConferir
    ? { tom: "neutral", sub: semConferir }
    : diag!.temWebhook === true
      ? { tom: "ok", sub: "Inscrito: cada pedido novo chega ao xcart e vira compra." }
      : diag!.temWebhook === false
        ? {
            tom: "err",
            sub: (
              <>
                Não inscrito: os pedidos não viram compra. A inscrição acontece quando o app é
                instalado; reinstalar o app em{" "}
                <Link href="/stores" className="font-medium text-ink underline underline-offset-2">
                  Lojas
                </Link>{" "}
                inscreve de novo.
              </>
            ),
          }
        : { tom: "neutral", sub: `Não deu para verificar. ${textoProblema(diag!.problema)}` };

  const script: { tom: TomPre; sub: string } = semConferir
    ? { tom: "neutral", sub: semConferir }
    : diag!.temSnippet == null
      ? { tom: "neutral", sub: "Não deu para verificar o tema publicado." }
      : diag!.temSnippet === false
        ? {
            tom: "err",
            sub: "Faltando: ver produto e carrinho não saem, e o clique do anúncio não chega ao pedido.",
          }
        : diag!.snippetComId === false
          ? { tom: "warn", sub: "Versão antiga: a nova protege os eventos desta loja." }
          : { tom: "ok", sub: "Instalado no tema publicado." };

  const remarketing: { tom: TomPre; sub: string } = semConferir
    ? { tom: "neutral", sub: semConferir }
    : !temGoogle
      ? { tom: "neutral", sub: "Cadastre uma conta do Google Ads nesta loja antes de ligar." }
      : diag!.temRemarketing == null
        ? { tom: "neutral", sub: "Não deu para verificar o tema publicado." }
        : diag!.temRemarketing
          ? { tom: "ok", sub: "Ligado: monta o público de remarketing no Google." }
          : {
              tom: "neutral",
              sub: "Desligado: só serve para públicos de remarketing. A conversão funciona sem ele.",
            };

  const outros = problemas.filter((p) => p !== principal);

  return (
    <SheetContent side="right" size="lg">
      <SheetHeader className="gap-1.5">
        <StatusBadge tom={tom} texto={ROTULO_DA_SAUDE[saude]} />
        <SheetTitle>{loja.nome}</SheetTitle>
        <SheetDescription>
          <span className="font-mono">{loja.dominio}</span> · últimos 7 dias
          {loja.ultimoEnvio ? (
            <span suppressHydrationWarning> · último envio {quando(loja.ultimoEnvio)}</span>
          ) : null}
        </SheetDescription>
      </SheetHeader>

      <SheetBody className="flex flex-col gap-6 px-5 pb-8">
        {principal && (
          <section
            aria-labelledby={`fazer-${id}`}
            className={cn("flex flex-col gap-2.5 rounded-card border p-3.5", CAIXA_TOM[principal.tom])}
          >
            <h3 id={`fazer-${id}`} className={clsx("text-dense font-semibold", TEXTO_TOM[principal.tom])}>
              O que fazer
            </h3>
            <p className="text-dense font-medium text-ink text-pretty">{principal.texto}</p>
            {principal.detalhe && (
              <p className="text-dense break-words text-t1 text-pretty">{principal.detalhe}</p>
            )}
            {principal.acao && (
              <div>
                {botaoAcao(principal.acao, true)}
              </div>
            )}
            {outros.length > 0 && (
              <div className="mt-1 flex flex-col gap-1 border-t border-border-subtle pt-2.5">
                <p className="text-label font-semibold text-t1">
                  {outros.length === 1 ? "Também nesta loja" : `Também nesta loja (${outros.length})`}
                </p>
                <ul className="flex flex-col gap-1">
                  {outros.map((p: Problema, i) => (
                    <li key={i} className="flex items-start gap-2 text-label text-t1">
                      <span
                        aria-hidden
                        className={cn(
                          "mt-1.5 size-1.5 shrink-0 rounded-full",
                          p.tom === "err" ? "bg-err" : "bg-warn"
                        )}
                      />
                      <span className="text-pretty">{p.texto}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        <section aria-labelledby={`envio-${id}`} className="flex flex-col gap-2">
          <h3 id={`envio-${id}`} className="text-dense font-semibold text-ink">
            Envio de compras
          </h3>
          <div className="rounded-card border border-border p-3">
            <Switch
              rotulo="Enviar as compras desta loja"
              descricao={
                ligadoNaTela
                  ? "Ligado: cada pedido novo vira compra nos destinos desta loja."
                  : podeLigar
                    ? "Desligado. Os destinos estão prontos para receber."
                    : "Para ligar, um destino precisa receber a compra: no Google o rótulo da compra, no Meta o token de conversões."
              }
              checked={ligadoNaTela}
              disabled={envio !== null || (!loja.ligado && !podeLigar)}
              onCheckedChange={(v) => {
                if (v) void mudarEnvio(true).catch(() => {});
                else setConfirmarDesligar(true);
              }}
            />
          </div>
          <ConfirmDialog
            open={confirmarDesligar}
            onOpenChange={setConfirmarDesligar}
            titulo={`Desligar o envio de compras de ${loja.nome}?`}
            descricao="As compras param de chegar ao Meta e ao Google até você religar."
            confirmar="Desligar envio"
            mensagemErro="Não deu para desligar agora. Tente de novo."
            onConfirmar={() => mudarEnvio(false)}
          />
        </section>

        <section aria-labelledby={`pre-${id}`} className="flex flex-col gap-2">
          <h3 id={`pre-${id}`} className="flex items-center gap-1 text-dense font-semibold text-ink">
            Pré-requisitos
            {alcancavel && (
              <Dica rotulo="Onde instalar grava">
                Instalar e reinstalar gravam no tema publicado da loja.
              </Dica>
            )}
          </h3>
          <ul className="rounded-card border border-border">
            <LinhaPre
              id={`pre-webhook-${id}`}
              tom={aviso.tom}
              destacado={destaque === "webhook"}
              titulo="Aviso de pedidos da Shopify"
              sub={aviso.sub}
            />
            <LinhaPre
              id={`pre-script-${id}`}
              tom={script.tom}
              titulo="Script no tema da loja"
              sub={script.sub}
              acao={
                alcancavel ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    pending={instalando === "script"}
                    disabled={instalando !== null}
                    onClick={() => void instalarScript(false)}
                  >
                    {diag?.temSnippet ? "Reinstalar" : "Instalar"}
                  </Button>
                ) : null
              }
            />
            <LinhaPre
              id={`pre-remarketing-${id}`}
              tom={remarketing.tom}
              titulo={
                <>
                  Remarketing do Google <span className="font-normal text-t2">(opcional)</span>
                </>
              }
              sub={remarketing.sub}
              acao={
                alcancavel && temGoogle ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    pending={instalando === "remarketing"}
                    disabled={instalando !== null}
                    onClick={() => void instalarScript(true)}
                  >
                    {diag?.temRemarketing ? "Reinstalar" : "Ligar"}
                  </Button>
                ) : null
              }
            />
            <PixelDoCheckout
              storeId={id}
              ativo={loja.pixelCheckoutAtivo}
              desatualizado={loja.pixelCheckoutDesatualizado}
              aberto={pixelAberto}
              setAberto={setPixelAberto}
              destacado={destaque === "pixel"}
            />
          </ul>
        </section>

        <section aria-labelledby={`dest-${id}`} className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <h3 id={`dest-${id}`} className="flex items-center gap-1 text-dense font-semibold text-ink">
              Destinos
              {variasContas && (
                <Dica rotulo="Várias contas na mesma loja">
                  Cada conta recebe todos os eventos da loja; no Google, só a conta dona do
                  clique conta a conversão. Os números aqui são por conta, nunca somados.
                </Dica>
              )}
            </h3>
            <MenuAdicionar rotulo="Adicionar destino" variante="secondary" tamanho="sm" onEscolher={setAdicionando} />
          </div>
          {loja.destinos.length === 0 ? (
            <EmptyState
              variante="tracejado"
              titulo="Nenhum destino ainda"
              descricao="Adicione um pixel do Meta ou uma conta do Google Ads."
            />
          ) : (
            <div className="flex flex-col gap-3">
              {loja.destinos.map((d) => (
                <CartaoDestino
                  key={d.id}
                  destino={d}
                  veredito={loja.ligado && recebem.has(d.id) ? vereditoDoDestino(d, loja, diag) : null}
                  mostrarTestes={mostrarTestes}
                  semContagem={loja.contagemIndisponivel}
                  destacado={destaque === d.id}
                  onEditar={() => setEditando(d)}
                  aoMudar={aoMudar}
                />
              ))}
            </div>
          )}
        </section>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Button variant="link" className="px-0!" onClick={verEventos}>
            Ver todos os eventos de {loja.nome}
          </Button>
          <a
            href={`https://${loja.dominio}`}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-dense text-t1 hover:text-ink"
          >
            Abrir loja
            <ExternalLink aria-hidden className="size-3.5" />
            <span className="sr-only">(abre em outra aba)</span>
          </a>
        </div>
      </SheetBody>

      {editando && (
        <FormularioDestino
          key={editando.id}
          storeId={id}
          plataforma={editando.plataforma}
          destino={editando}
          aberto
          onFechar={() => setEditando(null)}
          aoSalvar={aoMudar}
        />
      )}
      {adicionando && (
        <FormularioDestino
          key={`novo-${adicionando}`}
          storeId={id}
          plataforma={adicionando}
          aberto
          onFechar={() => setAdicionando(null)}
          aoSalvar={aoMudar}
        />
      )}
    </SheetContent>
  );
}

function MenuAdicionar({
  rotulo,
  variante,
  tamanho = "md",
  onEscolher,
}: {
  rotulo: string;
  variante: "primary" | "secondary";
  tamanho?: "sm" | "md";
  onEscolher: (p: Plataforma) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant={variante} size={tamanho} />}>
        <Plus aria-hidden />
        {rotulo}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem onClick={() => onEscolher("meta")}>Pixel do Meta</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onEscolher("google")}>Conta do Google Ads</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
