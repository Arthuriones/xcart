import * as React from "react"

import { cn } from "@/components/ui/cn"

/*
 * Selo de estado: sempre cor + ponto + palavra, em caixa de frase. Seis tons;
 * "run" (em andamento) e o unico com ponto pulsando, e o pulso para sozinho
 * com "reduzir movimento". Pausado e sempre neutro.
 */

export type TomStatus = "ok" | "warn" | "err" | "info" | "neutral" | "run"

const TOM: Record<TomStatus, string> = {
  ok: "border-ok-border bg-ok-bg text-ok",
  warn: "border-warn-border bg-warn-bg text-warn",
  err: "border-err-border bg-err-bg text-err",
  info: "border-info-border bg-info-bg text-info",
  neutral: "border-neutral-border bg-neutral-bg text-neutral",
  run: "border-run-border bg-run-bg text-run",
}

const TOM_PONTO: Record<TomStatus, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  err: "bg-err",
  info: "bg-info",
  neutral: "bg-neutral",
  run: "bg-run",
}

type Entrada = { tom: TomStatus; texto: string }

/**
 * Mapa unico de estados (Fundacao, secao 5). A tela traduz o dado dela para
 * uma destas chaves; o tom e a palavra ficam iguais no app inteiro.
 *   <StatusBadge {...STATUS.loja.conectada} />
 */
export const STATUS = {
  loja: {
    conectada: { tom: "ok", texto: "Conectada" },
    semPermissao: { tom: "err", texto: "Sem permissão" },
    tokenInvalido: { tom: "warn", texto: "Token inválido" },
    appDesinstalado: { tom: "neutral", texto: "App desinstalado" },
    pausada: { tom: "neutral", texto: "Pausada" },
  },
  rota: {
    ativa: { tom: "ok", texto: "Ativa" },
    atencao: { tom: "warn", texto: "Atenção" },
    pausada: { tom: "neutral", texto: "Pausada" },
    semRota: { tom: "neutral", texto: "Sem rota" },
  },
  destino: {
    enviando: { tom: "ok", texto: "Enviando" },
    /** Google: sai do navegador pela tag do Google, sem contagem no servidor. */
    tagAtiva: { tom: "ok", texto: "Tag ativa" },
    incompleto: { tom: "warn", texto: "Incompleto" },
    desativado: { tom: "neutral", texto: "Desativado" },
    modoTeste: { tom: "info", texto: "Modo teste" },
    erro: { tom: "err", texto: "Erro" },
  },
  contaAnuncio: {
    atualizada: { tom: "ok", texto: "Atualizada" },
    aguardando: { tom: "run", texto: "Aguardando" },
    erro: { tom: "err", texto: "Erro" },
    semLoja: { tom: "warn", texto: "Sem loja" },
    pausada: { tom: "neutral", texto: "Pausada" },
  },
  job: {
    naFila: { tom: "neutral", texto: "Na fila" },
    rodando: { tom: "run", texto: "Rodando" },
    concluida: { tom: "ok", texto: "Concluída" },
    falhou: { tom: "err", texto: "Falhou" },
  },
  alerta: {
    critico: { tom: "err", texto: "Crítico" },
    aviso: { tom: "warn", texto: "Aviso" },
    resolvido: { tom: "ok", texto: "Resolvido" },
  },
  lucro: {
    lucro: { tom: "ok", texto: "Lucro" },
    noLimite: { tom: "warn", texto: "No limite" },
    prejuizo: { tom: "err", texto: "Prejuízo" },
    semGasto: { tom: "neutral", texto: "Sem gasto" },
  },
  saude: {
    tudoCerto: { tom: "ok", texto: "Tudo certo" },
    atencao: { tom: "warn", texto: "Precisa de atenção" },
    parado: { tom: "err", texto: "Parado" },
    desligado: { tom: "neutral", texto: "Desligado" },
  },
} as const satisfies Record<string, Record<string, Entrada>>

type StatusBadgeProps = Omit<React.ComponentProps<"span">, "children"> & {
  tom: TomStatus
  /** A palavra do estado. Pode vir por `texto` (para espalhar o STATUS) ou children. */
  texto?: string
  children?: React.ReactNode
  /** sm = 22px (tabela, lista) · md = 28px (cabecalho, destaque). */
  tamanho?: "sm" | "md"
  /** Mostra o ponto (padrao: sim). */
  ponto?: boolean
  /** Ponto pulsando. Padrao: so no tom "run". */
  pulso?: boolean
}

function StatusBadge({
  tom,
  texto,
  children,
  tamanho = "sm",
  ponto = true,
  pulso,
  className,
  ...props
}: StatusBadgeProps) {
  const pulsando = pulso ?? tom === "run"
  return (
    <span
      data-slot="status-badge"
      data-tom={tom}
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full border text-label whitespace-nowrap",
        tamanho === "md" ? "h-7 px-2.5 font-semibold" : "h-5.5 px-2 font-medium",
        TOM[tom],
        className
      )}
      {...props}
    >
      {ponto ? (
        <span
          aria-hidden="true"
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            TOM_PONTO[tom],
            pulsando && "animate-xc-pulse text-run"
          )}
        />
      ) : null}
      {children ?? texto}
    </span>
  )
}

/**
 * So o ponto, para lista densa. A palavra vai para o leitor de tela (e para
 * quem enxerga, coloque-a ao lado: estado nunca so por cor).
 */
function StatusDot({
  tom,
  texto,
  pulso,
  className,
}: {
  tom: TomStatus
  texto: string
  pulso?: boolean
  className?: string
}) {
  return (
    <span data-slot="status-dot" className={cn("inline-flex items-center", className)}>
      <span
        aria-hidden="true"
        className={cn(
          "size-2 shrink-0 rounded-full",
          TOM_PONTO[tom],
          (pulso ?? tom === "run") && "animate-xc-pulse text-run"
        )}
      />
      <span className="sr-only">{texto}</span>
    </span>
  )
}

export { StatusBadge, StatusDot }
export type { StatusBadgeProps }
