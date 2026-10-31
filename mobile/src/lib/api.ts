import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { Filtro } from "./tipos";

// ============================================================================
// Chamada as rotas do Panda Track (o mesmo servidor do site). Todo pedido leva
// `Authorization: Bearer <access token>`; o filtro do topo (loja, periodo,
// moeda, comparacao) vai nos cabecalhos x-xc-*, como o site faz com cookie.
//
// Resposta { ok: true, ... } -> os dados; { ok: false } -> ErroApi com a frase
// do servidor (ja escrita para a tela). Sem rede -> frase fixa.
// ============================================================================

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "https://user.xcart.app").replace(/\/+$/, "");

export class ErroApi extends Error {
  status: number;
  codigo: string | null;
  /** O corpo inteiro da resposta de erro (o 409 da edicao traz o objeto atual). */
  corpo: Record<string, unknown> | null;
  constructor(mensagem: string, status: number, codigo: string | null, corpo: Record<string, unknown> | null = null) {
    super(mensagem);
    this.name = "ErroApi";
    this.status = status;
    this.codigo = codigo;
    this.corpo = corpo;
  }
}

/** Quem ouve 401 (sessao caiu) e 403 sem_acesso (plano vencido): a sessao. */
type Ouvinte = (e: ErroApi) => void;
let ouvinte: Ouvinte | null = null;
export function aoErroDeSessao(f: Ouvinte | null) {
  ouvinte = f;
}

const PRAZO_MS = 30_000;

/** Chamadas que esperam o Meta ou apagam a conta: o servidor tem ate 60 s. */
export const PRAZO_LONGO_MS = 65_000;

export async function chamar<T>(
  caminho: string,
  opcoes: {
    metodo?: "GET" | "POST" | "PATCH" | "DELETE";
    corpo?: unknown;
    filtro?: Filtro | null;
    semLogin?: boolean;
    prazoMs?: number;
  } = {}
): Promise<T> {
  const cabecalhos: Record<string, string> = { accept: "application/json" };
  if (opcoes.corpo !== undefined) cabecalhos["content-type"] = "application/json";
  if (!opcoes.semLogin) {
    const { data, error } = await supabase.auth.getSession();
    // Token vencido sem rede para renovar: e falta de conexao, nao login perdido.
    if (error && isAuthRetryableFetchError(error)) {
      throw new ErroApi("Sem conexão com o Panda Track. Confira a internet e tente de novo.", 0, "sem_rede");
    }
    const token = data.session?.access_token;
    if (!token) throw new ErroApi("Entre de novo no app.", 401, "sem_login");
    cabecalhos.authorization = `Bearer ${token}`;
  }
  if (opcoes.filtro) {
    cabecalhos["x-xc-loja"] = opcoes.filtro.loja;
    cabecalhos["x-xc-periodo"] = opcoes.filtro.periodo;
    cabecalhos["x-xc-moeda"] = opcoes.filtro.moeda;
    cabecalhos["x-xc-comparar"] = opcoes.filtro.comparar;
  }

  const controle = new AbortController();
  const prazo = setTimeout(() => controle.abort(), opcoes.prazoMs ?? PRAZO_MS);
  let resposta: Response;
  try {
    resposta = await fetch(API_URL + caminho, {
      method: opcoes.metodo ?? "GET",
      headers: cabecalhos,
      body: opcoes.corpo === undefined ? undefined : JSON.stringify(opcoes.corpo),
      signal: controle.signal,
    });
  } catch {
    if (controle.signal.aborted) {
      // O pedido pode ter chegado ao servidor: a alteracao pode ter entrado.
      throw new ErroApi("O Panda Track demorou para responder. A mudança pode ter entrado: confira antes de tentar de novo.", 0, "prazo");
    }
    throw new ErroApi("Sem conexão com o Panda Track. Confira a internet e tente de novo.", 0, "sem_rede");
  } finally {
    clearTimeout(prazo);
  }

  let corpo: Record<string, unknown> | null = null;
  try {
    corpo = (await resposta.json()) as Record<string, unknown>;
  } catch {
    corpo = null;
  }

  if (resposta.ok && corpo && corpo.ok === true) return corpo as T;

  const erro = new ErroApi(
    typeof corpo?.erro === "string" && corpo.erro
      ? corpo.erro
      : resposta.status === 401
        ? "Sua sessão expirou. Entre de novo."
        : "O Panda Track não respondeu como esperado. Tente de novo.",
    resposta.status,
    typeof corpo?.codigo === "string" ? corpo.codigo : null,
    corpo
  );
  // So o "sem_login" das rotas do app derruba a sessao: o 401 sem codigo das
  // rotas do Meta tambem sai quando o login do Supabase so oscilou.
  if ((resposta.status === 401 && erro.codigo === "sem_login") || erro.codigo === "sem_acesso") ouvinte?.(erro);
  throw erro;
}
