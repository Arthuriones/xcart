import { LogoXcart } from "@/components/layout/logo";
import { PainelProduto } from "./painel-produto";

/**
 * Casca de /login e /set-password: formulario a esquerda, o que o xcart faz a
 * direita (embaixo, resumido, no celular). Um painel so para as duas telas --
 * antes ele estava copiado nas duas. O /callback e rota, nao pagina: nao passa
 * por aqui.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh w-full bg-surface lg:grid-cols-2">
      <main className="flex flex-col px-4 py-8 sm:px-10 sm:py-12 lg:px-16">
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8">
          <LogoXcart altura={22} prioridade />
          {children}
        </div>
      </main>
      <PainelProduto />
    </div>
  );
}
