import { Dica } from "@/components/ui/dica";
import { Section } from "@/components/ui/section";
import { STATUS, StatusBadge } from "@/components/ui/status-badge";
import { INTERVALO_VERIFICACAO_MIN, regrasNaTela, textoCicloDeVida } from "../../alertas/apresentar";

// ============================================================================
// As regras que o cron de alertas ja roda (antes uma aba de /alertas), em
// palavras de lojista e com os limites de verdade. So leitura: valem para
// todas as lojas. O unico limite que se edita, o gasto minimo do "gastou sem
// vender", fica no formulario do Telegram logo acima (a rota grava tudo junto).
// ============================================================================

export function RegrasAlertas({ gastoMinimo }: { gastoMinimo: number }) {
  return (
    <Section
      titulo="Regras"
      nivel={3}
      descricao={
        <span className="inline-flex items-center gap-1">
          Todas as lojas, conferidas a cada {INTERVALO_VERIFICACAO_MIN} minutos.
          <Dica rotulo="Quando um alerta avisa de novo e fecha">{textoCicloDeVida()}</Dica>
        </span>
      }
      espaco="nenhum"
    >
      <ul className="border-t border-border">
        {regrasNaTela(gastoMinimo).map((r) => (
          <li
            key={r.regra}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border-subtle px-4 py-2.5 last:border-b-0"
          >
            <span className="flex min-w-0 flex-1 basis-56 items-center gap-1">
              <span className="text-dense font-medium text-ink">{r.titulo}</span>
              <Dica rotulo={`O que é ${r.titulo}`}>{r.explicacao}</Dica>
            </span>
            <span className="text-label text-t2">{r.quando}</span>
            <StatusBadge {...(r.severidade === "critico" ? STATUS.alerta.critico : STATUS.alerta.aviso)} />
          </li>
        ))}
      </ul>
    </Section>
  );
}
