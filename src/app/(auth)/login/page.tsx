import type { Metadata } from "next";
import { headers } from "next/headers";
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
 * - ?plano=loja1|lojas3|ilimitado (o "Escolher plano" da landing) fica
 *   guardado no navegador, e a escolha de plano do app ja abre nele.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [chave: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const texto = (v: string | string[] | undefined) => (typeof v === "string" ? v : null);
  const site = origemDoSite((await headers()).get("host"));

  return (
    <FormularioAcesso
      modoInicial={modoInicial(texto(sp.mode), texto(sp.error))}
      destino={caminhoInternoSeguro(texto(sp.next)) || APP_HOME}
      erroDaUrl={texto(sp.error)}
      plano={texto(sp.plano)}
      termos={{ uso: `${site}/terms`, privacidade: `${site}/privacy` }}
    />
  );
}
