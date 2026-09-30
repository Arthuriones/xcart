"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  CircleAlert,
  ExternalLink,
  Loader2,
  Minus,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EVENTOS, type ChaveEvento } from "@/lib/tracking/eventos";
import type { ContagemDestino, LojaTracking } from "@/lib/tracking/queries";
import type { DiagnosticoLoja } from "@/lib/tracking/diagnostico";

// ============================================================================
// Tela de rastreamento.
//
// A pergunta que ela responde nao e "esta configurado?" -- e "esta chegando?".
// Sao coisas diferentes: o endpoint de conversao do Google responde 200 mesmo
// quando ignora o conteudo, entao configuracao correta e envio bem-sucedido
// convivem com zero conversao contada do outro lado.
//
// Por isso o desenho poe o VEREDITO no topo de cada loja, com a comparacao que
// de fato denuncia ("3 pedidos, 0 compras enviadas"), e empurra os campos para
// baixo. Configuracao e o que se mexe uma vez; saude e o que se olha sempre.
// ============================================================================

function Pill({
  tom,
  children,
}: {
  tom: "ok" | "alerta" | "erro" | "neutro";
  children: React.ReactNode;
}) {
  const cor =
    tom === "ok"
      ? "bg-emerald-500/15 text-emerald-600"
      : tom === "alerta"
        ? "bg-amber-500/15 text-amber-600"
        : tom === "erro"
          ? "bg-destructive/15 text-destructive"
          : "bg-muted text-muted-foreground";
  return (
    <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${cor}`}>
      {children}
    </span>
  );
}

/** Um pre-requisito que mora na Shopify, com o comando que conserta. */
function Checagem({
  ok,
  rotulo,
  conserto,
}: {
  ok: boolean | null;
  rotulo: string;
  conserto: string;
}) {
  if (ok === null) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Minus className="h-3.5 w-3.5" />
        {rotulo}: não deu para verificar
      </span>
    );
  }
  if (ok) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Check className="h-3.5 w-3.5 text-emerald-600" />
        {rotulo}
      </span>
    );
  }
  return (
    <span
      className="flex items-center gap-1.5 text-xs font-medium text-destructive"
      title={conserto}
    >
      <CircleAlert className="h-3.5 w-3.5" />
      {rotulo}: faltando
    </span>
  );
}

/**
 * O veredito da loja.
 *
 * Compara a COMPRA com os pedidos, nao o total de eventos: carrinho e checkout
 * acontecem muito mais que venda, e somados dariam "300 de 4 pedidos", que nao
 * diz nada. A contagem ja vem separada por destino, senao uma venda com Google e
 * Meta ligados apareceria como duas compras.
 */
function Veredito({
  loja,
  diag,
}: {
  loja: LojaTracking;
  diag: DiagnosticoLoja | null;
}) {
  const temGoogle = Boolean(loja.googleConversionId && loja.googleLabels.purchase);
  const temMeta = Boolean(loja.metaPixelId && loja.temTokenMeta);

  if (!temGoogle && !temMeta) {
    return (
      <div className="flex items-start gap-2 rounded-md bg-muted/60 p-2.5 text-xs">
        <Minus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-muted-foreground">
          Nenhum destino recebe a compra ainda. Preencha o Google, o Meta, ou os dois.
        </span>
      </div>
    );
  }

  const pedidos = diag?.pedidos7d ?? null;
  const comprasGoogle = loja.google.porEvento.purchase ?? 0;
  const comprasMeta = loja.meta.porEvento.purchase ?? 0;

  // Cada destino e julgado sozinho: o Google pode estar chegando e o Meta nao.
  const faltando: string[] = [];
  if (pedidos !== null && pedidos >= 3) {
    if (temGoogle && comprasGoogle === 0) faltando.push("Google");
    if (temMeta && comprasMeta === 0) faltando.push("Meta");
  }

  if (faltando.length > 0) {
    return (
      <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-2.5 text-xs">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
        <div>
          <p className="font-medium text-destructive">
            {pedidos} pedidos em 7 dias e nenhuma compra chegou no{" "}
            {faltando.join(" nem no ")}.
          </p>
          <p className="text-muted-foreground">
            {diag?.temWebhook === false
              ? "O webhook de pedidos não está inscrito — é quase certo que seja isso."
              : "Confira o rótulo da compra e, no Meta, o token do CAPI."}
          </p>
        </div>
      </div>
    );
  }

  const total = comprasGoogle + comprasMeta;
  const sobrando =
    pedidos !== null && pedidos > 0
      ? Math.max(0, pedidos - Math.max(comprasGoogle, comprasMeta))
      : 0;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md bg-muted/60 p-2.5 text-xs">
      <span className="flex items-center gap-1.5">
        <Check className="h-3.5 w-3.5 text-emerald-600" />
        <span className="text-muted-foreground">
          {pedidos !== null ? (
            <>
              <strong className="text-foreground">{pedidos}</strong> pedidos em 7 dias
            </>
          ) : (
            "pedidos: não deu para verificar"
          )}
        </span>
      </span>
      {temGoogle && (
        <span className="text-muted-foreground">
          Google: <strong className="text-foreground">{comprasGoogle}</strong> compras
        </span>
      )}
      {temMeta && (
        <span className="text-muted-foreground">
          Meta: <strong className="text-foreground">{comprasMeta}</strong> compras
        </span>
      )}
      {sobrando > 0 && total > 0 && (
        <span className="text-amber-600">
          {sobrando} sem conversão — normal se vieram de fora do anúncio
        </span>
      )}
      <Atribuicao loja={loja} />
    </div>
  );
}

/**
 * Quantas COMPRAS foram creditadas a um anuncio.
 *
 * E a leitura que o total de "sem click id" esconde. Trafego organico sem click
 * id e normal e enche o numero geral; venda sem click id quer dizer que aquela
 * venda nao foi creditada a campanha nenhuma. Se TODAS estiverem assim, ou o
 * trafego nao veio de anuncio, ou a captura quebrou -- e sao conclusoes bem
 * diferentes.
 */
function Atribuicao({ loja }: { loja: LojaTracking }) {
  const total =
    (loja.google.porEvento.purchase ?? 0) + (loja.meta.porEvento.purchase ?? 0);
  if (total === 0) return null;

  const semClique =
    (loja.google.semAtribPorEvento.purchase ?? 0) +
    (loja.meta.semAtribPorEvento.purchase ?? 0);
  if (semClique === 0) return null;

  const todas = semClique >= total;
  return (
    <span className={todas ? "text-amber-600" : "text-muted-foreground"}>
      {semClique} de {total} compras sem click id
      {todas ? " — nenhuma venda foi creditada a um anúncio" : ""}
    </span>
  );
}

/** Uma linha de evento: nome, quanto saiu, e o campo do rotulo quando ha um. */
function LinhaEvento({
  chave,
  nome,
  descricao,
  enviados,
  mostrarCampo,
  valor,
  onChange,
}: {
  chave: ChaveEvento;
  nome: string;
  descricao: string;
  enviados: number;
  mostrarCampo: boolean;
  valor?: string;
  onChange?: (v: string) => void;
}) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)] sm:items-center">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm">{nome}</span>
          {enviados > 0 && (
            <span className="font-mono text-[11px] text-muted-foreground">
              {enviados} em 7d
            </span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">{descricao}</p>
      </div>
      {mostrarCampo ? (
        <Input
          value={valor ?? ""}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder="rótulo — vazio não rastreia"
          className="h-8 font-mono text-xs"
          aria-label={`Rótulo de ${nome}`}
        />
      ) : (
        <span className="text-[11px] text-muted-foreground sm:text-right">
          coberto pelo pixel
        </span>
      )}
      <input type="hidden" value={chave} readOnly />
    </div>
  );
}

function Erros({ c, nome }: { c: ContagemDestino; nome: string }) {
  if (c.falharam === 0 && c.pendentes === 0 && c.semAtribuicao === 0) return null;
  return (
    <div className="space-y-0.5 text-[11px]">
      {c.pendentes > 0 && (
        <p className="text-amber-600">{c.pendentes} na fila, aguardando reenvio</p>
      )}
      {c.falharam > 0 && (
        <p className="text-destructive" title={c.ultimoErro ?? undefined}>
          {c.falharam} falharam{c.ultimoErro ? ` — ${c.ultimoErro.slice(0, 90)}` : ""}
        </p>
      )}
      {c.semAtribuicao > 0 && (
        <p className="text-muted-foreground">
          {c.semAtribuicao} sem click id: chegam no {nome}, sem ligação com anúncio
        </p>
      )}
    </div>
  );
}

function CardLoja({
  loja,
  diag,
  comecarAberto,
}: {
  loja: LojaTracking;
  diag: DiagnosticoLoja | null;
  comecarAberto: boolean;
}) {
  const [aberto, setAberto] = useState(comecarAberto);
  const [id, setId] = useState(loja.googleConversionId ?? "");
  const [rotulos, setRotulos] = useState<Record<string, string>>(() => {
    const inicial: Record<string, string> = {};
    for (const e of EVENTOS) inicial[e.chave] = loja.googleLabels[e.chave] ?? "";
    return inicial;
  });
  const [pixel, setPixel] = useState(loja.metaPixelId ?? "");
  // Comeca vazio SEMPRE, mesmo com token gravado: o valor nunca sai do servidor.
  const [tokenMeta, setTokenMeta] = useState("");
  const [ligado, setLigado] = useState(loja.ligado);
  const [salvando, setSalvando] = useState(false);
  const [instalando, setInstalando] = useState<string | null>(null);

  const quantosRotulos = Object.values(rotulos).filter((v) => v.trim()).length;
  const googlePronto = Boolean(id.trim()) && quantosRotulos > 0;
  const metaPronto =
    Boolean(pixel.trim()) && (loja.temTokenMeta || Boolean(tokenMeta.trim()));

  /**
   * Instala a tag no tema pela tela.
   *
   * Antes isto so existia como script, entao ligar rastreamento numa loja nova
   * dependia de alguem com o repo na mao -- e sem a tag no tema o gclid nunca
   * vira cart attribute e o funil inteiro nao sai, com a configuracao parecendo
   * perfeita aqui.
   */
  async function instalarTag(comRemarketing: boolean) {
    setInstalando(comRemarketing ? "remarketing" : "snippet");
    try {
      const r = await fetch("/api/tracking/snippet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId: loja.storeId, remarketing: comRemarketing }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Falha ao gravar o tema.");
      toast.success(
        j.mudou
          ? `Tag gravada no tema "${j.temaNome}".`
          : "O tema já estava assim."
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao gravar o tema.");
    } finally {
      setInstalando(null);
    }
  }

  async function salvar(novoLigado: boolean) {
    setSalvando(true);
    try {
      const r = await fetch("/api/tracking/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: loja.storeId,
          enabled: novoLigado,
          googleConversionId: id,
          googleLabels: rotulos,
          metaPixelId: pixel,
          // Vazio = nao mexer no que esta gravado.
          metaAccessToken: tokenMeta,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Falha ao salvar.");
      setLigado(novoLigado);
      if (tokenMeta.trim()) setTokenMeta("");
      toast.success(novoLigado ? "Rastreamento ligado." : "Salvo.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Card className={ligado ? "" : "border-dashed"}>
      <CardContent className="space-y-3 p-4">
        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          className="flex w-full items-center justify-between gap-3 text-left"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium">{loja.nome}</span>
            {ligado ? (
              <Pill tom="ok">ativo</Pill>
            ) : (
              <Pill tom="neutro">desligado</Pill>
            )}
            {ligado && diag?.temWebhook === false && <Pill tom="erro">sem webhook</Pill>}
            {ligado && diag?.temSnippet === false && <Pill tom="erro">sem snippet</Pill>}
          </span>
          <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
            {loja.dominio}
            <ChevronDown
              className={`h-4 w-4 transition-transform ${aberto ? "rotate-180" : ""}`}
            />
          </span>
        </button>

        {aberto && (
          <div className="space-y-4 border-t pt-3">
            {ligado && <Veredito loja={loja} diag={diag} />}

            {/* Os dois pre-requisitos que moram na Shopify. Sem eles a
                configuracao pode estar perfeita e nada acontecer. */}
            {ligado && (
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
                <Checagem
                  ok={diag?.temWebhook ?? null}
                  rotulo="Webhook de pedidos"
                  conserto="npm run op -- scripts/registrar-webhook-pedidos.ts --aplicar"
                />
                <Checagem
                  ok={diag?.temSnippet ?? null}
                  rotulo="Snippet no tema"
                  conserto="npm run op -- scripts/instalar-snippet-click.ts <dominio> --aplicar"
                />
                <Checagem
                  ok={diag?.temRemarketing ?? null}
                  rotulo="Tag de remarketing"
                  conserto="npm run op -- scripts/instalar-snippet-click.ts <dominio> --aplicar --remarketing"
                />
                <a
                  href={`https://${loja.dominio}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                >
                  abrir loja
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}

            {/* Os dois botoes que antes so existiam como script. Ficam sempre
                visiveis, nao so quando falta algo: reinstalar tambem serve para
                atualizar uma tag antiga (instalacao sem data-xcart-store) e para
                depois de trocar de tema, que apaga a tag junto. */}
            {ligado && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => instalarTag(false)}
                  disabled={instalando !== null}
                >
                  {instalando === "snippet" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : diag?.temSnippet ? (
                    "Reinstalar snippet"
                  ) : (
                    "Instalar snippet"
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => instalarTag(true)}
                  disabled={instalando !== null || !id.trim()}
                  title={
                    !id.trim()
                      ? "Preencha o ID de conversão do Google e salve antes"
                      : undefined
                  }
                >
                  {instalando === "remarketing" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : diag?.temRemarketing ? (
                    "Reinstalar com remarketing"
                  ) : (
                    "Ligar remarketing"
                  )}
                </Button>
                <span className="text-[11px] text-muted-foreground">
                  grava no tema publicado — recarregue a página para atualizar as
                  checagens
                </span>
              </div>
            )}

            {/* ---------------- Google ---------------- */}
            <section className="space-y-2.5 rounded-md border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold">Google Ads</span>
                <Pill tom={googlePronto ? "ok" : "neutro"}>
                  {googlePronto ? "configurado" : "não configurado"}
                </Pill>
              </div>

              <div className="space-y-1">
                <Label className="text-[11px]">ID de conversão da conta</Label>
                <Input
                  value={id}
                  onChange={(e) => setId(e.target.value)}
                  placeholder="AW-123456789"
                  className="h-8 max-w-[16rem] font-mono text-xs"
                />
              </div>

              {/* Um rotulo por evento porque no Google cada evento e uma
                  conversion action propria. Deixar vazio e como dizer "nao quero
                  este evento" -- nao existe um interruptor separado que possa
                  ficar fora de sincronia com o rotulo. */}
              <div className="space-y-2">
                {EVENTOS.map((ev) => (
                  <LinhaEvento
                    key={ev.chave}
                    chave={ev.chave}
                    nome={ev.nome}
                    descricao={ev.descricao}
                    enviados={loja.google.porEvento[ev.chave] ?? 0}
                    mostrarCampo
                    valor={rotulos[ev.chave]}
                    onChange={(v) =>
                      setRotulos((atual) => ({ ...atual, [ev.chave]: v }))
                    }
                  />
                ))}
              </div>

              <p className="text-[11px] text-muted-foreground">
                Google Ads → Objetivos → Conversões. Uma ação por evento; copie o rótulo
                de cada uma. Deixe <strong>compra</strong> como principal e as outras
                como <strong>secundárias</strong>, senão o lance passa a otimizar para
                carrinho em vez de venda.
              </p>

              {/* Isto confunde todo mundo uma vez, entao esta escrito: publico de
                  remarketing nao vem daqui. */}
              <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Estes rótulos são <strong>conversão</strong>, não remarketing. Público
                  de remarketing o Google só monta com a tag no navegador — o envio do
                  servidor não coloca ninguém em lista. É a checagem
                  &quot;Tag de remarketing&quot; acima.
                </span>
              </p>

              <Erros c={loja.google} nome="Google" />
            </section>

            {/* ---------------- Meta ---------------- */}
            <section className="space-y-2.5 rounded-md border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold">Meta (Facebook / Instagram)</span>
                <Pill tom={metaPronto ? "ok" : "neutro"}>
                  {metaPronto ? "configurado" : "não configurado"}
                </Pill>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-[11px]">ID do pixel</Label>
                  <Input
                    value={pixel}
                    onChange={(e) => setPixel(e.target.value)}
                    placeholder="1234567890123456"
                    className="h-8 font-mono text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Token do CAPI</Label>
                  <Input
                    type="password"
                    value={tokenMeta}
                    onChange={(e) => setTokenMeta(e.target.value)}
                    placeholder={
                      loja.temTokenMeta ? "gravado — vazio mantém" : "EAA..."
                    }
                    className="h-8 font-mono text-xs"
                    autoComplete="off"
                  />
                </div>
              </div>

              {/* No Meta um pixel cobre TODOS os eventos -- nao ha rotulo por
                  evento. Entao aqui nao ha formulario, so o que saiu.
                  Compacto de proposito: a lista longa com descricao ja aparece
                  no painel do Google logo acima, e repetir os mesmos quatro
                  textos dobrava a altura do card sem dizer nada novo. */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
                {EVENTOS.map((ev) => {
                  const n = loja.meta.porEvento[ev.chave] ?? 0;
                  return (
                    <span
                      key={ev.chave}
                      className={n > 0 ? "text-foreground" : "text-muted-foreground"}
                      title={`enviado como ${ev.nomeNoMeta}`}
                    >
                      {ev.nome} <strong className="font-mono">{n}</strong>
                    </span>
                  );
                })}
                <span className="text-muted-foreground">em 7 dias</span>
              </div>

              <p className="text-[11px] text-muted-foreground">
                O pixel cobre os quatro eventos — não precisa rótulo por evento. Um token
                novo substitui o anterior; vazio mantém o que está gravado.
              </p>

              {metaPronto && (
                /* O Meta deduplica por event_id, e um pixel de navegador nao
                   conhece o id que o nosso servidor gera. Os dois contam dobrado. */
                <p className="flex items-start gap-1.5 text-[11px] text-amber-600">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Desligue o pixel do Meta no tema e o canal Facebook &amp; Instagram da
                  Shopify: junto com este, a mesma ação conta duas vezes.
                </p>
              )}

              <Erros c={loja.meta} nome="Meta" />
            </section>

            <div className="flex items-center gap-2">
              <Button
                onClick={() => salvar(ligado)}
                disabled={salvando}
                variant="outline"
                size="sm"
              >
                {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
              </Button>
              <Button
                onClick={() => salvar(!ligado)}
                disabled={salvando || (!ligado && !googlePronto && !metaPronto)}
                variant={ligado ? "outline" : "default"}
                size="sm"
              >
                {ligado ? "Desligar" : "Ligar"}
              </Button>
              {!ligado && !googlePronto && !metaPronto && (
                <span className="text-[11px] text-muted-foreground">
                  preencha o Google ou o Meta para poder ligar
                </span>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function TrackingScreen({
  lojas,
  diagnostico,
}: {
  lojas: LojaTracking[];
  diagnostico: Record<string, DiagnosticoLoja>;
}) {
  const [mostrarTodas, setMostrarTodas] = useState(false);

  const ativas = lojas.filter((l) => l.ligado);
  const inativas = lojas.filter((l) => !l.ligado);

  // MAX entre os destinos, nao soma.
  //
  // A mesma venda rende uma linha no Google e outra no Meta. Somar mostraria "8"
  // para 4 vendas -- o mesmo erro de contagem que a tela corrige la embaixo, so
  // que reaparecendo no lugar mais visivel da pagina. O max responde "quantas
  // vendas sairam para pelo menos um destino", que e a pergunta util.
  const vendasRastreadas = ativas.reduce(
    (s, l) =>
      s +
      Math.max(l.google.porEvento.purchase ?? 0, l.meta.porEvento.purchase ?? 0),
    0
  );
  const comProblema = ativas.filter(
    (l) =>
      diagnostico[l.storeId]?.temWebhook === false ||
      diagnostico[l.storeId]?.temSnippet === false
  ).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Rastreamento</h1>
          <p className="text-sm text-muted-foreground">
            A conversão sai do servidor — a compra pelo webhook do pedido, e carrinho e
            checkout pelo snippet do tema avisando o xcart.
          </p>
        </div>
        {ativas.length > 0 && (
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>
              <strong className="text-foreground">{ativas.length}</strong> loja(s) ativa(s)
            </span>
            <span>
              <strong className="text-foreground">{vendasRastreadas}</strong> venda(s)
              rastreada(s) em 7d
            </span>
            {comProblema > 0 && (
              <Pill tom="erro">{comProblema} com pré-requisito faltando</Pill>
            )}
          </div>
        )}
      </div>

      {ativas.length === 0 && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex items-start gap-2 p-4 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div>
              <p className="font-medium">Nenhuma loja com rastreamento ligado.</p>
              <p className="text-muted-foreground">
                Abra uma loja abaixo e preencha o Google, o Meta, ou os dois.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* O que a tela NAO consegue afirmar: que o Google contou. O endpoint
          responde 200 mesmo ignorando. Dizer isso e melhor que deixar o lojista
          concluir sozinho que "ativo" significa "funcionando". */}
      {ativas.length > 0 && (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
          &quot;Enviadas&quot; significa que a plataforma aceitou a requisição — não que
          contou a conversão. A confirmação é no painel do Google Ads e no Events
          Manager. Se entrarem pedidos e as compras pararem, o aviso aparece aqui.
        </p>
      )}

      <div className="space-y-2.5">
        {ativas.map((l) => (
          <CardLoja
            key={l.storeId}
            loja={l}
            diag={diagnostico[l.storeId] ?? null}
            comecarAberto
          />
        ))}
      </div>

      {/* Sem isto a pagina renderiza dezenas de lojas que ninguem rastreia, e a
          que importa fica perdida no meio. */}
      {inativas.length > 0 && (
        <div className="space-y-2.5">
          <button
            type="button"
            onClick={() => setMostrarTodas((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
            {mostrarTodas
              ? "esconder lojas sem rastreamento"
              : `ligar em outra loja (${inativas.length} sem rastreamento)`}
          </button>

          {mostrarTodas &&
            inativas.map((l) => (
              <CardLoja
                key={l.storeId}
                loja={l}
                diag={diagnostico[l.storeId] ?? null}
                comecarAberto={false}
              />
            ))}
        </div>
      )}
    </div>
  );
}
