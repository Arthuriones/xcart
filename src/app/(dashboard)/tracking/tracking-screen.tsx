"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  CircleAlert,
  Copy,
  ExternalLink,
  Loader2,
  Minus,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DestinoNaTela, LojaTracking } from "@/lib/tracking/queries";
import type { DiagnosticoLoja } from "@/lib/tracking/diagnostico";
import { PainelPlataforma } from "./destinos-ui";

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
// para baixo. Configuracao e o que se mexe uma vez; saude e o que se olha sempre.
//
// O DESTINO E UMA LISTA
//
// Cinco contas de Google anunciando produtos diferentes do mesmo catalogo e o
// caso real do Arthur. Cada conta e uma linha em `tracking_destinations`, com o
// seu proprio conjunto de rotulos, e cada uma e julgada sozinha aqui: uma pode
// estar chegando e a outra nao.
// ============================================================================

function Pill({
  tom,
  children,
}: {
  tom: "ok" | "alerta" | "erro" | "neutro";
  children: React.ReactNode;
}) {
  const cor =
    tom === "ok"
      ? "bg-emerald-500/15 text-emerald-600"
      : tom === "alerta"
        ? "bg-amber-500/15 text-amber-600"
        : tom === "erro"
          ? "bg-destructive/15 text-destructive"
          : "bg-muted text-muted-foreground";
  return (
    <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${cor}`}>
      {children}
    </span>
  );
}

/** Um pre-requisito que mora na Shopify, com o comando que conserta. */
function Checagem({
  ok,
  rotulo,
  conserto,
}: {
  ok: boolean | null;
  rotulo: string;
  conserto: string;
}) {
  if (ok === null) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Minus className="h-3.5 w-3.5" />
        {rotulo}: não deu para verificar
      </span>
    );
  }
  if (ok) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Check className="h-3.5 w-3.5 text-emerald-600" />
        {rotulo}
      </span>
    );
  }
  return (
    <span
      className="flex items-center gap-1.5 text-xs font-medium text-destructive"
      title={conserto}
    >
      <CircleAlert className="h-3.5 w-3.5" />
      {rotulo}: faltando
    </span>
  );
}

/** Como chamar um destino numa frase. */
function apelido(d: DestinoNaTela): string {
  const plataforma = d.plataforma === "google" ? "Google" : "Meta";
  return d.nome ? `${plataforma} "${d.nome}"` : `${plataforma} ${d.conta}`;
}

/**
 * Meta com test_event_code: o evento cai na aba de TESTE do Events Manager e
 * nao conta como conversao. Contar essas compras como "rastreadas" diria que a
 * campanha esta medindo quando nao esta.
 */
function emModoTeste(d: DestinoNaTela): boolean {
  return d.plataforma === "meta" && Boolean(d.testEventCode);
}

/** Os destinos para onde a compra SAI -- inclusive o Meta em modo teste. */
function aceitamCompra(loja: LojaTracking): DestinoNaTela[] {
  return loja.destinos.filter(
    (d) =>
      d.ativo &&
      d.completo &&
      (d.plataforma === "meta" || Boolean(d.labels.purchase))
  );
}

/** Os destinos que deveriam estar recebendo a compra COMO CONVERSAO. */
function recebemCompra(loja: LojaTracking): DestinoNaTela[] {
  return aceitamCompra(loja).filter((d) => !emModoTeste(d));
}

/**
 * Quantos pedidos esperados NAO tiveram a compra enviada por este destino.
 *
 * Todo pedido vai para todo destino que aceita a compra, entao nao ha pedido
 * que "veio de fora do anuncio" e pode faltar: faltou, perdeu. Fica fora so o
 * que nao tinha como ter ido -- pedido anterior ao cadastro do destino -- e o
 * que ainda esta na fila do cron, que nao saiu mas nao se perdeu.
 *
 * Null = o diagnostico nao trouxe a lista de pedidos.
 */
function pedidosSemCompra(d: DestinoNaTela, diag: DiagnosticoLoja | null): number | null {
  if (!diag?.pedidoIds) return null;
  const desde = d.criadoEm ? Date.parse(d.criadoEm) : NaN;
  const chegou = new Set([...d.contagem.pedidosComCompra, ...d.contagem.pedidosNaFila]);
  let faltam = 0;
  for (const id of diag.pedidoIds) {
    if (chegou.has(id)) continue;
    const criado = Date.parse(diag.pedidoCriadoEm?.[id] ?? "");
    if (Number.isFinite(desde) && Number.isFinite(criado) && criado < desde) continue;
    faltam += 1;
  }
  return faltam;
}

/** O destino da plataforma que mais recebeu compra. */
function melhorDa(
  alvos: DestinoNaTela[],
  plataforma: DestinoNaTela["plataforma"]
): DestinoNaTela | null {
  let melhor: DestinoNaTela | null = null;
  for (const d of alvos) {
    if (d.plataforma !== plataforma) continue;
    if (
      !melhor ||
      (d.contagem.porEvento.purchase ?? 0) > (melhor.contagem.porEvento.purchase ?? 0)
    ) {
      melhor = d;
    }
  }
  return melhor;
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
function Veredito({
  loja,
  diag,
}: {
  loja: LojaTracking;
  diag: DiagnosticoLoja | null;
}) {
  const alvos = recebemCompra(loja);
  const emTeste = aceitamCompra(loja).filter(emModoTeste);

  // Fica acima de tudo: muda como ler o resto. A compra sai, aparece no
  // Events Manager, e a campanha nao recebe conversao nenhuma.
  const avisoTeste = emTeste.length > 0 && (
    <div className="flex items-start gap-2 rounded-md bg-amber-500/10 p-2.5 text-xs">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
      <div className="space-y-0.5">
        {emTeste.map((d) => (
          <p key={d.id} className="font-medium text-amber-600">
            {apelido(d)} em modo teste — compras não contam como conversão
          </p>
        ))}
      </div>
    </div>
  );

  if (alvos.length === 0) {
    const temAlgum = loja.destinos.length > 0;
    return (
      <>
        {avisoTeste}
        <div className="flex items-start gap-2 rounded-md bg-muted/60 p-2.5 text-xs">
          <Minus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="text-muted-foreground">
            {temAlgum
              ? "Nenhum destino está recebendo a compra. Confira o rótulo da compra no Google e o token no Meta."
              : "Nenhum destino cadastrado ainda. Adicione uma conta do Google, um pixel do Meta, ou os dois."}
          </span>
        </div>
      </>
    );
  }

  const pedidos = diag?.pedidos7d ?? null;

  // Cada destino e julgado sozinho: uma conta pode estar chegando e a outra nao.
  const faltas = alvos
    .map((d) => ({ destino: d, faltam: pedidosSemCompra(d, diag) ?? 0 }))
    .filter((f) => f.faltam >= 1);

  const melhorGoogle = melhorDa(alvos, "google");
  const melhorMeta = melhorDa(alvos, "meta");

  return (
    <>
      {avisoTeste}

      {faltas.length > 0 && (
        <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-2.5 text-xs">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
          <div>
            {faltas.map(({ destino, faltam }) => (
              <p key={destino.id} className="font-medium text-destructive">
                {faltam} {faltam === 1 ? "pedido" : "pedidos"} sem compra enviada em{" "}
                {apelido(destino)}
              </p>
            ))}
            <p className="text-muted-foreground">
              {diag?.temWebhook === false
                ? "O webhook de pedidos não está inscrito — é quase certo que seja isso."
                : "Todo pedido vai para todo destino: o que falta aqui é venda que a campanha não viu. Confira as falhas do destino abaixo, o rótulo da compra e, no Meta, o token do CAPI."}
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md bg-muted/60 p-2.5 text-xs">
        <span className="flex items-center gap-1.5">
          <Check className="h-3.5 w-3.5 text-emerald-600" />
          <span className="text-muted-foreground">
            {pedidos !== null ? (
              <>
                <strong className="text-foreground">{pedidos}</strong> pedidos em 7 dias
              </>
            ) : (
              "pedidos: não deu para verificar"
            )}
          </span>
        </span>
        {alvos.map((d) => (
          <span key={d.id} className="text-muted-foreground">
            {apelido(d)}:{" "}
            <strong className="text-foreground">
              {d.contagem.porEvento.purchase ?? 0}
            </strong>{" "}
            compras
          </span>
        ))}
        {melhorGoogle && <Atribuicao destino={melhorGoogle} clique="gclid" />}
        {melhorMeta && <Atribuicao destino={melhorMeta} clique="fbc" />}
      </div>
    </>
  );
}

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

  const plataforma = destino.plataforma === "google" ? "Google" : "Meta";
  const todas = semClique >= total;
  return (
    <span className={todas ? "text-amber-600" : "text-muted-foreground"}>
      {plataforma}: {semClique} de {total} compras sem {clique}
      {todas ? " — nenhuma venda foi creditada a um anúncio" : ""}
    </span>
  );
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
function PixelDoCheckout({ loja }: { loja: LojaTracking }) {
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

  return (
    <section className="space-y-2.5 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold">Checkout (Web Pixel)</span>
        <Pill tom={loja.pixelCheckoutAtivo ? "ok" : "alerta"}>
          {loja.pixelCheckoutAtivo ? "instalado" : "falta instalar"}
        </Pill>
      </div>

      <p className="text-[11px] text-muted-foreground">
        O checkout da Shopify não é tema, então o nosso script não entra lá. Sem este
        pixel, &quot;iniciar checkout&quot; é o <strong>clique no botão</strong> e não
        existe &quot;dados de pagamento&quot; — o passo que separa desistência no frete
        de cartão recusado. Ele não envia nada para o Meta nem para o Google: avisa o
        xcart, e o envio continua saindo do servidor.
      </p>

      {!loja.pixelCheckoutAtivo && (
        <>
          <ol className="list-decimal space-y-0.5 pl-4 text-[11px] text-muted-foreground">
            <li>
              No admin da Shopify: <strong>Configurações → Eventos de cliente</strong>
            </li>
            <li>
              <strong>Adicionar pixel personalizado</strong>, dê um nome (ex.: xcart)
            </li>
            <li>Cole o código abaixo, <strong>Salvar</strong> e <strong>Conectar</strong></li>
          </ol>

          <Button size="sm" variant="outline" onClick={buscar} disabled={carregando}>
            {carregando ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : aberto ? (
              "esconder código"
            ) : (
              "mostrar código para colar"
            )}
          </Button>

          {aberto && codigo && (
            <div className="space-y-1.5">
              <Button size="sm" variant="outline" onClick={copiar}>
                <Copy className="mr-1.5 h-3.5 w-3.5" />
                Copiar
              </Button>
              {/* Uma linha so, e a mesma para toda loja: a loja se identifica
                  sozinha por init.data.shop.myshopifyDomain. Por isso o campo e
                  baixo -- antes era um bloco de 60 linhas gerado por loja. */}
              <textarea
                readOnly
                value={codigo}
                onFocus={(e) => e.currentTarget.select()}
                className="h-20 w-full rounded-md border bg-muted/40 p-2 font-mono text-[10px] leading-relaxed"
                aria-label="Código do pixel do checkout"
              />
              <p className="text-[11px] text-muted-foreground">
                Depois de conectar, não precisa fazer mais nada aqui — o pixel se anuncia
                no primeiro checkout e esta seção passa a &quot;instalado&quot; sozinha.
              </p>
            </div>
          )}
        </>
      )}

      {loja.pixelCheckoutAtivo && (
        <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
          O &quot;iniciar checkout&quot; vindo do tema passou a ser ignorado: o do pixel é
          o checkout de verdade, e contar os dois seria a mesma ação duas vezes.
        </p>
      )}
    </section>
  );
}

function CardLoja({
  loja,
  diag,
  comecarAberto,
}: {
  loja: LojaTracking;
  diag: DiagnosticoLoja | null;
  comecarAberto: boolean;
}) {
  const [aberto, setAberto] = useState(comecarAberto);
  const [ligado, setLigado] = useState(loja.ligado);
  const [salvando, setSalvando] = useState(false);
  const [instalando, setInstalando] = useState<string | null>(null);

  const temGoogle = loja.destinos.some((d) => d.plataforma === "google" && d.ativo);
  // aceitamCompra, nao recebemCompra: ligar so com o Meta em modo teste e o
  // jeito de conferir no Events Manager antes de valer.
  const podeLigar = aceitamCompra(loja).length > 0;
  // Sem o app, a credencial nao vale: checar e instalar no tema so dariam erro.
  const shopifyAlcancavel = ligado && !loja.desinstalada;

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

  return (
    <Card className={ligado ? "" : "border-dashed"}>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setAberto((v) => !v)}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            <ChevronDown
              className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                aberto ? "rotate-180" : ""
              }`}
            />
            <span className="truncate font-medium">{loja.nome}</span>
            {ligado ? <Pill tom="ok">ativo</Pill> : <Pill tom="neutro">desligado</Pill>}
            {loja.desinstalada && (
              <Pill tom="erro">app desinstalado — rastreamento parado</Pill>
            )}
            {loja.destinos.length > 0 && (
              <Pill tom="neutro">
                {loja.destinos.filter((d) => d.ativo).length} destino(s)
              </Pill>
            )}
            {ligado && diag?.temWebhook === false && <Pill tom="erro">sem webhook</Pill>}
            {ligado && diag?.temSnippet === false && <Pill tom="erro">sem snippet</Pill>}
            <span className="ml-auto hidden shrink-0 pl-2 text-xs text-muted-foreground sm:block">
              {loja.dominio}
            </span>
          </button>

          <Button
            onClick={() => alternar(!ligado)}
            disabled={salvando || (!ligado && !podeLigar)}
            variant={ligado ? "outline" : "default"}
            size="sm"
            title={
              !ligado && !podeLigar
                ? "Cadastre um destino que receba a compra para poder ligar"
                : undefined
            }
          >
            {salvando ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : ligado ? (
              "Desligar"
            ) : (
              "Ligar"
            )}
          </Button>
        </div>

        {aberto && (
          <div className="space-y-4 border-t pt-3">
            {/* Teto do coletor. Fica ACIMA do veredito porque muda como ler
                todos os numeros abaixo: com evento sendo descartado, "poucas
                conversoes" nao quer dizer que o envio quebrou. */}
            {loja.tetoAtingidoRecente && (
              <div className="flex items-start gap-2 rounded-md bg-amber-500/10 p-2.5 text-xs">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                <div>
                  <p className="font-medium text-amber-600">
                    Esta loja bateu no teto de eventos por hora nas últimas 24h.
                  </p>
                  <p className="text-muted-foreground">
                    Parte do funil foi descartada — os números abaixo estão
                    incompletos. O teto existe porque o coletor é público; se o
                    tráfego é legítimo, me avise para subir o limite desta loja.
                  </p>
                </div>
              </div>
            )}


            {ligado && <Veredito loja={loja} diag={diag} />}

            {/* Os pre-requisitos que moram na Shopify. Sem eles a configuracao
                pode estar perfeita e nada acontecer. */}
            {shopifyAlcancavel && (
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
                <Checagem
                  ok={diag?.temWebhook ?? null}
                  rotulo="Webhook de pedidos"
                  conserto="npm run op -- scripts/registrar-webhook-pedidos.ts --aplicar"
                />
                <Checagem
                  ok={diag?.temSnippet ?? null}
                  rotulo="Snippet no tema"
                  conserto="Use o botão “Instalar snippet” abaixo."
                />
                <Checagem
                  ok={diag?.temRemarketing ?? null}
                  rotulo="Tag de remarketing"
                  conserto="Use o botão “Ligar remarketing” abaixo."
                />
                <a
                  href={`https://${loja.dominio}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                >
                  abrir loja
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}

            {/* Ficam sempre visiveis, nao so quando falta algo: reinstalar
                tambem serve para atualizar uma tag antiga e para depois de
                trocar de tema, que apaga a tag junto. */}
            {shopifyAlcancavel && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => instalarTag(false)}
                  disabled={instalando !== null}
                >
                  {instalando === "snippet" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : diag?.temSnippet ? (
                    "Reinstalar snippet"
                  ) : (
                    "Instalar snippet"
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => instalarTag(true)}
                  disabled={instalando !== null || !temGoogle}
                  title={
                    !temGoogle
                      ? "Cadastre uma conta do Google Ads nesta loja antes"
                      : undefined
                  }
                >
                  {instalando === "remarketing" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : diag?.temRemarketing ? (
                    "Reinstalar com remarketing"
                  ) : (
                    "Ligar remarketing"
                  )}
                </Button>
                <span className="text-[11px] text-muted-foreground">
                  grava no tema publicado — recarregue a página para atualizar as
                  checagens
                </span>
              </div>
            )}

            <PixelDoCheckout loja={loja} />

            <PainelPlataforma
              storeId={loja.storeId}
              plataforma="meta"
              destinos={loja.destinos}
            />
            <PainelPlataforma
              storeId={loja.storeId}
              plataforma="google"
              destinos={loja.destinos}
            />

            {!ligado && loja.destinos.length > 0 && !podeLigar && (
              <p className="text-[11px] text-muted-foreground">
                Para ligar, um destino precisa receber a compra: no Google o rótulo da
                compra, no Meta o token do CAPI.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

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

  const ativas = useMemo(() => lojas.filter((l) => l.ligado), [lojas]);
  const inativas = useMemo(() => lojas.filter((l) => !l.ligado), [lojas]);

  const escolhida = filtro === "todas" ? null : lojas.find((l) => l.storeId === filtro);

  const rotuloDoFiltro = escolhida
    ? `${escolhida.nome} — ${escolhida.dominio}`
    : `Todas (${ativas.length} ativa(s), ${inativas.length} sem rastreamento)`;

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
  const comProblema = ativas.filter(
    (l) =>
      l.desinstalada ||
      diagnostico[l.storeId]?.temWebhook === false ||
      diagnostico[l.storeId]?.temSnippet === false
  ).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Rastreamento</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            A conversão sai do servidor. O que muda é de onde cada evento é observado:
            a compra pelo webhook do pedido, carrinho e produto pelo snippet do tema, e
            o checkout pelo Web Pixel — o único que entra no checkout da Shopify.
          </p>
        </div>
        {ativas.length > 0 && (
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>
              <strong className="text-foreground">{ativas.length}</strong> loja(s)
              ativa(s)
            </span>
            <span>
              <strong className="text-foreground">{vendasRastreadas}</strong> venda(s)
              rastreada(s) em 7d
            </span>
            {comProblema > 0 && (
              <Pill tom="erro">{comProblema} com pré-requisito faltando</Pill>
            )}
          </div>
        )}
      </div>

      {/* Filtro por loja.
          Com dezenas de lojas cadastradas, a que importa fica perdida -- e o
          caso normal aqui e trabalhar numa loja de cada vez. */}
      {lojas.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Loja</span>
          <Select value={filtro} onValueChange={(v) => setFiltro(v ?? "todas")}>
            <SelectTrigger className="h-8 w-[22rem] max-w-full text-xs">
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
      )}

      {escolhida ? (
        <CardLoja
          loja={escolhida}
          diag={diagnostico[escolhida.storeId] ?? null}
          comecarAberto
        />
      ) : (
        <>
          {ativas.length === 0 && (
            <Card className="border-amber-500/40 bg-amber-500/5">
              <CardContent className="flex items-start gap-2 p-4 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <div>
                  <p className="font-medium">Nenhuma loja com rastreamento ligado.</p>
                  <p className="text-muted-foreground">
                    Abra uma loja abaixo, cadastre um destino e ligue.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* O que a tela NAO consegue afirmar: que o Google contou. O endpoint
              responde 200 mesmo ignorando. Dizer isso e melhor que deixar o
              lojista concluir que "ativo" significa "funcionando". */}
          {ativas.length > 0 && (
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
              &quot;Enviadas&quot; significa que a plataforma aceitou a requisição — não
              que contou a conversão. A confirmação é no painel do Google Ads e no Events
              Manager. Se entrarem pedidos e as compras pararem, o aviso aparece aqui.
            </p>
          )}

          <div className="space-y-2.5">
            {ativas.map((l) => (
              <CardLoja
                key={l.storeId}
                loja={l}
                diag={diagnostico[l.storeId] ?? null}
                comecarAberto
              />
            ))}
          </div>

          {/* Sem isto a pagina renderiza dezenas de lojas que ninguem rastreia,
              e a que importa fica perdida no meio. */}
          {inativas.length > 0 && (
            <div className="space-y-2.5">
              <button
                type="button"
                onClick={() => setMostrarTodas((v) => !v)}
                className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                <Plus className="h-3.5 w-3.5" />
                {mostrarTodas
                  ? "esconder lojas sem rastreamento"
                  : `ligar em outra loja (${inativas.length} sem rastreamento)`}
              </button>

              {mostrarTodas &&
                inativas.map((l) => (
                  <CardLoja
                    key={l.storeId}
                    loja={l}
                    diag={diagnostico[l.storeId] ?? null}
                    comecarAberto={false}
                  />
                ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
