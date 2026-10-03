"use client";

import type { LojaDestino } from "@/lib/leitura/importar";
import { LinkVazio, ListaFila, useFila } from "../bulk/fila";

/** A fila da central: importacoes por link de todas as lojas. */
export function FilaTodas({ lojas }: { lojas: LojaDestino[] | null }) {
  const fila = useFila("");
  return (
    <ListaFila
      fila={fila}
      lojas={lojas}
      mostrarLoja
      descricao="Importações por link, de todas as lojas. A cópia de loja Shopify roda na própria tela e não entra aqui"
      vazio={{
        titulo: "Nenhuma importação por link ainda",
        descricao: "Os links do AliExpress e de outros sites aparecem aqui, com o andamento.",
        acao: <LinkVazio href="/bulk">Importar por link</LinkVazio>,
      }}
    />
  );
}
