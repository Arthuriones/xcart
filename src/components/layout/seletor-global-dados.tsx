import { listarLojasDoUsuario, lerFiltroGlobal } from "@/lib/filtro-global";
import { SeletorGlobal } from "./seletor-global";

/**
 * Busca no servidor o que o seletor do topo precisa: as lojas do usuario e o
 * filtro gravado em cookie. So banco, nunca Shopify.
 *
 * Fica separado do layout pelo mesmo motivo de sidebar-data.tsx: o layout
 * renderiza isto dentro de <Suspense>, entao a tela nao espera a consulta das
 * lojas para aparecer.
 *
 * Erro aqui some (null) em vez de derrubar o layout: sem seletor, a pagina
 * continua usando o filtro do cookie -- e a propria pagina mostra o erro de
 * banco, se for o caso, porque le as mesmas lojas.
 */
export async function SeletorGlobalDados() {
  // O try cerca so a LEITURA: JSX dentro de try/catch nao pega erro de render
  // (react-hooks/error-boundaries), so daria a impressao de pegar.
  const dados = await Promise.all([listarLojasDoUsuario(), lerFiltroGlobal()]).catch(
    () => null
  );
  if (!dados) return null;
  const [lojas, filtro] = dados;
  return <SeletorGlobal lojas={lojas} filtro={filtro} />;
}
