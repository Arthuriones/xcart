"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { MailCheckIcon, MailIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { cn } from "@/components/ui/cn";
import { createClient } from "@/lib/supabase/client";
import {
  BOTAO,
  SUBTITULO,
  TITULO,
  TITULO_ERRO,
  avisoDoLink,
  erroDeAcesso,
  pedeLink,
  validarAcesso,
  type ErroDeAcesso,
  type ErrosDeCampo,
  type Modo,
} from "../acesso";
import { AvisoDeErro, Campo, CampoSenha } from "../campos";

// ============================================================================
// Entrar, criar conta e pedir link por e-mail: um formulario, quatro modos.
// As chamadas ao Supabase sao as de sempre:
// - entrar: signInWithPassword;
// - criar: signUp com has_password (e, novo, o nome em full_name, que o menu
//   ja le para mostrar quem esta logado);
// - link e esqueci a senha: resetPasswordForEmail com volta em
//   /callback?type=recovery. O link entra na conta e abre /set-password --
//   por isso os dois modos mandam o mesmo link.
// ============================================================================

const ALTO = "h-ctl-lg sm:h-ctl-md";
const LINK = "font-medium text-brand underline underline-offset-2 hover:text-ink";

// O que vem depois do # o servidor nao ve: le no navegador, como fonte externa
// (no servidor e na hidratacao vale "", sem divergencia).
function assinarHash(avisar: () => void) {
  window.addEventListener("hashchange", avisar);
  return () => window.removeEventListener("hashchange", avisar);
}
const lerHash = () => window.location.hash;
const semHash = () => "";

const agoraMs = () => Date.now();

/** Contagem regressiva do limite de tentativas: o botao mostra os segundos. */
function useEspera() {
  const [ate, setAte] = React.useState(0);
  const [agora, setAgora] = React.useState(0);

  React.useEffect(() => {
    if (!ate) return;
    const id = window.setInterval(() => {
      const t = agoraMs();
      setAgora(t);
      if (t >= ate) window.clearInterval(id);
    }, 250);
    return () => window.clearInterval(id);
  }, [ate]);

  const iniciar = React.useCallback((segundos: number) => {
    const t = agoraMs();
    setAgora(t);
    setAte(t + segundos * 1000);
  }, []);

  return { segundos: ate ? Math.max(0, Math.ceil((ate - agora) / 1000)) : 0, iniciar };
}

type Enviado = null | "confirmar" | "link";

export function FormularioAcesso({
  modoInicial,
  destino,
  erroDaUrl,
  termos,
}: {
  modoInicial: Modo;
  /** Caminho interno ja validado (?next= ou a home do app). */
  destino: string;
  /** ?error= da URL (o /callback manda "link_invalido"). */
  erroDaUrl: string | null;
  termos: { uso: string; privacidade: string };
}) {
  const router = useRouter();
  const [modo, setModo] = React.useState<Modo>(modoInicial);
  const [nome, setNome] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [senha, setSenha] = React.useState("");
  const [errosCampo, setErrosCampo] = React.useState<ErrosDeCampo>({});
  const [erro, setErro] = React.useState<ErroDeAcesso | null>(null);
  const [enviando, setEnviando] = React.useState(false);
  // Entrou: o botao segue pendente ate o app abrir (sem clique duplo).
  const [indo, setIndo] = React.useState(false);
  const [enviado, setEnviado] = React.useState<Enviado>(null);
  const [reenviado, setReenviado] = React.useState(false);
  const [avisoFechado, setAvisoFechado] = React.useState(false);
  const hash = React.useSyncExternalStore(assinarHash, lerHash, semHash);
  const espera = useEspera();
  const titulo = React.useRef<HTMLHeadingElement>(null);

  const aviso = avisoFechado ? null : avisoDoLink(erroDaUrl, hash);
  // O erro do limite de tentativas sai sozinho quando a contagem acaba.
  const erroVisivel = erro && !(erro.esperarSegundos && espera.segundos === 0) ? erro : null;
  const esperando = espera.segundos > 0;

  // Troca de modo ou de estado: o foco vai para o titulo novo (o leitor de
  // tela anuncia onde a pessoa esta; o Tab segue dali).
  const primeiraVez = React.useRef(true);
  React.useEffect(() => {
    if (primeiraVez.current) {
      primeiraVez.current = false;
      return;
    }
    titulo.current?.focus();
  }, [modo, enviado]);

  function fecharAviso() {
    if (avisoFechado) return;
    setAvisoFechado(true);
    // Tira ?error= e o trecho depois do # do endereco: recarregar nao repete.
    const url = new URL(window.location.href);
    url.searchParams.delete("error");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }

  function trocarModo(m: Modo) {
    setModo(m);
    setErro(null);
    setErrosCampo({});
    setEnviado(null);
    setReenviado(false);
    fecharAviso();
  }

  function limparCampo(campo: keyof ErrosDeCampo) {
    if (errosCampo[campo]) setErrosCampo((e) => ({ ...e, [campo]: undefined }));
  }

  function mostrarErro(e: unknown) {
    const r = erroDeAcesso(e);
    if (r.esperarSegundos) espera.iniciar(r.esperarSegundos);
    // E-mail que ja tem conta: o formulario vira "Entrar", com o aviso.
    if (r.irParaEntrar) setModo("entrar");
    setErro(r);
  }

  async function pedirLink(reenvio: boolean) {
    setErro(null);
    setEnviando(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/callback?type=recovery`,
      });
      if (error) throw error;
      setEnviado("link");
      setReenviado(reenvio);
    } catch (e) {
      mostrarErro(e);
    } finally {
      setEnviando(false);
    }
  }

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (enviando || indo || esperando) return;

    // Todos os problemas de uma vez, cada um no seu campo.
    const problemas = validarAcesso(modo, { nome, email, senha });
    setErrosCampo(problemas);
    const primeiro = (["nome", "email", "senha"] as const).find((k) => problemas[k]);
    if (primeiro) {
      document.getElementById(`acesso-${primeiro}`)?.focus();
      return;
    }

    fecharAviso();
    if (pedeLink(modo)) {
      await pedirLink(false);
      return;
    }

    setErro(null);
    setEnviando(true);
    try {
      const supabase = createClient();
      if (modo === "criar") {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password: senha,
          options: { data: { has_password: true, full_name: nome.trim() } },
        });
        if (error) throw error;
        // Com "Confirm email" ligado, o signUp volta sem erro e sem sessao:
        // a conta so vale depois do link. Sem este estado o cadastro parecia
        // nao funcionar (o middleware devolvia para o login sem explicacao).
        if (!data.session) {
          setEnviado("confirmar");
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha });
        if (error) throw error;
      }
      setIndo(true);
      router.push(destino);
    } catch (e) {
      mostrarErro(e);
    } finally {
      setEnviando(false);
    }
  }

  const erroNaTela = erroVisivel ? (
    <AvisoDeErro
      titulo={erroVisivel.titulo ?? TITULO_ERRO[modo]}
      texto={erroVisivel.texto}
      detalhe={erroVisivel.detalhe}
    />
  ) : null;

  // ---------------------------------------------------------------------------
  // "Confirme seu e-mail" e "Link enviado"
  // ---------------------------------------------------------------------------
  if (enviado) {
    const confirmar = enviado === "confirmar";
    return (
      <section aria-labelledby="acesso-titulo" className="flex flex-col gap-6">
        <span
          aria-hidden
          className="grid size-10 place-items-center rounded-card border border-ok-border bg-ok-bg text-ok"
        >
          <MailCheckIcon className="size-5" strokeWidth={1.75} />
        </span>
        <header className="flex flex-col gap-1.5">
          <h1 id="acesso-titulo" ref={titulo} tabIndex={-1} className="text-page text-ink">
            {confirmar ? "Confirme seu e-mail" : "Link enviado"}
          </h1>
          <p className="text-dense text-t1">
            {confirmar ? "Mandamos um link para " : "Se houver uma conta com "}
            <strong className="font-medium break-all text-ink">{email.trim()}</strong>
            {confirmar ? ". Abra o link para ativar a conta." : ", o link chega em instantes."}
          </p>
          <p className="text-dense text-t2">
            {confirmar
              ? "Não chegou em alguns minutos? Confira o spam e a aba Promoções."
              : "Abra neste mesmo navegador: o link vale uma vez e por pouco tempo. Não chegou? Confira o spam."}
          </p>
        </header>

        {erroNaTela}

        <div className="flex flex-col gap-2 sm:flex-row">
          {confirmar ? (
            <>
              <Button variant="secondary" className={ALTO} onClick={() => trocarModo("entrar")}>
                Voltar para entrar
              </Button>
              <Button variant="ghost" className={ALTO} onClick={() => setEnviado(null)}>
                Usar outro e-mail
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="secondary"
                className={cn(ALTO, "sm:min-w-36")}
                pending={enviando}
                disabled={esperando}
                onClick={() => void pedirLink(true)}
              >
                {esperando ? `Aguarde ${espera.segundos} s` : "Enviar de novo"}
              </Button>
              <Button variant="ghost" className={ALTO} onClick={() => trocarModo("entrar")}>
                Entrar com senha
              </Button>
            </>
          )}
        </div>
        <p className="text-label text-t2" aria-live="polite">
          {reenviado && !enviando ? "Enviamos o link de novo." : ""}
        </p>
      </section>
    );
  }

  // ---------------------------------------------------------------------------
  // Formulario
  // ---------------------------------------------------------------------------
  return (
    <section aria-labelledby="acesso-titulo" className="flex flex-col gap-6">
      {aviso ? (
        <Callout
          tom="warn"
          role="alert"
          titulo={aviso.titulo}
          dispensar={
            <Button size="icon-sm" variant="ghost" aria-label="Fechar aviso" onClick={fecharAviso}>
              <XIcon aria-hidden />
            </Button>
          }
        >
          <p>{aviso.texto}</p>
          {/* Embaixo do texto, nao ao lado: a coluna do formulario e estreita. */}
          {pedeLink(modo) ? null : (
            <Button size="sm" variant="secondary" className="mt-2" onClick={() => trocarModo("link")}>
              Pedir outro link
            </Button>
          )}
        </Callout>
      ) : null}

      <header className="flex flex-col gap-1.5">
        <h1 id="acesso-titulo" ref={titulo} tabIndex={-1} className="text-page text-ink">
          {TITULO[modo]}
        </h1>
        <p className="text-dense text-t2">{SUBTITULO[modo]}</p>
      </header>

      <form noValidate onSubmit={enviar} className="flex flex-col gap-4">
        {modo === "criar" ? (
          <Campo
            id="acesso-nome"
            rotulo="Nome"
            value={nome}
            onChange={(e) => {
              setNome(e.target.value);
              limparCampo("nome");
            }}
            autoComplete="name"
            erro={errosCampo.nome}
          />
        ) : null}

        <Campo
          id="acesso-email"
          rotulo="E-mail"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="voce@empresa.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            limparCampo("email");
          }}
          erro={errosCampo.email}
        />

        {pedeLink(modo) ? null : (
          <CampoSenha
            // Trocar entre entrar e criar remonta o campo: a senha volta oculta.
            key={modo}
            id="acesso-senha"
            rotulo="Senha"
            valor={senha}
            aoMudar={(v) => {
              setSenha(v);
              limparCampo("senha");
            }}
            autoComplete={modo === "criar" ? "new-password" : "current-password"}
            nova={modo === "criar"}
            erro={errosCampo.senha}
            acessorio={
              modo === "entrar" ? (
                <Button type="button" variant="link" className="text-label" onClick={() => trocarModo("esqueci")}>
                  Esqueci a senha
                </Button>
              ) : undefined
            }
          />
        )}

        {erroNaTela}

        {modo === "criar" ? (
          <p className="text-label text-t2">
            Ao criar a conta, você aceita os{" "}
            <a href={termos.uso} target="_blank" rel="noopener noreferrer" className={LINK}>
              Termos de uso<span className="sr-only"> (abre em outra aba)</span>
            </a>{" "}
            e a{" "}
            <a href={termos.privacidade} target="_blank" rel="noopener noreferrer" className={LINK}>
              Política de privacidade<span className="sr-only"> (abre em outra aba)</span>
            </a>
            .
          </p>
        ) : null}

        <Button type="submit" pending={enviando || indo} disabled={esperando} className={cn(ALTO, "w-full")}>
          {esperando ? `Aguarde ${espera.segundos} s` : BOTAO[modo]}
        </Button>
      </form>

      {modo === "entrar" ? (
        <>
          <div aria-hidden className="flex items-center gap-3 text-label text-t2">
            <span className="h-px flex-1 bg-border" />
            ou
            <span className="h-px flex-1 bg-border" />
          </div>
          <Button variant="secondary" className={cn(ALTO, "w-full")} onClick={() => trocarModo("link")}>
            <MailIcon aria-hidden />
            Entrar com link por e-mail
          </Button>
        </>
      ) : null}

      <div className="flex flex-col gap-1 text-dense text-t2">
        {pedeLink(modo) ? (
          <p>
            Lembrou a senha?{" "}
            <Button variant="link" onClick={() => trocarModo("entrar")}>
              Entrar com senha
            </Button>
          </p>
        ) : null}
        <p>
          {modo === "criar" ? "Já tem conta?" : "Ainda não tem conta?"}{" "}
          <Button variant="link" onClick={() => trocarModo(modo === "criar" ? "entrar" : "criar")}>
            {modo === "criar" ? "Entrar" : "Criar conta"}
          </Button>
        </p>
      </div>
    </section>
  );
}
