"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, LogOut } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import type { ConexaoOAuthResumo } from "../dados-anuncios";

function IconeGoogle({ className = "size-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.36 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 10.03 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.36 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
      />
    </svg>
  );
}

export function CardPerfilGoogle({
  conexoesIniciais = [],
}: {
  conexoesIniciais?: ConexaoOAuthResumo[];
}) {
  const router = useRouter();
  const [pendente, startTransition] = useTransition();
  const [conexoes, setConexoes] = useState<ConexaoOAuthResumo[]>(conexoesIniciais);
  const [desconectandoId, setDesconectandoId] = useState<string | null>(null);

  // Escuta o evento de sucesso enviado pelo popup OAuth
  useEffect(() => {
    function onMensagem(event: MessageEvent) {
      if (typeof window === "undefined") return;
      if (event.origin !== window.location.origin) return;

      if (event.data?.type === "XCART_GOOGLE_CONNECTED") {
        if (event.data.ok) {
          const nome = event.data.nome || "Conta Google";
          const total = event.data.contas;
          toast.success(`${nome} conectada com sucesso!`, {
            description: total
              ? `${total} conta(s) do Google Ads vinculada(s).`
              : "Google Ads vinculado. Sincronização automática ativa.",
          });
          startTransition(() => {
            router.refresh();
          });
        } else if (event.data.erro) {
          toast.error("Falha ao autorizar Google", {
            description: event.data.erro,
          });
        }
      }
    }

    window.addEventListener("message", onMensagem);
    return () => window.removeEventListener("message", onMensagem);
  }, [router]);

  function abrirPopupGoogle() {
    const largura = 600;
    const altura = 720;
    const esquerda = window.screenX + (window.outerWidth - largura) / 2;
    const topo = window.screenY + (window.outerHeight - altura) / 2;

    const popup = window.open(
      "/api/auth/google/login",
      "xcart_google_oauth",
      `width=${largura},height=${altura},left=${esquerda},top=${topo},status=no,resizable=yes,scrollbars=yes`
    );

    if (!popup) {
      window.location.href = "/api/auth/google/login";
    }
  }

  async function desconectar(id: string) {
    setDesconectandoId(id);
    try {
      const resp = await fetch("/api/auth/google/desconectar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connectionId: id }),
      });
      if (resp.ok) {
        toast.success("Conta Google desconectada.");
        setConexoes((prev) => prev.filter((c) => c.id !== id));
        startTransition(() => router.refresh());
      } else {
        toast.error("Erro ao desconectar conta.");
      }
    } catch {
      toast.error("Falha de rede ao desconectar.");
    } finally {
      setDesconectandoId(null);
    }
  }

  const temConexao = conexoes.length > 0;

  return (
    <div className="rounded-panel border border-border bg-surface p-5">
      <div className="flex items-center justify-between gap-3 border-b border-border pb-4">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-control bg-bg border border-border shadow-2xs">
            <IconeGoogle className="size-5" />
          </div>
          <div>
            <h3 className="text-dense font-medium text-ink">Google Ads</h3>
            <p className="text-label text-t2">
              Conecte seus perfis por aqui (login em 1 clique):
            </p>
          </div>
        </div>

        <Button
          type="button"
          onClick={abrirPopupGoogle}
          disabled={pendente}
          variant="secondary"
          className="font-medium gap-2 border border-border bg-surface hover:bg-hover shadow-2xs"
        >
          <IconeGoogle className="size-4" />
          {temConexao ? "Conectar outra conta Google" : "Conectar com Google"}
        </Button>
      </div>

      {/* Perfis Conectados */}
      {temConexao ? (
        <div className="mt-4 flex flex-col gap-2">
          <div className="text-label font-medium text-t2">Contas conectadas:</div>
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
                      alt={c.nome || "Conta Google"}
                      className="size-9 rounded-full object-cover border border-border shrink-0"
                    />
                  ) : (
                    <div className="grid size-9 shrink-0 place-items-center rounded-full bg-border text-label font-semibold text-ink">
                      {(c.nome || c.email || "?").slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-dense font-medium text-ink">
                      {c.nome || "Conta Google"}
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge tom="ok">Conectado</StatusBadge>
                      {c.email && (
                        <span className="truncate text-[11px] text-t3">{c.email}</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => desconectar(c.id)}
                    disabled={desconectandoId === c.id}
                    title="Desconectar conta Google"
                    className="text-t3 hover:text-err"
                  >
                    <LogOut className="size-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-4 flex items-center justify-between rounded-control border border-dashed border-border/70 bg-bg/30 px-4 py-3 text-label text-t2">
          <span>Nenhuma conta do Google conectada ainda.</span>
          <span className="text-t3 text-xs">Abre a tela de consentimento oficial do Google</span>
        </div>
      )}
    </div>
  );
}
