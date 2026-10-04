import type { DestinoNaTela, LojaTracking } from "@/lib/tracking/queries";
import type { DiagnosticoLoja } from "@/lib/tracking/diagnostico";
import type { ChaveEvento } from "@/lib/tracking/eventos";
import {
  ORDEM_SAUDE,
  aceitamCompra,
  apelido,
  comprasSemTeste,
  emModoTeste,
  faltasDaLoja,
  melhorDa,
  oQueFalta,
  plural,
  recebemCompra,
  saudeDaLoja,
  textoProblema,
  vereditoDoDestino,
  type Plataforma,
  type Saude,
} from "./saude";

// ============================================================================
// O que a tela de Rastreamento mostra de cada loja, sem React.
//
// A REGRA continua em saude.ts e nao muda aqui. Este arquivo so traduz o
// resultado dela para a tela nova:
//   - UM problema por loja (o mais grave), com UM botao;
//   - as duas colunas da linha (Meta e Google: chegaram de esperados);
//   - os numeros do topo e o comparativo pedidos x compras enviadas.
//
// `problemasDaLoja` espelha `saudeDaLoja` item a item, na mesma ordem: o teste
// trava que os dois tem o mesmo tamanho e o mesmo tom. Se um motivo novo
// entrar em saude.ts sem entrar aqui, o teste quebra -- e a loja nao fica
// vermelha com a frase "Nada a fazer agora" do lado.
//
// Imports so de TIPO de queries.ts e diagnostico.ts, como em saude.ts: eles
// tem "server-only".
// ============================================================================

export type TomSaude = "ok" | "warn" | "err" | "neutral";

export const TOM_DA_SAUDE: Record<Saude, TomSaude> = {
  parado: "err",
  atencao: "warn",
  ok: "ok",
  desligado: "neutral",
};

export const ROTULO_DA_SAUDE: Record<Saude, string> = {
  parado: "Parado",
  atencao: "Precisa de atenção",
  ok: "Tudo certo",
  desligado: "Desligado",
};

export const NOME_CURTO: Record<Plataforma, string> = { google: "Google", meta: "Meta" };

/**
 * O que o botao do problema faz. A tela decide o "como": a maioria abre o
 * detalhe da loja e age la dentro.
 */
export type TipoAcao =
  | "abrir-lojas"
  | "adicionar-destino"
  | "editar-destino"
  | "ver-destino"
  | "webhook"
  | "script"
  | "pixel"
  | "recarregar"
  | "rechecar"
  | "ligar"
  | "eventos";

export interface Acao {
  tipo: TipoAcao;
  rotulo: string;
  destinoId?: string;
}

export interface Problema {
  tom: "err" | "warn" | "neutral";
  /** A frase da linha: o que acontece, em uma frase. */
  texto: string;
  /** O porque e o como, no detalhe da loja. */
  detalhe?: string;
  acao: Acao | null;
}

/** Ordem das colunas na linha: Meta, depois Google. */
export const PLATAFORMAS: Plataforma[] = ["meta", "google"];

function oQueFaltaEmPalavras(d: DestinoNaTela): string {
  return d.plataforma === "meta"
    ? "Falta o token de conversões do Meta: sem ele nenhum evento sai."
    : "Falta o rótulo de pelo menos um evento: sem rótulo não há o que enviar.";
}

function falhasEmPalavras(n: number): string {
  return n === 1 ? "1 envio falhou" : `${n} envios falharam`;
}

/**
 * Os problemas de uma loja ligada, do mais grave ao menos, em palavras de
 * lojista e com o conserto de cada um.
 *
 * Mesma ordem e mesmas condicoes de `saudeDaLoja`: um item aqui para cada
 * motivo la. So a frase e o botao sao desta tela.
 */
export function problemasDaLoja(
  loja: LojaTracking,
  diag: DiagnosticoLoja | null,
  temDiag: boolean
): Problema[] {
  if (!loja.ligado) return [];

  const aceitam = aceitamCompra(loja);
  const recebem = recebemCompra(loja);
  const faltas = faltasDaLoja(loja, diag);
  const semAviso = diag?.temWebhook === false;

  const err: Problema[] = [];
  if (loja.desinstalada) {
    err.push({
      tom: "err",
      texto: "O app foi desinstalado desta loja. Nenhuma compra está saindo.",
      detalhe: "Reinstale o xcart nesta loja para voltar a enviar as compras.",
      acao: { tipo: "abrir-lojas", rotulo: "Abrir Lojas" },
    });
  }
  if (recebem.length === 0 && aceitam.length === 0) {
    if (loja.destinos.length === 0) {
      err.push({
        tom: "err",
        texto: "Nenhum destino cadastrado. As compras não chegam a nenhuma plataforma.",
        detalhe: "Adicione um pixel do Meta, uma conta do Google Ads, ou os dois.",
        acao: { tipo: "adicionar-destino", rotulo: "Adicionar destino" },
      });
    } else {
      const ativo = loja.destinos.find((d) => d.ativo);
      err.push(
        ativo
          ? {
              tom: "err",
              texto: "Nenhum destino recebe a compra.",
              detalhe:
                "No Google falta o rótulo da compra; no Meta, o token de conversões.",
              acao: { tipo: "editar-destino", rotulo: "Corrigir destino", destinoId: ativo.id },
            }
          : {
              tom: "err",
              texto: "Todos os destinos estão desativados. Nenhuma compra está saindo.",
              detalhe: "Ative um destino pelo menu dele.",
              acao: {
                tipo: "ver-destino",
                rotulo: "Ver destinos",
                destinoId: loja.destinos[0].id,
              },
            }
      );
    }
  }
  for (const { d, faltam } of faltas) {
    const texto = `${plural(faltam, "pedido", "pedidos")} sem compra enviada ao ${apelido(d)}.`;
    if (semAviso) {
      err.push({
        tom: "err",
        texto,
        detalhe:
          "O aviso de pedidos da Shopify não está inscrito nesta loja; é quase certo que seja isso.",
        acao: { tipo: "webhook", rotulo: "Ver como resolver" },
      });
    } else if (d.contagem.falharam > 0) {
      err.push({
        tom: "err",
        texto,
        detalhe: d.contagem.ultimoErro
          ? `A plataforma recusou o envio: “${d.contagem.ultimoErro}”`
          : "A plataforma recusou o envio.",
        acao: { tipo: "editar-destino", rotulo: "Corrigir destino", destinoId: d.id },
      });
    } else {
      err.push({
        tom: "err",
        texto,
        detalhe:
          "Todo pedido vai para todo destino: o que falta é venda que a campanha não viu. Confira o rótulo da compra e, no Meta, o token de conversões.",
        acao: { tipo: "ver-destino", rotulo: "Ver destino", destinoId: d.id },
      });
    }
  }
  if (semAviso) {
    err.push({
      tom: "err",
      texto: "O aviso de pedidos da Shopify não está inscrito: os pedidos não viram compra.",
      detalhe:
        "A inscrição acontece quando o app é instalado. Reinstalar o app nesta loja inscreve de novo.",
      acao: { tipo: "webhook", rotulo: "Ver como resolver" },
    });
  }

  const warn: Problema[] = [];
  if (loja.tetoAtingidoRecente) {
    warn.push({
      tom: "warn",
      texto: "A loja passou do limite de eventos por hora nas últimas 24 h.",
      detalhe:
        "Parte dos eventos do navegador ficou de fora e o funil está incompleto. A compra vem do aviso de pedidos e não é afetada.",
      acao: null,
    });
  }
  if (loja.contagemIndisponivel) {
    warn.push({
      tom: "warn",
      texto: "Não deu para contar os envios agora.",
      detalhe: "A comparação com os pedidos ficou de fora desta vez.",
      acao: { tipo: "recarregar", rotulo: "Tentar de novo" },
    });
  }
  if (aceitam.length > 0 && recebem.length === 0) {
    warn.push({
      tom: "warn",
      texto: "Só em modo teste: as compras vão para a aba de teste do Meta e não contam como conversão.",
      detalhe: "Tire o código de teste do destino quando terminar de conferir.",
      acao: { tipo: "editar-destino", rotulo: "Editar destino", destinoId: aceitam[0].id },
    });
  } else {
    for (const d of aceitam.filter(emModoTeste)) {
      warn.push({
        tom: "warn",
        texto: `${apelido(d)} está em modo teste: as compras dele não contam como conversão.`,
        detalhe: "Tire o código de teste quando terminar de conferir.",
        acao: { tipo: "editar-destino", rotulo: "Editar destino", destinoId: d.id },
      });
    }
  }
  if (diag?.temSnippet === false) {
    warn.push({
      tom: "warn",
      texto: "O script do xcart não está no tema da loja.",
      detalhe:
        "Sem ele ver produto e carrinho não saem, e o clique do anúncio não chega ao pedido.",
      acao: { tipo: "script", rotulo: "Instalar script" },
    });
  } else if (diag?.snippetComId === false) {
    warn.push({
      tom: "warn",
      texto: "O script no tema é de uma versão antiga.",
      detalhe: "A versão nova leva o código da loja e não deixa outra conta receber os seus eventos.",
      acao: { tipo: "script", rotulo: "Atualizar script" },
    });
  }
  if (!loja.pixelCheckoutAtivo) {
    warn.push({
      tom: "warn",
      texto: "O pixel do checkout não está instalado.",
      detalhe: "Sem ele o checkout e os dados de pagamento não são medidos.",
      acao: { tipo: "pixel", rotulo: "Ver código do pixel" },
    });
  } else if (loja.pixelCheckoutDesatualizado) {
    warn.push({
      tom: "warn",
      texto: "O pixel do checkout está com o código antigo.",
      detalhe: "Troque o código do pixel que já existe; não crie um segundo.",
      acao: { tipo: "pixel", rotulo: "Ver código novo" },
    });
  }
  for (const d of loja.destinos) {
    if (!d.ativo || oQueFalta(d) === null) continue;
    warn.push({
      tom: "warn",
      texto: `${apelido(d)} está incompleto.`,
      detalhe: oQueFaltaEmPalavras(d),
      acao: { tipo: "editar-destino", rotulo: "Completar destino", destinoId: d.id },
    });
  }
  for (const d of loja.destinos) {
    const n = d.contagem.falharam;
    if (n <= 0) continue;
    warn.push({
      tom: "warn",
      texto: `${apelido(d)}: ${falhasEmPalavras(n)} nos últimos 7 dias.`,
      detalhe: d.contagem.ultimoErro
        ? `A plataforma respondeu: “${d.contagem.ultimoErro}”`
        : "A plataforma não disse o motivo.",
      acao: { tipo: "editar-destino", rotulo: "Corrigir destino", destinoId: d.id },
    });
  }
  for (const p of ["google", "meta"] as const) {
    const m = melhorDa(recebem, p);
    if (!m) continue;
    const { enviadas, deAnuncio } = comprasSemTeste(m);
    if (enviadas > 0 && deAnuncio === 0) {
      warn.push({
        tom: "warn",
        texto: `Nenhuma venda foi ligada a um anúncio do ${NOME_CURTO[p]}.`,
        detalhe: `${plural(enviadas, "compra chegou", "compras chegaram")} sem o identificador de clique (${p === "google" ? "gclid" : "fbc"}). Ou o tráfego não veio de anúncio, ou o clique se perdeu no caminho até a loja.`,
        acao: { tipo: "eventos", rotulo: "Ver eventos" },
      });
    }
  }
  if (temDiag && (diag === null || diag.pedidos7d === null)) {
    warn.push({
      tom: "warn",
      texto: "Não deu para conferir os pedidos na Shopify.",
      detalhe: diag
        ? textoProblema(diag.problema)
        : "A conferência desta loja falhou. As outras lojas estão atualizadas.",
      acao: { tipo: "rechecar", rotulo: "Tentar de novo" },
    });
  }

  return [...err, ...warn];
}

/** Loja desligada: o que falta para ligar. Nao e problema, e o proximo passo. */
export function proximoPassoDesligada(loja: LojaTracking): Problema {
  if (loja.destinos.length === 0) {
    return {
      tom: "neutral",
      texto: "Nenhum destino ligado. As compras não chegam a nenhuma plataforma.",
      detalhe: "Adicione um pixel do Meta ou uma conta do Google Ads e ligue o envio.",
      acao: { tipo: "adicionar-destino", rotulo: "Ligar rastreamento" },
    };
  }
  if (aceitamCompra(loja).length > 0) {
    return {
      tom: "neutral",
      texto: "Pronto para ligar: falta só ligar o envio das compras.",
      detalhe: "Ligado, cada pedido novo vira compra nos destinos desta loja.",
      acao: { tipo: "ligar", rotulo: "Ligar rastreamento" },
    };
  }
  return {
    tom: "neutral",
    texto: "Desligado. Para ligar, um destino precisa receber a compra.",
    detalhe: "No Google, o rótulo da compra; no Meta, o token de conversões.",
    acao: {
      tipo: "editar-destino",
      rotulo: "Completar destino",
      destinoId: (loja.destinos.find((d) => d.ativo) ?? loja.destinos[0]).id,
    },
  };
}

// ---------------------------------------------------------------------------
// As colunas Meta e Google da linha.
// ---------------------------------------------------------------------------

export type ColunaPlataforma =
  | { tipo: "desligado"; motivo: string }
  | { tipo: "nao-recebe"; motivo: string }
  | { tipo: "sem-contagem"; contas: number }
  | { tipo: "sem-pedidos"; compras: number; semClique: number; contas: number }
  | {
      tipo: "razao";
      chegaram: number;
      esperados: number;
      faltam: number;
      semClique: number;
      contas: number;
    };

function proporcao(v: { chegaram: number; esperados: number }) {
  return v.esperados > 0 ? v.chegaram / v.esperados : 1;
}

/**
 * Compras de uma plataforma numa loja. Com varias contas da mesma plataforma,
 * vale a PIOR: e a linha que diz se algo precisa de mao.
 */
export function colunaDaPlataforma(
  loja: LojaTracking,
  diag: DiagnosticoLoja | null,
  p: Plataforma
): ColunaPlataforma {
  const daPlataforma = loja.destinos.filter((d) => d.plataforma === p);
  const ativos = daPlataforma.filter((d) => d.ativo);
  if (!loja.ligado) {
    return {
      tipo: "desligado",
      motivo: ativos.length > 0 ? "envio desligado nesta loja" : "sem destino nesta loja",
    };
  }
  if (ativos.length === 0) {
    return {
      tipo: "desligado",
      motivo: daPlataforma.length > 0 ? "destino desativado" : "sem destino nesta loja",
    };
  }
  const recebem = recebemCompra(loja).filter((d) => d.plataforma === p);
  if (recebem.length === 0) {
    const emTeste = aceitamCompra(loja).some((d) => d.plataforma === p && emModoTeste(d));
    return {
      tipo: "nao-recebe",
      motivo: emTeste
        ? "em modo teste"
        : p === "google"
          ? "falta o rótulo da compra"
          : "falta o token de conversões",
    };
  }
  if (loja.contagemIndisponivel) return { tipo: "sem-contagem", contas: recebem.length };

  const melhor = melhorDa(recebem, p);
  const semClique = melhor?.contagem.semAtribPorEvento.purchase ?? 0;
  let pior: { chegaram: number; esperados: number; faltam: number } | null = null;
  let compras = 0;
  for (const d of recebem) {
    const v = vereditoDoDestino(d, loja, diag);
    if (v.tipo === "razao") {
      if (
        !pior ||
        v.faltam > pior.faltam ||
        (v.faltam === pior.faltam && proporcao(v) < proporcao(pior))
      ) {
        pior = { chegaram: v.chegaram, esperados: v.esperados, faltam: v.faltam };
      }
    } else if (v.tipo === "sem-pedidos") {
      compras = Math.max(compras, v.compras);
    }
  }
  if (pior) return { tipo: "razao", ...pior, semClique, contas: recebem.length };
  return { tipo: "sem-pedidos", compras, semClique, contas: recebem.length };
}

export interface TextoColuna {
  texto: string;
  sub: string;
  /** 0 a 1, para a barra. null = sem barra. */
  fracao: number | null;
  tom: TomSaude;
}

/** A coluna em palavras: "178 de 182", "faltam 4 · 38 sem clique do Google". */
export function textoDaColuna(c: ColunaPlataforma, p: Plataforma): TextoColuna {
  // Com varias contas o numero e o da pior; "pior de" so quando alguma perde.
  const contas = (n: number, perde = false) =>
    n > 1 ? [perde ? `pior de ${n} contas` : `${n} contas`] : [];
  switch (c.tipo) {
    case "desligado":
      return { texto: "Desligado", sub: c.motivo, fracao: null, tom: "neutral" };
    case "nao-recebe":
      return { texto: "Não recebe a compra", sub: c.motivo, fracao: null, tom: "warn" };
    case "sem-contagem":
      return { texto: "—", sub: "sem contagem agora", fracao: null, tom: "neutral" };
    case "sem-pedidos":
      return {
        texto: plural(c.compras, "compra enviada", "compras enviadas"),
        sub: ["pedidos não conferidos", ...contas(c.contas)].join(" · "),
        fracao: null,
        tom: "neutral",
      };
    case "razao": {
      if (c.esperados === 0) {
        return {
          texto: "Nenhum pedido",
          sub: ["nada para comparar ainda", ...contas(c.contas)].join(" · "),
          fracao: null,
          tom: "neutral",
        };
      }
      const partes = [
        c.faltam === 0 ? "todas chegaram" : c.faltam === 1 ? "falta 1" : `faltam ${c.faltam}`,
      ];
      if (c.semClique > 0) partes.push(`${c.semClique} sem clique do ${NOME_CURTO[p]}`);
      partes.push(...contas(c.contas, c.faltam > 0));
      return {
        texto: `${c.chegaram} de ${c.esperados}`,
        sub: partes.join(" · "),
        fracao: c.chegaram / c.esperados,
        tom: c.faltam === 0 ? "ok" : c.chegaram === 0 ? "err" : "warn",
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Uma linha da lista.
// ---------------------------------------------------------------------------

export interface LinhaLoja {
  loja: LojaTracking;
  saude: Saude;
  problemas: Problema[];
  /** O que aparece na linha: o mais grave, ou o proximo passo da desligada. */
  principal: Problema | null;
  colunas: Record<Plataforma, ColunaPlataforma>;
}

/**
 * `temDiag`: a pagina perguntou a Shopify sobre esta loja nesta carga (so
 * loja ligada passa pelo diagnostico). Sem isso, cobrar "nao deu para
 * conferir" seria acusar uma falha que nao houve.
 */
export function linhaDaLoja(
  loja: LojaTracking,
  diag: DiagnosticoLoja | null,
  temDiag: boolean
): LinhaLoja {
  const { saude } = saudeDaLoja(loja, loja.ligado, diag, temDiag);
  const problemas = problemasDaLoja(loja, diag, temDiag);
  const principal =
    saude === "desligado" ? proximoPassoDesligada(loja) : (problemas[0] ?? null);
  return {
    loja,
    saude,
    problemas,
    principal,
    colunas: {
      meta: colunaDaPlataforma(loja, diag, "meta"),
      google: colunaDaPlataforma(loja, diag, "google"),
    },
  };
}

/** Da mais urgente para a mais tranquila. Empate mantem a ordem do servidor. */
export function ordenarLinhas(linhas: LinhaLoja[]): LinhaLoja[] {
  return [...linhas].sort((a, b) => ORDEM_SAUDE[a.saude] - ORDEM_SAUDE[b.saude]);
}

// ---------------------------------------------------------------------------
// Numeros do topo e o comparativo.
// ---------------------------------------------------------------------------

/** Chegaram de esperados numa plataforma, somando as lojas que comparam. */
export interface CoberturaPlataforma {
  chegaram: number;
  esperados: number;
  lojas: number;
}

export interface ResumoTela {
  /** Lojas na tela (ligadas ou nao). */
  total: number;
  rastreando: number;
  semDestino: number;
  /** Soma dos pedidos das lojas ligadas que a Shopify respondeu. null = nenhuma respondeu. */
  pedidos: number | null;
  /** Lojas ligadas cujos pedidos nao foram conferidos. */
  lojasSemPedidos: number;
  /**
   * Vendas que sairam para pelo menos um destino (o maior por loja, nunca a
   * soma). null = a contagem da fila falhou: zero aqui seria mentira.
   */
  enviadas: number | null;
  /**
   * Pedidos das lojas que da para comparar (lista de pedidos e contagem da
   * fila em maos). null = nenhuma loja compara.
   */
  pedidosComparaveis: number | null;
  /**
   * Pedido a pedido, por plataforma: a soma das colunas da linha (a pior conta
   * de cada loja). Separado de proposito -- o Google recebendo tudo nao pode
   * esconder o Meta sem receber nada.
   */
  porPlataforma: Record<Plataforma, CoberturaPlataforma | null>;
  /** Lojas ligadas que ficaram fora da comparacao. */
  lojasForaDaCobertura: number;
  paradas: number;
  atencao: number;
}

export function resumoDaTela(
  linhas: LinhaLoja[],
  diagnostico: Record<string, DiagnosticoLoja | undefined>
): ResumoTela {
  const ligadas = linhas.filter((l) => l.loja.ligado);
  let pedidos: number | null = null;
  let lojasSemPedidos = 0;
  let enviadas: number | null = 0;
  let pedidosComparaveis: number | null = null;
  let lojasForaDaCobertura = 0;
  const porPlataforma: Record<Plataforma, CoberturaPlataforma | null> = {
    meta: null,
    google: null,
  };

  for (const { loja, colunas } of ligadas) {
    const diag = diagnostico[loja.storeId] ?? null;
    if (diag?.pedidos7d == null) lojasSemPedidos += 1;
    else pedidos = (pedidos ?? 0) + diag.pedidos7d;

    // MAX entre os destinos, nao soma: a mesma venda rende uma linha para cada
    // conta configurada. Meta em modo teste fica fora -- vai para a aba de
    // teste, nao para a campanha. Sem a contagem, o total inteiro e "—".
    if (loja.contagemIndisponivel) enviadas = null;
    else if (enviadas !== null) {
      enviadas += loja.destinos
        .filter((d) => !emModoTeste(d))
        .reduce((m, d) => Math.max(m, d.contagem.porEvento.purchase ?? 0), 0);
    }

    // Sem lista de pedidos ou sem contagem da fila nao ha comparacao: somar
    // como zero acusaria venda perdida que nao se perdeu.
    if (loja.contagemIndisponivel || !diag?.pedidoIds) {
      lojasForaDaCobertura += 1;
      continue;
    }
    pedidosComparaveis = (pedidosComparaveis ?? 0) + diag.pedidoIds.length;
    for (const p of PLATAFORMAS) {
      const c = colunas[p];
      if (c.tipo !== "razao") continue;
      const atual = porPlataforma[p] ?? { chegaram: 0, esperados: 0, lojas: 0 };
      porPlataforma[p] = {
        chegaram: atual.chegaram + c.chegaram,
        esperados: atual.esperados + c.esperados,
        lojas: atual.lojas + 1,
      };
    }
  }

  return {
    total: linhas.length,
    rastreando: ligadas.length,
    semDestino: linhas.filter((l) => l.loja.destinos.length === 0).length,
    pedidos,
    lojasSemPedidos,
    enviadas,
    pedidosComparaveis,
    porPlataforma,
    lojasForaDaCobertura,
    paradas: ligadas.filter((l) => l.saude === "parado").length,
    atencao: ligadas.filter((l) => l.saude === "atencao").length,
  };
}

// ---------------------------------------------------------------------------
// "Por conta": o que cada conta enviou, de anuncio x total.
// ---------------------------------------------------------------------------

/** Os eventos da grade da tela principal (Pagamento so no detalhe da loja). */
export const EVENTOS_DA_GRADE: ChaveEvento[] = [
  "view_item",
  "add_to_cart",
  "begin_checkout",
  "purchase",
];

/** Uma conta na grade: a loja e o destino. */
export interface LinhaConta {
  loja: LojaTracking;
  destino: DestinoNaTela;
}

/**
 * As contas que estao enviando: loja ligada, destino ativo. POR CONTA, nunca
 * somadas: as 2 contas Google da Softnook recebem o mesmo evento, e somar
 * dobraria o numero que se compara com o Gerenciador.
 */
export function contasDaTela(lojas: LojaTracking[]): LinhaConta[] {
  return lojas.flatMap((loja) =>
    loja.ligado ? loja.destinos.filter((d) => d.ativo).map((destino) => ({ loja, destino })) : []
  );
}

/** Quantos envios de teste ha nessas contas (o numero ao lado de "Mostrar testes"). */
export function testesNaTela(contas: LinhaConta[]): number {
  let n = 0;
  for (const { loja, destino } of contas) {
    if (loja.contagemIndisponivel) continue;
    for (const v of Object.values(destino.contagem.testesPorEvento)) n += v ?? 0;
  }
  return n;
}

/**
 * Quantas compras o Meta diz ter atribuido, para mostrar ao lado das nossas.
 *
 * O Meta informa por CONTA DE ANUNCIO, ligada a loja; o envio e por PIXEL.
 * Com um pixel so na loja, as duas coisas se correspondem. Com dois, nao da
 * para dizer de qual pixel e o numero -- e ele nao aparece.
 */
export function comprasQueOMetaDiz(linha: LinhaConta): number | null {
  const { loja, destino } = linha;
  if (destino.plataforma !== "meta" || loja.comprasContadasPeloMeta === null) return null;
  const pixels = loja.destinos.filter((d) => d.plataforma === "meta" && d.ativo).length;
  return pixels === 1 ? loja.comprasContadasPeloMeta : null;
}

const INTEIRO = new Intl.NumberFormat("pt-BR");
const PORCENTO = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });

export function formatarInteiro(n: number): string {
  return INTEIRO.format(n);
}

/** 0,745 -> "74,5%". */
export function formatarFracao(f: number): string {
  return PORCENTO.format(f);
}

/** "Meta 65% · Google 100% dos pedidos", ou null sem nada para comparar. */
export function textoCobertura(
  porPlataforma: Record<Plataforma, CoberturaPlataforma | null>
): string | null {
  const partes = PLATAFORMAS.flatMap((p) => {
    const c = porPlataforma[p];
    return c && c.esperados > 0 ? [`${NOME_CURTO[p]} ${formatarFracao(c.chegaram / c.esperados)}`] : [];
  });
  return partes.length ? `${partes.join(" · ")} dos pedidos` : null;
}

/** "1 parada · 1 com atenção", ou "nenhuma loja". */
export function textoPrecisam(r: Pick<ResumoTela, "paradas" | "atencao">): string {
  if (r.paradas + r.atencao === 0) return "nenhuma loja";
  const partes: string[] = [];
  if (r.paradas > 0) partes.push(r.paradas === 1 ? "1 parada" : `${r.paradas} paradas`);
  if (r.atencao > 0) partes.push(`${r.atencao} com atenção`);
  return partes.join(" · ");
}
