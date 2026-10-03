"use client";

import { useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import clsx from "clsx";
import { Pop } from "./sobreposicao";

// ============================================================================
// Sino do topo: os alertas abertos (GET /api/leitura/notificacoes), lidos na
// hora em que o sino abre. O numero do selo vem do servidor junto com a
// pagina e e corrigido pela leitura.
//
// Sem "marcar como lido" nem "adiar": pedem coluna nova na tabela alertas.
// ============================================================================

interface Notificacao {
  id: string;
  severidade: "critico" | "aviso";
  titulo: string;
  loja: string | null;
  abertoEm: string;
  silenciado: boolean;
}

type Estado =
  | { tipo: "fechado" }
  | { tipo: "carregando" }
  | { tipo: "erro" }
  | { tipo: "ok"; total: number; itens: Notificacao[]; agora: number };

function relativo(iso: string, agora: number): string {
  const min = Math.floor((agora - Date.parse(iso)) / 60000);
  if (!Number.isFinite(min) || min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "ontem" : `há ${d} dias`;
}

function absoluto(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(d);
}

function rotuloSino(n: number | null) {
  if (!n) return "Notificações";
  return n === 1 ? "Notificações, 1 alerta aberto" : `Notificações, ${n} alertas abertos`;
}

function Selo({ n, className }: { n: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={clsx(
        "num absolute h-4.5 min-w-4.5 rounded-full bg-err px-1 text-center text-label font-semibold leading-4.5 text-surface",
        className
      )}
    >
      {n > 99 ? "99+" : n}
    </span>
  );
}

/** Desktop: popover com a lista. */
export function Sino({ total }: { total: number | null }) {
  const [estado, setEstado] = useState<Estado>({ tipo: "fechado" });
  const aberto = estado.tipo !== "fechado";
  const n = estado.tipo === "ok" ? estado.total : total;

  const fechar = () => setEstado({ tipo: "fechado" });

  async function ler() {
    setEstado({ tipo: "carregando" });
    try {
      const r = await fetch("/api/leitura/notificacoes", { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const dados = (await r.json()) as { total: number; itens: Notificacao[] };
      const agora = Date.now();
      // Fechou antes da resposta chegar: continua fechado.
      setEstado((e) =>
        e.tipo === "fechado" ? e : { tipo: "ok", total: dados.total, itens: dados.itens, agora }
      );
    } catch {
      setEstado((e) => (e.tipo === "fechado" ? e : { tipo: "erro" }));
    }
  }

  return (
    <Pop
      rotulo="Notificações"
      aberto={aberto}
      aoMudar={(a) => (a ? ler() : fechar())}
      alinhar="end"
      className="w-100"
      gatilho={
        <button
          type="button"
          aria-label={rotuloSino(n)}
          className="relative grid size-ctl-md place-items-center rounded-control border border-border-strong bg-surface text-t1 hover:border-control-border hover:text-ink"
        >
          <Bell className="size-4" strokeWidth={1.75} aria-hidden />
          {!!n && <Selo n={n} className="-right-1.5 -top-1.5" />}
        </button>
      }
    >
      <div className="flex items-center justify-between px-4 pb-2 pt-3">
        <h2 className="text-section font-semibold">Notificações</h2>
        {estado.tipo === "ok" && estado.total > 0 && (
          <span className="num text-label text-t2">
            {estado.total === 1 ? "1 aberto" : `${estado.total} abertos`}
          </span>
        )}
      </div>
      <div className="max-h-90 overflow-y-auto border-t border-border" aria-busy={estado.tipo === "carregando"}>
        {estado.tipo === "carregando" && (
          <div className="flex flex-col gap-3 p-4" aria-label="Carregando os alertas">
            {[0, 1, 2].map((i) => (
              <span key={i} className="block h-10 rounded-control bg-skeleton" />
            ))}
          </div>
        )}
        {estado.tipo === "erro" && (
          <div className="flex flex-col items-start gap-2 p-4 text-dense" role="alert">
            <span className="text-ink">Os alertas não carregaram agora.</span>
            <button type="button" onClick={ler} className="text-label font-medium text-brand hover:text-ink">
              Tentar de novo
            </button>
          </div>
        )}
        {estado.tipo === "ok" && estado.itens.length === 0 && (
          <p className="p-4 text-dense text-t2">
            Nenhum alerta aberto. Quando algo quebrar nas vendas, no rastreamento ou no gasto,
            aparece aqui.
          </p>
        )}
        {estado.tipo === "ok" && estado.itens.length > 0 && (
          <ul>
            {estado.itens.map((a) => {
              const critico = a.severidade === "critico";
              return (
                <li key={a.id} className="flex gap-3 border-b border-border-subtle px-4 py-3">
                  <span
                    aria-hidden
                    className={clsx("mt-1.5 size-2 shrink-0 rounded-full", critico ? "bg-err" : "bg-warn")}
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="text-label">
                      <span className={clsx("font-semibold", critico ? "text-err" : "text-warn")}>
                        {critico ? "Crítico" : "Aviso"}
                      </span>
                      <span className="text-t3">
                        {a.loja ? ` · ${a.loja}` : " · todas as lojas"} ·{" "}
                        <time dateTime={a.abertoEm}>{relativo(a.abertoEm, estado.agora)}</time>
                        <span className="sr-only"> ({absoluto(a.abertoEm)})</span>
                        {a.silenciado && " · silenciado"}
                      </span>
                    </span>
                    <span className="text-dense font-medium text-ink">{a.titulo}</span>
                    <Link href="/alertas" onClick={fechar} className="w-fit text-label font-medium">
                      Resolver
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="flex justify-between bg-surface-2 px-4 py-2.5">
        <Link href="/alertas" onClick={fechar} className="text-label font-medium">
          Ver todos os alertas
        </Link>
      </div>
    </Pop>
  );
}

/** Celular: o sino leva direto para Alertas. */
export function SinoCelular({ total }: { total: number | null }) {
  return (
    <Link
      href="/alertas"
      aria-label={rotuloSino(total)}
      className="relative grid size-ctl-lg place-items-center rounded-control text-t1 hover:text-ink"
    >
      <Bell className="size-5" strokeWidth={1.75} aria-hidden />
      {!!total && <Selo n={total} className="right-1 top-1.5" />}
    </Link>
  );
}
