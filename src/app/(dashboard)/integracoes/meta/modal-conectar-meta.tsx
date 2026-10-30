"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Copy, Check, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { LogoPanda } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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

  // Dialog do sistema: Esc, clique fora e o X fecham pelo aoFechar, o foco fica
  // preso no modal, e as cores sao so tokens (o fundo fixo sumia no tema claro).
  return (
    <Dialog
      open={aberto}
      onOpenChange={(v) => {
        if (!v) aoFechar();
      }}
    >
      <DialogContent size="sm">
        {/* Topo: logo do Panda Track (o X e o do DialogContent) */}
        <LogoPanda altura={24} />

        {/* Título Principal */}
        <DialogHeader className="items-center px-8 text-center">
          <DialogTitle>Conectar Meta Ads</DialogTitle>
          <DialogDescription className="text-t2 text-balance">
            Escolha como deseja conectar sua conta Meta Ads
          </DialogDescription>
        </DialogHeader>

        {/* Conteúdo: Escolha dos 2 Botões ou Tela de Aguardo */}
        {!aguardandoMultilogin ? (
          <div className="flex flex-col gap-4">
            {/* Opção 1: Continuar neste navegador */}
            <div className="flex flex-col gap-1.5">
              <Button
                type="button"
                size="lg"
                className="w-full"
                onClick={() => {
                  aoFechar();
                  aoContinuarNavegador();
                }}
              >
                <ExternalLink aria-hidden />
                Continuar neste navegador
              </Button>
              <p className="text-center text-label text-t2">
                Conecte sua conta Meta Ads diretamente neste navegador
              </p>
            </div>

            {/* Opção 2: Copiar link para navegador multilogin */}
            <div className="flex flex-col gap-1.5">
              <Button
                type="button"
                variant="secondary"
                size="lg"
                className="w-full"
                onClick={gerarECopiarLinkMultilogin}
                pending={copiando}
              >
                {copiando ? null : <Copy aria-hidden />}
                Copiar link para navegador multilogin
              </Button>
              <p className="text-center text-label text-t2">
                Gere um link para conectar em outro navegador ou compartilhar com colaboradores
              </p>
            </div>
          </div>
        ) : (
          /* Estado de Aguardo Multilogin */
          <div className="flex flex-col items-center gap-4 rounded-card border border-border bg-surface-2 p-5 text-center">
            <div className="relative flex size-12 items-center justify-center rounded-full bg-surface text-brand">
              <Loader2 className="size-6 animate-spin" aria-hidden />
              <Sparkles className="absolute -top-1 -right-1 size-4 text-ok" aria-hidden />
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-dense font-semibold text-ink">
                Aguardando autorização no multilogin...
              </span>
              <p className="text-label text-t1 text-balance">
                Cole o link no seu navegador antidetect (Dolphin, AdsPower, etc.) onde o perfil do Facebook está logado.
              </p>
            </div>

            {/* Caixa com o link para re-copiar */}
            <div className="flex w-full items-center gap-2 rounded-control border border-border bg-surface p-2 text-left">
              <input
                type="text"
                readOnly
                value={urlTicket || ""}
                aria-label="Link para o navegador multilogin"
                className="min-w-0 flex-1 truncate bg-transparent font-mono text-label text-t1 outline-none select-all"
              />
              <Button type="button" variant="secondary" size="sm" onClick={copiarNovamente}>
                {copiado ? <Check className="text-ok" aria-hidden /> : <Copy aria-hidden />}
                {copiado ? "Copiado" : "Copiar"}
              </Button>
            </div>

            <button
              type="button"
              onClick={() => setAguardandoMultilogin(false)}
              className="text-label text-t2 underline underline-offset-4 hover:text-ink"
            >
              Voltar às opções
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
