"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
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
}

export function PaginaExterna({ storeId }: { storeId: string }) {
  const [aberto, setAberto] = useState(false);
  const [kit, setKit] = useState<Kit | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const [produtoId, setProdutoId] = useState<string | null>(null);
  const [varianteId, setVarianteId] = useState<string | null>(null);

  useEffect(() => {
    if (!aberto) return;
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
  }, [storeId, aberto, tentativa]);

  const produto = useMemo(
    () => kit?.produtos.find((p) => p.id === produtoId) ?? null,
    [kit, produtoId]
  );
  // Produto com uma variante so: o link ja sai, sem segundo passo.
  const variante =
    produto?.variantes.find((v) => v.id === varianteId) ??
    (produto && produto.variantes.length === 1 ? produto.variantes[0] : null);
  const link = kit && variante ? `https://${kit.dominio}/cart/${variante.id}:1` : null;

  if (!aberto) {
    return (
      <div className="flex flex-col gap-2.5 px-4 py-3.5">
        <p className="text-label text-t1">
          Oferta numa página fora da Shopify (VSL, advertorial) com o botão indo direto para o checkout.
          Gera o script da página e o link do produto.
        </p>
        <div>
          <Button size="sm" variant="secondary" onClick={() => setAberto(true)}>
            Gerar script e link
          </Button>
        </div>
      </div>
    );
  }

  if (erro) {
    return (
      <p role="alert" className="flex flex-wrap items-center gap-2 px-4 py-3.5 text-dense text-err">
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
      <p className="flex items-center gap-2 px-4 py-3.5 text-dense text-t2">
        <Spinner size={14} /> Lendo os produtos da loja…
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5 px-4 py-3.5">
      <Passo n={1} titulo="Cole na página, antes de </body>">
        <Codigo rotulo="Script da página" texto={kit.tag} />
        <p className="text-label text-t2">
          Manda o PageView e o ViewContent da página pelo servidor e leva o clique do anúncio (Meta, TikTok,
          Google) até o checkout. Não instale o pixel do Meta nem do TikTok na página: contaria em dobro.
        </p>
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
    </div>
  );
}

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

function Codigo({ rotulo, texto }: { rotulo: string; texto: string }) {
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
