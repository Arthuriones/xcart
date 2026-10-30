"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import clsx from "clsx";
import { textos } from "@/lib/textos";

const t = textos("nav");

// O tema so e conhecido no navegador: no servidor nenhuma opcao aparece
// marcada, e o hidratar nao briga com o HTML.
const nada = () => () => {};
function useNoNavegador() {
  return useSyncExternalStore(
    nada,
    () => true,
    () => false
  );
}

/**
 * Claro, Escuro e (se o provedor seguir o sistema) Sistema.
 *
 * "Sistema" so aparece quando o ThemeProvider tem enableSystem: oferecer a
 * opcao com ele desligado gravaria um tema que nao muda nada.
 */
export function SeletorTema({ grande = false }: { grande?: boolean }) {
  const { theme, setTheme, themes } = useTheme();
  const montado = useNoNavegador();
  const opcoes: { id: string; rotulo: string }[] = [
    { id: "light", rotulo: t("themeLight") },
    { id: "dark", rotulo: t("themeDark") },
  ];
  if (themes.includes("system")) opcoes.push({ id: "system", rotulo: t("themeSystem") });

  return (
    <div
      role="radiogroup"
      aria-label={t("theme")}
      className="flex gap-0.5 rounded-control bg-track p-0.5"
    >
      {opcoes.map((o) => {
        const on = montado && theme === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => setTheme(o.id)}
            className={clsx(
              // O segmentado da casca: trilho bg-track, a opcao marcada em
              // superficie com sombra (o mesmo da moeda, em seletor-global.tsx).
              "flex-1 rounded-[6px] font-medium",
              grande ? "h-10 text-dense" : "h-6.5 text-label",
              on ? "bg-surface text-ink shadow-[0_1px_2px_rgba(20,20,20,.12)]" : "text-t2 hover:text-ink"
            )}
          >
            {o.rotulo}
          </button>
        );
      })}
    </div>
  );
}
