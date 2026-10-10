"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, CopyIcon, MoreHorizontalIcon, PlusIcon, SendIcon } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Section } from "@/components/ui/section";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { PARAM_DE } from "@/lib/conectar-operacao";
import { FUSO_RELATORIO_PADRAO } from "@/lib/financeiro/tipos";
import {
  MOEDAS_COMISSAO,
  PLATAFORMAS_CHECKOUT,
  nomeDaPlataforma,
  rotuloDoEvento,
  type CheckoutResumo,
} from "@/lib/checkouts-externos/tipos";
import type { EventoDaTela } from "@/lib/leitura/checkouts";
import { CabecalhoPlataforma } from "../cabecalho-plataforma";
import { chamar } from "../api";
import { estadoDoCheckout, haQuantoTempo, plural, quando, rotuloAfiliados } from "../regras";

// ============================================================================
// Checkouts externos: cadastrar (Sphere -> nome -> URL), copiar a URL do
// webhook, ver os eventos chegando e mandar um evento de teste. Tudo pelas
// rotas /api/checkouts (a sessao confere o dono; quem grava e o servidor).
// O teste NUNCA entra nos numeros: o endpoint reconhece e nao grava pedido.
// ============================================================================

const API = "/api/checkouts";

/** useSyncExternalStore so para saber se ja esta no navegador: nada muda depois. */
const semAssinatura = () => () => {};

/** Os fusos oferecidos em "Avançado". O padrao e o de Sao Paulo. */
const FUSOS = [
  "America/Sao_Paulo",
  "Europe/Lisbon",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Warsaw",
  "Europe/Prague",
  "Europe/Budapest",
  "Europe/Bucharest",
  "UTC",
];

/** Quanto tempo o painel da URL pergunta se o evento chegou. */
const ESPERA_MS = 2 * 60 * 1000;
const INTERVALO_MS = 5_000;

const PASSOS_SPHERE = [
  <>
    Na Sphere, abra <span className="font-medium text-ink">Webhooks</span> e clique em{" "}
    <span className="font-medium text-ink">Novo Webhook</span>.
  </>,
  <>Cole a URL acima.</>,
  <>Marque os 4 gatilhos (pedido criado, pedido expirado, comissão aprovada e comissão paga) e salve.</>,
];

function cidade(fuso: string): string {
  return fuso === "UTC" ? "UTC" : (fuso.split("/").pop() ?? fuso).replace(/_/g, " ");
}

// ---------------------------------------------------------------------------
// Painel da URL: copiar, os passos, o ultimo evento e o teste
// ---------------------------------------------------------------------------

function PainelUrl({
  checkout,
  urlInicial,
  aoMudar,
}: {
  checkout: CheckoutResumo;
  /** Ja veio no cadastro; senao o painel pede (GET /url). */
  urlInicial?: string | null;
  aoMudar: () => void;
}) {
  const id = useId();
  const [url, setUrl] = useState<string | null>(urlInicial ?? null);
  const [erroUrl, setErroUrl] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [estado, setEstado] = useState<CheckoutResumo>(checkout);
  const [testando, setTestando] = useState(false);
  const [agora, setAgora] = useState(() => Date.now());
  const inicial = useRef(checkout.ultimo_evento_em);
  // O pai manda uma funcao nova a cada render: o polling nao pode reiniciar por isso.
  const aoMudarRef = useRef(aoMudar);
  useEffect(() => {
    aoMudarRef.current = aoMudar;
  });

  // A URL so sai quando o lojista abre o painel (nunca na lista).
  useEffect(() => {
    if (url) return;
    let vivo = true;
    void chamar<{ url: string }>(`${API}/${checkout.id}/url`).then((r) => {
      if (!vivo) return;
      if (r.ok) setUrl(r.url);
      else setErroUrl(r.erro);
    });
    return () => {
      vivo = false;
    };
  }, [checkout.id, url]);

  // "Ultimo evento recebido": pergunta a cada 5 s por 2 min, so com o painel aberto.
  useEffect(() => {
    const fim = Date.now() + ESPERA_MS;
    const t = setInterval(async () => {
      if (Date.now() > fim) {
        clearInterval(t);
        return;
      }
      const r = await chamar<{ checkout: CheckoutResumo }>(`${API}/${checkout.id}/status`);
      setAgora(Date.now());
      if (!r.ok) return;
      setEstado(r.checkout);
      if (r.checkout.ultimo_evento_em && r.checkout.ultimo_evento_em !== inicial.current) {
        inicial.current = r.checkout.ultimo_evento_em;
        aoMudarRef.current();
      }
    }, INTERVALO_MS);
    return () => clearInterval(t);
  }, [checkout.id]);

  async function copiar() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      toast.error("Não deu para copiar", { description: "Selecione a URL e copie à mão." });
    }
  }

  async function testar() {
    setTestando(true);
    const r = await chamar<{ checkout: CheckoutResumo | null }>(`${API}/${checkout.id}/teste`, { method: "POST" });
    setTestando(false);
    if (!r.ok) {
      toast.error("O teste não chegou", { description: r.erro });
      return;
    }
    if (r.checkout) setEstado(r.checkout);
    setAgora(Date.now());
    toast.success("Evento de teste chegou", { description: "Não entra nos números." });
    aoMudar();
  }

  const e = estadoDoCheckout(estado, agora, FUSO_RELATORIO_PADRAO);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-url`}>URL do webhook</Label>
        <div className="flex gap-2">
          <Input
            id={`${id}-url`}
            readOnly
            value={url ?? (erroUrl ? "" : "Carregando…")}
            onFocus={(ev) => ev.currentTarget.select()}
            className="min-w-0 flex-1 font-mono text-dense"
            aria-describedby={`${id}-url-ajuda`}
          />
          <Button variant="secondary" onClick={copiar} disabled={!url}>
            {copiado ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
            {copiado ? "Copiada" : "Copiar"}
          </Button>
        </div>
        <p id={`${id}-url-ajuda`} className={erroUrl ? "text-label text-err" : "text-label text-t2"}>
          {erroUrl ?? "Esta URL é a senha do checkout: não compartilhe."}
        </p>
      </div>

      <ol className="flex flex-col gap-2">
        {PASSOS_SPHERE.map((p, i) => (
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

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface-2 px-3.5 py-3">
        <span className="flex min-w-0 flex-col gap-1" aria-live="polite">
          <StatusBadge tom={e.tom}>{e.texto}</StatusBadge>
          {e.detalhe ? <span className="text-label text-t2">{e.detalhe}</span> : null}
        </span>
        <Button variant="secondary" size="sm" pending={testando} onClick={testar} disabled={!checkout.ativo}>
          {testando ? null : <SendIcon aria-hidden />}
          Enviar evento de teste
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conectar checkout: plataforma -> nome -> URL
// ---------------------------------------------------------------------------

function Adicionar({
  aberto,
  aoMudar,
  aoCriar,
  passoInicial,
  voltar,
}: {
  aberto: boolean;
  aoMudar: (v: boolean) => void;
  aoCriar: () => void;
  /** "dados" quando a URL ja escolheu a plataforma (?novo=sphere). */
  passoInicial: "plataforma" | "dados";
  /** Veio de "Conectar operação": o Voltar devolve a escolha (so nesta abertura). */
  voltar: string | null;
}) {
  const id = useId();
  const router = useRouter();
  const [passo, setPasso] = useState<"plataforma" | "dados" | "url">(passoInicial);
  const [voltarPara, setVoltarPara] = useState(voltar);
  const [nome, setNome] = useState("");
  const [moeda, setMoeda] = useState<string>("EUR");
  const [fuso, setFuso] = useState(FUSO_RELATORIO_PADRAO);
  const [avancado, setAvancado] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [criado, setCriado] = useState<{ checkout: CheckoutResumo; url: string } | null>(null);

  function fechar(v: boolean) {
    aoMudar(v);
    if (!v) {
      setPasso("plataforma");
      setVoltarPara(null);
      setNome("");
      setMoeda("EUR");
      setFuso(FUSO_RELATORIO_PADRAO);
      setAvancado(false);
      setErro(null);
      setCriado(null);
    }
  }

  async function criar() {
    if (!nome.trim()) {
      setErro("Dê um nome ao checkout.");
      return;
    }
    setErro(null);
    setSalvando(true);
    const r = await chamar<{ checkout: CheckoutResumo; url: string }>(API, {
      method: "POST",
      body: JSON.stringify({ plataforma: "sphere", nome: nome.trim(), moeda_receita: moeda, fuso }),
    });
    setSalvando(false);
    if (!r.ok) {
      setErro(r.erro);
      return;
    }
    setCriado({ checkout: r.checkout, url: r.url });
    setPasso("url");
    aoCriar();
  }

  return (
    <Dialog open={aberto} onOpenChange={fechar}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>
            {passo === "plataforma" ? "Conectar checkout" : passo === "dados" ? "Sphere Affiliates" : "Cole a URL na Sphere"}
          </DialogTitle>
          <DialogDescription>
            {passo === "plataforma"
              ? "Onde o pedido acontece fora da Shopify."
              : passo === "dados"
                ? "Comissão por pedido: entra no Dashboard como Recebido e A receber."
                : "Os pedidos aparecem no Dashboard assim que a Sphere mandar."}
          </DialogDescription>
        </DialogHeader>

        {passo === "plataforma" ? (
          <div role="group" aria-label="Plataforma" className="grid gap-2 sm:grid-cols-2">
            {PLATAFORMAS_CHECKOUT.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={!p.ativa}
                onClick={() => setPasso("dados")}
                className="flex min-h-16 flex-col items-start gap-0.5 rounded-card border border-border bg-surface px-3.5 py-3 text-left hover:border-control-border hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-border disabled:hover:bg-surface"
              >
                <span className="text-dense font-semibold text-ink">{p.nome}</span>
                <span className="text-label text-t2">{p.descricao}</span>
              </button>
            ))}
          </div>
        ) : null}

        {passo === "dados" ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-nome`}>Nome</Label>
              <Input
                id={`${id}-nome`}
                value={nome}
                maxLength={80}
                onChange={(ev) => setNome(ev.target.value)}
                placeholder="Ex.: Sphere Itália"
                aria-invalid={erro ? true : undefined}
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Moeda da comissão</Label>
              <Select value={moeda} onValueChange={(v) => v && setMoeda(String(v))}>
                <SelectTrigger aria-label="Moeda da comissão" className="w-40">
                  <SelectValue>{() => moeda}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {MOEDAS_COMISSAO.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-label text-t2">A Sphere não diz a moeda da comissão: use a do seu painel lá.</p>
            </div>
            {avancado ? (
              <div className="flex flex-col gap-1.5">
                <Label>Fuso dos dias</Label>
                <Select value={fuso} onValueChange={(v) => v && setFuso(String(v))}>
                  <SelectTrigger aria-label="Fuso dos dias" className="w-60">
                    <SelectValue>{() => cidade(fuso)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {FUSOS.map((f) => (
                      <SelectItem key={f} value={f}>
                        {cidade(f)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAvancado(true)}
                className="self-start text-label text-t2 underline underline-offset-3 hover:text-ink"
              >
                Avançado: fuso dos dias ({cidade(fuso)})
              </button>
            )}
            {erro ? <p className="text-label text-err">{erro}</p> : null}
          </div>
        ) : null}

        {passo === "url" && criado ? (
          <PainelUrl checkout={criado.checkout} urlInicial={criado.url} aoMudar={aoCriar} />
        ) : null}

        <DialogFooter showCloseButton={passo === "plataforma"}>
          {passo === "plataforma" && voltarPara ? (
            <Button variant="secondary" onClick={() => router.push(voltarPara)}>
              Voltar
            </Button>
          ) : null}
          {passo === "dados" ? (
            <>
              <Button
                variant="secondary"
                onClick={() => (voltarPara ? router.push(voltarPara) : setPasso("plataforma"))}
                disabled={salvando}
              >
                Voltar
              </Button>
              <Button pending={salvando} onClick={criar}>
                Criar e mostrar a URL
              </Button>
            </>
          ) : null}
          {passo === "url" && criado ? (
            // O checkout ja foi criado no passo anterior: o Concluido so fecha.
            <Button
              onClick={() => {
                toast.success(`${criado.checkout.nome} conectado`, {
                  description: "Os pedidos entram quando a Sphere mandar o primeiro evento.",
                });
                fechar(false);
              }}
            >
              Concluído
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Editar: nome, moeda, taxa padrao, fuso, aviso de comissao aprovada
// ---------------------------------------------------------------------------

function Editar({ checkout, aoFechar, aoSalvar }: { checkout: CheckoutResumo; aoFechar: () => void; aoSalvar: () => void }) {
  const id = useId();
  const [nome, setNome] = useState(checkout.nome);
  const [moeda, setMoeda] = useState(checkout.moeda_receita);
  const [taxa, setTaxa] = useState(String(checkout.taxa_aprovacao_padrao));
  const [fuso, setFuso] = useState(checkout.fuso);
  const [aprovada, setAprovada] = useState(checkout.notificar_aprovada);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const fusos = FUSOS.includes(checkout.fuso) ? FUSOS : [checkout.fuso, ...FUSOS];

  async function salvar() {
    const t = Number(taxa.replace(",", "."));
    if (!nome.trim()) return setErro("Dê um nome ao checkout.");
    if (!Number.isFinite(t) || t < 0 || t > 100) return setErro("A taxa vai de 0 a 100%.");
    setErro(null);
    setSalvando(true);
    const r = await chamar<{ aviso?: string }>(`${API}/${checkout.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        nome: nome.trim(),
        moeda_receita: moeda,
        taxa_aprovacao_padrao: t,
        fuso,
        notificar_aprovada: aprovada,
      }),
    });
    setSalvando(false);
    if (!r.ok) return setErro(r.erro);
    if (r.aviso) toast.warning("Salvo, com um aviso", { description: r.aviso });
    else toast.success("Checkout salvo");
    aoSalvar();
    aoFechar();
  }

  return (
    <Dialog open onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Editar checkout</DialogTitle>
          <DialogDescription>{nomeDaPlataforma(checkout.plataforma)}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-nome`}>Nome</Label>
            <Input id={`${id}-nome`} value={nome} maxLength={80} onChange={(ev) => setNome(ev.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>Moeda da comissão</Label>
              <Select value={moeda} onValueChange={(v) => v && setMoeda(String(v))}>
                <SelectTrigger aria-label="Moeda da comissão">
                  <SelectValue>{() => moeda}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {MOEDAS_COMISSAO.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-taxa`}>Taxa de aprovação padrão (%)</Label>
              <Input
                id={`${id}-taxa`}
                inputMode="decimal"
                value={taxa}
                onChange={(ev) => setTaxa(ev.target.value)}
                aria-describedby={`${id}-taxa-ajuda`}
              />
            </div>
          </div>
          <p id={`${id}-taxa-ajuda`} className="-mt-2 text-label text-t2">
            Usada no Previsto até o checkout ter 20 pedidos finalizados.
          </p>
          <div className="flex flex-col gap-1.5">
            <Label>Fuso dos dias</Label>
            <Select value={fuso} onValueChange={(v) => v && setFuso(String(v))}>
              <SelectTrigger aria-label="Fuso dos dias" className="w-60">
                <SelectValue>{() => cidade(fuso)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {fusos.map((f) => (
                  <SelectItem key={f} value={f}>
                    {cidade(f)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Switch
            rotulo="Avisar no celular quando a comissão for aprovada"
            descricao="O pedido novo sempre avisa (Notificações → Venda no celular)."
            checked={aprovada}
            onCheckedChange={setAprovada}
          />
          {erro ? <p className="text-label text-err">{erro}</p> : null}
        </div>
        <DialogFooter showCloseButton>
          <Button pending={salvando} onClick={salvar}>
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// A tela
// ---------------------------------------------------------------------------

export function CheckoutsTela({
  checkouts,
  contas,
  eventos,
  semMigration,
  agoraMs,
  abrirEm = null,
  voltar = null,
}: {
  checkouts: CheckoutResumo[];
  contas: Record<string, string[]>;
  eventos: EventoDaTela[];
  semMigration: boolean;
  agoraMs: number;
  /** ?novo= na URL: abre o "Conectar checkout" ao chegar, neste passo. */
  abrirEm?: "plataforma" | "dados" | null;
  /** ?de=conectar: o Voltar do primeiro passo devolve /conectar. */
  voltar?: string | null;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [adicionando, setAdicionando] = useState(false);
  const [urlDe, setUrlDe] = useState<CheckoutResumo | null>(null);
  const [editando, setEditando] = useState<CheckoutResumo | null>(null);
  const [removendo, setRemovendo] = useState<CheckoutResumo | null>(null);
  const [trocando, setTrocando] = useState<CheckoutResumo | null>(null);
  const [testando, setTestando] = useState<string | null>(null);
  const fuso = FUSO_RELATORIO_PADRAO;
  const atualizar = () => startTransition(() => router.refresh());

  // ?novo= na URL: o "Conectar checkout" abre so no navegador (o dialogo
  // nao existe no HTML do servidor) -- useSyncExternalStore, sem setState em
  // efeito -- e fecha de vez ao fechar. O pedido sai da URL para recarregar a
  // pagina nao reabrir, como no "Conectar loja" (stores/conectar-loja.tsx).
  const [pedidoAberto, setPedidoAberto] = useState(() => abrirEm !== null && !semMigration);
  const noNavegador = useSyncExternalStore(semAssinatura, () => true, () => false);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("novo") && !url.searchParams.has(PARAM_DE)) return;
    url.searchParams.delete("novo");
    url.searchParams.delete(PARAM_DE);
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }, []);
  const adicionarAberto = adicionando || (pedidoAberto && noNavegador);
  function mudarAdicionar(v: boolean) {
    setAdicionando(v);
    if (!v) setPedidoAberto(false);
  }

  const estados = checkouts.map((c) => estadoDoCheckout(c, agoraMs, fuso));
  const comErro = estados.filter((e) => e.tom === "err").length;
  const geral =
    checkouts.length === 0
      ? { tom: "neutral" as const, texto: "Nenhum checkout" }
      : comErro > 0
        ? { tom: "err" as const, texto: plural(comErro, "com erro", "com erro") }
        : { tom: "ok" as const, texto: plural(checkouts.length, "checkout", "checkouts") };
  const nomePorId = new Map(checkouts.map((c) => [c.id, c.nome]));

  async function alternar(c: CheckoutResumo) {
    const r = await chamar(`${API}/${c.id}`, { method: "PATCH", body: JSON.stringify({ ativo: !c.ativo }) });
    if (!r.ok) return toast.error("Não deu para salvar", { description: r.erro });
    toast.success(c.ativo ? `${c.nome} pausado` : `${c.nome} ativo de novo`, {
      description: c.ativo
        ? "Pedido novo não entra. Os que já estão seguem atualizando."
        : "Pedidos novos voltam a entrar.",
    });
    atualizar();
  }

  async function testar(c: CheckoutResumo) {
    setTestando(c.id);
    const r = await chamar(`${API}/${c.id}/teste`, { method: "POST" });
    setTestando(null);
    if (!r.ok) return toast.error("O teste não chegou", { description: r.erro });
    toast.success("Evento de teste chegou", { description: "Não entra nos números." });
    atualizar();
  }

  return (
    <>
      <CabecalhoPlataforma
        titulo="Checkouts"
        estado={geral}
        dica="Checkout externo é onde o pedido acontece fora da Shopify. Cada um vira uma “loja” no seletor do topo, com Recebido, A receber e lucro."
        acao={
          <Button onClick={() => setAdicionando(true)} disabled={semMigration}>
            <PlusIcon aria-hidden />
            Conectar checkout
          </Button>
        }
      />

      {semMigration ? (
        <Callout tom="warn" titulo="Cadastro de checkout ainda não liberado.">
          Falta atualizar o banco. Tente de novo mais tarde.
        </Callout>
      ) : null}

      {checkouts.length === 0 ? (
        <EmptyState
          titulo="Nenhum checkout"
          descricao="Ligue a Sphere Affiliates para ver a comissão e o lucro no Dashboard."
          acao={
            semMigration ? undefined : (
              <Button onClick={() => setAdicionando(true)}>
                <PlusIcon aria-hidden />
                Conectar checkout
              </Button>
            )
          }
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {checkouts.map((c, i) => {
            const e = estados[i];
            return (
              <li
                key={c.id}
                className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="flex min-w-0 flex-col gap-1.5">
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-body font-semibold text-ink">{c.nome}</span>
                    <span className="text-label text-t2">
                      {nomeDaPlataforma(c.plataforma)}
                      {rotuloAfiliados(contas[c.id])} · comissão em {c.moeda_receita}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <StatusBadge tom={e.tom}>{e.texto}</StatusBadge>
                    {e.detalhe ? <span className="line-clamp-2 text-label text-t1">{e.detalhe}</span> : null}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setUrlDe(c)}>
                    URL do webhook
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    pending={testando === c.id}
                    disabled={!c.ativo || (testando !== null && testando !== c.id)}
                    onClick={() => testar(c)}
                  >
                    {testando === c.id ? null : <SendIcon aria-hidden />}
                    Testar
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      aria-label={`Mais ações para ${c.nome}`}
                      className={buttonVariants({ variant: "ghost", size: "icon" })}
                    >
                      <MoreHorizontalIcon aria-hidden />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      <DropdownMenuItem onClick={() => setEditando(c)}>Editar</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => void alternar(c)}>{c.ativo ? "Pausar" : "Ativar"}</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setTrocando(c)}>Trocar URL</DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onClick={() => setRemovendo(c)}>
                        Remover
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {checkouts.length > 0 ? (
        <Section
          titulo="Eventos recebidos"
          nivel={3}
          espaco="nenhum"
          descricao="Os 20 últimos. O teste não aparece aqui nem nos números."
        >
          {eventos.length === 0 ? (
            <p className="text-dense text-t2">Nenhum evento ainda.</p>
          ) : (
            <div className="overflow-x-auto rounded-card border border-border bg-surface">
              <table className="w-full border-collapse text-dense">
                <caption className="sr-only">Últimos eventos recebidos dos checkouts</caption>
                <thead>
                  <tr className="text-label text-t2">
                    {["Quando", "Checkout", "Pedido", "Evento"].map((t) => (
                      <th key={t} scope="col" className="h-9 border-b border-border px-3.5 text-left font-medium">
                        {t}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {eventos.map((ev) => (
                    <tr
                      key={`${ev.checkoutId}:${ev.pedidoId}:${ev.evento}`}
                      className="[&>td]:h-11 [&>td]:border-b [&>td]:border-border-subtle [&>td]:px-3.5 last:[&>td]:border-b-0"
                    >
                      <td className="num whitespace-nowrap text-t1" title={quando(ev.recebidoEm, agoraMs, fuso)}>
                        {haQuantoTempo(ev.recebidoEm, agoraMs)}
                      </td>
                      <td className="whitespace-nowrap">{nomePorId.get(ev.checkoutId) ?? "—"}</td>
                      <td className="num whitespace-nowrap">#{ev.pedidoId}</td>
                      <td className="whitespace-nowrap">{rotuloDoEvento(ev.evento)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      ) : null}

      <Adicionar
        aberto={adicionarAberto}
        aoMudar={mudarAdicionar}
        aoCriar={atualizar}
        passoInicial={abrirEm === "dados" ? "dados" : "plataforma"}
        voltar={pedidoAberto ? voltar : null}
      />

      <Dialog open={urlDe !== null} onOpenChange={(v) => !v && setUrlDe(null)}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>{urlDe?.nome ?? "Checkout"}</DialogTitle>
            <DialogDescription>Cole esta URL no painel da {nomeDaPlataforma(urlDe?.plataforma)}.</DialogDescription>
          </DialogHeader>
          {urlDe ? <PainelUrl key={urlDe.id} checkout={urlDe} aoMudar={atualizar} /> : null}
          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>

      {editando ? <Editar checkout={editando} aoFechar={() => setEditando(null)} aoSalvar={atualizar} /> : null}

      <ConfirmDialog
        open={trocando !== null}
        onOpenChange={(v) => !v && setTrocando(null)}
        tom="normal"
        titulo={`Trocar a URL de ${trocando?.nome ?? "checkout"}?`}
        descricao="A URL antiga para de funcionar na hora e os afiliados ligados a ela ficam livres. Cole a nova na Sphere logo em seguida, senão os eventos se perdem."
        confirmar="Trocar URL"
        onConfirmar={async () => {
          if (!trocando) return;
          const alvo = trocando;
          const r = await chamar<{ url: string; aviso?: string }>(`${API}/${alvo.id}`, {
            method: "PATCH",
            body: JSON.stringify({ trocarUrl: true }),
          });
          if (!r.ok) throw new Error(r.erro);
          setTrocando(null);
          setUrlDe(alvo);
          if (r.aviso) toast.warning("URL trocada", { description: r.aviso });
          else toast.success("URL trocada", { description: "Cole a nova na Sphere." });
          atualizar();
        }}
      />

      <ConfirmDialog
        open={removendo !== null}
        onOpenChange={(v) => !v && setRemovendo(null)}
        titulo={`Remover ${removendo?.nome ?? "checkout"} do xcart?`}
        descricao="Os pedidos e a comissão dele saem do Dashboard. A conta de anúncio ligada fica sem checkout. Na Sphere, apague o webhook também."
        confirmar="Remover checkout"
        onConfirmar={async () => {
          if (!removendo) return;
          const r = await chamar(`${API}/${removendo.id}`, { method: "DELETE" });
          if (!r.ok) throw new Error(r.erro);
          setRemovendo(null);
          toast.success("Checkout removido");
          atualizar();
        }}
      />
    </>
  );
}
