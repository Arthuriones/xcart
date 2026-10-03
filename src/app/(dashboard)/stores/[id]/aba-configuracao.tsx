import { EmptyState } from "@/components/ui/empty-state";
import { lerMateriaisDaLoja, type LojaBase, type MaterialDaLoja } from "@/lib/leitura/resumo-lojas";
import { EditorMarca, EditorPerfil, ZonaDePerigo } from "./editor-loja";

/**
 * Configuracao: o editor que era o modal "Perfil da Loja", agora em blocos --
 * perfil (nome e idioma da IA), marca (logo e materiais para a geracao de
 * imagem) e a zona de perigo. As gravacoes sao as mesmas de antes
 * (PATCH /api/stores/[id] e /api/store-assets).
 */
export async function AbaConfiguracao({ base }: { base: LojaBase }) {
  let materiais: MaterialDaLoja[] | null = null;
  try {
    materiais = await lerMateriaisDaLoja(base.id);
  } catch (e) {
    console.error("[loja] materiais", e);
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <EditorPerfil
        loja={{ id: base.id, nome: base.nome, idioma: base.idioma, moeda: base.moeda }}
      />
      {materiais ? (
        <EditorMarca lojaId={base.id} logoPath={base.logoPath} materiais={materiais} />
      ) : (
        <EmptyState
          titulo="Não deu para carregar a logo e os materiais agora"
          descricao="Nada foi apagado. Recarregue a página em instantes."
        />
      )}
      <ZonaDePerigo loja={{ id: base.id, nome: base.nome, dominio: base.dominio }} />
    </div>
  );
}
