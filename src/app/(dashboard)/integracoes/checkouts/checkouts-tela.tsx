"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
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
  modeloDaPlataforma,
  moedaPadraoDe,
  nomeDaPlataforma,
  rastreiaCompra,
  rotuloDoEvento,
  segredoValido,
  textoDaMoeda,
  usaSegredo,
  nomeDoSegredo,
  erroDoSegredo,
  type CheckoutResumo,
  type IdPlataformaCheckout,
  type PlataformaDaLista,
} from "@/lib/checkouts-externos/tipos";
import type { EventoDaTela } from "@/lib/leitura/checkouts";
import { CabecalhoPlataforma } from "../cabecalho-plataforma";
import { chamar } from "../api";
import { estadoDoCheckout, haQuantoTempo, plural, quando, rotuloAfiliados } from "../regras";
import { RastreamentoCheckout } from "./rastreamento-checkout";

// ============================================================================
// Checkouts externos: cadastrar (plataforma -> nome -> URL), copiar a URL do
// webhook, ver os eventos chegando e mandar um evento de teste. Tudo pelas
// rotas /api/checkouts (a sessao confere o dono; quem grava e o servidor).
// O teste NUNCA entra nos numeros: o endpoint reconhece e nao grava pedido.
//
// Cakto e Hubla (venda): a Cakto gera o secret quando o webhook e criado la, e
// a Hubla mostra o token na aba Autenticacao, entao o campo fica no painel da
// URL (e no Editar, para trocar). Ele vai so para o servidor: a tela so sabe
// SE ha um salvo (GET /url). O Eve (so na conta do Arthur) gera o secret no
// painel dele, depois de colar a URL.
//
// A escolha de plataforma vem pronta do servidor (`plataformas`, a da conta):
// a tela nao sabe quem pode ver o Eve.
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

const Forte = ({ children }: { children: ReactNode }) => <span className="font-medium text-ink">{children}</span>;

const PASSOS_SPHERE = [
  <>
    Na Sphere, abra <Forte>Webhooks</Forte> e clique em <Forte>Novo Webhook</Forte>.
  </>,
  <>Cole a URL acima.</>,
  <>Marque os 4 gatilhos (pedido criado, pedido expirado, comissão aprovada e comissão paga) e salve.</>,
];

const PASSOS_CAKTO = [
  <>
    Na Cakto, abra <Forte>Integrações › Webhooks</Forte> e crie um webhook com a URL acima.
  </>,
  <>
    Marque <Forte>todos os produtos</Forte>. Produto novo precisa ser incluído lá depois.
  </>,
  <>
    Marque os eventos: compra aprovada e recusada, Pix, boleto e PicPay gerados, reembolso, reembolso pedido e
    chargeback.
  </>,
  <>Copie o secret do webhook e cole aqui embaixo.</>,
  <>
    Clique em <Forte>Testar</Forte> na Cakto. O teste não entra nos números.
  </>,
];

const PASSOS_HUBLA = [
  <>
    Na Hubla, abra <Forte>Integrações › Webhook</Forte>, aba <Forte>Configurações</Forte>, e clique em{" "}
    <Forte>Adicionar regra</Forte>.
  </>,
  <>
    Cole a URL acima e escolha <Forte>todos os seus produtos</Forte>.
  </>,
  <>
    Marque os eventos de fatura: criada, status atualizado, pagamento realizado, pagamento falhou, expirada e
    reembolsada.
  </>,
  <>
    Em <Forte>Como enviar seus dados</Forte>, marque <Forte>Integração recomendada</Forte> e salve.
  </>,
  <>
    Na aba <Forte>Autenticação</Forte>, copie o <Forte>Hubla Webhook Token</Forte> e cole aqui embaixo.
  </>,
  <>
    Na regra, abra as opções e clique em <Forte>Testar configuração</Forte>. O teste não entra nos números.
  </>,
];

const PASSOS_EVE = [
  <>
    No painel da Eve, abra <Forte>Configurações › xcart</Forte> e cole a URL acima.
  </>,
  <>
    Clique em <Forte>Gerar secret</Forte>, copie e cole o secret aqui embaixo.
  </>,
  <>
    Clique em <Forte>Enviar teste</Forte> lá ou em Enviar evento de teste aqui. O teste não entra nos números.
  </>,
];

function passosDe(plataforma: string) {
  return plataforma === "cakto"
    ? PASSOS_CAKTO
    : plataforma === "hubla"
      ? PASSOS_HUBLA
      : plataforma === "eve"
        ? PASSOS_EVE
        : PASSOS_SPHERE;
}

/** O botao de teste no painel da plataforma. */
function botaoDeTeste(plataforma: string): string {
  return plataforma === "hubla" ? "Testar configuração" : plataforma === "eve" ? "Enviar teste" : "Testar";
}


/** "na Sphere", "na Cakto": o nome curto das frases (a Sphere e so "Sphere" nos textos dela). */
function nomeCurto(plataforma: string | null | undefined): string {
  return plataforma === "sphere" ? "Sphere" : nomeDaPlataforma(plataforma);
}

function cidade(fuso: string): string {
  return fuso === "UTC" ? "UTC" : (fuso.split("/").pop() ?? fuso).replace(/_/g, " ");
}

// ---------------------------------------------------------------------------
// O secret da plataforma (Cakto) ou o token (Hubla): colar e salvar
// ---------------------------------------------------------------------------

function CampoSegredo({
  checkoutId,
  plataforma,
  temSegredo,
  aoSalvar,
}: {
  checkoutId: string;
  plataforma: string;
  /** null = ainda nao se sabe (o GET /url nao voltou). */
  temSegredo: boolean | null;
  aoSalvar: () => void;
}) {
  const id = useId();
  const [valor, setValor] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const nome = nomeDaPlataforma(plataforma);
  const qual = nomeDoSegredo(plataforma);
  const teste = botaoDeTeste(plataforma);

  async function salvar() {
    const s = segredoValido(valor);
    if (!s) return setErro(`Cole o ${qual} inteiro: de 8 a 200 caracteres, sem espaço.`);
    setErro(null);
    setSalvando(true);
    const r = await chamar(`${API}/${checkoutId}`, { method: "PATCH", body: JSON.stringify({ segredo: s }) });
    setSalvando(false);
    if (!r.ok) return setErro(r.erro);
    setValor("");
    toast.success(qual === "token" ? "Token salvo" : "Secret salvo", { description: `Agora clique em ${teste} na ${nome}.` });
    aoSalvar();
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`${id}-segredo`}>{qual === "token" ? "Token do webhook" : "Secret do webhook"}</Label>
      <div className="flex gap-2">
        <Input
          id={`${id}-segredo`}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={valor}
          onChange={(ev) => setValor(ev.target.value)}
          placeholder={temSegredo ? "Salvo · cole outro para trocar" : `Cole o ${qual} da ${nome}`}
          className="min-w-0 flex-1 font-mono text-dense"
          aria-invalid={erro ? true : undefined}
          aria-describedby={`${id}-segredo-ajuda`}
        />
        <Button variant="secondary" pending={salvando} onClick={salvar} disabled={!valor.trim()}>
          Salvar
        </Button>
      </div>
      <p id={`${id}-segredo-ajuda`} className={erro ? "text-label text-err" : "text-label text-t2"}>
        {erro ??
          (temSegredo === false
            ? `Sem o ${qual}, o xcart recusa os eventos da ${nome}.`
            : temSegredo
              ? `${qual === "token" ? "Token salvo" : "Secret salvo"}. Ele confere cada evento que chega.`
              : "Ele confere cada evento que chega.")}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Painel da URL: copiar, os passos, o ultimo evento e o teste
// ---------------------------------------------------------------------------

function PainelUrl({
  checkout,
  urlInicial,
  temSegredoInicial,
  aoMudar,
}: {
  checkout: CheckoutResumo;
  /** Ja veio no cadastro; senao o painel pede (GET /url). */
  urlInicial?: string | null;
  temSegredoInicial?: boolean | null;
  aoMudar: () => void;
}) {
  const id = useId();
  const assina = usaSegredo(checkout.plataforma);
  const [url, setUrl] = useState<string | null>(urlInicial ?? null);
  const [temSegredo, setTemSegredo] = useState<boolean | null>(temSegredoInicial ?? null);
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

  // A URL so sai quando o lojista abre o painel (nunca na lista). Na Cakto e
  // na Hubla, junto vem SE o secret/token ja foi colado (nunca ele). Uma vez por painel:
  // o que veio no cadastro dispensa o pedido.
  useEffect(() => {
    if (urlInicial && (!assina || typeof temSegredoInicial === "boolean")) return;
    let vivo = true;
    void chamar<{ url: string; temSegredo?: boolean }>(`${API}/${checkout.id}/url`).then((r) => {
      if (!vivo) return;
      if (r.ok) {
        setUrl(r.url);
        if (typeof r.temSegredo === "boolean") setTemSegredo(r.temSegredo);
      } else setErroUrl(r.erro);
    });
    return () => {
      vivo = false;
    };
  }, [checkout.id, urlInicial, assina, temSegredoInicial]);

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
  const semSegredo = assina && temSegredo !== true;
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
        {passosDe(checkout.plataforma).map((p, i) => (
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

      {assina ? (
        <CampoSegredo
          checkoutId={checkout.id}
          plataforma={checkout.plataforma}
          temSegredo={temSegredo}
          aoSalvar={() => {
            setTemSegredo(true);
            aoMudar();
          }}
        />
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface-2 px-3.5 py-3">
        <span className="flex min-w-0 flex-col gap-1" aria-live="polite">
          <StatusBadge tom={e.tom}>{e.texto}</StatusBadge>
          {e.detalhe ? <span className="text-label text-t2">{e.detalhe}</span> : null}
        </span>
        <Button
          variant="secondary"
          size="sm"
          pending={testando}
          onClick={testar}
          disabled={!checkout.ativo || semSegredo}
          title={semSegredo ? `Salve o ${nomeDoSegredo(checkout.plataforma)} antes de testar` : undefined}
        >
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

const TEXTO_DADOS: Record<IdPlataformaCheckout, string> = {
  sphere: "Comissão por pedido: entra no Dashboard como Recebido e A receber.",
  cakto: "Venda própria: entra no Dashboard com faturamento, taxa e líquido.",
  hubla: "Venda própria: entra no Dashboard com faturamento, taxa e líquido.",
  eve: "Venda própria no Pix: entra no Dashboard com o faturamento de cada Pix. A taxa do gateway não vem da Eve.",
};

const EXEMPLO_NOME: Record<IdPlataformaCheckout, string> = {
  sphere: "Ex.: Sphere Itália",
  cakto: "Ex.: Cakto Curso X",
  hubla: "Ex.: Hubla Mentoria X",
  eve: "Ex.: Eve Panela Mônaco",
};

/** Onde a plataforma mostra o secret (ou o token): a ajuda do campo no cadastro. */
const ONDE_SEGREDO: Partial<Record<IdPlataformaCheckout, string>> = {
  cakto: "A Cakto mostra o secret ao criar o webhook. Dá para colar no próximo passo.",
  hubla: "A Hubla mostra o token na aba Autenticação do webhook. Dá para colar no próximo passo.",
  eve: "A Eve gera o secret em Configurações › xcart, depois de colar a URL. Dá para colar no próximo passo.",
};

function Adicionar({
  aberto,
  aoMudar,
  aoCriar,
  plataformas,
  passoInicial,
  plataformaInicial,
  voltar,
}: {
  aberto: boolean;
  /** A escolha da conta (o servidor decide quem ve o Eve). */
  plataformas: readonly PlataformaDaLista[];
  aoMudar: (v: boolean) => void;
  aoCriar: () => void;
  /** "dados" quando a URL ja escolheu a plataforma (?novo=cakto). */
  passoInicial: "plataforma" | "dados";
  plataformaInicial: IdPlataformaCheckout | null;
  /** Veio de "Conectar operação": o Voltar devolve a escolha (so nesta abertura). */
  voltar: string | null;
}) {
  const id = useId();
  const router = useRouter();
  const [passo, setPasso] = useState<"plataforma" | "dados" | "url">(plataformaInicial ? passoInicial : "plataforma");
  const [plataforma, setPlataforma] = useState<IdPlataformaCheckout>(plataformaInicial ?? "cakto");
  const [voltarPara, setVoltarPara] = useState(voltar);
  const [nome, setNome] = useState("");
  const [moeda, setMoeda] = useState<string>(moedaPadraoDe(plataformaInicial ?? "cakto"));
  const [segredo, setSegredo] = useState("");
  const [fuso, setFuso] = useState(FUSO_RELATORIO_PADRAO);
  const [avancado, setAvancado] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [criado, setCriado] = useState<{ checkout: CheckoutResumo; url: string; temSegredo: boolean | null } | null>(null);
  const venda = modeloDaPlataforma(plataforma) === "venda";
  const nomePlataforma = nomeDaPlataforma(plataforma);
  const curto = nomeCurto(plataforma);

  function fechar(v: boolean) {
    aoMudar(v);
    if (!v) {
      setPasso("plataforma");
      setVoltarPara(null);
      setNome("");
      setMoeda(moedaPadraoDe("cakto"));
      setPlataforma("cakto");
      setSegredo("");
      setFuso(FUSO_RELATORIO_PADRAO);
      setAvancado(false);
      setErro(null);
      setCriado(null);
    }
  }

  function escolher(p: IdPlataformaCheckout) {
    setPlataforma(p);
    setMoeda(moedaPadraoDe(p));
    setSegredo("");
    setErro(null);
    setPasso("dados");
  }

  async function criar() {
    if (!nome.trim()) {
      setErro("Dê um nome ao checkout.");
      return;
    }
    const s = segredo.trim() ? segredoValido(segredo) : null;
    if (segredo.trim() && !s) {
      setErro(erroDoSegredo(plataforma));
      return;
    }
    setErro(null);
    setSalvando(true);
    const r = await chamar<{ checkout: CheckoutResumo; url: string; temSegredo?: boolean }>(API, {
      method: "POST",
      body: JSON.stringify({ plataforma, nome: nome.trim(), moeda_receita: moeda, fuso, ...(s ? { segredo: s } : {}) }),
    });
    setSalvando(false);
    if (!r.ok) {
      setErro(r.erro);
      return;
    }
    setCriado({ checkout: r.checkout, url: r.url, temSegredo: typeof r.temSegredo === "boolean" ? r.temSegredo : null });
    setPasso("url");
    aoCriar();
  }

  return (
    <Dialog open={aberto} onOpenChange={fechar}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>
            {passo === "plataforma" ? "Conectar checkout" : passo === "dados" ? nomePlataforma : `Cole a URL na ${curto}`}
          </DialogTitle>
          <DialogDescription>
            {passo === "plataforma"
              ? "Onde o pedido acontece fora da Shopify."
              : passo === "dados"
                ? TEXTO_DADOS[plataforma]
                : `Os pedidos aparecem no Dashboard assim que a ${curto} mandar.`}
          </DialogDescription>
        </DialogHeader>

        {passo === "plataforma" ? (
          <div role="group" aria-label="Plataforma" className="grid gap-2 sm:grid-cols-2">
            {plataformas.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={!p.ativa}
                onClick={() => p.ativa && escolher(p.id as IdPlataformaCheckout)}
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
                placeholder={EXEMPLO_NOME[plataforma]}
                aria-invalid={erro ? true : undefined}
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{venda ? "Moeda das vendas" : "Moeda da comissão"}</Label>
              <Select value={moeda} onValueChange={(v) => v && setMoeda(String(v))}>
                <SelectTrigger aria-label={venda ? "Moeda das vendas" : "Moeda da comissão"} className="w-40">
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
              <p className="text-label text-t2">
                {venda
                  ? `Vale quando a ${curto} não manda a moeda da venda.`
                  : "A Sphere não diz a moeda da comissão: use a do seu painel lá."}
              </p>
            </div>
            {usaSegredo(plataforma) ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-segredo`}>
                  {nomeDoSegredo(plataforma) === "token" ? "Token do webhook (opcional)" : "Secret do webhook (opcional)"}
                </Label>
                <Input
                  id={`${id}-segredo`}
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={segredo}
                  onChange={(ev) => setSegredo(ev.target.value)}
                  placeholder={`Se já tiver o da ${curto}`}
                  className="font-mono text-dense"
                />
                <p className="text-label text-t2">{ONDE_SEGREDO[plataforma] ?? ONDE_SEGREDO.cakto}</p>
              </div>
            ) : null}
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
          <PainelUrl
            checkout={criado.checkout}
            urlInicial={criado.url}
            temSegredoInicial={criado.temSegredo}
            aoMudar={aoCriar}
          />
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
                  description: `Os pedidos entram quando a ${curto} mandar o primeiro evento.`,
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
// Editar: nome, moeda, taxa padrao (comissao), fuso, avisos, secret (Cakto) ou token (Hubla)
// ---------------------------------------------------------------------------

function Editar({
  checkout,
  aoFechar,
  aoSalvar,
  aoRastrear,
}: {
  checkout: CheckoutResumo;
  aoFechar: () => void;
  aoSalvar: () => void;
  /** Venda (Cakto, Hubla): abre o Rastreamento (Meta e TikTok) do checkout. */
  aoRastrear: () => void;
}) {
  const id = useId();
  const venda = modeloDaPlataforma(checkout.plataforma) === "venda";
  const assina = usaSegredo(checkout.plataforma);
  const [nome, setNome] = useState(checkout.nome);
  const [moeda, setMoeda] = useState(checkout.moeda_receita);
  const [taxa, setTaxa] = useState(String(checkout.taxa_aprovacao_padrao));
  const [fuso, setFuso] = useState(checkout.fuso);
  const [aprovada, setAprovada] = useState(checkout.notificar_aprovada);
  const [pendente, setPendente] = useState(checkout.notificar_pendente);
  const [estorno, setEstorno] = useState(checkout.notificar_estorno);
  const [segredo, setSegredo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const fusos = FUSOS.includes(checkout.fuso) ? FUSOS : [checkout.fuso, ...FUSOS];

  async function salvar() {
    const t = Number(taxa.replace(",", "."));
    if (!nome.trim()) return setErro("Dê um nome ao checkout.");
    if (!venda && (!Number.isFinite(t) || t < 0 || t > 100)) return setErro("A taxa vai de 0 a 100%.");
    const s = segredo.trim() ? segredoValido(segredo) : null;
    if (segredo.trim() && !s) return setErro(erroDoSegredo(checkout.plataforma));
    setErro(null);
    setSalvando(true);
    const r = await chamar<{ aviso?: string }>(`${API}/${checkout.id}`, {
      method: "PATCH",
      body: JSON.stringify(
        venda
          ? { nome: nome.trim(), moeda_receita: moeda, fuso, notificar_pendente: pendente, notificar_estorno: estorno, ...(s ? { segredo: s } : {}) }
          : { nome: nome.trim(), moeda_receita: moeda, taxa_aprovacao_padrao: t, fuso, notificar_aprovada: aprovada }
      ),
    });
    setSalvando(false);
    if (!r.ok) return setErro(r.erro);
    if (r.aviso) toast.warning("Salvo, com um aviso", { description: r.aviso });
    else toast.success("Checkout salvo");
    aoSalvar();
    aoFechar();
  }

  const seletorMoeda = (
    <div className="flex flex-col gap-1.5">
      <Label>{venda ? "Moeda das vendas" : "Moeda da comissão"}</Label>
      <Select value={moeda} onValueChange={(v) => v && setMoeda(String(v))}>
        <SelectTrigger aria-label={venda ? "Moeda das vendas" : "Moeda da comissão"} className={venda ? "w-40" : undefined}>
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
  );

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
          {venda ? (
            seletorMoeda
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                {seletorMoeda}
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
            </>
          )}
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
          {assina ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-segredo`}>Trocar o {nomeDoSegredo(checkout.plataforma)} do webhook</Label>
              <Input
                id={`${id}-segredo`}
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={segredo}
                onChange={(ev) => setSegredo(ev.target.value)}
                placeholder="Vazio mantém o atual"
                className="font-mono text-dense"
              />
            </div>
          ) : null}
          {rastreiaCompra(checkout.plataforma) ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface-2 px-3.5 py-3">
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-dense font-medium text-ink">Rastreamento</span>
                <span className="text-label text-t2">A compra ao Meta e ao TikTok pelo servidor, e quando ela sai.</span>
              </span>
              <Button variant="secondary" size="sm" onClick={aoRastrear}>
                Abrir
              </Button>
            </div>
          ) : null}
          {venda ? (
            <>
              <Switch
                rotulo="Avisar no celular quando gerar Pix ou boleto"
                descricao="A venda aprovada sempre avisa (Notificações → Venda no celular)."
                checked={pendente}
                onCheckedChange={setPendente}
              />
              <Switch rotulo="Avisar reembolso e chargeback" checked={estorno} onCheckedChange={setEstorno} />
            </>
          ) : (
            <Switch
              rotulo="Avisar no celular quando a comissão for aprovada"
              descricao="O pedido novo sempre avisa (Notificações → Venda no celular)."
              checked={aprovada}
              onCheckedChange={setAprovada}
            />
          )}
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
  plataformas = PLATAFORMAS_CHECKOUT,
  abrirEm = null,
  plataformaNovo = null,
  voltar = null,
}: {
  checkouts: CheckoutResumo[];
  contas: Record<string, string[]>;
  eventos: EventoDaTela[];
  semMigration: boolean;
  agoraMs: number;
  /** A escolha de plataforma da conta (page.tsx: plataformasDaConta). Ausente = a publica. */
  plataformas?: readonly PlataformaDaLista[];
  /** ?novo= na URL: abre o "Conectar checkout" ao chegar, neste passo. */
  abrirEm?: "plataforma" | "dados" | null;
  /** ?novo=cakto: a plataforma ja escolhida. */
  plataformaNovo?: IdPlataformaCheckout | null;
  /** ?de=conectar: o Voltar do primeiro passo devolve /conectar. */
  voltar?: string | null;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [adicionando, setAdicionando] = useState(false);
  const [urlDe, setUrlDe] = useState<CheckoutResumo | null>(null);
  const [editando, setEditando] = useState<CheckoutResumo | null>(null);
  const [rastreando, setRastreando] = useState<CheckoutResumo | null>(null);
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
        dica="Checkout externo é onde o pedido acontece fora da Shopify. Cada um vira uma “loja” no seletor do topo, com as vendas (ou a comissão) e o lucro."
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
          descricao="Ligue a Cakto, a Hubla ou a Sphere Affiliates para ver as vendas e o lucro no Dashboard."
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
                      {rotuloAfiliados(contas[c.id])} · {textoDaMoeda(c.plataforma, c.moeda_receita)}
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
                      {rastreiaCompra(c.plataforma) ? (
                        <DropdownMenuItem onClick={() => setRastreando(c)}>Rastreamento (Meta e TikTok)</DropdownMenuItem>
                      ) : null}
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
        plataformas={plataformas}
        passoInicial={abrirEm === "dados" ? "dados" : "plataforma"}
        plataformaInicial={pedidoAberto ? plataformaNovo : null}
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

      {editando ? (
        <Editar
          checkout={editando}
          aoFechar={() => setEditando(null)}
          aoSalvar={atualizar}
          aoRastrear={() => {
            setRastreando(editando);
            setEditando(null);
          }}
        />
      ) : null}

      {rastreando ? <RastreamentoCheckout checkout={rastreando} aoFechar={() => setRastreando(null)} /> : null}

      <ConfirmDialog
        open={trocando !== null}
        onOpenChange={(v) => !v && setTrocando(null)}
        tom="normal"
        titulo={`Trocar a URL de ${trocando?.nome ?? "checkout"}?`}
        descricao={
          trocando && usaSegredo(trocando.plataforma)
            ? `A URL antiga para de funcionar na hora. Cole a nova no webhook da ${nomeCurto(trocando.plataforma)} logo em seguida, senão os eventos se perdem. O ${nomeDoSegredo(trocando.plataforma)} continua o mesmo.`
            : "A URL antiga para de funcionar na hora e os afiliados ligados a ela ficam livres. Cole a nova na Sphere logo em seguida, senão os eventos se perdem."
        }
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
          else toast.success("URL trocada", { description: `Cole a nova na ${nomeCurto(alvo.plataforma)}.` });
          atualizar();
        }}
      />

      <ConfirmDialog
        open={removendo !== null}
        onOpenChange={(v) => !v && setRemovendo(null)}
        titulo={`Remover ${removendo?.nome ?? "checkout"} do xcart?`}
        descricao={
          removendo && modeloDaPlataforma(removendo.plataforma) === "venda"
            ? `Os pedidos e as vendas dele saem do Dashboard. A conta de anúncio ligada fica sem checkout. Na ${nomeCurto(removendo.plataforma)}, apague o webhook também.`
            : "Os pedidos e a comissão dele saem do Dashboard. A conta de anúncio ligada fica sem checkout. Na Sphere, apague o webhook também."
        }
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
