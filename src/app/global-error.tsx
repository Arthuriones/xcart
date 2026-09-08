"use client";

/**
 * Rede de seguranca de ultimo recurso: erro no proprio layout raiz, onde o
 * error.tsx normal ja nao existe. Precisa trazer <html> e <body> proprios,
 * porque o layout que os renderiza e justamente o que falhou.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="pt-BR">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#f7f6f5",
          color: "#1a1a1a",
        }}
      >
        <div style={{ maxWidth: 460, padding: 24, textAlign: "center" }}>
          <p style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>
            O xcart não conseguiu carregar
          </p>
          <p style={{ fontSize: 12.5, color: "#6b6b6b", marginTop: 6 }}>
            Recarregue a página. Se continuar, o código do erro abaixo ajuda a achar o
            problema.
          </p>
          <p style={{ fontSize: 11, fontFamily: "monospace", color: "#8a8a8a", marginTop: 8 }}>
            {error.digest || error.message}
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 16,
              height: 30,
              padding: "0 13px",
              border: 0,
              borderRadius: 6,
              background: "#1a1a1a",
              color: "#fff",
              fontSize: 12.5,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Tentar de novo
          </button>
        </div>
      </body>
    </html>
  );
}
