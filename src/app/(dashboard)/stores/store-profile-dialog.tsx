"use client";

import Image from "next/image";
import { textos } from "@/lib/textos";
import { Loader2, Upload, Image as ImageIcon, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getAssetUrl, getLogoUrl } from "@/lib/store-assets-url";

export interface StoreAsset {
  id: string;
  store_id: string;
  file_path: string;
  label: string | null;
  created_at: string;
}

const CURRENCY_OPTIONS = [
  { value: "USD", label: "USD - Dolar americano" },
  { value: "BRL", label: "BRL - Real brasileiro" },
  { value: "EUR", label: "EUR - Euro" },
  { value: "GBP", label: "GBP - Libra esterlina" },
  { value: "JPY", label: "JPY - Iene japonês" },
];

const LANGUAGE_OPTIONS = [
  { value: "pt-BR", label: "Português do Brasil" },
  { value: "en-US", label: "English" },
  { value: "es-ES", label: "Español" },
  { value: "fr-FR", label: "Français" },
  { value: "de-DE", label: "Deutsch" },
  { value: "it-IT", label: "Italiano" },
  { value: "ja-JP", label: "日本語" },
];

/**
 * O editor da loja: nome, logos, materiais de marca, idioma e regra de preco.
 *
 * Vive em modulo proprio e entra por next/dynamic porque so existe depois de
 * um clique numa linha da tabela. Junto com ele saem do primeiro download o
 * Select, o Badge e o next/image, que nenhuma outra parte da tela usa.
 */
export interface StoreProfileDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  storeName: string;
  profileName: string;
  setProfileName: (v: string) => void;
  profileTargetLanguage: string;
  setProfileTargetLanguage: (v: string) => void;
  profileCurrencyCode: string;
  setProfileCurrencyCode: (v: string) => void;
  profileCurrencyRate: string;
  setProfileCurrencyRate: (v: string) => void;
  profilePriceMarkupPercent: string;
  setProfilePriceMarkupPercent: (v: string) => void;
  profileAutoConvertPrices: boolean;
  setProfileAutoConvertPrices: (v: boolean) => void;
  profileSaving: boolean;
  logoUploading: boolean;
  assetUploading: boolean;
  logoPreview: string | null;
  handleLogoSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  additionalLogoFiles: File[];
  handleAdditionalLogoSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  additionalLogoInputRef: React.RefObject<HTMLInputElement | null>;
  storeAssets: StoreAsset[];
  assetFiles: File[];
  handleAssetsSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  assetsInputRef: React.RefObject<HTMLInputElement | null>;
  handleRemoveAsset: (asset: StoreAsset) => void | Promise<void>;
  handleSaveProfile: () => void | Promise<void>;
}

export function StoreProfileDialog({
  open,
  onOpenChange,
  storeName,
  profileName,
  setProfileName,
  profileTargetLanguage,
  setProfileTargetLanguage,
  profileCurrencyCode,
  setProfileCurrencyCode,
  profileCurrencyRate,
  setProfileCurrencyRate,
  profilePriceMarkupPercent,
  setProfilePriceMarkupPercent,
  profileAutoConvertPrices,
  setProfileAutoConvertPrices,
  profileSaving,
  logoUploading,
  assetUploading,
  logoPreview,
  handleLogoSelect,
  fileInputRef,
  additionalLogoFiles,
  handleAdditionalLogoSelect,
  additionalLogoInputRef,
  storeAssets,
  assetFiles,
  handleAssetsSelect,
  assetsInputRef,
  handleRemoveAsset,
  handleSaveProfile,
}: StoreProfileDialogProps) {
  const t = textos("stores");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border/50 bg-card max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[15px] font-semibold text-ink">
            {t("profile_dialog_title", { name: storeName })}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          {/* Store Name */}
          <div className="space-y-2">
            <Label className="text-[12px] text-t2">
              Store Name
            </Label>
            <Input
              placeholder="My Store"
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              className="h-10 bg-background/50 border-border/50 text-sm"
            />
          </div>

          {/* Logo upload */}
          <div className="space-y-2">
            <Label className="text-[12px] text-t2">
              {t("logo_label")}
            </Label>
            <div className="flex items-center gap-4">
              <div
                className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg border-2 border-dashed border-border/50 overflow-hidden cursor-pointer hover:border-border transition-colors duration-200"
                style={{ background: "var(--background)" }}
                onClick={() => fileInputRef.current?.click()}
              >
                {logoPreview ? (
                  <Image
                    src={logoPreview}
                    alt="Logo"
                    width={80}
                    height={80}
                    className="object-contain"
                    unoptimized
                  />
                ) : (
                  <ImageIcon className="h-6 w-6 text-muted-foreground/30" />
                )}
              </div>
              <div className="space-y-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-[12px] border-border/50"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="mr-1.5 h-3 w-3" />
                  {logoPreview ? t("change_logo") : t("upload_logo")}
                </Button>
                <p className="text-[11px] text-muted-foreground/50">
                  PNG, SVG, WEBP ou JPG. Max 2MB.
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/svg+xml,image/webp,image/jpeg"
                onChange={handleLogoSelect}
                className="hidden"
              />
            </div>
          </div>

          {/* Logos adicionais */}
          <div className="space-y-2">
            <Label className="text-[12px] text-t2">
              {t("additional_logos_label")}
            </Label>
            <p className="text-[11px] text-muted-foreground/50">
              {t("additional_logos_hint")}
            </p>

            {/* Existing additional logos from store_assets */}
            {storeAssets.filter((a) => (a.label || "").toLowerCase().startsWith("logo")).length > 0 && (
              <div className="grid grid-cols-4 gap-2">
                {storeAssets
                  .filter((a) => (a.label || "").toLowerCase().startsWith("logo"))
                  .map((asset) => (
                    <div key={asset.id} className="relative group">
                      <div className="aspect-square rounded-md border border-border/40 overflow-hidden" style={{ background: "var(--background)" }}>
                        <Image
                          src={getLogoUrl(asset.file_path)}
                          alt={asset.label || "Logo"}
                          width={80}
                          height={80}
                          className="w-full h-full object-contain"
                          unoptimized
                        />
                      </div>
                      <span className="text-[9px] text-muted-foreground/60 truncate block mt-0.5">
                        {(asset.label || "Logo").replace(/^logo:?/i, "").trim() || "Logo"}
                      </span>
                    </div>
                  ))}
              </div>
            )}

            {/* Pending uploads */}
            {additionalLogoFiles.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {additionalLogoFiles.map((file, i) => (
                  <Badge key={`${file.name}-${i}`} variant="outline" className="text-[10px] border-border/40">
                    {file.name}
                  </Badge>
                ))}
              </div>
            )}

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-[11px] border-border/50"
              onClick={() => additionalLogoInputRef.current?.click()}
            >
              <Upload className="mr-1.5 h-3 w-3" />
              {t("add_logo_btn")}
            </Button>
            <input
              ref={additionalLogoInputRef}
              type="file"
              accept="image/png,image/svg+xml,image/webp,image/jpeg"
              onChange={handleAdditionalLogoSelect}
              multiple
              className="hidden"
            />
          </div>

          {/* Materiais da marca */}
          <div className="space-y-2">
            <Label className="text-[12px] text-t2">
              {t("brand_materials_label")}
            </Label>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-[12px] border-border/50"
                onClick={() => assetsInputRef.current?.click()}
              >
                <Upload className="mr-1.5 h-3 w-3" />
                {t("add_materials_btn")}
              </Button>
              <span className="text-[11px] text-muted-foreground/60">
                Up to 12 images (PNG, JPG, WEBP)
              </span>
              <input
                ref={assetsInputRef}
                type="file"
                accept="image/png,image/webp,image/jpeg,image/jpg"
                onChange={handleAssetsSelect}
                multiple
                className="hidden"
              />
            </div>

            {assetFiles.length > 0 && (
              <div className="rounded-lg border border-border/30 bg-background/50 p-2.5">
                <p className="text-[11px] font-medium text-muted-foreground mb-1.5">
                  {`New files (${assetFiles.length})`}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {assetFiles.map((file, index) => (
                    <Badge key={`${file.name}-${index}`} variant="outline" className="text-[10px] border-border/40">
                      {file.name}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {storeAssets.length > 0 ? (
              <div className="grid grid-cols-4 gap-2">
                {storeAssets.map((asset) => (
                  <div key={asset.id} className="relative group">
                    <div className="relative aspect-square overflow-hidden rounded-md border border-border/50 bg-background/40">
                      <Image
                        src={getAssetUrl(asset.file_path)}
                        alt={asset.label || "Material da marca"}
                        fill
                        className="object-cover"
                        unoptimized
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleRemoveAsset(asset)}
                      className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-card border border-border/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Remover material"
                    >
                      <X className="h-3 w-3 text-muted-foreground" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground/50">
                No extra materials yet. These files will be used as visual references for image recreation.
              </p>
            )}
          </div>

          <div className="space-y-2 rounded-lg border border-primary/25 bg-primary/8 p-3">
            <Label className="text-[12px] text-t2">
              {t("language_label")}
            </Label>
            <Select
              value={profileTargetLanguage}
              onValueChange={(value) => setProfileTargetLanguage(value ?? "pt-BR")}
            >
              <SelectTrigger className="h-10 bg-background/60 border-border/50 text-sm">
                <SelectValue placeholder="Select language" />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGE_OPTIONS.map((language) => (
                  <SelectItem key={language.value} value={language.value}>
                    {language.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] leading-5 text-muted-foreground/80">
              {t("language_hint")}
            </p>
          </div>

          <div className="space-y-3 rounded-lg border border-border/40 bg-background/40 p-3.5">
            <p className="text-[12px] font-medium uppercase text-muted-foreground" style={{ letterSpacing: "0.05em" }}>
              {t("price_currency_title")}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-[12px] text-muted-foreground">
                  {t("currency_label")}
                </Label>
                <Select
                  value={profileCurrencyCode}
                  onValueChange={(value) => setProfileCurrencyCode(value ?? "USD")}
                >
                  <SelectTrigger className="h-10 bg-background/60 border-border/50 text-sm">
                    <SelectValue placeholder="Select currency" />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCY_OPTIONS.map((currency) => (
                      <SelectItem key={currency.value} value={currency.value}>
                        {currency.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[12px] text-muted-foreground">
                  {t("rate_label")}
                </Label>
                <Input
                  value={profileCurrencyRate}
                  onChange={(e) => setProfileCurrencyRate(e.target.value)}
                  placeholder="Ex: 5.65"
                  inputMode="decimal"
                  className="h-10 bg-background/60 border-border/50 text-sm"
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-[12px] text-muted-foreground">
                  {t("markup_label")}
                </Label>
                <Input
                  value={profilePriceMarkupPercent}
                  onChange={(e) => setProfilePriceMarkupPercent(e.target.value)}
                  placeholder="Ex: 25"
                  inputMode="decimal"
                  className="h-10 bg-background/60 border-border/50 text-sm"
                />
              </div>

              <div className="space-y-1.5 rounded-md border border-border/40 bg-background/60 p-2.5">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={profileAutoConvertPrices}
                    onChange={(e) => setProfileAutoConvertPrices(e.target.checked)}
                    className="h-4 w-4 rounded border-border/70 bg-background"
                  />
                  <span className="text-foreground/90">
                    {t("auto_convert_label")}
                  </span>
                </label>
                <p className="text-[11px] text-muted-foreground/80">
                  {t("auto_convert_hint")}
                </p>
              </div>
            </div>
          </div>

          <Button
            onClick={handleSaveProfile}
            disabled={profileSaving}
            className="w-full h-10 text-sm font-medium transition-all duration-200"
            style={{
              background: profileSaving
                ? "color-mix(in oklch, var(--action) 30%, transparent)"
                : "var(--action)",
              color: "var(--action-foreground)",
            }}
          >
            {profileSaving ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                {logoUploading
                  ? t("uploading_logo")
                  : assetUploading
                    ? t("uploading_materials")
                    : t("saving")}
              </span>
            ) : (
              t("save_profile_btn")
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
