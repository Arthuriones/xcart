"use client";

import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  MERCADOS,
  PAIS_DO_COMPRADOR,
  mercadoDoPais,
  type CheckoutDoDestino,
} from "@/lib/checkout-routes/mercado";
import { marketParamsFromLanguage } from "@/lib/shopify/cart-routing";

/** O Select nao aceita value "": "idioma" e o padrao (nada gravado). */
const PELO_IDIOMA = "idioma";

type Tema = { estado?: string } | undefined;

export interface DestinoDoAjuste {
  id: string;
  nome: string;
  /** Dominio .myshopify.com da loja conectada. */
  dominioLoja: string;
  idiomaDaLoja: string | null;
  checkout: CheckoutDoDestino;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rotaId: string;
  destino: DestinoDoAjuste;
  onSaved?: (tema: Tema) => void;
}

function valorInicial(c: CheckoutDoDestino): string {
  if (c.modo === "comprador") return PAIS_DO_COMPRADOR;
  if (c.modo === "fixo" && c.pais) return c.pais;
  return PELO_IDIOMA;
}

function nomeDoPais(pais: string | null | undefined): string | null {
  if (!pais) return null;
  const m = mercadoDoPais(pais);
  return m ? `${m.nome} (${m.moeda})` : pais;
}

/**
 * Pais/moeda e dominio do checkout de UMA loja de checkout da rota.
 *
 * Montado so quando aberto (como o de imagens): o formulario nasce do dado
 * atual, sem efeito para repovoar.
 */
export function CheckoutSettingsDialog({ open, onOpenChange, rotaId, destino, onSaved }: Props) {
  const idPais = useId();
  const idDominio = useId();
  const [valor, setValor] = useState(() => valorInicial(destino.checkout));
  const [dominio, setDominio] = useState(destino.checkout.dominio ?? "");
  const [salvando, setSalvando] = useState(false);
  const [moedas, setMoedas] = useState<{ moeda: string; carrinhos: number }[] | null>(null);

  // Em que moeda os carrinhos desta loja chegaram (ultimos 30 dias): e o que
  // ajuda a escolher entre pais fixo e o do comprador.
  useEffect(() => {
    let vivo = true;
    const url = `/api/checkout-routes/settings?id=${encodeURIComponent(rotaId)}&targetId=${encodeURIComponent(destino.id)}`;
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (vivo) setMoedas(Array.isArray(d?.moedas) ? d.moedas : []);
      })
      .catch(() => {
        if (vivo) setMoedas([]);
      });
    return () => {
      vivo = false;
    };
  }, [rotaId, destino.id]);

  const paisDoIdioma = marketParamsFromLanguage(destino.idiomaDaLoja).country ?? null;
  const rotuloIdioma = `Pelo idioma da loja: ${nomeDoPais(paisDoIdioma) ?? "mercado principal"}`;
  // Pais fixo gravado que a lista nao tem continua escolhivel.
  const extra = valor.length === 2 && !mercadoDoPais(valor) ? [valor] : [];

  const rotulo = (v: string) =>
    v === PELO_IDIOMA
      ? rotuloIdioma
      : v === PAIS_DO_COMPRADOR
        ? "Automático (país do comprador)"
        : (nomeDoPais(v) ?? v);

  const ajuda =
    valor === PAIS_DO_COMPRADOR
      ? "A Shopify abre o checkout no país do comprador, na moeda dele. A loja de checkout precisa ter esses mercados ativos."
      : valor === PELO_IDIOMA
        ? paisDoIdioma
          ? `Todo comprador abre o checkout em ${nomeDoPais(paisDoIdioma)}, venha de onde vier.`
          : "Sem país no idioma da loja: a Shopify decide pelo mercado principal."
        : `Todo comprador abre o checkout em ${nomeDoPais(valor)}. A loja de checkout precisa ter esse mercado ativo.`;

  async function salvar() {
    setSalvando(true);
    try {
      const res = await fetch("/api/checkout-routes/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: rotaId,
          targetId: destino.id,
          checkoutDomain: dominio.trim(),
          checkoutCountry: valor === PELO_IDIOMA ? "" : valor,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; tema?: Tema };
      if (!res.ok) throw new Error(data.error || "Não deu para salvar.");
      toast.success(`Checkout de ${destino.nome} salvo.`);
      onSaved?.(data.tema);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não deu para salvar.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Checkout de {destino.nome}</DialogTitle>
          <DialogDescription>Em que país e moeda o checkout desta loja abre.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={idPais}>País e moeda</Label>
          <Select value={valor} onValueChange={(v) => setValor(typeof v === "string" && v ? v : PELO_IDIOMA)}>
            <SelectTrigger id={idPais} aria-describedby={`${idPais}-ajuda`}>
              <SelectValue>{(v: string) => rotulo(v)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={PELO_IDIOMA}>{rotuloIdioma}</SelectItem>
              <SelectItem value={PAIS_DO_COMPRADOR}>Automático (país do comprador)</SelectItem>
              {[...extra, ...MERCADOS.map((m) => m.pais)].map((pais) => (
                <SelectItem key={pais} value={pais}>
                  {nomeDoPais(pais)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p id={`${idPais}-ajuda`} className="text-label text-t2">
            {ajuda}
          </p>
          {moedas && moedas.length > 0 ? (
            <p className="text-label text-t2">
              Carrinhos dos últimos 30 dias:{" "}
              {moedas.map((m) => `${m.carrinhos.toLocaleString("pt-BR")} em ${m.moeda}`).join(" · ")}.
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={idDominio}>Domínio do checkout</Label>
          <Input
            id={idDominio}
            value={dominio}
            onChange={(e) => setDominio(e.target.value)}
            placeholder={destino.dominioLoja || "loja.myshopify.com"}
            aria-describedby={`${idDominio}-ajuda`}
            className="font-mono"
          />
          <p id={`${idDominio}-ajuda`} className="text-label text-t2">
            Vazio usa o da loja conectada. Prefira o .myshopify.com: ele não muda quando o domínio público muda.
          </p>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="secondary" disabled={salvando} />}>Cancelar</DialogClose>
          <Button pending={salvando} onClick={salvar}>
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
