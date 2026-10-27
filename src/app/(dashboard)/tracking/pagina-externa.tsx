"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { HOST_DO_CHECKOUT, nomeDaPlataforma, type IdPlataformaCheckout } from "@/lib/checkouts-externos/tipos";
import { respostaJson } from "./resposta";

// ============================================================================
// Pagina externa (VSL, advertorial, pagina de oferta fora da Shopify).
//
// Duas coisas para o lojista colar na pagina dele: a tag da ponte
// (xcart-bridge.js, que leva o clique do anuncio ate o checkout) e o link do
// botao de comprar, que e o permalink do checkout no DOMINIO PERMANENTE da
// loja -- sobrevive a troca de dominio, porque a Shopify redireciona o
// permanente para o atual preservando a query.
//
// O botao tambem pode levar a um CHECKOUT EXTERNO (Cakto, Hubla): ai a tag e a do
// checkout (data-xcart-checkout) e o botao aponta para o link da oferta la,
// sem nada a mais -- a ponte acrescenta o visitante, as UTMs e o clique.
//
// A MESMA tag da loja serve no tema da VITRINE de uma rota que leva a esta
// loja: la ela mede visita, produto e carrinho para esta loja de checkout
// (xcart-bridge.js, 3b). A tela diz isso e nomeia as vitrines das rotas.
//
// Carrega so quando o lojista abre: lista os produtos na Shopify, e isso nao
// precisa acontecer em toda abertura do detalhe da loja.
// ============================================================================

interface Variante {
  id: string;
  titulo: string;
  preco: string;
}

interface Produto {
  id: string;
  titulo: string;
  variantes: Variante[];
}

interface Kit {
  dominio: string;
  tag: string;
  produtos: Produto[];
  /** As vitrines das rotas em que esta loja e o checkout. */
  vitrines?: { nome: string; dominio: string }[];
}

/** Um checkout externo que rastreia (GET /api/tracking/pagina-externa?checkouts=1). */
interface CheckoutDaPagina {
  id: string;
  nome: string;
  plataforma: IdPlataformaCheckout;
  ativo: boolean;
  rastreando: boolean;
  tag: string;
}

const DESTINO_LOJA = "loja";

export function PaginaExterna({ storeId }: { storeId: string }) {
  const [aberto, setAberto] = useState(false);
  const [checkouts, setCheckouts] = useState<CheckoutDaPagina[]>([]);
  const [destino, setDestino] = useState<string>(DESTINO_LOJA);
  const idDestino = useId();

  // Os checkouts que rastreiam: so o banco, sem a Shopify. Falhou, a tela
  // segue so com a loja (o checkout e opcional aqui).
  useEffect(() => {
    if (!aberto) return;
    let vivo = true;
    fetch("/api/tracking/pagina-externa?checkouts=1", { cache: "no-store" })
      .then((r) => respostaJson(r, "Não deu para ler os checkouts."))
      .then((j) => {
        if (vivo && Array.isArray(j.checkouts)) setCheckouts(j.checkouts as CheckoutDaPagina[]);
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [aberto]);

  if (!aberto) {
    return (
      <div className="flex flex-col gap-2.5 px-4 py-3.5">
        <p className="text-label text-t1">
          Oferta numa página fora da Shopify (VSL, advertorial) com o botão indo direto para o checkout da loja ou para
          a Cakto ou a Hubla. Gera o script da página e o link do botão.
        </p>
        <p className="text-label text-t2">
          O mesmo script serve na vitrine de uma rota que leva a esta loja: colado no tema da vitrine, ele mede a visita,
          o produto e o carrinho de lá para esta loja.
        </p>
        <div>
          <Button size="sm" variant="secondary" onClick={() => setAberto(true)}>
            Gerar script e link
          </Button>
        </div>
      </div>
    );
  }

  const checkout = checkouts.find((c) => c.id === destino) ?? null;

  return (
    <div className="flex flex-col gap-5 px-4 py-3.5">
      {checkouts.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <Label id={idDestino}>O botão da página leva para</Label>
          <Select value={destino} onValueChange={(v) => typeof v === "string" && setDestino(v)}>
            <SelectTrigger aria-labelledby={idDestino} className="sm:w-96">
              <SelectValue>{() => (checkout ? rotuloDoCheckout(checkout) : "O checkout desta loja")}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DESTINO_LOJA}>O checkout desta loja</SelectItem>
              {checkouts.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {rotuloDoCheckout(c)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {/* A loja fica montada (escondida) com um checkout escolhido: voltar
          para ela nao relista os produtos na Shopify. */}
      <div className={checkout ? "hidden" : "flex flex-col gap-5"}>
        <KitDaLoja storeId={storeId} />
      </div>
      {checkout && <KitDoCheckout checkout={checkout} />}
    </div>
  );
}

function rotuloDoCheckout(c: CheckoutDaPagina) {
  return `${nomeDaPlataforma(c.plataforma)} · ${c.nome}`;
}

/** O botao vai para o permalink do checkout desta loja Shopify. */
function KitDaLoja({ storeId }: { storeId: string }) {
  const [kit, setKit] = useState<Kit | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const [produtoId, setProdutoId] = useState<string | null>(null);
  const [varianteId, setVarianteId] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/tracking/pagina-externa?storeId=${encodeURIComponent(storeId)}`, { cache: "no-store" })
      .then((r) => respostaJson(r, "Não deu para ler os produtos da loja."))
      .then((j) => {
        if (!vivo) return;
        const k = j as unknown as Kit;
        if (typeof k.tag !== "string" || !Array.isArray(k.produtos)) {
          throw new Error("Não deu para ler os produtos da loja.");
        }
        setKit(k);
      })
      .catch((e) => vivo && setErro(e instanceof Error ? e.message : "Não deu para ler os produtos da loja."));
    return () => {
      vivo = false;
    };
  }, [storeId, tentativa]);

  const produto = useMemo(
    () => kit?.produtos.find((p) => p.id === produtoId) ?? null,
    [kit, produtoId]
  );
  // Produto com uma variante so: o link ja sai, sem segundo passo.
  const variante =
    produto?.variantes.find((v) => v.id === varianteId) ??
    (produto && produto.variantes.length === 1 ? produto.variantes[0] : null);
  const link = kit && variante ? `https://${kit.dominio}/cart/${variante.id}:1` : null;

  if (erro) {
    return (
      <p role="alert" className="flex flex-wrap items-center gap-2 text-dense text-err">
        {erro}
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setErro(null);
            setTentativa((t) => t + 1);
          }}
        >
          Tentar de novo
        </Button>
      </p>
    );
  }
  if (!kit) {
    return (
      <p className="flex items-center gap-2 text-dense text-t2">
        <Spinner size={14} /> Lendo os produtos da loja…
      </p>
    );
  }

  const vitrines = kit.vitrines ?? [];

  return (
    <>
      {vitrines.length > 0 && (
        <Callout tom="info" titulo="Esta loja é o checkout de uma rota: o script vai na vitrine">
          <div className="flex flex-col gap-1.5">
            <p>
              {vitrines.length > 1 ? "As vitrines das rotas são " : "A vitrine da rota é "}
              {vitrines.map((v, i) => (
                <span key={v.dominio}>
                  {i > 0 && (i === vitrines.length - 1 ? " e " : ", ")}
                  <span className="font-medium">{v.nome}</span> (<span className="font-mono">{v.dominio}</span>)
                </span>
              ))}
              . Cole o script do passo 1 no tema {vitrines.length > 1 ? "de cada uma" : "dela"}, não no desta loja.
            </p>
            <p>{COMO_NA_VITRINE}</p>
          </div>
        </Callout>
      )}

      <Passo n={1} titulo="Cole na página, antes de </body>">
        <Codigo rotulo="Script da página" texto={kit.tag} />
        <p className="text-label text-t2">
          Manda o PageView e o ViewContent da página pelo servidor e leva o clique do anúncio (Meta, TikTok,
          Google) até o checkout. Não instale o pixel do Meta nem do TikTok na página: contaria em dobro.
        </p>
        {vitrines.length === 0 && (
          <p className="text-label text-t2">
            <span className="font-medium text-t1">Vitrine de uma rota:</span> se esta loja for o checkout de uma rota,
            este mesmo script vai no tema da vitrine. {COMO_NA_VITRINE}
          </p>
        )}
      </Passo>

      <Passo n={2} titulo="Link do botão de comprar">
        {kit.produtos.length === 0 ? (
          <p className="text-label text-t2">A loja não tem produto ativo.</p>
        ) : (
          <div className="flex flex-col gap-2.5">
            <Select
              value={produtoId}
              onValueChange={(v) => {
                if (typeof v !== "string") return;
                setProdutoId(v);
                setVarianteId(null);
              }}
            >
              <SelectTrigger aria-label="Produto" className="sm:w-96">
                <SelectValue>{() => produto?.titulo ?? "Escolha o produto"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {kit.produtos.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.titulo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {produto && produto.variantes.length > 1 && (
              <Select value={variante?.id ?? null} onValueChange={(v) => typeof v === "string" && setVarianteId(v)}>
                <SelectTrigger aria-label="Variante" className="sm:w-96">
                  <SelectValue>{() => (variante ? rotuloDaVariante(variante) : "Escolha a variante")}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {produto.variantes.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {rotuloDaVariante(v)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {link && <Codigo rotulo="Link do botão" texto={link} />}
          </div>
        )}
        <p className="text-label text-t2">
          O link usa o domínio permanente da loja e continua valendo se você trocar o domínio. Para mais de uma
          unidade, troque o <span className="font-mono">:1</span> do final pela quantidade.
        </p>
      </Passo>

      <p className="text-label text-t2">
        O pixel do checkout (bloco acima) precisa estar colado na Shopify: é ele que manda o início do checkout.
        A compra vai pelo aviso de pedidos.
      </p>
    </>
  );
}

/** O botao vai para o link da oferta no checkout externo (Cakto, Hubla). */
function KitDoCheckout({ checkout }: { checkout: CheckoutDaPagina }) {
  const plataforma = nomeDaPlataforma(checkout.plataforma);
  const host = HOST_DO_CHECKOUT[checkout.plataforma] ?? "o checkout";
  return (
    <>
      {!checkout.ativo ? (
        <Callout tom="warn" titulo="Checkout pausado.">
          Enquanto ele estiver pausado, a página não manda nada. Religue em Integrações › Checkouts.
        </Callout>
      ) : !checkout.rastreando ? (
        <Callout tom="warn" titulo="O rastreamento deste checkout está desligado.">
          Ligue o pixel do Meta ou do TikTok em Integrações › Checkouts › Rastreamento. Sem ele, a página não manda
          nada.
        </Callout>
      ) : null}

      <Passo n={1} titulo="Cole na página, antes de </body>">
        <Codigo rotulo="Script da página" texto={checkout.tag} />
        <p className="text-label text-t2">
          Manda a visita (PageView) e o clique no botão (InitiateCheckout) ao Meta e ao TikTok pelo servidor, e leva o
          clique do anúncio até a {plataforma}. Não instale o pixel do Meta nem do TikTok na página: contaria em dobro.
        </p>
      </Passo>

      <Passo n={2} titulo="Link do botão de comprar">
        <p className="text-label text-t1">
          Aponte o botão para o link da oferta na {plataforma} (<span className="font-mono">{host}/…</span>), sem nada a
          mais. O script acrescenta o visitante, as UTMs e o clique do anúncio.
        </p>
      </Passo>

      <p className="text-label text-t2">
        A compra sai pelo webhook da {plataforma}, ligada a esta visita: tire o pixel do Meta e do TikTok de lá (um
        emissor por pixel).
      </p>
    </>
  );
}

/** Onde colar na vitrine e o que ele faz la (xcart-bridge.js, 3b). */
const COMO_NA_VITRINE =
  "Na Shopify da vitrine: Loja virtual › Temas › Editar código › theme.liquid, antes de </body>. Lá ele manda " +
  "PageView, ViewContent e AddToCart para esta loja, com o produto do catálogo daqui; o checkout e a compra " +
  "continuam vindo do pixel e dos pedidos desta loja. Na vitrine não vai o link do passo 2 (a rota leva o " +
  "carrinho), nem o script do tema desta loja, nem pixel do Meta ou do TikTok: contaria em dobro.";

function rotuloDaVariante(v: Variante) {
  return v.preco ? `${v.titulo} · ${v.preco}` : v.titulo;
}

function Passo({ n, titulo, children }: { n: number; titulo: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-dense font-medium text-ink">
        <span className="text-t2">{n}.</span> {titulo}
      </p>
      {children}
    </div>
  );
}

/** O bloco de codigo com o botao Copiar. Tambem no rastreamento do checkout. */
export function Codigo({ rotulo, texto }: { rotulo: string; texto: string }) {
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    if (!copiado) return;
    const id = setTimeout(() => setCopiado(false), 1800);
    return () => clearTimeout(id);
  }, [copiado]);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
    } catch {
      toast.error("Não deu para copiar. Selecione o texto e copie na mão.");
    }
  }

  return (
    <div className="relative overflow-hidden rounded-control border border-border bg-surface-2">
      <pre
        aria-label={rotulo}
        tabIndex={0}
        className="m-0 max-h-40 overflow-auto px-3 py-2.5 font-mono text-label whitespace-pre-wrap break-all text-t1 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus sm:pr-24"
      >
        {texto}
      </pre>
      <div className="flex border-t border-border px-2 py-1.5 sm:absolute sm:top-1.5 sm:right-2 sm:border-0 sm:p-0">
        <Button size="sm" variant="secondary" onClick={copiar}>
          {copiado ? "Copiado" : "Copiar"}
        </Button>
      </div>
      <span role="status" className="sr-only">
        {copiado ? `${rotulo} copiado` : ""}
      </span>
    </div>
  );
}
