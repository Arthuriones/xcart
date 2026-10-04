import { ChevronRight } from "lucide-react";

// ============================================================================
// "Como funciona": o glossario da tela, sem JavaScript (<details> nativo).
// Os termos que aparecem na tela (identificador de clique, token de
// conversoes, rotulo) ficam explicados aqui, em vez de num title= que o
// celular nao abre. Tudo fechado: quem quer ler abre.
// ============================================================================

const ITENS: { titulo: string; texto: string; soComRota?: boolean }[] = [
  {
    titulo: "Como a compra chega ao Meta e ao Google",
    texto:
      "Quando a Shopify avisa um pedido novo, o xcart envia a compra direto do servidor para cada destino ligado. Ver produto e carrinho vêm do script no tema da loja; checkout e pagamento, do pixel do checkout.",
  },
  {
    titulo: "O que é o identificador de clique (gclid e fbc)",
    texto:
      "É o código que o Google (gclid) e o Meta (fbc) põem no link do anúncio. Sem ele a compra chega à plataforma, mas não é ligada ao anúncio que trouxe o comprador. Uma parte sem clique é normal: é quem veio direto ou pela busca.",
  },
  {
    titulo: "O que é o token de conversões do Meta",
    texto:
      "É a chave que deixa o xcart enviar compras ao pixel do Meta pelo servidor (a API de Conversões). É diferente do token que lê o gasto: um envia, o outro só lê.",
  },
  {
    titulo: "O que é o rótulo de conversão do Google",
    texto:
      "No Google Ads, cada evento (compra, checkout…) é uma ação de conversão com rótulo próprio. O AW- é da conta; o rótulo muda por evento. Evento sem rótulo não é enviado.",
  },
  {
    titulo: "“Enviada” não é “contada”",
    texto:
      "Enviada quer dizer que a plataforma aceitou o envio, não que contou a conversão. A confirmação fica no Google Ads e no Gerenciador de Eventos do Meta. Se entrarem pedidos e as compras pararem de sair, o aviso aparece aqui.",
  },
  {
    soComRota: true,
    titulo: "Loja com vitrine e checkout separados",
    texto:
      "Quando o anúncio leva a uma vitrine e o pedido nasce na loja de checkout, a compra sai sem atribuição. É uma decisão do produto e não tem conserto nesta tela; anunciar direto na loja de checkout não tem esse buraco.",
  },
];

/** `temRota`: o item da vitrine so aparece para quem roteia vitrine -> checkout. */
export function ComoFunciona({ temRota }: { temRota: boolean }) {
  return (
    <section
      aria-labelledby="como-funciona-t"
      className="rounded-card border border-border bg-surface"
    >
      <h2
        id="como-funciona-t"
        className="border-b border-border-subtle px-4 py-3.5 text-section text-ink"
      >
        Como funciona
      </h2>
      {ITENS.filter((item) => temRota || !item.soComRota).map((item) => (
        <details key={item.titulo} className="group border-b border-border-subtle last:border-b-0">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2.5 px-4 text-dense font-medium text-ink hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus [&::-webkit-details-marker]:hidden">
            <ChevronRight
              aria-hidden
              className="size-3.5 shrink-0 text-t2 transition-transform group-open:rotate-90 motion-reduce:transition-none"
            />
            {item.titulo}
          </summary>
          <p className="max-w-190 px-4 pb-3.5 pl-10 text-dense text-t1 text-pretty">{item.texto}</p>
        </details>
      ))}
    </section>
  );
}
