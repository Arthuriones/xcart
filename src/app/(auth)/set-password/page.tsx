import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { FormularioSenha } from "./formulario-senha";

export const metadata: Metadata = { title: "Criar senha · xcart" };
export const dynamic = "force-dynamic";

/**
 * /set-password: criar ou trocar a senha depois de entrar pelo link do e-mail.
 *
 * So le a propria sessao (o middleware ja garante que ha alguem logado aqui):
 * - o e-mail, para a pessoa saber em que conta esta (e o gerenciador de senha
 *   guardar a senha no lugar certo);
 * - se a conta ja tem senha. Quem ja tem pode seguir sem trocar; quem nao tem
 *   e mandado de volta para ca pelo middleware, entao nao ve o "Agora não".
 */
export default async function SetPasswordPage() {
  let email: string | null = null;
  let temSenha = false;
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    email = data.user?.email ?? null;
    temSenha = data.user?.user_metadata?.has_password === true;
  } catch {
    // Sem a leitura, o formulario aparece igual, so sem o e-mail e sem "Agora não".
  }

  return <FormularioSenha email={email} temSenha={temSenha} />;
}
