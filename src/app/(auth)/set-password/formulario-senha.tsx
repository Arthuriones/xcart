"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckIcon } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { APP_HOME } from "@/lib/app-home";
import { createClient } from "@/lib/supabase/client";
import { erroDeAcesso, validarSenhaNova, type ErroDeAcesso, type ErrosSenhaNova } from "../acesso";
import { AvisoDeErro, CampoSenha } from "../campos";

// ============================================================================
// Criar ou trocar a senha. A chamada e a de sempre (updateUser com a senha e
// has_password) e, depois de salvar, vai para a home do app.
// ============================================================================

const ALTO = "h-ctl-lg sm:h-ctl-md";

export function FormularioSenha({ email, temSenha }: { email: string | null; temSenha: boolean }) {
  const router = useRouter();
  const [senha, setSenha] = React.useState("");
  const [repetida, setRepetida] = React.useState("");
  const [erros, setErros] = React.useState<ErrosSenhaNova>({});
  const [erro, setErro] = React.useState<ErroDeAcesso | null>(null);
  const [salvando, setSalvando] = React.useState(false);
  const [saindo, setSaindo] = React.useState(false);

  const iguais = repetida.length > 0 && senha === repetida;

  async function salvar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (salvando) return;

    const problemas = validarSenhaNova(senha, repetida);
    setErros(problemas);
    if (problemas.senha || problemas.repetida) {
      document.getElementById(problemas.senha ? "senha-nova" : "senha-repetida")?.focus();
      return;
    }

    setErro(null);
    setSalvando(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({
        password: senha,
        data: { has_password: true },
      });
      if (error) throw error;
      // Fica pendente ate o app abrir: sem clique duplo no meio do caminho.
      router.push(APP_HOME);
    } catch (e) {
      setErro(erroDeAcesso(e));
      setSalvando(false);
    }
  }

  async function sair() {
    setSaindo(true);
    // Rota de API: o cookie e limpo no servidor (ver src/app/api/auth/logout).
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    window.location.assign("/login");
  }

  return (
    <section aria-labelledby="senha-titulo" className="flex flex-col gap-6">
      <header className="flex flex-col gap-1.5">
        <h1 id="senha-titulo" className="text-page text-ink">
          {temSenha ? "Criar uma senha nova" : "Crie sua senha"}
        </h1>
        <p className="text-dense text-t2">
          {temSenha
            ? "Você entrou pelo link do e-mail. Troque a senha agora ou siga com a atual."
            : "Você entrou pelo link do e-mail. Com uma senha, as próximas entradas não dependem dele."}
        </p>
        {email ? (
          <p className="mt-1.5 text-dense text-t1">
            Conta: <span className="font-medium break-all text-ink">{email}</span>
          </p>
        ) : null}
      </header>

      <form noValidate onSubmit={salvar} className="flex flex-col gap-4">
        {/* Para o gerenciador de senha saber de qual conta e a senha nova. */}
        {email ? <input type="email" name="username" autoComplete="username" value={email} readOnly hidden /> : null}

        <CampoSenha
          id="senha-nova"
          rotulo="Nova senha"
          valor={senha}
          aoMudar={(v) => {
            setSenha(v);
            if (erros.senha) setErros((x) => ({ ...x, senha: undefined }));
          }}
          autoComplete="new-password"
          nova
          autoFocus
          erro={erros.senha}
        />

        <CampoSenha
          id="senha-repetida"
          rotulo="Repita a senha"
          valor={repetida}
          aoMudar={(v) => {
            setRepetida(v);
            if (erros.repetida) setErros((x) => ({ ...x, repetida: undefined }));
          }}
          autoComplete="new-password"
          erro={erros.repetida}
          rodape={
            iguais && !erros.repetida ? (
              <p className="flex items-center gap-1.5 text-label text-ok">
                <CheckIcon aria-hidden className="size-3.5" strokeWidth={2} />
                As duas senhas são iguais
              </p>
            ) : null
          }
        />

        {erro ? (
          <AvisoDeErro
            titulo={erro.titulo ?? "A senha não foi salva"}
            texto={erro.texto}
            detalhe={erro.detalhe}
            acao={
              erro.sessaoExpirada ? (
                <Link href="/login?mode=link" className={buttonVariants({ variant: "secondary", size: "sm" })}>
                  Pedir novo link
                </Link>
              ) : undefined
            }
          />
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="submit" pending={salvando} className={cn(ALTO, "w-full sm:w-auto sm:min-w-36")}>
            Salvar senha
          </Button>
          {temSenha ? (
            <Link
              href={APP_HOME}
              className={cn(buttonVariants({ variant: "ghost" }), ALTO, "w-full sm:w-auto")}
            >
              Agora não
            </Link>
          ) : null}
        </div>
      </form>

      <p className="text-dense text-t2">
        Não é a sua conta?{" "}
        <Button variant="link" pending={saindo} onClick={() => void sair()}>
          Sair
        </Button>
      </p>
    </section>
  );
}
