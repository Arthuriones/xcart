"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CircleAlert,
  Loader2,
  Pencil,
  Plus,
  Power,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EVENTOS } from "@/lib/tracking/eventos";
import {
  TEMPLATE_PADRAO,
  TEMPLATES_SUGERIDOS,
  validarTemplate,
} from "@/lib/tracking/id-produto";
import type { DestinoNaTela } from "@/lib/tracking/queries";

// ============================================================================
// Os destinos de conversao de uma loja, na tela.
//
// POR QUE UMA LISTA, E NAO DOIS CAMPOS
//
// Pedido do Arthur, e caso real dele: cinco contas de Google anunciando produtos
// diferentes do mesmo catalogo. Ate a migration 043 isto era UMA coluna por
// plataforma, e a segunda conta nao tinha onde morar.
//
// E seguro cadastrar todas: conversao cujo gclid nao pertence a conta e
// DESCARTADA pelo Google -- a conta dona do clique conta, as outras ignoram.
// Entao nao existe roteamento por produto a configurar aqui, e e de proposito
// que a tela nao pede um.
// ============================================================================

type Plataforma = "google" | "meta";

const NOME_DA_PLATAFORMA: Record<Plataforma, string> = {
  google: "Google Ads",
  meta: "Meta Ads",
};

function Pill({
  tom,
  children,
  title,
}: {
  tom: "ok" | "alerta" | "erro" | "neutro";
  children: React.ReactNode;
  title?: string;
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
    <span
      title={title}
      className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${cor}`}
    >
      {children}
    </span>
  );
}

/** O que falta para este destino enviar algo. Vazio = esta pronto. */
function oQueFalta(d: DestinoNaTela): string | null {
  if (d.plataforma === "meta") {
    return d.temToken ? null : "falta o token do CAPI — sem ele nenhum evento sai";
  }
  return Object.keys(d.labels).length > 0
    ? null
    : "falta o rótulo de ao menos um evento — sem rótulo não há o que enviar";
}

/**
 * O formulario de um destino: cadastro e edicao no mesmo lugar.
 *
 * Google e Meta pedem coisas diferentes e o motivo nao e cosmetico: no Google
 * cada evento e uma conversion action propria, com rotulo proprio, e o rotulo
 * vazio e como dizer "nao quero este evento". No Meta um pixel cobre todos os
 * eventos, e o que separa funcionar de nao funcionar e o token.
 */
function FormularioDestino({
  storeId,
  plataforma,
  destino,
  aberto,
  onFechar,
}: {
  storeId: string;
  plataforma: Plataforma;
  /** Ausente = cadastro novo. */
  destino?: DestinoNaTela;
  aberto: boolean;
  onFechar: () => void;
}) {
  const router = useRouter();
  const editando = Boolean(destino);

  const [nome, setNome] = useState(destino?.nome ?? "");
  const [conta, setConta] = useState(destino?.conta ?? "");
  const [rotulos, setRotulos] = useState<Record<string, string>>(() => {
    const inicial: Record<string, string> = {};
    for (const e of EVENTOS) inicial[e.chave] = destino?.labels[e.chave] ?? "";
    return inicial;
  });
  // Comeca vazio SEMPRE, mesmo com token gravado: o valor nunca sai do servidor.
  const [token, setToken] = useState("");
  const [codigoTeste, setCodigoTeste] = useState(destino?.testEventCode ?? "");
  const [idTemplate, setIdTemplate] = useState(
    destino?.idTemplate ?? TEMPLATE_PADRAO
  );
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setSalvando(true);
    try {
      const corpo: Record<string, unknown> = {
        nome,
        conta,
        idTemplate,
        ...(plataforma === "google"
          ? { labels: rotulos }
          : { accessToken: token, testEventCode: codigoTeste }),
      };

      const r = await fetch("/api/tracking/destinos", {
        method: editando ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          editando ? { ...corpo, id: destino!.id } : { ...corpo, storeId, plataforma }
        ),
      });
      const j = await r.json();
      // Token recusado pelo Meta volta 400 com a mensagem DELE ("Invalid OAuth
      // access token", "...does not have permission"): e o que diz ao lojista o
      // que consertar no Events Manager, entao vai inteira para o toast.
      if (!r.ok) throw new Error(j.error || "Falha ao salvar.");

      // Compras que tinham caido pelo token antigo voltaram para a fila. Dizer
      // quantas e o que tira a duvida "e as vendas do fim de semana?" -- sem
      // isto, o "falharam" da linha so some sozinho, sem explicacao.
      // `requeued` conta todo evento devolvido a fila (funil incluido);
      // `requeuedPurchases` so as compras, que e o numero que importa ao lojista.
      const total = typeof j.requeued === "number" ? j.requeued : 0;
      const compras = typeof j.requeuedPurchases === "number" ? j.requeuedPurchases : 0;
      if (compras > 0) {
        toast.success(
          `Token atualizado. ${compras} ${
            compras === 1
              ? "compra que tinha falhado vai ser reenviada"
              : "compras que tinham falhado vão ser reenviadas"
          }.`
        );
      } else if (total > 0) {
        toast.success(
          `Token atualizado. ${total} ${
            total === 1
              ? "evento que tinha falhado vai ser reenviado"
              : "eventos que tinham falhado vão ser reenviados"
          }.`
        );
      } else {
        toast.success(editando ? "Destino atualizado." : "Destino adicionado.");
      }
      onFechar();
      // A contagem e o veredito vem do servidor; sem isto a linha nova apareceria
      // sem nenhum numero e pareceria quebrada.
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setSalvando(false);
    }
  }

  const erroDoTemplate =
    idTemplate.trim() && idTemplate.trim() !== TEMPLATE_PADRAO
      ? validarTemplate(idTemplate)
      : null;

  const quantosRotulos = Object.values(rotulos).filter((v) => v.trim()).length;
  const podeSalvar =
    !erroDoTemplate &&
    (plataforma === "google"
      ? Boolean(conta.trim()) && quantosRotulos > 0
      : Boolean(conta.trim()) && (editando ? true : Boolean(token.trim())));

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editando ? "Editar" : "Adicionar"} {NOME_DA_PLATAFORMA[plataforma]}
          </DialogTitle>
          <DialogDescription>
            {plataforma === "google"
              ? "O ID da conta mais o rótulo de cada evento que você quer medir."
              : "O ID do pixel mais o token do CAPI. Um pixel cobre todos os eventos."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-[11px]">Apelido</Label>
              <Input
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder={plataforma === "google" ? "Conta principal" : "Pixel 1"}
                className="h-8 text-xs"
              />
              {/* Com duas contas da mesma plataforma, o numero sozinho nao diz
                  qual e qual quando chega a hora de desativar uma. */}
              <p className="text-[10px] text-muted-foreground">
                só para você reconhecer na lista
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">
                {plataforma === "google" ? "ID de conversão" : "ID do pixel"}
              </Label>
              <Input
                value={conta}
                onChange={(e) => setConta(e.target.value)}
                placeholder={plataforma === "google" ? "AW-123456789" : "1234567890123456"}
                className="h-8 font-mono text-xs"
              />
            </div>
          </div>

          {plataforma === "google" && (
            <div className="space-y-2.5">
              <div>
                <Label className="text-[11px]">Rótulo por evento</Label>
                <p className="text-[11px] text-muted-foreground">
                  Google Ads → Objetivos → Conversões. Uma ação por evento; copie o
                  rótulo de cada uma. Deixe <strong>compra</strong> como principal e as
                  outras como <strong>secundárias</strong>, senão o lance passa a
                  otimizar para carrinho em vez de venda.
                </p>
              </div>

              {EVENTOS.map((ev) => (
                <div
                  key={ev.chave}
                  className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,13rem)] sm:items-center"
                >
                  <div className="min-w-0">
                    <span className="text-sm">{ev.nome}</span>
                    <p className="text-[11px] text-muted-foreground">{ev.descricao}</p>
                  </div>
                  <Input
                    value={rotulos[ev.chave] ?? ""}
                    onChange={(e) =>
                      setRotulos((atual) => ({ ...atual, [ev.chave]: e.target.value }))
                    }
                    placeholder="vazio não rastreia"
                    className="h-8 font-mono text-xs"
                    aria-label={`Rótulo de ${ev.nome}`}
                  />
                </div>
              ))}

              {/* Isto confunde todo mundo uma vez, entao esta escrito. */}
              <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Estes rótulos são <strong>conversão</strong>, não remarketing. Público
                  o Google só monta com a tag no navegador — é a checagem
                  &quot;Tag de remarketing&quot; no card da loja.
                </span>
              </p>
            </div>
          )}


          {/* ---- id do produto ---- */}
          <div className="space-y-1.5 rounded-md border border-dashed p-2.5">
            <Label className="text-[11px]">Formato do ID de produto</Label>
            <p className="text-[11px] text-muted-foreground">
              Tem que ser <strong>idêntico</strong> ao ID do{" "}
              {plataforma === "google"
                ? "seu feed no Merchant Center"
                : "seu catálogo no Commerce Manager"}
              . Se não bater, o evento é aceito normalmente e o anúncio dinâmico
              simplesmente não serve aquele produto — sem erro nenhum em lugar nenhum.
            </p>

            <Input
              value={idTemplate}
              onChange={(e) => setIdTemplate(e.target.value)}
              placeholder={TEMPLATE_PADRAO}
              className="h-8 font-mono text-xs"
              aria-label="Formato do ID de produto"
            />

            <div className="flex flex-wrap gap-1">
              {TEMPLATES_SUGERIDOS.map((t) => (
                <button
                  key={t.template}
                  type="button"
                  title={t.dica}
                  onClick={() => setIdTemplate(t.template)}
                  className={`rounded-md border px-1.5 py-0.5 text-[10px] transition-colors ${
                    idTemplate.trim() === t.template
                      ? "border-primary bg-primary/10 text-foreground"
                      : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {t.rotulo}
                </button>
              ))}
            </div>

            {erroDoTemplate ? (
              <p className="text-[11px] text-destructive">{erroDoTemplate}</p>
            ) : (
              <p className="text-[10px] text-muted-foreground">
                Marcadores: <code>{"{variant_id}"}</code> <code>{"{product_id}"}</code>{" "}
                <code>{"{sku}"}</code>
              </p>
            )}

            {plataforma === "google" && (
              /* O remarketing monta o id no NAVEGADOR, a partir da tag do tema --
                 trocar aqui nao alcanca quem ja tem a tag antiga instalada. */
              <p className="flex items-start gap-1.5 text-[11px] text-amber-600">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {/* O texto vai dentro de um span: sem ele, cada trecho vira um
                    item do flex e a frase quebra em colunas. */}
                <span>
                  Depois de mudar, clique em{" "}
                  <strong>&quot;Reinstalar com remarketing&quot;</strong> no card da
                  loja: a tag do tema carrega este formato e só muda quando o tema é
                  gravado de novo.
                </span>
              </p>
            )}
          </div>

          {plataforma === "meta" && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-[11px]">Token do CAPI</Label>
                <Input
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder={
                    destino?.temToken ? "gravado — vazio mantém" : "EAA..."
                  }
                  className="h-8 font-mono text-xs"
                  autoComplete="off"
                />
                <p className="text-[10px] text-muted-foreground">
                  Events Manager → Configurações → API de Conversões → gerar token.
                  {destino?.temToken
                    ? " Um token novo substitui o anterior; vazio mantém o que está gravado."
                    : ""}
                </p>
              </div>

              <div className="space-y-1">
                <Label className="text-[11px]">Código de teste (opcional)</Label>
                <Input
                  value={codigoTeste}
                  onChange={(e) => setCodigoTeste(e.target.value)}
                  placeholder="TEST12345"
                  className="h-8 max-w-[12rem] font-mono text-xs"
                />
                <p className="text-[10px] text-muted-foreground">
                  Joga os eventos para a aba de teste do Events Manager. Preenchido, eles
                  param de contar como conversão de verdade — tire quando terminar.
                </p>
              </div>

              <p className="text-[11px] text-muted-foreground">
                O pixel cobre os {EVENTOS.length} eventos — não precisa rótulo por
                evento.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onFechar} disabled={salvando}>
            Cancelar
          </Button>
          <Button size="sm" onClick={salvar} disabled={salvando || !podeSalvar}>
            {salvando ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : editando ? (
              "Salvar"
            ) : (
              "Adicionar"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Confirmacao de remocao.
 *
 * Existe porque remover leva o HISTORICO junto: `tracking_events.destination_id`
 * tem `on delete cascade`, entao os envios daquela conta saem da contagem. Quem
 * so quer parar de enviar deve DESATIVAR, e o dialogo diz isso em vez de deixar
 * o lojista descobrir depois.
 */
function ConfirmarRemocao({
  destino,
  aberto,
  onFechar,
}: {
  destino: DestinoNaTela;
  aberto: boolean;
  onFechar: () => void;
}) {
  const router = useRouter();
  const [removendo, setRemovendo] = useState(false);

  async function remover() {
    setRemovendo(true);
    try {
      const r = await fetch(`/api/tracking/destinos?id=${destino.id}`, {
        method: "DELETE",
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Falha ao remover.");
      toast.success("Destino removido.");
      onFechar();
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao remover.");
    } finally {
      setRemovendo(false);
    }
  }

  const enviados = destino.contagem.enviados;

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Remover {NOME_DA_PLATAFORMA[destino.plataforma]}?</DialogTitle>
          <DialogDescription>
            <span className="font-mono">{destino.conta}</span>
            {destino.nome ? ` — ${destino.nome}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 text-xs">
          {enviados > 0 && (
            <p className="flex items-start gap-1.5 text-amber-600">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                O histórico vai junto: <strong>{enviados}</strong> envio(s) dos últimos 7
                dias saem da contagem desta tela.
              </span>
            </p>
          )}
          <p className="text-muted-foreground">
            Se a intenção é só parar de enviar, <strong>desative</strong> em vez de
            remover — assim o que já saiu continua aparecendo aqui.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onFechar} disabled={removendo}>
            Cancelar
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={remover}
            disabled={removendo}
          >
            {removendo ? <Loader2 className="h-4 w-4 animate-spin" /> : "Remover"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Uma linha da lista: a conta, o que saiu por ela, e o que fazer com ela. */
function LinhaDestino({ storeId, destino }: { storeId: string; destino: DestinoNaTela }) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [removendo, setRemovendo] = useState(false);
  const [alternando, setAlternando] = useState(false);

  const falta = oQueFalta(destino);

  async function alternar() {
    setAlternando(true);
    try {
      const r = await fetch("/api/tracking/destinos", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: destino.id, ativo: !destino.ativo }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Falha ao salvar.");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setAlternando(false);
    }
  }

  return (
    <div
      className={`rounded-md border p-2.5 ${destino.ativo ? "" : "border-dashed opacity-70"}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">
            {destino.nome || NOME_DA_PLATAFORMA[destino.plataforma]}
          </span>
          <span className="font-mono text-[11px] text-muted-foreground">
            {destino.conta}
          </span>
          {!destino.ativo && <Pill tom="neutro">desativado</Pill>}
          {destino.ativo && falta && (
            <Pill tom="erro" title={falta}>
              incompleto
            </Pill>
          )}
          {destino.ativo && !falta && <Pill tom="ok">enviando</Pill>}
          {destino.testEventCode && (
            <Pill tom="alerta" title="Os eventos vão para a aba de teste do Events Manager e não contam como conversão.">
              modo teste
            </Pill>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            onClick={alternar}
            disabled={alternando}
            title={destino.ativo ? "Desativar (para de enviar)" : "Ativar"}
          >
            {alternando ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Power className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            onClick={() => setEditando(true)}
            title="Editar"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-destructive hover:text-destructive"
            onClick={() => setRemovendo(true)}
            title="Remover"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {falta && destino.ativo && (
        <p className="mt-1 text-[11px] text-destructive">{falta}</p>
      )}

      {/* O que saiu por ESTA conta, em 7 dias.
          Por conta, nao por plataforma: com cinco contas de Google, a mesma venda
          gera cinco linhas, e somadas dariam "5 compras" para 1 pedido -- a
          comparacao com pedidos, que e o alarme, nunca mais acusaria falta. */}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
        {EVENTOS.map((ev) => {
          const n = destino.contagem.porEvento[ev.chave] ?? 0;
          const rotulado =
            destino.plataforma === "meta" || Boolean(destino.labels[ev.chave]);
          return (
            <span
              key={ev.chave}
              className={
                n > 0
                  ? "text-foreground"
                  : rotulado
                    ? "text-muted-foreground"
                    : "text-muted-foreground/50 line-through"
              }
              title={
                rotulado
                  ? `enviado ao ${NOME_DA_PLATAFORMA[destino.plataforma]} como ${
                      destino.plataforma === "meta" ? ev.nomeNoMeta : "conversion"
                    }`
                  : "sem rótulo: este evento não é rastreado nesta conta"
              }
            >
              {ev.nome} <strong className="font-mono">{n}</strong>
            </span>
          );
        })}
        <span className="text-muted-foreground">em 7 dias</span>
      </div>

      {(destino.contagem.pendentes > 0 ||
        destino.contagem.falharam > 0 ||
        destino.contagem.semAtribuicao > 0) && (
        <div className="mt-1 space-y-0.5 text-[11px]">
          {destino.contagem.pendentes > 0 && (
            <p className="text-amber-600">
              {destino.contagem.pendentes} na fila, aguardando reenvio
            </p>
          )}
          {destino.contagem.falharam > 0 && (
            <p
              className="text-destructive"
              title={destino.contagem.ultimoErro ?? undefined}
            >
              {destino.contagem.falharam} falharam
              {destino.contagem.ultimoErro
                ? ` — ${destino.contagem.ultimoErro.slice(0, 90)}`
                : ""}
            </p>
          )}
          {destino.contagem.semAtribuicao > 0 && (
            <p className="text-muted-foreground">
              {destino.contagem.semAtribuicao} sem click id: chegam, sem ligação com
              anúncio
            </p>
          )}
        </div>
      )}

      {editando && (
        <FormularioDestino
          storeId={storeId}
          plataforma={destino.plataforma}
          destino={destino}
          aberto
          onFechar={() => setEditando(false)}
        />
      )}
      {removendo && (
        <ConfirmarRemocao
          destino={destino}
          aberto
          onFechar={() => setRemovendo(false)}
        />
      )}
    </div>
  );
}

/**
 * Uma plataforma e todas as contas dela.
 *
 * Lista, nao formulario: a loja pode ter cinco contas de Google e dois pixels
 * Meta, e cada uma vive sozinha -- desativar uma nao mexe nas outras.
 */
export function PainelPlataforma({
  storeId,
  plataforma,
  destinos,
}: {
  storeId: string;
  plataforma: Plataforma;
  destinos: DestinoNaTela[];
}) {
  const [adicionando, setAdicionando] = useState(false);
  const meus = destinos.filter((d) => d.plataforma === plataforma);
  const enviando = meus.filter((d) => d.ativo && !oQueFalta(d)).length;

  return (
    <section className="space-y-2.5 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold">
            {NOME_DA_PLATAFORMA[plataforma]}
          </span>
          {meus.length > 0 && (
            <Pill tom={enviando > 0 ? "ok" : "alerta"}>
              {enviando} de {meus.length} enviando
            </Pill>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7"
          onClick={() => setAdicionando(true)}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          Adicionar {plataforma === "google" ? "conta" : "pixel"}
        </Button>
      </div>

      {meus.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          {plataforma === "google"
            ? "Nenhuma conta do Google. Cada conta tem o seu ID de conversão e os seus rótulos."
            : "Nenhum pixel do Meta. Cada pixel precisa do próprio token do CAPI."}
        </p>
      ) : (
        <div className="space-y-2">
          {meus.map((d) => (
            <LinhaDestino key={d.id} storeId={storeId} destino={d} />
          ))}
        </div>
      )}

      {/* Varias contas da mesma plataforma e seguro, e o motivo nao e obvio --
          sem isto escrito, a pergunta "nao vai contar 5 vezes?" aparece. */}
      {meus.length > 1 && plataforma === "google" && (
        <p className="text-[11px] text-muted-foreground">
          Todas as contas recebem todos os eventos. Não infla nada: conversão cujo
          gclid não pertence à conta é descartada pelo Google — a conta dona do clique
          conta, as outras ignoram.
        </p>
      )}

      {meus.length > 1 && plataforma === "meta" && (
        <p className="text-[11px] text-muted-foreground">
          Todos os pixels recebem todos os eventos, cada um com o seu token.
        </p>
      )}

      {adicionando && (
        <FormularioDestino
          storeId={storeId}
          plataforma={plataforma}
          aberto
          onFechar={() => setAdicionando(false)}
        />
      )}
    </section>
  );
}
