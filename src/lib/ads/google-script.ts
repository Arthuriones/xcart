// ============================================================================
// O Google Ads Script que o lojista cola em CADA conta.
//
// Ele roda dentro da conta (Ferramentas > Acoes em massa > Scripts), le o
// gasto dos ultimos 30 dias por campanha e por dia e manda por POST para
// ROTAS.apiGoogleIngest. 30 dias, nao so hoje: o Google corrige custo para
// tras (clique invalido estornado) e o reenvio da janela inteira mantem o
// historico certo sem um segundo agendamento.
//
// O segredo vai DENTRO do texto: e a senha da conta no xcart. Por isso a tela
// mostra o script uma vez so, e "Gerar novo script" invalida o anterior.
//
// O template nao tem crase nem cifrao-chave de proposito: e um template
// literal do TS, e qualquer um dos dois quebraria ou interpolaria o texto.
// Os placeholders sao trocados por split/join, nunca por regex.
// ============================================================================

const TEMPLATE = `/**
 * xcart -- envia o gasto desta conta do Google Ads para o xcart.
 *
 * Agende para rodar "De hora em hora". Nao compartilhe este texto:
 * a linha SEGREDO e a senha desta conta no xcart. Perdeu? Gere outro
 * script na tela Contas de anuncio (o antigo para de funcionar).
 */
var URL_XCART = '__URL__';
var SEGREDO = '__SEGREDO__';
var DIAS = 30;

function main() {
  var conta = AdsApp.currentAccount();
  var fuso = conta.getTimeZone();
  var agora = new Date();
  var fim = Utilities.formatDate(agora, fuso, 'yyyy-MM-dd');
  var inicio = Utilities.formatDate(new Date(agora.getTime() - (DIAS - 1) * 86400000), fuso, 'yyyy-MM-dd');

  var consulta =
    'SELECT segments.date, campaign.id, campaign.name, campaign.status, ' +
    'metrics.cost_micros, metrics.clicks, metrics.impressions, ' +
    'metrics.conversions, metrics.conversions_value ' +
    'FROM campaign ' +
    "WHERE segments.date BETWEEN '" + inicio + "' AND '" + fim + "'";

  var linhas = [];
  var resultado = AdsApp.search(consulta);
  while (resultado.hasNext()) {
    var r = resultado.next();
    var m = r.metrics || {};
    linhas.push({
      data: r.segments.date,
      campanha_id: String(r.campaign.id),
      campanha: String(r.campaign.name || '').slice(0, 255),
      status: String(r.campaign.status || ''),
      custo_micros: String(Math.round(Number(m.costMicros || 0))),
      cliques: Math.round(Number(m.clicks || 0)),
      impressoes: Math.round(Number(m.impressions || 0)),
      conversoes: Number(m.conversions || 0),
      valor_conversoes: Number(m.conversionsValue || 0)
    });
  }

  var corpo = {
    v: 1,
    customer_id: conta.getCustomerId(),
    moeda: conta.getCurrencyCode(),
    fuso: fuso,
    inicio: inicio,
    fim: fim,
    gerado_em: agora.toISOString(),
    linhas: linhas
  };

  var resposta = UrlFetchApp.fetch(URL_XCART, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + SEGREDO },
    payload: JSON.stringify(corpo),
    muteHttpExceptions: true
  });

  var codigo = resposta.getResponseCode();
  var texto = resposta.getContentText();
  if (codigo !== 200) {
    // Lancar faz o Google Ads marcar a execucao como falha no historico.
    throw new Error('xcart recusou o envio (HTTP ' + codigo + '): ' + texto.slice(0, 300));
  }
  Logger.log('xcart recebeu ' + linhas.length + ' linhas de ' + inicio + ' a ' + fim + ': ' + texto);
}
`;

export function scriptGoogleAds(p: { url: string; segredo: string }): string {
  return TEMPLATE.split("__URL__").join(p.url).split("__SEGREDO__").join(p.segredo);
}
