"use client";

import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge, type TomStatus } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { FUSO_RELATORIO_PADRAO } from "@/lib/financeiro/tipos";
import {
  NOME_REDE,
  OPCOES_COMPRA_QUANDO,
  ROTULO_STATUS_ENVIO,
  nomeDaPlataforma,
  type CheckoutResumo,
  type CompraQuando,
  type DestinoNaTela,
  type PlataformaRastreio,
  type RastreamentoDoCheckout,
  type StatusDoEnvio,
} from "@/lib/checkouts-externos/tipos";
import { Codigo } from "../../tracking/pagina-externa";
import { chamar } from "../api";
import { haQuantoTempo, quando } from "../regras";

// ============================================================================
// Rastreamento do checkout (Cakto, Hubla e Eve, 073): o xcart manda a compra ao
// Meta e ao TikTok pelo servidor. Um pixel por rede, "Mandar a compra" (gerada
// ou so aprovada), o aviso de tirar o pixel nativo da plataforma, o uso do limite do
// plano, a tag da ponte para a pagina de vendas (Fase D: PageView e
// InitiateCheckout, e o visitante no link) e as ultimas compras enviadas.
// Tudo por /api/checkouts/[id]/rastreamento: o token vai so para o servidor,
// a tela so sabe SE ha um salvo.
// ============================================================================

type Resposta = RastreamentoDoCheckout & { ok: true };

const TOM_ENVIO: Record<StatusDoEnvio, TomStatus> = { pendente: "run", enviado: "ok", falhou: "err" };

/**
 * O detalhe da linha em portugues. O aviso do envio vem do caminho comum com
 * as lojas (src/lib/tracking/envio.ts) e la fica como esta; o erro da rede
 * (Meta, TikTok) aparece como ela escreveu.
 */
function detalheDoEnvio(detalhe: string | null): string {
  if (!detalhe) return "—";
  if (detalhe.startsWith("sem fbc")) return "Sem fbc: não veio de um clique em anúncio do Meta. Casa por e-mail e telefone.";
  if (detalhe.startsWith("sem ttclid")) return "Sem ttclid: não veio de um clique em anúncio do TikTok. Casa por e-mail e telefone.";
  return detalhe;
}

const TEXTOS: Record<PlataformaRastreio, { conta: string; exemplo: string; token: string; ondeToken: string }> = {
  meta: {
    conta: "ID do pixel (conjunto de dados)",
    exemplo: "Ex.: 123456789012345",
    token: "Token da API de Conversões",
    ondeToken: "Gerenciador de Eventos › o pixel › Configurações › Gerar token de acesso.",
  },
  tiktok: {
    conta: "Pixel ID do TikTok",
    exemplo: "Ex.: CUSG5HBC77UD11VVRQEG",
    token: "Access Token da Events API",
    ondeToken: "Gerenciador de eventos do TikTok › o pixel › Configurações › Gerar token de acesso.",
  },
};

function CartaoDestino({
  checkoutId,
  plataforma,
  destino,
  aoMudar,
}: {
  checkoutId: string;
  plataforma: PlataformaRastreio;
  destino: DestinoNaTela | null;
  aoMudar: (r: Resposta) => void;
}) {
  const id = useId();
  const t = TEXTOS[plataforma];
  const rede = NOME_REDE[plataforma];
  const [conta, setConta] = useState(destino?.conta ?? "");
  const [token, setToken] = useState("");
  const [teste, setTeste] = useState(destino?.testEventCode ?? "");
  const [salvando, setSalvando] = useState(false);
  const [mudando, setMudando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const url = `/api/checkouts/${checkoutId}/rastreamento`;

  async function salvar() {
    if (!conta.trim()) return setErro(`Cole o ${t.conta.toLowerCase()}.`);
    if (!token.trim() && !destino?.temToken) return setErro(`Cole o ${t.token}.`);
    setErro(null);
    setSalvando(true);
    const r = await chamar<Resposta>(url, {
      method: "POST",
      body: JSON.stringify({
        plataforma,
        conta: conta.trim(),
        ...(token.trim() ? { token: token.trim() } : {}),
        testEventCode: teste.trim(),
        ativo: destino ? destino.ativo : true,
      }),
    });
    setSalvando(false);
    if (!r.ok) return setErro(r.erro);
    setToken("");
    toast.success(`${rede} salvo`, { description: "O token foi conferido. A próxima venda já sai por aqui." });
    aoMudar(r);
  }

  async function alternar(ativo: boolean) {
    setMudando(true);
    const r = await chamar<Resposta>(url, { method: "PATCH", body: JSON.stringify({ plataforma, ativo }) });
    setMudando(false);
    if (!r.ok) return toast.error("Não deu para salvar", { description: r.erro });
    toast.success(ativo ? `${rede} ligado` : `${rede} desligado`, {
      description: ativo ? "A próxima venda já sai por aqui." : "Nenhuma compra sai para este pixel até você ligar de novo.",
    });
    aoMudar(r);
  }

  async function remover() {
    setMudando(true);
    const r = await chamar<Resposta>(`${url}?plataforma=${plataforma}`, { method: "DELETE" });
    setMudando(false);
    if (!r.ok) return toast.error("Não deu para remover", { description: r.erro });
    setConta("");
    setToken("");
    setTeste("");
    toast.success(`${rede} removido`);
    aoMudar(r);
  }

  const estado: { tom: TomStatus; texto: string } = !destino
    ? { tom: "neutral", texto: "Não configurado" }
    : destino.ativo
      ? { tom: "ok", texto: "Ligado" }
      : { tom: "neutral", texto: "Desligado" };

  return (
    <section aria-labelledby={`${id}-titulo`} className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`${id}-titulo`} className="text-body font-semibold text-ink">
          {rede}
        </h3>
        <StatusBadge tom={estado.tom}>{estado.texto}</StatusBadge>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-conta`}>{t.conta}</Label>
        <Input
          id={`${id}-conta`}
          value={conta}
          onChange={(ev) => setConta(ev.target.value)}
          placeholder={t.exemplo}
          autoComplete="off"
          spellCheck={false}
          className="font-mono text-dense"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-token`}>{t.token}</Label>
        <Input
          id={`${id}-token`}
          type="password"
          value={token}
          onChange={(ev) => setToken(ev.target.value)}
          placeholder={destino?.temToken ? "Salvo · cole outro para trocar" : "Cole o token"}
          autoComplete="off"
          spellCheck={false}
          className="font-mono text-dense"
          aria-describedby={`${id}-token-ajuda`}
        />
        <p id={`${id}-token-ajuda`} className="text-label text-t2">
          {t.ondeToken}
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-teste`}>Código de teste (opcional)</Label>
        <Input
          id={`${id}-teste`}
          value={teste}
          onChange={(ev) => setTeste(ev.target.value)}
          placeholder="Ex.: TEST12345"
          autoComplete="off"
          spellCheck={false}
          className="font-mono text-dense"
          aria-describedby={`${id}-teste-ajuda`}
        />
        <p id={`${id}-teste-ajuda`} className="text-label text-t2">
          Com ele, a compra cai só na aba Testar eventos e não conta na campanha. Apague para valer de verdade.
        </p>
      </div>
      {erro ? <p className="text-label text-err">{erro}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {destino ? (
          <Switch
            rotulo="Mandar a compra para este pixel"
            checked={destino.ativo}
            disabled={mudando || salvando}
            onCheckedChange={(v) => void alternar(v)}
          />
        ) : (
          <span />
        )}
        <span className="flex items-center gap-2">
          {destino ? (
            <Button variant="ghost" size="sm" onClick={() => void remover()} disabled={mudando || salvando}>
              Remover
            </Button>
          ) : null}
          <Button variant="secondary" size="sm" pending={salvando} onClick={() => void salvar()} disabled={mudando}>
            {destino ? "Salvar" : `Ligar o ${rede}`}
          </Button>
        </span>
      </div>
    </section>
  );
}

function TextoDoUso({ uso }: { uso: RastreamentoDoCheckout["uso"] }) {
  if (!uso) return null;
  const n = uso.emUso;
  const lojas = n === 1 ? "loja" : "lojas";
  const texto =
    uso.limite === null
      ? `Checkout com rastreamento conta como uma loja no plano. Hoje: ${n} ${lojas} com rastreamento, sem limite.`
      : uso.limite === 0
        ? "Seu plano não inclui rastreamento. O Completo inclui até 5 lojas ou checkouts."
        : `Checkout com rastreamento conta como uma loja no plano: ${n} de ${uso.limite} em uso${uso.esteConta ? ", este incluído" : ""}.`;
  return <p className="text-label text-t2">{texto}</p>;
}

/** O que a pagina de vendas mandou pela ponte nas ultimas 24 h (Fase D). */
function TextoDaPagina({ daPagina, temPixel }: { daPagina: RastreamentoDoCheckout["daPagina"] | null; temPixel: boolean }) {
  if (!temPixel) {
    return <p className="text-label text-t2">Ligue um pixel acima: sem ele, a página não manda nada.</p>;
  }
  if (!daPagina) return null;
  const { visitas, inicios } = daPagina;
  if (visitas === 0 && inicios === 0) {
    return <p className="text-label text-t2">Nenhuma visita da página nas últimas 24 h. Confira se o script está colado.</p>;
  }
  const v = visitas === 1 ? "1 visita" : `${visitas} visitas`;
  const i = inicios === 1 ? "1 clique no botão" : `${inicios} cliques no botão`;
  return <p className="text-label text-t2">Últimas 24 h: {v} e {i} chegaram ao Panda Track.</p>;
}

export function RastreamentoCheckout({ checkout, aoFechar }: { checkout: CheckoutResumo; aoFechar: () => void }) {
  const id = useId();
  const [dados, setDados] = useState<RastreamentoDoCheckout | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [mudandoQuando, setMudandoQuando] = useState(false);
  const [agora, setAgora] = useState(() => Date.now());
  const url = `/api/checkouts/${checkout.id}/rastreamento`;
  const plataforma = nomeDaPlataforma(checkout.plataforma);

  useEffect(() => {
    let vivo = true;
    void chamar<Resposta>(url).then((r) => {
      if (!vivo) return;
      setAgora(Date.now());
      if (r.ok) setDados(r);
      else setErro(r.erro);
    });
    return () => {
      vivo = false;
    };
  }, [url]);

  function aoMudar(r: Resposta) {
    setAgora(Date.now());
    setDados(r);
  }

  async function mudarQuando(v: CompraQuando) {
    setMudandoQuando(true);
    const r = await chamar<Resposta>(url, { method: "PATCH", body: JSON.stringify({ compra_quando: v }) });
    setMudandoQuando(false);
    if (!r.ok) return toast.error("Não deu para salvar", { description: r.erro });
    toast.success("Envio da compra salvo");
    aoMudar(r);
  }

  const opcao = OPCOES_COMPRA_QUANDO.find((o) => o.id === dados?.compraQuando) ?? OPCOES_COMPRA_QUANDO[0];
  const destinoDe = (p: PlataformaRastreio) => dados?.destinos.find((d) => d.plataforma === p) ?? null;

  return (
    <Dialog open onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Rastreamento · {checkout.nome}</DialogTitle>
          <DialogDescription>
            O Panda Track manda a compra da {plataforma} ao Meta e ao TikTok pelo servidor, com e-mail e telefone do comprador
            criptografados.
          </DialogDescription>
        </DialogHeader>

        {erro ? (
          <Callout tom="err" titulo="Não deu para carregar o rastreamento.">
            {erro}
          </Callout>
        ) : !dados ? (
          <p className="text-dense text-t2" aria-live="polite">
            Carregando…
          </p>
        ) : dados.semMigration ? (
          <Callout tom="warn" titulo="Rastreamento do checkout ainda não liberado.">
            Falta atualizar o banco. Tente de novo mais tarde.
          </Callout>
        ) : (
          <div className="flex flex-col gap-4">
            <Callout tom="warn" titulo="Um emissor por pixel">
              {checkout.plataforma === "eve" ? (
                <>
                  A página que usa a Eve (como a da panela) já manda o próprio pixel e a API de Conversões. Ligue um
                  pixel aqui só se tirar o de lá: com os dois mandando, a compra conta em dobro. Sem pixel ligado, o
                  Panda Track não manda nada.
                </>
              ) : checkout.plataforma === "hubla" ? (
                <>
                  Na Hubla, tire o Pixel do Meta e o token da API de Conversões em{" "}
                  <span className="font-medium text-ink">Produtos › o produto › Configurações › Pixel</span>, e o pixel
                  do TikTok em <span className="font-medium text-ink">Pixels de Rastreamento</span>. Com os dois
                  mandando, a compra conta em dobro. O Google Ads continua na Hubla.
                </>
              ) : (
                <>
                  Na {plataforma}, tire o Pixel do Meta (e o token da API de Conversões) e o Pixel e o token do TikTok em{" "}
                  <span className="font-medium text-ink">Produto › Configurações › Pixel de conversão</span>. Com os dois
                  mandando, a compra conta em dobro. O Google Ads continua na {plataforma}.
                </>
              )}
            </Callout>

            <div className="flex flex-col gap-1.5">
              <Label id={`${id}-quando`}>Mandar a compra</Label>
              <Select value={opcao.id} onValueChange={(v) => v && void mudarQuando(v as CompraQuando)} disabled={mudandoQuando}>
                <SelectTrigger aria-labelledby={`${id}-quando`} className="w-full sm:w-96">
                  <SelectValue>{() => opcao.rotulo}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {OPCOES_COMPRA_QUANDO.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.rotulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-label text-t2">{opcao.descricao} Reembolso e chargeback não mandam nada.</p>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {(["meta", "tiktok"] as const).map((p) => (
                <CartaoDestino
                  key={`${p}:${destinoDe(p)?.conta ?? ""}`}
                  checkoutId={checkout.id}
                  plataforma={p}
                  destino={destinoDe(p)}
                  aoMudar={aoMudar}
                />
              ))}
            </div>

            <TextoDoUso uso={dados.uso} />

            {dados.scriptDaPagina ? (
              <section aria-labelledby={`${id}-pagina`} className="flex flex-col gap-2">
                <h3 id={`${id}-pagina`} className="text-dense font-semibold text-ink">
                  Página de vendas (VSL)
                </h3>
                <p className="text-label text-t1">
                  Cole na página, antes de <span className="font-mono">&lt;/body&gt;</span>. O botão aponta para o link da
                  oferta na {plataforma}, sem nada a mais: o script leva o visitante, as UTMs e o clique do anúncio, e
                  manda a visita e o clique no botão (PageView e InitiateCheckout). Não instale o pixel do Meta nem do
                  TikTok na página.
                </p>
                <Codigo rotulo="Script da página" texto={dados.scriptDaPagina} />
                <TextoDaPagina daPagina={dados.daPagina ?? null} temPixel={dados.destinos.some((d) => d.ativo)} />
              </section>
            ) : null}

            <section aria-labelledby={`${id}-envios`} className="flex flex-col gap-2">
              <h3 id={`${id}-envios`} className="text-dense font-semibold text-ink">
                Últimas compras enviadas
              </h3>
              {dados.envios.length === 0 ? (
                <p className="text-dense text-t2">Nenhuma compra enviada ainda. O teste do webhook não manda compra.</p>
              ) : (
                <div className="overflow-x-auto rounded-card border border-border bg-surface">
                  <table className="w-full border-collapse text-dense">
                    <caption className="sr-only">Últimas compras enviadas ao Meta e ao TikTok</caption>
                    <thead>
                      <tr className="text-label text-t2">
                        {["Quando", "Rede", "Pedido", "Situação", "Detalhe"].map((c) => (
                          <th key={c} scope="col" className="h-9 border-b border-border px-3.5 text-left font-medium">
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {dados.envios.map((e) => (
                        <tr
                          key={e.id}
                          className="[&>td]:h-11 [&>td]:border-b [&>td]:border-border-subtle [&>td]:px-3.5 last:[&>td]:border-b-0"
                        >
                          <td className="num whitespace-nowrap text-t1" title={quando(e.criadoEm, agora, FUSO_RELATORIO_PADRAO)}>
                            {haQuantoTempo(e.criadoEm, agora)}
                          </td>
                          <td className="whitespace-nowrap">{NOME_REDE[e.plataforma]}</td>
                          <td className="num whitespace-nowrap">{e.grupo ? `#${e.grupo}` : "—"}</td>
                          <td className="whitespace-nowrap">
                            <StatusBadge tom={TOM_ENVIO[e.status]}>{ROTULO_STATUS_ENVIO[e.status]}</StatusBadge>
                          </td>
                          <td className="min-w-48 text-label text-t2">{detalheDoEnvio(e.detalhe)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}
