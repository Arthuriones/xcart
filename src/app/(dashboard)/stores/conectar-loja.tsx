"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, ExternalLinkIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/components/ui/cn";
import { PARAM_DE } from "@/lib/conectar-operacao";
import { getPublicAppUrl } from "@/lib/public-url";
import { normalizeShopDomain } from "@/lib/shopify/domain";
import { SHOPIFY_SCOPES_STRING } from "@/lib/shopify/scopes";
import { MENSAGEM_CONEXAO_PADRAO, mensagemConexao } from "@/lib/leitura/lojas-estado";

// ============================================================================
// "Conectar loja" em 4 passos: dominio, criar o app na Shopify, credenciais e
// autorizar. Um fluxo so, que tambem serve para Reconectar (o dominio vem
// preenchido). Chama a MESMA API de sempre (/api/shopify/connect); quando o
// app ainda nao esta na loja, ela devolve a URL do OAuth e a Shopify traz o
// lojista de volta em /stores?installed=1.
//
// O estado mora num contexto desta tela (nao global): o botao do cabecalho, o
// estado vazio e o "Reconectar" de cada linha abrem o mesmo dialogo.
// ============================================================================

type Abrir = {
  dominio?: string;
  reconectar?: boolean;
  /** Veio de "Conectar operação": o Voltar do primeiro passo devolve a escolha. */
  voltar?: string | null;
};

type ContextoConectar = {
  abrir: (opcoes?: Abrir) => void;
  /** Nome da loja que acabou de conectar sem precisar do OAuth. */
  conectadaAgora: string | null;
  esquecerConectada: () => void;
};

const Contexto = React.createContext<ContextoConectar | null>(null);

export function useConectarLoja(): ContextoConectar {
  const c = React.useContext(Contexto);
  if (!c) throw new Error("useConectarLoja fora do ConectarLojaProvider");
  return c;
}

export function ConectarLojaProvider({
  inicial,
  children,
}: {
  /** ?conectar=1&dominio=... na URL: abre o dialogo ao chegar. */
  inicial?: Abrir | null;
  children: React.ReactNode;
}) {
  const [aberto, setAberto] = React.useState(false);
  const [opcoes, setOpcoes] = React.useState<Abrir>({});
  // Cada abertura monta o assistente do zero (nada de credencial velha).
  const [sessao, setSessao] = React.useState(0);
  const [conectadaAgora, setConectadaAgora] = React.useState<string | null>(null);
  // No meio do envio ou do redirecionamento o dialogo nao fecha (Esc, fora, X).
  const ocupado = React.useRef(false);

  const abrir = React.useCallback((o?: Abrir) => {
    setOpcoes(o ?? {});
    setSessao((s) => s + 1);
    setAberto(true);
  }, []);

  // Abre depois de montar (o dialogo nao existe no HTML do servidor) e tira
  // o pedido da URL, para recarregar a pagina nao reabrir.
  const pedidoInicial = React.useRef(inicial);
  React.useEffect(() => {
    if (!pedidoInicial.current) return;
    abrir(pedidoInicial.current);
    const url = new URL(window.location.href);
    url.searchParams.delete("conectar");
    url.searchParams.delete("dominio");
    url.searchParams.delete(PARAM_DE);
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }, [abrir]);

  const valor = React.useMemo(
    () => ({ abrir, conectadaAgora, esquecerConectada: () => setConectadaAgora(null) }),
    [abrir, conectadaAgora]
  );

  return (
    <Contexto.Provider value={valor}>
      {children}
      <Dialog
        open={aberto}
        onOpenChange={(v) => {
          if (!v && ocupado.current) return;
          setAberto(v);
        }}
      >
        {aberto ? (
          <Assistente
            key={sessao}
            opcoes={opcoes}
            fechar={() => {
              ocupado.current = false;
              setAberto(false);
            }}
            marcarOcupado={(v) => {
              ocupado.current = v;
            }}
            aoConectar={(nome) => setConectadaAgora(nome)}
          />
        ) : null}
      </Dialog>
    </Contexto.Provider>
  );
}

/** O botao "Conectar loja" do cabecalho e do estado vazio. */
export function BotaoConectar({
  variante = "primary",
  children = "Conectar loja",
}: {
  variante?: "primary" | "secondary";
  children?: React.ReactNode;
}) {
  const { abrir } = useConectarLoja();
  return (
    <Button variant={variante} onClick={() => abrir()}>
      <PlusIcon aria-hidden />
      {children}
    </Button>
  );
}

// ---------------------------------------------------------------------------

const PASSOS = ["Domínio da loja", "Criar o app na Shopify", "Credenciais", "Autorizar"] as const;

const TAREFAS_APP = 5;

function Assistente({
  opcoes,
  fechar,
  marcarOcupado,
  aoConectar,
}: {
  opcoes: Abrir;
  fechar: () => void;
  marcarOcupado: (ocupado: boolean) => void;
  aoConectar: (nome: string) => void;
}) {
  const router = useRouter();
  const [passo, setPasso] = React.useState(1);
  const [dominio, setDominio] = React.useState(opcoes.dominio ?? "");
  const [clientId, setClientId] = React.useState("");
  const [clientSecret, setClientSecret] = React.useState("");
  const [mostrarSegredo, setMostrarSegredo] = React.useState(false);
  const [feitas, setFeitas] = React.useState<boolean[]>(() => Array(TAREFAS_APP).fill(false));
  const [tocado, setTocado] = React.useState({ dominio: false, credenciais: false });
  const [enviando, setEnviando] = React.useState(false);
  const [redirecionando, setRedirecionando] = React.useState(false);
  const [erro, setErro] = React.useState<{ texto: string; detalhe: string | null } | null>(null);
  const [urlApp] = React.useState(() => getPublicAppUrl(window.location.origin));
  const titulo = React.useRef<HTMLHeadingElement>(null);

  const normalizado = normalizeShopDomain(dominio);
  const dominioInvalido = tocado.dominio && !normalizado;
  const credenciaisInvalidas = tocado.credenciais && (!clientId.trim() || !clientSecret.trim());

  // A cada passo o foco vai para o titulo dele: o leitor de tela anuncia onde
  // a pessoa esta, e o Tab segue dali.
  const primeiraVez = React.useRef(true);
  React.useEffect(() => {
    if (primeiraVez.current) {
      primeiraVez.current = false;
      return;
    }
    titulo.current?.focus();
  }, [passo]);

  function avancar() {
    if (passo === 1) {
      setTocado((t) => ({ ...t, dominio: true }));
      if (!normalizado) return;
    }
    if (passo === 3) {
      setTocado((t) => ({ ...t, credenciais: true }));
      if (!clientId.trim() || !clientSecret.trim()) return;
    }
    if (passo < 4) {
      setErro(null);
      setPasso(passo + 1);
      return;
    }
    void conectar();
  }

  async function conectar() {
    if (!normalizado || enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      const res = await fetch("/api/shopify/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shopDomain: normalizado,
          clientId: clientId.trim(),
          clientSecret: clientSecret.trim(),
        }),
      });
      let dados: {
        error?: string;
        needsInstall?: boolean;
        installUrl?: string;
        shop?: { name?: string };
      } = {};
      try {
        dados = await res.json();
      } catch {
        // corpo vazio: o status diz o que houve
      }
      if (!res.ok || res.redirected) {
        // redirected = sessao vencida: o proxy mandou para /login.
        const texto = mensagemConexao(dados.error, res.redirected ? 401 : res.status);
        // O texto cru so aparece (recolhido) quando nao ha frase para ele.
        setErro({ texto, detalhe: texto === MENSAGEM_CONEXAO_PADRAO ? (dados.error ?? null) : null });
        return;
      }
      // App ainda nao instalado: a Shopify pede a autorizacao e volta em
      // /stores?installed=1, onde os proximos passos aparecem.
      if (dados.needsInstall && dados.installUrl) {
        setRedirecionando(true);
        window.location.assign(dados.installUrl);
        return;
      }
      const nome = dados.shop?.name || normalizado;
      aoConectar(nome);
      toast.success(`${nome} conectada`, {
        description: "Os pedidos dos últimos 60 dias começam a chegar em alguns minutos.",
      });
      fechar();
      router.refresh();
    } catch {
      setErro({
        texto: "A conexão caiu antes de a Shopify responder. Confira a internet e tente de novo.",
        detalhe: null,
      });
    } finally {
      setEnviando(false);
    }
  }

  const ocupado = enviando || redirecionando;
  React.useEffect(() => {
    marcarOcupado(ocupado);
  }, [ocupado, marcarOcupado]);

  return (
    <DialogContent size="lg" showCloseButton={!ocupado} className="gap-0 p-0">
      <div className="flex flex-col gap-0.5 border-b border-border px-5 py-4 pr-14">
        <DialogTitle>{opcoes.reconectar ? "Reconectar loja Shopify" : "Conectar loja Shopify"}</DialogTitle>
        <p className="text-label text-t2">
          Passo {passo} de 4 · {PASSOS[passo - 1]}
          <span className="hidden sm:inline"> · leva uns 5 minutos</span>
        </p>
      </div>

      <div className="grid min-h-0 md:grid-cols-[220px_1fr]">
        <ol aria-label="Passos" className="hidden flex-col gap-1 border-r border-border bg-surface-2 p-4 md:flex">
          {PASSOS.map((t, i) => {
            const n = i + 1;
            const feito = n < passo;
            const atual = n === passo;
            return (
              <li
                key={t}
                aria-current={atual ? "step" : undefined}
                className={cn(
                  "flex min-h-9 items-center gap-2.5 text-dense",
                  atual ? "font-semibold text-ink" : feito ? "text-t1" : "text-t2"
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "grid size-5.5 shrink-0 place-items-center rounded-full border text-label font-semibold",
                    atual
                      ? "border-transparent bg-solid text-on-solid"
                      : feito
                        ? "border-transparent bg-ok text-on-solid"
                        : "border-border-strong text-t2"
                  )}
                >
                  {feito ? <CheckIcon className="size-3" strokeWidth={3} /> : n}
                </span>
                {t}
                {feito ? <span className="sr-only">, feito</span> : null}
              </li>
            );
          })}
        </ol>

        <div className="flex max-h-[min(60dvh,520px)] min-w-0 flex-col gap-4 overflow-y-auto p-5">
          {opcoes.reconectar && passo === 1 ? (
            <Callout
              tom="info"
              titulo="Reconectar usa o mesmo caminho"
              acao={
                <Button size="sm" variant="secondary" onClick={() => normalizado && setPasso(3)} disabled={!normalizado}>
                  Ir para as credenciais
                </Button>
              }
            >
              Se o app ainda existe na Shopify, pule para as credenciais e autorize de novo.
            </Callout>
          ) : null}

          {passo === 1 ? (
            <>
              <h3 ref={titulo} tabIndex={-1} className="text-section text-ink outline-none">
                Qual é o endereço da loja?
              </h3>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cn-dominio">Domínio .myshopify.com</Label>
                <Input
                  id="cn-dominio"
                  value={dominio}
                  onChange={(e) => setDominio(e.target.value)}
                  onBlur={() => dominio.trim() && setTocado((t) => ({ ...t, dominio: true }))}
                  onKeyDown={(e) => e.key === "Enter" && avancar()}
                  placeholder="minhaloja.myshopify.com"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  autoFocus
                  aria-invalid={dominioInvalido || undefined}
                  aria-describedby="cn-dominio-ajuda"
                  className="font-mono"
                />
                <p id="cn-dominio-ajuda" className={cn("text-label", dominioInvalido ? "text-err" : "text-t2")}>
                  {dominioInvalido
                    ? "Use o domínio da Shopify, por exemplo minhaloja.myshopify.com."
                    : "Está em Configurações › Domínios, na Shopify. Prefira o que termina em .myshopify.com."}
                </p>
              </div>
            </>
          ) : null}

          {passo === 2 ? (
            <>
              <h3 ref={titulo} tabIndex={-1} className="text-section text-ink outline-none">
                Crie o app da loja na Shopify
              </h3>
              <p className="text-dense text-t1">
                Abra{" "}
                <a
                  href="https://dev.shopify.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-brand underline underline-offset-2 hover:text-ink"
                >
                  dev.shopify.com
                  <ExternalLinkIcon aria-hidden className="size-3" />
                  <span className="sr-only">(abre em outra aba)</span>
                </a>{" "}
                e siga a lista. Marque cada item quando terminar.
              </p>
              <ol className="flex flex-col gap-3">
                <Tarefa i={0} feitas={feitas} setFeitas={setFeitas} texto="Em Apps, clique em Create app. O nome pode ser qualquer um." />
                <Tarefa i={1} feitas={feitas} setFeitas={setFeitas} texto="No app, vá em Configuration › Acesso › Selecionar escopos e cole a lista:">
                  <CampoCopiar rotulo="Escopos" valor={SHOPIFY_SCOPES_STRING} />
                  <p className="rounded-control border border-warn-border bg-warn-bg px-2.5 py-2 text-label text-ink">
                    A Shopify pede sua aprovação para envio, descontos, estoque e mercados. Aprove todos: sem
                    eles a loja conecta, mas zona de envio, desconto e estoque ficam para fazer à mão.
                  </p>
                </Tarefa>
                <Tarefa i={2} feitas={feitas} setFeitas={setFeitas} texto="Em URLs de redirecionamento, cole exatamente:">
                  <CampoCopiar rotulo="URL de redirecionamento" valor={`${urlApp}/api/shopify/auth`} />
                </Tarefa>
                <Tarefa i={3} feitas={feitas} setFeitas={setFeitas} texto="Em URL do app, cole só o endereço:">
                  <CampoCopiar rotulo="URL do app" valor={urlApp} />
                </Tarefa>
                <Tarefa
                  i={4}
                  feitas={feitas}
                  setFeitas={setFeitas}
                  texto="Marque Usar fluxo de instalação legado e clique em Lançar, no topo da página."
                />
              </ol>
              <p className="text-label text-t2" aria-live="polite">
                {feitas.filter(Boolean).length} de {TAREFAS_APP} marcados
              </p>
            </>
          ) : null}

          {passo === 3 ? (
            <>
              <h3 ref={titulo} tabIndex={-1} className="text-section text-ink outline-none">
                Cole as credenciais do app
              </h3>
              <p className="text-dense text-t1">No app, em API credentials, copie o Client ID e o Client Secret.</p>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cn-id">Client ID</Label>
                <Input
                  id="cn-id"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  autoFocus
                  aria-invalid={(credenciaisInvalidas && !clientId.trim()) || undefined}
                  aria-describedby={credenciaisInvalidas && !clientId.trim() ? "cn-id-erro" : undefined}
                  className="font-mono text-dense"
                />
                {credenciaisInvalidas && !clientId.trim() ? (
                  <p id="cn-id-erro" className="text-label text-err">
                    Cole o Client ID do app.
                  </p>
                ) : null}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cn-segredo">Client Secret</Label>
                <div className="flex gap-2">
                  <Input
                    id="cn-segredo"
                    type={mostrarSegredo ? "text" : "password"}
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && avancar()}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="shpss_…"
                    aria-invalid={(credenciaisInvalidas && !clientSecret.trim()) || undefined}
                    aria-describedby="cn-segredo-ajuda"
                    className="font-mono text-dense"
                  />
                  <Button
                    variant="secondary"
                    aria-pressed={mostrarSegredo}
                    onClick={() => setMostrarSegredo((v) => !v)}
                    className="min-w-22"
                  >
                    {mostrarSegredo ? "Ocultar" : "Mostrar"}
                  </Button>
                </div>
                <p
                  id="cn-segredo-ajuda"
                  className={cn("text-label", credenciaisInvalidas && !clientSecret.trim() ? "text-err" : "text-t2")}
                >
                  {credenciaisInvalidas && !clientSecret.trim()
                    ? "Cole o Client Secret do app."
                    : "Fica guardado só no servidor; não volta para o navegador."}
                </p>
              </div>
            </>
          ) : null}

          {passo === 4 ? (
            <>
              <h3 ref={titulo} tabIndex={-1} className="text-section text-ink outline-none">
                Autorize na Shopify
              </h3>
              <p className="text-dense text-t1">
                Vamos conferir as credenciais de <span className="font-mono">{normalizado}</span> e abrir a Shopify
                para você aprovar o acesso. Na volta, a loja aparece aqui com os próximos passos.
              </p>
              <p className="text-label text-t2">
                O histórico de pedidos começa uns 60 dias antes da conexão: é o que a Shopify libera.
              </p>
              {redirecionando ? (
                <div
                  role="status"
                  className="flex items-center gap-2.5 rounded-control border border-run-border bg-run-bg px-3 py-2.5 text-dense text-run"
                >
                  <span aria-hidden className="size-2 shrink-0 animate-xc-pulse rounded-full bg-run" />
                  Redirecionando para a Shopify…
                </div>
              ) : null}
              {erro ? (
                <Callout
                  tom="err"
                  titulo="A loja não conectou"
                  acao={
                    <Button size="sm" variant="secondary" onClick={() => setPasso(3)}>
                      Revisar credenciais
                    </Button>
                  }
                >
                  <p>{erro.texto}</p>
                  {erro.detalhe ? (
                    <details className="mt-1 text-label text-t2">
                      <summary className="cursor-pointer">Ver detalhe</summary>
                      <p className="mt-1 font-mono break-all">{erro.detalhe}</p>
                    </details>
                  ) : null}
                </Callout>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      <div className="flex justify-between gap-2 border-t border-border bg-surface-2 px-5 py-3">
        <Button
          variant="secondary"
          onClick={() => {
            if (passo === 1 && opcoes.voltar) router.push(opcoes.voltar);
            else setPasso((p) => Math.max(1, p - 1));
          }}
          disabled={(passo === 1 && !opcoes.voltar) || ocupado}
        >
          Voltar
        </Button>
        <Button onClick={avancar} pending={ocupado}>
          {passo < 4 ? "Continuar" : redirecionando ? "Abrindo a Shopify…" : "Conectar e abrir a Shopify"}
        </Button>
      </div>
    </DialogContent>
  );
}

function Tarefa({
  i,
  texto,
  feitas,
  setFeitas,
  children,
}: {
  i: number;
  texto: string;
  feitas: boolean[];
  setFeitas: React.Dispatch<React.SetStateAction<boolean[]>>;
  children?: React.ReactNode;
}) {
  const id = `cn-tarefa-${i}`;
  return (
    <li className="flex gap-2.5">
      <Checkbox
        id={id}
        aria-labelledby={`${id}-texto`}
        checked={feitas[i]}
        onCheckedChange={(marcado) => setFeitas((f) => f.map((v, k) => (k === i ? marcado : v)))}
        className="mt-0.5"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {/* O label aponta para o botao: clicar no texto tambem marca. */}
        <label id={`${id}-texto`} htmlFor={id} className={cn("text-dense", feitas[i] ? "text-t2" : "text-ink")}>
          {texto}
        </label>
        {children}
      </div>
    </li>
  );
}

/** Valor para colar na Shopify, com o botao de copiar ao lado. */
function CampoCopiar({ rotulo, valor }: { rotulo: string; valor: string }) {
  const [copiado, setCopiado] = React.useState(false);
  async function copiar() {
    try {
      await navigator.clipboard.writeText(valor);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1800);
    } catch {
      toast.error("Não deu para copiar. Selecione o texto e copie à mão.");
    }
  }
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
      <code
        aria-label={rotulo}
        className="max-h-24 min-w-0 flex-1 overflow-y-auto rounded-control border border-border bg-surface-2 px-3 py-2 font-mono text-label break-all text-ink"
      >
        {valor}
      </code>
      <Button variant="secondary" onClick={copiar} className="min-w-22 self-start">
        {copiado ? "Copiado" : "Copiar"}
        <span className="sr-only"> {rotulo}</span>
      </Button>
      <span className="sr-only" aria-live="polite">
        {copiado ? `${rotulo} copiado` : ""}
      </span>
    </div>
  );
}
