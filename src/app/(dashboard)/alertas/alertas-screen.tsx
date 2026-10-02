"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { BellOff, ChevronRight, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AlertasDaTela } from "@/lib/alertas/queries";
import {
  ROTAS,
  ROTULO_REGRA,
  type AlertaRow,
  type RegraAlerta,
} from "@/lib/financeiro/tipos";
import { cn } from "@/lib/utils";
import { Aviso, Selo } from "../tracking/selo";

// ============================================================================
// Tela de alertas: o que esta aberto agora, o canal do Telegram e o historico
// curto. O cron (*/10) e quem abre e fecha; a tela so le e silencia.
// ============================================================================

const FOCO =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/40";

/** Quando cada regra dispara -- o mesmo limite que o cron usa. */
const REGRAS_EXPLICADAS: { regra: RegraAlerta; quando: string }[] = [
  {
    regra: "app_desinstalado",
    quando:
      "Crítico. A loja desinstalou o app, mas o rastreamento dela continua ligado no xcart.",
  },
  {
    regra: "meta_capi_token",
    quando:
      "Crítico. Na última hora, o Meta recusou eventos com o erro 190 (token do CAPI vencido ou revogado).",
  },
  {
    regra: "envio_falhando",
    quando:
      "Crítico. Na última hora, alguma compra falhou de vez no envio para o Google ou o Meta.",
  },
  {
    regra: "fila_travada",
    quando:
      "Crítico. Há eventos esperando envio há mais de 30 min: o cron de envio parece parado.",
  },
  {
    regra: "pedidos_sync_erro",
    quando:
      "Aviso. A leitura de pedidos da Shopify deu erro ou não roda com sucesso há mais de 2 h.",
  },
  {
    regra: "ads_sync_atrasado",
    quando:
      "Crítico. A conta de anúncio ligada a uma loja deu erro ou está sem gasto novo há mais de 90 min (Meta) ou 3 h (Google).",
  },
  {
    regra: "gastou_sem_vender",
    quando:
      "Crítico. Hoje (no fuso da conta) o gasto já passou do mínimo configurado abaixo e a loja não tem nenhuma venda paga — só com gasto e pedidos atualizados nos últimos 45 min.",
  },
];

function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`;
}

function haQuanto(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} d`;
}

function dataCurta(iso: string): string {
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso.slice(0, 16);
  }
}

function Secao({
  titulo,
  direita,
  children,
}: {
  titulo: string;
  direita?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[14px] font-semibold text-ink">{titulo}</h2>
        {direita}
      </div>
      {children}
    </section>
  );
}

export function AlertasScreen({ dados }: { dados: AlertasDaTela }) {
  const lojaPorId = new Map(dados.lojas.map((l) => [l.id, l]));
  const nomeDaLoja = (id: string | null) => {
    if (!id) return "Todas as lojas";
    const l = lojaPorId.get(id);
    if (!l) return "Loja removida";
    const dominio = l.dominio.replace(/\.myshopify\.com$/i, "");
    return l.nome && l.nome !== l.dominio ? `${l.nome} · ${dominio}` : dominio;
  };

  return (
    <div className="flex flex-col gap-6">
      {dados.erro && <Aviso tom="err" titulo="Algo deu errado" detalhe={dados.erro} />}

      <Secao
        titulo="Abertos"
        direita={
          dados.abertos.length > 0 ? (
            <Selo tom={dados.abertos.some((a) => a.severidade === "critico") ? "err" : "warn"}>
              {plural(dados.abertos.length, "aberto", "abertos")}
            </Selo>
          ) : undefined
        }
      >
        {dados.abertos.length === 0 ? (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface px-4 py-3.5">
            <Selo tom="ok">Nada aberto</Selo>
            <p className="text-[12.5px] text-t2">
              Nenhum problema nas vendas, no rastreamento ou no gasto agora. O xcart confere
              a cada 10 min.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {dados.abertos.map((a) => (
              <CartaoAlerta key={a.id} alerta={a} loja={nomeDaLoja(a.store_id)} />
            ))}
          </div>
        )}
      </Secao>

      <CanalTelegram dados={dados} />

      <Secao titulo="Resolvidos (7 dias)">
        {dados.resolvidos.length === 0 ? (
          <p className="rounded-xl border border-border bg-surface px-4 py-3 text-[12.5px] text-t3">
            Nenhum alerta resolvido nos últimos 7 dias.
          </p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
            {dados.resolvidos.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-4 py-2 text-[12px]"
              >
                <span className="min-w-0 flex-1 truncate font-medium text-ink">{r.titulo}</span>
                <span className="min-w-0 max-w-full truncate text-t3">{nomeDaLoja(r.store_id)}</span>
                <span className="shrink-0 text-t3" suppressHydrationWarning>
                  {r.resolvido_em ? `resolvido ${dataCurta(r.resolvido_em)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Secao>

      <details className="group">
        <summary
          className={cn(
            "flex cursor-pointer list-none items-center gap-1 text-[12px] font-medium text-t2 hover:text-ink [&::-webkit-details-marker]:hidden",
            FOCO
          )}
        >
          <ChevronRight aria-hidden className="h-3 w-3 transition-transform group-open:rotate-90" />
          Regras
        </summary>
        <ul className="mt-2 flex max-w-[80ch] flex-col gap-1.5 rounded-lg border border-border bg-surface-2 p-3 text-[12px] leading-relaxed text-t2">
          {REGRAS_EXPLICADAS.map((r) => (
            <li key={r.regra}>
              <span className="font-medium text-ink">{ROTULO_REGRA[r.regra]}:</span> {r.quando}
            </li>
          ))}
          <li className="mt-1 text-t3">
            Um alerta abre uma vez e fecha depois de duas conferências seguidas sem o problema.
            Crítico é reenviado a cada 6 h enquanto continuar aberto; aviso, só quando abre.
          </li>
        </ul>
      </details>
    </div>
  );
}

function CartaoAlerta({ alerta, loja }: { alerta: AlertaRow; loja: string }) {
  const router = useRouter();
  const [salvando, setSalvando] = useState(false);
  const silenciado =
    !!alerta.silenciado_ate && new Date(alerta.silenciado_ate).getTime() > Date.now();
  const critico = alerta.severidade === "critico";

  async function silenciar(horas: number) {
    setSalvando(true);
    try {
      const r = await fetch(`${ROTAS.apiAlertas}/${alerta.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ silenciar_horas: horas }),
      });
      const j = (await r.json().catch(() => null)) as { ok?: boolean; erro?: string } | null;
      if (!r.ok || !j?.ok) throw new Error(j?.erro || `Falha (${r.status})`);
      toast.success(horas === 0 ? "Alerta reativado." : "Silenciado por 24 h.");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível silenciar.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <article
      className={cn(
        "flex flex-col gap-1.5 rounded-xl border bg-surface px-4 py-3",
        critico ? "border-[var(--err-border)]" : "border-[var(--warn-border)]"
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Selo tom={critico ? "err" : "warn"}>{critico ? "Crítico" : "Aviso"}</Selo>
        <span className="text-[11.5px] font-medium text-t2">{ROTULO_REGRA[alerta.regra] ?? alerta.regra}</span>
        {silenciado && (
          <Selo tom="neutro" title={`até ${dataCurta(alerta.silenciado_ate!)}`}>
            Silenciado
          </Selo>
        )}
      </div>
      <h3 className="text-[13.5px] font-semibold text-ink">{alerta.titulo}</h3>
      <p className="truncate text-[11.5px] text-t3">{loja}</p>
      {alerta.detalhe && (
        <p className="break-words text-[12.5px] leading-relaxed text-t2">{alerta.detalhe}</p>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11.5px] text-t3">
        <span suppressHydrationWarning>aberto há {haQuanto(alerta.aberto_em)}</span>
        <span>
          {alerta.n_notificacoes > 0
            ? `notificado ${plural(alerta.n_notificacoes, "vez", "vezes")}`
            : "ainda não notificado"}
        </span>
        <button
          type="button"
          disabled={salvando}
          onClick={() => silenciar(silenciado ? 0 : 24)}
          className={cn(
            "inline-flex h-8 w-full items-center justify-center gap-1 rounded-[5px] border border-border bg-surface px-2.5 text-[11.5px] font-semibold text-t2 hover:border-[var(--border-strong)] hover:text-ink disabled:opacity-50 sm:ml-auto sm:h-7 sm:w-auto",
            FOCO
          )}
        >
          {salvando ? (
            <Loader2 aria-hidden className="h-3 w-3 animate-spin" />
          ) : (
            <BellOff aria-hidden className="h-3 w-3" />
          )}
          {silenciado ? "Reativar aviso" : "Silenciar 24 h"}
        </button>
      </div>
    </article>
  );
}

function CanalTelegram({ dados }: { dados: AlertasDaTela }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const [token, setToken] = useState("");
  const [chatId, setChatId] = useState(dados.config.telegram_chat_id ?? "");
  const [ativo, setAtivo] = useState(dados.config.ativo);
  const [avisos, setAvisos] = useState(dados.config.receber_avisos);
  const [minimo, setMinimo] = useState(String(dados.config.gasto_sem_venda_min ?? 30));
  const [acao, setAcao] = useState<"salvar" | "testar" | null>(null);

  const conectado = !!dados.config.telegram_chat_id && dados.temToken;

  async function enviar(testar: boolean) {
    setAcao(testar ? "testar" : "salvar");
    try {
      const r = await fetch(`${ROTAS.apiAlertasCanal}${testar ? "?testar=1" : ""}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId.trim() || null,
          bot_token: token.trim() || null,
          ativo,
          receber_avisos: avisos,
          gasto_sem_venda_min: Number(minimo.replace(",", ".")),
        }),
      });
      const j = (await r.json().catch(() => null)) as { ok?: boolean; erro?: string } | null;
      if (!r.ok || !j?.ok) {
        // No teste, a config ja foi salva antes do envio: atualiza a tela mesmo
        // quando o Telegram recusa.
        if (r.ok) iniciar(() => router.refresh());
        throw new Error(j?.erro || `Falha (${r.status})`);
      }
      setToken("");
      toast.success(testar ? "Mensagem de teste enviada. Confira o Telegram." : "Alertas salvos.");
      iniciar(() => router.refresh());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setAcao(null);
    }
  }

  const ocupado = acao !== null || pendente;

  return (
    <Secao
      titulo="Telegram"
      direita={
        conectado ? (
          <Selo tom="ok">Conectado</Selo>
        ) : (
          <Selo tom="neutro">Não configurado</Selo>
        )
      }
    >
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface px-4 py-3.5">
        {!conectado && (
          <ol className="flex list-decimal flex-col gap-1 pl-5 text-[12.5px] leading-relaxed text-t2">
            <li>
              No Telegram, abra o <span className="font-mono text-ink">@BotFather</span> e mande{" "}
              <span className="font-mono text-ink">/newbot</span>.
            </li>
            <li>
              Dê um nome e um username terminando em <span className="font-mono text-ink">bot</span>.
            </li>
            <li>Copie o token que ele mandar.</li>
            <li>
              Abra a conversa com o seu bot e mande <span className="font-mono text-ink">/start</span>{" "}
              (para um grupo, adicione o bot ao grupo e mande uma mensagem lá).
            </li>
            <li>
              Abra no navegador{" "}
              <span className="break-all font-mono text-ink">
                https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates
              </span>{" "}
              e copie o número em <span className="font-mono text-ink">chat.id</span> (de grupo é
              negativo).
            </li>
            <li>Cole abaixo e clique em Testar.</li>
          </ol>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="alerta-token" className="text-[11px] text-t2">
              Token do bot
            </Label>
            <Input
              id="alerta-token"
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={dados.temToken ? "deixe vazio para manter" : "123456789:AA…"}
              className="h-8 font-mono text-xs"
            />
            <p className="text-[10.5px] text-t3">
              {dados.tokenDaEnv
                ? "usando o bot padrão da instalação; cole um token para usar o seu"
                : dados.temToken
                  ? "token salvo — só aparece aqui como salvo, nunca de volta"
                  : "fica guardado no servidor e nunca volta para a tela"}
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="alerta-chat" className="text-[11px] text-t2">
              Chat id
            </Label>
            <Input
              id="alerta-chat"
              inputMode="numeric"
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
              placeholder="123456789 ou -100123456789"
              className="h-8 font-mono text-xs"
            />
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <label className="flex min-h-9 items-center gap-2 rounded-lg border border-border px-3 text-[12.5px] text-t2">
            <input
              type="checkbox"
              checked={ativo}
              onChange={(e) => setAtivo(e.target.checked)}
              className="h-4 w-4 accent-[var(--brand)]"
            />
            Alertas ligados
          </label>
          <label className="flex min-h-9 items-center gap-2 rounded-lg border border-border px-3 text-[12.5px] text-t2">
            <input
              type="checkbox"
              checked={avisos}
              onChange={(e) => setAvisos(e.target.checked)}
              className="h-4 w-4 accent-[var(--brand)]"
            />
            Receber avisos (não só críticos)
          </label>
        </div>

        <div className="max-w-[360px] space-y-1">
          <Label htmlFor="alerta-minimo" className="text-[11px] text-t2">
            Gasto mínimo para alertar &quot;gastou sem vender&quot; (moeda da conta)
          </Label>
          <Input
            id="alerta-minimo"
            inputMode="decimal"
            value={minimo}
            onChange={(e) => setMinimo(e.target.value)}
            className="h-8 w-[140px] font-mono text-xs"
          />
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button size="sm" disabled={ocupado} onClick={() => enviar(false)}>
            {acao === "salvar" && <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />}
            Salvar
          </Button>
          <Button size="sm" variant="outline" disabled={ocupado} onClick={() => enviar(true)}>
            {acao === "testar" ? (
              <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send aria-hidden className="h-3.5 w-3.5" />
            )}
            Testar
          </Button>
        </div>
      </div>
    </Secao>
  );
}
