"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  Download,
  ExternalLink,
  Keyboard,
  RefreshCw,
  Search,
  Store,
  SunMoon,
  type LucideIcon,
} from "lucide-react";
import clsx from "clsx";
import { ROTA_CONECTAR_OPERACAO, ROTULO_CONECTAR_OPERACAO } from "@/lib/conectar-operacao";
import { ATALHOS_G, ITENS } from "./navegacao";
import { Janela } from "./sobreposicao";

// ============================================================================
// Busca (Ctrl K / Cmd K), atalhos "g + letra" e "?" para a lista de atalhos.
//
// Um dialogo simples, sem biblioteca: telas e acoes sao fixas e filtradas
// aqui; lojas vem do topo (ja carregadas); pedidos vem de
// GET /api/leitura/busca, so quando o termo tem algarismo.
//
// Outros pedacos da casca abrem a busca ou os atalhos por evento de janela
// (abrirBusca / abrirAtalhos), sem estado global.
// ============================================================================

const EVENTO_BUSCA = "xcart:busca";
const EVENTO_ATALHOS = "xcart:atalhos";

export function abrirBusca() {
  window.dispatchEvent(new Event(EVENTO_BUSCA));
}

export interface LojaDaBusca {
  id: string;
  nome: string;
  dominio: string;
}

interface PedidoApi {
  lojaId: string;
  lojaNome: string;
  dominio: string;
  pedidoId: string;
  nome: string;
  dia: string;
  total: number | null;
  moeda: string;
  cancelado: boolean;
}

interface Resultado {
  chave: string;
  grupo: string;
  rotulo: string;
  sub?: string;
  subMono?: boolean;
  icone: LucideIcon;
  kbd?: string;
  externo?: boolean;
  acao: () => void;
}

function normalizar(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function ehEditavel(alvo: EventTarget | null) {
  if (!(alvo instanceof HTMLElement)) return false;
  return (
    alvo.isContentEditable ||
    alvo.tagName === "INPUT" ||
    alvo.tagName === "TEXTAREA" ||
    alvo.tagName === "SELECT"
  );
}

function dinheiro(valor: number | null, moeda: string) {
  if (valor === null) return "—";
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: moeda }).format(valor);
  } catch {
    return `${valor.toFixed(2)} ${moeda}`;
  }
}

/** O termo pede pedidos? Mesma regra do servidor (interpretarBusca). */
function querPedidos(q: string) {
  const t = q.trim();
  if (/^loja:/i.test(t)) return false;
  const termo = t.replace(/^pedido:\s*/i, "");
  return termo.length >= 2 && /\d/.test(termo);
}

export function PaletaComandos({
  lojas,
  onEscolherLoja,
  onAtualizar,
}: {
  lojas: LojaDaBusca[];
  /** Entra no contexto da loja. Ausente: a barra de contexto nao carregou. */
  onEscolherLoja?: (id: string) => void;
  onAtualizar: () => void;
}) {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [aberta, setAberta] = useState(false);
  const [atalhos, setAtalhos] = useState(false);
  const [q, setQ] = useState("");
  const [ativo, setAtivo] = useState(0);
  const [remoto, setRemoto] = useState<{
    q: string;
    pedidos: PedidoApi[];
    lojas: LojaDaBusca[];
    erro: boolean;
  } | null>(null);
  const campo = useRef<HTMLInputElement>(null);
  const gEm = useRef(0);
  // O atalho global precisa saber se a busca esta aberta sem refazer o
  // listener a cada abertura.
  const abertaRef = useRef(false);
  useEffect(() => {
    abertaRef.current = aberta;
  }, [aberta]);

  function abrir(a: boolean) {
    setAberta(a);
    if (a) {
      setQ("");
      setAtivo(0);
    }
  }

  // Teclado global: Ctrl/Cmd K, "?" e "g + letra".
  useEffect(() => {
    function abrirLimpa() {
      setAberta(true);
      setQ("");
      setAtivo(0);
    }
    function tecla(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setAtalhos(false);
        if (abertaRef.current) setAberta(false);
        else abrirLimpa();
        return;
      }
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || ehEditavel(e.target)) return;
      if (e.key === "?") {
        e.preventDefault();
        setAtalhos(true);
        return;
      }
      const agora = Date.now();
      if (e.key === "g") {
        gEm.current = agora;
        return;
      }
      if (agora - gEm.current < 1000) {
        gEm.current = 0;
        const destino = ATALHOS_G.find((a) => a.tecla === e.key.toLowerCase());
        if (destino) {
          e.preventDefault();
          router.push(destino.item.href);
        }
      }
    }
    const busca = () => abrirLimpa();
    const lista = () => setAtalhos(true);
    window.addEventListener("keydown", tecla);
    window.addEventListener(EVENTO_BUSCA, busca);
    window.addEventListener(EVENTO_ATALHOS, lista);
    return () => {
      window.removeEventListener("keydown", tecla);
      window.removeEventListener(EVENTO_BUSCA, busca);
      window.removeEventListener(EVENTO_ATALHOS, lista);
    };
  }, [router]);

  // Pedidos (e lojas) do servidor, 250 ms depois da ultima tecla.
  const termo = q.trim();
  const precisaRemoto = aberta && querPedidos(termo);
  useEffect(() => {
    if (!precisaRemoto) return;
    const controle = new AbortController();
    const espera = setTimeout(async () => {
      try {
        const r = await fetch(`/api/leitura/busca?q=${encodeURIComponent(termo)}`, {
          signal: controle.signal,
          cache: "no-store",
        });
        if (!r.ok) throw new Error(String(r.status));
        const dados = (await r.json()) as { pedidos: PedidoApi[]; lojas: LojaDaBusca[] };
        setRemoto({ q: termo, pedidos: dados.pedidos ?? [], lojas: dados.lojas ?? [], erro: false });
      } catch {
        if (!controle.signal.aborted) setRemoto({ q: termo, pedidos: [], lojas: [], erro: true });
      }
    }, 250);
    return () => {
      clearTimeout(espera);
      controle.abort();
    };
  }, [precisaRemoto, termo]);

  function ir(href: string) {
    setAberta(false);
    router.push(href);
  }

  // ---- resultados ----
  const soLojas = /^loja:/i.test(termo);
  const soPedidos = /^pedido:/i.test(termo);
  const alvo = normalizar(termo.replace(/^(loja|pedido):\s*/i, ""));
  const casa = (s: string) => !alvo || normalizar(s).includes(alvo);

  const resultados: Resultado[] = [];
  if (!soLojas && !soPedidos) {
    // Todas as telas, no menu ou nao: o que saiu do menu se acha por aqui.
    for (const item of Object.values(ITENS)) {
      if (!casa(`${item.rotulo} ${item.busca ?? ""}`)) continue;
      resultados.push({
        chave: `tela-${item.id}`,
        grupo: "Ir para",
        rotulo: item.rotulo,
        icone: item.icone,
        kbd: item.atalho ? `g ${item.atalho}` : undefined,
        acao: () => ir(item.href),
      });
    }
  }

  if (!soPedidos) {
    const vistas = new Set<string>();
    const remotas = remoto && remoto.q === termo ? remoto.lojas : [];
    for (const l of [...lojas, ...remotas]) {
      if (vistas.has(l.id) || !casa(`${l.nome} ${l.dominio}`)) continue;
      vistas.add(l.id);
      if (vistas.size > 6) break;
      resultados.push({
        chave: `loja-${l.id}`,
        grupo: "Lojas",
        rotulo: l.nome || l.dominio,
        sub: l.dominio,
        subMono: true,
        icone: Store,
        acao: () => {
          setAberta(false);
          if (onEscolherLoja) onEscolherLoja(l.id);
          else router.push(ITENS.lojas.href);
        },
      });
    }
  }

  const pedidosProntos = remoto && remoto.q === termo ? remoto : null;
  if (precisaRemoto && pedidosProntos && !soLojas) {
    for (const p of pedidosProntos.pedidos) {
      const url = `https://${p.dominio}/admin/orders/${encodeURIComponent(p.pedidoId)}`;
      resultados.push({
        chave: `pedido-${p.lojaId}-${p.pedidoId}`,
        grupo: "Pedidos",
        rotulo: `Pedido ${p.nome}${p.cancelado ? " (cancelado)" : ""}`,
        sub: `${p.lojaNome} · ${p.dia.slice(8, 10)}/${p.dia.slice(5, 7)} · ${dinheiro(p.total, p.moeda)}`,
        icone: ExternalLink,
        externo: true,
        acao: () => {
          setAberta(false);
          window.open(url, "_blank", "noopener,noreferrer");
        },
      });
    }
  }

  if (!soLojas && !soPedidos) {
    // `busca`: outras palavras que acham a acao (o rotulo ja acha).
    const acoes: (Omit<Resultado, "grupo"> & { busca?: string })[] = [
      { chave: "acao-atualizar", rotulo: "Atualizar agora", icone: RefreshCw, acao: () => { setAberta(false); onAtualizar(); } },
      {
        chave: "acao-conectar",
        rotulo: ROTULO_CONECTAR_OPERACAO,
        busca: "conectar loja shopify checkout sphere",
        icone: Store,
        acao: () => ir(ROTA_CONECTAR_OPERACAO),
      },
      { chave: "acao-importar", rotulo: "Importar produto", icone: Download, acao: () => ir(ITENS.importar.href) },
      {
        chave: "acao-tema",
        rotulo: resolvedTheme === "dark" ? "Usar o tema claro" : "Usar o tema escuro",
        icone: SunMoon,
        acao: () => {
          setAberta(false);
          setTheme(resolvedTheme === "dark" ? "light" : "dark");
        },
      },
      {
        chave: "acao-atalhos",
        rotulo: "Ver os atalhos de teclado",
        icone: Keyboard,
        kbd: "?",
        acao: () => {
          setAberta(false);
          setAtalhos(true);
        },
      },
    ];
    for (const { busca, ...a } of acoes) {
      if (casa(`${a.rotulo} ${busca ?? ""}`)) resultados.push({ ...a, grupo: "Ações" });
    }
  }

  const indice = Math.min(ativo, Math.max(0, resultados.length - 1));
  const buscandoPedidos = precisaRemoto && !pedidosProntos;
  const erroPedidos = precisaRemoto && pedidosProntos?.erro;

  function teclaNoCampo(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setAtivo(Math.min(resultados.length - 1, indice + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setAtivo(Math.max(0, indice - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      resultados[indice]?.acao();
    }
  }

  let grupoAnterior = "";

  return (
    <>
      <Janela aberto={aberta} aoMudar={abrir} titulo="Buscar ou ir para" tituloVisivel={false} focoInicial={campo}>
        <div className="flex h-13 shrink-0 items-center gap-2.5 border-b border-border px-4">
          <Search className="size-4.5 shrink-0 text-t2" strokeWidth={1.75} aria-hidden />
          <input
            ref={campo}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setAtivo(0);
            }}
            onKeyDown={teclaNoCampo}
            role="combobox"
            aria-expanded
            aria-controls="paleta-resultados"
            aria-activedescendant={resultados[indice] ? `paleta-${resultados[indice].chave}` : undefined}
            aria-autocomplete="list"
            aria-label="Buscar telas, lojas, pedidos ou ações"
            placeholder="Buscar telas, lojas, pedidos ou ações…"
            className="min-w-0 flex-1 border-0 bg-transparent text-body text-ink outline-none placeholder:text-t3"
          />
          <kbd className="rounded-control border border-border px-1.5 font-mono text-label text-t2">Esc</kbd>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border-subtle px-4 py-2">
          <span className="text-label text-t3">Filtros:</span>
          {["loja:", "pedido:"].map((op) => (
            <button
              key={op}
              type="button"
              onClick={() => {
                setQ(op);
                setAtivo(0);
                campo.current?.focus();
              }}
              className="h-6 rounded-control border border-border bg-surface-2 px-2 font-mono text-label text-t1 hover:border-border-strong"
            >
              {op}
            </button>
          ))}
        </div>
        <div
          id="paleta-resultados"
          role="listbox"
          aria-label="Resultados"
          className="max-h-95 min-h-0 flex-1 overflow-y-auto p-1.5"
        >
          {resultados.map((r, i) => {
            const cabecalho = r.grupo !== grupoAnterior;
            grupoAnterior = r.grupo;
            const on = i === indice;
            return (
              <div key={r.chave}>
                {cabecalho && (
                  <div role="presentation" className="px-2.5 pb-1 pt-2 text-label font-medium text-t3">
                    {r.grupo}
                  </div>
                )}
                <div
                  id={`paleta-${r.chave}`}
                  role="option"
                  aria-selected={on}
                  onMouseMove={() => !on && setAtivo(i)}
                  onClick={r.acao}
                  className={clsx(
                    "flex h-10 cursor-pointer items-center gap-2.5 rounded-control px-2.5 text-dense text-ink",
                    on && "bg-nav-active"
                  )}
                >
                  <r.icone className="size-4 shrink-0 text-t2" strokeWidth={1.75} aria-hidden />
                  <span className="min-w-0 flex-1 truncate">
                    {r.rotulo}
                    {r.externo && <span className="sr-only"> (abre a Shopify em outra aba)</span>}
                  </span>
                  {r.sub && (
                    <span className={clsx("max-w-[50%] truncate text-label text-t3", r.subMono && "font-mono")}>
                      {r.sub}
                    </span>
                  )}
                  {r.kbd && (
                    <kbd className="rounded-control border border-border px-1.5 font-mono text-label text-t2">
                      {r.kbd}
                    </kbd>
                  )}
                </div>
              </div>
            );
          })}
          {buscandoPedidos && (
            <p className="px-2.5 py-2 text-label text-t2" aria-live="polite">
              Buscando pedidos…
            </p>
          )}
          {erroPedidos && (
            <p className="px-2.5 py-2 text-label text-t2" aria-live="polite">
              A busca de pedidos não respondeu. Telas e lojas continuam aqui.
            </p>
          )}
          {resultados.length === 0 && !buscandoPedidos && !erroPedidos && (
            <p className="px-3 py-6 text-center text-dense text-t2">
              Nada encontrado para “{termo}”. Tente loja: ou pedido: com o número.
            </p>
          )}
        </div>
        <div className="hidden shrink-0 gap-4 border-t border-border bg-surface-2 px-4 py-2 text-label text-t2 md:flex">
          <span>↑ ↓ navegar</span>
          <span>Enter abrir</span>
          <span>g + letra ir direto</span>
          <span>? todos os atalhos</span>
        </div>
      </Janela>

      <Janela aberto={atalhos} aoMudar={setAtalhos} titulo="Atalhos de teclado" estreita>
        <ul className="grid gap-x-6 overflow-y-auto px-4 pb-3 pt-1">
          {[
            { t: "Abrir a busca", k: "Ctrl K ou ⌘K" },
            { t: "Ver todos os atalhos", k: "?" },
            ...ATALHOS_G.map((a) => ({ t: `Ir para ${a.item.rotulo}`, k: `g ${a.tecla}` })),
            { t: "Fechar janela ou painel", k: "Esc" },
          ].map((a) => (
            <li
              key={a.t}
              className="flex min-h-ctl-md items-center justify-between gap-3 border-b border-border-subtle text-dense"
            >
              <span>{a.t}</span>
              <kbd className="whitespace-nowrap rounded-control border border-border bg-surface-2 px-1.5 font-mono text-label text-t1">
                {a.k}
              </kbd>
            </li>
          ))}
        </ul>
      </Janela>
    </>
  );
}
