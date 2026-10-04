"use client";

import { useId, useState, useTransition, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Section } from "@/components/ui/section";
import { StatusBadge, type TomStatus } from "@/components/ui/status-badge";
import type { LojaDoSeletor } from "@/lib/financeiro/tipos";
import type { AcoesDataManager, EventoDataManager } from "@/lib/tracking/google-url";
import { chamar } from "../api";
import { formatarCustomerId } from "../regras";

// ============================================================================
// Integracoes -> Google -> "Conversões pela API do Google".
//
// Por destino Google (o AW- cadastrado em Saude dos pixels): o ID do cliente e
// o ID de cada acao "Importar de cliques". Com os dois, a fila manda pela Data
// Manager API; sem, o destino segue no ping antigo. Salvar tudo vazio volta
// para o antigo.
//
// A credencial (service account) NAO passa por aqui: e variavel de ambiente na
// Vercel, cadastrada pelo Arthur. A tela so diz se ela existe.
// ============================================================================

export interface DestinoDataManager {
  id: string;
  storeId: string;
  nome: string | null;
  /** O AW- que identifica o destino. */
  conta: string;
  ativo: boolean;
  customerId: string | null;
  loginCustomerId: string | null;
  acoes: AcoesDataManager;
  /** A unica conta Google ligada a esta loja, para nao digitar de novo. */
  sugestao: string | null;
}

export interface DadosDataManager {
  destinos: DestinoDataManager[];
  temCredencial: boolean;
  erro: string | null;
}

const EVENTOS: { chave: EventoDataManager; nome: string }[] = [
  { chave: "purchase", nome: "Compra" },
  { chave: "add_to_cart", nome: "Carrinho" },
  { chave: "begin_checkout", nome: "Checkout" },
];

const forte = "font-semibold text-ink";

const PASSOS: ReactNode[] = [
  <>
    No Google Cloud, ative a <strong className={forte}>Data Manager API</strong>, crie uma service account e
    cadastre a chave JSON na Vercel em <code className="font-mono text-label">GOOGLE_DM_SA_KEY</code>.
  </>,
  <>
    No Google Ads, em <strong className={forte}>Admin › Acesso e segurança</strong>, adicione o e-mail da
    service account (na conta ou na MCC).
  </>,
  <>
    Em{" "}
    <strong className={forte}>
      Metas › Conversões › Resumo › + › Importar › CRMs, arquivos ou outras fontes › Acompanhar conversões de
      cliques
    </strong>
    , crie uma ação por evento: Compra como principal; Carrinho e Checkout como secundárias.
  </>,
  <>
    Espere 6 h e cole aqui o ID do cliente e o de cada ação (na URL da ação, depois de{" "}
    <code className="font-mono text-label">ctId=</code>).
  </>,
];

function configurado(d: Pick<DestinoDataManager, "customerId" | "acoes">): boolean {
  return Boolean(d.customerId) && Object.keys(d.acoes).length > 0;
}

function estado(d: DestinoDataManager, temCredencial: boolean): { tom: TomStatus; texto: string } {
  if (!d.ativo) return { tom: "neutral", texto: "Desativado" };
  if (!configurado(d)) return { tom: "warn", texto: "Falta configurar" };
  if (!temCredencial) return { tom: "warn", texto: "Falta a credencial" };
  return { tom: "ok", texto: "Enviando pela API" };
}

function FormDataManager({
  d,
  temCredencial,
  onFechar,
}: {
  d: DestinoDataManager;
  temCredencial: boolean;
  onFechar: () => void;
}) {
  const id = useId();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [cliente, setCliente] = useState(formatarCustomerId(d.customerId ?? d.sugestao ?? ""));
  const [mcc, setMcc] = useState(d.loginCustomerId ? formatarCustomerId(d.loginCustomerId) : "");
  const [acoes, setAcoes] = useState<Record<EventoDataManager, string>>({
    purchase: d.acoes.purchase ?? "",
    add_to_cart: d.acoes.add_to_cart ?? "",
    begin_checkout: d.acoes.begin_checkout ?? "",
  });
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    // A validacao e do servidor (validarConfigDataManager): uma regra so, com
    // a mensagem dizendo o que corrigir.
    const r = await chamar("/api/tracking/destinos", {
      method: "PATCH",
      body: JSON.stringify({ id: d.id, customerId: cliente, loginCustomerId: mcc, acoes }),
    });
    setEnviando(false);
    if (!r.ok) {
      setErro(r.erro);
      return;
    }
    const ligou = Boolean(cliente.trim()) && Object.values(acoes).some((v) => v.trim());
    toast.success(ligou ? "Google salvo" : "Voltou ao método antigo", {
      description: !ligou
        ? undefined
        : temCredencial
          ? "Os eventos com clique saem pela API 6 h depois de acontecer."
          : "Falta a credencial no servidor para começar a enviar.",
    });
    onFechar();
    startTransition(() => router.refresh());
  }

  return (
    <form onSubmit={salvar} noValidate className="flex flex-col gap-3 rounded-control bg-surface-2 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={`${id}-cliente`}>ID do cliente</Label>
          <Input
            id={`${id}-cliente`}
            inputMode="numeric"
            autoComplete="off"
            value={cliente}
            onChange={(e) => setCliente(e.target.value)}
            placeholder="123-456-7890"
            className="font-mono"
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={`${id}-mcc`}>
            ID da MCC <span className="font-normal text-t2">(só se o acesso foi pela MCC)</span>
          </Label>
          <Input
            id={`${id}-mcc`}
            inputMode="numeric"
            autoComplete="off"
            value={mcc}
            onChange={(e) => setMcc(e.target.value)}
            placeholder="123-456-7890"
            className="font-mono"
          />
        </div>
      </div>
      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-1.5 text-label font-semibold text-t2">ID da ação (ctId)</legend>
        {EVENTOS.map((ev) => (
          <div key={ev.chave} className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor={`${id}-${ev.chave}`}>{ev.nome}</Label>
            <Input
              id={`${id}-${ev.chave}`}
              inputMode="numeric"
              autoComplete="off"
              value={acoes[ev.chave]}
              onChange={(e) => setAcoes((a) => ({ ...a, [ev.chave]: e.target.value }))}
              placeholder="Vazio = não envia"
              className="font-mono"
            />
          </div>
        ))}
      </fieldset>
      {erro ? (
        <p role="alert" className="text-dense text-err">
          {erro}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" pending={enviando}>
          Salvar
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={onFechar}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

export function EnvioDataManager({ dados, lojas }: { dados: DadosDataManager; lojas: LojaDoSeletor[] }) {
  const { destinos, temCredencial, erro } = dados;
  const [aberto, setAberto] = useState<string | null>(null);
  const nomeLoja = new Map(lojas.map((l) => [l.id, l.nome]));
  const algumPronto = temCredencial && destinos.some((d) => d.ativo && configurado(d));

  return (
    <Section
      nivel={3}
      titulo="Conversões pela API do Google"
      descricao="Compra, carrinho e checkout com clique de anúncio, enviados 6 h depois e conferidos pelo Google."
    >
      {!temCredencial ? (
        <Callout tom="warn" titulo="Falta a credencial do Google no servidor">
          Cadastre a chave da service account na Vercel (<code className="font-mono text-label">GOOGLE_DM_SA_KEY</code>
          ). Sem ela, nada sai pela API.
        </Callout>
      ) : null}

      <details open={!algumPronto} className="group text-dense text-t1">
        <summary className="w-fit cursor-pointer rounded-sm font-medium text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
          Como ligar ({PASSOS.length} passos)
        </summary>
        <ol className="mt-2.5 flex flex-col gap-2">
          {PASSOS.map((p, i) => (
            <li key={i} className="flex items-start gap-3">
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
      </details>

      {erro ? (
        <p role="alert" className="text-dense text-err">
          Não deu para ler a configuração agora. Recarregue a página antes de editar.
        </p>
      ) : destinos.length === 0 ? (
        <p className="text-dense text-t1 text-pretty">
          Nenhuma conta Google cadastrada para receber conversões.{" "}
          <Link
            href="/tracking"
            className="rounded-sm font-medium text-brand underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            Cadastrar em Saúde dos pixels
          </Link>
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {destinos.map((d) => {
            const e = estado(d, temCredencial);
            const editando = aberto === d.id;
            return (
              <li key={d.id} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-dense">
                  <span className="min-w-40 flex-1">
                    <span className="text-ink">{nomeLoja.get(d.storeId) ?? "Loja removida"}</span>
                    {d.nome ? <span className="text-t2"> · {d.nome}</span> : null}{" "}
                    <span className="font-mono text-label whitespace-nowrap text-t2">
                      {d.conta}
                      {d.customerId ? ` · ${formatarCustomerId(d.customerId)}` : ""}
                    </span>
                  </span>
                  <StatusBadge tom={e.tom}>{e.texto}</StatusBadge>
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-expanded={editando}
                    onClick={() => setAberto(editando ? null : d.id)}
                  >
                    {editando ? "Fechar" : configurado(d) ? "Editar" : "Configurar"}
                  </Button>
                </div>
                {editando ? (
                  <FormDataManager d={d} temCredencial={temCredencial} onFechar={() => setAberto(null)} />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
