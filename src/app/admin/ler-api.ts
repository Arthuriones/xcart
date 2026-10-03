import "server-only";
import { NextRequest } from "next/server";
import { GET as getVisao } from "@/app/api/admin/overview/route";
import { GET as getAnalise } from "@/app/api/admin/analytics/route";
import { GET as getFaturamento } from "@/app/api/admin/revenue/route";
import { GET as getUsuario } from "@/app/api/admin/users/[id]/route";
import type { FaturamentoAdmin } from "@/lib/sales/admin-types";
import type { PeriodoFaturamento } from "./formato";
import type { AnaliseAdmin, DetalheUsuarioAdmin, VisaoAdmin } from "./tipos";

// ============================================================================
// As telas do admin leem no servidor chamando as MESMAS funcoes das rotas de
// API (src/app/api/admin/*). As rotas sao o contrato e nao mudam; chamar o
// handler daqui, em vez de copiar a conta para um arquivo novo, mantem uma
// verdade so -- MRR, margem e cambio saem do mesmo codigo nos dois caminhos.
//
// Cada handler confere a sessao e o is_admin sozinho, entao a pagina nao
// depende do layout (que renderiza em paralelo) para estar protegida.
// ============================================================================

export type Leitura<T> =
  | { ok: true; dados: T; /** Quando a leitura terminou (ms): o "Atualizado às". */ lidoEm: number }
  | { ok: false; status: number; detalhe: string };

/** Base so para montar o Request: os handlers nao olham o host. */
const BASE = "http://admin.interno";

async function ler<T>(chamar: () => Promise<Response>): Promise<Leitura<T>> {
  try {
    const r = await chamar();
    const corpo = (await r.json().catch(() => null)) as { error?: unknown } | null;
    if (!r.ok) {
      const erro = typeof corpo?.error === "string" ? corpo.error : "";
      return { ok: false, status: r.status, detalhe: `${r.status}${erro ? ` · ${erro}` : ""}` };
    }
    // O relogio e lido aqui, junto com os dados, e nao no render da tela.
    return { ok: true, dados: corpo as T, lidoEm: Date.now() };
  } catch (e) {
    console.error("[admin] leitura falhou", e);
    return { ok: false, status: 500, detalhe: e instanceof Error ? e.message : String(e) };
  }
}

export function lerVisao() {
  return ler<VisaoAdmin>(() => getVisao());
}

export function lerAnalise() {
  return ler<AnaliseAdmin>(() => getAnalise());
}

export function lerFaturamento(periodo: PeriodoFaturamento) {
  return ler<FaturamentoAdmin>(() =>
    getFaturamento(new Request(`${BASE}/api/admin/revenue?period=${periodo}`))
  );
}

export function lerUsuario(id: string) {
  return ler<DetalheUsuarioAdmin>(() =>
    getUsuario(new NextRequest(`${BASE}/api/admin/users/${encodeURIComponent(id)}`), {
      params: Promise.resolve({ id }),
    })
  );
}
