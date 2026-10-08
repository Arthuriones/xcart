import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

// Simula banco em memória para ad_connection_tickets
interface MockTicketRow {
  id: string;
  user_id: string;
  plataforma: string;
  ticket_hash: string;
  status: "pending" | "completed" | "expired" | "error";
  resultado?: Record<string, unknown>;
  expires_at: string;
  created_at: string;
}

let mockTickets: MockTicketRow[] = [];
let mockCurrentUser: { id: string } | null = null;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: mockCurrentUser },
      }),
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table !== "ad_connection_tickets") {
        return {
          upsert: vi.fn().mockReturnValue({
            select: () => ({
              maybeSingle: () => Promise.resolve({ id: "mock-conn-1" }),
            }),
          }),
        };
      }

      return {
        insert: (row: Record<string, unknown>) => {
          const inserted: MockTicketRow = {
            id: `ticket-id-${mockTickets.length + 1}`,
            user_id: row.user_id as string,
            plataforma: row.plataforma as string,
            ticket_hash: row.ticket_hash as string,
            status: (row.status as MockTicketRow["status"]) || "pending",
            resultado: (row.resultado as Record<string, unknown>) || {},
            expires_at: row.expires_at as string,
            created_at: new Date().toISOString(),
          };
          mockTickets.push(inserted);
          return Promise.resolve({ error: null, data: inserted });
        },
        select: (cols: string) => {
          let rows = [...mockTickets];
          const query = {
            eq: (col: string, val: unknown) => {
              rows = rows.filter((r) => (r as unknown as Record<string, unknown>)[col] === val);
              return query;
            },
            maybeSingle: () => {
              return Promise.resolve({ data: rows[0] || null, error: null });
            },
          };
          return query;
        },
        update: (values: Record<string, unknown>) => {
          return {
            eq: (col: string, val: unknown) => {
              for (const r of mockTickets) {
                if ((r as unknown as Record<string, unknown>)[col] === val) {
                  Object.assign(r, values);
                }
              }
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  }),
}));

import {
  criarTicketMultilogin,
  validarTicketMultilogin,
  concluirTicketMultilogin,
  falharTicketMultilogin,
  consultarTicketMultilogin,
} from "@/lib/ads/multilogin-ticket";
import { POST as postTicket, GET as getTicket } from "@/app/api/auth/meta/ticket/route";
import { GET as getLogin } from "@/app/api/auth/meta/login/route";
import { NextRequest } from "next/server";

describe("multilogin-ticket", () => {
  beforeEach(() => {
    mockTickets = [];
    mockCurrentUser = null;
    vi.stubEnv("META_APP_ID", "mock-app-id");
    vi.stubEnv("META_APP_SECRET", "mock-app-secret");
  });

  it("cria ticket com 64 hex caracteres e expira em 15 minutos", async () => {
    const res = await criarTicketMultilogin(
      "user-123",
      "meta",
      "https://app.xcart.com.br"
    );

    expect(res.ticket).toHaveLength(64);
    expect(res.url).toBe(
      `https://app.xcart.com.br/api/auth/meta/login?ticket=${res.ticket}`
    );

    const dataExpira = new Date(res.expiresAt).getTime();
    const agora = Date.now();
    const diffMinutos = (dataExpira - agora) / (1000 * 60);
    expect(diffMinutos).toBeGreaterThanOrEqual(14.8);
    expect(diffMinutos).toBeLessThanOrEqual(15.2);

    expect(mockTickets).toHaveLength(1);
    expect(mockTickets[0].ticket_hash).toBe(res.ticket);
    expect(mockTickets[0].status).toBe("pending");
  });

  it("valida ticket existente e rejeita ticket invalido ou curto", async () => {
    const { ticket } = await criarTicketMultilogin(
      "user-abc",
      "meta",
      "https://app.xcart.com.br"
    );

    const curto = await validarTicketMultilogin("123", "meta");
    expect(curto).toBeNull();

    const valido = await validarTicketMultilogin(ticket, "meta");
    expect(valido).not.toBeNull();
    expect(valido?.userId).toBe("user-abc");
    expect(valido?.status).toBe("pending");

    // Plataforma diferente não encontra
    const outro = await validarTicketMultilogin(ticket, "google");
    expect(outro).toBeNull();
  });

  it("marca ticket expirado quando passa da data limite", async () => {
    const { ticket } = await criarTicketMultilogin(
      "user-abc",
      "meta",
      "https://app.xcart.com.br"
    );

    // Força expiração
    mockTickets[0].expires_at = new Date(Date.now() - 1000).toISOString();

    const resultado = await validarTicketMultilogin(ticket, "meta");
    expect(resultado).toBeNull();
    expect(mockTickets[0].status).toBe("expired");
  });

  it("conclui ticket com dados do perfil e contas", async () => {
    const { ticket } = await criarTicketMultilogin(
      "user-xyz",
      "meta",
      "https://app.xcart.com.br"
    );

    const ticketValido = await validarTicketMultilogin(ticket, "meta");
    expect(ticketValido).not.toBeNull();

    await concluirTicketMultilogin(ticketValido!.id, {
      ok: true,
      nome: "Minha Loja Dropshipping",
      contas: 3,
    });

    const statusFinal = await consultarTicketMultilogin(ticket);
    expect(statusFinal?.status).toBe("completed");
    expect(statusFinal?.resultado?.nome).toBe("Minha Loja Dropshipping");
    expect(statusFinal?.resultado?.contas).toBe(3);
  });

  it("registra falha no ticket quando houver erro", async () => {
    const { ticket } = await criarTicketMultilogin(
      "user-falha",
      "meta",
      "https://app.xcart.com.br"
    );

    const ticketValido = await validarTicketMultilogin(ticket, "meta");
    await falharTicketMultilogin(ticketValido!.id, "Permissões insuficientes");

    const statusFinal = await consultarTicketMultilogin(ticket);
    expect(statusFinal?.status).toBe("error");
    expect(statusFinal?.resultado?.erro).toBe("Permissões insuficientes");
  });
});

describe("API routes de ticket multilogin", () => {
  beforeEach(() => {
    mockTickets = [];
    mockCurrentUser = null;
    vi.stubEnv("META_APP_ID", "mock-app-id");
    vi.stubEnv("META_APP_SECRET", "mock-app-secret");
  });

  it("POST /api/auth/meta/ticket retorna 401 se nao autenticado", async () => {
    mockCurrentUser = null;
    const req = new NextRequest("https://app.xcart.com.br/api/auth/meta/ticket", {
      method: "POST",
    });
    const res = await postTicket(req);
    expect(res.status).toBe(401);
  });

  it("POST /api/auth/meta/ticket gera ticket para usuario logado", async () => {
    mockCurrentUser = { id: "user-autenticado-1" };
    const req = new NextRequest("https://app.xcart.com.br/api/auth/meta/ticket", {
      method: "POST",
    });
    const res = await postTicket(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.ticket).toBeDefined();
    expect(body.url).toContain(`/api/auth/meta/login?ticket=${body.ticket}`);
  });

  it("GET /api/auth/meta/ticket retorna status do ticket", async () => {
    const { ticket } = await criarTicketMultilogin(
      "user-check",
      "meta",
      "https://app.xcart.com.br"
    );

    const req = new NextRequest(
      `https://app.xcart.com.br/api/auth/meta/ticket?ticket=${ticket}`
    );
    const res = await getTicket(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe("pending");
  });

  it("GET /api/auth/meta/login com ticket valido redireciona para OAuth da Meta com state prefixado", async () => {
    const { ticket } = await criarTicketMultilogin(
      "user-multilogin",
      "meta",
      "https://app.xcart.com.br"
    );

    const req = new NextRequest(
      `https://app.xcart.com.br/api/auth/meta/login?ticket=${ticket}`
    );
    const res = await getLogin(req);
    expect(res.status).toBe(307);
    const redirectUrl = res.headers.get("location");
    expect(redirectUrl).toContain("facebook.com");
    expect(redirectUrl).toContain(`state=ticket.${ticket}`);
    expect(redirectUrl).toContain("client_id=mock-app-id");
  });

  it("GET /api/auth/meta/login com ticket invalido ou expirado retorna 400", async () => {
    const req = new NextRequest(
      "https://app.xcart.com.br/api/auth/meta/login?ticket=inexistente123456789012345678901234"
    );
    const res = await getLogin(req);
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain("Link Expirado ou Inválido");
  });
});
