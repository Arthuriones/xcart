import { getStoresWithRoles, type StoreRow } from "@/lib/stores/queries";
import { StoresScreen } from "./stores-screen";

// A pagina roda no servidor: busca as lojas ao lado do banco e entrega o HTML
// pronto. O que precisa de clique continua no cliente, dentro de StoresScreen.
export default async function StoresPage() {
  // Falha de banco NAO pode virar "nenhuma loja conectada". Ja aconteceu: uma
  // coluna que faltava derrubava a consulta inteira e a tela dizia que a conta
  // estava vazia para quem tinha nove lojas. O try envolve so a busca -- JSX
  // dentro de try/catch nao pegaria erro de renderizacao mesmo.
  let lojas: StoreRow[] = [];
  let falha: string | null = null;
  try {
    lojas = await getStoresWithRoles();
  } catch (erro) {
    console.error("[stores] falha ao listar", erro);
    falha = erro instanceof Error ? erro.message : String(erro);
  }

  if (falha) {
    return (
      <div
        className="rounded-lg border px-6 py-8"
        style={{ borderColor: "var(--err-border)", background: "var(--err-bg)" }}
      >
        <p className="text-[15px] font-semibold text-ink">
          Não consegui carregar suas lojas
        </p>
        <p className="mt-1.5 max-w-[520px] text-[12.5px] text-t2">
          O banco recusou a consulta. Suas lojas continuam conectadas — é a leitura
          que falhou. Recarregue a página; se continuar, o detalhe está abaixo.
        </p>
        <p className="mt-2 font-mono text-[11px] text-t3">{falha}</p>
      </div>
    );
  }

  return <StoresScreen initialStores={lojas} />;
}
