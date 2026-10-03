import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { getAlertas } from "@/lib/alertas/queries";
import { ErroLeitura } from "../erro-leitura";
import { CanalTelegram } from "./canal-telegram";

export const dynamic = "force-dynamic";

// ============================================================================
// Integracoes -> Notificacoes: onde os alertas chegam. Hoje so o Telegram
// funciona (a configuracao que morava em Alertas, mesma leitura e mesma API).
// Telegram em 1 clique, e-mail, push e regras por loja ainda nao tem backend
// (#14, #15, #16): aparecem como "Em breve", sem fingir.
// ============================================================================

export default async function NotificacoesPage() {
  const dados = await getAlertas();
  const conectado = Boolean(dados.config.telegram_chat_id) && dados.temToken;

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <h2 className="text-overlay text-ink">Notificações</h2>
        <StatusBadge tom={conectado ? "ok" : "neutral"}>{conectado ? "Telegram" : "Nenhum canal"}</StatusBadge>
      </div>
      <p className="max-w-[62ch] text-dense text-t1 text-pretty">
        Onde os alertas chegam. Hoje só o Telegram funciona. Os alertas abertos ficam em{" "}
        <Link
          href="/alertas"
          className="rounded-sm font-medium text-brand underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          Alertas
        </Link>
        .
      </p>

      {dados.erro ? (
        // Sem ler a configuracao gravada, o formulario sairia com os valores
        // padrao -- e "Salvar" apagaria o que o lojista tinha. Melhor nao mostrar.
        <ErroLeitura titulo="Não deu para ler a configuração das notificações." detalhe={dados.erro} />
      ) : (
        <CanalTelegram config={dados.config} temToken={dados.temToken} tokenDaEnv={dados.tokenDaEnv} />
      )}

      <div className="grid gap-3 md:grid-cols-3">
        <EmptyState
          variante="tracejado"
          selo="Em breve"
          titulo="Telegram em 1 clique"
          descricao="Um link abre o bot e liga o chat sozinho, sem procurar o número."
        />
        <EmptyState
          variante="tracejado"
          selo="Em breve"
          titulo="E-mail e celular"
          descricao="O mesmo alerta por e-mail ou notificação, e um resumo diário com o lucro de ontem por loja."
        />
        <EmptyState
          variante="tracejado"
          selo="Em breve"
          titulo="Regras por loja"
          descricao="Ligar cada alerta por loja, mudar os limites e silenciar por 1 h ou até amanhã."
        />
      </div>
    </>
  );
}
