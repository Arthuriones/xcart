import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { chamar, ErroApi } from "./api";
import type { Eu, Filtro } from "./tipos";

// ============================================================================
// O seletor do topo do site, no app: loja (ou checkout), periodo, moeda e
// comparacao. As opcoes vem de /api/app/v1/eu; a escolha fica guardada no
// celular e vai em toda chamada nos cabecalhos x-xc-* (src/lib/api.ts).
// ============================================================================

const CHAVE = "pt_filtro";

interface ValorFiltro {
  eu: Eu | null;
  erro: string | null;
  carregando: boolean;
  filtro: Filtro | null;
  mudar: (parte: Partial<Filtro>) => void;
  recarregar: () => void;
}

const Contexto = createContext<ValorFiltro | null>(null);

function filtroGuardado(): Partial<Filtro> | null {
  try {
    const t = localStorage.getItem(CHAVE);
    return t ? (JSON.parse(t) as Partial<Filtro>) : null;
  } catch {
    return null;
  }
}

/** A escolha guardada, so com o que ainda existe nas opcoes; o resto, o padrao. */
function conferir(eu: Eu, guardado: Partial<Filtro> | null): Filtro {
  const p = eu.filtroPadrao;
  const g = guardado ?? {};
  const lojaValida =
    g.loja === "todas" || eu.lojas.some((l) => l.id === g.loja) || eu.checkouts.some((c) => c.id === g.loja);
  const periodoValido =
    typeof g.periodo === "string" &&
    (eu.periodos.some((x) => x.id === g.periodo) || /^\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}$/.test(g.periodo));
  return {
    loja: lojaValida && g.loja ? g.loja : p.loja,
    periodo: periodoValido && g.periodo ? g.periodo : p.periodo,
    moeda: eu.moedas.some((m) => m.id === g.moeda) && g.moeda ? g.moeda : p.moeda,
    comparar: eu.comparacoes.some((c) => c.id === g.comparar) && g.comparar ? g.comparar : p.comparar,
  };
}

export function ProvedorFiltro({ children }: { children: ReactNode }) {
  const [eu, setEu] = useState<Eu | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [filtro, setFiltro] = useState<Filtro | null>(null);
  const [volta, setVolta] = useState(0);

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    setErro(null);
    chamar<Eu & { ok: true }>("/api/app/v1/eu")
      .then((r) => {
        if (!vivo) return;
        setEu(r);
        setFiltro(conferir(r, filtroGuardado()));
      })
      .catch((e: unknown) => {
        if (vivo) setErro(e instanceof ErroApi ? e.message : "Não deu para abrir a sua conta agora.");
      })
      .finally(() => {
        if (vivo) setCarregando(false);
      });
    return () => {
      vivo = false;
    };
  }, [volta]);

  const mudar = useCallback((parte: Partial<Filtro>) => {
    setFiltro((atual) => {
      if (!atual) return atual;
      const novo = { ...atual, ...parte };
      try {
        localStorage.setItem(CHAVE, JSON.stringify(novo));
      } catch {
        // Sem como guardar: vale so nesta abertura.
      }
      return novo;
    });
  }, []);

  const valor = useMemo<ValorFiltro>(
    () => ({ eu, erro, carregando, filtro, mudar, recarregar: () => setVolta((v) => v + 1) }),
    [eu, erro, carregando, filtro, mudar]
  );
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useFiltro(): ValorFiltro {
  const v = useContext(Contexto);
  if (!v) throw new Error("useFiltro fora do ProvedorFiltro");
  return v;
}

/** Nome da loja/checkout escolhido, ou "Todas as lojas". */
export function nomeDoFiltro(eu: Eu | null, filtro: Filtro | null): string {
  if (!eu || !filtro || filtro.loja === "todas") return "Todas as lojas";
  return (
    eu.lojas.find((l) => l.id === filtro.loja)?.nome ??
    eu.checkouts.find((c) => c.id === filtro.loja)?.nome ??
    "Todas as lojas"
  );
}
