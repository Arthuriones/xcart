"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { CheckIcon, CopyIcon, TerminalIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Section } from "@/components/ui/section";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { chamar, type Resultado } from "../api";

// ============================================================================
// Claude (MCP): gerar um token e configurar o Claude Code ou o Claude Desktop
// para operar as lojas conversando. Era a tela /claude; agora mora em
// Integracoes -> Avancado.
//
// O que o lojista copia sai EXATAMENTE como antes: o comando `claude mcp add`,
// o JSON do Desktop e a frase de teste. Mudou so a apresentacao: revogar pede
// confirmacao, copiar trata a falha, datas em pt-BR, nome no token.
//
// A API e a de sempre (/api/mcp-tokens): GET lista, POST cria (o valor em
// claro volta so nesta resposta), DELETE revoga.
// ============================================================================

interface TokenRow {
  id: string;
  name: string;
  token_suffix: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
  expires_at: string;
}

const FUSO = "America/Sao_Paulo";

function lerTokens() {
  return chamar<{ tokens?: TokenRow[] }>("/api/mcp-tokens", { method: "GET" });
}

function diasAte(iso: string) {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

function dataCurta(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: FUSO });
}

function Copiavel({ texto, rotulo }: { texto: string; rotulo: string }) {
  const [copiado, setCopiado] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);
  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      toast.success("Copiado");
      setTimeout(() => setCopiado(false), 1500);
    } catch {
      // Sem permissao de area de transferencia: seleciona o texto para o Ctrl+C.
      const pre = preRef.current;
      if (pre) {
        const r = document.createRange();
        r.selectNodeContents(pre);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(r);
      }
      toast.error("O navegador não deixou copiar", { description: "O texto ficou selecionado: use Ctrl+C." });
    }
  }
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <p className="text-label text-t2">{rotulo}</p>
      <div className="relative">
        <pre
          ref={preRef}
          className="overflow-x-auto rounded-control border border-border bg-surface-2 p-3 pr-12 font-mono text-label text-ink"
        >
          <code className="break-all whitespace-pre-wrap">{texto}</code>
        </pre>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={copiar}
          aria-label={`Copiar: ${rotulo}`}
          className="absolute top-1.5 right-1.5"
        >
          {copiado ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
        </Button>
      </div>
    </div>
  );
}

export function ClaudeMcp() {
  const idNome = useId();
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erroLista, setErroLista] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState("");
  // Fica em memoria so ate a pessoa sair da tela: o valor em claro nunca
  // volta do servidor depois da criacao.
  const [novoToken, setNovoToken] = useState<string | null>(null);
  const [revogar, setRevogar] = useState<TokenRow | null>(null);
  const [dialogo, setDialogo] = useState(false);
  // A origem vem do navegador; no servidor o snapshot e "". O subscribe e
  // vazio de proposito: a origem nao muda com a pagina aberta.
  const origem = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => ""
  );

  const aplicar = useCallback((r: Resultado<{ tokens?: TokenRow[] }>) => {
    if (r.ok) {
      setTokens(r.tokens ?? []);
      setErroLista(null);
    } else {
      setErroLista(r.erro);
    }
    setCarregando(false);
  }, []);

  const carregar = useCallback(async () => aplicar(await lerTokens()), [aplicar]);

  // Primeira leitura: o estado so muda na volta da rede, nunca no corpo do efeito.
  useEffect(() => {
    let vivo = true;
    void lerTokens().then((r) => {
      if (vivo) aplicar(r);
    });
    return () => {
      vivo = false;
    };
  }, [aplicar]);

  async function criar() {
    setCriando(true);
    const r = await chamar<{ token?: string }>("/api/mcp-tokens", {
      method: "POST",
      body: JSON.stringify({ name: nome.trim() || "Claude" }),
    });
    setCriando(false);
    if (!r.ok || !r.token) {
      toast.error("Não deu para gerar o token", { description: r.ok ? "Tente de novo." : r.erro });
      return;
    }
    setNovoToken(r.token);
    setNome("");
    await carregar();
  }

  async function executarRevogar() {
    if (!revogar) return;
    const r = await chamar(`/api/mcp-tokens?id=${encodeURIComponent(revogar.id)}`, { method: "DELETE" });
    if (!r.ok) throw new Error(r.erro);
    toast.success("Token revogado", { description: "O Claude que usava esse token perde o acesso." });
    await carregar();
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
    <>
      <Section
        titulo="1. Gere um token"
        nivel={3}
        descricao="Ele aparece uma única vez. Se perder, gere outro e revogue o antigo."
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex min-w-0 flex-col gap-1.5 sm:w-64">
            <Label htmlFor={idNome}>
              Nome do token <span className="font-normal text-t2">(opcional)</span>
            </Label>
            <Input
              id={idNome}
              maxLength={60}
              autoComplete="off"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex.: Notebook do escritório"
            />
          </div>
          <Button pending={criando} onClick={criar}>
            Gerar token
          </Button>
        </div>

        {novoToken ? <Copiavel texto={novoToken} rotulo="Guarde agora: ele não aparece de novo" /> : null}

        {carregando ? (
          <div aria-busy="true" aria-label="Carregando os tokens" className="flex flex-col gap-2">
            <Skeleton className="h-11 w-full rounded-control" />
            <Skeleton className="h-11 w-full rounded-control" />
          </div>
        ) : erroLista ? (
          <Callout
            tom="err"
            role="alert"
            titulo="Não deu para ler os tokens."
            acao={
              <Button size="sm" variant="secondary" onClick={() => void carregar()}>
                Tentar de novo
              </Button>
            }
          >
            {erroLista}
          </Callout>
        ) : ativos.length === 0 ? (
          <EmptyState variante="simples" titulo="Nenhum token ativo" descricao="Gere um para ligar o Claude." />
        ) : (
          <ul className="flex flex-col divide-y divide-border-subtle rounded-control border border-border">
            {ativos.map((t) => {
              const dias = diasAte(t.expires_at);
              return (
                <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-dense font-medium text-ink">{t.name}</span>
                    <span className="font-mono text-label text-t2">termina em …{t.token_suffix}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge tom="neutral" ponto={false}>
                      {t.last_used_at ? `Usado em ${dataCurta(t.last_used_at)}` : "Nunca usado"}
                    </StatusBadge>
                    <StatusBadge tom={dias <= 0 ? "err" : dias <= 7 ? "warn" : "ok"}>
                      {dias <= 0 ? "Expirado" : dias === 1 ? "Expira amanhã" : `Expira em ${dias} dias`}
                    </StatusBadge>
                  </span>
                  <Button
                    size="sm"
                    variant="destructive"
                    aria-label={`Revogar o token ${t.name} que termina em ${t.token_suffix}`}
                    onClick={() => {
                      setRevogar(t);
                      setDialogo(true);
                    }}
                  >
                    Revogar
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section
        titulo={
          <span className="inline-flex items-center gap-2">
            <TerminalIcon aria-hidden className="size-4" />
            2. Cole no seu Claude
          </span>
        }
        nivel={3}
        descricao={novoToken ? "O comando já está com o seu token." : "Gere um token acima para o comando vir preenchido."}
      >
        <Copiavel texto={comando} rotulo="Claude Code: rode no terminal" />
        <Copiavel texto={jsonDesktop} rotulo="Claude Desktop: Configurações › Desenvolvedor › Editar config" />
      </Section>

      <Section titulo="3. Teste" nivel={3}>
        <p className="text-dense text-t1">No Claude, peça:</p>
        <pre className="rounded-control border border-border bg-surface-2 p-3 font-mono text-label text-ink">
          liste minhas lojas do xcart
        </pre>
        <p className="text-dense text-t1 text-pretty">
          Ele deve responder com as lojas conectadas nesta conta. A partir daí é conversa normal: pedir para
          reescrever a descrição de um produto, arrumar o SEO, conferir se uma página está sem erro.
        </p>
        <Callout tom="warn" titulo="O token dá acesso de leitura e escrita às suas lojas.">
          Trate como senha e revogue se vazar.
        </Callout>
      </Section>

      <ConfirmDialog
        open={dialogo}
        onOpenChange={setDialogo}
        titulo={`Revogar o token ${revogar?.name ?? ""} (…${revogar?.token_suffix ?? ""})?`}
        descricao="O Claude configurado com ele para de acessar as lojas na hora. Para voltar, gere outro token e cole de novo."
        confirmar="Revogar token"
        mensagemErro="Não deu para revogar agora. Tente de novo."
        onConfirmar={executarRevogar}
      />
    </>
  );
}
