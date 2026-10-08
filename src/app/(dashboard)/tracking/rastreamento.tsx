"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { buttonVariants } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import type { DiagnosticoLoja } from "@/lib/tracking/diagnostico";
import type { LojaTracking } from "@/lib/tracking/queries";
import { conferirLoja, mudarEnvio } from "./acoes";
import { AdicionarPixel } from "./adicionar-pixel";
import { DetalheLoja } from "./detalhe-loja";
import { linhaDaLoja, ordenarLinhas, type LinhaLoja } from "./resumo";
import type { Plataforma } from "./saude";
import { Visao } from "./visao";

// ============================================================================
// Rastreamento: a lista de lojas e o detalhe, na mesma pagina.
//
//   /tracking             lista
//   /tracking?loja=<id>   detalhe da loja
//
// A troca e pelo history do navegador (pushState): nao refaz a leitura do
// servidor -- o diagnostico na Shopify leva segundos -- e o Voltar funciona.
// Os numeros vem do servidor; router.refresh depois de cada mudanca.
// ============================================================================

interface Ajustes {
  base: number;
  diag: Record<string, DiagnosticoLoja>;
  rechecadas: string[];
  /** Interruptor do envio, ate o servidor confirmar. */
  envio: Record<string, boolean>;
}

export interface RastreamentoProps {
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
}

function irPara(loja: string | null) {
  const q = loja ? `?loja=${encodeURIComponent(loja)}` : "";
  window.history.pushState(null, "", `${window.location.pathname}${q}`);
  window.scrollTo({ top: 0 });
}

export function Rastreamento({
  lojas,
  diagnostico,
  falharam,
  ocultas,
  lojaEscolhida,
  geradoEm,
}: RastreamentoProps) {
  const router = useRouter();
  const params = useSearchParams();
  const [atualizando, startTransition] = useTransition();
  const [rechecando, setRechecando] = useState<string | null>(null);
  const [adicionar, setAdicionar] = useState<Plataforma | null>(null);
  const [desligar, setDesligar] = useState<LinhaLoja | null>(null);

  const vazio = (base: number): Ajustes => ({ base, diag: {}, rechecadas: [], envio: {} });
  const [ajustes, setAjustes] = useState<Ajustes>(vazio(geradoEm));
  if (ajustes.base !== geradoEm) setAjustes(vazio(geradoEm));

  const diag = useMemo(() => ({ ...diagnostico, ...ajustes.diag }), [diagnostico, ajustes.diag]);
  const falhas = useMemo(
    () => new Set(falharam.filter((id) => !ajustes.rechecadas.includes(id))),
    [falharam, ajustes.rechecadas]
  );
  const linhas = useMemo(
    () => ordenarLinhas(lojas.map((l) => linhaDaLoja(l, diag[l.storeId] ?? null, l.ligado))),
    [lojas, diag]
  );

  function atualizar() {
    startTransition(() => router.refresh());
  }

  const envioNaTela = (l: LinhaLoja) => ajustes.envio[l.loja.storeId] ?? l.loja.ligado;

  async function trocarEnvio(l: LinhaLoja, ligar: boolean) {
    const id = l.loja.storeId;
    setAjustes((a) => ({ ...a, envio: { ...a.envio, [id]: ligar } }));
    try {
      await mudarEnvio(id, ligar);
      toast.success(ligar ? "Rastreamento ligado" : "Rastreamento desligado");
      atualizar();
    } catch (e) {
      setAjustes((a) => {
        const envio = { ...a.envio };
        delete envio[id];
        return { ...a, envio };
      });
      toast.error(e instanceof Error ? e.message : "Não deu para salvar.");
      throw e;
    }
  }

  function alternarEnvio(l: LinhaLoja, ligar: boolean) {
    // Desligar para as compras de chegarem ao Meta, ao Google e ao TikTok: confirma antes.
    if (ligar) void trocarEnvio(l, true).catch(() => {});
    else setDesligar(l);
  }

  function ajustarDiag(storeId: string, patch: Partial<DiagnosticoLoja>) {
    setAjustes((a) => {
      const atual = a.diag[storeId] ?? diagnostico[storeId];
      if (!atual) return a;
      return { ...a, diag: { ...a.diag, [storeId]: { ...atual, ...patch } } };
    });
  }

  async function rechecar(l: LojaTracking) {
    setRechecando(l.storeId);
    try {
      const novo = await conferirLoja(l.storeId);
      setAjustes((a) => ({
        ...a,
        diag: novo ? { ...a.diag, [l.storeId]: novo } : a.diag,
        rechecadas: a.rechecadas.includes(l.storeId) ? a.rechecadas : [...a.rechecadas, l.storeId],
      }));
      toast.success(`${l.nome} conferida`);
    } catch (e) {
      toast.error(`Ainda não deu para conferir ${l.nome}`, {
        description: e instanceof Error ? e.message : "Tente de novo em instantes.",
      });
    } finally {
      setRechecando(null);
    }
  }

  const confirmar = (
    <ConfirmDialog
      open={desligar !== null}
      onOpenChange={(v) => !v && setDesligar(null)}
      titulo={`Desligar o rastreamento de ${desligar?.loja.nome ?? ""}?`}
      descricao="As compras param de chegar ao Meta, ao Google e ao TikTok até você religar."
      confirmar="Desligar"
      mensagemErro="Não deu para desligar agora. Tente de novo."
      onConfirmar={() => (desligar ? trocarEnvio(desligar, false) : undefined)}
    />
  );

  if (lojas.length === 0) {
    return (
      <EmptyState
        titulo={lojaEscolhida || ocultas > 0 ? "Nenhuma loja aparece aqui" : "Nenhuma loja conectada"}
        descricao={
          lojaEscolhida || ocultas > 0
            ? "O app foi desinstalado e o envio está desligado."
            : "Conecte uma loja Shopify para rastrear as compras."
        }
        acao={
          <Link
            href={lojaEscolhida || ocultas > 0 ? "/stores" : "/stores?conectar=1"}
            className={buttonVariants({ variant: "primary" })}
          >
            {lojaEscolhida || ocultas > 0 ? "Ver em Lojas" : "Conectar loja"}
          </Link>
        }
      />
    );
  }

  const idLoja = params.get("loja");
  const aberta = idLoja ? linhas.find((l) => l.loja.storeId === idLoja) : undefined;
  if (aberta) {
    const id = aberta.loja.storeId;
    return (
      <>
        <DetalheLoja
          key={id}
          linha={aberta}
          diag={diag[id] ?? null}
          falhou={falhas.has(id)}
          rechecando={rechecando === id}
          ligado={envioNaTela(aberta)}
          voltar={() => irPara(null)}
          aoMudar={atualizar}
          rechecar={() => void rechecar(aberta.loja)}
          ajustarDiag={(patch) => ajustarDiag(id, patch)}
          alternarEnvio={(v) => alternarEnvio(aberta, v)}
          adicionarPixel={setAdicionar}
        />
        {adicionar && (
          <AdicionarPixel
            key={adicionar}
            loja={aberta.loja}
            lojas={lojas}
            plataformaInicial={adicionar}
            onFechar={() => setAdicionar(null)}
            aoSalvar={atualizar}
          />
        )}
        {confirmar}
      </>
    );
  }

  return (
    <>
      <Visao
        linhas={linhas}
        diag={diag}
        ocultas={lojaEscolhida ? 0 : ocultas}
        atualizando={atualizando}
        envioNaTela={envioNaTela}
        abrir={(l) => irPara(l.loja.storeId)}
        atualizar={atualizar}
        alternarEnvio={alternarEnvio}
      />
      {confirmar}
    </>
  );
}
