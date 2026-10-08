"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Copy, Check, X, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { LogoXcart } from "@/components/layout/logo";

interface ModalConectarMetaProps {
  aberto: boolean;
  aoFechar: () => void;
  aoContinuarNavegador: () => void;
  aoConectadoComSucesso: (dados: { nome?: string; contas?: number }) => void;
}

export function ModalConectarMeta({
  aberto,
  aoFechar,
  aoContinuarNavegador,
  aoConectadoComSucesso,
}: ModalConectarMetaProps) {
  const [copiando, setCopiando] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [ticketAtivo, setTicketAtivo] = useState<string | null>(null);
  const [urlTicket, setUrlTicket] = useState<string | null>(null);
  const [aguardandoMultilogin, setAguardandoMultilogin] = useState(false);

  // Limpa estados ao fechar
  useEffect(() => {
    if (!aberto) {
      setAguardandoMultilogin(false);
      setTicketAtivo(null);
      setUrlTicket(null);
      setCopiado(false);
    }
  }, [aberto]);

  // Polling automático para detectar quando a autorização for concluída no multilogin
  useEffect(() => {
    if (!aguardandoMultilogin || !ticketAtivo) return;

    let ativo = true;
    const intervalo = setInterval(async () => {
      try {
        const resp = await fetch(`/api/auth/meta/ticket?ticket=${ticketAtivo}`);
        if (!resp.ok) return;
        const json = await resp.json();

        if (json.status === "completed" && ativo) {
          clearInterval(intervalo);
          setAguardandoMultilogin(false);
          toast.success("Perfil Meta conectado com sucesso pelo multilogin!");
          aoConectadoComSucesso(json.resultado || {});
          aoFechar();
        } else if (json.status === "error" && ativo) {
          clearInterval(intervalo);
          setAguardandoMultilogin(false);
          toast.error("Falha na autorização do multilogin.", {
            description: json.resultado?.erro || "Tente gerar um novo link.",
          });
        }
      } catch {
        // Ignora erro de rede temporário no polling
      }
    }, 2000);

    return () => {
      ativo = false;
      clearInterval(intervalo);
    };
  }, [aguardandoMultilogin, ticketAtivo, aoConectadoComSucesso, aoFechar]);

  if (!aberto) return null;

  async function gerarECopiarLinkMultilogin() {
    setCopiando(true);
    try {
      const resp = await fetch("/api/auth/meta/ticket", { method: "POST" });
      const json = await resp.json();

      if (!resp.ok || !json.url) {
        throw new Error(json.erro || "Não foi possível gerar o link.");
      }

      setTicketAtivo(json.ticket);
      setUrlTicket(json.url);
      setAguardandoMultilogin(true);

      // Copia para a área de transferência
      await navigator.clipboard.writeText(json.url);
      setCopiado(true);
      toast.success("Link copiado para a área de transferência!", {
        description: "Cole no seu navegador multilogin onde o Facebook está logado.",
      });

      setTimeout(() => setCopiado(false), 3000);
    } catch (e) {
      toast.error("Falha ao gerar link multilogin", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setCopiando(false);
    }
  }

  async function copiarNovamente() {
    if (!urlTicket) return;
    await navigator.clipboard.writeText(urlTicket);
    setCopiado(true);
    toast.success("Link copiado novamente!");
    setTimeout(() => setCopiado(false), 2500);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-md rounded-2xl border border-border/80 bg-[#141822] p-6 text-ink shadow-2xl overflow-hidden">
        {/* Topo: Logo xcart e Fechar */}
        <div className="flex items-center justify-between pb-4">
          <div className="flex items-center gap-2">
            <LogoXcart className="h-6 w-auto text-white" />
          </div>
          <button
            type="button"
            onClick={aoFechar}
            className="rounded-lg p-1 text-t3 transition hover:bg-surface hover:text-white"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Título Principal */}
        <div className="text-center py-2">
          <h2 className="text-xl font-bold text-white tracking-tight">Conectar Meta Ads</h2>
          <p className="mt-1.5 text-xs text-t2 text-balance">
            Escolha como deseja conectar sua conta Meta Ads
          </p>
        </div>

        {/* Conteúdo: Escolha dos 2 Botões ou Tela de Aguardo */}
        {!aguardandoMultilogin ? (
          <div className="mt-6 flex flex-col gap-4">
            {/* Opção 1: Continuar neste navegador */}
            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                onClick={() => {
                  aoFechar();
                  aoContinuarNavegador();
                }}
                className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-brand px-4 py-3.5 text-sm font-semibold text-white shadow-lg shadow-brand/20 transition hover:bg-brand-hover active:scale-[0.99] cursor-pointer"
              >
                <ExternalLink className="h-4 w-4" />
                <span>Continuar neste navegador</span>
              </button>
              <p className="text-center text-[11px] text-t3">
                Conecte sua conta Meta Ads diretamente neste navegador
              </p>
            </div>

            {/* Opção 2: Copiar link para navegador multilogin */}
            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                onClick={gerarECopiarLinkMultilogin}
                disabled={copiando}
                className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-border bg-[#0b0e14] px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-[#111622] hover:border-border-subtle active:scale-[0.99] disabled:opacity-50 cursor-pointer"
              >
                {copiando ? (
                  <Loader2 className="h-4 w-4 animate-spin text-brand" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                <span>Copiar link para navegador multilogin</span>
              </button>
              <p className="text-center text-[11px] text-t3">
                Gere um link para conectar em outro navegador ou compartilhar com colaboradores
              </p>
            </div>
          </div>
        ) : (
          /* Estado de Aguardo Multilogin */
          <div className="mt-5 flex flex-col items-center gap-4 rounded-xl border border-brand/20 bg-brand/5 p-5 text-center">
            <div className="relative flex h-12 w-12 items-center justify-center rounded-full bg-brand/10 text-brand">
              <Loader2 className="h-6 w-6 animate-spin" />
              <Sparkles className="absolute -top-1 -right-1 h-4 w-4 text-emerald-400" />
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-sm font-semibold text-white">
                Aguardando autorização no multilogin...
              </span>
              <p className="text-xs text-t2 text-balance">
                Cole o link no seu navegador antidetect (Dolphin, AdsPower, etc.) onde o perfil do Facebook está logado.
              </p>
            </div>

            {/* Caixa com o link para re-copiar */}
            <div className="flex w-full items-center gap-2 rounded-lg border border-border bg-[#0c0f16] p-2 text-left">
              <input
                type="text"
                readOnly
                value={urlTicket || ""}
                className="w-full bg-transparent text-[11px] font-mono text-t2 outline-none select-all truncate"
              />
              <button
                type="button"
                onClick={copiarNovamente}
                className="flex shrink-0 items-center gap-1 rounded bg-surface px-2 py-1 text-[11px] font-medium text-white hover:bg-surface-elevated transition"
              >
                {copiado ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                <span>{copiado ? "Copiado" : "Copiar"}</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => setAguardandoMultilogin(false)}
              className="text-xs text-t3 hover:text-white underline transition"
            >
              Voltar às opções
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
