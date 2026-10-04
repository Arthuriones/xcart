"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_SKUS_POR_BUSCA, MAX_TAMANHO_SKU, type ProdutoDoSku } from "@/lib/leitura/sku-shopify";

// ============================================================================
// Nome e foto dos SKUs que a tabela esta mostrando, lidos da Shopify pela
// rota de leitura (GET /api/leitura/custos/produtos). So a pagina visivel:
// no maximo 50 SKUs, em perguntas de 25, e cada SKU e pedido uma vez. A
// pergunta espera a busca parar por 300 ms: sem isso, cada tecla cancelava a
// anterior e perguntava de novo a Shopify.
//
// Falha nao trava nada: a linha continua com o SKU, e a tela diz uma vez que
// os nomes nao vieram.
// ============================================================================

export interface ProdutosDaShopify {
  /** undefined = ainda nao veio; null = a Shopify nao achou o SKU. */
  produtos: Record<string, ProdutoDoSku | null>;
  falhou: boolean;
}

export function useProdutosDaShopify(lojaId: string, skus: readonly string[], ligado: boolean): ProdutosDaShopify {
  const [estado, setEstado] = useState<ProdutosDaShopify>({ produtos: {}, falhou: false });
  const pedidos = useRef(new Set<string>());
  const resolvidos = useRef(new Set<string>());
  const parou = useRef(false);
  const chave = skus.join("\n");

  useEffect(() => {
    if (!ligado || !chave || parou.current) return;
    // Os dois Sets sao os mesmos a vida toda do componente.
    const jaPedidos = pedidos.current;
    const jaResolvidos = resolvidos.current;
    const faltam = chave.split("\n").filter((s) => s && s.length <= MAX_TAMANHO_SKU && !jaPedidos.has(s));
    if (faltam.length === 0) return;
    faltam.forEach((s) => jaPedidos.add(s));

    const controle = new AbortController();
    const lotes: string[][] = [];
    for (let i = 0; i < faltam.length; i += MAX_SKUS_POR_BUSCA) lotes.push(faltam.slice(i, i + MAX_SKUS_POR_BUSCA));

    const espera = setTimeout(() => {
      Promise.all(
        lotes.map(async (lote) => {
          const params = new URLSearchParams({ loja: lojaId });
          lote.forEach((s) => params.append("sku", s));
          const res = await fetch(`/api/leitura/custos/produtos?${params.toString()}`, { signal: controle.signal });
          // Sessao vencida: o proxy manda para /login e a resposta "da certo".
          if (!res.ok || res.redirected) throw new Error(String(res.status));
          const corpo = (await res.json()) as { produtos?: Record<string, ProdutoDoSku> };
          return { lote, achados: corpo.produtos ?? {} };
        })
      )
        .then((respostas) => {
          const novos: Record<string, ProdutoDoSku | null> = {};
          for (const { lote, achados } of respostas) {
            for (const s of lote) {
              novos[s] = achados[s] ?? null;
              jaResolvidos.add(s);
            }
          }
          setEstado((atual) => ({ ...atual, produtos: { ...atual.produtos, ...novos } }));
        })
        .catch(() => {
          // Falha de verdade: para de perguntar nesta visita (a tabela fica so com o SKU).
          if (controle.signal.aborted) return;
          parou.current = true;
          setEstado((atual) => ({ ...atual, falhou: true }));
        });
    }, 300);

    return () => {
      clearTimeout(espera);
      controle.abort();
      // Cancelado no meio (a pagina mudou): libera para pedir de novo depois.
      faltam.forEach((s) => {
        if (!jaResolvidos.has(s)) jaPedidos.delete(s);
      });
    };
  }, [lojaId, chave, ligado]);

  return estado;
}
