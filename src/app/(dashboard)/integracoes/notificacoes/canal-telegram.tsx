"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SendIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Section } from "@/components/ui/section";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { ROTAS, type AlertaConfigRow } from "@/lib/financeiro/tipos";
import { chamar } from "../api";

// ============================================================================
// O canal do Telegram, o mesmo que morava na tela de Alertas: mesma API
// (POST /api/alertas/canal, com ?testar=1 para mandar a mensagem de teste),
// mesmos campos. Mudou a apresentacao: interruptores no lugar das caixas,
// erro no campo, e a tela diz quando ha alteracao ainda nao salva.
// ============================================================================

type Config = Omit<AlertaConfigRow, "updated_at">;

const RE_CHAT = /^-?\d{1,20}$/;

function lerMinimo(texto: string): number | null {
  const n = Number(texto.trim().replace(",", "."));
  return texto.trim() !== "" && Number.isFinite(n) && n >= 0 ? n : null;
}

const PASSOS = [
  <>
    No Telegram, abra o <span className="font-mono text-ink">@BotFather</span> e mande{" "}
    <span className="font-mono text-ink">/newbot</span>.
  </>,
  <>
    Dê um nome e um usuário terminado em <span className="font-mono text-ink">bot</span>. Copie o token que
    ele mandar.
  </>,
  <>
    Abra a conversa com o seu bot e mande <span className="font-mono text-ink">/start</span>. Para um grupo,
    adicione o bot ao grupo e mande uma mensagem lá.
  </>,
  <>
    Abra no navegador{" "}
    <span className="font-mono break-all text-ink">https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</span> e
    copie o número em <span className="font-mono text-ink">chat.id</span> (de grupo, ele é negativo).
  </>,
  <>Cole o token e o número abaixo e clique em Testar.</>,
];

function Formulario({ config, temToken, tokenDaEnv }: { config: Config; temToken: boolean; tokenDaEnv: boolean }) {
  const id = useId();
  const router = useRouter();
  const [atualizando, startTransition] = useTransition();
  const [token, setToken] = useState("");
  const [chatId, setChatId] = useState(config.telegram_chat_id ?? "");
  const [ativo, setAtivo] = useState(config.ativo);
  const [avisos, setAvisos] = useState(config.receber_avisos);
  const [minimo, setMinimo] = useState(String(config.gasto_sem_venda_min ?? 30).replace(".", ","));
  const [acao, setAcao] = useState<"salvar" | "testar" | null>(null);
  const [erros, setErros] = useState<{ chat?: string; minimo?: string }>({});

  const conectado = Boolean(config.telegram_chat_id) && temToken;
  const alterado =
    token.trim() !== "" ||
    chatId.trim() !== (config.telegram_chat_id ?? "") ||
    ativo !== config.ativo ||
    avisos !== config.receber_avisos ||
    lerMinimo(minimo) !== Number(config.gasto_sem_venda_min ?? 30);

  async function enviar(testar: boolean) {
    const valorMinimo = lerMinimo(minimo);
    const novos: typeof erros = {};
    if (chatId.trim() && !RE_CHAT.test(chatId.trim())) novos.chat = "Use só o número do chat (de grupo começa com -).";
    if (testar && !chatId.trim()) novos.chat = "Cole o número do chat para testar.";
    if (valorMinimo === null) novos.minimo = "Use um número igual ou maior que zero.";
    setErros(novos);
    if (novos.chat || novos.minimo) return;

    setAcao(testar ? "testar" : "salvar");
    const r = await chamar(`${ROTAS.apiAlertasCanal}${testar ? "?testar=1" : ""}`, {
      method: "POST",
      body: JSON.stringify({
        chat_id: chatId.trim() || null,
        bot_token: token.trim() || null,
        ativo,
        receber_avisos: avisos,
        gasto_sem_venda_min: valorMinimo,
      }),
    });
    setAcao(null);
    if (!r.ok) {
      // No teste a configuracao ja foi salva antes do envio: atualiza mesmo
      // quando o Telegram recusa a mensagem.
      if (testar && r.status === 200) startTransition(() => router.refresh());
      toast.error(testar ? "O teste não chegou no Telegram" : "Não deu para salvar", { description: r.erro });
      return;
    }
    setToken("");
    toast.success(testar ? "Mensagem de teste enviada" : "Notificações salvas", {
      description: testar ? "Confira o Telegram." : undefined,
    });
    startTransition(() => router.refresh());
  }

  const ocupado = acao !== null || atualizando;

  return (
    <Section
      titulo="Telegram"
      nivel={3}
      descricao="Os alertas críticos chegam na hora e são reenviados a cada 6 h enquanto continuarem abertos."
      acoes={
        <StatusBadge tom={conectado ? "ok" : "neutral"}>{conectado ? "Conectado" : "Não configurado"}</StatusBadge>
      }
    >
      {!conectado ? (
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
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={`${id}-token`}>Token do bot</Label>
          <Input
            id={`${id}-token`}
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={temToken ? "Deixe vazio para manter" : "123456789:AA…"}
            aria-describedby={`${id}-token-ajuda`}
            className="font-mono"
          />
          <p id={`${id}-token-ajuda`} className="text-label text-t2">
            {tokenDaEnv
              ? "Usando o bot padrão do xcart. Cole um token para usar o seu."
              : temToken
                ? "Token salvo. Ele não volta para a tela."
                : "Fica guardado só no servidor e nunca volta para a tela."}
          </p>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={`${id}-chat`}>Número do chat</Label>
          <Input
            id={`${id}-chat`}
            inputMode="numeric"
            autoComplete="off"
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
            placeholder="123456789 ou -100123456789"
            aria-invalid={erros.chat ? true : undefined}
            aria-describedby={erros.chat ? `${id}-chat-erro` : undefined}
            className="font-mono"
          />
          {erros.chat ? (
            <p id={`${id}-chat-erro`} className="text-label text-err">
              {erros.chat}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:gap-6">
        <Switch rotulo="Alertas ligados" checked={ativo} onCheckedChange={setAtivo} />
        <Switch
          rotulo="Receber avisos"
          descricao="Além dos críticos, os avisos (como pedidos sem atualizar)."
          checked={avisos}
          onCheckedChange={setAvisos}
        />
      </div>

      <div className="flex max-w-sm flex-col gap-1.5">
        <Label htmlFor={`${id}-minimo`}>Gasto mínimo para o alerta “gastou sem vender”</Label>
        <Input
          id={`${id}-minimo`}
          inputMode="decimal"
          value={minimo}
          onChange={(e) => setMinimo(e.target.value)}
          aria-invalid={erros.minimo ? true : undefined}
          aria-describedby={`${id}-minimo-ajuda`}
          className="num w-36 text-right"
        />
        <p id={`${id}-minimo-ajuda`} className={erros.minimo ? "text-label text-err" : "text-label text-t2"}>
          {erros.minimo ?? "Na moeda de cada conta de anúncio. Vale para todas as lojas."}
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button pending={acao === "salvar"} disabled={ocupado && acao !== "salvar"} onClick={() => enviar(false)}>
          Salvar
        </Button>
        <Button
          variant="secondary"
          pending={acao === "testar"}
          disabled={ocupado && acao !== "testar"}
          onClick={() => enviar(true)}
        >
          {acao === "testar" ? null : <SendIcon aria-hidden />}
          Testar
        </Button>
        <p aria-live="polite" className="text-label text-t2">
          {alterado ? "Há alterações ainda não salvas." : ""}
        </p>
      </div>
    </Section>
  );
}

/**
 * Remonta o formulario quando a configuracao do servidor muda (depois de
 * salvar): os campos voltam a refletir o que esta gravado.
 */
export function CanalTelegram(props: { config: Config; temToken: boolean; tokenDaEnv: boolean }) {
  const chave = [
    props.config.telegram_chat_id,
    props.config.ativo,
    props.config.receber_avisos,
    props.config.gasto_sem_venda_min,
    props.temToken,
  ].join("|");
  return <Formulario key={chave} {...props} />;
}
