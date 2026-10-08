import { StatusBadge } from "@/components/ui/status-badge";
import { getAlertas } from "@/lib/alertas/queries";
import { ErroLeitura } from "../erro-leitura";
import { CanalTelegram } from "./canal-telegram";
import { CanalVenda } from "./canal-venda";
import { RegrasAlertas } from "./regras";

export const dynamic = "force-dynamic";

// ============================================================================
// Integracoes -> Notificacoes: onde os alertas chegam (o Telegram) e o que
// dispara cada um (as regras). Era a aba "Canais de aviso" e "Regras" de
// /alertas, que agora so mostra o que esta aberto e o historico.
// Mesma leitura e mesma API (POST /api/alertas/canal).
// ============================================================================

export default async function NotificacoesPage() {
  const dados = await getAlertas();
  const conectado = Boolean(dados.config.telegram_chat_id) && dados.temToken;
  const vendaLigada = Boolean(dados.venda.host) && dados.venda.ativo;
  const canais = [conectado ? "Telegram" : null, vendaLigada ? "Venda no celular" : null].filter(Boolean);

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <h2 className="text-overlay text-ink">Notificações</h2>
        <StatusBadge tom={canais.length ? "ok" : "neutral"}>{canais.length ? canais.join(" · ") : "Nenhum canal"}</StatusBadge>
      </div>

      {dados.erro ? (
        // Sem ler a configuracao gravada, o formulario sairia com os valores
        // padrao -- e "Salvar" apagaria o que o lojista tinha. Melhor nao mostrar.
        <ErroLeitura titulo="Não deu para ler a configuração das notificações." detalhe={dados.erro} />
      ) : (
        <>
          <CanalVenda ativo={dados.venda.ativo} host={dados.venda.host} />
          <CanalTelegram config={dados.config} temToken={dados.temToken} tokenDaEnv={dados.tokenDaEnv} />
          <RegrasAlertas gastoMinimo={Number(dados.config.gasto_sem_venda_min ?? 30)} />
        </>
      )}
    </>
  );
}
