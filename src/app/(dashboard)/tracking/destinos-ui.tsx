"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CircleAlert,
  Loader2,
  MoreHorizontal,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EVENTOS } from "@/lib/tracking/eventos";
import {
  TEMPLATE_PADRAO,
  TEMPLATES_SUGERIDOS,
  validarTemplate,
} from "@/lib/tracking/id-produto";
import type { DestinoNaTela } from "@/lib/tracking/queries";
import { cn } from "@/lib/utils";
import { NOME_DA_PLATAFORMA, oQueFalta, type Plataforma } from "./saude";
import { Ponto, Selo } from "./selo";

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

/**
 * Cabecalho curto de cada coluna do funil. O nome inteiro do evento ("Adicionar
 * ao carrinho") nao cabe em 60px; a chave vem de EVENTOS, entao evento novo sem
 * entrada aqui cai no nome completo em vez de sumir.
 */
const ROTULO_CURTO: Record<string, string> = {
  view_item: "Produto",
  add_to_cart: "Carrinho",
  begin_checkout: "Checkout",
  payment_info: "Pagamento",
  purchase: "Compra",
};

// Uma grade so para o cabecalho e as linhas: as colunas do funil alinham como
// tabela no desktop. No celular a linha empilha e a grade nao vale.
const GRADE = "sm:grid-cols-[minmax(0,1fr)_repeat(5,60px)_32px]";

const FOCO =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/40";

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
              <Label className="text-[11px] text-t2">Apelido</Label>
              <Input
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder={plataforma === "google" ? "Conta principal" : "Pixel 1"}
                className="h-8 text-xs"
              />
              {/* Com duas contas da mesma plataforma, o numero sozinho nao diz
                  qual e qual quando chega a hora de desativar uma. */}
              <p className="text-[10.5px] text-t3">só para você reconhecer na lista</p>
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-t2">
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
                <Label className="text-[11px] text-t2">Rótulo por evento</Label>
                <p className="text-[11px] text-t3">
                  Google Ads → Objetivos → Conversões. Uma ação por evento; copie o
                  rótulo de cada uma. Deixe <strong className="text-t1">compra</strong>{" "}
                  como principal e as outras como{" "}
                  <strong className="text-t1">secundárias</strong>, senão o lance passa
                  a otimizar para carrinho em vez de venda.
                </p>
              </div>

              {EVENTOS.map((ev) => (
                <div
                  key={ev.chave}
                  className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,13rem)] sm:items-center"
                >
                  <div className="min-w-0">
                    <span className="text-[12.5px] text-ink">{ev.nome}</span>
                    <p className="text-[11px] text-t3">{ev.descricao}</p>
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
              <p className="flex items-start gap-1.5 text-[11px] text-t3">
                <CircleAlert aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Estes rótulos são <strong className="text-t1">conversão</strong>, não
                  remarketing. Público o Google só monta com a tag no navegador — é a
                  checagem &quot;Tag de remarketing&quot; no card da loja.
                </span>
              </p>
            </div>
          )}


          {/* ---- id do produto ---- */}
          <div className="space-y-1.5 rounded-md border border-dashed border-[var(--border-strong)] p-2.5">
            <Label className="text-[11px] text-t2">Formato do ID de produto</Label>
            <p className="text-[11px] text-t3">
              Tem que ser <strong className="text-t1">idêntico</strong> ao ID do{" "}
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
              {TEMPLATES_SUGERIDOS.map((t) => {
                const ativo = idTemplate.trim() === t.template;
                return (
                  <button
                    key={t.template}
                    type="button"
                    title={t.dica}
                    aria-pressed={ativo}
                    onClick={() => setIdTemplate(t.template)}
                    className={cn(
                      "h-6 rounded-md border px-2 text-[11px] font-medium transition-colors",
                      FOCO,
                      ativo
                        ? "border-[var(--solid)] bg-[var(--solid)] text-[var(--on-solid)]"
                        : "border-border bg-surface text-t2 hover:border-[var(--border-strong)]"
                    )}
                  >
                    {t.rotulo}
                  </button>
                );
              })}
            </div>

            {erroDoTemplate ? (
              <p className="text-[11px] text-[var(--err)]">{erroDoTemplate}</p>
            ) : (
              <p className="text-[10.5px] text-t3">
                Marcadores: <code>{"{variant_id}"}</code> <code>{"{product_id}"}</code>{" "}
                <code>{"{sku}"}</code>
              </p>
            )}

            {plataforma === "google" && (
              /* O remarketing monta o id no NAVEGADOR, a partir da tag do tema --
                 trocar aqui nao alcanca quem ja tem a tag antiga instalada. */
              <p className="flex items-start gap-1.5 rounded-md border border-[var(--warn-border)] bg-[var(--warn-bg)] p-2.5 text-[11px] text-[var(--warn)]">
                <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
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
                <Label className="text-[11px] text-t2">Token do CAPI</Label>
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
                <p className="text-[10.5px] text-t3">
                  Events Manager → Configurações → API de Conversões → gerar token.
                  {destino?.temToken
                    ? " Um token novo substitui o anterior; vazio mantém o que está gravado."
                    : ""}
                </p>
              </div>

              <div className="space-y-1">
                <Label className="text-[11px] text-t2">Código de teste (opcional)</Label>
                <Input
                  value={codigoTeste}
                  onChange={(e) => setCodigoTeste(e.target.value)}
                  placeholder="TEST12345"
                  className="h-8 max-w-[12rem] font-mono text-xs"
                />
                <p className="text-[10.5px] text-t3">
                  Joga os eventos para a aba de teste do Events Manager. Preenchido, eles
                  param de contar como conversão de verdade — tire quando terminar.
                </p>
              </div>

              <p className="text-[11px] text-t3">
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
            <p className="flex items-start gap-1.5 rounded-md border border-[var(--warn-border)] bg-[var(--warn-bg)] p-2.5 text-[var(--warn)]">
              <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                O histórico vai junto: <strong>{enviados}</strong> envio(s) dos últimos 7
                dias saem da contagem desta tela.
              </span>
            </p>
          )}
          <p className="text-t2">
            Se a intenção é só parar de enviar, <strong className="text-ink">desative</strong>{" "}
            em vez de remover — assim o que já saiu continua aparecendo aqui.
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
function LinhaDestino({
  storeId,
  destino,
  faltam,
}: {
  storeId: string;
  destino: DestinoNaTela;
  /** Pedidos sem compra enviada por este destino (so com a loja ligada). */
  faltam?: number;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [removendo, setRemovendo] = useState(false);
  const [alternando, setAlternando] = useState(false);

  const falta = oQueFalta(destino);
  const nome = destino.nome || NOME_DA_PLATAFORMA[destino.plataforma];
  const c = destino.contagem;

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

  const perdendo = faltam !== undefined && faltam >= 1;
  const temSubLinha =
    perdendo ||
    (falta && destino.ativo) ||
    Boolean(destino.testEventCode) ||
    c.pendentes > 0 ||
    c.falharam > 0 ||
    c.semAtribuicao > 0;

  return (
    <div
      id={`destino-${destino.id}`}
      className={cn(
        "relative scroll-mt-20 border-t border-[var(--border-subtle)] px-3.5 py-2.5 first:border-t-0",
        !destino.ativo && "opacity-70"
      )}
    >
      <div className={`grid gap-y-2 sm:items-center sm:gap-x-2 ${GRADE}`}>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 pr-9 sm:pr-0">
          <span className="truncate text-[12.5px] font-semibold text-ink">{nome}</span>
          <span className="font-mono text-[11px] text-t3">{destino.conta}</span>
          {!destino.ativo ? (
            <Selo tom="neutro">Desativado</Selo>
          ) : falta ? (
            <Selo tom="err" title={falta}>
              Incompleto
            </Selo>
          ) : (
            <Selo tom="ok">Enviando</Selo>
          )}
          {destino.testEventCode && (
            <Selo
              tom="warn"
              title="Os eventos vão para a aba de teste do Events Manager e não contam como conversão."
            >
              Modo teste
            </Selo>
          )}
        </div>

        {/* O que saiu por ESTA conta, em 7 dias.
            Por conta, nao por plataforma: com cinco contas de Google, a mesma venda
            gera cinco linhas, e somadas dariam "5 compras" para 1 pedido -- a
            comparacao com pedidos, que e o alarme, nunca mais acusaria falta. */}
        <div className="grid grid-cols-5 gap-0.5 sm:contents">
          {EVENTOS.map((ev) => {
            const n = c.porEvento[ev.chave] ?? 0;
            const rotulado =
              destino.plataforma === "meta" || Boolean(destino.labels[ev.chave]);
            const rotulo = ROTULO_CURTO[ev.chave] ?? ev.nome;
            return (
              <div
                key={ev.chave}
                className="min-w-0 rounded bg-surface-2 px-0.5 py-1 text-center sm:bg-transparent sm:p-0 sm:text-right"
                title={
                  rotulado
                    ? `enviado ao ${NOME_DA_PLATAFORMA[destino.plataforma]} como ${
                        destino.plataforma === "meta" ? ev.nomeNoMeta : "conversion"
                      }`
                    : "sem rótulo: este evento não é rastreado nesta conta"
                }
              >
                <span
                  className={cn(
                    "block truncate text-[10px] tracking-tight sm:hidden",
                    rotulado ? "text-t3" : "text-[var(--t4)]"
                  )}
                >
                  {rotulo}
                </span>
                {rotulado ? (
                  <span
                    className={cn(
                      "font-mono text-[13px] tabular-nums",
                      n > 0 ? "text-ink" : "text-t3"
                    )}
                  >
                    {n}
                  </span>
                ) : (
                  <span className="font-mono text-[13px] tabular-nums text-[var(--t4)]">
                    —<span className="sr-only"> (não rastreado)</span>
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <div className="absolute right-2.5 top-2 sm:static sm:flex sm:justify-end">
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={alternando}
              aria-label={`Ações de ${nome}`}
              className={cn(
                "inline-flex h-8 w-8 items-center justify-center rounded-[5px] text-[var(--t4)] hover:bg-hover hover:text-ink disabled:opacity-50 sm:h-7 sm:w-7",
                FOCO
              )}
            >
              {alternando ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <MoreHorizontal aria-hidden className="h-4 w-4" />
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onClick={alternar}>
                <Power aria-hidden />
                {destino.ativo ? "Desativar (para de enviar)" : "Ativar"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setEditando(true)}>
                <Pencil aria-hidden />
                Editar
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setRemovendo(true)}>
                <Trash2 aria-hidden />
                Remover
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {temSubLinha && (
        <div className="mt-2 flex flex-col gap-0.5 text-[11.5px]">
          {perdendo && (
            <p className="flex items-start gap-1.5 text-[var(--err)]">
              <Ponto tom="err" tamanho={5} className="mt-[5px]" />
              <span>
                {faltam === 1
                  ? "1 pedido sem compra enviada nos últimos 7 dias"
                  : `${faltam} pedidos sem compra enviada nos últimos 7 dias`}
              </span>
            </p>
          )}
          {falta && destino.ativo && (
            <p className="flex items-start gap-1.5 text-[var(--err)]">
              <Ponto tom="err" tamanho={5} className="mt-[5px]" />
              <span>{falta}</span>
            </p>
          )}
          {destino.testEventCode && (
            <p className="flex items-start gap-1.5 text-t3">
              <Ponto tom="neutro" tamanho={5} className="mt-[5px]" />
              <span>
                Os eventos vão para a aba de teste do Events Manager e não contam como
                conversão.
              </span>
            </p>
          )}
          {c.pendentes > 0 && (
            <p className="flex items-start gap-1.5 text-t2">
              <Ponto tom="warn" tamanho={5} className="mt-[5px]" />
              <span>
                {c.pendentes === 1
                  ? "1 na fila, aguardando reenvio"
                  : `${c.pendentes} na fila, aguardando reenvio`}
              </span>
            </p>
          )}
          {c.falharam > 0 && (
            <p
              className="flex items-start gap-1.5 text-ink"
              title={c.ultimoErro ?? undefined}
            >
              <Ponto tom="err" tamanho={5} className="mt-[5px]" />
              <span className="line-clamp-2 min-w-0">
                {c.falharam} falharam
                {c.ultimoErro ? ` — ${c.ultimoErro.slice(0, 90)}` : ""}
              </span>
            </p>
          )}
          {c.semAtribuicao > 0 && (
            <p className="flex items-start gap-1.5 text-t3">
              <Ponto tom="neutro" tamanho={5} className="mt-[5px]" />
              {/* Visita que nao veio de clique em anuncio DESTA plataforma:
                  organico, direto, ou o anuncio da outra. Normal. O alarme
                  de verdade -- venda sem clique -- e o aviso de compra. */}
              <span>
                {c.semAtribuicao} sem clique de anúncio do{" "}
                {NOME_DA_PLATAFORMA[destino.plataforma]} — visita orgânica, direta
                ou de outro canal
              </span>
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
  faltasPorDestino,
}: {
  storeId: string;
  plataforma: Plataforma;
  destinos: DestinoNaTela[];
  /** id do destino -> pedidos sem compra. So vem com a loja ligada. */
  faltasPorDestino?: Record<string, number>;
}) {
  const [adicionando, setAdicionando] = useState(false);
  const meus = destinos.filter((d) => d.plataforma === plataforma);
  const enviando = meus.filter((d) => d.ativo && !oQueFalta(d)).length;
  // So o Google tem evento sem rotulo; a legenda do traco so aparece se houver.
  const temSemRotulo = meus.some(
    (d) => d.plataforma === "google" && EVENTOS.some((ev) => !d.labels[ev.chave])
  );

  return (
    <div id={`destinos-${plataforma}-${storeId}`} className="scroll-mt-20">
      <div className="mb-2 flex items-center gap-2.5">
        <h3 className="shrink-0 whitespace-nowrap text-[12.5px] font-semibold text-ink">
          {NOME_DA_PLATAFORMA[plataforma]}
        </h3>
        {meus.length > 0 && (
          <Selo tom={enviando > 0 ? "ok" : "warn"}>
            {enviando} de {meus.length} enviando
          </Selo>
        )}
        <span aria-hidden className="h-px flex-1 bg-border" />
        <Button
          size="xs"
          variant="outline"
          className="h-8 px-[9px] text-[12px] font-semibold sm:h-[26px]"
          onClick={() => setAdicionando(true)}
        >
          <Plus className="h-3.5 w-3.5" />
          Adicionar {plataforma === "google" ? "conta" : "pixel"}
        </Button>
      </div>

      {meus.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[var(--border-strong)] bg-surface px-4 py-4 text-center text-[12px] text-t2">
          {plataforma === "google"
            ? "Nenhuma conta do Google. Cada conta tem o seu ID de conversão e os seus rótulos."
            : "Nenhum pixel do Meta. Cada pixel precisa do próprio token do CAPI."}
        </p>
      ) : (
        <>
          <p className="mb-1 text-right text-[10.5px] text-[var(--t4)]">
            últimos 7 dias{temSemRotulo ? " · — = sem rótulo, não rastreado" : ""}
          </p>
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            <div
              className={`hidden sm:grid ${GRADE} items-center gap-x-2 border-b border-border bg-surface-2 px-3.5 py-2 text-[11px] font-semibold text-t3`}
            >
              <span>Conta</span>
              {EVENTOS.map((ev) => (
                <span key={ev.chave} className="truncate text-right">
                  {ROTULO_CURTO[ev.chave] ?? ev.nome}
                </span>
              ))}
              <span />
            </div>
            <div>
              {meus.map((d) => (
                <LinhaDestino
                  key={d.id}
                  storeId={storeId}
                  destino={d}
                  faltam={faltasPorDestino?.[d.id]}
                />
              ))}
            </div>
          </div>
        </>
      )}

      {/* Varias contas da mesma plataforma e seguro, e o motivo nao e obvio --
          sem isto escrito, a pergunta "nao vai contar 5 vezes?" aparece. */}
      {meus.length > 1 && plataforma === "google" && (
        <p className="mt-2 text-[11.5px] text-t3">
          Todas as contas recebem todos os eventos. Não infla nada: conversão cujo
          gclid não pertence à conta é descartada pelo Google — a conta dona do clique
          conta, as outras ignoram.
        </p>
      )}

      {meus.length > 1 && plataforma === "meta" && (
        <p className="mt-2 text-[11.5px] text-t3">
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
    </div>
  );
}
