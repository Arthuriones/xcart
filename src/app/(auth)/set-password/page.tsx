"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export default function SetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;

    if (password !== confirmPassword) {
      setErrorMessage("As senhas não coincidem.");
      return;
    }

    if (password.length < 6) {
      setErrorMessage("A senha deve ter pelo menos 6 caracteres.");
      return;
    }

    setErrorMessage(null);
    setLoading(true);

    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({
      password,
      data: {
        has_password: true,
      },
    });

    setLoading(false);

    if (error) {
      setErrorMessage(error.message || "Não foi possível definir a senha. Tente novamente.");
      return;
    }

    router.push("/stores");
  }

  return (
    <div className="grid min-h-screen bg-surface lg:grid-cols-2">
      <div className="flex flex-col justify-center px-6 py-12 sm:px-[8vw]">
        <div className="mb-10 flex items-center gap-2">
          <span
            className="h-5 w-5 rounded-[5px]"
            style={{ background: "var(--brand)" }}
            aria-hidden
          />
          <span className="text-[14px] font-bold tracking-[0.06em] text-ink">XCART</span>
        </div>

        <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-ink">
          Defina sua senha
        </h1>
        <p className="mb-7 mt-1.5 max-w-[340px] text-[13px] text-t2">
          A partir de agora você entra com e-mail e senha, sem depender do link.
        </p>

        <form onSubmit={handleSubmit} className="flex max-w-[360px] flex-col gap-3.5">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-t1">Nova senha</span>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="h-9 rounded-md border border-[var(--control-border)] bg-surface px-2.5 text-[13px] text-ink outline-none transition-colors focus:border-[var(--brand)]"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-t1">Repita a senha</span>
            <input
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              className="h-9 rounded-md border border-[var(--control-border)] bg-surface px-2.5 text-[13px] text-ink outline-none transition-colors focus:border-[var(--brand)]"
            />
          </label>

          {errorMessage && (
            <p className="rounded-md border border-[var(--err-border)] bg-[var(--err-bg)] px-2.5 py-2 text-[12px] leading-relaxed text-ink">
              {errorMessage}
            </p>
          )}

          <p className="text-[11.5px] text-t3">Pelo menos 6 caracteres.</p>

          <button
            type="submit"
            disabled={loading}
            className="mt-1 h-9 rounded-md bg-[var(--solid)] text-[13px] font-semibold text-[var(--on-solid)] transition-colors hover:bg-[var(--solid-hover)] active:translate-y-px disabled:opacity-60"
          >
            {loading ? "Salvando…" : "Salvar senha"}
          </button>
        </form>
      </div>

      <div className="hidden flex-col justify-center gap-7 border-l border-border bg-surface-2 px-[6vw] py-12 lg:flex">
        <p className="font-mono text-[10px] tracking-[0.12em] text-t3">
          MODELO DA OPERAÇÃO
        </p>
        <div className="flex max-w-[300px] flex-col gap-2.5">
          <div className="rounded-[7px] border border-border bg-surface px-3 py-2.5">
            <p className="text-[12px] font-semibold text-ink">Vitrine</p>
            <p className="text-[11px] text-t3">Recebe o tráfego do anúncio</p>
          </div>
          <span className="ml-4 h-4 w-px bg-[var(--border-strong)]" aria-hidden />
          <div className="rounded-[7px] bg-[var(--solid)] px-3 py-2.5 text-[var(--on-solid)]">
            <p className="text-[12px] font-semibold">XCART</p>
            <p className="text-[11px] opacity-70">Mapeia, sincroniza e roteia</p>
          </div>
          <span className="ml-4 h-4 w-px bg-[var(--border-strong)]" aria-hidden />
          <div className="rounded-[7px] border border-border bg-surface px-3 py-2.5">
            <p className="text-[12px] font-semibold text-ink">Lojas de checkout</p>
            <p className="text-[11px] text-t3">Onde o pagamento acontece</p>
          </div>
        </div>
        <p className="max-w-[320px] text-[13px] text-t1">
          Uma vitrine, várias lojas de checkout. O xcart casa os SKUs e decide quem
          cobra cada carrinho.
        </p>
      </div>
    </div>
  );
}
