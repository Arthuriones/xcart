"use client";

import { useState } from "react";
import { CircleAlert, TriangleAlert } from "lucide-react";
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
import { EVENTOS, lerRotulos, separarRotulo } from "@/lib/tracking/eventos";
import {
  TEMPLATE_PADRAO,
  TEMPLATES_SUGERIDOS,
  validarTemplate,
} from "@/lib/tracking/id-produto";
import type { DestinoNaTela } from "@/lib/tracking/queries";
import { NOME_DA_PLATAFORMA, type Plataforma } from "./saude";
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

/**
 * O formulario de um destino: cadastro e edicao no mesmo lugar.
 *
 * Google e Meta pedem coisas diferentes e o motivo nao e cosmetico: no Google
 * cada evento e uma conversion action propria, com rotulo proprio, e o rotulo
 * vazio e como dizer "nao quero este evento". No Meta um pixel cobre todos os
 * eventos, e o que separa funcionar de nao funcionar e o token. O TikTok e
 * como o Meta: pixel + token da Events API.
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

  // Rotulo colado como "AW-123/AbC" e lido aqui; o que nao der para ler vira
  // erro na hora, nunca rotulo gravado errado.
  const lidos = plataforma === "google" ? lerRotulos(rotulos, conta) : null;
  const erroRotulo = lidos && "erro" in lidos ? lidos : null;

  /** Colado inteiro: fica so o rotulo, e o AW preenche a conta vazia. */
  function mudarRotulo(chave: string, valor: string) {
    const s = separarRotulo(valor);
    const atual = conta.match(/(\d{6,})/)?.[1];
    if (s?.conta && (!atual || atual === s.conta)) {
      if (!atual) setConta(`AW-${s.conta}`);
      valor = s.rotulo;
    }
    setRotulos((r) => ({ ...r, [chave]: valor }));
  }

  async function salvar() {
    setSalvando(true);
    try {
      const corpo: Record<string, unknown> = {
        nome,
        conta: lidos && "conta" in lidos && lidos.conta ? lidos.conta : conta,
        idTemplate,
        ...(plataforma === "google"
          ? { labels: lidos && "labels" in lidos ? lidos.labels : rotulos }
          : { accessToken: token, testEventCode: codigoTeste }),
      };

      const r = await fetch("/api/tracking/destinos", {
        method: editando ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          editando ? { ...corpo, id: destino!.id } : { ...corpo, storeId, plataforma }
        ),
      });
      // Token recusado volta 400 com a mensagem DA PLATAFORMA ("Invalid OAuth
      // access token", "40001: No permission to operate pixel code"): e o que
      // diz ao lojista o que consertar no Gerenciador de eventos, entao vai
      // inteira para o aviso.
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
    !erroRotulo &&
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
              : plataforma === "tiktok"
                ? "O Pixel ID mais o Access Token da Events API. Um pixel cobre todos os eventos."
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
                {plataforma === "google" ? "ID de conversão" : plataforma === "tiktok" ? "Pixel ID" : "ID do pixel"}
              </Label>
              <Input
                id={idCampo("conta")}
                value={conta}
                onChange={(e) => setConta(e.target.value)}
                placeholder={
                  plataforma === "google"
                    ? "AW-123456789"
                    : plataforma === "tiktok"
                      ? "CUSG5HBC77UD11VVRQEG"
                      : "1234567890123456"
                }
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
                    onChange={(e) => mudarRotulo(ev.chave, e.target.value)}
                    aria-invalid={erroRotulo?.evento === ev.chave || undefined}
                    placeholder="vazio: não medir"
                    className="font-mono"
                    autoComplete="off"
                  />
                </div>
              ))}

              {erroRotulo && (
                <p role="alert" className="text-label text-err">
                  {erroRotulo.erro}
                </p>
              )}

              {/* Isto confunde todo mundo uma vez, entao esta escrito. */}
              <p className="flex items-start gap-1.5 text-label text-t2">
                <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  Estes rótulos são de <strong className="font-medium text-ink">conversão</strong>:
                  a tag do Google, no navegador do comprador, dispara cada evento que tem rótulo.
                  O remarketing sai sozinho pelo script do tema.
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
                : plataforma === "tiktok"
                  ? "seu catálogo no TikTok"
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
                  na linha “Script no tema” do detalhe da loja: a tag do tema leva este formato e
                  só muda quando o tema é gravado de novo.
                </span>
              </p>
            )}
          </div>

          {plataforma !== "google" && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={idCampo("token")}>
                  {plataforma === "tiktok" ? "Access Token" : "Token de conversões"}
                </Label>
                <Input
                  id={idCampo("token")}
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder={
                    destino?.temToken
                      ? "gravado; vazio mantém"
                      : plataforma === "tiktok"
                        ? "token da Events API"
                        : "EAA…"
                  }
                  className="font-mono"
                  autoComplete="off"
                  aria-describedby={idCampo("token-dica")}
                />
                <p id={idCampo("token-dica")} className="text-label text-t2">
                  {plataforma === "tiktok"
                    ? "No Gerenciador de eventos do TikTok: abra o pixel › Configurações › Gerar token de acesso."
                    : "No Gerenciador de Eventos do Meta: Configurações › API de Conversões › Gerar token."}
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
