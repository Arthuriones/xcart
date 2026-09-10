
"use client";

import { textos } from "@/lib/textos";
import { useRouter } from "next/navigation";
import { useState, useEffect, useMemo, useRef } from "react";
import type { StoreRow } from "@/lib/stores/queries";
import dynamic from "next/dynamic";
import {
  ESTADO,
  PontoEstado,
  StoreTable,
  contagem,
  sincronizado,
} from "@/components/stores/store-table";
import type { StoreAsset } from "./store-profile-dialog";

const StoreProfileDialog = dynamic(
  () => import("./store-profile-dialog").then((m) => m.StoreProfileDialog),
  { ssr: false }
);
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Loader2,
  HelpCircle,
  ChevronDown,
  Copy,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { getPublicAppUrl } from "@/lib/public-url";
import { normalizeShopDomain } from "@/lib/shopify/domain";
import { SHOPIFY_SCOPES_STRING } from "@/lib/shopify/scopes";
import { cn } from "@/lib/utils";
import { getLogoUrl } from "@/lib/store-assets-url";

interface ConnectedStore {
  id: string;
  name: string;
  shop_domain: string;
  theme_id: string | null;
  // Opcionais desde que o perfil de marca saiu do formulario: as colunas
  // continuam no banco, mas a tela nao busca mais nem preenche.
  niche?: string | null;
  target_audience?: string | null;
  brand_voice?: string | null;
  store_description?: string | null;
  logo_path: string | null;
  target_language: string | null;
  currency_code: string | null;
  auto_convert_prices: boolean | null;
  currency_rate: number | null;
  price_markup_percent: number | null;
  created_at: string;
}

// Bloco de texto que o usuario precisa colar no painel da Shopify (escopos,
// URL de redirecionamento, URL do app). Antes era so um <p> em fonte 10.5px com
// break-all e o usuario tinha que selecionar o texto a mao — o passo mais
// propenso a erro de todo o onboarding.
function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success(`${label} copiado`);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Não foi possível copiar. Selecione e copie manualmente.");
    }
  }

  return (
    <div className="flex items-start gap-2 rounded-md border border-border/40 bg-background/50 px-2 py-1.5">
      <code className="min-w-0 flex-1 break-all font-mono text-[10.5px] leading-relaxed text-foreground/80">
        {value}
      </code>
      <button
        type="button"
        onClick={copy}
        title={`Copiar ${label}`}
        className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-primary" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  );
}

function StoreSkeleton() {
  return (
    <Card className="overflow-hidden border-border/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="skeleton h-5 w-32" />
          <div className="skeleton h-5 w-20 rounded-full" />
        </div>
        <div className="skeleton mt-2 h-4 w-48" />
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <div className="skeleton h-3 w-24" />
          <div className="skeleton h-8 w-8 rounded-md" />
        </div>
      </CardContent>
    </Card>
  );
}



function normalizeStorePricingDefaults(
  store: Omit<
    ConnectedStore,
    "target_language" | "currency_code" | "auto_convert_prices" | "currency_rate" | "price_markup_percent"
  > &
    Partial<
      Pick<
        ConnectedStore,
        "target_language" | "currency_code" | "auto_convert_prices" | "currency_rate" | "price_markup_percent"
      >
    >
): ConnectedStore {
  return {
    ...store,
    target_language: store.target_language || "pt-BR",
    currency_code: store.currency_code || "USD",
    auto_convert_prices: Boolean(store.auto_convert_prices),
    currency_rate: Number(store.currency_rate) > 0 ? Number(store.currency_rate) : 1,
    price_markup_percent: Number(store.price_markup_percent) || 0,
  };
}

export function StoresScreen({ initialStores }: { initialStores: StoreRow[] }) {
  const t = textos("stores");
  const router = useRouter();
  const [stores, setStores] = useState<ConnectedStore[]>(
    initialStores as unknown as ConnectedStore[]
  );
  // Só volta a true quando o usuário pede recarga; a primeira pintura já
  // veio pronta do servidor.
  const [loadingStores, setLoadingStores] = useState(false);
  // Papel de cada loja no roteamento (vitrine / checkout). Nao e coluna da
  // loja: sai das rotas, entao vem do mesmo endpoint que desenha o mapa.
  const [shopDomain, setShopDomain] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const publicAppUrl =
    typeof window !== "undefined"
      ? getPublicAppUrl(window.location.origin)
      : getPublicAppUrl();
  const [showTutorial, setShowTutorial] = useState(false);
  // Guarda se ja abrimos o tutorial automaticamente, para nao reabrir depois que
  // o usuario fechar.
  const tutorialAutoOpenedRef = useRef(false);
  // Sinaliza que voltamos do OAuth (?installed=1) e devemos abrir o perfil da
  // loja recem-instalada assim que a lista carregar.
  const pendingProfileAfterInstallRef = useRef(false);

  // Profile editing
  const [profileOpen, setProfileOpen] = useState(false);
  // Uma vez baixado, fica montado: fechar e reabrir nao deve baixar de novo.
  const [montarEditor, setMontarEditor] = useState(false);
  const [editingStore, setEditingStore] = useState<ConnectedStore | null>(null);
  const [profileTargetLanguage, setProfileTargetLanguage] = useState("pt-BR");
  const [profileCurrencyCode, setProfileCurrencyCode] = useState("USD");
  const [profileAutoConvertPrices, setProfileAutoConvertPrices] = useState(false);
  const [profileCurrencyRate, setProfileCurrencyRate] = useState("1");
  const [profilePriceMarkupPercent, setProfilePriceMarkupPercent] = useState("0");
  const [profileName, setProfileName] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [storeAssets, setStoreAssets] = useState<StoreAsset[]>([]);
  const [assetFiles, setAssetFiles] = useState<File[]>([]);
  const [assetUploading, setAssetUploading] = useState(false);
  // "" significa "ainda nao escolhi" -- a loja efetiva e derivada, com a
  // primeira da lista como padrao.
  //
  // Era um efeito que fazia setMaterialsStoreId(stores[0].id) assim que a
  // lista chegava. Render extra, e pior: o efeito dependia do proprio
  // materialsStoreId, entao qualquer mudanca na lista podia reabrir a
  // condicao. Como o valor sai inteiramente de props/estado que ja existem,
  // ele nao precisava ser estado proprio.
  const [materialsStoreEscolhida, setMaterialsStoreId] = useState("");
  const materialsStoreId =
    materialsStoreEscolhida || (!loadingStores ? (stores[0]?.id ?? "") : "");
  const [additionalLogoFiles, setAdditionalLogoFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const additionalLogoInputRef = useRef<HTMLInputElement>(null);
  const assetsInputRef = useRef<HTMLInputElement>(null);
  const normalizedShopDomain = normalizeShopDomain(shopDomain);
  const isShopDomainValid =
    shopDomain.trim().length === 0 || normalizedShopDomain !== null;

  // Feedback do callback de OAuth (?installed=1 ou ?error=...)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const installed = params.get("installed");
    const errorMessage = params.get("error");
    if (installed) {
      toast.success("Loja instalada e conectada com sucesso!");
      // Marca para abrir o perfil assim que a lista de lojas carregar. Sem isso
      // o usuario terminava toda a instalacao e caia num card "Perfil
      // incompleto" sem nenhuma acao sugerida — e o perfil (nicho) e o que
      // destrava toda a IA do produto.
      pendingProfileAfterInstallRef.current = true;
    }
    if (errorMessage) {
      toast.error(errorMessage);
    }
    if (installed || errorMessage) {
      const url = new URL(window.location.href);
      url.search = "";
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  useEffect(() => {
    if (loadingStores || !pendingProfileAfterInstallRef.current) return;
    if (stores.length === 0) return;
    pendingProfileAfterInstallRef.current = false;
    // Abre a loja recem-instalada que ainda esta sem logo, que e a unica
    // configuracao que o app nao consegue preencher sozinho.
    const target = stores.find((store) => !store.logo_path);
    if (target) void openProfileEditor(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingStores, stores]);

  useEffect(() => {
    // Primeira loja do usuario: o passo a passo da Shopify e a unica coisa que
    // desbloqueia o produto, entao abre aberto em vez de escondido atras de um
    // clique. Depois que existe ao menos uma loja, volta a ficar recolhido.
    if (
      !loadingStores &&
      stores.length === 0 &&
      open &&
      !tutorialAutoOpenedRef.current
    ) {
      tutorialAutoOpenedRef.current = true;
      setShowTutorial(true);
    }
  }, [loadingStores, stores.length, open]);


  useEffect(() => {
    if (!materialsStoreId) return;
    void loadStoreAssets(materialsStoreId);
  }, [materialsStoreId]);

  // Duas listas, não quatro grupos: quem recebe tráfego e quem cobra. O papel
  // vem das rotas; loja sem rota ainda aparece entre as de checkout, que é
  // onde ela provavelmente vai entrar.
  const vitrines = useMemo(
    () =>
      (initialStores as unknown as StoreRow[]).filter(
        (loja) => loja.role === "vitrine" || loja.role === "both"
      ),
    [initialStores]
  );

  const checkouts = useMemo(
    () =>
      (initialStores as unknown as StoreRow[]).filter(
        (loja) => loja.role !== "vitrine" && loja.role !== "both"
      ),
    [initialStores]
  );

  async function loadStores() {
    // Recalcula tambem o papel de cada loja, que e derivado das rotas no
    // servidor. Sem isto, uma loja recem-conectada ficaria em "Fora de rota"
    // ate a proxima navegacao.
    router.refresh();
    setLoadingStores(true);
    try {
      const lista = await buscarLojas();
      if (lista) setStores(lista);
    } finally {
      setLoadingStores(false);
    }
  }

  /** Lista as lojas pelo endpoint, sem cliente Supabase no navegador. */
  async function buscarLojas(): Promise<ConnectedStore[] | null> {
    try {
      const resposta = await fetch("/api/stores");
      if (!resposta.ok) return null;
      const dados = await resposta.json();
      return (dados.stores || []).map((loja: ConnectedStore) =>
        normalizeStorePricingDefaults(loja)
      );
    } catch {
      return null;
    }
  }

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();

    if (!normalizedShopDomain) {
      toast.error("Por favor, insira um domínio válido (ex: loja.myshopify.com ou loja.com).");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/shopify/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shopDomain: normalizedShopDomain,
          clientId,
          clientSecret,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Erro ao conectar loja");
        return;
      }

      // App ainda nao instalado nessa loja: redireciona pro OAuth do Shopify
      if (data.needsInstall && data.installUrl) {
        toast.message("Abrindo a tela de autorizacao do Shopify...");
        window.location.href = data.installUrl;
        return;
      }

      await loadStores();
      toast.success(`Loja "${data.shop.name}" conectada! Configure o perfil para usar a IA.`);
      setOpen(false);
      setShopDomain("");
      setClientId("");
      setClientSecret("");

      // Auto-abrir edição de perfil da loja recém-conectada
      const updatedStores = await loadStoresAndReturn();
      const newStore = updatedStores?.find((s) => s.shop_domain === data.store.shop_domain);
      if (newStore) {
        await openProfileEditor(newStore);
      }
    } catch {
      toast.error("Erro ao conectar loja");
    } finally {
      setLoading(false);
    }
  }

  async function loadStoresAndReturn(): Promise<ConnectedStore[] | null> {
    const lista = await buscarLojas();
    if (lista) setStores(lista);
    return lista;
  }

  async function loadStoreAssets(storeId: string) {
    try {
      const resposta = await fetch(
        `/api/store-assets?storeId=${encodeURIComponent(storeId)}`
      );
      if (!resposta.ok) return;
      const dados = await resposta.json();
      setStoreAssets(dados.assets || []);
    } catch {
      // best-effort: a tela abre sem os materiais em vez de falhar
    }
  }

  async function openProfileEditor(store: ConnectedStore) {
    setMontarEditor(true);
    setEditingStore(store);
    setProfileName(store.name || "");
    setProfileTargetLanguage(store.target_language || "pt-BR");
    setProfileCurrencyCode(store.currency_code || "USD");
    setProfileAutoConvertPrices(Boolean(store.auto_convert_prices));
    setProfileCurrencyRate(
      Number.isFinite(store.currency_rate) ? String(store.currency_rate) : "1"
    );
    setProfilePriceMarkupPercent(
      Number.isFinite(store.price_markup_percent)
        ? String(store.price_markup_percent)
        : "0"
    );
    setLogoPreview(store.logo_path ? getLogoUrl(store.logo_path) : null);
    setLogoFile(null);
    setAdditionalLogoFiles([]);
    setAssetFiles([]);
    await loadStoreAssets(store.id);
    setProfileOpen(true);
  }

  function handleLogoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      toast.error("Logo deve ter no máximo 2MB");
      return;
    }

    if (!["image/png", "image/svg+xml", "image/webp", "image/jpeg"].includes(file.type)) {
      toast.error("Formato aceito: PNG, SVG, WEBP ou JPG");
      return;
    }

    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
  }

  function handleAdditionalLogoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const validFiles: File[] = [];
    for (const file of files) {
      if (file.size > 2 * 1024 * 1024) {
        toast.error(`Logo muito grande: ${file.name}. Max 2MB.`);
        continue;
      }
      if (!["image/png", "image/svg+xml", "image/webp", "image/jpeg"].includes(file.type)) {
        toast.error(`Formato invalido: ${file.name}`);
        continue;
      }
      validFiles.push(file);
    }
    if (validFiles.length > 0) {
      setAdditionalLogoFiles((prev) => [...prev, ...validFiles].slice(0, 5));
    }
  }

  function handleAssetsSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const allowedTypes = ["image/png", "image/webp", "image/jpeg", "image/jpg"];
    const validFiles: File[] = [];

    for (const file of files) {
      if (!allowedTypes.includes(file.type)) {
        toast.error(`Formato nao suportado: ${file.name}`);
        continue;
      }
      if (file.size > 6 * 1024 * 1024) {
        toast.error(`Arquivo muito grande (${file.name}). Max 6MB por imagem.`);
        continue;
      }
      validFiles.push(file);
    }

    if (validFiles.length === 0) return;

    setAssetFiles((prev) => {
      const next = [...prev, ...validFiles].slice(0, 12);
      if (next.length < prev.length + validFiles.length) {
        toast.error("Limite de 12 materiais por vez.");
      }
      return next;
    });
  }



  async function handleRemoveAsset(asset: StoreAsset) {
    if (!confirm("Remover este material da marca?")) return;

    const resposta = await fetch(
      `/api/store-assets?id=${encodeURIComponent(asset.id)}&filePath=${encodeURIComponent(asset.file_path)}`,
      { method: "DELETE" }
    );
    const dbError = resposta.ok ? null : new Error("falhou");
    const storageError = null;

    if (dbError) {
      toast.error("Nao foi possivel remover o material.");
      return;
    }

    if (storageError) {
      toast.error("Material removido do cadastro, mas houve erro ao excluir arquivo.");
    } else {
      toast.success("Material removido.");
    }

    setStoreAssets((prev) => prev.filter((a) => a.id !== asset.id));
  }
  async function handleSaveProfile() {
    if (!editingStore) return;

    const parsedCurrencyRate = Number(profileCurrencyRate.replace(",", "."));
    if (!Number.isFinite(parsedCurrencyRate) || parsedCurrencyRate <= 0) {
      toast.error("Taxa de conversão deve ser maior que zero.");
      return;
    }
    const parsedMarkupPercent = Number(profilePriceMarkupPercent.replace(",", "."));
    if (!Number.isFinite(parsedMarkupPercent) || parsedMarkupPercent < -100) {
      toast.error("Markup inválido. Use um valor maior que -100.");
      return;
    }

    setProfileSaving(true);

    try {
      let logoPath = editingStore.logo_path;

      /** Envia um arquivo pelo endpoint e devolve o caminho gravado. */
      async function enviar(file: File, bucket: string, label?: string) {
        const form = new FormData();
        form.append("storeId", editingStore!.id);
        form.append("bucket", bucket);
        form.append("file", file);
        if (label) form.append("label", label);
        const resposta = await fetch("/api/store-assets", {
          method: "POST",
          body: form,
        });
        if (!resposta.ok) {
          const dados = await resposta.json().catch(() => ({}));
          throw new Error(dados.error || "Falha ao enviar o arquivo.");
        }
        const dados = await resposta.json();
        return dados.path as string;
      }

      if (logoFile) {
        setLogoUploading(true);
        logoPath = await enviar(logoFile, "store-logos");
        setLogoUploading(false);
      }

      // Logos adicionais e materiais viram linha em store_assets; o endpoint
      // grava o arquivo e o registro na mesma chamada.
      if (additionalLogoFiles.length > 0) {
        setLogoUploading(true);
        for (const file of additionalLogoFiles) {
          await enviar(file, "store-assets", `logo:${file.name}`);
        }
        setLogoUploading(false);
      }

      if (assetFiles.length > 0) {
        setAssetUploading(true);
        for (const file of assetFiles) {
          await enviar(file, "store-assets", file.name);
        }
        setAssetUploading(false);
      }

      const resposta = await fetch(`/api/stores/${editingStore.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: profileName.trim() || editingStore.name,
          logo_path: logoPath,
          target_language: profileTargetLanguage,
          currency_code: profileCurrencyCode,
          auto_convert_prices: profileAutoConvertPrices,
          currency_rate: parsedCurrencyRate,
          price_markup_percent: parsedMarkupPercent,
        }),
      });
      if (!resposta.ok) {
        const dados = await resposta.json().catch(() => ({}));
        throw new Error(dados.error || "Falha ao salvar a loja.");
      }

      await loadStores();
      await loadStoreAssets(editingStore.id);
      setAssetFiles([]);
      setAdditionalLogoFiles([]);
      setProfileOpen(false);
      toast.success("Configurações salvas.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setProfileSaving(false);
      setLogoUploading(false);
      setAssetUploading(false);
    }
  }


  return (
    <div className="flex flex-col gap-[22px] animate-fade-in">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto border-border bg-surface">
            <DialogHeader>
              <DialogTitle className="text-[15px] font-semibold text-ink">
                {t("connect_dialog_title")}
              </DialogTitle>
            </DialogHeader>

            <div className="rounded-lg border border-border/40 bg-background/40">
              <button
                type="button"
                onClick={() => setShowTutorial((v) => !v)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-[13px] text-foreground/90 hover:bg-background/60 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
                  {t("tutorial_toggle")}
                </span>
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 text-muted-foreground transition-transform duration-200",
                    showTutorial && "rotate-180"
                  )}
                />
              </button>
              {showTutorial && (
                <div className="border-t border-border/40 px-4 py-3 space-y-2.5 text-[12px] text-muted-foreground leading-relaxed">
                  <p>
                    <strong className="text-foreground/90">1.</strong> Acesse{" "}
                    <a
                      href="https://dev.shopify.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-foreground transition-colors"
                    >
                      dev.shopify.com
                    </a>{" "}
                    &rarr; Apps &rarr; <strong className="text-foreground/90">Create app</strong>. Da um nome qualquer.
                  </p>
                  <p>
                    <strong className="text-foreground/90">2.</strong> No app criado, va em{" "}
                    <strong className="text-foreground/90">Configuration</strong> e em{" "}
                    <strong className="text-foreground/90">Acesso &rarr; Selecionar escopos</strong>, cole:
                  </p>
                  <CopyField value={SHOPIFY_SCOPES_STRING} label="Escopos" />
                  <p className="rounded-md border border-amber-500/30 bg-amber-500/8 px-2.5 py-2">
                    A Shopify trata <strong className="text-foreground/90">envio, descontos, estoque e mercados</strong>{" "}
                    como escopos protegidos: depois de colar a lista, ela pede
                    sua aprovacao na propria tela. Aprove todos. Sem eles a loja
                    conecta do mesmo jeito, mas voce vai ter que configurar zona
                    de envio, desconto e estoque na mao no admin da Shopify.
                  </p>
                  <p>
                    <strong className="text-foreground/90">3.</strong> Em{" "}
                    <strong className="text-foreground/90">URLs de redirecionamento</strong>, cole exatamente:
                  </p>
                  <CopyField
                    value={`${publicAppUrl}/api/shopify/auth`}
                    label="URL de redirecionamento"
                  />
                  <p>
                    <strong className="text-foreground/90">4.</strong> Em{" "}
                    <strong className="text-foreground/90">URL do app</strong>, cole apenas o dominio (sem o /api/shopify/auth):
                  </p>
                  <CopyField value={publicAppUrl} label="URL do app" />
                  <p>
                    Marque <strong className="text-foreground/90">Usar fluxo de instalacao legado</strong> e clica em <strong className="text-foreground/90">Lancar</strong> a versao no topo da pagina.
                  </p>
                  <p>
                    <strong className="text-foreground/90">5.</strong> Em{" "}
                    <strong className="text-foreground/90">API credentials</strong>, copie o{" "}
                    <strong className="text-foreground/90">Client ID</strong> e o{" "}
                    <strong className="text-foreground/90">Client Secret</strong>.
                  </p>
                  <p>
                    <strong className="text-foreground/90">6.</strong> Cole o dominio + Client ID + Client Secret abaixo e clique em <strong className="text-foreground/90">Conectar</strong>.
                    Se o app ainda nao estiver instalado nessa loja, voce sera redirecionado para autorizar na Shopify automaticamente.
                  </p>
                </div>
              )}
            </div>

            <form onSubmit={handleConnect} className="space-y-4">
              <div className="space-y-2">
                <Label className="text-[12px] text-t2">
                  {t("domain_label")}
                </Label>
                <Input
                  placeholder={t("domain_placeholder")}
                  value={shopDomain}
                  onChange={(e) => setShopDomain(e.target.value)}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  required
                  className={`h-[34px] border-[var(--control-border)] bg-surface text-[12px] ${!isShopDomainValid ? "border-[var(--err)]" : ""}`}
                />
                <p className="text-xs text-muted-foreground/70">
                  Use o dominio interno da Shopify, exemplo:{" "}
                  <span className="font-mono">sualoja.myshopify.com</span>.
                </p>
                {!isShopDomainValid && (
                  <p className="text-xs text-destructive">
                    Domínio inválido. Use um formato como loja.myshopify.com ou seu domínio próprio (loja.com).
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label className="text-[12px] text-t2">
                  {t("client_id_label")}
                </Label>
                <Input
                  placeholder="ID do cliente do app"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  required
                  className="h-[34px] border-[var(--control-border)] bg-surface text-[12px]"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-[12px] text-t2">
                  {t("client_secret_label")}
                </Label>
                <Input
                  type="password"
                  placeholder="shpss_..."
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  required
                  className="h-[34px] border-[var(--control-border)] bg-surface text-[12px]"
                />
                <p className="text-xs text-muted-foreground/70">
                  Encontre em{" "}
                  <a
                    href="https://dev.shopify.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-foreground transition-colors duration-200"
                  >
                    dev.shopify.com
                  </a>{" "}
                  &rarr; seu app &rarr; Credenciais
                </p>
              </div>
              <Button
                type="submit"
                className="h-[34px] w-full bg-[var(--solid)] text-[12.5px] font-semibold text-[var(--on-solid)] hover:bg-[var(--solid-hover)]"
                disabled={loading || !isShopDomainValid}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  t("connect_submit")
                )}
              </Button>
            </form>
        </DialogContent>
      </Dialog>

      {loadingStores ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <StoreSkeleton />
          <StoreSkeleton />
          <StoreSkeleton />
        </div>
      ) : stores.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border-strong)] bg-surface px-8 py-11 text-center">
          <p className="text-[15px] font-semibold text-ink">{t("no_stores_title")}</p>
          <p className="mx-auto mb-4 mt-1.5 max-w-[360px] text-[12.5px] text-t2">
            Comece pela vitrine — é ela que define quais produtos o xcart vai
            espelhar nas lojas de checkout.
          </p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="h-[30px] rounded-md bg-[var(--solid)] px-[13px] text-[12.5px] font-semibold text-[var(--on-solid)] transition-colors hover:bg-[var(--solid-hover)]"
          >
            {t("connect_btn")}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-[22px]">
          {/* Vitrines primeiro e como cartao: sao poucas e e por elas que o
              trafego entra. Lojas de checkout viram tabela porque sao muitas e
              o que interessa nelas e comparar linha a linha. */}
          {vitrines.length > 0 && (
            <section>
              <div className="mb-[9px] flex items-center gap-2.5">
                <h2 className="text-[13px] font-semibold text-ink">Vitrines</h2>
                <span className="h-px flex-1 bg-border" />
              </div>
              <p className="mb-[9px] max-w-[640px] text-pretty text-[12px] text-t3">
                Recebem o tráfego do anúncio e carregam a marca. O comprador navega e
                monta o carrinho aqui.
              </p>
              <div className="flex flex-col gap-2">
                {vitrines.map((loja) => (
                  <button
                    key={loja.id}
                    type="button"
                    onClick={() => void openProfileEditor(loja)}
                    className="flex w-full items-center gap-4 rounded-lg border border-border bg-surface px-4 py-[13px] text-left transition-colors hover:border-[var(--border-strong)] hover:bg-surface-2"
                  >
                    <span className="min-w-0 flex-1">
                      {/* Ordem do design: bolinha, nome, palavra. */}
                      <span className="flex items-center gap-2">
                        <PontoEstado estado={loja.routeState} />
                        <span className="truncate text-[13.5px] font-semibold text-ink">
                          {loja.name}
                        </span>
                        <span
                          className="shrink-0 text-[11.5px]"
                          style={{ color: ESTADO[loja.routeState].cor }}
                        >
                          {ESTADO[loja.routeState].texto}
                        </span>
                      </span>
                      <span className="mt-[3px] block truncate font-mono text-[11px] text-t3">
                        {loja.shop_domain}
                      </span>
                    </span>
                    {/* Mesma regra da tabela: travessão quando nunca foi
                        conferido, não uma frase que quebra o ritmo da linha. */}
                    <span className="shrink-0 text-[12px] tabular-nums text-t1">
                      {contagem(loja) != null ? `${contagem(loja)} produtos` : "—"}
                    </span>
                    <span className="shrink-0 text-[12px] text-t3">
                      Sync {sincronizado(loja.catalog_synced_at)}
                    </span>
                    <span className="shrink-0 text-[12px] font-semibold text-t1">
                      Gerenciar &rarr;
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <section>
            <div className="mb-[9px] flex items-center gap-2.5">
              <h2 className="text-[13px] font-semibold text-ink">Lojas de checkout</h2>
              <span className="font-mono text-[11px] text-t4">{checkouts.length}</span>
              <span className="h-px flex-1 bg-border" />
              <Button
                variant="outline"
                onClick={() => setOpen(true)}
                className="h-[26px] rounded-md px-[9px] text-[12px] font-semibold"
              >
                {t("connect_btn")}
              </Button>
            </div>
            <p className="mb-[9px] max-w-[640px] text-pretty text-[12px] text-t3">
              Catálogo neutralizado, onde o pagamento acontece. Título, descrição e
              imagem podem mudar à vontade; SKU e variante, nunca.
            </p>
            {checkouts.length > 0 ? (
              <StoreTable lojas={checkouts} onAbrir={(l) => void openProfileEditor(l)} />
            ) : (
              <div className="rounded-lg border border-dashed border-[var(--border-strong)] bg-surface px-8 py-11 text-center">
                <p className="text-[15px] font-semibold text-ink">
                  Nenhuma loja de checkout
                </p>
                <p className="mx-auto mt-1.5 max-w-[360px] text-[12.5px] text-t2">
                  É nela que o pagamento acontece. Conecte a segunda loja para o xcart
                  ter para onde rotear o carrinho.
                </p>
              </div>
            )}
          </section>
        </div>
      )}

      {/* Editor da loja: 336 linhas que so aparecem depois de clicar numa
          linha da tabela. Sob demanda, saem do primeiro download junto com o
          Select, o Badge e o next/image. */}
      {montarEditor && (
        <StoreProfileDialog
          open={profileOpen}
          onOpenChange={setProfileOpen}
          storeName={editingStore?.name ?? ""}
          profileName={profileName}
          setProfileName={setProfileName}
          profileTargetLanguage={profileTargetLanguage}
          setProfileTargetLanguage={setProfileTargetLanguage}
          profileCurrencyCode={profileCurrencyCode}
          setProfileCurrencyCode={setProfileCurrencyCode}
          profileCurrencyRate={profileCurrencyRate}
          setProfileCurrencyRate={setProfileCurrencyRate}
          profilePriceMarkupPercent={profilePriceMarkupPercent}
          setProfilePriceMarkupPercent={setProfilePriceMarkupPercent}
          profileAutoConvertPrices={profileAutoConvertPrices}
          setProfileAutoConvertPrices={setProfileAutoConvertPrices}
          profileSaving={profileSaving}
          logoUploading={logoUploading}
          assetUploading={assetUploading}
          logoPreview={logoPreview}
          handleLogoSelect={handleLogoSelect}
          fileInputRef={fileInputRef}
          additionalLogoFiles={additionalLogoFiles}
          handleAdditionalLogoSelect={handleAdditionalLogoSelect}
          additionalLogoInputRef={additionalLogoInputRef}
          storeAssets={storeAssets}
          assetFiles={assetFiles}
          handleAssetsSelect={handleAssetsSelect}
          assetsInputRef={assetsInputRef}
          handleRemoveAsset={handleRemoveAsset}
          handleSaveProfile={handleSaveProfile}
        />
      )}
    </div>
  );
}

