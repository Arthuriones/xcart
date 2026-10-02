"use client";

import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  ROTAS,
  type ContaAnuncioResumo,
  type GoogleContaCriadaResposta,
  type LojaDoSeletor,
  type MetaConectarResposta,
  type SyncResposta,
} from "@/lib/financeiro/tipos";
import { cn } from "@/lib/utils";
import { Aviso, Selo, TagPlataforma } from "../../tracking/selo";

// ============================================================================
// Contas de anuncio, na tela.
//
// Meta e puxado pelo xcart (token de usuario do sistema, ads_read). Google e
// EMPURRADO por um script colado em cada conta, porque a API do Google ainda
// pede o nivel Explorer. Por isso as duas secoes tem passo a passo diferente.
//
// Segredo nenhum chega aqui: so `temSegredo`. O script do Google aparece uma
// vez, na resposta do cadastro, e some ao recarregar -- de proposito.
// ============================================================================

const CAMPO =
  "h-[34px] w-full min-w-0 rounded-md border border-[var(--control-border)] bg-surface px-[11px] text-[12px] text-ink outline-none focus:border-[var(--border-strong)] disabled:opacity-50";

/** Sem envio do script ha mais que isso = aviso (ele roda de hora em hora). */
const ATRASO_GOOGLE_MS = 3 * 60 * 60 * 1000;

interface Props {
  contas: ContaAnuncioResumo[];
  lojas: LojaDoSeletor[];
  /** store_id -> fuso IANA da loja (do sync de pedidos). */
  fusos: Record<string, string>;
  erroFuso: string | null;
  /** Relogio do servidor: o mesmo no HTML e na hidratacao. */
  agoraMs: number;
}

type RespostaApi = { ok?: boolean; erro?: string; error?: string } & Record<string, unknown>;

/** fetch para a propria API. Erro de rede ou HTTP vira { ok: false, erro }. */
async function chamar<T extends object = RespostaApi>(
  url: string,
  init: RequestInit
): Promise<T & { ok: boolean; erro?: string }> {
  try {
    const r = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init.headers || {}) },
    });
    const corpo = (await r.json().catch(() => ({}))) as RespostaApi;
    if (!r.ok || corpo.ok === false) {
      return {
        ...(corpo as T),
        ok: false,
        erro: String(corpo.erro || corpo.error || `Falhou (HTTP ${r.status}).`),
      };
    }
    return { ...(corpo as T), ok: true };
  } catch {
    return { ok: false, erro: "Sem conexão com o servidor." } as unknown as T & {
      ok: boolean;
      erro?: string;
    };
  }
}

/**
 * 1234567890 -> 123-456-7890, como o Google Ads mostra. Copia de
 * google-ingest.ts: aquele arquivo importa node:crypto e nao entra no bundle
 * do navegador.
 */
function formatarCustomerId(id: string): string {
  return /^\d{10}$/.test(id) ? `${id.slice(0, 3)}-${id.slice(3, 6)}-${id.slice(6)}` : id;
}

function dominioCurto(d: string): string {
  return d.replace(/\.myshopify\.com$/i, "");
}

function rotuloLoja(l: LojaDoSeletor): string {
  return `${l.nome} · ${dominioCurto(l.dominio)}`;
}

/**
 * Hora no fuso do NAVEGADOR. O servidor renderiza em UTC, entao o texto pode
 * diferir na hidratacao -- suppressHydrationWarning cobre so este texto.
 */
function Hora({ iso, comDia = false }: { iso: string; comDia?: boolean }) {
  const d = new Date(iso);
  const texto = comDia
    ? d.toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return <span suppressHydrationWarning>{texto}</span>;
}

// ---------------------------------------------------------------------------
// Pecas compartilhadas
// ---------------------------------------------------------------------------

function CabecalhoSecao({
  plataforma,
  titulo,
  acao,
}: {
  plataforma: "meta" | "google";
  titulo: string;
  acao?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <TagPlataforma plataforma={plataforma} />
      <h2 className="text-[15px] font-semibold text-ink">{titulo}</h2>
      <span aria-hidden className="hidden h-px flex-1 bg-border sm:block" />
      {acao}
    </div>
  );
}

function Passos({ itens }: { itens: ReactNode[] }) {
  return (
    <ol className="flex flex-col gap-1.5 text-[12.5px] leading-relaxed text-t2">
      {itens.map((item, i) => (
        <li key={i} className="flex gap-2">
          <span className="mt-px inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 text-[10.5px] font-semibold text-t2">
            {i + 1}
          </span>
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ol>
  );
}

/** Liga a conta a uma loja (PATCH). Sem loja, o gasto nao entra no Lucro. */
function SelectLoja({
  conta,
  lojas,
  onMudou,
}: {
  conta: ContaAnuncioResumo;
  lojas: LojaDoSeletor[];
  onMudou: () => void;
}) {
  const [salvando, setSalvando] = useState(false);
  async function mudar(valor: string) {
    setSalvando(true);
    const r = await chamar(`${ROTAS.apiContas}/${conta.id}`, {
      method: "PATCH",
      body: JSON.stringify({ store_id: valor || null }),
    });
    setSalvando(false);
    if (!r.ok) {
      toast.error(r.erro);
      return;
    }
    toast.success(valor ? "Conta ligada à loja." : "Conta desligada da loja.");
    onMudou();
  }
  return (
    <select
      aria-label="Loja da conta"
      value={conta.store_id ?? ""}
      disabled={salvando}
      onChange={(e) => mudar(e.target.value)}
      className={cn(CAMPO, "h-[30px] lg:max-w-[240px]")}
    >
      <option value="">— sem loja —</option>
      {lojas.map((l) => (
        <option key={l.id} value={l.id}>
          {rotuloLoja(l)}
        </option>
      ))}
    </select>
  );
}

function AvisoFuso({
  conta,
  fusos,
}: {
  conta: ContaAnuncioResumo;
  fusos: Record<string, string>;
}) {
  const fusoLoja = conta.store_id ? fusos[conta.store_id] : undefined;
  if (!conta.fuso || !fusoLoja || conta.fuso === fusoLoja) return null;
  return (
    <Aviso
      tom="warn"
      titulo={`O dia do gasto segue o fuso da conta (${conta.fuso}); a loja usa ${fusoLoja}.`}
      detalhe="O dia a dia pode desalinhar algumas horas. O total do período não muda."
    />
  );
}

function PainelScript({
  titulo,
  script,
  onFechar,
}: {
  titulo: string;
  script: string;
  onFechar: () => void;
}) {
  async function copiar() {
    try {
      await navigator.clipboard.writeText(script);
      toast.success("Script copiado. Cole no Google Ads.");
    } catch {
      toast.error("O navegador não deixou copiar. Selecione o texto e copie à mão.");
    }
  }
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-surface p-3.5 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[13px] font-semibold text-ink">{titulo}</p>
        <span aria-hidden className="hidden flex-1 sm:block" />
        <Button size="sm" onClick={copiar} className="w-full sm:w-auto">
          <Copy className="h-3.5 w-3.5" />
          Copiar script
        </Button>
        <Button size="sm" variant="outline" onClick={onFechar} className="w-full sm:w-auto">
          Já colei
        </Button>
      </div>
      <Aviso
        tom="warn"
        titulo="Este script contém o segredo desta conta e não aparece de novo."
        detalhe="Perdeu? Gere outro — o anterior para de funcionar."
      />
      <pre className="max-h-[320px] overflow-auto rounded-lg border border-border bg-surface-2 p-3 font-mono text-[11.5px] leading-relaxed text-ink">
        {script}
      </pre>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

function statusMeta(c: ContaAnuncioResumo): ReactNode {
  if (c.ultimo_erro) {
    return (
      <Selo tom="err" title={c.ultimo_erro}>
        erro
      </Selo>
    );
  }
  if (!c.store_id) return <Selo tom="warn">sem loja</Selo>;
  if (!c.temSegredo) return <Selo tom="warn">sem token</Selo>;
  if (!c.ativo) return <Selo tom="neutro">pausada</Selo>;
  if (c.ultimo_sync_ok_em) {
    return (
      <Selo tom="ok">
        atualizado <Hora iso={c.ultimo_sync_ok_em} />
      </Selo>
    );
  }
  return <Selo tom="neutro">aguardando a 1ª leitura</Selo>;
}

function FormMeta({ semConta, onConectou }: { semConta: boolean; onConectou: () => void }) {
  const [token, setToken] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function conectar(e: FormEvent) {
    e.preventDefault();
    const t = token.trim();
    if (!t) return;
    setEnviando(true);
    const r = await chamar<MetaConectarResposta>(ROTAS.apiMetaConectar, {
      method: "POST",
      body: JSON.stringify({ token: t }),
    });
    setEnviando(false);
    if (!r.ok) {
      toast.error(r.erro || "O Meta recusou o token.");
      return;
    }
    const n = "contas" in r && Array.isArray(r.contas) ? r.contas.length : 0;
    toast.success(
      n === 1 ? "1 conta de anúncio conectada." : `${n} contas de anúncio conectadas.`
    );
    setToken("");
    onConectou();
  }

  return (
    <form
      onSubmit={conectar}
      className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3.5 sm:p-4"
    >
      {semConta && (
        <Passos
          itens={[
            <>
              No <b className="font-semibold text-ink">Business Manager</b>, abra{" "}
              <b className="font-semibold text-ink">Usuários do sistema</b> e escolha um (no
              nível Limited, o portfólio permite 1 comum + 1 admin).
            </>,
            <>
              <b className="font-semibold text-ink">Atribuir ativos</b> &gt; Contas de anúncio
              &gt; marque cada conta com <b className="font-semibold text-ink">Ver desempenho</b>.
            </>,
            <>
              <b className="font-semibold text-ink">Gerar novo token</b>: escolha o app,
              validade <b className="font-semibold text-ink">Nunca</b> e só a permissão{" "}
              <code className="font-mono text-[11.5px]">ads_read</code>. Este token NÃO
              substitui o do CAPI do rastreamento.
            </>,
            <>Cole o token abaixo. As contas que ele enxerga aparecem sozinhas.</>,
          ]}
        />
      )}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="meta-token" className="text-[12px] font-medium text-ink">
          Token do usuário do sistema
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="meta-token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="EAAG…"
            className={cn(CAMPO, "font-mono")}
          />
          <Button type="submit" size="sm" disabled={!token.trim() || enviando} className="sm:w-auto">
            {enviando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Conectar
          </Button>
        </div>
        <p className="text-[11.5px] text-t3">
          O token fica guardado só no servidor e só lê desempenho — não gasta nem edita
          campanha.
        </p>
      </div>
    </form>
  );
}

function LinhaContaMeta({
  conta,
  lojas,
  fusos,
  onMudou,
}: {
  conta: ContaAnuncioResumo;
  lojas: LojaDoSeletor[];
  fusos: Record<string, string>;
  onMudou: () => void;
}) {
  const [salvando, setSalvando] = useState(false);
  async function alternar(ativo: boolean) {
    setSalvando(true);
    const r = await chamar(`${ROTAS.apiContas}/${conta.id}`, {
      method: "PATCH",
      body: JSON.stringify({ ativo }),
    });
    setSalvando(false);
    if (!r.ok) {
      toast.error(r.erro);
      return;
    }
    toast.success(ativo ? "Conta ativada." : "Conta pausada: o gasto dela não é mais lido.");
    onMudou();
  }

  return (
    <div className="flex flex-col gap-2 border-b border-border px-3.5 py-3 last:border-b-0">
      <div className="flex flex-col gap-2 lg:grid lg:grid-cols-[minmax(0,1fr)_120px_240px_70px_auto] lg:items-center lg:gap-3">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-ink">
            {conta.nome || "Conta sem nome"}
          </p>
          <p className="font-mono text-[11px] text-t3">act_{conta.external_id}</p>
        </div>
        <p className="text-[11.5px] text-t2">
          {conta.moeda || "—"}
          <span className="block truncate text-t3">{conta.fuso || "fuso ainda não lido"}</span>
        </p>
        <SelectLoja conta={conta} lojas={lojas} onMudou={onMudou} />
        <label className="flex items-center gap-1.5 text-[12px] text-t2">
          <input
            type="checkbox"
            checked={conta.ativo}
            disabled={salvando}
            onChange={(e) => alternar(e.target.checked)}
            className="h-3.5 w-3.5 accent-[var(--brand)]"
          />
          Ativa
        </label>
        <div className="lg:justify-self-end">{statusMeta(conta)}</div>
      </div>
      {conta.ultimo_erro && (
        <p className="text-[11.5px] text-[var(--err)]">{conta.ultimo_erro}</p>
      )}
      <AvisoFuso conta={conta} fusos={fusos} />
    </div>
  );
}

function SecaoMeta({
  contas,
  lojas,
  fusos,
  onMudou,
}: {
  contas: ContaAnuncioResumo[];
  lojas: LojaDoSeletor[];
  fusos: Record<string, string>;
  onMudou: () => void;
}) {
  const [trocando, setTrocando] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const semConta = contas.length === 0;

  async function sincronizar() {
    setSincronizando(true);
    const r = await chamar<SyncResposta>(ROTAS.apiSyncMeta, { method: "POST" });
    setSincronizando(false);
    const erros = Array.isArray(r.erros) ? r.erros : [];
    if (!r.ok && erros.length === 0) {
      toast.error(r.erro || "Não deu para sincronizar agora.");
    } else if (erros.length > 0) {
      toast.warning(
        `${r.processadas ?? 0} conta(s) atualizada(s), ${erros.length} com erro: ${erros[0]}`
      );
    } else {
      toast.success(`${r.processadas ?? 0} conta(s) atualizada(s).`);
    }
    onMudou();
  }

  return (
    <section className="flex flex-col gap-3">
      <CabecalhoSecao
        plataforma="meta"
        titulo="Meta Ads"
        acao={
          !semConta && (
            <div className="flex w-full flex-wrap gap-2 sm:w-auto">
              <Button
                size="sm"
                variant="outline"
                onClick={sincronizar}
                disabled={sincronizando}
                className="flex-1 sm:flex-none"
              >
                {sincronizando ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Sincronizar agora
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setTrocando((v) => !v)}
                className="flex-1 sm:flex-none"
              >
                {trocando ? "Cancelar" : "Trocar token"}
              </Button>
            </div>
          )
        }
      />

      {(semConta || trocando) && (
        <FormMeta
          semConta={semConta}
          onConectou={() => {
            setTrocando(false);
            onMudou();
          }}
        />
      )}

      {!semConta && (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <div className="hidden grid-cols-[minmax(0,1fr)_120px_240px_70px_auto] gap-3 border-b border-border bg-surface-2 px-3.5 py-2 text-[11px] font-semibold text-t3 lg:grid">
            <span>Conta</span>
            <span>Moeda e fuso</span>
            <span>Loja</span>
            <span>Leitura</span>
            <span className="text-right">Estado</span>
          </div>
          {contas.map((c) => (
            <LinhaContaMeta key={c.id} conta={c} lojas={lojas} fusos={fusos} onMudou={onMudou} />
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Google
// ---------------------------------------------------------------------------

function statusGoogle(c: ContaAnuncioResumo, agoraMs: number): ReactNode {
  if (c.ultimo_erro) {
    return (
      <Selo tom="err" title={c.ultimo_erro}>
        erro
      </Selo>
    );
  }
  if (!c.store_id) return <Selo tom="warn">sem loja</Selo>;
  if (!c.ativo) return <Selo tom="neutro">pausada</Selo>;
  if (!c.ultimo_sync_ok_em) return <Selo tom="warn">o script não enviou ainda</Selo>;
  const atraso = agoraMs - Date.parse(c.ultimo_sync_ok_em);
  if (atraso > ATRASO_GOOGLE_MS) {
    const horas = Math.floor(atraso / 3_600_000);
    return (
      <Selo tom="warn" title="O script roda de hora em hora: confira o agendamento no Google Ads.">
        sem envio há {horas >= 48 ? `${Math.floor(horas / 24)} dias` : `${horas} h`}
      </Selo>
    );
  }
  return (
    <Selo tom="ok">
      recebido <Hora iso={c.ultimo_sync_ok_em} />
    </Selo>
  );
}

function FormGoogle({
  lojas,
  onCriou,
}: {
  lojas: LojaDoSeletor[];
  onCriou: (titulo: string, script: string) => void;
}) {
  const [customerId, setCustomerId] = useState("");
  const [lojaId, setLojaId] = useState(lojas.length === 1 ? lojas[0].id : "");
  const [nome, setNome] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function criar(e: FormEvent) {
    e.preventDefault();
    if (!customerId.trim() || !lojaId) return;
    setEnviando(true);
    const r = await chamar<GoogleContaCriadaResposta>(ROTAS.apiGoogleContas, {
      method: "POST",
      body: JSON.stringify({ customer_id: customerId.trim(), store_id: lojaId, nome: nome.trim() || null }),
    });
    setEnviando(false);
    if (!r.ok || !("script" in r)) {
      toast.error(r.erro || "Não deu para cadastrar a conta.");
      return;
    }
    toast.success("Conta cadastrada. Agora cole o script no Google Ads.");
    setCustomerId("");
    setNome("");
    onCriou(
      `Script da conta ${formatarCustomerId(r.conta.external_id)}${r.conta.nome ? ` · ${r.conta.nome}` : ""}`,
      r.script
    );
  }

  return (
    <form
      onSubmit={criar}
      className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-surface p-3.5 sm:p-4 md:grid-cols-[170px_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end"
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor="g-cid" className="text-[12px] font-medium text-ink">
          ID de cliente
        </label>
        <input
          id="g-cid"
          inputMode="numeric"
          autoComplete="off"
          value={customerId}
          onChange={(e) => setCustomerId(e.target.value)}
          placeholder="123-456-7890"
          className={cn(CAMPO, "font-mono")}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor="g-loja" className="text-[12px] font-medium text-ink">
          Loja
        </label>
        <select
          id="g-loja"
          value={lojaId}
          onChange={(e) => setLojaId(e.target.value)}
          className={CAMPO}
        >
          <option value="">Escolha a loja…</option>
          {lojas.map((l) => (
            <option key={l.id} value={l.id}>
              {rotuloLoja(l)}
            </option>
          ))}
        </select>
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor="g-nome" className="text-[12px] font-medium text-ink">
          Nome <span className="font-normal text-t3">(opcional)</span>
        </label>
        <input
          id="g-nome"
          autoComplete="off"
          maxLength={120}
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Ex.: Google Lash Bestie"
          className={CAMPO}
        />
      </div>
      <Button type="submit" size="sm" disabled={!customerId.trim() || !lojaId || enviando}>
        {enviando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        Gerar script
      </Button>
    </form>
  );
}

function LinhaContaGoogle({
  conta,
  lojas,
  fusos,
  agoraMs,
  onMudou,
  onScript,
}: {
  conta: ContaAnuncioResumo;
  lojas: LojaDoSeletor[];
  fusos: Record<string, string>;
  agoraMs: number;
  onMudou: () => void;
  onScript: (titulo: string, script: string) => void;
}) {
  const [ocupado, setOcupado] = useState<null | "segredo" | "remover">(null);
  const idFormatado = formatarCustomerId(conta.external_id);

  async function novoScript() {
    if (
      !confirm(
        `Gerar um novo script para a conta ${idFormatado}?\n\nO script colado hoje no Google Ads para de funcionar — você vai precisar colar o novo no lugar dele.`
      )
    ) {
      return;
    }
    setOcupado("segredo");
    const r = await chamar<{ segredo?: string; script?: string }>(
      `${ROTAS.apiGoogleContas}/${conta.id}/segredo`,
      { method: "POST" }
    );
    setOcupado(null);
    if (!r.ok || !r.script) {
      toast.error(r.erro || "Não deu para gerar o script.");
      return;
    }
    toast.success("Script novo gerado. Substitua o antigo no Google Ads.");
    onScript(`Script novo da conta ${idFormatado}${conta.nome ? ` · ${conta.nome}` : ""}`, r.script);
  }

  async function remover() {
    if (
      !confirm(
        `Remover a conta ${idFormatado}?\n\nO gasto já gravado dela sai do Lucro e o script colado no Google Ads para de ser aceito.`
      )
    ) {
      return;
    }
    setOcupado("remover");
    const r = await chamar(`${ROTAS.apiContas}/${conta.id}`, { method: "DELETE" });
    setOcupado(null);
    if (!r.ok) {
      toast.error(r.erro);
      return;
    }
    toast.success("Conta removida.");
    onMudou();
  }

  return (
    <div className="flex flex-col gap-2 border-b border-border px-3.5 py-3 last:border-b-0">
      <div className="flex flex-col gap-2 lg:grid lg:grid-cols-[minmax(0,1fr)_240px_130px_auto] lg:items-center lg:gap-3">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-ink">
            {conta.nome || "Conta sem nome"}
          </p>
          <p className="font-mono text-[11px] text-t3">
            {idFormatado}
            {conta.moeda ? ` · ${conta.moeda}` : ""}
          </p>
        </div>
        <SelectLoja conta={conta} lojas={lojas} onMudou={onMudou} />
        <p className="text-[11.5px] text-t2">
          <span className="block text-t3">Último envio</span>
          {conta.ultimo_sync_ok_em ? <Hora iso={conta.ultimo_sync_ok_em} comDia /> : "nunca"}
        </p>
        <div className="flex flex-wrap items-center gap-2 lg:justify-self-end">
          {statusGoogle(conta, agoraMs)}
          <Button
            size="xs"
            variant="outline"
            onClick={novoScript}
            disabled={ocupado !== null}
          >
            {ocupado === "segredo" && <Loader2 className="h-3 w-3 animate-spin" />}
            Gerar novo script
          </Button>
          <Button
            size="xs"
            variant="destructive"
            onClick={remover}
            disabled={ocupado !== null}
            aria-label={`Remover a conta ${idFormatado}`}
          >
            {ocupado === "remover" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Trash2 className="h-3 w-3" />
            )}
            Remover
          </Button>
        </div>
      </div>
      {conta.ultimo_erro && (
        <p className="text-[11.5px] text-[var(--err)]">{conta.ultimo_erro}</p>
      )}
      <AvisoFuso conta={conta} fusos={fusos} />
    </div>
  );
}

function SecaoGoogle({
  contas,
  lojas,
  fusos,
  agoraMs,
  onMudou,
}: {
  contas: ContaAnuncioResumo[];
  lojas: LojaDoSeletor[];
  fusos: Record<string, string>;
  agoraMs: number;
  onMudou: () => void;
}) {
  const [script, setScript] = useState<{ titulo: string; texto: string } | null>(null);
  const [adicionando, setAdicionando] = useState(false);
  const mostrarForm = contas.length === 0 || adicionando;

  function mostrarScript(titulo: string, texto: string) {
    setScript({ titulo, texto });
    setAdicionando(false);
    onMudou();
  }

  return (
    <section className="flex flex-col gap-3">
      <CabecalhoSecao
        plataforma="google"
        titulo="Google Ads"
        acao={
          contas.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAdicionando((v) => !v)}
              className="w-full sm:w-auto"
            >
              {adicionando ? "Cancelar" : "Adicionar conta"}
            </Button>
          )
        }
      />

      {mostrarForm && (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-2 p-3.5 sm:p-4">
          <Passos
            itens={[
              <>
                Pegue o <b className="font-semibold text-ink">ID de CLIENTE</b> (123-456-7890),
                no topo do Google Ads. Não é o AW-… do rastreamento.
              </>,
              <>Escolha a loja e gere o script.</>,
              <>
                No Google Ads: <b className="font-semibold text-ink">Ferramentas</b> &gt; Ações em
                massa &gt; <b className="font-semibold text-ink">Scripts</b> &gt; + &gt; Novo
                script. Cole, clique em Autorizar, depois Visualizar e Salvar.
              </>,
              <>
                Em Frequência, escolha <b className="font-semibold text-ink">De hora em hora</b>.
                Se essa opção não aparecer na sua conta, use a menor disponível e nos avise — a
                documentação do Google não confirma o agendamento por hora.
              </>,
            ]}
          />
          <FormGoogle lojas={lojas} onCriou={mostrarScript} />
        </div>
      )}

      {script && (
        <PainelScript titulo={script.titulo} script={script.texto} onFechar={() => setScript(null)} />
      )}

      {contas.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          {contas.map((c) => (
            <LinhaContaGoogle
              key={c.id}
              conta={c}
              lojas={lojas}
              fusos={fusos}
              agoraMs={agoraMs}
              onMudou={onMudou}
              onScript={mostrarScript}
            />
          ))}
        </div>
      )}

      <p className="text-[11.5px] leading-relaxed text-t3">
        Sem script, pela API do Google: quando o nível Explorer do seu projeto no Google
        Cloud for aprovado, trocamos o script por leitura automática a cada 15 min, sem
        colar nada em cada conta.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Tela
// ---------------------------------------------------------------------------

export function AnunciosScreen({ contas, lojas, fusos, erroFuso, agoraMs }: Props) {
  const router = useRouter();
  const [pendente, startTransition] = useTransition();
  const atualizar = () => startTransition(() => router.refresh());

  const meta = contas.filter((c) => c.plataforma === "meta");
  const google = contas.filter((c) => c.plataforma === "google");
  const semLojaCount = contas.filter((c) => !c.store_id).length;

  if (lojas.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border-strong)] bg-surface px-6 py-10 text-center">
        <p className="text-[14px] font-semibold text-ink">Conecte uma loja primeiro</p>
        <p className="mx-auto mt-1 max-w-[52ch] text-[12.5px] text-t2">
          O gasto de cada conta de anúncio é somado ao Lucro de uma loja. Sem loja
          conectada, não há onde ligar a conta.
        </p>
        <Link
          href="/stores"
          className="mt-4 inline-flex h-9 items-center rounded-md bg-action px-3 text-[13px] font-semibold text-action-foreground"
        >
          Conectar loja
        </Link>
      </div>
    );
  }

  return (
    <div
      className={cn("flex flex-col gap-7 transition-opacity", pendente && "opacity-60")}
      aria-busy={pendente}
    >
      {semLojaCount > 0 && (
        <Aviso
          tom="warn"
          titulo={
            semLojaCount === 1
              ? "1 conta sem loja: o gasto dela não entra no Lucro."
              : `${semLojaCount} contas sem loja: o gasto delas não entra no Lucro.`
          }
          detalhe="Escolha a loja de cada uma na lista abaixo."
        />
      )}
      {erroFuso && (
        <p className="rounded-lg border border-border bg-surface-2 px-3.5 py-2.5 text-[12px] text-t2">
          Não deu para conferir o fuso das lojas ({erroFuso}). O aviso de fuso diferente
          fica de fora até a próxima carga.
        </p>
      )}
      <SecaoMeta contas={meta} lojas={lojas} fusos={fusos} onMudou={atualizar} />
      <SecaoGoogle
        contas={google}
        lojas={lojas}
        fusos={fusos}
        agoraMs={agoraMs}
        onMudou={atualizar}
      />
    </div>
  );
}
