import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

// ============================================================================
// A pagina que o popup do OAuth (Meta e Google) mostra no fim do fluxo.
//
// E HTML montado a mao, fora do React -- entao nada aqui e escapado sozinho.
// Era assim antes: o `error_description` da URL ia cru para `<p>${erro}</p>`,
// num ramo que roda antes de conferir sessao e state. Um link
//   /api/auth/meta/callback?error=<img src=x onerror=...>
// executava script na origem do painel com a sessao de quem clicasse -- e no
// adm.*, com a de um admin.
//
// Tres regras, todas aqui para os dois callbacks nao divergirem:
//   1. O erro da URL NUNCA e mostrado: vira mensagem nossa (mensagemDoErroOAuth).
//   2. Todo texto interpolado no HTML passa por escHtml.
//   3. O que vai para o <script> passa por jsonNoScript, e o <script> so roda
//      com o nonce desta resposta (CSP propria, sem 'unsafe-inline').
// ============================================================================

export type PlataformaPopup = "meta" | "google";

const POR_PLATAFORMA: Record<
  PlataformaPopup,
  {
    tipo: string;
    volta: string;
    okTitulo: string;
    okTexto: string;
    contasTexto: (n: number) => string;
    erroPadrao: string;
  }
> = {
  meta: {
    tipo: "XCART_META_CONNECTED",
    volta: "/integracoes/meta",
    okTitulo: "Perfil conectado!",
    okTexto: "Sua conta do Meta Ads foi vinculada.",
    contasTexto: (n) => ` Encontramos ${n} conta(s) de anúncio.`,
    erroPadrao: "Não deu para autorizar no Facebook. Tente de novo.",
  },
  google: {
    tipo: "XCART_GOOGLE_CONNECTED",
    volta: "/integracoes/google",
    okTitulo: "Conta Google conectada!",
    okTexto: "Sua conta do Google Ads foi vinculada.",
    contasTexto: (n) => ` Encontramos ${n} conta(s) vinculada(s).`,
    erroPadrao: "Não deu para autorizar no Google. Tente de novo.",
  },
};

const ENTIDADES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Texto -> HTML seguro, em conteudo e em atributo entre aspas. */
export function escHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ENTIDADES[c]);
}

/**
 * JSON para dentro de `<script>`.
 *
 * `JSON.stringify` nao escapa `</script>`: um `</script><script>...` dentro de
 * uma string fechava o bloco e abria outro. Com `<` e `>` em \u, o HTML nunca
 * ve uma tag. U+2028/2029 sao fim de linha para JS antigo dentro de string.
 */
export function jsonNoScript(valor: unknown): string {
  return JSON.stringify(valor)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * O `error` que a Meta ou o Google devolvem na URL vira uma mensagem NOSSA.
 *
 * A URL de callback e publica: qualquer um monta um link com o `error` que
 * quiser. Mostrar o texto dela -- mesmo escapado -- e deixar terceiro escrever
 * na tela do app ("Sua conta foi suspensa, ligue para..."). O detalhe fica no
 * log do servidor.
 */
export function mensagemDoErroOAuth(codigo: string | null | undefined): string {
  return codigo === "access_denied"
    ? "Você cancelou a autorização."
    : "Falha na autorização. Tente de novo.";
}

export function renderPopupOAuth(
  plataforma: PlataformaPopup,
  {
    ok,
    nome,
    contas,
    erro,
  }: {
    ok: boolean;
    nome?: string | null;
    contas?: number;
    erro?: string | null;
  }
): NextResponse {
  const p = POR_PLATAFORMA[plataforma];
  const nContas = Math.max(0, Math.floor(Number(contas) || 0));
  const nomeLimpo = (nome || "").trim().slice(0, 120) || null;
  const erroFinal = ok ? null : (erro || p.erroPadrao).slice(0, 300);

  const mensagem = jsonNoScript({
    type: p.tipo,
    ok,
    nome: nomeLimpo,
    contas: nContas,
    erro: erroFinal,
  });
  const volta = jsonNoScript(p.volta);
  // Um por resposta: e o que deixa este <script> rodar e nenhum outro.
  const nonce = randomBytes(16).toString("base64");

  const titulo = ok
    ? nomeLimpo
      ? `Olá, ${escHtml(nomeLimpo)}!`
      : escHtml(p.okTitulo)
    : "Falha na autorização";
  const texto = ok
    ? escHtml(`${p.okTexto}${nContas ? p.contasTexto(nContas) : ""}`)
    : escHtml(erroFinal || p.erroPadrao);

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>${ok ? "Conectado" : "Falha na conexão"}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #0f1115;
      color: #f1f3f5;
      display: grid;
      place-items: center;
      height: 100vh;
      margin: 0;
      text-align: center;
      padding: 20px;
      box-sizing: border-box;
    }
    .box {
      background: #181b21;
      border: 1px solid #282d37;
      border-radius: 12px;
      padding: 32px 24px;
      max-width: 380px;
      width: 100%;
      box-shadow: 0 10px 25px rgba(0,0,0,0.5);
    }
    .icon { font-size: 36px; margin-bottom: 12px; }
    h2 {
      font-size: 18px;
      margin: 0 0 8px;
      font-weight: 600;
      color: ${ok ? "#34d399" : "#f87171"};
    }
    p { font-size: 14px; color: #9ca3af; margin: 0 0 16px; line-height: 1.5; }
    .aviso { font-size: 12px; color: #6b7280; }
  </style>
</head>
<body>
  <div class="box">
    <div class="icon">${ok ? "✓" : "⚠"}</div>
    <h2>${titulo}</h2>
    <p>${texto}</p>
    <div class="aviso">Fechando esta janela...</div>
  </div>
  <script nonce="${nonce}">
    (function() {
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(${mensagem}, window.location.origin);
          setTimeout(function() { window.close(); }, 900);
          return;
        }
      } catch (e) {}
      setTimeout(function() { window.location.href = ${volta}; }, 1500);
    })();
  </script>
</body>
</html>`;

  return new NextResponse(html, {
    status: ok ? 200 : 400,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      // HTML puro, sem o bootstrap do Next: da para cravar a politica inteira.
      // So o <script> com o nonce desta resposta roda; nada carrega de fora.
      "content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    },
  });
}
