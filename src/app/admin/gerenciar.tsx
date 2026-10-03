"use client";

import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Segmented } from "@/components/ui/segmented";
import { inteiro, lerSaldo } from "./formato";
import type { UsuarioGerenciavel } from "./tipos";

// ============================================================================
// Gerenciar um cliente: liberar ou revogar o acesso e ajustar plano e
// creditos. Tudo vai para PATCH /api/admin/users/[id] com os MESMOS corpos de
// antes ({ accessGranted }, { addCredits }, { plan, aiCredits }). Usado pela
// lista de usuarios (num dialogo) e pelo detalhe (num cartao).
// ============================================================================

type Mudanca = Partial<Pick<UsuarioGerenciavel, "plan" | "aiCredits" | "accessGranted">>;

interface PerfilDevolvido {
  plan?: string | null;
  ai_credits?: number | null;
  access_granted?: boolean | null;
}

/** PATCH na rota do admin. Erro vira mensagem em portugues (o detalhe vai para o console). */
async function patchUsuario(id: string, corpo: object): Promise<PerfilDevolvido | null> {
  let res: Response;
  try {
    res = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });
  } catch {
    throw new Error("Sem conexão com o servidor. Confira a internet e tente de novo.");
  }
  const json = (await res.json().catch(() => null)) as { profile?: PerfilDevolvido | null; error?: string } | null;
  if (!res.ok) {
    console.error("[admin] PATCH usuario", res.status, json?.error);
    if (res.status === 401 || res.status === 403) {
      throw new Error("Sua sessão de administrador expirou. Entre de novo para continuar.");
    }
    throw new Error("Não deu para salvar agora. Tente de novo.");
  }
  return json?.profile ?? null;
}

// ---------------------------------------------------------------------------
// Acesso
// ---------------------------------------------------------------------------

/**
 * Liberar e revogar acesso. Liberar grava na hora; revogar pede confirmacao
 * (corta a entrada do cliente). Devolve as acoes e o dialogo para montar uma
 * vez na tela.
 */
export function useAcessoUsuario({
  travaLigada,
  aoMudar,
}: {
  /** ACCESS_CONTROL_ENABLED: com a trava desligada todo mundo entra. */
  travaLigada: boolean;
  aoMudar: (id: string, m: Mudanca) => void;
}) {
  const [pendente, setPendente] = useState<string | null>(null);
  const [alvo, setAlvo] = useState<UsuarioGerenciavel | null>(null);
  const [aberto, setAberto] = useState(false);

  async function liberar(u: UsuarioGerenciavel) {
    setPendente(u.id);
    try {
      await patchUsuario(u.id, { accessGranted: true });
      aoMudar(u.id, { accessGranted: true });
      toast.success(`Acesso liberado para ${u.email}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não deu para liberar agora.");
    } finally {
      setPendente(null);
    }
  }

  function pedirRevogar(u: UsuarioGerenciavel) {
    setAlvo(u);
    setAberto(true);
  }

  const descricao = !alvo
    ? ""
    : alvo.plan === "pro"
      ? `A liberação manual sai, mas ${alvo.email} continua entrando pelo plano Pro enquanto ele valer. Lojas, rotas e créditos não mudam.`
      : travaLigada
        ? `Sem plano Pro, ${alvo.email} deixa de entrar no painel na próxima página que abrir. Lojas, rotas e créditos continuam guardados.`
        : `A trava de acesso está desligada hoje, então nada muda para ${alvo.email} até ela ser ligada. Lojas, rotas e créditos continuam guardados.`;

  const dialogo = (
    <ConfirmDialog
      open={aberto}
      onOpenChange={setAberto}
      titulo={alvo ? `Revogar o acesso de ${alvo.email}?` : "Revogar acesso?"}
      descricao={descricao}
      confirmar="Revogar acesso"
      mensagemErro="Não deu para revogar agora. Tente de novo."
      onConfirmar={async () => {
        if (!alvo) return;
        await patchUsuario(alvo.id, { accessGranted: false });
        aoMudar(alvo.id, { accessGranted: false });
        toast.success(`Acesso revogado de ${alvo.email}.`);
      }}
    />
  );

  return { liberar, pedirRevogar, pendente, dialogo };
}

// ---------------------------------------------------------------------------
// Plano e creditos
// ---------------------------------------------------------------------------

type Plano = "free" | "pro";

function planoDe(p: string | null | undefined): Plano {
  return p === "pro" ? "pro" : "free";
}

/**
 * O formulario de plano e saldo.
 *
 * +20 e +100 somam na hora (a soma e atomica no servidor) e NAO fecham nada:
 * antes eles gravavam e fechavam o modal, e uma troca de plano ainda nao
 * salva se perdia. Agora o saldo novo aparece no lugar, o plano escolhido
 * continua ali e "Salvar" grava o resto.
 */
export function FormPlanoCreditos({
  usuario,
  aoMudar,
  aoSalvar,
  aoCancelar,
}: {
  usuario: UsuarioGerenciavel;
  aoMudar: (m: Mudanca) => void;
  /** Depois de salvar (o dialogo fecha aqui). */
  aoSalvar?: () => void;
  /** Mostra "Cancelar" ao lado de "Salvar" (no dialogo). */
  aoCancelar?: () => void;
}) {
  const id = useId();
  const refCampo = useRef<HTMLInputElement>(null);
  const [plano, setPlano] = useState<Plano>(planoDe(usuario.plan));
  const [saldo, setSaldo] = useState<number | null>(usuario.aiCredits);
  const [campo, setCampo] = useState(String(usuario.aiCredits ?? 0));
  const [erroCampo, setErroCampo] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [somando, setSomando] = useState<number | null>(null);

  // Trocou o usuario em edicao: o formulario recomeca no RENDER, sem pintar
  // uma vez com o plano do anterior (como fazia o modal antigo).
  const [idAnterior, setIdAnterior] = useState(usuario.id);
  if (usuario.id !== idAnterior) {
    setIdAnterior(usuario.id);
    setPlano(planoDe(usuario.plan));
    setSaldo(usuario.aiCredits);
    setCampo(String(usuario.aiCredits ?? 0));
    setErroCampo(null);
  }

  const ocupado = salvando || somando !== null;

  async function somar(n: number) {
    setSomando(n);
    try {
      const perfil = await patchUsuario(usuario.id, { addCredits: n });
      const novo = typeof perfil?.ai_credits === "number" ? perfil.ai_credits : (saldo ?? 0) + n;
      // O campo so acompanha se ninguem mexeu nele: um saldo digitado e
      // ainda nao salvo continua la.
      if (lerSaldo(campo) === (saldo ?? 0)) setCampo(String(novo));
      setSaldo(novo);
      aoMudar({ aiCredits: novo });
      toast.success(`+${n} créditos para ${usuario.email}. Saldo agora: ${inteiro(novo)}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não deu para somar os créditos.");
    } finally {
      setSomando(null);
    }
  }

  async function salvar() {
    const valor = lerSaldo(campo);
    if (valor === null) {
      setErroCampo("Use um número inteiro, de 0 para cima.");
      refCampo.current?.focus();
      return;
    }
    setErroCampo(null);
    setSalvando(true);
    try {
      const perfil = await patchUsuario(usuario.id, { plan: plano, aiCredits: valor });
      const novoSaldo = typeof perfil?.ai_credits === "number" ? perfil.ai_credits : valor;
      setSaldo(novoSaldo);
      setCampo(String(novoSaldo));
      aoMudar({ plan: plano, aiCredits: novoSaldo });
      toast.success(`Plano e créditos de ${usuario.email} salvos.`);
      aoSalvar?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não deu para salvar agora.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void salvar();
      }}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-dense font-medium text-ink">Plano</span>
        <Segmented
          rotulo="Plano"
          valor={plano}
          onValorChange={setPlano}
          tamanho="md"
          opcoes={[
            { valor: "free", rotulo: "Free" },
            { valor: "pro", rotulo: "Pro" },
          ]}
        />
        <p className="text-label text-t2">Mudar aqui não cobra nem cancela assinatura: só muda o plano no xcart.</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-dense font-medium text-ink">Créditos</span>
        <div className="flex flex-wrap items-center gap-2">
          <span className="num text-body text-t1" aria-live="polite">
            Saldo atual: <strong className="font-semibold text-ink">{inteiro(saldo)}</strong>
          </span>
          <span className="flex gap-2 sm:ml-auto">
            {[20, 100].map((n) => (
              <Button
                key={n}
                type="button"
                variant="secondary"
                size="sm"
                pending={somando === n}
                disabled={ocupado && somando !== n}
                onClick={() => void somar(n)}
                aria-label={`Somar ${n} créditos agora`}
              >
                +{n}
              </Button>
            ))}
          </span>
        </div>
        <p className="text-label text-t2">+20 e +100 somam na hora, sem fechar nada.</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-saldo`}>Definir saldo exato</Label>
        <Input
          ref={refCampo}
          id={`${id}-saldo`}
          inputMode="numeric"
          autoComplete="off"
          value={campo}
          onChange={(e) => {
            setCampo(e.target.value);
            if (erroCampo) setErroCampo(null);
          }}
          aria-invalid={erroCampo ? true : undefined}
          aria-describedby={`${id}-saldo-ajuda`}
          className="num max-w-40"
        />
        <p id={`${id}-saldo-ajuda`} className={erroCampo ? "text-label font-medium text-err" : "text-label text-t2"}>
          {erroCampo ?? "Substitui o saldo quando você salva."}
        </p>
      </div>

      <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
        {aoCancelar ? (
          <Button type="button" variant="secondary" onClick={aoCancelar} disabled={salvando}>
            Cancelar
          </Button>
        ) : null}
        <Button type="submit" pending={salvando} disabled={somando !== null}>
          Salvar plano e saldo
        </Button>
      </div>
    </form>
  );
}

/** O formulario num dialogo, para a lista de usuarios. */
export function DialogoPlanoCreditos({
  usuario,
  aberto,
  aoMudarAberto,
  aoMudar,
}: {
  usuario: UsuarioGerenciavel | null;
  aberto: boolean;
  aoMudarAberto: (aberto: boolean) => void;
  aoMudar: (id: string, m: Mudanca) => void;
}) {
  return (
    <Dialog open={aberto} onOpenChange={aoMudarAberto}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Plano e créditos</DialogTitle>
          <DialogDescription className="break-all">{usuario?.email}</DialogDescription>
        </DialogHeader>
        {usuario ? (
          <FormPlanoCreditos
            usuario={usuario}
            aoMudar={(m) => aoMudar(usuario.id, m)}
            aoSalvar={() => aoMudarAberto(false)}
            aoCancelar={() => aoMudarAberto(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export type { Mudanca };
