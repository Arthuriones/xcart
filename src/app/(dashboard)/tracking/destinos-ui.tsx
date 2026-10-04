"use client";

import { useState, type ReactNode } from "react";
import { CircleAlert, MoreHorizontal, Pencil, Power, Trash2, TriangleAlert } from "lucide-react";
import clsx from "clsx";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
import { STATUS, StatusBadge } from "@/components/ui/status-badge";
import { EVENTOS } from "@/lib/tracking/eventos";
import {
  TEMPLATE_PADRAO,
  TEMPLATES_SUGERIDOS,
  validarTemplate,
} from "@/lib/tracking/id-produto";
import type { DestinoNaTela } from "@/lib/tracking/queries";
import {
  NOME_DA_PLATAFORMA,
  ROTULO_EVENTO,
  numerosDoEvento,
  oQueFalta,
  pelaTag,
  plural,
  type Plataforma,
  type VereditoDestino,
} from "./saude";
import { NOME_CURTO } from "./resumo";
import { ValorDoEvento, semEnvioDoEvento } from "./por-conta";
import { respostaJson } from "./resposta";

// ============================================================================
// Os destinos de conversao de uma loja, no detalhe do Rastreamento.
//
// POR QUE UMA LISTA, E NAO DOIS CAMPOS
//
// Pedido do Arthur, e caso real dele: cinco contas de Google anunciando produtos
// diferentes do mesmo catalogo. Ate a migration 043 isto era UMA coluna por
// plataforma, e a segunda conta nao tinha onde morar.
//
// E seguro cadastrar todas: so a conta dona do clique conta a conversao; nas
// outras o Google nao credita nada. Entao nao existe roteamento por produto a
// configurar aqui, e e de proposito que a tela nao pede um. Os numeros sao por
// conta, nunca somados.
//
// As chamadas (POST/PATCH/DELETE /api/tracking/destinos) e os corpos enviados
// sao os mesmos de antes; mudou a apresentacao.
// ============================================================================

const NUMERO = new Intl.NumberFormat("pt-BR");

/**
 * O formulario de um destino: cadastro e edicao no mesmo lugar.
 *
 * Google e Meta pedem coisas diferentes e o motivo nao e cosmetico: no Google
 * cada evento e uma conversion action propria, com rotulo proprio, e o rotulo
 * vazio e como dizer "nao quero este evento". No Meta um pixel cobre todos os
 * eventos, e o que separa funcionar de nao funcionar e o token.
 */
export function FormularioDestino({
  storeId,
  plataforma,
  destino,
  aberto,
  onFechar,
  aoSalvar,
}: {
  storeId: string;
  plataforma: Plataforma;
  /** Ausente = cadastro novo. */
  destino?: DestinoNaTela;
  aberto: boolean;
  onFechar: () => void;
  /** Depois de gravar: a tela busca os numeros de novo. */
  aoSalvar: () => void;
}) {
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
  const [idTemplate, setIdTemplate] = useState(destino?.idTemplate ?? TEMPLATE_PADRAO);
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
      // Token recusado pelo Meta volta 400 com a mensagem DELE ("Invalid OAuth
      // access token", "...does not have permission"): e o que diz ao lojista o
      // que consertar no Events Manager, entao vai inteira para o aviso.
      const j = await respostaJson(r, "Não deu para salvar o destino.");

      // Compras que tinham caido pelo token antigo voltaram para a fila. Dizer
      // quantas tira a duvida "e as vendas do fim de semana?".
      // `requeued` conta todo evento devolvido a fila (funil incluido);
      // `requeuedPurchases` so as compras, que e o numero que importa.
      const total = typeof j.requeued === "number" ? j.requeued : 0;
      const compras = typeof j.requeuedPurchases === "number" ? j.requeuedPurchases : 0;
      if (compras > 0) {
        toast.success("Token atualizado", {
          description:
            compras === 1
              ? "1 compra que tinha falhado vai ser reenviada."
              : `${compras} compras que tinham falhado vão ser reenviadas.`,
        });
      } else if (total > 0) {
        toast.success("Token atualizado", {
          description:
            total === 1
              ? "1 evento que tinha falhado vai ser reenviado."
              : `${total} eventos que tinham falhado vão ser reenviados.`,
        });
      } else {
        toast.success(editando ? "Destino atualizado" : "Destino adicionado");
      }
      onFechar();
      // A contagem e o veredito vem do servidor; sem isto o destino novo
      // apareceria sem nenhum numero e pareceria quebrado.
      aoSalvar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não deu para salvar o destino.");
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

  const idCampo = (s: string) => `destino-${destino?.id ?? "novo"}-${s}`;

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && !salvando && onFechar()}>
      <DialogContent size="md" className="max-h-[88dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editando ? "Editar" : "Adicionar"} {NOME_DA_PLATAFORMA[plataforma]}
          </DialogTitle>
          <DialogDescription>
            {plataforma === "google"
              ? "O ID da conta mais o rótulo de cada evento que você quer medir."
              : "O ID do pixel mais o token de conversões. Um pixel cobre todos os eventos."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={idCampo("nome")}>Apelido</Label>
              <Input
                id={idCampo("nome")}
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder={plataforma === "google" ? "Conta principal" : "Pixel 1"}
                aria-describedby={idCampo("nome-dica")}
              />
              {/* Com duas contas da mesma plataforma, o numero sozinho nao diz
                  qual e qual quando chega a hora de desativar uma. */}
              <p id={idCampo("nome-dica")} className="text-label text-t2">
                Só para você reconhecer na lista.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={idCampo("conta")}>
                {plataforma === "google" ? "ID de conversão" : "ID do pixel"}
              </Label>
              <Input
                id={idCampo("conta")}
                value={conta}
                onChange={(e) => setConta(e.target.value)}
                placeholder={plataforma === "google" ? "AW-123456789" : "1234567890123456"}
                className="font-mono"
                autoComplete="off"
              />
            </div>
          </div>

          {plataforma === "google" && (
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-1 flex flex-col gap-1">
                <span className="text-dense font-medium text-ink">Rótulo por evento</span>
                <span className="text-label text-t2">
                  No Google Ads, em Objetivos › Conversões, cada evento é uma ação de
                  conversão com o seu rótulo (a parte depois da barra em AW-…/rótulo).
                  Deixe <strong className="font-medium text-ink">Compra</strong> como
                  principal e as outras como{" "}
                  <strong className="font-medium text-ink">secundárias</strong>, senão o
                  lance passa a otimizar para carrinho em vez de venda.
                </span>
              </legend>

              {EVENTOS.map((ev) => (
                <div
                  key={ev.chave}
                  className="grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)] sm:items-center sm:gap-3"
                >
                  <label htmlFor={idCampo(`rotulo-${ev.chave}`)} className="min-w-0">
                    <span className="block text-dense text-ink">{ev.nome}</span>
                    <span className="block text-label text-t2">{ev.descricao}</span>
                  </label>
                  <Input
                    id={idCampo(`rotulo-${ev.chave}`)}
                    value={rotulos[ev.chave] ?? ""}
                    onChange={(e) =>
                      setRotulos((atual) => ({ ...atual, [ev.chave]: e.target.value }))
                    }
                    placeholder="vazio: não medir"
                    className="font-mono"
                    autoComplete="off"
                  />
                </div>
              ))}

              {/* Isto confunde todo mundo uma vez, entao esta escrito. */}
              <p className="flex items-start gap-1.5 text-label text-t2">
                <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  Estes rótulos são de <strong className="font-medium text-ink">conversão</strong>:
                  a tag do Google, no navegador do comprador, dispara cada evento que tem rótulo.
                  O público de remarketing é a linha “Remarketing do Google” no detalhe da loja.
                </span>
              </p>
            </fieldset>
          )}

          {/* ---- id do produto ---- */}
          <div className="flex flex-col gap-2 rounded-card border border-dashed border-border-strong p-3">
            <Label htmlFor={idCampo("template")}>Formato do ID de produto</Label>
            <p className="text-label text-t2">
              Tem que ser <strong className="font-medium text-ink">idêntico</strong> ao ID do{" "}
              {plataforma === "google"
                ? "seu feed no Merchant Center"
                : "seu catálogo no Commerce Manager"}
              . Se não bater, o evento é aceito normalmente e o anúncio dinâmico simplesmente
              não mostra aquele produto, sem erro em lugar nenhum.
            </p>

            <Input
              id={idCampo("template")}
              value={idTemplate}
              onChange={(e) => setIdTemplate(e.target.value)}
              placeholder={TEMPLATE_PADRAO}
              className="font-mono"
              aria-invalid={erroDoTemplate ? true : undefined}
              aria-describedby={idCampo("template-dica")}
              autoComplete="off"
            />

            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Formatos sugeridos">
              {TEMPLATES_SUGERIDOS.map((t) => {
                const ativo = idTemplate.trim() === t.template;
                return (
                  <Button
                    key={t.template}
                    type="button"
                    size="sm"
                    variant={ativo ? "primary" : "secondary"}
                    aria-pressed={ativo}
                    onClick={() => setIdTemplate(t.template)}
                  >
                    {t.rotulo}
                  </Button>
                );
              })}
            </div>

            {erroDoTemplate ? (
              <p id={idCampo("template-dica")} className="text-label text-err">
                {erroDoTemplate}
              </p>
            ) : (
              <p id={idCampo("template-dica")} className="text-label text-t2">
                Marcadores: <code className="font-mono">{"{variant_id}"}</code> = id da variante,{" "}
                <code className="font-mono">{"{product_id}"}</code> = id do produto,{" "}
                <code className="font-mono">{"{sku}"}</code> = SKU.
              </p>
            )}

            {plataforma === "google" && (
              /* O remarketing monta o id no NAVEGADOR, a partir da tag do tema --
                 trocar aqui nao alcanca quem ja tem a tag antiga instalada. */
              <p className="flex items-start gap-1.5 rounded-control border border-warn-border bg-warn-bg p-2.5 text-label text-ink">
                <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0 text-warn" />
                <span>
                  Depois de mudar, clique em <strong className="font-medium">Reinstalar</strong>{" "}
                  na linha “Remarketing do Google” do detalhe da loja: a tag do tema leva este
                  formato e só muda quando o tema é gravado de novo.
                </span>
              </p>
            )}
          </div>

          {plataforma === "meta" && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={idCampo("token")}>Token de conversões</Label>
                <Input
                  id={idCampo("token")}
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder={destino?.temToken ? "gravado; vazio mantém" : "EAA…"}
                  className="font-mono"
                  autoComplete="off"
                  aria-describedby={idCampo("token-dica")}
                />
                <p id={idCampo("token-dica")} className="text-label text-t2">
                  No Gerenciador de Eventos do Meta: Configurações › API de Conversões › Gerar
                  token.
                  {destino?.temToken
                    ? " Um token novo substitui o anterior; vazio mantém o que está gravado."
                    : ""}
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor={idCampo("teste")}>Código de teste (opcional)</Label>
                <Input
                  id={idCampo("teste")}
                  value={codigoTeste}
                  onChange={(e) => setCodigoTeste(e.target.value)}
                  placeholder="TEST12345"
                  className="max-w-48 font-mono"
                  autoComplete="off"
                  aria-describedby={idCampo("teste-dica")}
                />
                <p id={idCampo("teste-dica")} className="text-label text-t2">
                  Manda os eventos para a aba de teste do Gerenciador de Eventos. Preenchido, eles
                  param de contar como conversão de verdade: tire quando terminar.
                </p>
              </div>

              <p className="text-label text-t2">
                O pixel cobre os {EVENTOS.length} eventos; não precisa de rótulo por evento.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={onFechar} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={salvar} pending={salvando} disabled={!podeSalvar}>
            {editando ? "Salvar destino" : "Adicionar destino"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** O estado do destino em uma palavra (mapa unico da fundacao). */
function estadoDoDestino(d: DestinoNaTela, faltam: number) {
  if (!d.ativo) return STATUS.destino.desativado;
  if (oQueFalta(d) !== null) return STATUS.destino.incompleto;
  if (pelaTag(d)) return STATUS.destino.tagAtiva;
  if (d.testEventCode) return STATUS.destino.modoTeste;
  if (faltam > 0) return STATUS.destino.erro;
  return STATUS.destino.enviando;
}

type TomNota = "err" | "warn" | "info" | "neutral";
const PONTO: Record<TomNota, string> = {
  err: "bg-err",
  warn: "bg-warn",
  info: "bg-info",
  neutral: "bg-t3",
};

function Nota({ tom, children }: { tom: TomNota; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-label text-t1">
      <span aria-hidden className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", PONTO[tom])} />
      <span className="min-w-0 break-words text-pretty">{children}</span>
    </li>
  );
}

/**
 * Um destino: a conta, o que saiu por ela em 7 dias (de anuncio em destaque,
 * total em cinza, falha em vermelho), e o menu.
 *
 * Por conta, nao por plataforma: com cinco contas de Google, a mesma venda gera
 * cinco envios, e somados dariam "5 compras" para 1 pedido -- a comparacao com
 * pedidos, que e o alarme, nunca mais acusaria falta.
 */
export function CartaoDestino({
  destino,
  veredito,
  mostrarTestes,
  semContagem,
  destacado,
  onEditar,
  aoMudar,
}: {
  destino: DestinoNaTela;
  /** Compras x pedidos deste destino. null = nao recebe a compra (ou loja desligada). */
  veredito: VereditoDestino | null;
  /** Testes de volta nas contagens ("Mostrar testes" da tela). */
  mostrarTestes: boolean;
  /** A contagem da fila falhou: os numeros sao "—", nunca zero. */
  semContagem: boolean;
  destacado?: boolean;
  onEditar: () => void;
  aoMudar: () => void;
}) {
  const [alternando, setAlternando] = useState(false);
  const [removendo, setRemovendo] = useState(false);

  const nome = destino.nome || NOME_DA_PLATAFORMA[destino.plataforma];
  const c = destino.contagem;
  const faltam = veredito?.tipo === "razao" ? veredito.faltam : 0;
  const estado = estadoDoDestino(destino, faltam);
  const falta = destino.ativo ? oQueFalta(destino) : null;

  async function alternar() {
    setAlternando(true);
    try {
      const r = await fetch("/api/tracking/destinos", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: destino.id, ativo: !destino.ativo }),
      });
      await respostaJson(r, "Não deu para salvar.");
      toast.success(destino.ativo ? "Envio desativado" : "Envio ativado", {
        description: destino.ativo
          ? `${nome} parou de receber eventos. O histórico continua aqui.`
          : `${nome} volta a receber eventos a partir de agora.`,
      });
      aoMudar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não deu para salvar.");
    } finally {
      setAlternando(false);
    }
  }

  async function remover() {
    const r = await fetch(`/api/tracking/destinos?id=${encodeURIComponent(destino.id)}`, {
      method: "DELETE",
    });
    await respostaJson(r, "Não deu para remover.");
    toast.success("Destino removido", { description: "O envio para esse destino parou." });
    aoMudar();
  }

  const notas: { tom: TomNota; texto: ReactNode }[] = [];
  if (faltam > 0) {
    notas.push({
      tom: "err",
      texto: `${plural(faltam, "pedido", "pedidos")} sem compra enviada nos últimos 7 dias.`,
    });
  }
  if (falta) {
    notas.push({
      tom: "warn",
      texto:
        destino.plataforma === "meta"
          ? "Falta o token de conversões: sem ele nenhum evento sai."
          : "Falta o rótulo de pelo menos um evento: sem rótulo não há o que enviar.",
    });
  }
  if (pelaTag(destino) && destino.ativo && !falta) {
    notas.push({
      tom: "info",
      texto:
        "Vai pela tag do Google, no navegador do comprador: as conversões são contadas no Google Ads, não aqui.",
    });
  }
  if (destino.testEventCode) {
    notas.push({
      tom: "info",
      texto:
        "Em modo teste: os eventos vão para a aba de teste do Gerenciador de Eventos e não contam como conversão.",
    });
  }
  // O Google pela tag nao passa pela fila: falha ou fila dele e resto de antes.
  if (c.falharam > 0 && !pelaTag(destino)) {
    notas.push({
      tom: "err",
      texto: (
        <>
          {c.falharam === 1 ? "1 envio falhou." : `${NUMERO.format(c.falharam)} envios falharam.`}
          {c.ultimoErro ? ` A plataforma respondeu: “${c.ultimoErro}”` : ""}
        </>
      ),
    });
  }
  if (c.pendentes > 0 && !pelaTag(destino)) {
    notas.push({
      tom: "neutral",
      texto:
        c.pendentes === 1
          ? "1 envio na fila, aguardando nova tentativa."
          : `${NUMERO.format(c.pendentes)} envios na fila, aguardando nova tentativa.`,
    });
  }

  return (
    <article
      id={`destino-${destino.id}`}
      aria-label={`${NOME_CURTO[destino.plataforma]} ${nome}`}
      className={cn(
        "flex scroll-mt-4 flex-col gap-3 rounded-card border border-border p-3",
        !destino.ativo && "bg-surface-2",
        destacado && "animate-xc-flash"
      )}
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 shrink-0 rounded-sm border border-border-strong px-1.5 text-label font-semibold text-t1">
          {NOME_CURTO[destino.plataforma]}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-dense font-semibold text-ink">{nome}</span>
          <span className="truncate font-mono text-label text-t2">{destino.conta}</span>
        </span>
        <StatusBadge {...estado} />
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={alternando}
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                pending={alternando}
                aria-label={`Ações do destino ${nome}`}
                className="-my-1"
              />
            }
          >
            {alternando ? null : <MoreHorizontal aria-hidden />}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={onEditar}>
              <Pencil aria-hidden />
              Editar destino
            </DropdownMenuItem>
            <DropdownMenuItem onClick={alternar}>
              <Power aria-hidden />
              {destino.ativo ? "Desativar envio" : "Ativar envio"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => setRemovendo(true)}>
              <Trash2 aria-hidden />
              Remover destino…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* O que saiu por ESTA conta, em 7 dias: de anuncio em destaque, total em
          cinza. A compra fica vermelha quando falta pedido. */}
      <dl
        aria-label={`Eventos enviados a ${nome} em 7 dias`}
        className="grid grid-cols-2 gap-2 sm:grid-cols-5"
      >
        {EVENTOS.map((ev) => {
          const n = numerosDoEvento(destino, ev.chave, mostrarTestes);
          const sem = semEnvioDoEvento(destino, ev.chave);
          const tom = !n.envia
            ? sem.resolve
              ? "warn"
              : null
            : ev.chave === "purchase" && faltam > 0
              ? "err"
              : null;
          return (
            <div
              key={ev.chave}
              className={clsx(
                "flex min-w-0 flex-col gap-0.5 rounded-control border p-2",
                tom === "err"
                  ? "border-err-border bg-err-bg"
                  : tom === "warn"
                    ? "border-warn-border bg-warn-bg"
                    : "border-border-subtle bg-surface-2"
              )}
            >
              <dt className="truncate text-label text-t1">{ROTULO_EVENTO[ev.chave]}</dt>
              <dd className="flex min-w-0 flex-col gap-0.5">
                <ValorDoEvento n={n} semContagem={semContagem} semEnvio={sem.texto} />
              </dd>
            </div>
          );
        })}
      </dl>

      {notas.length > 0 && (
        <ul className="flex flex-col gap-1">
          {notas.map((n, i) => (
            <Nota key={i} tom={n.tom}>
              {n.texto}
            </Nota>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={removendo}
        onOpenChange={setRemovendo}
        titulo={`Remover o destino ${nome}?`}
        descricao={
          <>
            As compras desta loja param de chegar a esse destino agora. O histórico de envios
            dele é apagado junto e não volta
            {c.enviados > 0 ? ` (${plural(c.enviados, "envio", "envios")} dos últimos 7 dias)` : ""}.
            Para só parar de enviar, desative em vez de remover.
          </>
        }
        confirmar="Remover destino"
        mensagemErro="Não deu para remover agora. Tente de novo."
        onConfirmar={remover}
      />
    </article>
  );
}
