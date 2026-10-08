"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, CopyIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { plural } from "@/lib/leitura/lojas-estado";
import { codigoDoScript } from "./logica";

// ============================================================================
// Instalar o script na vitrine. O caminho principal e o automatico: o xcart
// escreve no tema da vitrine (POST /api/checkout-routes/[id]/update-theme, a
// mesma rota de sempre) -- e e ele tambem que reenvia a divisao ao tema.
// Colar o codigo na mao e a alternativa, para quem nao deu permissao de tema.
// ============================================================================

type Resposta = {
  error?: string;
  /** "rota_pausada": o servidor recusou instalar com a rota pausada. */
  code?: string;
  targetCount?: number;
  skuCount?: number;
};

function horaAgora(): string {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(Date.now());
}

/** Frase de erro por status, sem repetir o texto cru da Shopify. */
function erroDaInstalacao(status: number, codigo?: string): string {
  // Instalar com a rota pausada travaria o checkout da vitrine: o servidor
  // recusa (ver publicarConfigNoTema).
  if (codigo === "rota_pausada") {
    return "A rota está pausada. Instalada assim, a vitrine não finaliza compra nenhuma. Ligue a rota e instale de novo.";
  }
  if (status === 404) return "Não achei o tema ativo da vitrine. Confira se a loja tem um tema publicado.";
  if (status === 409) return "Esta rota não tem loja de checkout com domínio pronto. Confira as lojas na aba Lojas e divisão.";
  if (status === 401) return "Sua sessão venceu. Entre de novo e tente outra vez.";
  if (status === 503) return "Não deu para ler as lojas de checkout agora. Nada foi escrito no tema; tente de novo em instantes.";
  return "A Shopify não deixou escrever no tema da vitrine. Cole o código na mão, logo abaixo.";
}

export function Instalador({
  rotaId,
  token,
  origem,
  rotulo = "Instalar na vitrine",
  variante = "primary",
  comCodigo = true,
}: {
  rotaId: string;
  token: string;
  origem: string;
  rotulo?: string;
  variante?: "primary" | "secondary";
  /** Mostra a alternativa de colar o codigo (aba Instalacao). */
  comCodigo?: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(null);
  const [manual, setManual] = useState(false);

  async function instalar() {
    setEnviando(true);
    setResultado(null);
    try {
      const r = await fetch(`/api/checkout-routes/${rotaId}/update-theme`, { method: "POST" });
      const d = (await r.json().catch(() => ({}))) as Resposta;
      if (!r.ok) {
        setResultado({ ok: false, texto: erroDaInstalacao(r.status, d.code) });
        // Colar o codigo na mao tambem travaria a vitrine com a rota pausada,
        // e o 503 e soluco do banco, nao falta de permissao no tema.
        if (comCodigo && d.code !== "rota_pausada" && r.status !== 503) setManual(true);
        return;
      }
      const lojas = plural(d.targetCount ?? 0, "loja de checkout", "lojas de checkout");
      const skus = plural(d.skuCount ?? 0, "SKU ligado", "SKUs ligados");
      setResultado({
        ok: true,
        texto: `Enviado ao tema da vitrine às ${horaAgora()}: ${lojas}, ${skus}.`,
      });
      startTransition(() => router.refresh());
    } catch {
      setResultado({ ok: false, texto: "A conexão caiu antes de a Shopify responder. Tente de novo." });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant={variante} pending={enviando} onClick={instalar}>
          {rotulo}
        </Button>
        {comCodigo ? (
          <Button variant="ghost" aria-expanded={manual} onClick={() => setManual((v) => !v)}>
            {manual ? "Esconder o código" : "Prefiro colar o código"}
          </Button>
        ) : null}
      </div>
      <div aria-live="polite">
        {resultado ? (
          <Callout tom={resultado.ok ? "ok" : "err"} titulo={resultado.ok ? "Instalado" : "Não deu para instalar"}>
            {resultado.texto}
          </Callout>
        ) : null}
      </div>
      {comCodigo && manual ? <CodigoManual codigo={codigoDoScript(origem, token)} /> : null}
    </div>
  );
}

/** O codigo para colar no tema, com copiar. O texto sai igual ao de sempre. */
export function CodigoManual({ codigo }: { codigo: string }) {
  const [copiado, setCopiado] = useState<"sim" | "falhou" | null>(null);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(codigo);
      setCopiado("sim");
      setTimeout(() => setCopiado(null), 2000);
    } catch {
      setCopiado("falhou");
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-card border border-border bg-surface-2 p-3">
      <p className="text-dense text-t1">
        Na Shopify da vitrine: Loja virtual, Temas, Editar código, arquivo{" "}
        <code className="font-mono text-label text-ink">theme.liquid</code>. Cole logo antes de{" "}
        <code className="font-mono text-label text-ink">&lt;/head&gt;</code> e salve.
      </p>
      <pre className="overflow-x-auto rounded-control border border-border bg-surface p-3 font-mono text-label text-ink">
        {codigo}
      </pre>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={copiar}>
          {copiado === "sim" ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
          {copiado === "sim" ? "Copiado" : "Copiar código"}
        </Button>
        <span aria-live="polite" className="text-label text-t2">
          {copiado === "falhou" ? "O navegador bloqueou a cópia. Selecione o texto e copie." : ""}
        </span>
      </div>
    </div>
  );
}
