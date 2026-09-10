import { z } from "zod";
import { comTempoLimite } from "@/lib/ai/limites";
import { authenticate } from "@/lib/mcp/auth";
import { TOOLS, TOOLS_BY_NAME } from "@/lib/mcp/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Implementacao stateless de MCP sobre Streamable HTTP: cada POST e uma
// requisicao JSON-RPC completa e independente. Sem sessao e sem SSE, porque
// nenhuma ferramenta daqui e long-running e o app roda em Vercel, onde manter
// stream aberto entre invocacoes nao e confiavel.

const PROTOCOL = "2025-06-18";

type Json = Record<string, unknown>;

const ok = (id: unknown, result: unknown) =>
  Response.json({ jsonrpc: "2.0", id, result });

const fail = (id: unknown, code: number, message: string) =>
  Response.json({ jsonrpc: "2.0", id, error: { code, message } });

/**
 * Teto do que volta para o modelo.
 *
 * O resultado da ferramenta vira TOKEN DE ENTRADA na proxima mensagem, e a
 * conta e do usuario. `shopify_query` sem teto podia devolver 250 produtos com
 * todos os campos -- centenas de milhares de tokens numa unica chamada, e o
 * modelo nem usa tudo. Recortar aqui, num ponto so, cobre toda ferramenta
 * presente e futura.
 */
const MAX_RESPOSTA = 120_000;

/** Prazo de qualquer ferramenta. */
const TIMEOUT_MS = 60_000;

function recortar(texto: string): string {
  if (texto.length <= MAX_RESPOSTA) return texto;
  return (
    texto.slice(0, MAX_RESPOSTA) +
    `\n\n[...recortado em ${MAX_RESPOSTA} caracteres. Peca menos campos ou pagine ` +
    `a consulta -- resultado gigante custa token e o restante nao ajuda.]`
  );
}

function inputSchemaOf(schema: z.ZodType) {
  try {
    const js = z.toJSONSchema(schema, { io: "input" }) as Json;
    // O MCP exige type:"object" na raiz; z.object() ja produz isso, mas
    // ferramentas sem argumento podem sair sem "properties".
    return { type: "object", properties: {}, ...js };
  } catch {
    return { type: "object", properties: {} };
  }
}

export async function POST(req: Request) {
  let body: Json;
  try {
    body = (await req.json()) as Json;
  } catch {
    return fail(null, -32700, "JSON invalido");
  }

  const { id, method, params } = body as { id: unknown; method: string; params?: Json };

  // Notificacoes (sem id) nao esperam resposta. 202 sem corpo.
  const isNotification = id === undefined || id === null;

  if (method === "initialize") {
    return ok(id, {
      protocolVersion: PROTOCOL,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "xcart", title: "xcart — sua loja Shopify", version: "1.0.0" },
      instructions:
        "Ferramentas para ler e editar as lojas Shopify conectadas na conta xcart do usuario. " +
        "Chame list_stores primeiro para descobrir os storeId. " +
        "Depois de qualquer escrita, confirme com verify_page: a Shopify serve por CDN e " +
        "resposta de API dizendo 'ok' nao prova que a pagina renderizou.",
    });
  }

  if (method === "notifications/initialized" || isNotification) {
    return new Response(null, { status: 202 });
  }

  if (method === "ping") return ok(id, {});

  // Tudo abaixo toca dados do usuario e exige token.
  const auth = await authenticate(req);
  if (!auth.ok) {
    const MOTIVO = {
      invalid:
        "Token ausente ou invalido. Gere um em xcart > Canais > Claude (MCP) e mande no " +
        "header Authorization: Bearer xcart_mcp_...",
      revoked: "Este token foi revogado. Gere um novo em xcart > Canais > Claude (MCP).",
      expired: "Este token expirou. Gere um novo em xcart > Canais > Claude (MCP).",
      rate_limited:
        `Limite de chamadas atingido. Tente de novo em ${auth.retryAfter}s. ` +
        "O teto existe para uma automacao em loop nao esgotar o limite da API da sua loja na Shopify.",
    } as const;

    const limitado = auth.reason === "rate_limited";
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (limitado) headers["Retry-After"] = String(auth.retryAfter);
    // Sinaliza ao cliente MCP que o problema e credencial, nao rota.
    else headers["WWW-Authenticate"] = 'Bearer realm="xcart"';

    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: { code: limitado ? -32029 : -32001, message: MOTIVO[auth.reason] },
      }),
      { status: limitado ? 429 : 401, headers }
    );
  }
  const identity = auth.identity;

  if (method === "tools/list") {
    return ok(id, {
      tools: TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: inputSchemaOf(t.schema),
      })),
    });
  }

  if (method === "tools/call") {
    const nome = params?.name as string;
    const tool = TOOLS_BY_NAME.get(nome);
    if (!tool) return fail(id, -32602, `Ferramenta desconhecida: ${nome}`);

    const parsed = tool.schema.safeParse((params?.arguments as Json) ?? {});
    if (!parsed.success) {
      return ok(id, {
        isError: true,
        content: [
          {
            type: "text",
            text: `Argumentos invalidos para ${nome}:\n${JSON.stringify(parsed.error.issues, null, 2)}`,
          },
        ],
      });
    }

    try {
      // Prazo por ferramenta. Sem ele, uma loja lenta (ou uma query pesada)
      // segura a funcao serverless ate o maxDuration e o cliente MCP fica
      // pendurado sem saber o que houve.
      // comTempoLimite e nao um Promise.race inline: a versao inline nao
      // limpava o setTimeout quando a ferramenta respondia rapido (o caso
      // normal), e o timer ficava pendente os 60s inteiros segurando o
      // closure e o event loop da funcao. comTempoLimite ja faz o
      // clearTimeout no finally.
      const out = await comTempoLimite(
        tool.handler(parsed.data as Json, identity),
        TIMEOUT_MS,
        `ferramenta ${nome}`
      );
      return ok(id, {
        content: [{ type: "text", text: recortar(JSON.stringify(out, null, 2)) }],
      });
    } catch (e) {
      // Erro de ferramenta volta como isError (nao como erro JSON-RPC): assim o
      // modelo le a mensagem e corrige, em vez de a conversa inteira falhar.
      return ok(id, {
        isError: true,
        content: [
          { type: "text", text: recortar(e instanceof Error ? e.message : String(e)) },
        ],
      });
    }
  }

  return fail(id, -32601, `Metodo nao suportado: ${method}`);
}

// Alguns clientes abrem GET esperando SSE. Respondemos 405 explicitamente para
// que caiam no modo POST-only em vez de ficarem pendurados.
export async function GET() {
  return new Response("Este endpoint MCP aceita apenas POST (Streamable HTTP sem SSE).", {
    status: 405,
    headers: { Allow: "POST" },
  });
}
