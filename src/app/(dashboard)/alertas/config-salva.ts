"use client";

import { useEffect, useState } from "react";

// ============================================================================
// A rota do canal (POST /api/alertas/canal) grava a config INTEIRA de uma vez:
// chat, ligado, avisos e o limite do "gastou sem vender". Dois formularios
// usam a rota -- o do Telegram (aba Canais) e o do limite (aba Regras) -- e
// cada um manda os campos do outro como estao gravados.
//
// Sem isto, salvar o Telegram e logo depois o limite (antes do refresh
// chegar) mandaria o chat antigo de volta. Quem salva avisa por um evento de
// janela; quem escuta atualiza a copia. Sem estado global.
// ============================================================================

export interface ConfigCanal {
  telegram_chat_id: string | null;
  ativo: boolean;
  receber_avisos: boolean;
  gasto_sem_venda_min: number;
}

const EVENTO_CONFIG = "xc:alertas-config";

/** Depois de um POST que deu certo: a config como ficou gravada. */
export function avisarConfigSalva(c: ConfigCanal) {
  window.dispatchEvent(new CustomEvent<ConfigCanal>(EVENTO_CONFIG, { detail: c }));
}

/** A config gravada mais recente: a do servidor, ou a do ultimo salvamento nesta tela. */
export function useConfigSalva(doServidor: ConfigCanal): ConfigCanal {
  const [atual, setAtual] = useState(doServidor);
  const [anterior, setAnterior] = useState(doServidor);
  // Refresh trouxe outra config: o servidor volta a mandar.
  if (JSON.stringify(doServidor) !== JSON.stringify(anterior)) {
    setAnterior(doServidor);
    setAtual(doServidor);
  }
  useEffect(() => {
    const ouvir = (e: Event) => setAtual((e as CustomEvent<ConfigCanal>).detail);
    window.addEventListener(EVENTO_CONFIG, ouvir);
    return () => window.removeEventListener(EVENTO_CONFIG, ouvir);
  }, []);
  return atual;
}
