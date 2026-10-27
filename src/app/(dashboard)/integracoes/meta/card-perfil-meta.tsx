"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ChevronDown, ChevronUp, LogOut, Plus, RefreshCw, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import type { ConexaoOAuthResumo } from "../dados-anuncios";
import { AssistenteMeta, CartaoTokenMeta } from "./token-meta";
import type { Estado } from "../regras";
import { ModalConectarMeta } from "./modal-conectar-meta";

function IconeFacebook({ className = "size-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

export function CardPerfilMeta({
  conexoesIniciais = [],
  contasCount = 0,
  estadoToken,
  temContasPlataforma,
}: {
  conexoesIniciais?: ConexaoOAuthResumo[];
  contasCount: number;
  estadoToken: Estado;
  temContasPlataforma: boolean;
}) {
  const router = useRouter();
  const [pendente, startTransition] = useTransition();
  // A lista vem da prop: o router.refresh depois do popup/modal traz o perfil
  // novo. O estado guarda so quem foi desconectado aqui, ate o refresh chegar.
  const [removidos, setRemovidos] = useState<Set<string>>(() => new Set());
  const conexoes = conexoesIniciais.filter((c) => !removidos.has(c.id));
  const [mostrarManual, setMostrarManual] = useState(false);
  const [modalConectarAberto, setModalConectarAberto] = useState(false);

  // Escuta o evento de sucesso enviado pelo popup OAuth
  useEffect(() => {
    function onMensagem(event: MessageEvent) {
      if (typeof window === "undefined") return;
      if (event.origin !== window.location.origin) return;

      if (event.data?.type === "XCART_META_CONNECTED") {
        if (event.data.ok) {
          const nome = event.data.nome || "Perfil";
          const total = event.data.contas;
          toast.success(`Perfil ${nome} conectado!`, {
            description: total
              ? `${total} conta(s) de anúncio identificada(s). Vincule abaixo.`
              : "Contas de anúncio prontas para serem vinculadas às lojas.",
          });
          startTransition(() => {
            router.refresh();
          });
        } else if (event.data.erro) {
          toast.error("Falha ao autorizar Facebook", {
            description: event.data.erro,
          });
        }
      }
    }

    window.addEventListener("message", onMensagem);
    return () => window.removeEventListener("message", onMensagem);
  }, [router]);

  function abrirPopupMeta() {
    const largura = 600;
    const altura = 720;
    const esquerda = window.screenX + (window.outerWidth - largura) / 2;
    const topo = window.screenY + (window.outerHeight - altura) / 2;

    const popup = window.open(
      "/api/auth/meta/login",
      "xcart_meta_oauth",
      `width=${largura},height=${altura},left=${esquerda},top=${topo},status=no,resizable=yes,scrollbars=yes`
    );

    if (!popup) {
      // Caso popup seja bloqueado pelo navegador, redireciona diretamente
      window.location.href = "/api/auth/meta/login";
    }
  }

  // Chamada pelo ConfirmDialog: lanca na falha (HTTP ou rede) e o dialogo
  // mostra o erro no lugar do toast.
  async function desconectar(id: string) {
    const resp = await fetch("/api/auth/meta/desconectar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ connectionId: id }),
    });
    if (!resp.ok) throw new Error(`desconectar: HTTP ${resp.status}`);
    toast.success("Perfil desconectado.");
    setRemovidos((prev) => new Set(prev).add(id));
    startTransition(() => router.refresh());
  }

  const temConexao = conexoes.length > 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Card estilo UTMify */}
      <div className="rounded-panel border border-border bg-surface p-5">
        <div className="flex items-center justify-between gap-3 border-b border-border pb-4">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-control bg-[#1877F2]/10 text-[#1877F2]">
              <IconeFacebook className="size-5" />
            </div>
            <div>
              <h3 className="text-dense font-medium text-ink">Meta Ads</h3>
              <p className="text-label text-t2">
                Conecte seus perfis por aqui (login em 1 clique):
              </p>
            </div>
          </div>

          <Button
            type="button"
            onClick={() => setModalConectarAberto(true)}
            disabled={pendente}
            className="bg-[#1877F2] font-medium text-white hover:bg-[#166fe5] shadow-xs gap-2"
          >
            <IconeFacebook className="size-4" />
            {temConexao ? "Conectar outro perfil" : "Adicionar perfil"}
          </Button>
        </div>

        {/* Perfis Conectados */}
        {temConexao ? (
          <div className="mt-4 flex flex-col gap-2">
            <div className="text-label font-medium text-t2">Perfis conectados:</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {conexoes.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between gap-3 rounded-control border border-border bg-bg/50 p-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {c.foto_url ? (
                      <img
                        src={c.foto_url}
                        alt={c.nome || "Perfil"}
                        className="size-9 rounded-full object-cover border border-border shrink-0"
                      />
                    ) : (
                      <div className="grid size-9 shrink-0 place-items-center rounded-full bg-border text-label font-semibold text-ink">
                        {(c.nome || "?").slice(0, 1).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="truncate text-dense font-medium text-ink">
                        {c.nome || "Perfil do Facebook"}
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge tom="ok">Conectado</StatusBadge>
                        <span className="text-[11px] text-t3">60 dias</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <ConfirmDialog
                      gatilho={
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Desconectar ${c.nome || "este perfil"}`}
                          className="text-t3 hover:text-err max-md:size-ctl-lg"
                        >
                          <LogOut className="size-3.5" aria-hidden />
                        </Button>
                      }
                      titulo={`Desconectar ${c.nome || "este perfil"}?`}
                      descricao="O perfil sai da lista. Para conectá-lo de novo, você precisa autorizar o Facebook outra vez."
                      confirmar="Desconectar"
                      mensagemErro="Não deu para desconectar agora. Tente de novo."
                      onConfirmar={() => desconectar(c.id)}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="mt-4 flex items-center justify-between rounded-control border border-dashed border-border/70 bg-bg/30 px-4 py-3 text-label text-t2">
            <span>Nenhum perfil do Facebook conectado ainda.</span>
            <span className="text-t3 text-xs">Abre a janela de autorização oficial da Meta</span>
          </div>
        )}
      </div>

      {/* Modo Manual Recolhido (para compatibilidade total com quem já usa ou prefere token) */}
      <div className="rounded-panel border border-border bg-surface/50 p-4">
        <button
          type="button"
          onClick={() => setMostrarManual((v) => !v)}
          className="flex w-full items-center justify-between text-left text-dense font-medium text-t2 hover:text-ink"
        >
          <span>Prefere configurar manualmente com Token de Sistema?</span>
          {mostrarManual ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </button>

        {mostrarManual && (
          <div className="mt-4 border-t border-border pt-4">
            {temContasPlataforma ? (
              <CartaoTokenMeta estado={estadoToken} contas={contasCount} />
            ) : (
              <AssistenteMeta />
            )}
          </div>
        )}
      </div>

      <ModalConectarMeta
        aberto={modalConectarAberto}
        aoFechar={() => setModalConectarAberto(false)}
        aoContinuarNavegador={abrirPopupMeta}
        aoConectadoComSucesso={(res) => {
          const nome = res.nome || "Perfil";
          toast.success(`Perfil ${nome} conectado!`, {
            description: res.contas
              ? `${res.contas} conta(s) de anúncio identificada(s). Vincule abaixo.`
              : "Contas de anúncio prontas para serem vinculadas às lojas.",
          });
          startTransition(() => {
            router.refresh();
          });
        }}
      />
    </div>
  );
}
