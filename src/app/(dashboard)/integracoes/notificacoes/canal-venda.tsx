"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { PlusIcon, SendIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Section } from "@/components/ui/section";
import { StatusBadge, type TomStatus } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { MAX_CELULARES, MAX_NOME, resumoDoCanal, type CelularDaTela } from "@/lib/alertas/venda-celulares";
import { chamar } from "../api";
import { haQuantoTempo } from "../regras";

// ============================================================================
// "Venda no celular": um aviso a cada venda em cada celular cadastrado
// (Pushcut, ntfy, Discord, Zapier...). Cada celular e uma URL de webhook; a
// URL e segredo e a tela so recebe o host. O switch liga/desliga todos.
// Rotas: /api/alertas/venda-webhook (adicionar, ligar/desligar) e
// /api/alertas/venda-webhook/[id] (remover) e [id]/teste (testar).
// ============================================================================

const API = "/api/alertas/venda-webhook";

const PASSOS = [
  <>Instale o app Pushcut no celular e crie uma notificação (ex.: “Venda”).</>,
  <>
    Na notificação, toque em <span className="font-mono text-ink">Webhook</span> e copie a URL.
  </>,
  <>Cole abaixo, adicione e toque em Testar.</>,
];

interface Props {
  ativo: boolean;
  celulares: CelularDaTela[];
  /** Antes da migration 070: so o celular unico de antes, sem cadastro novo. */
  semTabela: boolean;
  /**
   * Nao deu para ler os celulares: so o aviso nesta secao. Sem a lista, a tela
   * diria "Não configurado" e abriria o cadastro para quem ja tem celular.
   */
  erroLeitura: string | null;
  /** O relogio da leitura: "há 5 min" igual no HTML e na hidratacao. */
  agoraMs: number;
}

/** "Último envio há 5 min" / "Falhou há 2 h" / "Nenhum envio ainda". */
function situacao(c: CelularDaTela, agoraMs: number): { tom: TomStatus; texto: string } {
  const quando = c.ultimo_envio_em ? ` ${haQuantoTempo(c.ultimo_envio_em, agoraMs)}` : "";
  if (c.ultimo_erro) return { tom: "err", texto: `Falhou${quando}` };
  if (c.ultimo_envio_em) return { tom: "ok", texto: `Último envio${quando}` };
  return { tom: "neutral", texto: "Nenhum envio ainda" };
}

function Passos() {
  return (
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
  );
}

function Adicionar({
  primeiro,
  aoCancelar,
  aoAdicionar,
}: {
  /** Ainda nao ha nenhum celular: mostra os passos do Pushcut. */
  primeiro: boolean;
  aoCancelar: (() => void) | null;
  aoAdicionar: () => void;
}) {
  const id = useId();
  const [nome, setNome] = useState("");
  const [url, setUrl] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function adicionar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const limpa = url.trim();
    if (!/^https:\/\/\S+$/.test(limpa)) {
      setErro("Cole a URL inteira, começando com https://.");
      return;
    }
    setErro(null);
    setSalvando(true);
    const r = await chamar<{ celular: CelularDaTela }>(API, {
      method: "POST",
      body: JSON.stringify({ nome: nome.trim() || null, url: limpa }),
    });
    setSalvando(false);
    if (!r.ok) {
      setErro(r.erro);
      return;
    }
    setNome("");
    setUrl("");
    toast.success(`${r.celular.nome} adicionado`, { description: "Toque em Testar para conferir." });
    aoAdicionar();
  }

  return (
    <form onSubmit={adicionar} className="flex max-w-xl flex-col gap-3">
      {primeiro ? <Passos /> : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-nome`}>Nome (opcional)</Label>
        <Input
          id={`${id}-nome`}
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          maxLength={MAX_NOME}
          autoComplete="off"
          placeholder="Ex.: Celular do sócio"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-url`}>URL do webhook</Label>
        <Input
          id={`${id}-url`}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://api.pushcut.io/…"
          aria-invalid={erro ? true : undefined}
          aria-describedby={`${id}-url-ajuda`}
          className="font-mono"
        />
        <p id={`${id}-url-ajuda`} className={erro ? "text-label text-err" : "text-label text-t2"}>
          {erro ?? "Pushcut, ntfy, Discord ou qualquer webhook."}
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button type="submit" pending={salvando}>
          {salvando ? null : <PlusIcon aria-hidden />}
          Adicionar
        </Button>
        {aoCancelar ? (
          <Button type="button" variant="ghost" disabled={salvando} onClick={aoCancelar}>
            Cancelar
          </Button>
        ) : null}
      </div>
    </form>
  );
}

export function CanalVenda({ ativo: ativoSalvo, celulares, semTabela, erroLeitura, agoraMs }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  // O switch muda na hora; volta ao gravado se a rota recusar.
  const [ativoLocal, setAtivoLocal] = useState<boolean | null>(null);
  // O servidor mudou o liga/desliga (o primeiro celular religa o aviso): ele
  // vence o clique antigo, no RENDER, sem pintar uma vez o valor velho.
  const [ativoVisto, setAtivoVisto] = useState(ativoSalvo);
  if (ativoVisto !== ativoSalvo) {
    setAtivoVisto(ativoSalvo);
    setAtivoLocal(null);
  }
  const [salvandoAtivo, setSalvandoAtivo] = useState(false);
  const [abrindo, setAbrindo] = useState(false);
  const [testando, setTestando] = useState<string | null>(null);
  const [removendo, setRemovendo] = useState<CelularDaTela | null>(null);

  const ativo = ativoLocal ?? ativoSalvo;
  const n = celulares.length;
  const resumo = resumoDoCanal(ativo, n);
  const cheio = n >= MAX_CELULARES;
  const podeAdicionar = !semTabela && !cheio;
  const formularioAberto = podeAdicionar && (n === 0 || abrindo);

  function atualizar() {
    startTransition(() => router.refresh());
  }

  async function alternar(v: boolean) {
    setAtivoLocal(v);
    setSalvandoAtivo(true);
    const r = await chamar(API, { method: "PATCH", body: JSON.stringify({ ativo: v }) });
    setSalvandoAtivo(false);
    if (!r.ok) {
      setAtivoLocal(null);
      toast.error("Não deu para salvar", { description: r.erro });
      return;
    }
    toast.success(v ? "Aviso de venda ligado" : "Aviso de venda desligado");
    atualizar();
  }

  async function testar(c: CelularDaTela) {
    setTestando(c.id);
    const r = await chamar(`${API}/${encodeURIComponent(c.id)}/teste`, { method: "POST" });
    setTestando(null);
    // Chegando ou nao, o "último envio" do celular mudou.
    atualizar();
    if (!r.ok) {
      toast.error("O teste não chegou", { description: r.erro });
      return;
    }
    toast.success("Venda de teste enviada", { description: "Confira o celular." });
  }

  if (erroLeitura) {
    return (
      <Section titulo="Venda no celular" nivel={3} descricao="Um aviso a cada venda, em todas as lojas.">
        <Callout tom="err" titulo="Não deu para ler os celulares.">
          {erroLeitura} Recarregue a página.
        </Callout>
      </Section>
    );
  }

  return (
    <Section
      titulo="Venda no celular"
      nivel={3}
      descricao="Um aviso a cada venda, em todas as lojas."
      acoes={<StatusBadge tom={resumo.ligado ? "ok" : "neutral"}>{resumo.texto}</StatusBadge>}
    >
      {semTabela ? (
        <Callout
          tom="warn"
          titulo={n > 0 ? "Cadastro de mais celulares ainda não liberado." : "Cadastro de celular ainda não liberado."}
        >
          Falta atualizar o banco. {n > 0 ? "O celular de antes continua recebendo." : "Tente de novo mais tarde."}
        </Callout>
      ) : null}

      {n > 0 ? (
        <ul className="flex flex-col gap-2">
          {celulares.map((c) => {
            const s = situacao(c, agoraMs);
            return (
              <li
                key={c.id}
                className="flex flex-col gap-3 rounded-control border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="truncate text-body font-medium text-ink">{c.nome}</span>
                  <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate font-mono text-label text-t2">{c.host}</span>
                    <StatusBadge tom={s.tom}>{s.texto}</StatusBadge>
                  </span>
                  {c.ultimo_erro ? <span className="line-clamp-2 text-label text-err">{c.ultimo_erro}</span> : null}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    pending={testando === c.id}
                    disabled={testando !== null && testando !== c.id}
                    onClick={() => testar(c)}
                  >
                    {testando === c.id ? null : <SendIcon aria-hidden />}
                    Testar
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setRemovendo(c)}>
                    Remover
                  </Button>
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}

      {n > 0 ? (
        <Switch
          rotulo="Avisar a cada venda"
          descricao={n > 1 ? "Liga e desliga todos os celulares." : undefined}
          checked={ativo}
          disabled={salvandoAtivo}
          onCheckedChange={(v) => void alternar(v)}
        />
      ) : null}

      {formularioAberto ? (
        <Adicionar
          primeiro={n === 0}
          aoCancelar={n > 0 ? () => setAbrindo(false) : null}
          aoAdicionar={() => {
            setAbrindo(false);
            atualizar();
          }}
        />
      ) : podeAdicionar ? (
        <Button variant="secondary" className="self-start" onClick={() => setAbrindo(true)}>
          <PlusIcon aria-hidden />
          Adicionar celular
        </Button>
      ) : cheio && !semTabela ? (
        <p className="text-label text-t2">
          Limite de {MAX_CELULARES} celulares. Remova um para adicionar outro.
        </p>
      ) : null}

      <ConfirmDialog
        open={removendo !== null}
        onOpenChange={(v) => !v && setRemovendo(null)}
        titulo={`Remover ${removendo?.nome ?? "celular"}?`}
        descricao={
          n > 1
            ? "Ele para de receber o aviso de venda. Os outros celulares continuam."
            : "Ele para de receber o aviso de venda."
        }
        confirmar="Remover celular"
        onConfirmar={async () => {
          if (!removendo) return;
          const r = await chamar(`${API}/${encodeURIComponent(removendo.id)}`, { method: "DELETE" });
          if (!r.ok) throw new Error(r.erro);
          setRemovendo(null);
          toast.success("Celular removido");
          atualizar();
        }}
      />
    </Section>
  );
}
