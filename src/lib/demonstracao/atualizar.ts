import "server-only";

// ============================================================================
// Loja de demonstracao: a rodada do cron (api/jobs/demonstracao, 15 em 15
// min) -- e o --ao-vivo do scripts/demo-loja.ts, que chama a mesma coisa.
//
// Completa a loja ATE AGORA pelo mesmo gerador do `semear` (gravacao.ts): o
// banco fica como o script o deixaria. Seguranca:
//   - so a loja marcada (stores.demonstracao) E do gerador (id, dono e
//     dominio do plano.ts): a consulta e explicita, e toda escrita vai por
//     LOJA_ID e pelas contas/destino dela. Sem loja marcada, sai na primeira
//     consulta;
//   - nada fora do banco (nem Shopify, nem Meta, nem Google);
//   - trava por loja (fin_sync_state.sincronizando_desde, como o sync de
//     pedidos): a Vercel pode disparar duas vezes;
//   - teto por rodada (LIMITE_POR_RODADA linhas; o resto fica para a proxima)
//     e trava de tamanho (TETO_DE_LINHAS por tabela, contando as linhas da
//     loja): passou, nao grava e loga. O banco e o plano free (500 MB) -- cheio,
//     derruba as lojas reais;
//   - pedido gravado que o gerador nao conhece (o gerador mudou): nao grava.
// ============================================================================

import { ehColunaAusente } from "@/lib/financeiro/mapear-pedido";
import type { FxRateRow } from "@/lib/financeiro/tipos";
import { ARTHUR, CONTA_GOOGLE, CONTA_META, DOMINIO, FUSO, LOJA_ID, diaLocal, inicioDaJanela } from "./plano";
import { cotacaoBrl, montarCambio } from "./linhas";
import { montar, type Semeadura } from "./semeadura";
import {
  LIMITE_POR_RODADA,
  aparaFunil,
  apagarForaDaJanela,
  contarLinhas,
  cortar,
  gravar,
  gravarFrescor,
  lerCambio,
  lerEstado,
  linhasDoPlano,
  modoDaRodada,
  passaDoTeto,
  planejar,
  selecaoDaRodada,
  trocarFuso,
  type Admin,
  type Contagem,
  type Estado,
  type Modo,
} from "./gravacao";

/** Trava mais velha que isso e de rodada que morreu no meio. */
const TRAVA_VENCE_MS = 10 * 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

export interface RodadaDaLoja {
  loja: string;
  modo?: Modo;
  motivo?: string;
  /** Por que nao gravou (trava, tamanho, gerador que nao bate). */
  pulada?: string;
  gravadas?: Contagem;
  apagadas?: Contagem;
  /** Linhas que ficaram para a proxima rodada (teto por rodada). */
  adiadas?: number;
  ms: number;
}

export interface ResultadoDoCron {
  ok: boolean;
  lojas: RodadaDaLoja[];
  erros: string[];
}

const soNaoZero = (c: Contagem) => Object.fromEntries(Object.entries(c).filter(([, v]) => v > 0));

/**
 * Uma rodada da loja do gerador. `agoraMs` e o instante da rodada: tudo ate
 * ele vai para o banco (ou ate o teto, e a proxima continua).
 */
export async function atualizarLoja(admin: Admin, agoraMs: number, limite = LIMITE_POR_RODADA): Promise<RodadaDaLoja> {
  const inicio = Date.now();
  const r: RodadaDaLoja = { loja: DOMINIO, ms: 0 };
  const fim = (x: Partial<RodadaDaLoja>): RodadaDaLoja => ({ ...r, ...x, ms: Date.now() - inicio });

  // 1) Trava (atomica no UPDATE). Zero linhas: outra rodada esta gravando, ou
  //    a loja nunca foi semeada (sem fin_sync_state).
  const { data: travou, error: erroTrava } = await admin
    .from("fin_sync_state")
    .update({ sincronizando_desde: iso(agoraMs) })
    .eq("store_id", LOJA_ID)
    .or(`sincronizando_desde.is.null,sincronizando_desde.lt.${iso(agoraMs - TRAVA_VENCE_MS)}`)
    .select("fuso, cursor_atualizado");
  if (erroTrava) throw new Error(`fin_sync_state (trava): ${erroTrava.message}`);
  const sync = (travou ?? [])[0] as { fuso: string | null; cursor_atualizado: string | null } | undefined;
  if (!sync) return fim({ pulada: "outra rodada em curso (ou a loja sem fin_sync_state: rode o semear)" });

  let soltar = true;
  try {
    // 2) As contas de anuncio sao desta loja: o gasto vai pelo id delas.
    const { data: contas, error: erroContas } = await admin
      .from("ad_accounts")
      .select("id")
      .in("id", [CONTA_META.id, CONTA_GOOGLE.id])
      .eq("store_id", LOJA_ID);
    if (erroContas) throw new Error(`ad_accounts: ${erroContas.message}`);
    if ((contas ?? []).length !== 2) return fim({ pulada: "as contas de anuncio da loja nao estao no banco (rode o semear)" });

    // 3) O que esta gravado decide o modo.
    const estado = await lerEstado(admin, sync);
    let { modo, motivo } = modoDaRodada(estado, agoraMs);
    // Fuso trocado: vale ja (o "Hoje" da tela vira na meia-noite certa), e o
    // cursor zera -- as rodadas seguem completas ate a janela estar no fuso novo.
    if (estado.fuso !== FUSO) await trocarFuso(admin);

    // 4) O gerador, so no que a rodada precisa.
    const hoje = diaLocal(agoraMs);
    const fx = await lerCambio(admin, inicioDaJanela(hoje), hoje);
    const cambio = montarCambio(fx);
    let s = montar(agoraMs, cambio, fx, selecaoDaRodada(modo, estado, agoraMs));

    // 5) O que saiu das janelas: o funil toda rodada, o resto uma vez por dia.
    const apagadas = modo === "incremental" ? { "tracking_events (funil)": await aparaFunil(admin, s) } : await apagarForaDaJanela(admin, s);
    r.apagadas = soNaoZero(apagadas);

    // 6) O plano, conferido com o banco. O incremental manda o que nasceu
    //    desde o cursor sem conferir; se isso passa do teto por rodada (o cron
    //    ficou parado), a rodada confere os ultimos dias como o diario -- tudo
    //    conferido, cada rodada anda, e nenhuma repete a anterior.
    let plano = await planejar(admin, s, modo, estado);
    if (modo === "incremental" && linhasDoPlano(plano) > limite) {
      modo = "diario";
      motivo = "o incremental passava do teto por rodada: conferindo os ultimos dias";
      s = montar(agoraMs, cambio, fx, selecaoDaRodada(modo, estado, agoraMs));
      plano = await planejar(admin, s, modo, estado);
    }
    r.modo = modo;
    r.motivo = motivo;
    // Pedido gravado que o gerador nao conhece: o id mudou -- gravar
    // duplicaria a loja.
    if (plano.desconhecidos.length) {
      const msg = `${plano.desconhecidos.length} pedido(s) no banco que o gerador nao conhece (ex.: ${plano.desconhecidos.slice(0, 3).join(", ")}): o gerador mudou? Nada gravado -- confira e rode o limpar + semear.`;
      console.error(`[demonstracao] ${DOMINIO}: ${msg}`);
      return fim({ pulada: msg });
    }

    // 7) Trava de tamanho: as linhas da loja mais as novas, contra o teto.
    const teto = passaDoTeto(await contarLinhas(admin), plano.novas);
    if (teto) {
      const msg = `passaria do teto de linhas (${teto}). Nada gravado.`;
      console.error(`[demonstracao] ${DOMINIO}: ${msg}`);
      return fim({ pulada: msg });
    }

    // 8) Teto por rodada e gravacao. O cursor so anda quando nada ficou para tras.
    const cortado = cortar(plano, limite, modo === "completo");
    r.gravadas = soNaoZero(await gravar(admin, s, cortado, cotacaoBrl(fx)));
    r.adiadas = cortado.adiadas;
    await gravarFrescor(admin, agoraMs, cortado.adiadas === 0);
    soltar = false;
    return fim({});
  } finally {
    if (soltar) {
      const { error } = await admin.from("fin_sync_state").update({ sincronizando_desde: null }).eq("store_id", LOJA_ID);
      if (error) console.error(`[demonstracao] ${DOMINIO}: soltar a trava: ${error.message}`);
    }
  }
}

/**
 * O modo do `semear` do script: no minimo o diario (confere os ultimos
 * DIAS_REGRAVADOS dias e limpa as janelas); --tudo regrava sem conferir.
 */
export function modoDoScript(estado: Estado, agoraMs: number, tudo: boolean): { modo: Modo; motivo: string } {
  if (tudo) return { modo: "completo", motivo: "--tudo: a janela inteira, sem olhar se difere" };
  const d = modoDaRodada(estado, agoraMs);
  if (d.modo === "incremental") return { modo: "diario", motivo: "o script confere os ultimos dias" };
  return d;
}

/**
 * O `semear` de verdade do script, sem teto: `s` e a janela inteira montada
 * (montar sem selecao). Mesmas funcoes do cron, na mesma ordem; quem chama ja
 * conferiu o espaco (tamanho.ts) e criou a loja se faltava.
 */
export async function semearAgora(
  admin: Admin,
  s: Semeadura,
  fx: FxRateRow[],
  estado: Estado,
  opcoes: { tudo?: boolean } = {}
): Promise<{ modo: Modo; motivo: string; apagadas: Contagem; gravadas: Contagem }> {
  const { modo, motivo } = modoDoScript(estado, s.agoraMs, Boolean(opcoes.tudo));
  if (estado.fuso !== FUSO) await trocarFuso(admin);
  const apagadas = await apagarForaDaJanela(admin, s);
  const plano = await planejar(admin, s, modo, estado, { tudo: opcoes.tudo });
  if (plano.desconhecidos.length) {
    throw new Error(
      `${plano.desconhecidos.length} pedido(s) no banco que o gerador nao conhece (ex.: ${plano.desconhecidos.slice(0, 3).join(", ")}): o gerador mudou de um jeito que troca os ids. Nada foi gravado -- rode o limpar e o semear.`
    );
  }
  const gravadas = await gravar(admin, s, plano, cotacaoBrl(fx));
  await gravarFrescor(admin, s.agoraMs, true);
  return { modo, motivo, apagadas, gravadas };
}

/**
 * A rodada do cron: as lojas marcadas. So a do gerador e atualizada; outra
 * loja marcada (de outro dono, outro dominio) fica como esta.
 */
export async function atualizarLojasDeDemonstracao(
  admin: Admin,
  opcoes: { agoraMs?: number; limite?: number } = {}
): Promise<ResultadoDoCron> {
  const saida: ResultadoDoCron = { ok: true, lojas: [], erros: [] };
  // A UNICA consulta quando nao ha loja de demonstracao.
  const { data, error } = await admin.from("stores").select("id, user_id, shop_domain").eq("demonstracao", true).limit(20);
  if (error) {
    // Sem a 074 nao ha loja de demonstracao.
    if (ehColunaAusente(error)) return saida;
    return { ok: false, lojas: [], erros: [`stores: ${error.message}`] };
  }
  for (const loja of (data ?? []) as { id: string; user_id: string; shop_domain: string }[]) {
    if (loja.id !== LOJA_ID || loja.user_id !== ARTHUR || loja.shop_domain !== DOMINIO) {
      saida.lojas.push({ loja: loja.shop_domain, pulada: "loja de demonstracao sem gerador (so a do scripts/demo-loja.ts tem)", ms: 0 });
      continue;
    }
    try {
      const rodada = await atualizarLoja(admin, opcoes.agoraMs ?? Date.now(), opcoes.limite);
      saida.lojas.push(rodada);
      const partes = [
        rodada.modo ? `${rodada.modo} (${rodada.motivo})` : null,
        rodada.pulada ? `PULADA: ${rodada.pulada}` : null,
        rodada.gravadas && Object.keys(rodada.gravadas).length ? `gravadas ${JSON.stringify(rodada.gravadas)}` : rodada.pulada ? null : "nada novo",
        rodada.apagadas && Object.keys(rodada.apagadas).length ? `apagadas ${JSON.stringify(rodada.apagadas)}` : null,
        rodada.adiadas ? `${rodada.adiadas} para a proxima rodada` : null,
      ].filter(Boolean);
      console.log(`[demonstracao] ${loja.shop_domain}: ${partes.join(" · ")} · ${rodada.ms} ms`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[demonstracao] ${loja.shop_domain}: ${msg}`);
      saida.erros.push(`${loja.shop_domain}: ${msg.slice(0, 300)}`);
    }
  }
  saida.ok = saida.erros.length === 0;
  return saida;
}
