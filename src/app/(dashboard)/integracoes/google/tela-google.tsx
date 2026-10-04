"use client";

import { useId, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CopyIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Section } from "@/components/ui/section";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  ROTAS,
  type ContaAnuncioResumo,
  type LojaDoSeletor,
} from "@/lib/financeiro/tipos";
import { chamar } from "../api";
import { ContasTabela } from "../contas-tabela";
import { formatarCustomerId, plural, type Estado, type GastoNaTela } from "../regras";

// ============================================================================
// Integracoes -> Google. O gasto chega EMPURRADO por um script colado em cada
// conta (a API do Google ainda pede o nivel Explorer); as conversoes saem pela
// Data Manager API (envio-data-manager.tsx), por destino. Cadastro e script
// novo usam as APIs de sempre (/api/ads/google/contas e .../segredo).
//
// O script traz o segredo da conta e aparece UMA vez, na resposta do cadastro.
// A tela avisa isso ANTES de gerar, e o texto copiado e o que a API devolveu,
// sem mexer em nada.
// ============================================================================

function PainelScript({ titulo, script, onFechar }: { titulo: string; script: string; onFechar: () => void }) {
  const preRef = useRef<HTMLPreElement>(null);
  async function copiar() {
    try {
      await navigator.clipboard.writeText(script);
      toast.success("Script copiado", { description: "Cole no Google Ads, em Ferramentas › Scripts." });
    } catch {
      // Sem permissao de area de transferencia: seleciona o texto para o Ctrl+C.
      const pre = preRef.current;
      if (pre) {
        const sel = window.getSelection();
        const r = document.createRange();
        r.selectNodeContents(pre);
        sel?.removeAllRanges();
        sel?.addRange(r);
      }
      toast.error("O navegador não deixou copiar", { description: "O script ficou selecionado: use Ctrl+C." });
    }
  }
  return (
    <Section
      titulo={titulo}
      nivel={3}
      acoes={
        <>
          <Button size="sm" onClick={copiar}>
            <CopyIcon aria-hidden />
            Copiar script
          </Button>
          <Button size="sm" variant="secondary" onClick={onFechar}>
            Já colei
          </Button>
        </>
      }
    >
      <Callout tom="warn" titulo="Este script contém o segredo desta conta e não aparece de novo.">
        Perdeu? Gere outro pelo menu da conta. O anterior para de funcionar.
      </Callout>
      <pre
        ref={preRef}
        tabIndex={0}
        aria-label="Script do Google Ads"
        className="max-h-80 overflow-auto rounded-control border border-border bg-surface-2 p-3 font-mono text-label text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        {script}
      </pre>
    </Section>
  );
}

const PASSOS: ReactNode[] = [
  <>
    Pegue o <strong className="font-semibold text-ink">ID de cliente</strong> (123-456-7890), no topo do
    Google Ads. Não é o AW- do rastreamento.
  </>,
  <>Escolha a loja e gere o script. Ele aparece uma vez só, logo abaixo.</>,
  <>
    No Google Ads, abra <strong className="font-semibold text-ink">Ferramentas › Ações em massa › Scripts</strong>,
    crie um script novo, cole, clique em Autorizar, depois em Visualizar e Salvar.
  </>,
  <>
    Em Frequência, escolha <strong className="font-semibold text-ink">De hora em hora</strong>. Se a opção não
    aparecer na sua conta, use a menor disponível e avise o suporte.
  </>,
];

function FormGoogle({ lojas, onCriou }: { lojas: LojaDoSeletor[]; onCriou: (titulo: string, script: string) => void }) {
  const id = useId();
  const [customerId, setCustomerId] = useState("");
  const [lojaId, setLojaId] = useState(lojas.length === 1 ? lojas[0].id : "");
  const [nome, setNome] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erros, setErros] = useState<{ id?: string; loja?: string; geral?: string }>({});
  const nomeLoja = new Map(lojas.map((l) => [l.id, l.nome]));

  async function criar(e: FormEvent) {
    e.preventDefault();
    const digitos = customerId.replace(/\D/g, "");
    const novos: typeof erros = {};
    if (digitos.length !== 10) novos.id = "Use o ID de cliente de 10 dígitos (123-456-7890). Não é o AW-.";
    if (!lojaId) novos.loja = "Escolha a loja que recebe o gasto desta conta.";
    setErros(novos);
    if (novos.id || novos.loja) return;
    setEnviando(true);
    const r = await chamar<{ conta?: ContaAnuncioResumo; script?: string }>(ROTAS.apiGoogleContas, {
      method: "POST",
      body: JSON.stringify({ customer_id: customerId.trim(), store_id: lojaId, nome: nome.trim() || null }),
    });
    setEnviando(false);
    if (!r.ok || !r.script || !r.conta) {
      setErros({ geral: r.ok ? "O servidor não devolveu o script. Tente de novo." : r.erro });
      return;
    }
    toast.success("Conta cadastrada", { description: "Agora cole o script no Google Ads." });
    setCustomerId("");
    setNome("");
    onCriou(
      `Script da conta ${formatarCustomerId(r.conta.external_id)}${r.conta.nome ? ` · ${r.conta.nome}` : ""}`,
      r.script
    );
  }

  return (
    <form onSubmit={criar} noValidate className="flex flex-col gap-3">
      <div className="grid gap-3 md:grid-cols-[170px_minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={`${id}-cid`}>ID de cliente</Label>
          <Input
            id={`${id}-cid`}
            inputMode="numeric"
            autoComplete="off"
            value={customerId}
            onChange={(e) => {
              setCustomerId(e.target.value);
              if (erros.id) setErros((x) => ({ ...x, id: undefined }));
            }}
            placeholder="123-456-7890"
            aria-invalid={erros.id ? true : undefined}
            aria-describedby={erros.id ? `${id}-cid-erro` : undefined}
            className="font-mono"
          />
          {erros.id ? (
            <p id={`${id}-cid-erro`} className="text-label text-err">
              {erros.id}
            </p>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label id={`${id}-loja-rotulo`}>Loja</Label>
          <Select
            value={lojaId || null}
            onValueChange={(v) => {
              setLojaId(v ?? "");
              setErros((e) => ({ ...e, loja: undefined }));
            }}
          >
            <SelectTrigger
              aria-labelledby={`${id}-loja-rotulo`}
              aria-invalid={erros.loja ? true : undefined}
              aria-describedby={erros.loja ? `${id}-loja-erro` : undefined}
            >
              <SelectValue placeholder="Escolha a loja">
                {(v: string | null) => (v ? (nomeLoja.get(v) ?? "Escolha a loja") : "Escolha a loja")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {lojas.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {erros.loja ? (
            <p id={`${id}-loja-erro`} className="text-label text-err">
              {erros.loja}
            </p>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={`${id}-nome`}>
            Nome <span className="font-normal text-t2">(opcional)</span>
          </Label>
          <Input
            id={`${id}-nome`}
            autoComplete="off"
            maxLength={120}
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Ex.: Google Lash Bestie"
          />
        </div>
      </div>
      {erros.geral ? (
        <p role="alert" className="text-dense text-err">
          {erros.geral}
        </p>
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button type="submit" pending={enviando}>
          Gerar script
        </Button>
        <p className="text-label text-t2">
          O script aparece uma vez só, logo depois de gerar. Deixe o Google Ads aberto em Scripts.
        </p>
      </div>
    </form>
  );
}

export function TelaGoogle({
  contas,
  todas,
  lojas,
  estadoLeitura,
  envio,
  dataManager,
  tabela,
}: {
  contas: ContaAnuncioResumo[];
  /** Todas as contas Google, sem filtro de loja. */
  todas: number;
  lojas: LojaDoSeletor[];
  estadoLeitura: Estado;
  /** O cartao "Para enviar as compras" (server component). */
  envio: ReactNode;
  /** "Conversões pela API do Google": ID do cliente e acoes por destino. */
  dataManager?: ReactNode;
  tabela: {
    gastos: Record<string, GastoNaTela>;
    erroGasto: string | null;
    fusosLoja: Record<string, string>;
    erroFuso: string | null;
    lojaFiltrada: string | null;
    agoraMs: number;
    fuso: string;
    moeda: string;
    periodo: string;
  };
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [script, setScript] = useState<{ titulo: string; texto: string } | null>(null);
  const [adicionando, setAdicionando] = useState(false);
  const semConta = todas === 0;
  // O formulario so abre a pedido: o gasto do Google entra de verdade quando
  // a API aprovar o app, e o foco desta tela e o envio de conversoes.
  const mostrarForm = adicionando;

  function mostrarScript(titulo: string, texto: string) {
    setScript({ titulo, texto });
    setAdicionando(false);
    startTransition(() => router.refresh());
  }

  return (
    <>
      {dataManager}

      <div className="grid gap-3 md:grid-cols-2">
        {envio}
        <section
          aria-labelledby="ler-google"
          className="flex min-w-0 flex-col gap-2.5 rounded-card border border-border bg-surface p-4"
        >
          <span className="text-label font-semibold text-t2">Para ler o gasto (opcional)</span>
          <h3 id="ler-google" className="text-section text-ink">
            {semConta ? "Script por conta" : `Script em ${plural(todas, "conta", "contas")}`}
          </h3>
          {!semConta ? <StatusBadge tom={estadoLeitura.tom}>{estadoLeitura.texto}</StatusBadge> : null}
          <p className="text-dense text-t1 text-pretty">
            {semConta
              ? "Até o login com Google chegar, o gasto entra no lucro por um script colado em cada conta."
              : "Cada conta envia o gasto de hora em hora por um script colado no Google Ads."}
            {!semConta && estadoLeitura.detalhe ? ` ${estadoLeitura.detalhe}` : ""}
          </p>
          <div className="mt-auto">
            <Button size="sm" variant="secondary" onClick={() => setAdicionando((v) => !v)} aria-expanded={adicionando}>
              {adicionando ? "Cancelar" : "Adicionar conta"}
            </Button>
          </div>
        </section>
      </div>

      {mostrarForm ? (
        <section
          aria-labelledby="cadastro-google"
          className="flex flex-col gap-4 rounded-card border border-border bg-surface p-4 sm:p-5"
        >
          <div className="flex flex-col gap-1">
            <h3 id="cadastro-google" className="text-section text-ink">
              {semConta ? "Ler o gasto em 4 passos (modo manual)" : "Adicionar conta do Google Ads"}
            </h3>
            <p className="text-dense text-t1 text-pretty">
              Até o login com Google chegar, cada conta lê o gasto por um script. Ele só lê desempenho: não
              gasta nem edita campanha.
            </p>
          </div>
          <ol className="flex flex-col gap-2">
            {PASSOS.map((p, i) => (
              <li key={i} className="flex items-start gap-3 text-dense text-t1">
                <span
                  aria-hidden
                  className="grid size-6 shrink-0 place-items-center rounded-full border border-border-strong text-label font-semibold text-t1"
                >
                  {i + 1}
                </span>
                <span className="min-w-0 pt-0.5 text-pretty">{p}</span>
              </li>
            ))}
          </ol>
          <FormGoogle lojas={lojas} onCriou={mostrarScript} />
        </section>
      ) : null}

      {script ? <PainelScript titulo={script.titulo} script={script.texto} onFechar={() => setScript(null)} /> : null}

      {!semConta ? (
        <ContasTabela plataforma="google" contas={contas} lojas={lojas} onScript={mostrarScript} {...tabela} />
      ) : null}
    </>
  );
}
