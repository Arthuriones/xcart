"use client";

import { useState } from "react";
import { AlertTriangle, Check, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

  const faltando =
    pedidos !== null && pedidos > 0 ? pedidos - loja.enviados7d : 0;
  const grave = pedidos !== null && pedidos >= 3 && loja.enviados7d === 0;
  const parcial = faltando > 0 && !grave;

  return (
    <div className="space-y-1 text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-muted-foreground">
          7 dias: <strong className="text-foreground">{loja.enviados7d}</strong> enviadas
          {pedidos !== null && <> de <strong className="text-foreground">{pedidos}</strong> pedidos</>}
        </span>
        {loja.pendentes > 0 && <span className="text-amber-600">{loja.pendentes} na fila</span>}
        {loja.falharam7d > 0 && <span className="text-destructive">{loja.falharam7d} falharam</span>}
      </div>

      {grave && (
        <p className="flex items-start gap-1.5 font-medium text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Entraram pedidos e nenhuma conversão saiu. Verifique o webhook.
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
  ecDisponivel,
}: {
  loja: LojaTracking;
  pedidos: number | null;
  /** Sem developer token no ambiente, enhanced conversions nao tem como sair --
   *  e um campo pedindo credencial seria pedir trabalho por nada. */
  ecDisponivel: boolean;
}) {
  const [id, setId] = useState(loja.googleConversionId ?? "");
  const [rotulo, setRotulo] = useState(loja.googleConversionLabel ?? "");
  const [contaAds, setContaAds] = useState(loja.googleCustomerId ?? "");
  const [ligado, setLigado] = useState(loja.ligado);
  const [salvando, setSalvando] = useState(false);

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
          googleConversionLabel: rotulo,
          googleCustomerId: contaAds,
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
      <CardContent className="space-y-3 p-4">
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

        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <div className="space-y-1">
            <Label className="text-xs">ID de conversão</Label>
            <Input
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="AW-123456789"
              className="font-mono text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Rótulo</Label>
            <Input
              value={rotulo}
              onChange={(e) => setRotulo(e.target.value)}
              placeholder="AbC-D_efGh"
              className="font-mono text-sm"
            />
          </div>
          <div className="flex items-end gap-2">
            <Button onClick={() => salvar(ligado)} disabled={salvando} variant="outline">
              {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
            </Button>
            <Button
              onClick={() => salvar(!ligado)}
              disabled={salvando || (!ligado && !id)}
              variant={ligado ? "outline" : "default"}
            >
              {ligado ? "Desligar" : "Ligar"}
            </Button>
          </div>
        </div>

        {ecDisponivel && <Enhanced loja={loja} conta={contaAds} setConta={setContaAds} />}
      </CardContent>
    </Card>
  );
}

/**
 * Enhanced conversions.
 *
 * E uma SEGUNDA chamada por venda, nao um campo a mais na primeira: a conversao
 * base leva o gclid e conta a venda; esta acrescenta o e-mail e o telefone
 * hasheados por cima, casando pelo numero do pedido. Por isso os numeros ficam
 * separados dos de cima -- somados, o total de conversoes dobraria e deixaria de
 * bater com os pedidos, que e a conta que serve de alarme.
 */
function Enhanced({
  loja,
  conta,
  setConta,
}: {
  loja: LojaTracking;
  conta: string;
  setConta: (v: string) => void;
}) {
  const conectado = loja.temAutorizacaoGoogle && Boolean(loja.googleCustomerId);

  return (
    <div className="space-y-2 rounded-md border border-dashed p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium">Enhanced conversions</span>
        {conectado ? (
          <span className="text-xs text-muted-foreground">
            7 dias: <strong className="text-foreground">{loja.ecEnviados7d}</strong> enriquecidas
            {loja.ecFalharam7d > 0 && (
              <span className="text-destructive"> · {loja.ecFalharam7d} falharam</span>
            )}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">conta não conectada</span>
        )}
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Conta do Google Ads (customer id)</Label>
        <Input
          value={conta}
          onChange={(e) => setConta(e.target.value)}
          placeholder="1234567890"
          className="font-mono text-sm"
        />
        <p className="text-xs text-muted-foreground">
          Só dígitos, sem hífen. Fica no topo do painel do Google Ads.
        </p>
      </div>

      {loja.ecUltimoErro && (
        <p className="text-xs text-destructive" title={loja.ecUltimoErro}>
          {loja.ecUltimoErro}
        </p>
      )}
    </div>
  );
}

export function TrackingScreen({
  lojas,
  pedidos,
  ecDisponivel,
}: {
  lojas: LojaTracking[];
  pedidos: Record<string, number>;
  ecDisponivel: boolean;
}) {
  const ativas = lojas.filter((l) => l.ligado);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Rastreamento</h1>
        <p className="text-sm text-muted-foreground">
          A conversão é enviada do servidor quando o pedido entra — não depende do
          navegador do comprador.
        </p>
      </div>

      {ativas.length === 0 && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex items-start gap-2 p-4 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div>
              <p className="font-medium">Nenhuma loja com rastreamento ligado.</p>
              <p className="text-muted-foreground">
                Pegue o ID e o rótulo em Google Ads → Objetivos → Conversões → a sua
                ação de compra.
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
              pedidos e as conversões pararem, aparece um aviso aqui.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {lojas.map((l) => (
          <LinhaLoja
            key={l.storeId}
            loja={l}
            pedidos={pedidos[l.storeId] ?? null}
            ecDisponivel={ecDisponivel}
          />
        ))}
      </div>
    </div>
  );
}
