"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface OpcaoRota {
  id: string;
  rotulo: string;
  /** "Ativa", "Pausada": vai escrito junto do nome no menu (estado nunca so por cor). */
  estado: string;
}

/**
 * Qual rota a tela mostra. Fica na URL (?rota=) para dar para mandar o link;
 * trocar pede a tela de novo ao servidor, que le so a rota escolhida.
 * O rotulo visivel ("Rota") mora em quem chama; `rotuloId` liga os dois.
 */
export function SeletorRota({ rotas, atual, rotuloId }: { rotas: OpcaoRota[]; atual: string; rotuloId: string }) {
  const router = useRouter();
  const [, iniciar] = useTransition();
  const porId = new Map(rotas.map((r) => [r.id, r]));

  return (
    <Select
      value={atual}
      onValueChange={(v) => {
        if (!v || v === atual) return;
        iniciar(() => router.push(`/overview?rota=${encodeURIComponent(v)}`, { scroll: false }));
      }}
    >
      <SelectTrigger
        id="seletor-rota-gatilho"
        aria-labelledby={`${rotuloId} seletor-rota-gatilho`}
        className="h-ctl-lg sm:h-ctl-md"
      >
        <SelectValue>{(v: string | null) => (v ? (porId.get(v)?.rotulo ?? "Escolha a rota") : "Escolha a rota")}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {rotas.map((r) => (
          <SelectItem key={r.id} value={r.id}>
            <span className="min-w-0 truncate">{r.rotulo}</span>
            <span className="shrink-0 text-label text-t2">{r.estado}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
