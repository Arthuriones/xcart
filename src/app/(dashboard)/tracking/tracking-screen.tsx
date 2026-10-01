"use client";

import { useEffect, useEffectEvent, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Copy,
  ExternalLink,
  Loader2,
  Minus,
  Power,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DestinoNaTela, LojaTracking } from "@/lib/tracking/queries";
import type { DiagnosticoLoja } from "@/lib/tracking/diagnostico";
import { cn } from "@/lib/utils";
import { PainelPlataforma } from "./destinos-ui";
import {
  ORDEM_SAUDE,
  aceitamCompra,
  apelido,
  emModoTeste,
  melhorDa,
  oQueFalta,
  plural,
  quando,
  recebemCompra,
  saudeDaLoja,
  textoProblema,
  vereditoDoDestino,
  type Saude,
  type Tom,
} from "./saude";
import { Aviso, Ponto, Selo, TagPlataforma } from "./selo";

// ============================================================================
// Tela de rastreamento.
//
// A pergunta que ela responde nao e "esta configurado?" -- e "esta chegando?".
// Sao coisas diferentes: o endpoint de conversao do Google responde 200 mesmo
// quando ignora o conteudo, entao configuracao correta e envio bem-sucedido
// convivem com zero conversao contada do outro lado.
//
// Por isso o desenho poe o VEREDITO no topo de cada loja, com a comparacao que
// de fato denuncia ("3 pedidos, 0 compras enviadas"), e empurra a configuracao
// para baixo, fechada. Configuracao e o que se mexe uma vez; saude e o que se
// olha sempre.
//
// O DESTINO E UMA LISTA
//
// Cinco contas de Google anunciando produtos diferentes do mesmo catalogo e o
// caso real do Arthur. Cada conta e uma linha em `tracking_destinations`, com o
// seu proprio conjunto de rotulos, e cada uma e julgada sozinha aqui: uma pode
// estar chegando e a outra nao.
// ============================================================================

const FOCO =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/40";

/** Botao pequeno de linha (checklist e "O que fazer"). */
const BOTAO_LINHA = cn(
  "inline-flex h-8 shrink-0 items-center gap-1 rounded-[5px] border border-border bg-surface px-2 text-[11.5px] font-semibold text-t2 hover:border-[var(--border-strong)] hover:text-ink disabled:opacity-50 sm:h-6",
  FOCO
);

const TOM_DA_SAUDE: Record<Saude, Tom> = {
  parado: "err",
  atencao: "warn",
  ok: "ok",
  desligado: "neutro",
};

/**
 * Quantas COMPRAS foram creditadas a um anuncio, por plataforma.
 *
 * E a leitura que o total de "sem click id" esconde. Trafego organico sem click
 * id e normal e enche o numero geral; venda sem click id quer dizer que aquela
 * venda nao foi creditada a campanha nenhuma. Se TODAS estiverem assim, ou o
 * trafego nao veio de anuncio, ou a captura quebrou -- e sao conclusoes bem
 * diferentes.
 *
 * Um destino POR PLATAFORMA: dentro dela a falta de click id e propriedade do
 * EVENTO, nao da conta -- todas recebem o mesmo pedido com os mesmos sinais.
 * Entre plataformas nao: a venda pode ter gclid e nao ter fbc, e um so numero
 * esconderia que o Meta esta otimizando sem saber de onde veio a venda.
 *
 * Sem o prefixo da plataforma: a linha onde isto aparece ja leva a etiqueta.
 */
function Atribuicao({
  destino,
  clique,
}: {
  destino: DestinoNaTela;
  clique: "gclid" | "fbc";
}) {
  const total = destino.contagem.porEvento.purchase ?? 0;
  if (total === 0) return null;

  const semClique = destino.contagem.semAtribPorEvento.purchase ?? 0;
  if (semClique === 0) return null;

  const todas = semClique >= total;
  return (
    <p
      className={cn(
        "flex items-center gap-1.5 text-[11.5px]",
        todas ? "text-ink" : "text-t3"
      )}
    >
      <Ponto tom={todas ? "warn" : "neutro"} tamanho={5} />
      {todas
        ? `Nenhuma venda creditada a um anúncio — ${semClique} de ${total} sem ${clique}`
        : total === 1
          ? `${semClique} de 1 compra sem ${clique}`
          : `${semClique} de ${total} compras sem ${clique}`}
    </p>
  );
}

/**
 * O veredito da loja.
 *
 * Compara a COMPRA com os pedidos, nao o total de eventos: carrinho e checkout
 * acontecem muito mais que venda, e somados dariam "300 de 4 pedidos", que nao
 * diz nada. E compara POR DESTINO -- a mesma venda rende uma linha para cada
 * conta configurada, e somar transformaria 1 pedido em 5 compras.
 *
 * E compara PEDIDO A PEDIDO: todo pedido vai para todo destino, entao 8 compras
 * para 10 pedidos sao 2 vendas perdidas, nao "2 que vieram de fora do anuncio".
 * So o "nenhuma compra" acusava antes, e perda parcial passava calada.
 */
function ComprasChegando({
  loja,
  diag,
  alvos,
}: {
  loja: LojaTracking;
  diag: DiagnosticoLoja | null;
  alvos: DestinoNaTela[];
}) {
  const pedidos = diag?.pedidos7d ?? null;
  const melhorGoogle = melhorDa(alvos, "google");
  const melhorMeta = melhorDa(alvos, "meta");

  return (
    <div className="border-t border-[var(--border-subtle)]">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 pb-1.5 pt-3">
        <h3 className="text-[12.5px] font-semibold text-ink">Compras chegando</h3>
        <span className="font-mono text-[11px] text-t3">
          {pedidos === null
            ? "7 dias · pedidos: não deu para verificar"
            : `7 dias · ${plural(pedidos, "pedido", "pedidos")} na loja`}
        </span>
      </div>

      {alvos.map((d) => {
        const v = vereditoDoDestino(d, loja, diag);
        const melhor = d.plataforma === "google" ? melhorGoogle : melhorMeta;
        return (
          <div
            key={d.id}
            className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-t border-[var(--border-subtle)] px-4 py-2.5"
          >
            <TagPlataforma plataforma={d.plataforma} />
            <p className="min-w-0 truncate text-[12.5px] font-medium text-ink">
              {d.nome || d.conta}
              {d.nome && (
                <span className="ml-1 font-mono text-[11px] font-normal text-t3">
                  {d.conta}
                </span>
              )}
            </p>
            <div className="text-right">
              {v.tipo === "razao" ? (
                <>
                  <p
                    className={cn(
                      "font-mono text-[18px] font-medium leading-none tabular-nums",
                      v.faltam === 0 ? "text-ink" : "text-[var(--err)]"
                    )}
                  >
                    {v.chegaram}/{v.esperados}
                  </p>
                  <p className="mt-1 flex items-center justify-end gap-1 text-[11px]">
                    {v.esperados === 0 ? (
                      <span className="text-t3">nenhum pedido ainda</span>
                    ) : v.faltam === 0 ? (
                      <span className="text-t3">pedidos com compra</span>
                    ) : (
                      <span className="flex items-center gap-1 text-[var(--err)]">
                        <Ponto tom="err" tamanho={5} />
                        {v.faltam === 1 ? "falta 1" : `faltam ${v.faltam}`}
                      </span>
                    )}
                  </p>
                </>
              ) : v.tipo === "sem-pedidos" ? (
                <>
                  <p className="font-mono text-[18px] font-medium leading-none tabular-nums text-ink">
                    {v.compras}
                  </p>
                  <p className="mt-1 text-[11px] text-t3">
                    {v.compras === 1 ? "compra enviada" : "compras enviadas"}
                  </p>
                </>
              ) : (
                <>
                  <p className="font-mono text-[18px] font-medium leading-none tabular-nums text-[var(--t4)]">
                    —
                  </p>
                  <p className="mt-1 text-[11px] text-t3">sem contagem</p>
                </>
              )}
            </div>
            {melhor?.id === d.id && (
              <div className="col-span-2 col-start-2 empty:hidden">
                <Atribuicao
                  destino={d}
                  clique={d.plataforma === "google" ? "gclid" : "fbc"}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const ICONE_DO_TOM: Record<Tom, { Icone: typeof Check; cor: string }> = {
  ok: { Icone: Check, cor: "var(--ok)" },
  err: { Icone: CircleAlert, cor: "var(--err)" },
  warn: { Icone: AlertTriangle, cor: "var(--warn)" },
  neutro: { Icone: Minus, cor: "var(--t4)" },
};

/** Uma linha de "Pre-requisitos": icone, nome, estado em palavra e o conserto. */
function LinhaChecagem({
  id,
  tom,
  rotulo,
  estado,
  acao,
  children,
}: {
  id?: string;
  tom: Tom;
  rotulo: ReactNode;
  estado: { tom: Tom; texto: string };
  acao?: ReactNode;
  children?: ReactNode;
}) {
  const { Icone, cor } = ICONE_DO_TOM[tom];
  return (
    <div
      id={id}
      className="flex scroll-mt-20 flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--border-subtle)] px-3.5 py-2.5 first:border-t-0"
    >
      <Icone aria-hidden className="h-3.5 w-3.5 shrink-0" style={{ color: cor }} />
      {/* Nome e selo quebram juntos: no celular o selo desce para baixo do
          nome, alinhado com ele, e nao para baixo do icone. */}
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[12.5px] font-medium text-ink">{rotulo}</span>
        <Selo tom={estado.tom}>{estado.texto}</Selo>
      </div>
      {acao && <span className="ml-auto flex shrink-0">{acao}</span>}
      {children}
    </div>
  );
}

function Dica({ children }: { children: ReactNode }) {
  return <p className="w-full pl-[26px] text-[11.5px] text-t3">{children}</p>;
}

/**
 * O Custom Pixel do checkout.
 *
 * E copiar e colar, nao um botao que instala: `webPixelCreate` pela Admin API
 * responde "No extension found" -- ela so funciona para app que declara uma Web
 * Pixel Extension e faz deploy pelo Shopify CLI. Enquanto o xcart nao tiver essa
 * extensao, colar no admin e o unico caminho, e roda no mesmo sandbox.
 *
 * Depois de colar nao ha mais nada a fazer: o pixel se anuncia no primeiro
 * evento, e o servidor liga sozinho. Por isso aqui nao existe botao de "ja
 * instalei" -- passo manual que o lojista pode esquecer de marcar e um estado
 * que mente.
 */
function PixelDoCheckout({
  loja,
  abrirSinal,
  onSinalAtendido,
}: {
  loja: LojaTracking;
  abrirSinal: number;
  onSinalAtendido: () => void;
}) {
  const estado: "falta" | "antigo" | "atual" = !loja.pixelCheckoutAtivo
    ? "falta"
    : loja.pixelCheckoutDesatualizado
      ? "antigo"
      : "atual";
  const [codigo, setCodigo] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [aberto, setAberto] = useState(false);

  async function buscar() {
    setAberto((v) => !v);
    if (codigo || carregando) return;
    setCarregando(true);
    try {
      const r = await fetch(`/api/tracking/pixel?storeId=${loja.storeId}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Falha ao gerar o código.");
      setCodigo(j.codigo);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao gerar o código.");
      setAberto(false);
    } finally {
      setCarregando(false);
    }
  }

  async function copiar() {
    if (!codigo) return;
    try {
      await navigator.clipboard.writeText(codigo);
      toast.success("Código copiado.");
    } catch {
      toast.error("Não consegui copiar. Selecione o texto e copie na mão.");
    }
  }

  // O CTA do "O que fazer" abre o codigo daqui; sem estado global. O sinal e
  // zerado ao ser atendido: sem isso, fechar e reabrir a configuracao
  // remontaria este bloco e abriria o codigo de novo sozinho.
  const atender = useEffectEvent(() => {
    onSinalAtendido();
    if (!aberto) void buscar();
  });
  useEffect(() => {
    if (abrirSinal <= 0) return;
    // Na proxima volta do loop: o bloco acabou de montar (a configuracao abriu
    // agora) e o efeito nao deve mexer em estado de forma sincrona. setTimeout
    // e nao requestAnimationFrame: este dispara o fetch, e rAF nao roda em aba
    // em segundo plano.
    const id = setTimeout(() => atender(), 0);
    return () => clearTimeout(id);
  }, [abrirSinal]);

  const tom: Tom = estado === "atual" ? "ok" : estado === "antigo" ? "warn" : "err";
  const areaId = `pixel-codigo-${loja.storeId}`;

  return (
    <LinhaChecagem
      id={`pixel-${loja.storeId}`}
      tom={tom}
      rotulo="Pixel do checkout"
      estado={{
        tom,
        texto:
          estado === "atual"
            ? "Instalado"
            : estado === "antigo"
              ? "Atualizar código"
              : "Falta instalar",
      }}
      acao={
        <button
          type="button"
          onClick={buscar}
          disabled={carregando}
          aria-expanded={aberto}
          aria-controls={areaId}
          className={BOTAO_LINHA}
        >
          {carregando ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : aberto ? (
            "Esconder código"
          ) : estado === "atual" ? (
            "Ver código"
          ) : (
            "Mostrar código para colar"
          )}
        </button>
      }
    >
      {!aberto && estado === "falta" && (
        <Dica>Sem ele o checkout e os dados de pagamento não são medidos.</Dica>
      )}
      {!aberto && estado === "antigo" && (
        <Dica>Troque o código do pixel que já existe — não crie um segundo.</Dica>
      )}

      {aberto && (
        <div id={areaId} className="mt-2 w-full space-y-2 pl-[26px]">
          {/* Tres estados, e o do meio e o que faltava. O codigo so aparecia com o
              pixel AUSENTE -- e a loja que tinha o trecho antigo colado, sem o id
              da loja, nao tinha onde pegar o novo. */}
          {estado === "falta" && (
            <ol className="list-decimal space-y-0.5 pl-4 text-[11.5px] text-t2">
              <li>
                No admin da Shopify:{" "}
                <strong className="font-medium text-ink">
                  Configurações → Eventos de cliente
                </strong>
              </li>
              <li>
                <strong className="font-medium text-ink">
                  Adicionar pixel personalizado
                </strong>
                , dê um nome (ex.: xcart)
              </li>
              <li>
                Cole o código abaixo,{" "}
                <strong className="font-medium text-ink">Salvar</strong> e{" "}
                <strong className="font-medium text-ink">Conectar</strong>
              </li>
            </ol>
          )}

          {estado === "antigo" && (
            <div className="space-y-1.5 rounded-md border border-[var(--warn-border)] bg-[var(--warn-bg)] p-2.5 text-[11.5px] text-t2">
              <p className="font-medium text-ink">
                O pixel está funcionando, mas é o código antigo.
              </p>
              <p>
                O novo leva o id da loja, o que impede que outra conta desvie os eventos do
                teu checkout. Troque o código do pixel que já existe —{" "}
                <strong className="font-medium text-ink">não crie um segundo</strong>:
              </p>
              <ol className="list-decimal space-y-0.5 pl-4">
                <li>
                  No admin da Shopify:{" "}
                  <strong className="font-medium text-ink">
                    Configurações → Eventos de cliente
                  </strong>
                </li>
                <li>
                  Abra o pixel do xcart,{" "}
                  <strong className="font-medium text-ink">apague o código</strong> que
                  está lá
                </li>
                <li>
                  Cole o código abaixo e clique em{" "}
                  <strong className="font-medium text-ink">Salvar</strong>
                </li>
              </ol>
            </div>
          )}

          {codigo && (
            <>
              <Button size="xs" variant="outline" onClick={copiar}>
                <Copy className="h-3.5 w-3.5" />
                Copiar
              </Button>
              {/* Uma linha so, com o id da loja: a logica mora em
                  /xcart-pixel.js. Por isso o campo e baixo -- antes era um
                  bloco de 60 linhas. */}
              <textarea
                readOnly
                value={codigo}
                onFocus={(e) => e.currentTarget.select()}
                className="h-20 w-full rounded-md border border-border bg-surface-2 p-2 font-mono text-[10.5px] leading-relaxed text-t1"
                aria-label="Código do pixel do checkout"
              />
              <p className="text-[11.5px] text-t3">
                Depois de salvar, não precisa fazer mais nada aqui — o pixel se anuncia no
                próximo checkout, e esta seção passa sozinha para &quot;instalado&quot;.
              </p>
            </>
          )}

          {estado !== "falta" && (
            <p className="text-[11.5px] text-t3">
              O &quot;iniciar checkout&quot; vindo do tema passou a ser ignorado: o do pixel é
              o checkout de verdade, e contar os dois seria a mesma ação duas vezes.
            </p>
          )}

          <details className="group/pixel">
            <summary className={cn("cursor-pointer text-[11.5px] text-t3 hover:text-ink", FOCO)}>
              Para que serve este pixel
            </summary>
            <p className="mt-1 text-[11.5px] text-t2">
              O checkout da Shopify não é tema, então o nosso script não entra lá. Sem este
              pixel, &quot;iniciar checkout&quot; é o <strong>clique no botão</strong> e não
              existe &quot;dados de pagamento&quot; — o passo que separa desistência no frete
              de cartão recusado. Ele não envia nada para o Meta nem para o Google: avisa o
              xcart, e o envio continua saindo do servidor.
            </p>
          </details>
        </div>
      )}
    </LinhaChecagem>
  );
}

type ItemAFazer = {
  chave: string;
  tom: "err" | "warn";
  titulo: string;
  dica: string;
  dicaTitulo?: string;
  botao: { rotulo: string; onClick: () => void; disabled?: boolean; carregando?: boolean };
};

function CardLoja({
  loja,
  diag,
  comecarAberto,
}: {
  loja: LojaTracking;
  diag: DiagnosticoLoja | null;
  comecarAberto: boolean;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(comecarAberto);
  const [ligado, setLigado] = useState(loja.ligado);
  const [salvando, setSalvando] = useState(false);
  const [instalando, setInstalando] = useState<string | null>(null);
  // Sinal para o pixel abrir o codigo: um contador, nao um booleano, para o
  // segundo clique tambem chegar.
  const [pedirCodigo, setPedirCodigo] = useState(0);

  const temGoogle = loja.destinos.some((d) => d.plataforma === "google" && d.ativo);
  // aceitamCompra, nao recebemCompra: ligar so com o Meta em modo teste e o
  // jeito de conferir no Events Manager antes de valer.
  const podeLigar = aceitamCompra(loja).length > 0;
  // Sem o app, a credencial nao vale: checar e instalar no tema so dariam erro.
  const shopifyAlcancavel = ligado && !loja.desinstalada;

  // `ligado` LOCAL: o card responde ao clique na hora. `temDiag` e o da carga --
  // so loja ligada ao abrir a pagina passou pelo diagnostico.
  const temDiag = loja.ligado;
  const s = saudeDaLoja(loja, ligado, diag, temDiag);
  const alvos = recebemCompra(loja);
  const aceitam = aceitamCompra(loja);
  const emTeste = aceitam.filter(emModoTeste);

  /** So UI, nao busca nada: abre a configuracao e rola ate o alvo. */
  function irPara(id: string) {
    setAberto(true);
    requestAnimationFrame(() =>
      document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" })
    );
  }

  /**
   * Instala a tag no tema pela tela.
   *
   * Antes isto so existia como script, entao ligar rastreamento numa loja nova
   * dependia de alguem com o repo na mao -- e sem a tag no tema o gclid nunca
   * vira cart attribute e o funil inteiro nao sai, com a configuracao parecendo
   * perfeita aqui.
   */
  async function instalarTag(comRemarketing: boolean) {
    setInstalando(comRemarketing ? "remarketing" : "snippet");
    try {
      const r = await fetch("/api/tracking/snippet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId: loja.storeId, remarketing: comRemarketing }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Falha ao gravar o tema.");
      toast.success(
        j.mudou ? `Tag gravada no tema "${j.temaNome}".` : "O tema já estava assim."
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao gravar o tema.");
    } finally {
      setInstalando(null);
    }
  }

  /** O interruptor da loja: vale por cima de todos os destinos. */
  async function alternar(novoLigado: boolean) {
    setSalvando(true);
    try {
      const r = await fetch("/api/tracking/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId: loja.storeId, enabled: novoLigado }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Falha ao salvar.");
      setLigado(novoLigado);
      toast.success(novoLigado ? "Rastreamento ligado." : "Rastreamento desligado.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setSalvando(false);
    }
  }

  // ---- faixa de estado -------------------------------------------------------

  function linhaDoOk(): string {
    if (!temDiag) return "Recarregue a página para conferir";
    if (diag?.pedidos7d === 0) return "Nenhum pedido nos últimos 7 dias — nada para comparar ainda";
    let pior: { chegaram: number; esperados: number } | null = null;
    for (const d of alvos) {
      const v = vereditoDoDestino(d, loja, diag);
      if (v.tipo !== "razao" || v.esperados === 0) continue;
      if (!pior || v.chegaram / v.esperados < pior.chegaram / pior.esperados) pior = v;
    }
    if (pior) {
      return pior.esperados === 1
        ? `${pior.chegaram} de 1 pedido chegou`
        : `${pior.chegaram} de ${pior.esperados} pedidos chegaram`;
    }
    const n = alvos.reduce((m, d) => Math.max(m, d.contagem.porEvento.purchase ?? 0), 0);
    return n === 1 ? "1 compra enviada em 7 dias" : `${n} compras enviadas em 7 dias`;
  }

  const faixa = {
    ok: {
      Icone: Check,
      disco: "var(--ok-bg)",
      cor: "var(--ok)",
      titulo: "Tudo certo",
    },
    atencao: {
      Icone: AlertTriangle,
      disco: "var(--warn-bg)",
      cor: "var(--warn)",
      titulo: "Precisa de atenção",
    },
    // Disco em surface: sobre o fundo vermelho da faixa, err-bg sumiria.
    parado: {
      Icone: CircleAlert,
      disco: "var(--surface)",
      cor: "var(--err)",
      titulo: "Parado",
    },
    desligado: {
      Icone: Power,
      disco: "var(--track)",
      cor: "var(--t3)",
      titulo: "Desligado",
    },
  }[s.saude];

  let subLinha: ReactNode;
  if (s.saude === "ok") {
    subLinha = linhaDoOk();
  } else if (s.saude === "desligado") {
    subLinha = podeLigar
      ? "Pronto para ligar"
      : loja.destinos.length > 0
        ? "Para ligar, um destino precisa receber a compra: no Google o rótulo da compra, no Meta o token do CAPI."
        : "Cadastre uma conta do Google ou um pixel do Meta para poder ligar.";
  } else {
    subLinha = (
      <>
        {s.motivos[0]?.texto}
        {s.motivos.length > 1 && (
          <span className="text-t3"> · e mais {s.motivos.length - 1}</span>
        )}
      </>
    );
  }

  // ---- "O que fazer": so o que se conserta na configuracao ------------------
  // Os alarmes das faixas acima (desinstalado, teto, modo teste, contagem,
  // ninguem recebendo, pedidos faltando) nao se repetem aqui.

  const itens: ItemAFazer[] = [];
  if (ligado) {
    if (diag?.temWebhook === false && shopifyAlcancavel) {
      itens.push({
        chave: "webhook",
        tom: "err",
        titulo: "Webhook de pedidos não inscrito",
        dica: "Sem ele os pedidos não viram compra. A inscrição acontece na instalação do app; se continuar faltando, reinscreva o webhook desta loja.",
        botao: {
          rotulo: "Ver como resolver",
          onClick: () => irPara(`check-webhook-${loja.storeId}`),
        },
      });
    }
    if (shopifyAlcancavel && (diag?.temSnippet === false || diag?.snippetComId === false)) {
      const falta = diag?.temSnippet === false;
      itens.push({
        chave: "snippet",
        tom: "warn",
        titulo: falta ? "Snippet faltando no tema" : "Snippet antigo no tema",
        dica: falta
          ? "Sem ele ver produto e carrinho não saem, e o clique do anúncio não chega no pedido."
          : "A versão nova leva o id da loja e não deixa outra conta receber os seus eventos.",
        botao: {
          rotulo: falta ? "Instalar snippet" : "Reinstalar snippet",
          onClick: () => void instalarTag(false),
          disabled: instalando !== null,
          carregando: instalando === "snippet",
        },
      });
    }
    if (!loja.pixelCheckoutAtivo || loja.pixelCheckoutDesatualizado) {
      const falta = !loja.pixelCheckoutAtivo;
      itens.push({
        chave: "pixel",
        tom: "warn",
        titulo: falta ? "Pixel do checkout não instalado" : "Pixel do checkout com código antigo",
        dica: falta
          ? "Sem ele o checkout e os dados de pagamento não são medidos."
          : "Troque o código do pixel que já existe — não crie um segundo.",
        botao: {
          rotulo: falta ? "Ver como instalar" : "Ver código novo",
          onClick: () => {
            setPedirCodigo((n) => n + 1);
            irPara(`pixel-${loja.storeId}`);
          },
        },
      });
    }
    for (const d of loja.destinos) {
      const falta = d.ativo ? oQueFalta(d) : null;
      if (!falta) continue;
      itens.push({
        chave: `incompleto-${d.id}`,
        tom: "err",
        titulo: `${apelido(d)} incompleto`,
        dica: falta,
        botao: { rotulo: "Ver destino", onClick: () => irPara(`destino-${d.id}`) },
      });
    }
    for (const d of loja.destinos) {
      const n = d.contagem.falharam;
      if (n <= 0) continue;
      itens.push({
        chave: `falhou-${d.id}`,
        tom: "warn",
        titulo: `${apelido(d)}: ${n === 1 ? "1 envio falhou" : `${n} envios falharam`}`,
        dica: d.contagem.ultimoErro?.slice(0, 90) ?? "Sem detalhe do erro.",
        dicaTitulo: d.contagem.ultimoErro ?? undefined,
        botao: { rotulo: "Ver destino", onClick: () => irPara(`destino-${d.id}`) },
      });
    }
    if (temDiag && (diag === null || diag.pedidos7d === null)) {
      itens.push({
        chave: "diagnostico",
        tom: "warn",
        titulo: "Não deu para conferir a loja na Shopify",
        dica: textoProblema(diag?.problema ?? null),
        botao: { rotulo: "Recarregar", onClick: () => router.refresh() },
      });
    }
  }

  // ---- faixas de alarme -----------------------------------------------------

  const temBanner =
    (loja.desinstalada && ligado) ||
    loja.tetoAtingidoRecente ||
    (ligado &&
      (emTeste.length > 0 ||
        (loja.contagemIndisponivel && alvos.length > 0) ||
        alvos.length === 0 ||
        s.faltas.length > 0));

  // "Abrir configuracao" leva ao painel onde o lojista ja tem conta; sem
  // nenhuma, ao Google, que e o caso mais comum.
  const plataformaDaConfig =
    loja.destinos.length > 0 && loja.destinos.every((d) => d.plataforma === "meta")
      ? "meta"
      : "google";

  const faltasPorDestino = ligado
    ? Object.fromEntries(s.faltas.map((f) => [f.d.id, f.faltam]))
    : undefined;

  const estadoPixel = !loja.pixelCheckoutAtivo
    ? "não instalado"
    : loja.pixelCheckoutDesatualizado
      ? "desatualizado"
      : "instalado";

  return (
    <section
      className={cn(
        "overflow-hidden rounded-xl border bg-surface",
        !ligado
          ? "border-dashed border-[var(--border-strong)]"
          : s.saude === "parado"
            ? "border-[var(--err-border)]"
            : "border-border"
      )}
    >
      {/* A. cabecalho */}
      <div className="flex items-start gap-3 px-4 pb-3 pt-3.5">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[13.5px] font-semibold text-ink">{loja.nome}</h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-t3">
            <span className="min-w-0 max-w-full truncate font-mono">{loja.dominio}</span>
            {loja.ultimoEnvio ? (
              // O texto relativo e calculado no servidor e de novo no navegador;
              // a virada de minuto entre os dois nao e erro de hidratacao.
              <span suppressHydrationWarning>· último envio {quando(loja.ultimoEnvio)}</span>
            ) : ligado ? (
              <span>· nenhum envio em 7 dias</span>
            ) : null}
          </p>
        </div>
        <Button
          size="xs"
          onClick={() => alternar(!ligado)}
          disabled={salvando || (!ligado && !podeLigar)}
          variant={ligado ? "outline" : "default"}
          className="h-8 shrink-0 px-[11px] text-[12px] font-semibold sm:h-[26px]"
          title={
            !ligado && !podeLigar
              ? "Cadastre um destino que receba a compra para poder ligar"
              : undefined
          }
        >
          {salvando ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : ligado ? (
            "Desligar"
          ) : (
            "Ligar"
          )}
        </Button>
      </div>

      {/* B. faixa de estado: forma + palavra + cor, nunca so a cor */}
      <div
        className={cn(
          "flex items-start gap-3 border-t border-[var(--border-subtle)] px-4 py-3",
          s.saude === "parado" && "bg-[var(--err-bg)]"
        )}
      >
        <span
          className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full"
          style={{ background: faixa.disco }}
        >
          <faixa.Icone aria-hidden className="h-3.5 w-3.5" style={{ color: faixa.cor }} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold leading-tight text-ink">{faixa.titulo}</p>
          <p className="mt-0.5 text-[12px] text-t2">{subLinha}</p>
        </div>
      </div>

      {/* C. alarmes */}
      {temBanner && (
        <div className="flex flex-col gap-2 px-4 pb-3">
          {loja.desinstalada && ligado && (
            <Aviso
              tom="err"
              titulo="O app foi desinstalado desta loja — o rastreamento parou"
              detalhe="Sem o app não chega pedido nem sai compra. Reinstale o xcart nesta loja para voltar."
              acao={{ rotulo: "Abrir Lojas", href: "/stores" }}
            />
          )}

          {/* Teto do coletor. Fica ACIMA do veredito porque muda como ler
              todos os numeros abaixo: com evento sendo descartado, "poucas
              conversoes" nao quer dizer que o envio quebrou. Aparece mesmo com
              a loja desligada, como antes. */}
          {loja.tetoAtingidoRecente && (
            <Aviso
              tom="warn"
              titulo="Esta loja bateu no teto de eventos por hora nas últimas 24h."
              detalhe="Parte do funil foi descartada — os números abaixo estão incompletos. O teto existe porque o coletor é público; se o tráfego é legítimo, me avise para subir o limite desta loja."
            />
          )}

          {/* Fica acima do resto do veredito: muda como ler o resto. A compra
              sai, aparece no Events Manager, e a campanha nao recebe conversao
              nenhuma. */}
          {ligado && emTeste.length > 0 && (
            <Aviso
              tom="warn"
              titulo={emTeste.map((d) => (
                <p key={d.id}>
                  {apelido(d)} em modo teste — compras não contam como conversão
                </p>
              ))}
              detalhe="Tire o código de teste do destino quando terminar de conferir no Events Manager."
              acao={{ rotulo: "Ver destino", onClick: () => irPara(`destino-${emTeste[0].id}`) }}
            />
          )}

          {ligado && loja.contagemIndisponivel && alvos.length > 0 && (
            <Aviso
              tom="warn"
              titulo="Não deu para contar os envios agora"
              detalhe="A comparação com os pedidos ficou de fora. Recarregue a página em instantes."
              acao={{ rotulo: "Recarregar", onClick: () => router.refresh() }}
            />
          )}

          {ligado && alvos.length === 0 && (
            <Aviso
              tom="err"
              titulo={
                loja.destinos.length > 0
                  ? "Nenhum destino está recebendo a compra"
                  : "Nenhum destino cadastrado ainda"
              }
              detalhe={
                loja.destinos.length > 0
                  ? "Confira o rótulo da compra no Google e o token no Meta."
                  : "Adicione uma conta do Google, um pixel do Meta, ou os dois."
              }
              acao={{
                rotulo: "Abrir configuração",
                onClick: () => irPara(`destinos-${plataformaDaConfig}-${loja.storeId}`),
              }}
            />
          )}

          {ligado && s.faltas.length > 0 && (
            <Aviso
              tom="err"
              titulo={s.faltas.map(({ d, faltam }) => (
                <p key={d.id}>
                  {plural(faltam, "pedido", "pedidos")} sem compra enviada em {apelido(d)}
                </p>
              ))}
              detalhe={
                diag?.temWebhook === false
                  ? "O webhook de pedidos não está inscrito — é quase certo que seja isso."
                  : "Todo pedido vai para todo destino: o que falta aqui é venda que a campanha não viu. Confira as falhas do destino, o rótulo da compra e, no Meta, o token do CAPI."
              }
              acao={{
                rotulo: "Ver destinos",
                onClick: () =>
                  irPara(`destinos-${s.faltas[0].d.plataforma}-${loja.storeId}`),
              }}
            />
          )}
        </div>
      )}

      {/* D. compras chegando */}
      {ligado && alvos.length > 0 && (
        <ComprasChegando loja={loja} diag={diag} alvos={alvos} />
      )}

      {/* E. o que fazer */}
      {ligado && itens.length > 0 && (
        <div className="border-t border-[var(--border-subtle)]">
          <div className="flex items-baseline gap-2 px-4 pb-1.5 pt-3">
            <h3 className="text-[12.5px] font-semibold text-ink">O que fazer</h3>
            <span className="font-mono text-[11px] text-[var(--t4)]">{itens.length}</span>
          </div>
          {itens.map((it) => (
            <div
              key={it.chave}
              className="flex flex-wrap items-start gap-x-3 gap-y-1.5 border-t border-[var(--border-subtle)] px-4 py-2.5"
            >
              <Ponto tom={it.tom} tamanho={6} className="mt-[6px]" />
              <div className="min-w-0 flex-1 basis-[calc(100%_-_18px)] sm:basis-0">
                <p className="text-[12.5px] text-ink">{it.titulo}</p>
                <p className="text-[11.5px] text-t3" title={it.dicaTitulo}>
                  {it.dica}
                </p>
              </div>
              <button
                type="button"
                onClick={it.botao.onClick}
                disabled={it.botao.disabled}
                className={cn(BOTAO_LINHA, "ml-[18px] sm:ml-auto")}
              >
                {it.botao.carregando ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  it.botao.rotulo
                )}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* F. configuracao, fechada por padrao: e o que se mexe uma vez */}
      <button
        type="button"
        aria-expanded={aberto}
        aria-controls={`config-${loja.storeId}`}
        onClick={() => setAberto((v) => !v)}
        className={cn(
          "flex w-full items-center gap-2 border-t border-[var(--border-subtle)] px-4 py-2.5 text-left text-[12px] font-medium text-t2 hover:bg-surface-2 hover:text-ink",
          FOCO
        )}
      >
        <span className="min-w-0">
          Configuração
          <span className="font-normal text-t3">
            {" "}
            · {plural(loja.destinos.length, "destino", "destinos")} · pixel {estadoPixel}
          </span>
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            "ml-auto h-4 w-4 shrink-0 text-[var(--t4)] transition-transform",
            aberto && "rotate-180"
          )}
        />
      </button>

      {aberto && (
        <div
          id={`config-${loja.storeId}`}
          className="space-y-5 border-t border-[var(--border-subtle)] bg-surface-2/50 px-4 py-4"
        >
          {/* Os pre-requisitos que moram na Shopify. Sem eles a configuracao
              pode estar perfeita e nada acontecer. */}
          <div>
            <div className="mb-2 flex items-center gap-2.5">
              <h3 className="text-[12.5px] font-semibold text-ink">Pré-requisitos</h3>
              <span aria-hidden className="h-px flex-1 bg-border" />
            </div>
            <div className="overflow-hidden rounded-lg border border-border bg-surface">
              {!ligado ? (
                <LinhaChecagem
                  tom="neutro"
                  rotulo="Webhook e tema"
                  estado={{ tom: "neutro", texto: "—" }}
                >
                  <Dica>Ligue o rastreamento para conferir na Shopify.</Dica>
                </LinhaChecagem>
              ) : loja.desinstalada ? (
                <LinhaChecagem
                  tom="neutro"
                  rotulo="Webhook e tema"
                  estado={{ tom: "neutro", texto: "—" }}
                >
                  <Dica>Reinstale o app para conferir.</Dica>
                </LinhaChecagem>
              ) : !temDiag ? (
                <LinhaChecagem
                  tom="neutro"
                  rotulo="Webhook e tema"
                  estado={{ tom: "neutro", texto: "—" }}
                >
                  <Dica>Recarregue a página para conferir webhook e tema.</Dica>
                </LinhaChecagem>
              ) : (
                <>
                  <ChecagemWebhook loja={loja} diag={diag} />

                  {/* Os botoes de tema ficam sempre visiveis, nao so quando
                      falta algo: reinstalar tambem serve para atualizar uma tag
                      antiga e para depois de trocar de tema, que apaga a tag
                      junto. */}
                  <LinhaChecagem
                    tom={
                      diag?.temSnippet == null
                        ? "neutro"
                        : diag.temSnippet === false
                          ? "err"
                          : diag.snippetComId === false
                            ? "warn"
                            : "ok"
                    }
                    rotulo="Snippet no tema"
                    estado={
                      diag?.temSnippet == null
                        ? { tom: "neutro", texto: "Não deu para verificar" }
                        : diag.temSnippet === false
                          ? { tom: "err", texto: "Faltando" }
                          : diag.snippetComId === false
                            ? { tom: "warn", texto: "Versão antiga" }
                            : { tom: "ok", texto: "Instalado" }
                    }
                    acao={
                      <button
                        type="button"
                        onClick={() => instalarTag(false)}
                        disabled={instalando !== null}
                        className={BOTAO_LINHA}
                      >
                        {instalando === "snippet" ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : diag?.temSnippet ? (
                          "Reinstalar snippet"
                        ) : (
                          "Instalar snippet"
                        )}
                      </button>
                    }
                  >
                    {diag?.temSnippet === false ? (
                      <Dica>
                        Sem ele ver produto e carrinho não saem, e o clique do anúncio não
                        chega no pedido.
                      </Dica>
                    ) : diag?.temSnippet && diag.snippetComId === false ? (
                      <Dica>
                        A versão nova leva o id da loja e não deixa outra conta receber os
                        seus eventos.
                      </Dica>
                    ) : null}
                  </LinhaChecagem>

                  <LinhaChecagem
                    tom={diag?.temRemarketing ? "ok" : "neutro"}
                    rotulo={
                      <>
                        Remarketing do Google{" "}
                        <span className="ml-1 rounded bg-[var(--track)] px-1.5 text-[10.5px] font-normal text-t3">
                          opcional
                        </span>
                      </>
                    }
                    estado={
                      diag?.temRemarketing == null
                        ? { tom: "neutro", texto: "Não deu para verificar" }
                        : diag.temRemarketing
                          ? { tom: "ok", texto: "Ligado" }
                          : { tom: "neutro", texto: "Desligado" }
                    }
                    acao={
                      <button
                        type="button"
                        onClick={() => instalarTag(true)}
                        disabled={instalando !== null || !temGoogle}
                        title={
                          !temGoogle
                            ? "Cadastre uma conta do Google Ads nesta loja antes"
                            : undefined
                        }
                        className={BOTAO_LINHA}
                      >
                        {instalando === "remarketing" ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : diag?.temRemarketing ? (
                          "Reinstalar com remarketing"
                        ) : (
                          "Ligar remarketing"
                        )}
                      </button>
                    }
                  >
                    <Dica>
                      Monta o público de remarketing no Google. A conversão funciona sem
                      ele.
                    </Dica>
                    {!temGoogle && (
                      <Dica>Cadastre uma conta do Google Ads nesta loja antes.</Dica>
                    )}
                  </LinhaChecagem>
                </>
              )}

              <PixelDoCheckout
                loja={loja}
                abrirSinal={pedirCodigo}
                onSinalAtendido={() => setPedirCodigo(0)}
              />

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] px-3.5 py-2 text-[11.5px] text-t3">
                <span>
                  {shopifyAlcancavel
                    ? "Os botões gravam no tema publicado. Recarregue a página para atualizar as checagens."
                    : ""}
                </span>
                <a
                  href={`https://${loja.dominio}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className={cn("inline-flex items-center gap-1 hover:text-ink", FOCO)}
                >
                  Abrir loja
                  <ExternalLink aria-hidden className="h-3 w-3" />
                </a>
              </div>
            </div>
          </div>

          <PainelPlataforma
            storeId={loja.storeId}
            plataforma="meta"
            destinos={loja.destinos}
            faltasPorDestino={faltasPorDestino}
          />
          <PainelPlataforma
            storeId={loja.storeId}
            plataforma="google"
            destinos={loja.destinos}
            faltasPorDestino={faltasPorDestino}
          />

          {!ligado && loja.destinos.length > 0 && !podeLigar && (
            <p className="text-[11.5px] text-t3">
              Para ligar, um destino precisa receber a compra: no Google o rótulo da
              compra, no Meta o token do CAPI.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/** O webhook de pedidos: sem ele o pedido entra e nada sai. */
function ChecagemWebhook({
  loja,
  diag,
}: {
  loja: LojaTracking;
  diag: DiagnosticoLoja | null;
}) {
  const ok = diag?.temWebhook ?? null;
  const id = `check-webhook-${loja.storeId}`;
  if (ok === null) {
    return (
      <LinhaChecagem
        id={id}
        tom="neutro"
        rotulo="Webhook de pedidos"
        estado={{ tom: "neutro", texto: "Não deu para verificar" }}
      >
        <Dica>{textoProblema(diag?.problema ?? null)}</Dica>
      </LinhaChecagem>
    );
  }
  if (ok) {
    return (
      <LinhaChecagem
        id={id}
        tom="ok"
        rotulo="Webhook de pedidos"
        estado={{ tom: "ok", texto: "Inscrito" }}
      />
    );
  }
  return (
    <LinhaChecagem
      id={id}
      tom="err"
      rotulo="Webhook de pedidos"
      estado={{ tom: "err", texto: "Faltando" }}
      acao={
        // loja.dominio e o shop_domain (myshopify), entao /admin abre o painel.
        <a
          href={`https://${loja.dominio}/admin`}
          target="_blank"
          rel="noreferrer noopener"
          className={BOTAO_LINHA}
        >
          Abrir admin da Shopify
          <ExternalLink aria-hidden className="h-3 w-3" />
        </a>
      }
    >
      <Dica>
        Sem ele os pedidos não viram compra. A inscrição acontece quando o app é
        instalado; se continuar faltando, a loja pode estar sem permissão de ler pedidos.
      </Dica>
      {/* O comando e para quem tem o repo; fica atras de um clique para nao
          parecer a instrucao principal para o lojista. */}
      <details className="w-full pl-[26px]">
        <summary className={cn("cursor-pointer text-[11.5px] text-t3 hover:text-ink", FOCO)}>
          Detalhe técnico
        </summary>
        <code className="mt-1 block select-all overflow-x-auto rounded bg-surface-2 p-2 font-mono text-[10.5px] text-t2">
          npm run op -- scripts/registrar-webhook-pedidos.ts --aplicar
        </code>
      </details>
    </LinhaChecagem>
  );
}

/** Copia do Numero de overview/page.tsx, com divisoria de 1px entre os blocos. */
function Numero({
  rotulo,
  valor,
  nota,
  alerta,
}: {
  rotulo: string;
  valor: string | number;
  nota?: string;
  alerta?: boolean;
}) {
  return (
    <div className="bg-surface px-4 py-3.5">
      <p className="text-[11.5px] text-t3">{rotulo}</p>
      <p className="mt-1.5 flex items-baseline">
        <span
          className={cn(
            "font-mono text-[22px] font-medium leading-none tabular-nums",
            alerta ? "text-[var(--err)]" : "text-ink"
          )}
        >
          {valor}
        </span>
        {nota && <span className="ml-1.5 text-[11px] text-t3">{nota}</span>}
      </p>
    </div>
  );
}

/** Copia do Chip de sales-screen.tsx: filtro por loja com poucas lojas. */
function Chip({
  ativo,
  onClick,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-md border px-[11px] text-[12px] font-semibold transition-colors sm:h-[27px]",
        FOCO,
        !ativo && "hover:border-[var(--border-strong)]"
      )}
      style={{
        borderColor: ativo ? "var(--solid)" : "var(--border)",
        background: ativo ? "var(--solid)" : "var(--surface)",
        color: ativo ? "var(--on-solid)" : "var(--t2)",
      }}
    >
      {children}
    </button>
  );
}

const VAZIO_CAIXA =
  "rounded-xl border border-dashed border-[var(--border-strong)] bg-surface px-8 py-11 text-center";
const VAZIO_CTA =
  "mt-4 inline-flex h-[30px] items-center rounded-md bg-[var(--solid)] px-[13px] text-[12.5px] font-semibold text-[var(--on-solid)] hover:bg-[var(--solid-hover)]";

export function TrackingScreen({
  lojas,
  diagnostico,
}: {
  lojas: LojaTracking[];
  diagnostico: Record<string, DiagnosticoLoja>;
}) {
  const [mostrarTodas, setMostrarTodas] = useState(false);
  /** "" = todas. O Select nao aceita valor vazio em item, daí o sentinela. */
  const [filtro, setFiltro] = useState("todas");

  // O KPI usa o ligado das PROPS e o card usa o ligado LOCAL -- a mesma
  // divisao de antes: o topo so muda quando a pagina recarrega.
  const { ativas, inativas, saudes, ativasOrdenadas, vendasRastreadas } = useMemo(() => {
    const ativas = lojas.filter((l) => l.ligado);
    const inativas = lojas.filter((l) => !l.ligado);
    const saudes = new Map(
      lojas.map((l) => [
        l.storeId,
        saudeDaLoja(l, l.ligado, diagnostico[l.storeId] ?? null, l.ligado),
      ])
    );
    // Ordena so pelas props; um toggle local nao reordena, o card nao pula
    // enquanto e clicado. sort e estavel: empate mantem a ordem do servidor.
    const ativasOrdenadas = [...ativas].sort(
      (a, b) =>
        ORDEM_SAUDE[saudes.get(a.storeId)!.saude] - ORDEM_SAUDE[saudes.get(b.storeId)!.saude]
    );

    // MAX entre os destinos, nao soma.
    //
    // A mesma venda rende uma linha para CADA conta configurada. Somar mostraria
    // "20" para 4 vendas com cinco contas -- o mesmo erro de contagem que a tela
    // corrige la embaixo, reaparecendo no lugar mais visivel da pagina. O max
    // responde "quantas vendas sairam para pelo menos um destino".
    //
    // Meta em modo teste fica fora: a compra dele vai para a aba de teste do
    // Events Manager, nao para a campanha -- nao e venda rastreada.
    const vendasRastreadas = ativas.reduce(
      (s, l) =>
        s +
        l.destinos
          .filter((d) => !emModoTeste(d))
          .reduce((m, d) => Math.max(m, d.contagem.porEvento.purchase ?? 0), 0),
      0
    );
    return { ativas, inativas, saudes, ativasOrdenadas, vendasRastreadas };
  }, [lojas, diagnostico]);

  const escolhida = filtro === "todas" ? null : lojas.find((l) => l.storeId === filtro);

  const rotuloDoFiltro = escolhida
    ? `${escolhida.nome} — ${escolhida.dominio}`
    : `Todas (${ativas.length} ativa(s), ${inativas.length} sem rastreamento)`;

  if (lojas.length === 0) {
    return (
      <div className={VAZIO_CAIXA}>
        <p className="text-[15px] font-semibold text-ink">Nenhuma loja conectada</p>
        <p className="mx-auto mt-1.5 max-w-[380px] text-[12.5px] text-t2">
          Conecte uma loja para começar a rastrear as vendas.
        </p>
        <Link href="/stores" className={cn(VAZIO_CTA, FOCO)}>
          Conectar loja
        </Link>
      </div>
    );
  }

  // Pedidos: soma do que a Shopify respondeu. Loja sem resposta fica de fora e
  // a nota avisa -- somar como zero esconderia que o numero e parcial.
  const pedidosPorLoja = ativas.map((l) => diagnostico[l.storeId]?.pedidos7d ?? null);
  const conhecidos = pedidosPorLoja.filter((n): n is number => n !== null);
  const somaPedidos = conhecidos.reduce((a, b) => a + b, 0);
  const pedidosParcial = conhecidos.length > 0 && conhecidos.length < pedidosPorLoja.length;

  // Substitui o contador comProblema; os criterios dele (desinstalada, webhook,
  // snippet) sao subconjunto dos motivos, e agora entra o pedido sem compra.
  const precisam = ativas.filter((l) => {
    const sd = saudes.get(l.storeId)!.saude;
    return sd === "parado" || sd === "atencao";
  });
  const algumParado = ativas.some((l) => saudes.get(l.storeId)!.saude === "parado");

  function escolherLoja() {
    setMostrarTodas(true);
    requestAnimationFrame(() =>
      document
        .getElementById("lojas-sem-rastreamento")
        ?.scrollIntoView({ block: "start", behavior: "smooth" })
    );
  }

  return (
    <div className="flex flex-col gap-[18px]">
      {ativas.length > 0 && (
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-[var(--border-subtle)] lg:grid-cols-4">
          <Numero rotulo="Lojas rastreando" valor={ativas.length} nota={`de ${lojas.length}`} />
          <Numero
            rotulo="Pedidos"
            valor={conhecidos.length === 0 ? "—" : somaPedidos}
            nota={pedidosParcial ? "em 7 dias · parcial" : "em 7 dias"}
          />
          <Numero rotulo="Vendas enviadas" valor={vendasRastreadas} nota="em 7 dias" />
          <Numero
            rotulo="Precisam de você"
            valor={precisam.length}
            nota={
              precisam.length === 0 ? "tudo certo" : precisam.length === 1 ? "loja" : "lojas"
            }
            alerta={algumParado}
          />
        </div>
      )}

      {/* Filtro por loja.
          Com dezenas de lojas cadastradas, a que importa fica perdida -- e o
          caso normal aqui e trabalhar numa loja de cada vez. Ate 6 lojas, chips
          (um clique); acima disso, a lista. */}
      {lojas.length > 1 &&
        (lojas.length <= 6 ? (
          <div className="flex flex-wrap gap-1.5">
            <Chip ativo={filtro === "todas"} onClick={() => setFiltro("todas")}>
              Todas as lojas
            </Chip>
            {[...ativasOrdenadas, ...inativas].map((l) => (
              <Chip
                key={l.storeId}
                ativo={filtro === l.storeId}
                onClick={() => setFiltro(l.storeId)}
              >
                <Ponto tom={TOM_DA_SAUDE[saudes.get(l.storeId)!.saude]} />
                <span className="max-w-[160px] truncate">{l.nome}</span>
                {!l.ligado && <span className="font-normal opacity-70"> · desligada</span>}
              </Chip>
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-t3">Loja</span>
            <Select value={filtro} onValueChange={(v) => setFiltro(v ?? "todas")}>
              <SelectTrigger className="h-[27px] w-[22rem] max-w-full text-[12px]">
                {/* O rotulo tem que ser escrito aqui: sem isto o gatilho mostra o
                    VALOR do item, e o valor e o uuid da loja. */}
                <SelectValue>{() => rotuloDoFiltro}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">
                  Todas ({ativas.length} ativa(s), {inativas.length} sem rastreamento)
                </SelectItem>
                {lojas.map((l) => (
                  <SelectItem key={l.storeId} value={l.storeId}>
                    {l.nome} — {l.dominio}
                    {l.ligado ? "" : " (desligado)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}

      {escolhida ? (
        <CardLoja
          key={escolhida.storeId}
          loja={escolhida}
          diag={diagnostico[escolhida.storeId] ?? null}
          comecarAberto
        />
      ) : (
        <>
          {ativas.length === 0 ? (
            <div className={VAZIO_CAIXA}>
              <p className="text-[15px] font-semibold text-ink">
                Nenhuma loja rastreando ainda
              </p>
              <p className="mx-auto mt-1.5 max-w-[380px] text-[12.5px] text-t2">
                Escolha uma loja, cadastre uma conta do Google ou um pixel do Meta e ligue
                o rastreamento.
              </p>
              <button type="button" onClick={escolherLoja} className={cn(VAZIO_CTA, FOCO)}>
                Escolher loja
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {ativasOrdenadas.map((l) => (
                <CardLoja
                  key={l.storeId}
                  loja={l}
                  diag={diagnostico[l.storeId] ?? null}
                  comecarAberto={false}
                />
              ))}
            </div>
          )}

          {/* Sem isto a pagina renderiza dezenas de lojas que ninguem rastreia,
              e a que importa fica perdida no meio. */}
          {inativas.length > 0 && (
            <section id="lojas-sem-rastreamento" className="scroll-mt-20">
              <div className="flex items-center gap-2.5">
                <h2 className="text-[13px] font-semibold text-ink">Lojas sem rastreamento</h2>
                <span className="font-mono text-[11px] text-[var(--t4)]">
                  {inativas.length}
                </span>
                <span aria-hidden className="h-px flex-1 bg-border" />
                <button
                  type="button"
                  aria-expanded={mostrarTodas}
                  onClick={() => setMostrarTodas((v) => !v)}
                  className={cn(
                    "h-[26px] rounded-md border border-border bg-surface px-[9px] text-[12px] font-semibold text-t1 hover:border-[var(--border-strong)]",
                    FOCO
                  )}
                >
                  {mostrarTodas ? "Esconder" : "Mostrar"}
                </button>
              </div>

              {mostrarTodas && (
                <div className="mt-2.5 flex flex-col gap-3">
                  {inativas.map((l) => (
                    <CardLoja
                      key={l.storeId}
                      loja={l}
                      diag={diagnostico[l.storeId] ?? null}
                      comecarAberto={false}
                    />
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}

      {ativas.length > 0 && (
        <div className="flex flex-col gap-2 pt-1">
          {/* O que a tela NAO consegue afirmar: que o Google contou. O endpoint
              responde 200 mesmo ignorando. Dizer isso e melhor que deixar o
              lojista concluir que "ativo" significa "funcionando". */}
          <p className="max-w-[80ch] text-[11.5px] leading-relaxed text-t3">
            “Enviada” quer dizer que a plataforma aceitou o envio — não que contou a
            conversão. A confirmação é no painel do Google Ads e no Events Manager. Se
            entrarem pedidos e as compras pararem, o aviso aparece aqui.
          </p>
          <details className="group">
            <summary
              className={cn(
                "flex cursor-pointer list-none items-center gap-1 text-[12px] font-medium text-t2 hover:text-ink [&::-webkit-details-marker]:hidden",
                FOCO
              )}
            >
              <ChevronRight
                aria-hidden
                className="h-3 w-3 transition-transform group-open:rotate-90"
              />
              Como funciona o rastreamento
            </summary>
            <p className="mt-2 max-w-[75ch] rounded-lg border border-border bg-surface-2 p-3 text-[12px] leading-relaxed text-t2">
              A conversão sai do servidor. O que muda é de onde cada evento é observado:
              a compra pelo webhook do pedido, carrinho e produto pelo snippet do tema, e
              o checkout pelo Web Pixel — o único que entra no checkout da Shopify.
            </p>
          </details>
        </div>
      )}
    </div>
  );
}
