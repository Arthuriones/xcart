"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SendIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Section } from "@/components/ui/section";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { chamar } from "../api";

// ============================================================================
// Notificacao de venda no celular: o lojista cola a URL de webhook do Pushcut
// (ou ntfy, Discord, Zapier...) e o xcart chama a cada venda. A URL e segredo:
// a tela so recebe o host dela. POST /api/alertas/venda-webhook.
// ============================================================================

const API = "/api/alertas/venda-webhook";

const PASSOS = [
  <>Instale o app Pushcut no celular e crie uma notificação (ex.: “Venda”).</>,
  <>
    Na notificação, toque em <span className="font-mono text-ink">Webhook</span> e copie a URL.
  </>,
  <>Cole abaixo e clique em Testar.</>,
];

interface Props {
  ativo: boolean;
  /** Host da URL gravada (ex.: api.pushcut.io); null = nenhuma. */
  host: string | null;
}

function Formulario({ ativo: ativoSalvo, host }: Props) {
  const id = useId();
  const router = useRouter();
  const [atualizando, startTransition] = useTransition();
  const [url, setUrl] = useState("");
  const [ativo, setAtivo] = useState(ativoSalvo);
  const [acao, setAcao] = useState<"salvar" | "testar" | "remover" | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const conectado = Boolean(host) && ativoSalvo;
  const alterado = url.trim() !== "" || ativo !== ativoSalvo;

  async function enviar(modo: "salvar" | "testar" | "remover") {
    const limpa = url.trim();
    if (limpa && !/^https:\/\/\S+$/.test(limpa)) {
      setErro("Cole a URL inteira, começando com https://.");
      return;
    }
    if (modo === "testar" && !limpa && !host) {
      setErro("Cole a URL do webhook para testar.");
      return;
    }
    setErro(null);
    setAcao(modo);
    const r = await chamar(`${API}${modo === "testar" ? "?testar=1" : ""}`, {
      method: "POST",
      body: JSON.stringify({ url: limpa || null, ativo, remover: modo === "remover" }),
    });
    setAcao(null);
    if (!r.ok) {
      if (modo === "testar" && r.status === 200) startTransition(() => router.refresh());
      toast.error(modo === "testar" && r.status === 200 ? "O teste não chegou" : "Não deu para salvar", {
        description: r.erro,
      });
      return;
    }
    setUrl("");
    toast.success(
      modo === "testar" ? "Venda de teste enviada" : modo === "remover" ? "Webhook removido" : "Salvo",
      { description: modo === "testar" ? "Confira o celular." : undefined }
    );
    startTransition(() => router.refresh());
  }

  const ocupado = acao !== null || atualizando;

  return (
    <Section
      titulo="Venda no celular"
      nivel={3}
      acoes={<StatusBadge tom={conectado ? "ok" : "neutral"}>{conectado ? "Ligado" : "Não configurado"}</StatusBadge>}
    >
      {!host ? (
        <ol className="flex flex-col gap-2">
          {PASSOS.map((p, i) => (
            <li key={i} className="flex items-start gap-3 text-dense text-t1">
              <span
                aria-hidden
                className="grid size-6 shrink-0 place-items-center rounded-full border border-border-strong text-label font-semibold text-t1"
              >
                {i + 1}
              </span>
              <span className="min-w-0 pt-0.5 text-pretty">{p}</span>
            </li>
          ))}
        </ol>
      ) : null}

      <div className="flex max-w-xl flex-col gap-1.5">
        <Label htmlFor={`${id}-url`}>URL do webhook</Label>
        <Input
          id={`${id}-url`}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={host ? `Salva (${host}). Deixe vazio para manter` : "https://api.pushcut.io/…"}
          aria-invalid={erro ? true : undefined}
          aria-describedby={`${id}-url-ajuda`}
          className="font-mono"
        />
        <p id={`${id}-url-ajuda`} className={erro ? "text-label text-err" : "text-label text-t2"}>
          {erro ?? "Pushcut, ntfy, Discord ou qualquer webhook. Toca a cada venda, em todas as lojas."}
        </p>
      </div>

      <Switch rotulo="Avisar a cada venda" checked={ativo} onCheckedChange={setAtivo} />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button pending={acao === "salvar"} disabled={ocupado && acao !== "salvar"} onClick={() => enviar("salvar")}>
          Salvar
        </Button>
        <Button
          variant="secondary"
          pending={acao === "testar"}
          disabled={ocupado && acao !== "testar"}
          onClick={() => enviar("testar")}
        >
          {acao === "testar" ? null : <SendIcon aria-hidden />}
          Testar
        </Button>
        {host ? (
          <Button
            variant="ghost"
            pending={acao === "remover"}
            disabled={ocupado && acao !== "remover"}
            onClick={() => enviar("remover")}
          >
            Remover
          </Button>
        ) : null}
        <p aria-live="polite" className="text-label text-t2">
          {alterado ? "Há alterações ainda não salvas." : ""}
        </p>
      </div>
    </Section>
  );
}

export function CanalVenda(props: Props) {
  return <Formulario key={`${props.ativo}|${props.host}`} {...props} />;
}
