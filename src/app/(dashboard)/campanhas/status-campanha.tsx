"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dica } from "@/components/ui/dica";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import type { LinhaCampanha } from "./tipos";
import { linkDoErro, motivoDoStatus, nivelEditavel, pedirAlteracao } from "./edicao-anuncio";

/** effective_status do Meta (e o da conta) em palavras. */
function rotuloStatus(status: string | null): { texto: string; ativa: boolean } {
  switch ((status ?? "").toUpperCase()) {
    case "":
      return { texto: "—", ativa: false };
    case "ACTIVE":
      return { texto: "Ativa", ativa: true };
    case "PAUSED":
    case "CAMPAIGN_PAUSED":
    case "ADSET_PAUSED":
      return { texto: "Pausada", ativa: false };
    case "ARCHIVED":
      return { texto: "Arquivada", ativa: false };
    case "DELETED":
      return { texto: "Excluída", ativa: false };
    case "DISAPPROVED":
      return { texto: "Reprovada", ativa: false };
    case "PENDING_REVIEW":
    case "IN_PROCESS":
      return { texto: "Em análise", ativa: false };
    case "WITH_ISSUES":
      return { texto: "Com problema", ativa: false };
    case "CLOSED":
      return { texto: "Fechada", ativa: false };
    default:
      return { texto: status ?? "—", ativa: false };
  }
}

function Selo({ status }: { status: string | null }) {
  const { texto, ativa } = rotuloStatus(status);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
        ativa ? "bg-ok-bg text-ok border border-ok-border" : "bg-surface text-t3 border border-border"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ativa ? "bg-ok" : "bg-t3"}`} />
      {texto}
    </span>
  );
}

/**
 * Celula de status da tabela: o selo e, na linha do Meta que se edita, o
 * interruptor de ligar/pausar. A linha so traz o effective_status (o sync),
 * entao o interruptor manda sem `esperado` -- quem confere o estado de agora
 * e o servidor (ja ligado/ja pausado volta 400 com a frase).
 */
export function CelulaStatus({ linha }: { linha: LinhaCampanha }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // O status que o Meta devolveu, ate o refresh trazer a linha nova. Preso ao
  // status de ANTES: se o periodo da barra nao inclui hoje, o retrato que o
  // servidor corrige nao e o que a linha mostra, e o refresh traria o velho.
  const [feito, setFeito] = useState<{ de: string | null; para: string } | null>(null);
  const status = feito && feito.de === linha.status ? feito.para : linha.status;
  const nivel = nivelEditavel(linha);

  // Sem status (linha sem detalhe) nao ha o que mostrar no interruptor: o
  // Editar le o de agora no Meta.
  if (!nivel || !status) return <Selo status={status} />;

  const s = status.toUpperCase();
  const ligado = s === "ACTIVE";
  const travado = s === "ARCHIVED" || s === "DELETED";
  const motivo = ligado || s === "PAUSED" ? null : motivoDoStatus(s);

  async function alternar(ligar: boolean) {
    if (!nivel) return;
    setEnviando(true);
    setErro(null);
    const r = await pedirAlteracao({
      conta: linha.contaId,
      nivel,
      id: linha.objetoId,
      campo: "status",
      valor: ligar ? "ACTIVE" : "PAUSED",
      esperado: null,
    });
    setEnviando(false);
    if (!r.ok) {
      setErro(r.erro);
      return;
    }
    setFeito({ de: linha.status, para: r.objeto.efetivo || r.objeto.status });
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Switch
          checked={ligado}
          disabled={enviando || travado}
          aria-busy={enviando || undefined}
          aria-label={`Ligado no Meta: ${linha.nome}`}
          onCheckedChange={(v) => alternar(v)}
        />
        {enviando ? <Spinner size={12} rotulo="Mudando no Meta" /> : <Selo status={status} />}
        {motivo ? <Dica rotulo={`Por que ${linha.nome} não está rodando`}>{motivo}</Dica> : null}
      </div>
      {erro ? (
        <p role="alert" className="max-w-56 whitespace-normal text-label text-err">
          {erro} {linkDoErro(erro)}
        </p>
      ) : null}
    </div>
  );
}
