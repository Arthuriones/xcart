import type { DestinoNaTela, LojaTracking } from "@/lib/tracking/queries";
import type { DiagnosticoLoja } from "@/lib/tracking/diagnostico";
import {
  aceitamCompra,
  emModoTeste,
  faltasDaLoja,
  pelaTag,
  pixelCheckoutJaVisto,
  plural,
  quando,
  recebemCompra,
  semCliqueDeAnuncio,
  tagComCompra,
  vereditoDoDestino,
  type Plataforma,
} from "./saude";
import { PLATAFORMAS, formatarInteiro, type LinhaLoja, type TomSaude } from "./resumo";

// ============================================================================
// O que a tela de Rastreamento mostra, sem React.
//
// A regra de saude continua em saude.ts e resumo.ts. Aqui so mora a traducao
// para a tela enxuta: um ponto por plataforma na lista, um estado curto por
// pixel no detalhe e os campos da loja. Nada de frase de problema na lista: o
// motivo aparece dentro da loja, no lugar afetado.
//
// Todo motivo de `saudeDaLoja` tem que ter um lugar visivel no detalhe -- senao
// a loja fica amarela sem dizer por que. O teste tracking-resumo trava isso.
//
// O Google sai do navegador (tag do Google): o servidor nao conta nada dele.
// Por isso o Google nunca ganha numero aqui, so "pela tag" ou o que falta.
// ============================================================================

export type Tom = TomSaude;

// ---------------------------------------------------------------------------
// Lista: um ponto por plataforma
// ---------------------------------------------------------------------------

export interface PontoPlataforma {
  plataforma: Plataforma;
  tom: Tom;
  /** A frase para o leitor de tela: "Meta: 178 de 182 compras". */
  rotulo: string;
}

const NOME: Record<Plataforma, string> = { meta: "Meta", google: "Google Ads", tiktok: "TikTok" };

/** Um ponto para cada plataforma com pixel na loja (so loja ligada). */
export function pontosDaLinha(linha: LinhaLoja): PontoPlataforma[] {
  const { loja } = linha;
  if (!loja.ligado) return [];
  return PLATAFORMAS.flatMap((p): PontoPlataforma[] => {
    if (!loja.destinos.some((d) => d.plataforma === p)) return [];
    const c = linha.colunas[p];
    const ponto = (tom: Tom, texto: string) => [{ plataforma: p, tom, rotulo: `${NOME[p]}: ${texto}` }];
    switch (c.tipo) {
      case "desligado":
        return ponto("neutral", "desativado");
      case "nao-recebe":
        if (p === "google") return ponto("warn", c.motivo);
        return loja.destinos.some((d) => d.plataforma === p && d.ativo && emModoTeste(d))
          ? ponto("warn", "em modo teste")
          : ponto("warn", "sem token");
      case "tag":
        return ponto("ok", "tag ativa");
      case "sem-contagem":
        return ponto("neutral", "sem contagem agora");
      case "sem-pedidos":
        return ponto("neutral", plural(c.compras, "compra enviada", "compras enviadas"));
      case "razao":
        if (c.esperados === 0) return ponto("ok", "nenhum pedido em 7 dias");
        return ponto(
          c.faltam === 0 ? "ok" : c.chegaram === 0 ? "err" : "warn",
          `${c.chegaram} de ${c.esperados} compras`
        );
    }
  });
}

/** A linha de baixo da loja na lista: pedidos da semana ou o envio desligado. */
export function subDaLinha(loja: LojaTracking, diag: DiagnosticoLoja | null): string | null {
  if (!loja.ligado) return "Rastreamento desligado";
  if (diag?.pedidos7d == null) return null;
  return `${plural(diag.pedidos7d, "pedido", "pedidos")} em 7 dias`;
}

// ---------------------------------------------------------------------------
// Detalhe: cada pixel
// ---------------------------------------------------------------------------

export interface EstadoPixel {
  /** Curto, so quando ha algo a dizer: "Token recusado", "Sem token". */
  nota: string | null;
  tom: Tom;
  /** O que a plataforma respondeu, quando recusou. */
  erro: string | null;
}

export function estadoDoPixel(
  d: DestinoNaTela,
  loja: LojaTracking,
  diag: DiagnosticoLoja | null
): EstadoPixel {
  const e = (nota: string | null, tom: Tom, erro: string | null = null) => ({ nota, tom, erro });

  if (!d.ativo) return e("Desativado", "neutral");
  if (pelaTag(d)) {
    if (Object.keys(d.labels).length === 0) return e("Sem rótulo", "warn");
    if (!d.labels.purchase) return e("Sem rótulo da compra", "warn");
    // Loja desligada: o google-config devolve nenhuma conta, a tag nao dispara.
    if (!loja.ligado) return e(null, "neutral");
    // A compra do Google so sai pelo pixel do checkout.
    if (!pixelCheckoutJaVisto(loja)) return e("Falta o pixel do checkout", "warn");
    return e(null, "ok");
  }
  if (!d.temToken) return e("Sem token", "warn");
  if (!loja.ligado) return e(null, "neutral");

  const erro = d.contagem.ultimoErro;
  const faltam = faltasDaLoja(loja, diag).find((f) => f.d.id === d.id)?.faltam ?? 0;
  if (faltam > 0) {
    // Sem o aviso de pedidos, o motivo esta nos campos da loja, nao no pixel.
    const nota =
      diag?.temWebhook === false
        ? "Sem aviso de pedidos"
        : d.contagem.falharam > 0
          ? "Envio recusado"
          : "Compras faltando";
    return e(nota, "err", d.contagem.falharam > 0 ? erro : null);
  }
  if (emModoTeste(d)) return e("Modo teste", "warn");
  if (d.contagem.falharam > 0) {
    return e(plural(d.contagem.falharam, "envio falhou", "envios falharam"), "warn", erro);
  }
  // Por plataforma, o mesmo teste de `saudeDaLoja`: o clique do Meta nao
  // credita o TikTok, nem o contrario.
  if (recebemCompra(loja).some((r) => r.id === d.id) && semCliqueDeAnuncio(loja, d.plataforma)) {
    return e("Sem clique de anúncio", "warn");
  }
  return e(null, "ok");
}

/**
 * As compras do pixel em 7 dias: "178 de 182 compras" no Meta e no TikTok. O
 * Google nao tem numero do servidor: "pela tag".
 */
export function comprasDoPixel(
  d: DestinoNaTela,
  loja: LojaTracking,
  diag: DiagnosticoLoja | null
): string | null {
  if (!d.ativo || !loja.ligado) return null;
  if (pelaTag(d)) return d.labels.purchase && pixelCheckoutJaVisto(loja) ? "pela tag" : null;
  if (!recebemCompra(loja).some((r) => r.id === d.id)) return null;
  const v = vereditoDoDestino(d, loja, diag);
  if (v.tipo === "sem-contagem") return "—";
  if (v.tipo === "sem-pedidos") return plural(v.compras, "compra", "compras");
  return `${formatarInteiro(v.chegaram)} de ${formatarInteiro(v.esperados)} compras`;
}

// ---------------------------------------------------------------------------
// Detalhe: campos da loja e avisos
// ---------------------------------------------------------------------------

export type IdInstalacao = "script" | "pixel" | "aviso" | "remarketing";

export interface ItemInstalacao {
  id: IdInstalacao;
  /** O valor do campo: "Instalado", "Faltando", "Não verificado". */
  valor: string;
  tom: Tom;
}

export interface Instalacao {
  itens: Record<IdInstalacao, ItemInstalacao | null>;
  /** O pior tom entre os itens obrigatorios (remarketing e opcional). */
  tom: Tom;
  /** Ligada e sem conferencia na Shopify: vale "Tentar de novo". */
  semConferir: boolean;
}

const PESO: Record<Tom, number> = { err: 3, warn: 2, neutral: 1, ok: 0 };

export function instalacaoDaLoja(
  loja: LojaTracking,
  diag: DiagnosticoLoja | null,
  falhou: boolean
): Instalacao {
  // Sem o app, ou ligada e sem resposta da Shopify: nada foi conferido. Loja
  // desligada nem foi perguntada -- nao e falha.
  const semShopify = loja.desinstalada || !diag || (loja.ligado && falhou);
  // A Shopify respondeu o resto, mas nao os pedidos: a comparacao ficou de fora.
  const semPedidos = !semShopify && loja.ligado && diag!.pedidos7d === null;
  const naoVerificado = { valor: "Não verificado", tom: "neutral" as Tom };

  const aviso =
    semShopify || diag!.temWebhook == null
      ? naoVerificado
      : diag!.temWebhook
        ? { valor: "Inscrito", tom: "ok" as Tom }
        : { valor: "Não inscrito: reinstale o app em Lojas", tom: "err" as Tom };

  const script =
    semShopify || diag!.temSnippet == null
      ? naoVerificado
      : !diag!.temSnippet
        ? { valor: "Faltando", tom: "warn" as Tom }
        : diag!.snippetComId === false
          ? { valor: "Versão antiga", tom: "warn" as Tom }
          : { valor: "Instalado", tom: "ok" as Tom };

  // "Faltando" so quando NUNCA mandou evento. Visto ha mais de 24 h esta
  // instalado: a loja so ficou sem checkout nesse tempo.
  const pixel = !pixelCheckoutJaVisto(loja)
    ? { valor: "Faltando", tom: "warn" as Tom }
    : loja.pixelCheckoutDesatualizado
      ? { valor: "Código antigo", tom: "warn" as Tom }
      : !loja.pixelCheckoutAtivo && loja.pixelCheckoutVistoEm
        ? { valor: `Instalado · último checkout ${quando(loja.pixelCheckoutVistoEm)}`, tom: "ok" as Tom }
        : { valor: "Instalado", tom: "ok" as Tom };

  // So com Google, e nao entra no tom. O script do tema faz o remarketing
  // sozinho para cada conta que o google-config devolve -- e ele so devolve
  // conta com a loja ligada.
  const remarketing = loja.destinos.some((d) => d.plataforma === "google" && d.ativo)
    ? !loja.ligado
      ? { valor: "Desligado com a loja", tom: "neutral" as Tom }
      : script === naoVerificado
        ? naoVerificado
        : script.valor === "Instalado"
          ? { valor: "Ativo", tom: "ok" as Tom }
          : { valor: "Precisa do script no tema", tom: "neutral" as Tom }
    : null;

  const semConferir = loja.ligado && !loja.desinstalada && (semShopify || semPedidos);
  let tom = [aviso, script, pixel].reduce<Tom>(
    (pior, i) => (PESO[i.tom] > PESO[pior] ? i.tom : pior),
    "ok"
  );
  if (semConferir && PESO[tom] < PESO.warn) tom = "warn";

  return {
    itens: {
      script: { id: "script", ...script },
      pixel: { id: "pixel", ...pixel },
      aviso: { id: "aviso", ...aviso },
      remarketing: remarketing && { id: "remarketing", ...remarketing },
    },
    tom,
    semConferir,
  };
}

export interface AvisoLoja {
  tom: "err" | "warn";
  texto: string;
  acao: "lojas" | "recarregar" | "conferir" | "ligar" | "adicionar" | null;
}

/**
 * O que vale para a loja inteira e nao mora num pixel nem num campo.
 *
 * `ligado` e o que a tela mostra (o lojista pode ter acabado de clicar); sem
 * ele, vale o que veio do servidor.
 */
export function avisosDaLoja(
  loja: LojaTracking,
  inst: Instalacao,
  ligado: boolean = loja.ligado
): AvisoLoja[] {
  const avisos: AvisoLoja[] = [];
  if (loja.desinstalada) {
    avisos.push({ tom: "err", texto: "O app foi desinstalado desta loja.", acao: "lojas" });
  }
  // Desligada com pixel cadastrado: nada sai, nem pela tag do Google.
  if (!ligado && !loja.desinstalada && loja.destinos.some((d) => d.ativo)) {
    avisos.push({
      tom: "warn",
      texto: "Rastreamento desligado: nenhuma compra é enviada.",
      acao: "ligar",
    });
  }
  // Com pixel e nenhum recebendo a compra (todos desativados, por exemplo),
  // nenhum pixel sozinho diz que a loja inteira parou. Loja sem pixel nenhum
  // (a nova, logo depois de ligar): o botao abre o "Adicionar pixel".
  if (
    ligado &&
    aceitamCompra(loja).length === 0 &&
    tagComCompra(loja).length === 0
  ) {
    avisos.push(
      loja.destinos.length === 0
        ? {
            tom: "err",
            texto: "Nenhum pixel recebe a compra. Adicione o pixel do Meta ou do TikTok.",
            acao: "adicionar",
          }
        : { tom: "err", texto: "Nenhum pixel recebe a compra.", acao: null }
    );
  }
  if (inst.semConferir) {
    avisos.push({ tom: "warn", texto: "Não deu para conferir a loja na Shopify.", acao: "conferir" });
  }
  if (loja.contagemIndisponivel) {
    avisos.push({ tom: "warn", texto: "Não deu para contar os envios agora.", acao: "recarregar" });
  }
  if (loja.tetoAtingidoRecente) {
    avisos.push({
      tom: "warn",
      texto: "A loja passou do limite de eventos por hora nas últimas 24 h.",
      acao: null,
    });
  }
  return avisos;
}
