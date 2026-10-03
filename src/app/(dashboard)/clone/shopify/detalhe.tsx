/** O texto cru do erro, recolhido: so para quem for falar com o suporte. */
export function DetalheSuporte({ detalhe }: { detalhe: string | null }) {
  if (!detalhe) return null;
  return (
    <details className="mt-1 text-label text-t2">
      <summary className="cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
        Detalhes para o suporte
      </summary>
      <p className="mt-1 font-mono break-all">{detalhe}</p>
    </details>
  );
}
