"use client";

import { useEffect, useState } from "react";
import { Loader2, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface CheckoutSettings {
  checkout_domain?: string;
  checkout_country?: string;
  checkout_locale?: string;
}

interface CheckoutSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  routeId: string;
  routeName: string;
  settings?: CheckoutSettings;
  onSaved?: () => void;
}

// País -> { country, locale } para forçar a moeda do checkout (Shopify Markets).
// "auto" = sem override (deriva do idioma da loja). O Select nao aceita value "".
const AUTO = "auto";
const MARKETS: Record<string, { label: string; locale: string }> = {
  [AUTO]: { label: "Automático (idioma da loja)", locale: "" },
  CL: { label: "Chile (peso chileno)", locale: "es-CL" },
  MX: { label: "México (peso mexicano)", locale: "es-MX" },
  AR: { label: "Argentina (peso argentino)", locale: "es-AR" },
  CO: { label: "Colômbia (peso colombiano)", locale: "es-CO" },
  ES: { label: "España (euro)", locale: "es-ES" },
  BR: { label: "Brasil (real)", locale: "pt-BR" },
  US: { label: "Estados Unidos (dólar)", locale: "en-US" },
  JP: { label: "Japão (iene)", locale: "ja-JP" },
};

export function CheckoutSettingsDialog({
  open,
  onOpenChange,
  routeId,
  routeName,
  settings,
  onSaved,
}: CheckoutSettingsDialogProps) {
  const [domain, setDomain] = useState("");
  const [country, setCountry] = useState(AUTO);
  const [saving, setSaving] = useState(false);

  // Preenche o formulario quando o dialog abre, ajustando no RENDER.
  //
  // Era um efeito com [open, settings]. Alem do render extra a cada abertura,
  // ele tinha um efeito colateral pior: `settings` e um objeto vindo do pai,
  // entao qualquer re-render do pai que criasse um objeto novo reexecutava o
  // efeito e APAGAVA o que a pessoa tinha acabado de digitar, com o dialog
  // aberto. Comparar `open` com o valor do render anterior resolve os dois:
  // so repovoa na transicao fechado -> aberto.
  const [abertoAntes, setAbertoAntes] = useState(open);
  if (open !== abertoAntes) {
    setAbertoAntes(open);
    if (open) {
      setDomain(settings?.checkout_domain || "");
      setCountry(settings?.checkout_country || AUTO);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/checkout-routes/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: routeId,
          checkoutDomain: domain.trim(),
          checkoutCountry: country === AUTO ? "" : country,
          checkoutLocale: country === AUTO ? "" : MARKETS[country]?.locale || "",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao salvar.");
      toast.success("Configurações do checkout salvas.");
      onSaved?.();
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-primary" />
            Configurar checkout
          </DialogTitle>
          <DialogDescription>
            Rota <span className="font-medium text-foreground">{routeName}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="checkout-domain" className="text-xs">
              Domínio de checkout (loja checkout)
            </Label>
            <Input
              id="checkout-domain"
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
              placeholder="ex.: norvex.myshopify.com"
              className="bg-background/70 text-sm"
            />
            <p className="text-[11px] text-muted-foreground">
              Use o domínio <span className="font-medium">.myshopify.com</span>{" "}
              (não muda quando você troca o domínio público). Deixe vazio para
              usar o da loja conectada.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">País / moeda do checkout</Label>
            <Select
              value={country}
              onValueChange={(value) => setCountry(value || "")}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start">
                {Object.entries(MARKETS).map(([code, info]) => (
                  <SelectItem key={code} value={code}>
                    {info.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Força a moeda via Shopify Markets. A loja checkout precisa ter esse
              mercado/moeda configurado.
            </p>
          </div>

          <Button className="w-full" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Salvar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
