import type { ReactNode } from "react";
import { Dica } from "@/components/ui/dica";
import { StatusBadge } from "@/components/ui/status-badge";
import type { Estado } from "./regras";

/**
 * Cabecalho de uma plataforma: nome, estado e, se houver, uma Dica ao lado do
 * nome. Sem botao de login: ele so entra, como botao principal, quando o
 * login (OAuth) da plataforma existir -- nada de botao desabilitado esperando.
 */
export function CabecalhoPlataforma({
  titulo,
  estado,
  dica,
}: {
  titulo: string;
  estado: Estado;
  /** Explicacao curta que antes era um aviso fixo na tela. */
  dica?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1">
        <h2 className="text-overlay text-ink">{titulo}</h2>
        {dica ? <Dica rotulo={`Sobre ${titulo}`}>{dica}</Dica> : null}
      </span>
      <StatusBadge tom={estado.tom}>{estado.texto}</StatusBadge>
    </div>
  );
}
