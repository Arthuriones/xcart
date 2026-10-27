import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
} from "@supabase/supabase-js";

// ============================================================================
// getCurrentUser: null so quando NAO ha sessao (ausente, revogada, recusada).
// Login fora do ar (rede, 5xx, prazo estourado, 429) lanca. Antes o error do
// getUser era descartado, e cada tela tratava a pane como "conta sem loja":
// "Conecte uma loja", Campanhas sem conta, Alertas com "Nada quebrado agora".
// ============================================================================

vi.mock("server-only", () => ({}));

const auth = vi.hoisted(() => ({
  resposta: null as unknown,
  // As opcoes do cliente da sessao (server.ts real): o fetch com prazo.
  opcoes: null as { global?: { fetch?: typeof fetch } } | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => auth.resposta } }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _chave: string, opcoes: { global?: { fetch?: typeof fetch } }) => {
    auth.opcoes = opcoes;
    return {};
  },
}));

import { getCurrentUser } from "@/lib/supabase/current-user";

const USUARIO = { id: "u1", email: "lojista@exemplo.com" };

function semUsuario(error: unknown) {
  return { data: { user: null }, error };
}

beforeEach(() => {
  auth.resposta = null;
  auth.opcoes = null;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("getCurrentUser", () => {
  it("sessao valida: o usuario", async () => {
    auth.resposta = { data: { user: USUARIO }, error: null };
    await expect(getCurrentUser()).resolves.toEqual(USUARIO);
  });

  it("sem sessao, sessao encerrada, token recusado (401/403): null, nunca erro", async () => {
    for (const erro of [
      new AuthSessionMissingError(),
      new AuthApiError("invalid JWT", 401, "bad_jwt"),
      new AuthApiError("User from sub claim in JWT does not exist", 403, "user_not_found"),
    ]) {
      auth.resposta = semUsuario(erro);
      await expect(getCurrentUser(), erro.message).resolves.toBeNull();
    }
  });

  it("rede caiu ou prazo estourou (status 0): lanca", async () => {
    auth.resposta = semUsuario(new AuthRetryableFetchError("fetch failed", 0));
    await expect(getCurrentUser()).rejects.toThrow("O login do xcart não respondeu agora.");
  });

  it("5xx do login: lanca", async () => {
    for (const status of [500, 502, 503, 504, 522]) {
      auth.resposta = semUsuario(new AuthRetryableFetchError("Service Unavailable", status));
      await expect(getCurrentUser(), String(status)).rejects.toThrow("O login do xcart não respondeu agora.");
    }
  });

  it("429 (limite de requisicoes do login): lanca", async () => {
    auth.resposta = semUsuario(new AuthApiError("Request rate limit reached", 429, "over_request_rate_limit"));
    await expect(getCurrentUser()).rejects.toThrow("O login do xcart não respondeu agora.");
  });
});

// O cliente da sessao (server.ts) corta cada ida ao Supabase em 10 s: acima dos
// 8 s do statement timeout, para a consulta lenta ainda chegar com o 57014.
describe("prazo do cliente da sessao", () => {
  it("createClient passa um fetch que corta em 10 s com AbortError", async () => {
    const { createClient } = await vi.importActual<typeof import("@/lib/supabase/server")>("@/lib/supabase/server");
    await createClient();
    const fetchDaSessao = auth.opcoes?.global?.fetch;
    expect(typeof fetchDaSessao).toBe("function");

    vi.useFakeTimers();
    vi.stubGlobal("fetch", (_url: unknown, init?: RequestInit) => {
      return new Promise((_ok, falhar) => {
        init?.signal?.addEventListener("abort", () => falhar(init.signal!.reason));
      });
    });
    let fim: "pendente" | "erro" = "pendente";
    let erro: unknown = null;
    fetchDaSessao!("https://projeto.supabase.co/rest/v1/stores", {}).catch((e) => {
      fim = "erro";
      erro = e;
    });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(fim).toBe("pendente");
    await vi.advanceTimersByTimeAsync(1);
    expect(fim).toBe("erro");
    expect((erro as Error).name).toBe("AbortError");
  });

  // A rota de API renova o token aqui (o proxy pula /api). Cortada em 10 s, a
  // renovacao repetida com o mesmo refresh token fora da janela de reuso do
  // login revogava a sessao inteira.
  it("renovar o token tem 15 s", async () => {
    const { createClient } = await vi.importActual<typeof import("@/lib/supabase/server")>("@/lib/supabase/server");
    await createClient();
    const fetchDaSessao = auth.opcoes?.global?.fetch;

    vi.useFakeTimers();
    vi.stubGlobal("fetch", (_url: unknown, init?: RequestInit) => {
      return new Promise((_ok, falhar) => {
        init?.signal?.addEventListener("abort", () => falhar(init.signal!.reason));
      });
    });
    let fim: "pendente" | "erro" = "pendente";
    fetchDaSessao!("https://projeto.supabase.co/auth/v1/token?grant_type=refresh_token", { method: "POST" }).catch(
      () => (fim = "erro")
    );
    await vi.advanceTimersByTimeAsync(14_999);
    expect(fim).toBe("pendente");
    await vi.advanceTimersByTimeAsync(1);
    expect(fim).toBe("erro");
  });
});
