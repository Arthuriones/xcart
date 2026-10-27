import type { Metadata } from "next";
import { headers } from "next/headers";
import { buttonVariants } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { APP_HOME } from "@/lib/app-home";
import { caminhoInternoSeguro } from "@/lib/net/url-guard";
import { modoInicial, origemDoSite } from "../acesso";
import { FormularioAcesso } from "./formulario-acesso";

export const metadata: Metadata = { title: "Entrar · xcart" };

/**
 * /login: entrar com senha, criar conta e receber um link de acesso por e-mail.
 *
 * Parametros que continuam valendo:
 * - ?mode=signup (landing, "Começar agora") abre direto em "Criar conta";
 * - ?next=/caminho (middleware e /api/shopify/auth) devolve a pessoa ao fluxo
 *   interrompido -- so caminho interno, nunca URL absoluta (open redirect);
 * - ?error=link_invalido (o /callback, quando o link falha) vira o aviso de
 *   link expirado. Antes ninguem lia e a pessoa via o formulario em branco.
 * - ?plano=roteamento|completo|ilimitado_v2 (o "Escolher plano" da landing) fica
 *   guardado no navegador, e a escolha de plano do app ja abre nele.
 * - ?instavel=1 (o proxy, quando o login do Supabase nao respondeu ao renovar a
 *   sessao) avisa que a conta continua la, com o link de volta ao ?next=. O
 *   cookie nao foi apagado: quando o login volta, o link basta.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [chave: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const texto = (v: string | string[] | undefined) => (typeof v === "string" ? v : null);
  const site = origemDoSite((await headers()).get("host"));
  // "//" na frente e outro site: caminhoInternoSeguro normaliza os pontos, e
  // "/.//evil.com" sai dela "//evil.com" -- no "Tentar de novo" e no pos-login.
  const interno = caminhoInternoSeguro(texto(sp.next));
  const destino = interno && !interno.startsWith("//") ? interno : APP_HOME;

  const formulario = (
    <FormularioAcesso
      modoInicial={modoInicial(texto(sp.mode), texto(sp.error))}
      destino={destino}
      erroDaUrl={texto(sp.error)}
      plano={texto(sp.plano)}
      termos={{ uso: `${site}/terms`, privacidade: `${site}/privacy` }}
    />
  );
  if (texto(sp.instavel) !== "1") return formulario;

  // <a>, nao <Link>: o prefetch do Link bateria no proxy, que tentaria renovar
  // a sessao de novo em segundo plano.
  return (
    <div className="flex flex-col gap-6">
      <Callout
        tom="warn"
        role="alert"
        titulo="O login do xcart não respondeu agora."
        acao={
          <a href={destino} className={buttonVariants({ variant: "secondary", size: "sm" })}>
            Tentar de novo
          </a>
        }
      >
        <p>Sua conta e seus dados estão guardados; tente de novo em 1 minuto.</p>
      </Callout>
      {formulario}
    </div>
  );
}
