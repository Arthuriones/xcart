"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { CheckIcon, CopyIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/section";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge, type TomStatus } from "@/components/ui/status-badge";
import { rotaRastreamentoDaLoja } from "@/lib/leitura/guia-passos";
import { META_REFERRER, codigoDoScript } from "./logica";

// ============================================================================
// O que vai no tema da VITRINE, cada codigo com Copiar, e o que (nao) vai na
// loja de checkout. Na vitrine sao tres:
//   1. o script do roteamento: leva o carrinho a loja de checkout;
//   2. a linha do referrer: a loja de checkout nao recebe o endereco da vitrine;
//   3. o script de rastreamento: ver produto e carrinho saem pelo servidor.
// O Instalar na vitrine ja poe os dois primeiros; o terceiro e o mesmo botao
// de qualquer loja, no Rastreamento da vitrine. Colar e a alternativa manual,
// e o que ja esta no tema fica recolhido, para nao ser colado duas vezes.
//
// O codigo do rastreamento vem do servidor (GET /api/tracking/snippet), da
// mesma montarTag do botao: a tag leva o id da LINHA de loja e o formato do id
// de produto do Google, que so o servidor conhece.
//
// Na loja de checkout nao vai codigo da rota no tema: o permalink leva o
// comprador direto ao pagamento. Ela precisa do rastreamento ligado (a compra
// sai do orders/create) e do pixel do checkout. A compra sai sem o clique do
// anuncio: buildCartPermalink nao leva attributes de proposito (CLAUDE.md).
// O inicio do checkout NAO e prometido da vitrine: o loader barra o clique de
// checkout na captura do window, antes do ouvinte do snippet no document.
// ============================================================================

const LINK =
  "rounded-sm text-dense font-medium text-brand underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

export interface LojaDaRota {
  id: string;
  nome: string;
}

export function CodigosDaVitrine({
  origem,
  token,
  vitrineId,
  vitrineNome,
  rotaLigada,
  roteamentoNoTema,
  checkouts,
}: {
  origem: string;
  token: string;
  vitrineId: string;
  vitrineNome: string;
  rotaLigada: boolean;
  /** O script desta rota ja deu sinal ou o tema esta em dia: recolhe o codigo. */
  roteamentoNoTema: boolean;
  checkouts: LojaDaRota[];
}) {
  const nomeVitrine = vitrineNome || "sua vitrine";
  return (
    <>
      <Section
        titulo="Instale na vitrine"
        descricao={`Três códigos no tema de ${nomeVitrine}. Cole à mão só o que ainda não estiver lá.`}
      >
        <ol className="flex list-decimal flex-col gap-1 pl-4 text-dense text-t1">
          <li>Na Shopify da vitrine: Loja virtual › Temas.</li>
          <li>No tema publicado: botão ⋯ › Editar código.</li>
          <li>
            Abra <code className="font-mono text-label text-ink">layout/theme.liquid</code>, cole cada código logo antes
            de <code className="font-mono text-label text-ink">&lt;/head&gt;</code> e salve.
          </li>
        </ol>

        <ul className="flex flex-col gap-3">
          <ItemCodigo
            titulo="Roteamento"
            para="Leva o carrinho da vitrine para a loja de checkout. Sem ele a rota não funciona."
            nota="O botão Instalar na vitrine já põe este código. Cole à mão só se não usar o botão."
            selo={roteamentoNoTema ? { tom: "ok", texto: "No tema" } : null}
            recolhido={roteamentoNoTema}
            codigo={rotaLigada ? codigoDoScript(origem, token) : null}
            semCodigo="Ligue a rota antes de colar: com ela pausada, o script trava o checkout da vitrine."
          />
          <ItemCodigo
            titulo="Sem rastro da vitrine (referrer)"
            para="A loja de checkout não recebe o endereço da vitrine de onde o comprador saiu."
            nota={
              <>
                O botão Instalar na vitrine já põe esta linha quando o tema não tem outra. Se o tema já tiver uma linha
                com <code className="font-mono text-label text-ink">name=&quot;referrer&quot;</code>, troque por esta.
              </>
            }
            codigo={META_REFERRER}
          />
          <ItemRastreamento vitrineId={vitrineId} />
        </ul>
      </Section>

      <Section
        titulo="Na loja de checkout"
        descricao="Nenhum código da rota vai no tema dela: o comprador cai direto no pagamento, sem abrir o tema."
      >
        <ul className="flex list-disc flex-col gap-1 pl-4 text-dense text-t1 text-pretty">
          <li>
            Ligue o rastreamento nela, com o mesmo pixel da vitrine. A compra vai ao Meta e ao TikTok pelo servidor
            assim que a Shopify avisa o pedido.
          </li>
          <li>
            Cole o pixel do checkout dela (o código está no Rastreamento da loja) em Configurações › Eventos do
            cliente. É ele que manda o início do checkout e a compra do Google.
          </li>
        </ul>
        {checkouts.length > 0 ? (
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {checkouts.map((c) => (
              <Link key={c.id} href={rotaRastreamentoDaLoja(c.id)} className={LINK}>
                Rastreamento de {c.nome}
              </Link>
            ))}
          </div>
        ) : null}
        <p className="text-label text-t2 text-pretty">
          A compra chega sem o clique do anúncio (fbclid, gclid): o clique fica na vitrine e o pedido nasce na loja de
          checkout.
        </p>
      </Section>
    </>
  );
}

function ItemCodigo({
  titulo,
  para,
  nota,
  selo = null,
  recolhido = false,
  codigo,
  semCodigo,
  children,
}: {
  titulo: string;
  /** Para que serve, em uma linha. */
  para: string;
  nota?: ReactNode;
  selo?: { tom: TomStatus; texto: string } | null;
  /** Ja esta no tema: o codigo so aparece se pedir. */
  recolhido?: boolean;
  /** null = nao ha o que colar agora (semCodigo explica). */
  codigo: string | null;
  semCodigo?: string;
  children?: ReactNode;
}) {
  const [aberto, setAberto] = useState(!recolhido);

  return (
    <li className="flex flex-col gap-2 rounded-card border border-border bg-surface-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-dense font-semibold text-ink">{titulo}</span>
        {selo ? <StatusBadge tom={selo.tom} texto={selo.texto} /> : null}
      </div>
      <p className="text-dense text-t1 text-pretty">{para}</p>
      {nota ? <p className="text-label text-t2 text-pretty">{nota}</p> : null}
      {children}
      {codigo === null ? (
        semCodigo ? <p className="text-label text-t2 text-pretty">{semCodigo}</p> : null
      ) : aberto ? (
        <CodigoParaCopiar codigo={codigo} rotulo={`Código: ${titulo}`} />
      ) : (
        <div>
          <Button variant="ghost" size="sm" aria-expanded={false} onClick={() => setAberto(true)}>
            Já está no tema. Ver o código
          </Button>
        </div>
      )}
    </li>
  );
}

/** O codigo com o botao Copiar. Selecionar e copiar na mao continua valendo. */
function CodigoParaCopiar({ codigo, rotulo }: { codigo: string; rotulo: string }) {
  const [copiado, setCopiado] = useState<"sim" | "falhou" | null>(null);

  useEffect(() => {
    if (copiado !== "sim") return;
    const id = setTimeout(() => setCopiado(null), 2000);
    return () => clearTimeout(id);
  }, [copiado]);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(codigo);
      setCopiado("sim");
    } catch {
      setCopiado("falhou");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <pre
        aria-label={rotulo}
        tabIndex={0}
        className="overflow-x-auto rounded-control border border-border bg-surface p-3 font-mono text-label text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
      >
        {codigo}
      </pre>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={copiar}>
          {copiado === "sim" ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
          {copiado === "sim" ? "Copiado" : "Copiar"}
        </Button>
        <span aria-live="polite" className="text-label text-t2">
          {copiado === "falhou" ? "O navegador bloqueou a cópia. Selecione o texto e copie." : ""}
        </span>
      </div>
    </div>
  );
}

type RespostaDoSnippet = {
  codigo?: unknown;
  instalado?: unknown;
  ligado?: unknown;
  error?: unknown;
};

/** O script de rastreamento da vitrine: o codigo e o estado vem do servidor. */
function ItemRastreamento({ vitrineId }: { vitrineId: string }) {
  const [dado, setDado] = useState<{ codigo: string; instalado: boolean | null; ligado: boolean | null } | null>(null);
  const [erro, setErro] = useState(false);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/tracking/snippet?storeId=${encodeURIComponent(vitrineId)}`)
      .then((r) => (r.ok ? (r.json() as Promise<RespostaDoSnippet>) : Promise.reject(new Error(String(r.status)))))
      .then((j) => {
        if (!vivo) return;
        if (typeof j.codigo !== "string") throw new Error("sem codigo");
        setDado({
          codigo: j.codigo,
          instalado: typeof j.instalado === "boolean" ? j.instalado : null,
          ligado: typeof j.ligado === "boolean" ? j.ligado : null,
        });
        setErro(false);
      })
      .catch(() => vivo && setErro(true));
    return () => {
      vivo = false;
    };
  }, [vitrineId, tentativa]);

  const titulo = "Rastreamento (pelo servidor)";
  const para =
    "Manda ao Meta e ao TikTok, pelo servidor, quem viu produto e quem pôs no carrinho na vitrine. O Google vai pela tag.";
  const linkRastreamento = (
    <Link href={rotaRastreamentoDaLoja(vitrineId)} className={LINK}>
      Abrir o rastreamento da vitrine
    </Link>
  );

  if (erro) {
    return (
      <li className="flex flex-col gap-2 rounded-card border border-border bg-surface-2 p-3">
        <span className="text-dense font-semibold text-ink">{titulo}</span>
        <p className="text-dense text-t1 text-pretty">{para}</p>
        <p role="alert" className="flex flex-wrap items-center gap-2 text-dense text-err">
          Não deu para gerar o código agora.
          <Button size="sm" variant="secondary" onClick={() => setTentativa((t) => t + 1)}>
            Tentar de novo
          </Button>
        </p>
      </li>
    );
  }
  if (!dado) {
    return (
      <li className="flex flex-col gap-2 rounded-card border border-border bg-surface-2 p-3">
        <span className="text-dense font-semibold text-ink">{titulo}</span>
        <p className="flex items-center gap-2 text-dense text-t2">
          <Spinner size={14} /> Gerando o código…
        </p>
      </li>
    );
  }

  const selo: { tom: TomStatus; texto: string } | null =
    dado.instalado === true
      ? { tom: "ok", texto: "No tema" }
      : dado.instalado === false
        ? { tom: "warn", texto: "Fora do tema" }
        : null;

  return (
    <ItemCodigo
      titulo={titulo}
      para={para}
      nota="Pelo xcart: no Rastreamento da vitrine, em Script no tema, clique em Instalar."
      selo={selo}
      recolhido={dado.instalado === true}
      codigo={dado.codigo}
    >
      {dado.ligado === false ? (
        <p className="text-dense text-warn text-pretty">
          O rastreamento está desligado na vitrine: o script não manda nada até você ligar, com o mesmo pixel da loja
          de checkout.
        </p>
      ) : null}
      <div>{linkRastreamento}</div>
    </ItemCodigo>
  );
}
