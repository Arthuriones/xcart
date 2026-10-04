"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { ROTAS, type ContaAnuncioResumo } from "@/lib/financeiro/tipos";
import { chamar } from "../api";
import { plural, type Estado } from "../regras";

// ============================================================================
// O token de leitura do Meta (ads_read): o assistente de 4 passos de quem
// ainda nao ligou, e o cartao "Para ler o gasto" de quem ja ligou.
//
// Modo manual de proposito: o login com Facebook (#11) ainda nao existe, e a
// tela nao mostra botao desabilitado esperando por ele. O token vai para
// POST /api/ads/meta/conectar, a API de sempre, que confere no Meta quais
// contas ele enxerga e guarda o token so no servidor.
// ============================================================================

const PASSOS: { titulo: string; texto: string }[] = [
  {
    titulo: "Abra Usuários do sistema",
    texto: "No Gerenciador de Negócios do Meta, vá em Configurações › Usuários › Usuários do sistema.",
  },
  {
    titulo: "Crie o usuário “xcart leitura”",
    texto:
      "Função de funcionário, sem acesso de administrador. No nível Limited, o portfólio permite um usuário comum e um administrador.",
  },
  {
    titulo: "Atribua as contas de anúncio",
    texto:
      "Em Atribuir ativos › Contas de anúncio, marque cada conta com “Ver desempenho”. Contas de outro portfólio precisam ser compartilhadas antes.",
  },
  {
    titulo: "Gere o token e cole aqui",
    texto:
      "Em Gerar novo token: escolha o app, validade “Nunca” e só a permissão de leitura de anúncios (ads_read). O xcart confere sozinho quais contas o token enxerga.",
  },
];

function FormToken({ aoConectar }: { aoConectar?: () => void }) {
  const id = useId();
  const router = useRouter();
  const [atualizando, startTransition] = useTransition();
  const [token, setToken] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function conferir(e: FormEvent) {
    e.preventDefault();
    const t = token.trim();
    // O mesmo piso da API (20 caracteres): responde na hora, sem ida ao servidor.
    if (t.length < 20) {
      setErro("Esse texto não parece um token do Meta. Ele é longo e começa com EAA.");
      return;
    }
    setErro(null);
    setEnviando(true);
    const r = await chamar<{ contas?: ContaAnuncioResumo[] }>(ROTAS.apiMetaConectar, {
      method: "POST",
      body: JSON.stringify({ token: t }),
    });
    setEnviando(false);
    if (!r.ok) {
      setErro(r.erro);
      return;
    }
    const n = Array.isArray(r.contas) ? r.contas.length : 0;
    toast.success("Token válido", {
      description: `Ele enxerga ${plural(n, "conta de anúncio", "contas de anúncio")}.\nLigue cada uma à sua loja abaixo.`,
    });
    setToken("");
    aoConectar?.();
    startTransition(() => router.refresh());
  }

  return (
    <form onSubmit={conferir} className="flex flex-col gap-1.5" noValidate>
      <label htmlFor={id} className="sr-only">
        Token de leitura do Meta
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id={id}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={token}
          onChange={(e) => {
            setToken(e.target.value);
            if (erro) setErro(null);
          }}
          placeholder="Cole o token aqui"
          aria-invalid={erro ? true : undefined}
          aria-describedby={`${id}-ajuda`}
          className="font-mono"
        />
        <Button type="submit" pending={enviando || atualizando} className="sm:min-w-36">
          {enviando ? "Conferindo…" : "Conferir token"}
        </Button>
      </div>
      <p
        id={`${id}-ajuda`}
        role={erro ? "alert" : undefined}
        className={cn("text-label", erro ? "text-err" : "text-t2")}
      >
        {erro ?? "Fica guardado só no servidor e não volta para o navegador."}
      </p>
    </form>
  );
}

/** Quem ainda nao ligou o Meta: os 4 passos, com o campo no ultimo. */
export function AssistenteMeta() {
  return (
    <section
      aria-labelledby="assistente-meta"
      className="flex flex-col gap-4 rounded-card border border-border bg-surface p-4 sm:p-5"
    >
      <div className="flex flex-col gap-1">
        <h3 id="assistente-meta" className="text-section text-ink">
          Ligue o Meta em 4 passos
        </h3>
        <p className="text-dense text-t1 text-pretty">
          O xcart lê o gasto com um token de leitura do Gerenciador de Negócios. Ele só lê desempenho: não gasta
          nem edita campanha.
        </p>
      </div>
      <ol className="flex flex-col rounded-card border border-border">
        {PASSOS.map((p, i) => {
          const ultimo = i === PASSOS.length - 1;
          return (
            <li
              key={p.titulo}
              className="flex items-start gap-3 border-b border-border-subtle p-3.5 last:border-b-0"
            >
              <span
                aria-hidden
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-full border text-label font-semibold",
                  ultimo ? "border-transparent bg-solid text-on-solid" : "border-border-strong text-t1"
                )}
              >
                {i + 1}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <strong className="text-dense font-semibold text-ink">{p.titulo}</strong>
                <span className="text-dense text-t1 text-pretty">{p.texto}</span>
                {ultimo ? (
                  <div className="mt-1">
                    <FormToken />
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Quem ja ligou: o estado do token, trocar e como gerar. */
export function CartaoTokenMeta({ estado, contas }: { estado: Estado; contas: number }) {
  const [trocando, setTrocando] = useState(false);
  const [comoAberto, setComoAberto] = useState(false);
  const idComo = useId();
  return (
    <section
      aria-labelledby="ler-meta"
      className="flex min-w-0 flex-col gap-2.5 rounded-card border border-border bg-surface p-4"
    >
      <span className="text-label font-semibold text-t2">Para ler o gasto</span>
      <h3 id="ler-meta" className="text-section text-ink">
        Token de leitura
      </h3>
      <StatusBadge tom={estado.tom}>{estado.texto}</StatusBadge>
      <p className="text-dense text-t1">
        Vê {plural(contas, "conta de anúncio", "contas de anúncio")} · o gasto é lido a cada 15 minutos.
        {estado.detalhe ? ` ${estado.detalhe}` : ""}
      </p>
      {trocando ? <FormToken aoConectar={() => setTrocando(false)} /> : null}
      <div className="mt-auto flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => setTrocando((v) => !v)}>
          {trocando ? "Cancelar" : "Trocar token"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={comoAberto}
          onClick={() => setComoAberto((v) => !v)}
          className="text-brand"
        >
          Como gerar
        </Button>
      </div>
      {comoAberto ? (
        <ol id={idComo} className="flex list-decimal flex-col gap-1 pl-5 text-dense text-t1">
          {PASSOS.map((p) => (
            <li key={p.titulo}>{p.texto}</li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
