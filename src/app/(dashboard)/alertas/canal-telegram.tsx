"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Section } from "@/components/ui/section";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { ROTAS, type AlertaCanalCorpo } from "@/lib/financeiro/tipos";
import { erroDoTelegram } from "./apresentar";
import { avisarConfigSalva, useConfigSalva, type ConfigCanal } from "./config-salva";

// ============================================================================
// Canal de aviso: o Telegram que ja existe (POST /api/alertas/canal), com a
// mesma regra do token -- vai para o servidor e nunca volta; campo vazio
// mantem o gravado.
//
// A rota grava TUDO junto (chat, ligado, avisos e o limite do "gastou sem
// vender"), entao o limite vai com o valor gravado. E a config lida com erro
// trava o formulario: Salvar gravaria o padrao por cima do que existe.
// ============================================================================

type Valores = { chatId: string; ativo: boolean; avisos: boolean };

function valoresDe(c: ConfigCanal): Valores {
  return { chatId: c.telegram_chat_id ?? "", ativo: c.ativo, avisos: c.receber_avisos };
}

async function postarCanal(
  corpo: AlertaCanalCorpo,
  testar: boolean
): Promise<{ salvo: boolean; erro: string | null; cru: string | null }> {
  let r: Response;
  try {
    r = await fetch(`${ROTAS.apiAlertasCanal}${testar ? "?testar=1" : ""}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corpo),
    });
  } catch {
    return { salvo: false, erro: erroDoTelegram(0), cru: null };
  }
  const j = (await r.json().catch(() => null)) as { ok?: boolean; erro?: string } | null;
  if (r.ok && j?.ok) return { salvo: true, erro: null, cru: null };
  // No teste, a rota grava ANTES de enviar: 200 com ok=false = salvo, envio recusado.
  return { salvo: r.ok, erro: erroDoTelegram(r.status, j?.erro), cru: j?.erro ?? null };
}

export function CanalTelegram({
  config,
  temToken: temTokenServidor,
  tokenDaEnv,
  erroConfig,
  erroToken,
}: {
  config: ConfigCanal;
  temToken: boolean;
  tokenDaEnv: boolean;
  erroConfig: string | null;
  erroToken: string | null;
}) {
  const router = useRouter();
  const id = useId();
  const [, iniciar] = useTransition();
  const [salvo, setSalvo] = useState<Valores>(() => valoresDe(config));
  const [valores, setValores] = useState<Valores>(() => valoresDe(config));
  const [token, setToken] = useState("");
  const [temToken, setTemToken] = useState(temTokenServidor);
  const gravada = useConfigSalva(config);
  const [acao, setAcao] = useState<"salvar" | "testar" | null>(null);
  const [erro, setErro] = useState<{ texto: string; cru: string | null } | null>(null);

  const travado = !!erroConfig;
  const conectado = !!salvo.chatId && temToken;
  const alterado =
    token.trim() !== "" ||
    valores.chatId.trim() !== salvo.chatId.trim() ||
    valores.ativo !== salvo.ativo ||
    valores.avisos !== salvo.avisos;

  const selo = !conectado
    ? { tom: "neutral" as const, texto: "Não configurado" }
    : salvo.ativo
      ? { tom: "ok" as const, texto: "Conectado" }
      : { tom: "neutral" as const, texto: "Desligado" };

  async function enviar(testar: boolean) {
    setAcao(testar ? "testar" : "salvar");
    setErro(null);
    const corpo: AlertaCanalCorpo = {
      chat_id: valores.chatId.trim() || null,
      bot_token: token.trim() || null,
      ativo: valores.ativo,
      receber_avisos: valores.avisos,
      // O limite mora na aba Regras; aqui vai o gravado, sem mexer.
      gasto_sem_venda_min: gravada.gasto_sem_venda_min,
    };
    const r = await postarCanal(corpo, testar);
    if (r.salvo) {
      setSalvo({ ...valores, chatId: valores.chatId.trim() });
      avisarConfigSalva({
        telegram_chat_id: corpo.chat_id,
        ativo: corpo.ativo,
        receber_avisos: corpo.receber_avisos,
        gasto_sem_venda_min: corpo.gasto_sem_venda_min,
      });
      if (token.trim()) setTemToken(true);
      setToken("");
      iniciar(() => router.refresh());
    }
    if (r.erro) {
      setErro({ texto: r.erro, cru: r.cru });
      toast.error(testar && r.salvo ? "Salvo, mas o teste não chegou" : "Não deu para salvar", {
        description: r.erro,
      });
    } else {
      toast.success(testar ? "Mensagem de teste enviada" : "Telegram salvo", {
        description: testar ? "Confira o Telegram." : undefined,
      });
    }
    setAcao(null);
  }

  return (
    <div className="flex flex-col gap-4">
      <Section
        titulo="Telegram"
        descricao="Onde os alertas chegam. Hoje só o Telegram funciona."
        // Config que nao veio: sem selo, porque "Conectado" ou "Nao configurado" seria chute.
        acoes={travado ? undefined : <StatusBadge tom={selo.tom} texto={selo.texto} tamanho="md" />}
      >
        {travado ? (
          <Callout tom="err" titulo="Não deu para ler a configuração do Telegram">
            Para não apagar o que já está salvo, o formulário fica travado. Atualize a tela
            para tentar de novo.
            <details className="mt-1 text-label text-t2">
              <summary className="cursor-pointer">Detalhes para o suporte</summary>
              <p className="mt-1 break-words font-mono">{erroConfig}</p>
            </details>
          </Callout>
        ) : (
          <form
            className="flex flex-col gap-5"
            onSubmit={(e) => {
              e.preventDefault();
              void enviar(false);
            }}
          >
            <details open={!conectado} className="group rounded-control border border-border bg-surface-2 px-3 py-2.5">
              <summary className="cursor-pointer text-dense font-medium text-ink">
                Como achar o token e o chat id
              </summary>
              <ol className="mt-2 flex list-decimal flex-col gap-1 pl-5 text-dense text-t1">
                <li>
                  No Telegram, abra o <span className="font-mono text-ink">@BotFather</span> e mande{" "}
                  <span className="font-mono text-ink">/newbot</span>.
                </li>
                <li>
                  Dê um nome e um usuário terminando em <span className="font-mono text-ink">bot</span>.
                </li>
                <li>Copie o token que ele mandar.</li>
                <li>
                  Abra a conversa com o seu bot e mande <span className="font-mono text-ink">/start</span>.
                  Para um grupo, adicione o bot ao grupo e mande uma mensagem lá.
                </li>
                <li>
                  Abra no navegador{" "}
                  <span className="break-all font-mono text-ink">
                    https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates
                  </span>{" "}
                  e copie o número em <span className="font-mono text-ink">chat.id</span> (o de grupo
                  começa com -).
                </li>
                <li>Cole os dois abaixo e clique em Enviar teste.</li>
              </ol>
            </details>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-token`}>Token do bot</Label>
                <Input
                  id={`${id}-token`}
                  type="password"
                  autoComplete="off"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder={temToken ? "Deixe vazio para manter o salvo" : "123456789:AA…"}
                  aria-describedby={`${id}-token-ajuda`}
                  className="font-mono"
                />
                <p id={`${id}-token-ajuda`} className="text-label text-t2">
                  {erroToken
                    ? "Não deu para conferir se há um token salvo. Cole de novo se o teste falhar."
                    : tokenDaEnv && !token
                      ? "Usando o bot padrão do xcart. Cole um token para usar o seu."
                      : temToken
                        ? "Token salvo. Ele nunca volta para a tela."
                        : "Fica guardado no servidor e nunca volta para a tela."}
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-chat`}>Chat id</Label>
                <Input
                  id={`${id}-chat`}
                  inputMode="numeric"
                  autoComplete="off"
                  value={valores.chatId}
                  onChange={(e) => setValores((v) => ({ ...v, chatId: e.target.value }))}
                  placeholder="123456789 ou -100123456789"
                  aria-describedby={`${id}-chat-ajuda`}
                  className="font-mono"
                />
                <p id={`${id}-chat-ajuda`} className="text-label text-t2">
                  Só números. O de grupo começa com -.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <Switch
                rotulo="Alertas ligados"
                descricao="Desligado, nada vai para o Telegram. A tela continua mostrando os alertas."
                checked={valores.ativo}
                onCheckedChange={(v) => setValores((x) => ({ ...x, ativo: v }))}
              />
              <Switch
                rotulo="Receber avisos, não só críticos"
                descricao="Aviso chega uma vez, quando abre. Crítico avisa de novo a cada 6 horas."
                checked={valores.avisos}
                onCheckedChange={(v) => setValores((x) => ({ ...x, avisos: v }))}
              />
            </div>

            {erro && (
              <Callout tom="err" titulo={erro.texto} role="alert">
                {erro.cru && erro.cru !== erro.texto ? (
                  <details className="text-label text-t2">
                    <summary className="cursor-pointer">Resposta do Telegram</summary>
                    <p className="mt-1 break-words font-mono">{erro.cru}</p>
                  </details>
                ) : null}
              </Callout>
            )}

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Button
                type="submit"
                pending={acao === "salvar"}
                disabled={acao !== null}
                className="h-ctl-lg sm:h-ctl-md"
              >
                Salvar
              </Button>
              <Button
                type="button"
                variant="secondary"
                pending={acao === "testar"}
                disabled={acao !== null}
                onClick={() => void enviar(true)}
                className="h-ctl-lg sm:h-ctl-md"
              >
                {acao !== "testar" && <Send aria-hidden />}
                Enviar teste
              </Button>
              <p className="text-label text-t2" aria-live="polite">
                {alterado
                  ? "Alterações não salvas."
                  : "O teste salva o que está no formulário e manda uma mensagem."}
              </p>
            </div>
          </form>
        )}
      </Section>

      <div className="grid gap-4 md:grid-cols-2">
        <EmptyState
          variante="tracejado"
          selo="Em breve"
          titulo="Conectar o Telegram em 1 clique"
          descricao="Um link abre o bot e liga o chat sozinho, sem procurar token nem chat id."
          className="items-start text-left"
        />
        <EmptyState
          variante="tracejado"
          selo="Em breve"
          titulo="E-mail e push"
          descricao="Os mesmos alertas por e-mail ou no celular, e um resumo diário do lucro de ontem."
          className="items-start text-left"
        />
      </div>
    </div>
  );
}
