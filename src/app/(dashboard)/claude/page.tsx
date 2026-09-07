"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Loader2, Plus, Terminal, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface TokenRow {
  id: string;
  name: string;
  token_suffix: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
  expires_at: string;
}

function diasAte(iso: string) {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

function Copiavel({ texto, rotulo }: { texto: string; rotulo?: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <div className="relative">
      {rotulo ? (
        <p className="mb-1 text-xs text-muted-foreground">{rotulo}</p>
      ) : null}
      <pre className="overflow-x-auto rounded-md border bg-muted/40 p-3 pr-12 text-xs leading-relaxed">
        <code className="whitespace-pre-wrap break-all">{texto}</code>
      </pre>
      <Button
        size="icon"
        variant="ghost"
        className="absolute right-1 top-6 h-8 w-8"
        onClick={async () => {
          await navigator.clipboard.writeText(texto);
          setCopiado(true);
          toast.success("Copiado");
          setTimeout(() => setCopiado(false), 1500);
        }}
      >
        {copiado ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  );
}

export default function ClaudePage() {
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [criando, setCriando] = useState(false);
  // Fica em memoria so ate a pessoa sair da tela: o valor em claro nunca
  // volta do servidor depois da criacao.
  const [novoToken, setNovoToken] = useState<string | null>(null);
  const [origem, setOrigem] = useState("");

  useEffect(() => setOrigem(window.location.origin), []);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const r = await fetch("/api/mcp-tokens");
      const j = await r.json();
      setTokens(j.tokens ?? []);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function criar() {
    setCriando(true);
    try {
      const r = await fetch("/api/mcp-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Claude" }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Falhou");
      setNovoToken(j.token);
      await carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao criar token");
    } finally {
      setCriando(false);
    }
  }

  async function revogar(id: string) {
    const r = await fetch(`/api/mcp-tokens?id=${id}`, { method: "DELETE" });
    if (r.ok) {
      toast.success("Token revogado");
      await carregar();
    } else {
      toast.error("Nao consegui revogar");
    }
  }

  const url = `${origem}/api/mcp`;
  const token = novoToken ?? "SEU_TOKEN_AQUI";
  const comando = `claude mcp add --transport http xcart ${url} --header "Authorization: Bearer ${token}"`;
  const jsonDesktop = JSON.stringify(
    {
      mcpServers: {
        xcart: {
          type: "http",
          url,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2
  );

  const ativos = tokens.filter((t) => !t.revoked_at);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div>
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink">
          Conectar ao Claude
        </h1>
        <p className="mt-1.5 max-w-[62ch] text-[13px] leading-relaxed text-t2">
          Edite suas lojas conversando com o Claude — buscar produtos, reescrever
          descricao e SEO, conferir se a pagina subiu certo. Funciona no Claude
          Code e no Claude Desktop.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-[12.5px] font-medium text-ink">1. Gere um token</CardTitle>
          <CardDescription className="text-[12px] leading-relaxed text-t3">
            Ele aparece uma unica vez. Se perder, e so gerar outro e revogar o
            antigo.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={criar} disabled={criando}>
            {criando ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            Gerar token
          </Button>

          {novoToken ? (
            <div className="space-y-2">
              <Copiavel texto={novoToken} rotulo="Guarde agora — nao mostro de novo" />
            </div>
          ) : null}

          {carregando ? null : ativos.length ? (
            <div className="space-y-2 pt-2">
              {ativos.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                >
                  <div className="flex items-center gap-2">
                    <code className="text-xs text-muted-foreground">
                      ••••{t.token_suffix}
                    </code>
                    <Badge variant="secondary" className="text-[10px]">
                      {t.last_used_at
                        ? `usado ${new Date(t.last_used_at).toLocaleDateString()}`
                        : "nunca usado"}
                    </Badge>
                    <Badge
                      variant={diasAte(t.expires_at) <= 7 ? "destructive" : "secondary"}
                      className="text-[10px]"
                    >
                      {diasAte(t.expires_at) <= 0
                        ? "expirado"
                        : `expira em ${diasAte(t.expires_at)}d`}
                    </Badge>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={() => revogar(t.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhum token ativo.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-[12.5px] font-medium text-ink">
            <Terminal className="h-4 w-4" />
            2. Cole no seu Claude
          </CardTitle>
          <CardDescription className="text-[12px] leading-relaxed text-t3">
            {novoToken
              ? "O comando ja esta com o seu token."
              : "Gere um token acima para o comando vir preenchido."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <Copiavel texto={comando} rotulo="Claude Code — rode no terminal" />
          <Copiavel
            texto={jsonDesktop}
            rotulo="Claude Desktop — Configuracoes > Desenvolvedor > Editar config"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-[12.5px] font-medium text-ink">3. Teste</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>No Claude, peca:</p>
          <pre className="rounded-md border bg-muted/40 p-3 text-xs">
            liste minhas lojas do xcart
          </pre>
          <p>
            Ele deve responder com as lojas conectadas nesta conta. A partir dai
            e conversa normal: pedir para reescrever a descricao de um produto,
            arrumar SEO, conferir se uma pagina esta sem erro.
          </p>
          <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
            O token da acesso de leitura e escrita as suas lojas. Trate como
            senha e revogue se vazar.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
