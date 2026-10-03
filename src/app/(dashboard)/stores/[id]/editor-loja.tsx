"use client";

import * as React from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ImageIcon, UploadIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Section } from "@/components/ui/section";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/components/ui/cn";
import { getAssetUrl, getLogoUrl } from "@/lib/store-assets-url";
import { nomeIdioma } from "@/lib/leitura/lojas-estado";
import type { MaterialDaLoja } from "@/lib/leitura/resumo-lojas";
import { RemoverLoja } from "../remover-loja";

/**
 * Os idiomas da IA. Batem com SUPORTADOS de src/lib/stores/idioma-da-loja.ts:
 * e o que a deteccao automatica grava ao conectar. Valor fora da lista (loja
 * antiga) entra como opcao extra, em vez de aparecer em branco.
 */
const IDIOMAS = [
  { valor: "pt-BR", rotulo: "Português (Brasil)" },
  { valor: "en-US", rotulo: "Inglês (Estados Unidos)" },
  { valor: "es-ES", rotulo: "Espanhol" },
  { valor: "fr-FR", rotulo: "Francês" },
  { valor: "de-DE", rotulo: "Alemão" },
  { valor: "it-IT", rotulo: "Italiano" },
  { valor: "ja-JP", rotulo: "Japonês" },
];

const TIPOS_LOGO = ["image/png", "image/svg+xml", "image/webp", "image/jpeg"];
const TIPOS_MATERIAL = ["image/png", "image/webp", "image/jpeg", "image/jpg"];
const MB = 1024 * 1024;

// ---------------------------------------------------------------------------
// Perfil
// ---------------------------------------------------------------------------

export function EditorPerfil({
  loja,
}: {
  loja: { id: string; nome: string; idioma: string | null; moeda: string | null };
}) {
  const router = useRouter();
  const idiomaSalvo = loja.idioma || "pt-BR";
  const [nome, setNome] = React.useState(loja.nome);
  const [idioma, setIdioma] = React.useState(idiomaSalvo);
  const [salvando, setSalvando] = React.useState(false);

  const opcoes = IDIOMAS.some((i) => i.valor === idiomaSalvo)
    ? IDIOMAS
    : [{ valor: idiomaSalvo, rotulo: `${nomeIdioma(idiomaSalvo) ?? idiomaSalvo} (${idiomaSalvo})` }, ...IDIOMAS];
  const rotuloDe = (v: string | null) => opcoes.find((o) => o.valor === v)?.rotulo ?? v ?? "";

  const nomeInvalido = nome.trim().length === 0;
  const mudou = nome.trim() !== loja.nome || idioma !== idiomaSalvo;

  async function salvar() {
    if (nomeInvalido || !mudou) return;
    setSalvando(true);
    try {
      const res = await fetch(`/api/stores/${encodeURIComponent(loja.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nome.trim(), target_language: idioma }),
      });
      if (!res.ok || res.redirected) throw new Error(String(res.status));
      toast.success("Perfil salvo", { description: "O nome novo já aparece no menu e nos alertas." });
      router.refresh();
    } catch {
      toast.error("Não deu para salvar o perfil agora", { description: "Nada mudou. Tente de novo." });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Section titulo="Perfil" descricao="Como a loja aparece no xcart e em que idioma a IA escreve.">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void salvar();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="perfil-nome">Nome da loja</Label>
          <Input
            id="perfil-nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            aria-invalid={nomeInvalido || undefined}
            aria-describedby="perfil-nome-ajuda"
          />
          <p id="perfil-nome-ajuda" className={cn("text-label", nomeInvalido ? "text-err" : "text-t2")}>
            {nomeInvalido
              ? "Escreva um nome para a loja."
              : "Aparece nos menus e nos alertas. Não muda o nome na Shopify."}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="perfil-idioma">Idioma principal da IA</Label>
          <Select value={idioma} onValueChange={(v) => setIdioma(v ?? idiomaSalvo)}>
            <SelectTrigger id="perfil-idioma" aria-describedby="perfil-idioma-ajuda">
              <SelectValue>{(v: string | null) => rotuloDe(v)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {opcoes.map((o) => (
                <SelectItem key={o.valor} value={o.valor}>
                  {o.rotulo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p id="perfil-idioma-ajuda" className="text-label text-t2">
            Lido da própria loja quando ela é conectada. É nele que a IA escreve título, descrição e páginas;
            mude só se estiver errado.
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-label text-t2">Moeda (vem da Shopify)</span>
          <span className="text-body text-ink">{loja.moeda ?? "—"}</span>
        </div>

        <div className="flex justify-end gap-2 border-t border-border-subtle pt-4">
          <Button
            type="button"
            variant="secondary"
            disabled={!mudou || salvando}
            onClick={() => {
              setNome(loja.nome);
              setIdioma(idiomaSalvo);
            }}
          >
            Descartar
          </Button>
          <Button type="submit" pending={salvando} disabled={!mudou || nomeInvalido}>
            Salvar perfil
          </Button>
        </div>
      </form>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Marca (logo e materiais para a geracao de imagem)
// ---------------------------------------------------------------------------

/** Envia um arquivo pelo endpoint de sempre e devolve o caminho gravado. */
async function enviarArquivo(lojaId: string, arquivo: File, bucket: string, rotulo?: string): Promise<string> {
  const form = new FormData();
  form.append("storeId", lojaId);
  form.append("bucket", bucket);
  form.append("file", arquivo);
  if (rotulo) form.append("label", rotulo);
  const res = await fetch("/api/store-assets", { method: "POST", body: form });
  if (!res.ok || res.redirected) throw new Error(String(res.status));
  const dados = (await res.json()) as { path: string };
  return dados.path;
}

function ehLogo(m: MaterialDaLoja) {
  return (m.label || "").toLowerCase().startsWith("logo");
}

export function EditorMarca({
  lojaId,
  logoPath,
  materiais,
}: {
  lojaId: string;
  logoPath: string | null;
  materiais: MaterialDaLoja[];
}) {
  const router = useRouter();
  const [logoNovo, setLogoNovo] = React.useState<File | null>(null);
  const [logosNovos, setLogosNovos] = React.useState<File[]>([]);
  const [materiaisNovos, setMateriaisNovos] = React.useState<File[]>([]);
  const [etapa, setEtapa] = React.useState<string | null>(null);
  const [removidos, setRemovidos] = React.useState<Set<string>>(() => new Set());
  const [confirmar, setConfirmar] = React.useState<MaterialDaLoja | null>(null);
  const refLogo = React.useRef<HTMLInputElement>(null);
  const refLogos = React.useRef<HTMLInputElement>(null);
  const refMateriais = React.useRef<HTMLInputElement>(null);

  const vivos = materiais.filter((m) => !removidos.has(m.id));
  const logosSalvos = vivos.filter(ehLogo);
  const materiaisSalvos = vivos.filter((m) => !ehLogo(m));
  const pendentes = (logoNovo ? 1 : 0) + logosNovos.length + materiaisNovos.length;
  const enviando = etapa !== null;

  function escolherLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!TIPOS_LOGO.includes(f.type)) return void toast.error("A logo precisa ser PNG, SVG, WEBP ou JPG.");
    if (f.size > 2 * MB) return void toast.error("A logo passa de 2 MB. Diminua e tente de novo.");
    setLogoNovo(f);
  }

  function escolherVarios(
    e: React.ChangeEvent<HTMLInputElement>,
    tipos: string[],
    maxMb: number,
    limite: number,
    setar: React.Dispatch<React.SetStateAction<File[]>>
  ) {
    const arquivos = Array.from(e.target.files || []);
    e.target.value = "";
    const validos: File[] = [];
    for (const f of arquivos) {
      if (!tipos.includes(f.type)) {
        toast.error(`${f.name}: formato não aceito.`);
        continue;
      }
      if (f.size > maxMb * MB) {
        toast.error(`${f.name}: passa de ${maxMb} MB.`);
        continue;
      }
      validos.push(f);
    }
    if (validos.length === 0) return;
    setar((atual) => {
      const junto = [...atual, ...validos];
      if (junto.length > limite) toast.error(`Até ${limite} arquivos por envio. Os demais ficaram de fora.`);
      return junto.slice(0, limite);
    });
  }

  async function enviar() {
    if (pendentes === 0 || enviando) return;
    try {
      let caminhoLogo: string | null = null;
      if (logoNovo) {
        setEtapa("Enviando a logo…");
        caminhoLogo = await enviarArquivo(lojaId, logoNovo, "store-logos");
        const res = await fetch(`/api/stores/${encodeURIComponent(lojaId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ logo_path: caminhoLogo }),
        });
        if (!res.ok || res.redirected) throw new Error(String(res.status));
        setLogoNovo(null);
      }
      // Cada arquivo sai da fila assim que sobe: se o envio parar no meio,
      // tentar de novo nao duplica o que ja foi.
      for (const [i, f] of logosNovos.entries()) {
        setEtapa(`Enviando logos (${i + 1} de ${logosNovos.length})…`);
        await enviarArquivo(lojaId, f, "store-assets", `logo:${f.name}`);
        setLogosNovos((l) => l.filter((x) => x !== f));
      }
      for (const [i, f] of materiaisNovos.entries()) {
        setEtapa(`Enviando materiais (${i + 1} de ${materiaisNovos.length})…`);
        await enviarArquivo(lojaId, f, "store-assets", f.name);
        setMateriaisNovos((l) => l.filter((x) => x !== f));
      }
      toast.success("Marca atualizada", { description: "A IA já usa a logo e os materiais novos." });
    } catch {
      toast.error("Parte dos arquivos não subiu", {
        description: "O que subiu ficou salvo; o resto continua na fila para tentar de novo.",
      });
    } finally {
      setEtapa(null);
      router.refresh();
    }
  }

  async function removerMaterial(m: MaterialDaLoja) {
    const res = await fetch(
      `/api/store-assets?id=${encodeURIComponent(m.id)}&filePath=${encodeURIComponent(m.file_path)}`,
      { method: "DELETE" }
    );
    if (!res.ok || res.redirected) throw new Error(String(res.status));
    setRemovidos((s) => new Set(s).add(m.id));
    toast.success("Material removido");
    router.refresh();
  }

  return (
    <Section
      titulo="Marca"
      descricao="Logo e referências visuais. Opcional: só a geração de imagem com IA usa."
    >
      <div className="flex flex-col gap-5">
        {/* Logo principal */}
        <div className="flex flex-col gap-2">
          <h3 className="text-dense font-semibold text-ink">Logo principal</h3>
          <div className="flex flex-wrap items-center gap-4">
            <div className="relative grid size-24 shrink-0 place-items-center overflow-hidden rounded-card border border-dashed border-control-border bg-surface-2">
              {logoNovo ? (
                <PreviaArquivo arquivo={logoNovo} alt="Logo nova, ainda não enviada" contain />
              ) : logoPath ? (
                <Image src={getLogoUrl(logoPath)} alt="Logo atual da loja" fill sizes="96px" className="object-contain p-2" unoptimized />
              ) : (
                <ImageIcon aria-hidden className="size-6 text-t4" />
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={() => refLogo.current?.click()} disabled={enviando}>
                  <UploadIcon aria-hidden />
                  {logoPath || logoNovo ? "Trocar logo" : "Escolher logo"}
                </Button>
                {logoNovo ? (
                  <Button variant="ghost" size="sm" onClick={() => setLogoNovo(null)} disabled={enviando}>
                    Desfazer
                  </Button>
                ) : null}
              </div>
              <p className="text-label text-t2">PNG, SVG, WEBP ou JPG até 2 MB.</p>
            </div>
            <input ref={refLogo} type="file" accept={TIPOS_LOGO.join(",")} onChange={escolherLogo} className="hidden" />
          </div>
        </div>

        <GradeArquivos
          titulo="Logos adicionais"
          ajuda="Versões alternativas da logo. Até 5 por envio, 2 MB cada."
          salvos={logosSalvos}
          novos={logosNovos}
          tirarNovo={(f) => setLogosNovos((l) => l.filter((x) => x !== f))}
          pedirRemocao={setConfirmar}
          adicionar={() => refLogos.current?.click()}
          rotuloAdicionar="Adicionar logos"
          desabilitado={enviando}
        />
        <input
          ref={refLogos}
          type="file"
          multiple
          accept={TIPOS_LOGO.join(",")}
          onChange={(e) => escolherVarios(e, TIPOS_LOGO, 2, 5, setLogosNovos)}
          className="hidden"
        />

        <GradeArquivos
          titulo="Materiais de marca"
          ajuda="Banners e referências que a IA usa para recriar as fotos. Até 12 imagens por envio, 6 MB cada."
          salvos={materiaisSalvos}
          novos={materiaisNovos}
          tirarNovo={(f) => setMateriaisNovos((l) => l.filter((x) => x !== f))}
          pedirRemocao={setConfirmar}
          adicionar={() => refMateriais.current?.click()}
          rotuloAdicionar="Adicionar imagens"
          desabilitado={enviando}
        />
        <input
          ref={refMateriais}
          type="file"
          multiple
          accept={TIPOS_MATERIAL.join(",")}
          onChange={(e) => escolherVarios(e, TIPOS_MATERIAL, 6, 12, setMateriaisNovos)}
          className="hidden"
        />

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border-subtle pt-4">
          <span className="text-label text-t2" aria-live="polite">
            {etapa ?? (pendentes > 0 ? `${pendentes} ${pendentes === 1 ? "arquivo novo" : "arquivos novos"} para enviar` : "")}
          </span>
          <Button onClick={() => void enviar()} pending={enviando} disabled={pendentes === 0}>
            {pendentes > 0 ? `Enviar ${pendentes} ${pendentes === 1 ? "arquivo" : "arquivos"}` : "Enviar arquivos"}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmar !== null}
        onOpenChange={(v) => !v && setConfirmar(null)}
        titulo="Remover esta imagem?"
        descricao="Ela sai das referências da IA e do armazenamento. Não tem como desfazer."
        confirmar="Remover imagem"
        mensagemErro="Não deu para remover agora. Nada foi apagado; tente de novo."
        onConfirmar={() => (confirmar ? removerMaterial(confirmar) : undefined)}
      />
    </Section>
  );
}

function GradeArquivos({
  titulo,
  ajuda,
  salvos,
  novos,
  tirarNovo,
  pedirRemocao,
  adicionar,
  rotuloAdicionar,
  desabilitado,
}: {
  titulo: string;
  ajuda: string;
  salvos: MaterialDaLoja[];
  novos: File[];
  tirarNovo: (f: File) => void;
  pedirRemocao: (m: MaterialDaLoja) => void;
  adicionar: () => void;
  rotuloAdicionar: string;
  desabilitado: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-dense font-semibold text-ink">
        {titulo}{" "}
        <span className="font-normal text-t2">
          · {salvos.length === 0 ? "vazio" : `${salvos.length} no xcart`}
        </span>
      </h3>
      <p className="text-label text-t2">{ajuda}</p>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-3">
        {salvos.map((m) => {
          const nome = (m.label || "Imagem").replace(/^logo:?/i, "").trim() || "Imagem";
          return (
            <li key={m.id} className="flex flex-col gap-1.5">
              <div className="relative aspect-square overflow-hidden rounded-control border border-border bg-surface-2">
                <Image src={getAssetUrl(m.file_path)} alt={nome} fill sizes="112px" className="object-cover" unoptimized />
              </div>
              <span className="truncate text-label text-t2" title={nome}>
                {nome}
              </span>
              <Button variant="secondary" size="sm" onClick={() => pedirRemocao(m)} disabled={desabilitado}>
                Remover<span className="sr-only"> {nome}</span>
              </Button>
            </li>
          );
        })}
        {novos.map((f, i) => (
          <li key={`${f.name}-${i}`} className="flex flex-col gap-1.5">
            <div className="relative aspect-square overflow-hidden rounded-control border border-dashed border-focus bg-surface-2">
              <PreviaArquivo arquivo={f} alt={`${f.name}, ainda não enviada`} />
              <span className="absolute top-1 left-1 rounded-sm bg-solid px-1.5 text-label text-on-solid">Nova</span>
            </div>
            <span className="truncate text-label text-t2" title={f.name}>
              {f.name}
            </span>
            <Button variant="ghost" size="sm" onClick={() => tirarNovo(f)} disabled={desabilitado}>
              Tirar<span className="sr-only"> {f.name}</span>
            </Button>
          </li>
        ))}
        <li>
          <button
            type="button"
            onClick={adicionar}
            disabled={desabilitado}
            className="grid aspect-square w-full place-items-center rounded-control border border-dashed border-control-border text-dense text-t1 transition-colors hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:text-t3"
          >
            <span className="flex flex-col items-center gap-1.5 px-2 text-center">
              <UploadIcon aria-hidden className="size-4" />
              {rotuloAdicionar}
            </span>
          </button>
        </li>
      </ul>
    </div>
  );
}

/** Pre-visualizacao de um arquivo ainda nao enviado, lida no navegador. */
function PreviaArquivo({ arquivo, alt, contain }: { arquivo: File; alt: string; contain?: boolean }) {
  const [url, setUrl] = React.useState<string | null>(null);
  React.useEffect(() => {
    let vivo = true;
    const leitor = new FileReader();
    leitor.onload = () => {
      if (vivo) setUrl(String(leitor.result));
    };
    leitor.readAsDataURL(arquivo);
    return () => {
      vivo = false;
      leitor.abort();
    };
  }, [arquivo]);
  if (!url) return null;
  return (
    <Image
      src={url}
      alt={alt}
      fill
      sizes="112px"
      className={contain ? "object-contain p-2" : "object-cover"}
      unoptimized
    />
  );
}

// ---------------------------------------------------------------------------
// Zona de perigo
// ---------------------------------------------------------------------------

export function ZonaDePerigo({ loja }: { loja: { id: string; nome: string; dominio: string } }) {
  const router = useRouter();
  const [aberto, setAberto] = React.useState(false);
  return (
    <Section titulo="Zona de perigo" className="border-err-border">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="max-w-[52ch] text-dense text-t1 text-pretty">
          Remover {loja.nome} do xcart apaga os produtos importados, os materiais de marca, as rotas, o
          rastreamento e o histórico de pedidos desta loja. Nada muda na Shopify.
        </p>
        <Button variant="destructive" onClick={() => setAberto(true)}>
          Remover do xcart…
        </Button>
      </div>
      <RemoverLoja
        loja={loja}
        aberto={aberto}
        aoMudar={setAberto}
        aoRemover={() => {
          router.push("/stores");
          router.refresh();
        }}
      />
    </Section>
  );
}
