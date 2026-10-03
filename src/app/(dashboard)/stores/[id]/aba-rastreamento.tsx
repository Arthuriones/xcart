import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Section } from "@/components/ui/section";
import { STATUS, StatusBadge, StatusDot, type TomStatus } from "@/components/ui/status-badge";
import { lerRastreamentoDaLoja, type LojaBase, type RastreamentoDaLoja } from "@/lib/leitura/resumo-lojas";
import type { DestinoNaTela, LojaTracking } from "@/lib/tracking/queries";
import type { DiagnosticoLoja } from "@/lib/tracking/diagnostico";
import {
  NOME_DA_PLATAFORMA,
  apelido,
  emModoTeste,
  oQueFalta,
  quando,
  textoProblema,
  vereditoDoDestino,
  type Saude,
} from "@/app/(dashboard)/tracking/saude";
import { plural } from "@/lib/leitura/lojas-estado";

const SELO_SAUDE: Record<Saude, { tom: TomStatus; texto: string }> = {
  ok: STATUS.saude.tudoCerto,
  atencao: STATUS.saude.atencao,
  parado: STATUS.saude.parado,
  desligado: STATUS.saude.desligado,
};

function seloDestino(d: DestinoNaTela): { tom: TomStatus; texto: string; ordem: number } {
  if (!d.ativo) return { ...STATUS.destino.desativado, ordem: 4 };
  if (oQueFalta(d) !== null) return { ...STATUS.destino.incompleto, ordem: 1 };
  if (d.contagem.falharam > 0 && d.contagem.enviados === 0) return { ...STATUS.destino.erro, ordem: 0 };
  if (emModoTeste(d)) return { ...STATUS.destino.modoTeste, ordem: 2 };
  return { ...STATUS.destino.enviando, ordem: 3 };
}

function comprasDo(d: DestinoNaTela, loja: LojaTracking, diag: DiagnosticoLoja | null): string {
  const enviaCompra = d.plataforma === "meta" || Boolean(d.labels.purchase);
  if (!enviaCompra) return "Não envia compra";
  const v = vereditoDoDestino(d, loja, diag);
  if (v.tipo === "sem-contagem") return "—";
  if (v.tipo === "sem-pedidos") return plural(v.compras, "compra enviada", "compras enviadas");
  if (v.esperados === 0) return "Nenhum pedido em 7 dias";
  return `${v.chegaram.toLocaleString("pt-BR")} de ${plural(v.esperados, "pedido", "pedidos")}`;
}

type Checagem = { id: string; rotulo: string; tom: TomStatus; texto: string };

function checagens(loja: LojaTracking, diag: DiagnosticoLoja | null): Checagem[] {
  const sem = { tom: "neutral" as const, texto: "Não deu para verificar" };
  const webhook =
    diag?.temWebhook === true
      ? { tom: "ok" as const, texto: "Inscrito" }
      : diag?.temWebhook === false
        ? { tom: "err" as const, texto: "Faltando: os pedidos não viram compra" }
        : sem;
  const snippet =
    diag?.temSnippet === true
      ? diag.snippetComId === false
        ? { tom: "warn" as const, texto: "Versão antiga, sem o id da loja" }
        : { tom: "ok" as const, texto: "Instalado" }
      : diag?.temSnippet === false
        ? { tom: "warn" as const, texto: "Faltando: sem ele o clique do anúncio se perde" }
        : sem;
  const pixel = loja.pixelCheckoutAtivo
    ? loja.pixelCheckoutDesatualizado
      ? { tom: "warn" as const, texto: "Código antigo, sem o id da loja" }
      : { tom: "ok" as const, texto: "Mandando eventos" }
    : { tom: "warn" as const, texto: "Sem evento nas últimas 24 h" };
  const remarketing =
    diag?.temRemarketing === true
      ? { tom: "ok" as const, texto: "Instalado" }
      : diag?.temRemarketing === false
        ? { tom: "neutral" as const, texto: "Não instalado (opcional)" }
        : sem;
  return [
    { id: "webhook", rotulo: "Webhook de pedidos", ...webhook },
    { id: "snippet", rotulo: "Snippet no tema", ...snippet },
    { id: "pixel", rotulo: "Pixel do checkout", ...pixel },
    { id: "remarketing", rotulo: "Tag de remarketing do Google", ...remarketing },
  ];
}

// cn por cima: o cva sozinho deixa "border-transparent" junto com a borda da variante.
const LINK_TRACKING = cn(buttonVariants({ variant: "secondary", size: "sm" }));

/**
 * Rastreamento da loja pela regra da Saude dos pixels, desta vez conferindo
 * na Shopify (pedidos dos ultimos 7 dias, webhook e tema). Leva segundos: a
 * aba entra por Suspense com uma frase dizendo o que esta acontecendo.
 */
export async function AbaRastreamento({ base }: { base: LojaBase }) {
  let r: RastreamentoDaLoja;
  try {
    r = await lerRastreamentoDaLoja(base.id, true);
  } catch (e) {
    console.error("[loja] rastreamento", e);
    return (
      <EmptyState
        titulo="Não deu para ler o rastreamento agora"
        descricao="Os envios continuam saindo normalmente; foi a leitura que falhou. Recarregue em instantes."
      />
    );
  }

  return <RastreamentoLoja r={r} />;
}

/** O conteudo da aba, so com dados. */
export function RastreamentoLoja({ r }: { r: RastreamentoDaLoja }) {
  const loja = r.loja;
  if (!loja || !loja.ligado) {
    return (
      <EmptyState
        titulo="Rastreamento desligado nesta loja"
        descricao="Ligue em Saúde dos pixels para mandar as vendas desta loja ao Meta e ao Google pelo servidor."
        acao={
          <Link href="/tracking" className={cn(buttonVariants({ variant: "primary" }))}>
            Abrir Saúde dos pixels
          </Link>
        }
        className="py-12"
      />
    );
  }

  const diag = r.diagnostico;
  const linhas = loja.destinos.map((d) => {
    const selo = seloDestino(d);
    return {
      id: d.id,
      destino: (
        <span className="flex flex-col gap-0.5 whitespace-normal">
          <span className="font-semibold text-ink">{apelido(d)}</span>
          <span className="text-label text-t2">{NOME_DA_PLATAFORMA[d.plataforma]}</span>
        </span>
      ),
      nomeOrdem: apelido(d),
      estado: <StatusBadge tom={selo.tom} texto={selo.texto} />,
      estadoOrdem: selo.ordem,
      compras: comprasDo(d, loja, diag),
      enviados: d.contagem.enviados.toLocaleString("pt-BR"),
      enviadosValor: d.contagem.enviados,
      falhas:
        d.contagem.falharam > 0 ? (
          <span className="flex flex-col items-end gap-0.5 whitespace-normal">
            <span className="font-semibold text-err">{d.contagem.falharam.toLocaleString("pt-BR")}</span>
            {d.contagem.ultimoErro ? (
              <span className="max-w-60 truncate text-label text-t2">{d.contagem.ultimoErro}</span>
            ) : null}
          </span>
        ) : (
          "0"
        ),
      falhasValor: d.contagem.falharam,
    };
  });

  return (
    <div className="flex flex-col gap-4">
      <Section
        titulo="Saúde do rastreamento"
        descricao={
          r.conferido
            ? "Envios dos últimos 7 dias, conferidos com os pedidos da Shopify agora."
            : "Envios dos últimos 7 dias. O app não está na loja, então não deu para conferir na Shopify."
        }
        acoes={
          <Link href="/tracking" className={LINK_TRACKING}>
            Abrir Saúde dos pixels
          </Link>
        }
      >
        <StatusBadge tamanho="md" {...SELO_SAUDE[r.saude]} />
        {r.motivos.length > 0 ? (
          <ul className="flex flex-col gap-1.5 text-dense text-ink">
            {r.motivos.map((m) => (
              <li key={m.texto} className="flex items-start gap-2">
                <StatusDot tom={m.tom} texto={m.tom === "err" ? "Grave" : "Atenção"} className="mt-1.5" />
                {m.texto}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-dense text-t1">Nada a corrigir: as vendas estão chegando aos destinos.</p>
        )}
        {loja.ultimoEnvio ? (
          <p className="text-label text-t2">Último envio {quando(loja.ultimoEnvio)}.</p>
        ) : null}
      </Section>

      <Section titulo="Destinos" descricao="Para onde as vendas desta loja vão." espaco="nenhum">
        <DataTable
          legenda="Destinos de rastreamento da loja"
          colunas={[
            { chave: "destino", titulo: "Destino", ordenarPor: "nomeOrdem" },
            { chave: "estado", titulo: "Estado", ordenarPor: "estadoOrdem" },
            { chave: "compras", titulo: "Compras (7 dias)" },
            { chave: "enviados", titulo: "Eventos enviados", alinhar: "direita", ordenarPor: "enviadosValor" },
            { chave: "falhas", titulo: "Falhas", alinhar: "direita", ordenarPor: "falhasValor" },
          ]}
          linhas={linhas}
          vazio={
            <EmptyState
              variante="simples"
              titulo="Nenhum destino cadastrado"
              descricao="Cadastre um pixel do Meta ou uma conta do Google em Saúde dos pixels."
            />
          }
        />
      </Section>

      <Section
        titulo="Na Shopify"
        descricao={
          diag?.problema ? textoProblema(diag.problema) : "O que precisa estar instalado na loja para a venda sair."
        }
      >
        <dl className="grid gap-x-4 gap-y-2 text-dense sm:grid-cols-[max-content_1fr]">
          {checagens(loja, r.conferido ? diag : null).map((c) => (
            <div key={c.id} className="contents">
              <dt className="text-t1">{c.rotulo}</dt>
              <dd className="mb-2 sm:mb-0">
                <StatusBadge tom={c.tom} texto={c.texto} />
              </dd>
            </div>
          ))}
        </dl>
      </Section>
    </div>
  );
}
