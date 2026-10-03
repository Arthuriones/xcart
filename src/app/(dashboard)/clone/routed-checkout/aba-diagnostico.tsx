"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleCheckIcon, OctagonAlertIcon, TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { cn } from "@/components/ui/cn";
import { Section } from "@/components/ui/section";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  fraseDoConserto,
  linhasDoTeste,
  testePedeConserto,
  type LinhaTeste,
  type ResultadoTeste,
} from "./logica";

type Teste = { ok: true; dado: ResultadoTeste } | { ok: false; texto: string };

/** Roda o teste da rota pela rota de sempre (POST /api/checkout-routes/health). */
async function testarRota(id: string): Promise<Teste> {
  try {
    const r = await fetch("/api/checkout-routes/health", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const d = (await r.json().catch(() => null)) as ResultadoTeste | null;
    if (!r.ok || !d) {
      return {
        ok: false,
        texto:
          r.status === 404
            ? "A rota ou uma das lojas não foi encontrada. Confira se as lojas continuam conectadas em Lojas."
            : "Não deu para testar agora: a Shopify demorou ou recusou. Tente de novo em instantes.",
      };
    }
    return { ok: true, dado: d };
  } catch {
    return { ok: false, texto: "A conexão caiu antes do teste terminar. Tente de novo." };
  }
}

const ICONE: Record<LinhaTeste["tom"], typeof CircleCheckIcon> = {
  ok: CircleCheckIcon,
  warn: TriangleAlertIcon,
  err: OctagonAlertIcon,
};

/**
 * Aba Diagnostico: testar a rota, ver o resultado colado no botao, corrigir,
 * a checagem automatica de hora em hora e como testar com um carrinho real.
 * "Conferir agora" (aviso de mapa velho na Visao) chega aqui com ?conferir=1
 * e o teste ja comeca.
 */
export function AbaDiagnostico({
  rotaId,
  ultimaChecagem,
  conferirAoAbrir,
  lojaCheckout,
}: {
  rotaId: string;
  ultimaChecagem: { quando: string | null; ok: boolean; mensagem: string | null } | null;
  conferirAoAbrir: boolean;
  lojaCheckout: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [testando, setTestando] = useState(conferirAoAbrir);
  const [teste, setTeste] = useState<Teste | null>(null);
  const [corrigindo, setCorrigindo] = useState(false);
  const [conserto, setConserto] = useState<{ ok: boolean; texto: string } | null>(null);

  // Veio do "Conferir agora": testa uma vez e tira o pedido da URL, para
  // recarregar a pagina nao testar de novo. O estado so muda na resposta.
  useEffect(() => {
    if (!conferirAoAbrir) return;
    let vivo = true;
    void testarRota(rotaId).then((t) => {
      if (!vivo) return;
      setTeste(t);
      setTestando(false);
      const url = new URL(window.location.href);
      url.searchParams.delete("conferir");
      window.history.replaceState(null, "", url.pathname + url.search);
    });
    return () => {
      vivo = false;
    };
  }, [conferirAoAbrir, rotaId]);

  async function testar() {
    setTestando(true);
    setTeste(null);
    setConserto(null);
    setTeste(await testarRota(rotaId));
    setTestando(false);
  }

  async function corrigir() {
    setCorrigindo(true);
    setConserto(null);
    try {
      const r = await fetch("/api/checkout-routes/repair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: rotaId }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setConserto({
          ok: false,
          texto:
            r.status === 409
              ? "O conserto automático já está mexendo nesta loja agora. Tente de novo em alguns minutos."
              : "Não deu para corrigir agora. Nada foi apagado; tente de novo em instantes.",
        });
        return;
      }
      setConserto({ ok: true, texto: fraseDoConserto(d) });
      setTeste(null);
      startTransition(() => router.refresh());
    } catch {
      setConserto({ ok: false, texto: "A conexão caiu antes do conserto terminar. Teste de novo para ver o que ficou." });
    } finally {
      setCorrigindo(false);
    }
  }

  const dado = teste?.ok ? teste.dado : null;
  const linhas = dado ? linhasDoTeste(dado) : [];
  const funil = dado && typeof dado.loaderReady7d === "number" ? dado : null;

  return (
    <div className="flex flex-col gap-4">
      <Section
        titulo="Testar a rota"
        descricao="Confere se cada produto da vitrine tem par certo na loja de checkout. Leva alguns segundos."
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button pending={testando} onClick={testar}>
            {testando ? "Testando…" : dado ? "Testar de novo" : "Testar agora"}
          </Button>
          {dado && testePedeConserto(dado) ? (
            <Button variant="secondary" pending={corrigindo} onClick={corrigir}>
              Corrigir agora
            </Button>
          ) : null}
        </div>

        <div aria-live="polite" className="flex flex-col gap-3">
          {teste && !teste.ok ? (
            <Callout tom="err" titulo="O teste não terminou">
              {teste.texto}
            </Callout>
          ) : null}

          {dado ? (
            <div
              className={cn(
                "flex flex-col gap-3 rounded-card border p-4",
                dado.ok ? "border-ok-border bg-ok-bg" : "border-warn-border bg-warn-bg"
              )}
            >
              {!dado.storeIssue ? (
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <span className="num text-kpi text-ink">{dado.coveragePercent}%</span>
                  <span className="text-dense text-ink">
                    das variantes da vitrine têm par
                    {dado.checkedTargetName ? ` em ${dado.checkedTargetName}` : ""}
                  </span>
                </p>
              ) : null}
              <ul className="flex flex-col gap-1.5">
                {linhas.map((l) => {
                  const Icone = ICONE[l.tom];
                  return (
                    <li key={l.texto} className="flex items-start gap-2 text-dense text-ink">
                      <Icone
                        aria-hidden
                        strokeWidth={1.75}
                        className={cn("mt-px size-4 shrink-0", l.tom === "ok" ? "text-ok" : l.tom === "warn" ? "text-warn" : "text-err")}
                      />
                      <span>{l.texto}</span>
                    </li>
                  );
                })}
              </ul>
              {funil ? (
                <p className="text-label text-t1">
                  Últimos 7 dias: {(funil.loaderReady7d ?? 0).toLocaleString("pt-BR")} visitas com o script ativo,{" "}
                  {(funil.routedOk7d ?? 0).toLocaleString("pt-BR")} carrinhos levados ao checkout
                  {funil.fallbackCount7d ? `, ${funil.fallbackCount7d.toLocaleString("pt-BR")} quedas no checkout da vitrine` : ""}.
                </p>
              ) : null}
            </div>
          ) : null}

          {conserto ? (
            <Callout tom={conserto.ok ? "ok" : "err"} titulo={conserto.ok ? "Rota corrigida" : "O conserto não terminou"}>
              {conserto.texto}
              {conserto.ok ? " Teste de novo para conferir." : ""}
            </Callout>
          ) : null}
        </div>
      </Section>

      <Section
        titulo="Checagem automática"
        descricao="De hora em hora o xcart confere a rota e liga os produtos novos da vitrine."
      >
        {ultimaChecagem ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <StatusBadge tom={ultimaChecagem.ok ? "ok" : "err"} texto={ultimaChecagem.ok ? "Tudo certo" : "Achou problema"} />
            <span className="text-dense text-t1">
              {ultimaChecagem.quando ? `Última: ${ultimaChecagem.quando}.` : ""}{" "}
              {!ultimaChecagem.ok && ultimaChecagem.mensagem ? ultimaChecagem.mensagem : ""}
            </span>
          </div>
        ) : (
          <p className="text-dense text-t2">Ainda não rodou para esta rota. Teste agora para não esperar.</p>
        )}
      </Section>

      <Section titulo="Testar com um carrinho real" descricao="Não precisa pagar: basta chegar ao checkout.">
        <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-dense text-t1 marker:text-t2">
          <li>Abra a vitrine numa janela anônima, para não usar um carrinho antigo.</li>
          <li>Ponha um produto no carrinho e clique em finalizar a compra.</li>
          <li>
            Você deve cair no checkout de <span className="font-medium text-ink">{lojaCheckout}</span>, com o mesmo
            produto e a mesma quantidade.
          </li>
          <li>Pode fechar a aba. O carrinho entra na conta de carrinhos dos últimos 30 dias.</li>
        </ol>
      </Section>
    </div>
  );
}
