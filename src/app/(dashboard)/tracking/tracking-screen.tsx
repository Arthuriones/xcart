"use client";

import { useState } from "react";
import { AlertTriangle, Check, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EVENTOS, type ChaveEvento } from "@/lib/tracking/eventos";
import type { LojaTracking } from "@/lib/tracking/queries";

/**
 * Uma conversao "enviada" nao quer dizer "contada".
 *
 * O endpoint do Google responde 200 mesmo ignorando o conteudo. A unica forma
 * de perceber que quebrou e comparar com os pedidos: se entram vendas e as
 * conversoes param, algo mudou. Por isso a tela poe os dois numeros lado a
 * lado em vez de so dizer "ativo".
 */
function Saude({ loja, pedidos }: { loja: LojaTracking; pedidos: number | null }) {
  if (!loja.ligado) {
    return <span className="text-xs text-muted-foreground">desligado</span>;
  }

  // A comparacao com pedidos vale para a COMPRA. Carrinho e checkout acontecem
  // muito mais que venda -- somar tudo aqui faria "300 de 4 pedidos", que nao
  // diz nada.
  const compras = loja.porEvento.purchase ?? 0;
  const faltando = pedidos !== null && pedidos > 0 ? pedidos - compras : 0;
  const grave = pedidos !== null && pedidos >= 3 && compras === 0;
  const parcial = faltando > 0 && !grave;

  return (
    <div className="space-y-1 text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-muted-foreground">
          7 dias: <strong className="text-foreground">{compras}</strong> compras
          {pedidos !== null && <> de <strong className="text-foreground">{pedidos}</strong> pedidos</>}
        </span>
        {loja.pendentes > 0 && <span className="text-amber-600">{loja.pendentes} na fila</span>}
        {loja.falharam7d > 0 && <span className="text-destructive">{loja.falharam7d} falharam</span>}
      </div>

      {grave && (
        <p className="flex items-start gap-1.5 font-medium text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Entraram pedidos e nenhuma conversão de compra saiu. Verifique o webhook.
        </p>
      )}
      {parcial && (
        <p className="text-amber-600">
          {faltando} pedido(s) sem conversão — normal se vieram de fora do anúncio.
        </p>
      )}
      {loja.semAtribuicao7d > 0 && (
        <p className="text-muted-foreground">
          {loja.semAtribuicao7d} sem click id: chegam ao Google, mas sem ligação com anúncio.
        </p>
      )}
      {loja.ultimoErro && (
        <p className="truncate text-destructive" title={loja.ultimoErro}>
          último erro: {loja.ultimoErro}
        </p>
      )}
    </div>
  );
}

function LinhaLoja({
  loja,
  pedidos,
}: {
  loja: LojaTracking;
  pedidos: number | null;
}) {
  const [id, setId] = useState(loja.googleConversionId ?? "");
  const [rotulos, setRotulos] = useState<Record<string, string>>(() => {
    const inicial: Record<string, string> = {};
    for (const e of EVENTOS) inicial[e.chave] = loja.googleLabels[e.chave] ?? "";
    return inicial;
  });
  const [ligado, setLigado] = useState(loja.ligado);
  const [salvando, setSalvando] = useState(false);

  const quantos = Object.values(rotulos).filter((v) => v.trim()).length;

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
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Falha ao salvar.");
      setLigado(novoLigado);
      toast.success(novoLigado ? "Rastreamento ligado." : "Salvo.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">{loja.nome}</span>
              {ligado ? (
                <Badge className="rounded-md bg-emerald-500/15 text-emerald-600">ativo</Badge>
              ) : (
                <Badge variant="outline" className="rounded-md text-muted-foreground">
                  desligado
                </Badge>
              )}
            </div>
            <a
              href={`https://${loja.dominio}`}
              target="_blank"
              rel="noreferrer noopener"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
            >
              {loja.dominio}
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <Saude loja={loja} pedidos={pedidos} />
        </div>

        <div className="space-y-1">
          <Label className="text-xs">ID de conversão da conta</Label>
          <Input
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="AW-123456789"
            className="max-w-xs font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground">
            É o mesmo para toda a conta. O que muda por evento é o rótulo.
          </p>
        </div>

        {/* Um rotulo por evento porque no Google Ads cada evento e uma
            conversion action propria, com rotulo proprio. Deixar em branco e
            como o lojista diz "nao quero este evento" -- nao existe um
            interruptor separado que possa ficar fora de sincronia. */}
        <div className="space-y-2">
          <Label className="text-xs">Rótulo por evento</Label>
          <div className="space-y-2">
            {EVENTOS.map((ev) => {
              const enviados = loja.porEvento[ev.chave as ChaveEvento] ?? 0;
              const preenchido = Boolean(rotulos[ev.chave]?.trim());
              return (
                <div
                  key={ev.chave}
                  className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] sm:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm">{ev.nome}</span>
                      {ligado && preenchido && (
                        <span className="text-xs text-muted-foreground">
                          {enviados} em 7 dias
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{ev.descricao}</p>
                  </div>
                  <Input
                    value={rotulos[ev.chave] ?? ""}
                    onChange={(e) =>
                      setRotulos((atual) => ({ ...atual, [ev.chave]: e.target.value }))
                    }
                    placeholder="rótulo (em branco = não rastreia)"
                    className="font-mono text-sm"
                  />
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={() => salvar(ligado)} disabled={salvando} variant="outline">
            {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
          </Button>
          <Button
            onClick={() => salvar(!ligado)}
            disabled={salvando || (!ligado && (!id || quantos === 0))}
            variant={ligado ? "outline" : "default"}
          >
            {ligado ? "Desligar" : "Ligar"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function TrackingScreen({
  lojas,
  pedidos,
}: {
  lojas: LojaTracking[];
  pedidos: Record<string, number>;
}) {
  const ativas = lojas.filter((l) => l.ligado);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Rastreamento</h1>
        <p className="text-sm text-muted-foreground">
          A conversão é enviada do servidor — a compra pelo webhook do pedido, e
          carrinho e checkout pelo snippet do tema avisando o xcart.
        </p>
      </div>

      {ativas.length === 0 && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex items-start gap-2 p-4 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div>
              <p className="font-medium">Nenhuma loja com rastreamento ligado.</p>
              <p className="text-muted-foreground">
                Em Google Ads → Objetivos → Conversões, crie uma ação por evento que
                quiser e copie o rótulo de cada uma. Deixe compra como principal e as
                outras como <strong>secundárias</strong>, senão o Google otimiza a
                campanha para carrinho em vez de venda.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* O que a tela NAO consegue afirmar: que o Google contou. O endpoint
          responde 200 mesmo ignorando. Dizer isso e melhor que deixar o
          lojista concluir sozinho que "ativo" significa "funcionando". */}
      {ativas.length > 0 && (
        <Card>
          <CardContent className="flex items-start gap-2 p-4 text-xs text-muted-foreground">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
            <p>
              &quot;Enviadas&quot; significa que o Google aceitou a requisição — não que
              contou a conversão. A confirmação é no painel do Google Ads. Se entrarem
              pedidos e as compras pararem, aparece um aviso aqui.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {lojas.map((l) => (
          <LinhaLoja key={l.storeId} loja={l} pedidos={pedidos[l.storeId] ?? null} />
        ))}
      </div>
    </div>
  );
}
