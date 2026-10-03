"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { lerListaGuardada } from "./lucro-dados";

// ============================================================================
// Uma lista guardada neste navegador (localStorage): KPIs fixados, avisos
// informativos dispensados. Preferencia de tela, nao dado: some numa janela
// anonima e tudo bem.
//
// useSyncExternalStore e nao useEffect + setState: o servidor desenha o
// padrao, o navegador troca pelo guardado na hidratacao, sem render a mais. O
// evento proprio avisa as outras partes da mesma aba; "storage", as outras abas.
// ============================================================================

const EVENTO = "xc:preferencia";

/** Navegador que bloqueia o armazenamento: a escolha vale ate recarregar. */
const memoria = new Map<string, string>();

function ler(chave: string): string | null {
  try {
    return window.localStorage.getItem(chave);
  } catch {
    return memoria.get(chave) ?? null;
  }
}

function assinar(aviso: () => void) {
  window.addEventListener("storage", aviso);
  window.addEventListener(EVENTO, aviso);
  return () => {
    window.removeEventListener("storage", aviso);
    window.removeEventListener(EVENTO, aviso);
  };
}

export function useListaGuardada(
  chave: string,
  padrao: readonly string[]
): [string[], (lista: string[]) => void] {
  const texto = useSyncExternalStore(
    assinar,
    () => ler(chave),
    () => null
  );
  // `padrao` vem de constante do modulo: a lista so muda quando o texto muda.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const lista = useMemo(() => lerListaGuardada(texto, padrao), [texto]);
  const gravar = useCallback(
    (nova: string[]) => {
      const texto = JSON.stringify(nova);
      try {
        window.localStorage.setItem(chave, texto);
      } catch {
        memoria.set(chave, texto);
      }
      window.dispatchEvent(new Event(EVENTO));
    },
    [chave]
  );
  return [lista, gravar];
}
