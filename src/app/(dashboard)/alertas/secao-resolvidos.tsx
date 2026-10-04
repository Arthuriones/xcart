import { Callout } from "@/components/ui/callout";
import { DataTable } from "@/components/ui/data-table";
import { Dica } from "@/components/ui/dica";
import { EmptyState } from "@/components/ui/empty-state";
import { Section } from "@/components/ui/section";
import { STATUS, StatusBadge } from "@/components/ui/status-badge";
import { LIMITE_RESOLVIDOS } from "@/lib/leitura/alertas";
import type { AlertaRow, LojaDoSeletor } from "@/lib/financeiro/tipos";
import { dataHoraCurta, duracaoMs, duracaoTexto, folgaDoFechamentoMin, nomeDaLoja } from "./apresentar";

// ============================================================================
// Aba Historico: os alertas que fecharam nos ultimos 7 dias. Quem fecha e o
// cron, sozinho -- nao existe "resolver na mao" --, entao nao ha coluna
// "como fechou": a descricao da secao diz a regra uma vez.
// ============================================================================

export function SecaoResolvidos({
  resolvidos,
  lojas,
  lojasIndisponiveis,
  fuso,
  erro,
}: {
  resolvidos: AlertaRow[];
  lojas: LojaDoSeletor[];
  lojasIndisponiveis: boolean;
  fuso: string;
  erro: string | null;
}) {
  if (erro) {
    return (
      <Callout tom="err" titulo="Não deu para ler os alertas resolvidos" role="alert">
        Os abertos continuam valendo. Atualize a tela para tentar de novo.
        <details className="mt-1 text-label text-t2">
          <summary className="cursor-pointer">Detalhes para o suporte</summary>
          <p className="mt-1 break-words font-mono">{erro}</p>
        </details>
      </Callout>
    );
  }

  const linhas = resolvidos.map((r) => {
    const dur = duracaoMs(r.aberto_em, r.resolvido_em);
    const critico = r.severidade === "critico";
    return {
      id: r.id,
      alerta: (
        <span className="flex min-w-0 flex-col">
          <span className="font-medium text-ink">{r.titulo}</span>
          <span className="text-label text-t2">{critico ? "Crítico" : "Aviso"}</span>
        </span>
      ),
      alertaTexto: r.titulo,
      situacao: <StatusBadge {...STATUS.alerta.resolvido} />,
      loja: nomeDaLoja(r.store_id, lojas, lojasIndisponiveis),
      aberto: dataHoraCurta(r.aberto_em, fuso),
      abertoValor: Date.parse(r.aberto_em) || 0,
      fechou: dataHoraCurta(r.resolvido_em, fuso),
      fechouValor: r.resolvido_em ? Date.parse(r.resolvido_em) || 0 : 0,
      durou: dur === null ? "—" : duracaoTexto(dur),
      durouValor: dur,
    };
  });

  return (
    <Section
      titulo="Resolvidos nos últimos 7 dias"
      descricao={
        <span className="inline-flex items-center gap-1">
          {resolvidos.length >= LIMITE_RESOLVIDOS
            ? `Fecham sozinhos. Mostrando os ${LIMITE_RESOLVIDOS} mais recentes.`
            : "Fecham sozinhos."}
          <Dica rotulo="Como um alerta fecha e como a duração é contada">
            Depois de duas verificações seguidas sem o problema. A duração vai da abertura até essa segunda
            verificação: o problema pode ter acabado até {folgaDoFechamentoMin()} min antes.
          </Dica>
        </span>
      }
      espaco="nenhum"
    >
      <DataTable
        legenda="Alertas resolvidos nos últimos 7 dias"
        colunas={[
          { chave: "alerta", titulo: "Alerta", ordenarPor: "alertaTexto", className: "min-w-56 whitespace-normal py-2" },
          { chave: "situacao", titulo: "Situação", ordenavel: false, ocultarNoCartao: true },
          { chave: "loja", titulo: "Loja" },
          { chave: "aberto", titulo: "Aberto em", ordenarPor: "abertoValor", direcaoInicial: "desc" },
          { chave: "fechou", titulo: "Fechou em", ordenarPor: "fechouValor", direcaoInicial: "desc" },
          { chave: "durou", titulo: "Durou", alinhar: "direita", ordenarPor: "durouValor" },
        ]}
        linhas={linhas}
        ordenacaoInicial={[{ chave: "fechou", direcao: "desc" }]}
        vazio={
          <EmptyState
            variante="simples"
            titulo="Nenhum alerta resolvido nos últimos 7 dias"
            descricao="Quando um alerta fechar, ele aparece aqui com quanto tempo durou."
          />
        }
      />
    </Section>
  );
}
