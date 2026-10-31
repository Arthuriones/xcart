import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { aoErroDeSessao } from "./api";
import { tirarAparelho } from "./push";

// ============================================================================
// Quem esta logado. `semAcesso` = o servidor respondeu 403 sem_acesso (plano
// vencido): o app mostra uma tela neutra, sem preco nem link de compra (regra
// 3.1.1 da Apple). 401 de qualquer rota derruba a sessao.
// ============================================================================

interface ValorSessao {
  carregando: boolean;
  sessao: Session | null;
  email: string | null;
  semAcesso: boolean;
  entrar: (email: string, senha: string) => Promise<string | null>;
  sair: () => Promise<void>;
  /** Volta a tentar depois do "sem acesso" (o lojista renovou pelo site). */
  conferirDeNovo: () => void;
}

const Contexto = createContext<ValorSessao | null>(null);

/** Erro do Supabase Auth -> frase da tela. */
function fraseDoLogin(mensagem: string): string {
  const m = mensagem.toLowerCase();
  if (m.includes("invalid login credentials")) return "E-mail ou senha incorretos.";
  if (m.includes("email not confirmed")) return "Confirme o seu e-mail antes de entrar (veja a caixa de entrada).";
  if (m.includes("network") || m.includes("fetch")) return "Sem conexão. Confira a internet e tente de novo.";
  if (m.includes("rate") || m.includes("too many")) return "Muitas tentativas. Espere um pouco e tente de novo.";
  return "Não deu para entrar agora. Tente de novo.";
}

export function ProvedorSessao({ children }: { children: ReactNode }) {
  const [carregando, setCarregando] = useState(true);
  const [sessao, setSessao] = useState<Session | null>(null);
  const [semAcesso, setSemAcesso] = useState(false);

  useEffect(() => {
    let vivo = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (vivo) setSessao(data.session);
        // Deslogado com um aparelho ainda guardado (o DELETE da saida falhou sem
        // rede): tenta tirar de novo, senao o celular segue recebendo vendas.
        if (!data.session) void tirarAparelho();
      })
      .finally(() => {
        if (vivo) setCarregando(false);
      });
    const { data } = supabase.auth.onAuthStateChange((evento, nova) => {
      setSessao(nova);
      if (!nova) setSemAcesso(false);
      // Sessao que caiu sem o "Sair" (refresh token recusado pelo servidor):
      // o aparelho sai tambem. Depois do sair() normal o token ja foi tirado.
      if (evento === "SIGNED_OUT") void tirarAparelho();
    });
    return () => {
      vivo = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const sair = useCallback(async () => {
    // O aparelho sai ANTES do login: sem isso o celular seguiria recebendo vendas.
    await tirarAparelho();
    const { error } = await supabase.auth.signOut({ scope: "local" });
    // O "local" so falha em casos raros (storage); sem sessao na memoria o app volta ao login igual.
    if (error) setSessao(null);
  }, []);

  useEffect(() => {
    aoErroDeSessao((e) => {
      if (e.codigo === "sem_acesso") setSemAcesso(true);
      else if (e.status === 401) void sair();
    });
    return () => aoErroDeSessao(null);
  }, [sair]);

  const entrar = useCallback(async (email: string, senha: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha });
    return error ? fraseDoLogin(error.message) : null;
  }, []);

  const valor = useMemo<ValorSessao>(
    () => ({
      carregando,
      sessao,
      email: sessao?.user.email ?? null,
      semAcesso,
      entrar,
      sair,
      conferirDeNovo: () => setSemAcesso(false),
    }),
    [carregando, sessao, semAcesso, entrar, sair]
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useSessao(): ValorSessao {
  const v = useContext(Contexto);
  if (!v) throw new Error("useSessao fora do ProvedorSessao");
  return v;
}
