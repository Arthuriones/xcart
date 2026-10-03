import { Section } from "@/components/ui/section";
import { STATUS, StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import {
  INTERVALO_VERIFICACAO_MIN,
  regrasNaTela,
  textoCicloDeVida,
} from "./apresentar";
import type { ConfigCanal } from "./config-salva";
import { LimiteGasto } from "./limite-gasto";

// ============================================================================
// Aba Regras: as 7 regras que o cron ja roda, em palavras de lojista, com os
// limites de verdade. Todas ligadas e iguais para todas as lojas: ligar,
// desligar e limite por loja dependem de backend novo (Em breve, #15). O
// unico limite que ja se edita e o gasto minimo do "gastou sem vender".
// ============================================================================

const CAMPO_FALSO =
  "flex h-ctl-md items-center rounded-control border border-border bg-surface-2 px-3 text-t2";

export function SecaoRegras({ config, travado }: { config: ConfigCanal; travado: boolean }) {
  const regras = regrasNaTela(config.gasto_sem_venda_min);
  return (
    <div className="flex flex-col gap-4">
      <Section
        titulo="Regras que já rodam"
        descricao={`Valem para todas as lojas. O xcart confere a cada ${INTERVALO_VERIFICACAO_MIN} minutos.`}
        acoes={
          <span className="rounded-sm border border-border px-1.5 text-label text-t2">
            Editar por loja: em breve
          </span>
        }
        espaco="nenhum"
      >
        <ul className="border-t border-border">
          {regras.map((r) => (
            <li
              key={r.regra}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-b border-border-subtle px-4 py-3 last:border-b-0 md:grid-cols-[minmax(0,2fr)_88px_minmax(0,1fr)_auto]"
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-dense font-medium text-ink">{r.titulo}</span>
                <span className="text-label text-t2">{r.explicacao}</span>
              </span>
              {/* Celular: selo e "quando" numa linha embaixo. md+: cada um na sua coluna. */}
              <span className="col-span-2 row-start-2 flex flex-wrap items-center gap-2 md:contents">
                <StatusBadge
                  {...(r.severidade === "critico" ? STATUS.alerta.critico : STATUS.alerta.aviso)}
                />
                <span className="text-dense text-t1">
                  <span className="text-t2 md:sr-only">Quando: </span>
                  {r.quando}
                </span>
              </span>
              {/* Ligada e travada: desligar por regra depende de backend novo. */}
              <Switch
                checked
                disabled
                aria-label={`${r.titulo}: ligada`}
                className="justify-self-end md:col-start-4 md:row-start-1"
              />
            </li>
          ))}
        </ul>
        <LimiteGasto config={config} travado={travado} />
        <p className="border-t border-border bg-surface-2 px-4 py-3 text-label text-t2">
          {textoCicloDeVida()} Desligar uma regra ou mudar o limite por loja: em breve.
        </p>
      </Section>

      <section
        aria-labelledby="alerta-por-numero"
        className="flex flex-col gap-3 rounded-card border border-dashed border-border-strong bg-surface p-4"
      >
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="alerta-por-numero" className="text-section text-ink">
            Alerta por número
          </h2>
          <span className="rounded-full border border-border-strong px-2 text-label font-medium text-t2">
            Em breve
          </span>
        </div>
        <p className="text-dense text-t1">
          Avise quando uma métrica passar do limite, por loja.
        </p>
        <div
          aria-hidden
          className="flex flex-wrap items-center gap-2 text-dense text-t2 select-none"
        >
          <span>Quando</span>
          <span className={CAMPO_FALSO}>Lucro de hoje</span>
          <span className={CAMPO_FALSO}>ficar abaixo de</span>
          <span className={`${CAMPO_FALSO} num`}>0,00</span>
          <span>em</span>
          <span className={CAMPO_FALSO}>uma loja</span>
        </div>
        <p className="text-label text-t2">
          Outros exemplos: ROAS real abaixo de 1,5× · gasto sem venda acima de um valor · queda
          de pedidos fora do normal.
        </p>
      </section>
    </div>
  );
}
