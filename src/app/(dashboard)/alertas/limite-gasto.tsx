"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROTAS, type AlertaCanalCorpo } from "@/lib/financeiro/tipos";
import { erroDoTelegram, formatarLimite, lerNumero } from "./apresentar";
import { avisarConfigSalva, useConfigSalva, type ConfigCanal } from "./config-salva";

// ============================================================================
// O unico limite que ja se configura hoje: o gasto minimo do "gastou sem
// vender", um so para a conta. Grava pela rota do canal (ela grava tudo
// junto), com chat, ligado e avisos exatamente como estao salvos.
// ============================================================================

export function LimiteGasto({ config, travado }: { config: ConfigCanal; travado: boolean }) {
  const router = useRouter();
  const id = useId();
  const [, iniciar] = useTransition();
  const gravada = useConfigSalva(config);
  const [salvo, setSalvo] = useState(config.gasto_sem_venda_min);
  const [texto, setTexto] = useState(() => formatarLimite(config.gasto_sem_venda_min));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const valor = lerNumero(texto);
  const invalido = valor === null || valor < 0 || valor > 100000;
  const alterado = !invalido && Math.round(valor * 100) !== Math.round(salvo * 100);

  async function salvar() {
    if (invalido || valor === null) {
      setErro("Use um valor de 0 a 100.000.");
      return;
    }
    setSalvando(true);
    setErro(null);
    // Chat, ligado e avisos como estao gravados; token vazio = manter.
    const corpo: AlertaCanalCorpo = {
      chat_id: gravada.telegram_chat_id,
      bot_token: null,
      ativo: gravada.ativo,
      receber_avisos: gravada.receber_avisos,
      gasto_sem_venda_min: valor,
    };
    try {
      const r = await fetch(ROTAS.apiAlertasCanal, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(corpo),
      });
      const j = (await r.json().catch(() => null)) as { ok?: boolean; erro?: string } | null;
      if (!r.ok || !j?.ok) throw new Error(erroDoTelegram(r.status, j?.erro));
      setSalvo(valor);
      setTexto(formatarLimite(valor));
      avisarConfigSalva({ ...gravada, gasto_sem_venda_min: valor });
      toast.success("Limite salvo", {
        description: `Gastou sem vender: a partir de ${formatarLimite(valor)} na moeda da conta.`,
      });
      iniciar(() => router.refresh());
    } catch (e) {
      const msg = e instanceof TypeError ? erroDoTelegram(0) : e instanceof Error ? e.message : String(e);
      setErro(msg);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-2 border-t border-border px-4 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        void salvar();
      }}
    >
      <Label htmlFor={`${id}-limite`}>Limite do “Gastou sem vender”</Label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={`${id}-limite`}
          inputMode="decimal"
          autoComplete="off"
          value={texto}
          disabled={travado}
          onChange={(e) => {
            setTexto(e.target.value);
            setErro(null);
          }}
          aria-invalid={!!erro || undefined}
          aria-describedby={`${id}-limite-ajuda`}
          className="num w-32 text-right"
        />
        <Button
          type="submit"
          variant="secondary"
          pending={salvando}
          disabled={travado || (!alterado && !salvando)}
        >
          Salvar limite
        </Button>
      </div>
      <p
        id={`${id}-limite-ajuda`}
        className={erro ? "text-label text-err" : "text-label text-t2"}
        role={erro ? "alert" : undefined}
      >
        {erro ??
          (travado
            ? "Não deu para ler o limite salvo. Atualize a tela para editar."
            : "Na moeda da conta de anúncio. Vale para todas as lojas.")}
      </p>
    </form>
  );
}
