import { Suspense } from "react";
import { filtroResolvido } from "@/lib/filtro-global";
import { lerFeed } from "@/lib/tracking/feed";
import { Aviso } from "../selo";
import { EventosScreen } from "./eventos-screen";

export const dynamic = "force-dynamic";

/**
 * A primeira pagina de eventos vem do servidor, para a tela abrir cheia; o
 * resto chega pelo polling da tela (GET /api/tracking/eventos).
 *
 * A loja vem do seletor global (cookie). filtroResolvido() ja confere contra
 * as lojas do usuario: cookie com loja alheia vira "todas", nunca evento de
 * outro.
 */
async function Conteudo() {
  let dados: Awaited<ReturnType<typeof carregar>>;
  try {
    dados = await carregar();
  } catch (e) {
    // Erro de banco aparece; lista vazia diria "nenhum evento ainda", que e
    // outra coisa e mandaria o lojista procurar defeito no tema.
    return (
      <Aviso
        tom="err"
        titulo="Não foi possível ler os eventos"
        detalhe={e instanceof Error ? e.message : "Tente de novo em instantes."}
      />
    );
  }
  return (
    // key: trocar a loja no seletor remonta a tela -- lista, paginacao e
    // polling recomecam do zero com a primeira pagina da loja nova.
    <EventosScreen
      key={dados.filtro.lojaId}
      inicial={dados.inicial}
      lojas={dados.lojas}
      lojaId={dados.filtro.lojaId}
      geradoEm={dados.geradoEm}
    />
  );
}

async function carregar() {
  const { filtro, lojas, lojaIds } = await filtroResolvido();
  const inicial = await lerFeed(lojaIds, null);
  return { filtro, lojas, inicial, geradoEm: Date.now() };
}

function Esqueleto() {
  // Blocos parados: a espera e de uma consulta so.
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <div aria-hidden className="h-[44px] rounded-xl border border-border bg-surface" />
      <div aria-hidden className="h-[360px] rounded-xl border border-border bg-surface" />
    </div>
  );
}

export default function EventosAoVivoPage() {
  return (
    <div className="flex flex-col gap-[18px]">
      <div>
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink">
          Eventos ao vivo
        </h1>
        <p className="mt-1 max-w-[62ch] text-[13px] leading-relaxed text-t2">
          O que o tema, o pixel do checkout e o webhook mandaram para o Google e o Meta,
          conforme chega.
        </p>
      </div>
      <Suspense fallback={<Esqueleto />}>
        <Conteudo />
      </Suspense>
    </div>
  );
}
