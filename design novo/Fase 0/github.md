repo: Arthuriones/xcart
branch: main

## Last sync
date: 2026-10-02T19:05:07Z

### Updated in this project
- Fase 0 do redesign: fundação de tokens (claro e escuro) com tabela de contraste calculada
- Casca nova (menu, barra de contexto, ⌘K, sino, “Mais” no celular) e 6 telas-âncora
- Proposta com mapa de navegação, URLs, arquivos de leitura e decisões para o Arthur

## Screen map
| Tela do projeto | Arquivos do repo |
|---|---|
| xcart-tokens.css, Fundacao.dc.html | src/app/globals.css, design novo/Arquitetura e design system/HANDOFF.md |
| Navegacao.dc.html, Topo.dc.html, Casca.dc.html | src/components/layout/sidebar.tsx, src/app/(dashboard)/layout.tsx, src/lib/financeiro/tipos.ts |
| Lucro.dc.html | src/lib/financeiro/calculo.ts, src/lib/financeiro/tipos.ts, docs/reformulacao-financeiro/LEIA-PRIMEIRO.md, docs/reformulacao-financeiro/plano.md |
| Saude dos pixels.dc.html, Eventos ao vivo.dc.html | src/app/(dashboard)/tracking/*, CLAUDE.md (rastreamento) |
| Alertas.dc.html | src/lib/alertas/avaliar.ts, src/lib/alertas/regras.ts |
| Lojas.dc.html | src/app/(dashboard)/stores/* |
| Integracoes.dc.html | src/app/(dashboard)/financeiro/anuncios/*, docs/reformulacao-financeiro/LEIA-PRIMEIRO.md |
| Proposta Fase 0.dc.html | docs/design/brief-redesign.md |
