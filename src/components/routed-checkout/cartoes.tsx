"use client";

/** Barra de progresso acessivel (a fundacao ainda nao tem Progress). */
export function Progresso({ valor, rotulo }: { valor: number; rotulo: string }) {
  return (
    <div
      role="progressbar"
      aria-label={rotulo}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={valor}
      className="h-2 w-full overflow-hidden rounded-full bg-track"
    >
      <div className="h-full rounded-full bg-solid transition-[width] duration-200 motion-reduce:transition-none" style={{ width: `${valor}%` }} />
    </div>
  );
}
