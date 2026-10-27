"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, MailCheckIcon, MailIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { cn } from "@/components/ui/cn";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { dadosDoCadastro, mascaraDocumento, mascaraTelefone } from "@/lib/cadastro";
import { guardarPlanoEscolhido } from "@/components/billing/plano-escolhido";
import {
  BOTAO,
  ORDEM_DOS_CAMPOS,
  SUBTITULO,
  TITULO,
  TITULO_ERRO,
  avisoDoLink,
  erroDeAcesso,
  pedeLink,
  validarAcesso,
  type CamposAcesso,
  type ErroDeAcesso,
  type ErrosDeCampo,
  type Modo,
} from "../acesso";
import { AvisoDeErro, Campo, CampoSenha } from "../campos";

// ============================================================================
// Entrar, criar conta e pedir link por e-mail: um formulario, quatro modos.
// Entrar e Criar conta sao as abas do cartao; os dois do link abrem sem abas.
// As chamadas ao Supabase sao as de sempre:
// - entrar: signInWithPassword;
// - criar: signUp com has_password, full_name (o menu le) e os dados do
//   cadastro (nome, sobrenome, telefone e documento, so digitos) -- o trigger
//   handle_new_user (migration 077) grava no perfil e tira telefone e
//   documento do metadata do usuario;
// - link e esqueci a senha: resetPasswordForEmail com volta em
//   /callback?type=recovery. O link entra na conta e abre /set-password --
//   por isso os dois modos mandam o mesmo link.
// ============================================================================

const VAZIO: CamposAcesso = {
  nome: "",
  sobrenome: "",
  email: "",
  telefone: "",
  documento: "",
  senha: "",
  confirmacao: "",
};

const ALTO = "h-ctl-lg sm:h-ctl-md";
const LINK = "font-medium text-brand underline underline-offset-2 hover:text-ink";

// O cliente do Supabase (auth, banco, realtime: uns 70 KB gzip) so serve no
// envio: sai do primeiro acesso. O foco num campo ja o baixa, para estar no
// cache no clique; o import() repetido devolve o mesmo modulo. A chamada
// continua saindo do navegador (decisao da 077).
// O import() que falhou (rede oscilando no foco, chunk 404 depois de um
// deploy) fica preso no cache do Turbopack: todo import() seguinte falha
// igual, sem buscar o arquivo. Tentar de novo nunca resolve, so recarregar a
// pagina -- por isso a falha vira PaginaSemCliente e nao passa pelo
// erroDeAcesso (que diria "tente de novo" ou, com "429" na URL do chunk,
// "muitas tentativas").
class PaginaSemCliente extends Error {}
const supabaseDoNavegador = () =>
  import("@/lib/supabase/client").then(
    (m) => m.createClient(),
    () => {
      throw new PaginaSemCliente("o cliente do Supabase nao carregou");
    },
  );
function preCarregarSupabase() {
  void import("@/lib/supabase/client").catch(() => undefined);
}
const RECARREGAR: ErroDeAcesso = {
  titulo: "Recarregue a página",
  texto: "Uma parte desta página não carregou. Recarregue a página e tente de novo.",
};

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
  plano = null,
}: {
  modoInicial: Modo;
  /** Caminho interno ja validado (?next= ou a home do app). */
  destino: string;
  /** ?error= da URL (o /callback manda "link_invalido"). */
  erroDaUrl: string | null;
  termos: { uso: string; privacidade: string };
  /** ?plano= da landing: guardado para a escolha de plano do app. */
  plano?: string | null;
}) {
  const router = useRouter();
  const [modo, setModo] = React.useState<Modo>(modoInicial);
  const [campos, setCampos] = React.useState<CamposAcesso>(VAZIO);
  const { email, senha, confirmacao } = campos;
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

  React.useEffect(() => {
    guardarPlanoEscolhido(plano);
  }, [plano]);

  // Troca de modo ou de estado: o foco vai para o titulo novo (o leitor de
  // tela anuncia onde a pessoa esta; o Tab segue dali). Pela aba, nao: o foco
  // fica na aba, como em qualquer lista de abas.
  const primeiraVez = React.useRef(true);
  const pelaAba = React.useRef(false);
  React.useEffect(() => {
    if (primeiraVez.current || pelaAba.current) {
      primeiraVez.current = false;
      pelaAba.current = false;
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

  function trocarModo(m: Modo, aba = false) {
    if (m === modo && !enviado) return;
    pelaAba.current = aba;
    setModo(m);
    setErro(null);
    setErrosCampo({});
    setEnviado(null);
    setReenviado(false);
    fecharAviso();
  }

  /** Muda um campo e tira o erro dele (o erro volta no proximo envio). */
  function mudar(campo: keyof CamposAcesso, valor: string) {
    setCampos((c) => ({ ...c, [campo]: valor }));
    if (errosCampo[campo]) setErrosCampo((e) => ({ ...e, [campo]: undefined }));
  }

  function mostrarErro(e: unknown) {
    // Sem o cliente, tentar de novo nao adianta (ver PaginaSemCliente).
    if (e instanceof PaginaSemCliente) {
      setErro(RECARREGAR);
      return;
    }
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
      const supabase = await supabaseDoNavegador();
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
    const problemas = validarAcesso(modo, campos);
    setErrosCampo(problemas);
    const primeiro = ORDEM_DOS_CAMPOS.find((k) => problemas[k]);
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
      const supabase = await supabaseDoNavegador();
      if (modo === "criar") {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password: senha,
          // Sem emailRedirectTo o link volta para a Site URL do Supabase: na
          // landing (sem sessao) ou na raiz do app, que le o ?code= como
          // instalacao da Shopify.
          options: {
            emailRedirectTo: `${window.location.origin}/callback?type=signup`,
            data: { has_password: true, ...dadosDoCadastro(campos) },
          },
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
      acao={
        erroVisivel === RECARREGAR ? (
          <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
            Recarregar a página
          </Button>
        ) : undefined
      }
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
  const criar = modo === "criar";
  const comAbas = modo === "entrar" || criar;
  const iguais = confirmacao.length > 0 && senha === confirmacao;

  const corpo = (
    <div className="flex flex-col gap-5 p-4 sm:p-6">
      <header className="flex flex-col gap-1.5">
        {/* Nas abas o nome do modo ja esta na aba: o titulo fica para o leitor de tela. */}
        <h1
          id="acesso-titulo"
          ref={titulo}
          tabIndex={-1}
          className={comAbas ? "sr-only" : "text-page text-ink"}
        >
          {TITULO[modo]}
        </h1>
        <p className="text-dense text-t2">{SUBTITULO[modo]}</p>
      </header>

      <form noValidate onSubmit={enviar} onFocus={preCarregarSupabase} className="flex flex-col gap-4">
        {criar ? (
          <div className="grid grid-cols-2 gap-3">
            <Campo
              id="acesso-nome"
              rotulo="Nome"
              value={campos.nome}
              onChange={(e) => mudar("nome", e.target.value)}
              autoComplete="given-name"
              autoCapitalize="words"
              erro={errosCampo.nome}
            />
            <Campo
              id="acesso-sobrenome"
              rotulo="Sobrenome"
              value={campos.sobrenome}
              onChange={(e) => mudar("sobrenome", e.target.value)}
              autoComplete="family-name"
              autoCapitalize="words"
              erro={errosCampo.sobrenome}
            />
          </div>
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
          placeholder="seu@email.com"
          value={email}
          onChange={(e) => mudar("email", e.target.value)}
          erro={errosCampo.email}
        />

        {criar ? (
          <>
            {/* A mascara corre a cada tecla: o estado ja guarda o texto formatado. */}
            <Campo
              id="acesso-telefone"
              rotulo="Telefone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="(11) 91234-5678"
              value={campos.telefone}
              onChange={(e) => mudar("telefone", mascaraTelefone(e.target.value))}
              erro={errosCampo.telefone}
            />
            <Campo
              id="acesso-documento"
              rotulo="CPF ou CNPJ"
              inputMode="numeric"
              autoComplete="off"
              placeholder="000.000.000-00"
              value={campos.documento}
              onChange={(e) => mudar("documento", mascaraDocumento(e.target.value))}
              erro={errosCampo.documento}
            />
          </>
        ) : null}

        {pedeLink(modo) ? null : (
          <CampoSenha
            // Trocar entre entrar e criar remonta o campo: a senha volta oculta.
            key={modo}
            id="acesso-senha"
            rotulo="Senha"
            valor={senha}
            aoMudar={(v) => mudar("senha", v)}
            autoComplete={criar ? "new-password" : "current-password"}
            nova={criar}
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

        {criar ? (
          <CampoSenha
            id="acesso-confirmacao"
            rotulo="Confirmar senha"
            valor={confirmacao}
            aoMudar={(v) => mudar("confirmacao", v)}
            autoComplete="new-password"
            erro={errosCampo.confirmacao}
            rodape={
              iguais && !errosCampo.confirmacao ? (
                <p className="flex items-center gap-1.5 text-label text-ok">
                  <CheckIcon aria-hidden className="size-3.5" strokeWidth={2} />
                  As duas senhas são iguais
                </p>
              ) : null
            }
          />
        ) : null}

        {erroNaTela}

        {criar ? (
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

      {/* Entrar e Criar conta trocam pela aba; daqui so volta quem pediu link. */}
      {pedeLink(modo) ? (
        <div className="flex flex-col gap-1 text-dense text-t2">
          <p>
            Lembrou a senha?{" "}
            <Button variant="link" onClick={() => trocarModo("entrar")}>
              Entrar com senha
            </Button>
          </p>
          <p>
            Ainda não tem conta?{" "}
            <Button variant="link" onClick={() => trocarModo("criar")}>
              Criar conta
            </Button>
          </p>
        </div>
      ) : null}
    </div>
  );

  return (
    <section aria-labelledby="acesso-titulo" className="flex flex-col gap-6">
      {aviso ? (
        <Callout
          tom={aviso.ok ? "ok" : "warn"}
          role={aviso.ok ? "status" : "alert"}
          titulo={aviso.titulo}
          dispensar={
            <Button size="icon-sm" variant="ghost" aria-label="Fechar aviso" onClick={fecharAviso}>
              <XIcon aria-hidden />
            </Button>
          }
        >
          <p>{aviso.texto}</p>
          {/* Embaixo do texto, nao ao lado: a coluna do formulario e estreita. */}
          {aviso.ok || pedeLink(modo) ? null : (
            <Button size="sm" variant="secondary" className="mt-2" onClick={() => trocarModo("link")}>
              Pedir outro link
            </Button>
          )}
        </Callout>
      ) : null}

      <div className="rounded-card border border-border bg-surface">
        {comAbas ? (
          <Tabs
            value={modo}
            onValueChange={(v) => trocarModo(v === "criar" ? "criar" : "entrar", true)}
            className="gap-0"
          >
            <TabsList variant="line" aria-label="Entrar ou criar conta" className="w-full gap-0 px-4 sm:px-6">
              <TabsTrigger value="entrar" className="h-11 flex-1">
                Entrar
              </TabsTrigger>
              <TabsTrigger value="criar" className="h-11 flex-1">
                Criar conta
              </TabsTrigger>
            </TabsList>
            <TabsContent value="entrar">{modo === "entrar" ? corpo : null}</TabsContent>
            <TabsContent value="criar">{criar ? corpo : null}</TabsContent>
          </Tabs>
        ) : (
          corpo
        )}
      </div>
    </section>
  );
}
