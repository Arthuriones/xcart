-- ============================================================================
-- 080 -- A campanha do FUNIL no historico vem da URL do proprio evento, e o
--        trio campanha/conjunto/anuncio e um bloco.
--
-- O PROBLEMA (medido em producao em 24/10/2026, so SELECT, lojas reais)
--
-- Na 079, campanha/conjunto/anuncio do funil (evento sem pedido) saiam SO da
-- identidade do visitante (tracking_identities.utm). A URL do proprio evento
-- era ignorada. Mas o coletor so grava identidade com o clientId da Shopify
-- (collect/route.ts: `if (clientId && ...) publicarIdentidade()`), e a ponte
-- (public/xcart-bridge.js) nunca manda clientId: todo page_view (fonte
-- 'ponte') ficava sem campanha -- 0 dos 689 do historico, e 578 deles com o
-- id da campanha na propria URL. No view_item, a identidade e trocada pelo
-- clique seguinte (o {"clique":"meta"} do snippet) minutos depois, e o evento
-- que tinha a campanha na URL ficava sem ela: 131 dos 1.796 da fila. A perda
-- fica permanente quando a linha sai da fila: 14 dias (o primeiro page_view
-- de 24/10 sai ~07/11).
--
-- E cada nivel era decidido sozinho contra o gravado (coalesce(a.x, n.x)): o
-- (gad, null, null) do Google gravado + uma identidade nova do Meta (C, S, A)
-- virava (gad, S, A), combinacao que nao existe -- e que vira linha propria no
-- tracking_historico_diario.
--
-- A REGRA NOVA (so tracking_arquivar muda; o compactar e o purge, nao)
--
--   - Funil: PRIMEIRO a UTM da URL do proprio evento -- event_source_url
--     (Meta), page.url (TikTok) e pageUrl (Google antigo), as tres em
--     CAMPOS_DO_RESUMO (src/lib/tracking/retencao.ts), entao valem sobre
--     payload ja resumido. A leitura e a do TS, sem tirar nem por
--     (tracking_anuncio_da_url, abaixo): parametrosDaUrl com o corte de
--     CORTE_PAGINA, utmDeParametros, plataformaDe com os click ids da propria
--     URL (cliquesDeParametros) e niveisDoAnuncio -- o conjunto no utm_term so
--     no Meta, e quem decide e o utm_medium ser id ou nao. So se a URL nao tem
--     id NENHUM vale a identidade, como na 079. A page.url do TikTok e
--     reescrita e perde o ttclid: dela so sai o nivel que as leituras possiveis
--     da original dao igual (ver a funcao).
--   - A URL e lida UMA vez por evento: na primeira passada que o arquiva.
--     Relida, o resultado ia fora (com id gravado vale o gravado; sem, a mesma
--     URL ja tinha dado nulo), e a passada das 48 h le as mesmas linhas toda
--     hora -- com a URL vinda do coletor publico, um IP montava URL cara ate
--     estourar os 8 s do purge, que volta atras inteiro, todas as lojas. So a
--     passada (null, null), que so esta migration roda, rele: completa o trio
--     vazio que a 079 gravou.
--   - O trio e um BLOCO nos dois pontos: o da URL ou o da identidade (nunca um
--     pedaco de cada), e contra o gravado -- com origem do pedido vale a
--     origem (como na 079); senao, linha gravada com QUALQUER um dos tres ids
--     fica com os tres dela; sem nenhum, ganha os tres de agora.
--   - Compra e IC de garantia (evento com pedido) nao mudam: a origem do
--     pedido (fin_order_origem), seguida enquanto a compra esta na fila.
--
-- EFEITO MEDIDO (24/10, o texto deste arquivo inline num SELECT sobre a fila
-- das lojas reais, contra o historico gravado): a passada do fim deste arquivo
-- muda 721 linhas, todas de trio vazio para trio -- nenhuma linha gravada com
-- id muda --; page_view com campanha 596 de 713; view_item 776 dos 1.787 da
-- fila. Todo id produzido casa '^[0-9]{5,25}$'. A leitura da URL deu o mesmo
-- que o TS em 3.000 URLs geradas (o gerador de tests/tracking-historico.test
-- .ts) e o mesmo que a primeira versao desta 080 nas 2.180 URLs distintas da
-- fila, e o historico final das duas e igual linha a linha (md5 dos 2.714
-- trios). Na page.url do TikTok (8.000 originais geradas, ~2.200 cortadas pelo
-- coletor), nenhum id que o TS nao daria na original; lida como a URL do
-- coletor, 215 davam.
--
-- O CUSTO (24/10, tempo do servidor, inline -- a funcao real ainda paga a
-- chamada, ~10-100 us, nao medida): a passada das 48 h (1.110 eventos) foi de
-- 33 ms (a 079) para 53 ms, quase tudo o join do historico que diz se o evento
-- ja foi arquivado (~10 us por evento); a da migration (2.714 eventos, 1.582
-- leem a URL), 336 ms. Por URL: a real do Meta 0,22 ms (era 0,46); a pior que
-- achei, 0,67 ms (tres UTMs de 160 caracteres com UTF-8 invalido alternado);
-- 243 pares vazios 0,37 ms (era 0,81); "%41&" x130, 0,31 ms (era 2,04). Um IP
-- no teto do coletor (1.500 eventos/hora/loja) poe 1.500 URLs novas por hora:
-- ~1 s numa passada, contra ~150 s quando toda passada das 48 h relia as 72
-- mil.
--
-- NADA AQUI PODE LANCAR POR DADO DA FILA (uma excecao derruba o expurgo da
-- hora inteira, de todas as lojas): todo id que vai para coluna com CHECK sai
-- de filtro com a mesma regex do CHECK ('^[0-9]{5,25}$'); o convert_from so
-- ve sequencia UTF-8 que a regex ja validou (e o byte 00, que ele recusa, sai
-- antes); decode() so ve hexadecimal; nenhum cast.
--
-- ORDEM: antes ou depois do deploy, tanto faz -- nenhum codigo depende dela, e
-- nenhum leitor muda. O purge_tracking() da 079 chama tracking_arquivar pelo
-- nome: passa a usar a versao daqui na hora seguinte. A passada do fim deste
-- arquivo ja completa o que ainda esta na fila -- e e a UNICA chance: o purge
-- nao rele evento arquivado. Aplicar fora dos 10 primeiros minutos da hora
-- (quando o drain chama o purge_tracking): o lock dessa passada esperaria por
-- ele.
--
-- Funcao nova em public vira endpoint em /rest/v1/rpc/: a daqui
-- (tracking_anuncio_da_url) revoga de public, anon e authenticated e da
-- EXECUTE so ao service_role (migration 027); o tracking_arquivar repete o da
-- 079 (create or replace mantem o grant, mas fica escrito). Conferir no fim do
-- arquivo.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Campanha, conjunto e anuncio da URL de um evento
-- ---------------------------------------------------------------------------
-- O que o TS faz com a URL da pagina (src/lib/tracking/utm.ts), na ordem:
--
--   parametrosDaUrl(url, CORTE_PAGINA)  o trim() do JS; sem '?', nada. O
--       parser de URL tira C0 e espaco das pontas e TAB/LF/CR de qualquer
--       lugar, e a query vai do primeiro '?' ao '#'. '&' separa, o primeiro
--       '=' divide nome e valor, e os dois sao lidos como o URLSearchParams:
--       '+' vira espaco e %XX vira o byte, e os bytes sao lidos como UTF-8 --
--       sequencia invalida vira U+FFFD, uma por "maximal subpart" (o decoder
--       do WHATWG); '%' sem dois hexadecimais fica como esta. Com a URL perto
--       do corte de 500 (.length >= 495, em UTF-16 como o JS) a CHAVE do
--       ultimo parametro sai inteira (o delete() tira toda ocorrencia), menos
--       o fbclid que prova estar inteiro (FBCLID_COMPLETO, testado no
--       PRIMEIRO fbclid, como o p.get()).
--   utmDeParametros    a PRIMEIRA ocorrencia de cada utm_*, pelo limparValor
--       (sem controle, trim, 200 em UTF-16, trim, sem '@'), e o
--       gad_campaignid com trim e so digitos. O macro ({{campaign.id}}) nao
--       precisa sair: nao termina em digito, entao nunca da id.
--   plataformaDe       == 'meta': gclid/gbraid/wbraid = Google; fbclid = Meta;
--       ttclid = TikTok (cliquesDeParametros: presente = nao vazio depois do
--       trim); senao a fonte (FONTES_META, em minuscula como o toLowerCase do
--       JS: A-Z e o sinal de Kelvin, o unico outro que vira letra ASCII).
--   niveisDoAnuncio    campanha = idDe(utm_campaign) ?? idDe(utm_id) ?? gad;
--       conjunto = idDe(utm_medium) e, SO no Meta, idDe(utm_term); anuncio =
--       idDe(utm_content). idDe = o que vem depois da ULTIMA barra, com trim,
--       so digitos (5 a 25) -- a regex do CHECK das colunas.
--
-- O CUSTO. O purge_tracking() tem os 8 s do PostgREST, e a URL vem do coletor
-- publico (qualquer http(s) ate 500 caracteres, 1.500 eventos por hora por
-- IP). Por isso:
--   - URL sem chave que de id nao e lida: o nome so vira utm_* ou
--     gad_campaignid se cada caractere de "utm_" ou "gad_c" estiver nela, cru
--     ou em %XX (TAB/LF/CR, que o parser tira, saem antes). O filtro e um
--     superconjunto -- deixa passar o que nao e chave, nunca barra o que e.
--   - O NOME do par so e decodificado se puder ser uma das 12 chaves: so
--     [a-z_] cru ou o %XX de [a-z_] (o replace dos 27, sem regex por byte).
--     Fora isso ele nao e chave, e vira null (o ultimo par null nao tira
--     nada, como nao tiraria nenhuma chave no TS).
--   - O VALOR so e decodificado nas 12 chaves, na primeira ocorrencia.
--   - Nenhuma funcao SQL chamada aqui dentro: esta funcao nao vira inline (o
--     SET search_path impede), e no PG 17 a funcao SQL chamada de dentro dela
--     refaz o parse e o plano a cada chamada de fora.
--
-- p_do_tiktok: a URL e a page.url do TikTok, urlSemTtclid(url) -- sem o
-- ttclid e com a query REESCRITA pelo URLSearchParams, depois do corte do
-- coletor. O tamanho dela nao diz se o coletor cortou a original, e o ttclid
-- que decidia a plataforma sumiu. O TS, na original, da uma de quatro
-- leituras desta: com ou sem o ultimo parametro (o cortado pela metade era o
-- ultimo da original -- ou e o ultimo daqui, ou era o ttclid, que ja saiu), e
-- com ou sem o ttclid na plataforma. Cada nivel so sai se as quatro derem o
-- MESMO id; senao, nada. Tirar o ultimo sempre nao serve: sem o utm_campaign
-- a campanha cai no utm_id, que pode ser OUTRO id. Acima de 500 caracteres
-- (a reescrita codifica o que a original tinha cru) nao ha leitura. Assim a
-- page.url so pode PERDER um nivel que o TS acharia na original -- nunca dar
-- um id que ele nao daria.
--
-- O trim e o do JS (WS abaixo), nao o \s do Postgres, que depende do locale.
-- URL que o new URL() recusaria (host invalido) nao chega aqui: a do coletor e
-- o location.href do navegador; se chegasse, a query seria lida mesmo assim.
-- O texto do Postgres nao guarda U+0000: o byte 00 vira '' nas UTMs (o
-- limparValor do TS o tira de qualquer jeito) e U+FFFD nas outras chaves.
-- O convert_from so ve sequencia UTF-8 que a regex ja validou (e o 00, que ele
-- recusa, sai antes); decode() so ve hexadecimal; nenhum cast.
-- Travado contra o TS por tests/tracking-historico.test.ts (gerada e real).
create or replace function public.tracking_anuncio_da_url(
  p_url text,
  p_do_tiktok boolean,
  out campanha_id text,
  out conjunto_id text,
  out anuncio_id text)
returns record
language sql
immutable
set search_path = public, pg_temp
as $$
  with entrada as (
    select x.b
      from (select regexp_replace(p_url,
                                  '^[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$', '', 'g') as b
             -- page.url do TikTok acima dos 500: a reescrita cresceu, e nao ha
             -- leitura segura (ver o cabecalho).
             where not (p_do_tiktok and char_length(p_url) > 500)
               and translate(p_url, chr(9) || chr(10) || chr(13), '')
                     ~ '(?:u|%75)(?:t|%74)(?:m|%6[Dd])(?:_|%5[Ff])|(?:g|%67)(?:a|%61)(?:d|%64)(?:_|%5[Ff])(?:c|%63)') x
     where position('?' in x.b) > 0
  ),
  consulta as (
    select substr(y.s, position('?' in y.s) + 1) as q,
           p_do_tiktok
             or char_length(e.b) + char_length(regexp_replace(e.b, '[\u0001-\uffff]+', '', 'g')) >= 495 as cortada
      from entrada e
     cross join lateral (
       select split_part(regexp_replace(regexp_replace(e.b, '^[\u0001-\u0020]+|[\u0001-\u0020]+$', '', 'g'),
                                        '[\u0009\u000a\u000d]', '', 'g'), '#', 1) as s
     ) y
     where position('?' in y.s) > 0
  ),
  -- '&' separa, o primeiro '=' divide nome e valor. O nome que pode ser chave
  -- e decodificado aqui mesmo: com o lower(), todo %XX que sobra e de [a-z_].
  pares as (
    select s.n,
           case when position('%' in r.nome) = 0 then r.nome
                when r.nome ~ '^(?:[a-z_]|%(?:5[Ff]|6[1-9A-Fa-f]|7[0-9Aa]))+$'
                then replace(replace(replace(replace(replace(replace(replace(replace(replace(
                     replace(replace(replace(replace(replace(replace(replace(replace(replace(
                     replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(r.nome),
                       '%5f', '_'), '%61', 'a'), '%62', 'b'), '%63', 'c'), '%64', 'd'), '%65', 'e'), '%66', 'f'),
                       '%67', 'g'), '%68', 'h'), '%69', 'i'), '%6a', 'j'), '%6b', 'k'), '%6c', 'l'), '%6d', 'm'),
                       '%6e', 'n'), '%6f', 'o'), '%70', 'p'), '%71', 'q'), '%72', 'r'), '%73', 's'), '%74', 't'),
                       '%75', 'u'), '%76', 'v'), '%77', 'w'), '%78', 'x'), '%79', 'y'), '%7a', 'z')
           end as nome,
           substr(s.seg, char_length(r.nome) + 2) as valor
      from consulta c
     cross join lateral string_to_table(c.q, '&') with ordinality s(seg, n)
     cross join lateral (select split_part(s.seg, '=', 1) as nome) r
     where s.seg <> ''
  ),
  primeiros as (
    select distinct on (p.nome) p.nome, p.valor
      from pares p
     where p.nome in ('utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id',
                      'gad_campaignid', 'fbclid', 'gclid', 'gbraid', 'wbraid', 'ttclid')
     order by p.nome, p.n
  ),
  -- Perto do corte, a chave do ultimo par sai (tirada). Decodificado so o que
  -- pode ficar, e o fbclid, que a regra do fbclid inteiro le -- na page.url
  -- do TikTok, tudo (as leituras sao com e sem a tirada).
  ultimo as (
    select u.nome
      from consulta c
     cross join lateral (select p.nome from pares p order by p.n desc limit 1) u
     where c.cortada
  ),
  -- O valor, como o URLSearchParams. Pedacos: uma sequencia de %XX, um trecho
  -- sem '%', ou um '%' solto. Os bytes de cada sequencia: a sequencia UTF-8
  -- valida inteira, o comeco valido de uma que parou no meio, ou um byte so
  -- (alternativa no topo da regex = a mais longa, no Postgres).
  decodificados as (
    select f.nome,
           case when position('%' in f.valor) = 0 then replace(f.valor, '+', ' ')
                else (select string_agg(
                               case when x.h is null then (t.m)[1]
                                    -- A sequencia inteira e UTF-8 valido, sem o 00: de uma vez.
                                    when x.h ~ '^(?:0[1-9a-f]|[1-7][0-9a-f]|(?:c[2-9a-f]|d[0-9a-f])[89ab][0-9a-f]|e0[ab][0-9a-f][89ab][0-9a-f]|(?:e[1-9a-c]|e[ef])[89ab][0-9a-f][89ab][0-9a-f]|ed[89][0-9a-f][89ab][0-9a-f]|f0[9ab][0-9a-f][89ab][0-9a-f][89ab][0-9a-f]|f[1-3][89ab][0-9a-f][89ab][0-9a-f][89ab][0-9a-f]|f48[0-9a-f][89ab][0-9a-f][89ab][0-9a-f])+$'
                                    then convert_from(decode(x.h, 'hex'), 'UTF8')
                                    else (select string_agg(
                                                   case when (b.m)[1] = '00' then k.nul
                                                        when (b.m)[1] ~ '^(?:[0-7][0-9a-f]|(?:c[2-9a-f]|d[0-9a-f])[89ab][0-9a-f]|e0[ab][0-9a-f][89ab][0-9a-f]|(?:e[1-9a-c]|e[ef])[89ab][0-9a-f][89ab][0-9a-f]|ed[89][0-9a-f][89ab][0-9a-f]|f0[9ab][0-9a-f][89ab][0-9a-f][89ab][0-9a-f]|f[1-3][89ab][0-9a-f][89ab][0-9a-f][89ab][0-9a-f]|f48[0-9a-f][89ab][0-9a-f][89ab][0-9a-f])$'
                                                        then convert_from(decode((b.m)[1], 'hex'), 'UTF8')
                                                        else chr(65533)
                                                   end, '' order by b.n)
                                            from regexp_matches(x.h, '[0-7][0-9a-f]|(?:c[2-9a-f]|d[0-9a-f])[89ab][0-9a-f]|e0[ab][0-9a-f][89ab][0-9a-f]|(?:e[1-9a-c]|e[ef])[89ab][0-9a-f][89ab][0-9a-f]|ed[89][0-9a-f][89ab][0-9a-f]|f0[9ab][0-9a-f][89ab][0-9a-f][89ab][0-9a-f]|f[1-3][89ab][0-9a-f][89ab][0-9a-f][89ab][0-9a-f]|f48[0-9a-f][89ab][0-9a-f][89ab][0-9a-f]|e0[ab][0-9a-f]|(?:e[1-9a-c]|e[ef])[89ab][0-9a-f]|ed[89][0-9a-f]|f0[9ab][0-9a-f](?:[89ab][0-9a-f])?|f[1-3][89ab][0-9a-f](?:[89ab][0-9a-f])?|f48[0-9a-f](?:[89ab][0-9a-f])?|[0-9a-f]{2}', 'g')
                                                 with ordinality b(m, n))
                               end, '' order by t.n)
                        from regexp_matches(replace(f.valor, '+', ' '), '(?:%[0-9A-Fa-f]{2})+|[^%]+|%', 'g') with ordinality t(m, n)
                       cross join lateral (
                         select case when (t.m)[1] ~ '^%[0-9A-Fa-f]{2}' then lower(replace((t.m)[1], '%', '')) end as h
                       ) x)
           end as v
      from primeiros f
     -- O byte 00: '' na UTM, U+FFFD nas outras chaves (ver o cabecalho).
     cross join lateral (select case when f.nome like 'utm%' then '' else chr(65533) end as nul) k
     where p_do_tiktok or f.nome is distinct from (select u.nome from ultimo u) or f.nome = 'fbclid'
  ),
  tirada as (
    select u.nome
      from ultimo u
     where not (u.nome = 'fbclid'
                and coalesce((select d.v from decodificados d where d.nome = 'fbclid'), '') ~ '_aem_[A-Za-z0-9_-]{22}$')
  ),
  -- tirado: a chave que sai no corte. A leitura do TS e sem ela (leituras).
  valores as (
    select d.nome, d.v, d.nome is not distinct from (select t.nome from tirada t) as tirado
      from decodificados d
  ),
  limpos as (
    select z.nome, z.tirado, case when z.d <> '' and position('@' in z.d) = 0 then z.d end as v
      from (
        select w.nome, w.tirado,
               regexp_replace(
                 case when char_length(w.t) + char_length(regexp_replace(w.t, '[\u0001-\uffff]+', '', 'g')) <= 200 then w.t
                      -- O slice(0, 200) do JS conta UTF-16: o caractere fora do
                      -- plano basico vale 2, e o que fica partido no 200 deixa
                      -- meio caractere (U+FFFD aqui: nao e digito nem espaco).
                      else (select string_agg(k.ch, '' order by k.n) filter (where k.ate <= 200)
                                   || case when bool_or(k.ate = 201 and k.peso = 2) then chr(65533) else '' end
                              from (select r.ch, r.n, r.peso, sum(r.peso) over (order by r.n) as ate
                                      from (select c.ch, c.n, case when ascii(c.ch) > 65535 then 2 else 1 end as peso
                                              from regexp_split_to_table(w.t, '') with ordinality c(ch, n)) r) k)
                 end,
                 '^[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$', '', 'g') as d
          from (
            select v.nome, v.tirado,
                   regexp_replace(regexp_replace(v.v, '[\u0001-\u001f\u007f]', '', 'g'),
                                  '^[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$', '', 'g') as t
              from valores v
             where v.nome like 'utm%'
          ) w
      ) z
  ),
  ids as (
    select l.nome, l.tirado, f.fim
      from limpos l
     cross join lateral (
       select regexp_replace(substring(l.v from '[^|]*$'), '^[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$', '', 'g') as fim
     ) f
     where f.fim ~ '^[0-9]{5,25}$'
  ),
  cliques as (
    select v.nome, v.tirado
      from valores v
     where v.nome in ('gclid', 'gbraid', 'wbraid', 'fbclid', 'ttclid')
       and regexp_replace(v.v, '^[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$', '', 'g') <> ''
  ),
  -- A leitura do TS: sem a chave tirada. Na page.url do TikTok, tambem COM ela
  -- (nao da para saber se o coletor cortou a original), e o conjunto tambem
  -- com o ttclid presente (ele sumiu da URL). Cada nivel so sai se TODA
  -- leitura der o mesmo id: o TS, na original, da uma delas (ver o cabecalho).
  leituras as (
    select x.campanha, x.anuncio,
           coalesce(x.meio, case when x.google then null
                                 when x.fbclid then x.termo
                                 when x.ttclid then null
                                 when x.fonte_meta then x.termo end) as conjunto,
           coalesce(x.meio, case when not x.google and x.fbclid then x.termo end) as conjunto_com_ttclid
      from (values (false), (true)) w(com_tirado)
     cross join lateral (
       select coalesce((select i.fim from ids i where i.nome = 'utm_campaign' and (w.com_tirado or not i.tirado)),
                       (select i.fim from ids i where i.nome = 'utm_id' and (w.com_tirado or not i.tirado)),
                       (select g.g
                          from (select regexp_replace(v.v, '^[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$', '', 'g') as g
                                  from valores v where v.nome = 'gad_campaignid' and (w.com_tirado or not v.tirado)) g
                         where g.g ~ '^[0-9]{5,25}$')) as campanha,
              (select i.fim from ids i where i.nome = 'utm_medium' and (w.com_tirado or not i.tirado)) as meio,
              (select i.fim from ids i where i.nome = 'utm_term' and (w.com_tirado or not i.tirado)) as termo,
              (select i.fim from ids i where i.nome = 'utm_content' and (w.com_tirado or not i.tirado)) as anuncio,
              exists (select 1 from cliques k where k.nome in ('gclid', 'gbraid', 'wbraid') and (w.com_tirado or not k.tirado)) as google,
              exists (select 1 from cliques k where k.nome = 'fbclid' and (w.com_tirado or not k.tirado)) as fbclid,
              exists (select 1 from cliques k where k.nome = 'ttclid' and (w.com_tirado or not k.tirado)) as ttclid,
              coalesce((select translate(l.v, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' || chr(8490), 'abcdefghijklmnopqrstuvwxyzk')
                                 in ('facebook', 'fb', 'ig', 'instagram', 'meta', 'facebook_ads', 'fbads', 'an', 'msg', 'messenger')
                            from limpos l where l.nome = 'utm_source' and (w.com_tirado or not l.tirado)), false) as fonte_meta
     ) x
     where not w.com_tirado or p_do_tiktok
  )
  select case when count(*) = count(l.campanha) and min(l.campanha) = max(l.campanha) then min(l.campanha) end,
         case when count(*) = count(l.conjunto) and min(l.conjunto) = max(l.conjunto)
                   and (not p_do_tiktok
                        or (count(*) = count(l.conjunto_com_ttclid)
                            and min(l.conjunto_com_ttclid) = min(l.conjunto)
                            and max(l.conjunto_com_ttclid) = min(l.conjunto)))
              then min(l.conjunto) end,
         case when count(*) = count(l.anuncio) and min(l.anuncio) = max(l.anuncio) then min(l.anuncio) end
    from leituras l;
$$;

comment on function public.tracking_anuncio_da_url(text, boolean) is
  'Campanha, conjunto e anuncio da URL de um evento, pela regra do TS (parametrosDaUrl com CORTE_PAGINA, utmDeParametros, plataformaDe com os click ids da URL, niveisDoAnuncio). p_do_tiktok: a page.url do TikTok, sem o ttclid e reescrita -- cada nivel so sai se as leituras com e sem o ultimo parametro, e com e sem o ttclid, derem o mesmo id. Todo id sai com a regex do CHECK.';

revoke all on function public.tracking_anuncio_da_url(text, boolean) from public, anon, authenticated;
grant execute on function public.tracking_anuncio_da_url(text, boolean) to service_role;


-- ---------------------------------------------------------------------------
-- 2. Fila -> historico (o corpo da 079, com a URL do evento e o trio em bloco)
-- ---------------------------------------------------------------------------
-- O resto e o da 079, sem tirar nem por: ver o cabecalho de la. INVOKER: quem
-- chama e o purge_tracking (DEFINER, dono postgres) e a migration.
create or replace function public.tracking_arquivar(p_desde timestamptz, p_ate timestamptz)
returns integer
language sql
volatile
security invoker
set search_path = public, pg_temp
as $$
  with lojas as (
    -- A loja de demonstracao fica de fora (ver o cabecalho da 079).
    select s.id, s.user_id from public.stores s where not s.demonstracao
  ),
  linhas as (
    -- `= any` e nao join: usa o indice (store_id, created_at) por loja.
    select e.store_id, e.event_id, e.event_name, e.destination, e.destination_id,
           e.status, e.sent_at, e.visitor_id, e.checkout_token, e.order_id,
           e.payload, e.created_at,
           -- A URL da pagina do evento nas tres plataformas, as tres em
           -- CAMPOS_DO_RESUMO. A do Meta e a original; a do TikTok sai sem o
           -- ttclid (urlSemTtclid); a do Google e de linha antiga.
           e.payload ->> 'event_source_url' as url_meta,
           e.payload -> 'page' ->> 'url' as url_tiktok,
           e.payload ->> 'pageUrl' as url_google,
           -- A reserva CANCELADA: o expresso ou o clique comum que o
           -- begin_checkout do pixel (ou do tema) fechou sem mandar --
           -- fechamentoDoExpresso do coletor. Nao e evento: contada, o
           -- checkout tinha dois IC no historico, e ela saia igual a reserva
           -- que falhou de verdade (Shop Pay com o Meta fora do ar).
           coalesce(e.status = 'enviado' and e.sent_at is null and e.last_error like 'cancelado:%'
                    and (e.event_id like 'begin_checkout_xp_%' or e.event_id like 'begin_checkout_rs_%'),
                    false) as cancelada
      from public.tracking_events e
     where e.store_id = any (array(select l.id from lojas l))
       and e.created_at >= coalesce(p_desde, '-infinity'::timestamptz)
       and e.created_at <  coalesce(p_ate, 'infinity'::timestamptz)
  ),
  -- Evento em que TODA linha e reserva cancelada: sai do historico, porque a
  -- passada das 48 h pode te-lo gravado ainda pendente (a reserva espera 2 a 5
  -- min pelo pixel).
  cancelados as (
    select l.store_id, md5(l.event_id)::uuid as chave
      from linhas l
     group by l.store_id, l.event_id
    having bool_and(l.cancelada)
  ),
  eventos as (
    -- UMA linha por evento: as linhas de cada destino tem o mesmo event_id
    -- (coletor e webhook mandam o mesmo id a todos os destinos).
    select l.store_id,
           l.event_id,
           min(l.created_at) as instante,
           coalesce(nullif(left(lower(min(l.event_name)), 60), ''), '?') as evento,
           case
             when lower(min(l.event_name)) = 'purchase' then 'webhook'
             -- Os prefixos de src/lib/tracking/eventos.ts (PREFIXOS_DE_RESERVA).
             when l.event_id like 'begin_checkout_xp_%' then 'expresso'
             when l.event_id like 'begin_checkout_rs_%' then 'reserva'
             -- O IC de garantia nasce no orders/create com o pedido em order_id;
             -- o coletor grava o proprio event_id ali.
             when lower(min(l.event_name)) = 'begin_checkout'
                  and max(l.order_id) ~ '^[0-9]{1,30}$' and max(l.order_id) <> l.event_id then 'garantia'
             -- So a ponte (xcart-bridge.js) manda page_view (eventos.ts).
             when lower(min(l.event_name)) = 'page_view' then 'ponte'
             when max(l.checkout_token) is not null then 'pixel'
             else 'navegador'
           end as fonte,
           min(l.visitor_id) as visitor_id,
           max(l.checkout_token) is not null as do_checkout,
           max(l.order_id) filter (where l.order_id ~ '^[0-9]{1,30}$' and l.order_id <> l.event_id) as pedido_id,
           -- Uma URL por evento: a mesma em toda linha da mesma plataforma. So
           -- a com query serve (sem '?' nao ha UTM): sem o filtro, o min()
           -- preferiria "https://loja/p" a "https://loja/p?utm_...".
           coalesce(min(l.url_meta) filter (where position('?' in l.url_meta) > 0),
                    min(l.url_tiktok) filter (where position('?' in l.url_tiktok) > 0),
                    min(l.url_google) filter (where position('?' in l.url_google) > 0)) as url,
           -- A URL escolhida e a page.url do TikTok: reescrita e sem o ttclid
           -- (ver tracking_anuncio_da_url).
           min(l.url_meta) filter (where position('?' in l.url_meta) > 0) is null
             and min(l.url_tiktok) filter (where position('?' in l.url_tiktok) > 0) is not null as url_do_tiktok,
           coalesce(array_agg(distinct l.destination_id) filter (where l.destination_id is not null),
                    '{}'::uuid[]) as destinos,
           -- Chegou = 'enviado' COM sent_at; o 'enviado' sem sent_at fechou sem
           -- sair (teste -- 058). A reserva cancelada nem chega aqui.
           array_agg(distinct l.destination_id) filter (
             where l.destination_id is not null
               and not (l.status = 'enviado' and l.sent_at is not null)) as nao_enviados,
           coalesce(bool_or(public.tracking_evento_teste(l.destination, l.payload)), false) as teste,
           -- O clique como o painel le (059): do payload que foi para a plataforma.
           coalesce(bool_or(case l.destination
             when 'meta' then nullif(l.payload -> 'user_data' ->> 'fbc', '') is not null
             when 'google' then coalesce(nullif(l.payload ->> 'gclid', ''), nullif(l.payload ->> 'gbraid', ''),
                                         nullif(l.payload ->> 'wbraid', '')) is not null
             when 'tiktok' then nullif(l.payload -> 'user' ->> 'ttclid', '') is not null
             else false
           end), false) as com_clique,
           -- Valor e moeda so da compra: Meta (custom_data), TikTok (properties),
           -- Google antigo (raiz).
           max(coalesce(l.payload -> 'custom_data' ->> 'value', l.payload -> 'properties' ->> 'value',
                        l.payload ->> 'value'))
             filter (where lower(l.event_name) = 'purchase') as valor_txt,
           max(upper(coalesce(l.payload -> 'custom_data' ->> 'currency', l.payload -> 'properties' ->> 'currency',
                              l.payload ->> 'currency')))
             filter (where lower(l.event_name) = 'purchase') as moeda_txt
      from linhas l
     where not l.cancelada
     group by l.store_id, l.event_id
  ),
  novos as (
    select ev.store_id,
           lj.user_id,
           md5(ev.event_id)::uuid as chave,
           case when ev.visitor_id is not null then md5(ev.visitor_id)::uuid end as visitante,
           ev.instante,
           ev.teste,
           ev.com_clique,
           ev.evento,
           ev.fonte,
           -- O pedido tem origem gravada: ela manda na campanha (ver gravados).
           o.shopify_order_id is not null as com_origem,
           -- O trio de UM lugar so: a origem do pedido (compra e IC de
           -- garantia); no funil, a URL do proprio evento e, se ela nao tem id
           -- nenhum, a UTM do ultimo clique do visitante -- niveisDoAnuncio
           -- (utm.ts) com a plataforma do toque "identidade" de
           -- origem-pedido.ts: o `clique` da UTM, senao a fonte.
           case when o.shopify_order_id is not null then o.campanha_id
                when coalesce(d.campanha_id, d.conjunto_id, d.anuncio_id) is not null then d.campanha_id
                else coalesce(public.tracking_id_de_utm(idt.utm ->> 'campaign'),
                              public.tracking_id_de_utm(idt.utm ->> 'id'),
                              case when idt.utm ->> 'gad' ~ '^[0-9]{5,25}$' then idt.utm ->> 'gad' end)
           end as campanha_id,
           case when o.shopify_order_id is not null then o.conjunto_id
                when coalesce(d.campanha_id, d.conjunto_id, d.anuncio_id) is not null then d.conjunto_id
                else coalesce(public.tracking_id_de_utm(idt.utm ->> 'medium'),
                              case when idt.meta then public.tracking_id_de_utm(idt.utm ->> 'term') end)
           end as conjunto_id,
           case when o.shopify_order_id is not null then o.anuncio_id
                when coalesce(d.campanha_id, d.conjunto_id, d.anuncio_id) is not null then d.anuncio_id
                else public.tracking_id_de_utm(idt.utm ->> 'content')
           end as anuncio_id,
           ev.pedido_id,
           case when ev.valor_txt ~ '^-?[0-9]{1,12}([.][0-9]+)?$' then round(ev.valor_txt::numeric, 2) end as valor,
           case when ev.moeda_txt ~ '^[A-Z]{3}$' then ev.moeda_txt end as moeda,
           ev.destinos,
           ev.nao_enviados
      from eventos ev
      join lojas lj on lj.id = ev.store_id
      -- Compra e IC de garantia: a origem gravada no pedido (071), que ja e a
      -- cascata inteira do TS.
      left join public.fin_order_origem o
        on ev.pedido_id is not null and o.store_id = ev.store_id and o.shopify_order_id = ev.pedido_id
      -- Funil: a UTM do ultimo clique do visitante, na janela de naJanela()
      -- (origem-pedido.ts): ate 7 dias antes e 1 dia depois do evento. O
      -- visitante do tema pelo visitor_id; o do pixel (visitor_id = clientId)
      -- pelo shopify_client_id.
      left join lateral (
        select i.utm,
               coalesce(
                 case when lower(btrim(i.utm ->> 'clique')) in ('meta', 'google', 'tiktok')
                      then lower(btrim(i.utm ->> 'clique')) = 'meta' end,
                 -- FONTES_META de utm.ts.
                 lower(btrim(i.utm ->> 'source')) in
                   ('facebook', 'fb', 'ig', 'instagram', 'meta', 'facebook_ads', 'fbads', 'an', 'msg', 'messenger'),
                 false) as meta
          from public.tracking_identities i
         where ev.pedido_id is null
           and ev.visitor_id is not null
           and i.store_id = ev.store_id
           and (i.visitor_id = ev.visitor_id or (ev.do_checkout and i.shopify_client_id = ev.visitor_id))
           and i.utm is not null
           and i.utm_em >= ev.instante - interval '7 days'
           and i.utm_em <= ev.instante + interval '1 day'
         order by i.utm_em desc
         limit 1
      ) idt on true
      -- O que o historico ja tem do evento, antes desta passada.
      left join public.tracking_historico a0
        on a0.store_id = ev.store_id and a0.chave = md5(ev.event_id)::uuid
      -- Funil: a UTM da URL do proprio evento (080), lida UMA vez por evento:
      -- na primeira passada que o arquiva. Depois ela nao muda nada -- com id
      -- gravado vale o gravado (gravados), e sem id a mesma URL ja deu nulo.
      -- A passada das 48 h le as mesmas linhas toda hora, e a URL vem do
      -- coletor publico: relida, um IP montava URL cara ate estourar os 8 s do
      -- purge. A excecao e a passada sem limite nenhum (null, null), que so a
      -- migration roda: completa o trio vazio do que a 079 gravou. O offset 0
      -- deixa a condicao fora da funcao (o filtro de uma vez por linha):
      -- falsa, a funcao nem e chamada.
      left join lateral (
        select u.campanha_id, u.conjunto_id, u.anuncio_id
          from public.tracking_anuncio_da_url(ev.url, ev.url_do_tiktok) u
         where ev.pedido_id is null
           and ev.url is not null
           and (a0.chave is null
                or (p_desde is null and p_ate is null
                    and coalesce(a0.campanha_id, a0.conjunto_id, a0.anuncio_id) is null))
        offset 0
      ) d on true
  ),
  gravados as (
    insert into public.tracking_historico as h
      (store_id, user_id, chave, visitante, instante, teste, com_clique, evento, fonte,
       campanha_id, conjunto_id, anuncio_id, pedido_id, valor, moeda, destinos, nao_enviados)
    select n.store_id, n.user_id, n.chave,
           coalesce(a.visitante, n.visitante),
           least(a.instante, n.instante),
           coalesce(a.teste, false) or n.teste,
           coalesce(a.com_clique, false) or n.com_clique,
           coalesce(a.evento, n.evento),
           coalesce(a.fonte, n.fonte),
           -- No evento com origem do pedido, ela vence: o sync troca a origem
           -- pela jornada da Shopify 20-30 min depois do pedido, e a passada
           -- da hora ja tinha gravado a do webhook -- a aba Campanhas le a
           -- fin_order_origem, e o historico tem que bater com ela. No funil
           -- o que ja estava gravado vence, e o TRIO INTEIRO: linha gravada
           -- com qualquer id fica com os tres dela (a identidade muda com o
           -- proximo clique; nivel a nivel, o (gad, null, null) do Google
           -- virava (gad, conjunto, anuncio) do Meta); sem nenhum, os tres de
           -- agora. Valor e moeda tambem: o payload da compra vira resumo aos
           -- 8 dias.
           case when n.com_origem then n.campanha_id
                when coalesce(a.campanha_id, a.conjunto_id, a.anuncio_id) is not null then a.campanha_id
                else n.campanha_id end,
           case when n.com_origem then n.conjunto_id
                when coalesce(a.campanha_id, a.conjunto_id, a.anuncio_id) is not null then a.conjunto_id
                else n.conjunto_id end,
           case when n.com_origem then n.anuncio_id
                when coalesce(a.campanha_id, a.conjunto_id, a.anuncio_id) is not null then a.anuncio_id
                else n.anuncio_id end,
           coalesce(a.pedido_id, n.pedido_id),
           coalesce(a.valor, n.valor),
           coalesce(a.moeda, n.moeda),
           m.destinos,
           nullif(array(select x from unnest(m.destinos) x where x <> all (m.enviados) order by x), '{}'::uuid[])
      from novos n
      left join public.tracking_historico a on a.store_id = n.store_id and a.chave = n.chave
      -- A uniao: os destinos de antes e de agora, e quem recebeu em qualquer
      -- das duas leituras (a linha 'enviado' do funil sai aos 14 dias e a
      -- 'falhou' aos 30: a segunda leitura nao ve a primeira).
      cross join lateral (
        select array(select distinct x from unnest(coalesce(a.destinos, '{}'::uuid[]) || n.destinos) x order by x)
                 as destinos,
               array(select x from unnest(coalesce(a.destinos, '{}'::uuid[])) x
                      where x <> all (coalesce(a.nao_enviados, '{}'::uuid[])))
               || array(select x from unnest(n.destinos) x
                         where x <> all (coalesce(n.nao_enviados, '{}'::uuid[])))
                 as enviados
      ) m
    on conflict (store_id, chave) do update set
      (visitante, instante, teste, com_clique, campanha_id, conjunto_id, anuncio_id,
       pedido_id, valor, moeda, destinos, nao_enviados)
      = (excluded.visitante, excluded.instante, excluded.teste, excluded.com_clique,
         excluded.campanha_id, excluded.conjunto_id, excluded.anuncio_id, excluded.pedido_id,
         excluded.valor, excluded.moeda, excluded.destinos, excluded.nao_enviados)
    -- Igual nao regrava: a passada das 48 h le as mesmas linhas toda hora.
    where (h.visitante, h.instante, h.teste, h.com_clique, h.campanha_id, h.conjunto_id, h.anuncio_id,
           h.pedido_id, h.valor, h.moeda, h.destinos, h.nao_enviados)
          is distinct from
          (excluded.visitante, excluded.instante, excluded.teste, excluded.com_clique,
           excluded.campanha_id, excluded.conjunto_id, excluded.anuncio_id, excluded.pedido_id,
           excluded.valor, excluded.moeda, excluded.destinos, excluded.nao_enviados)
    returning 1
  ),
  -- Chaves disjuntas das de `gravados` (o evento cancelado nao chega a
  -- `eventos`): o INSERT e o DELETE nunca tocam a mesma linha.
  apagados as (
    delete from public.tracking_historico h
     using cancelados c
     where h.store_id = c.store_id and h.chave = c.chave
    returning 1
  )
  select ((select count(*) from gravados) + (select count(*) from apagados))::integer;
$$;

comment on function public.tracking_arquivar(timestamptz, timestamptz) is
  'Fila -> historico: as linhas de tracking_events com created_at em [p_desde, p_ate) viram uma linha por evento em tracking_historico, juntada com a gravada. Funil: campanha da URL do evento, senao da identidade, o trio em bloco (080). Sem a loja de demonstracao e sem a reserva cancelada.';

revoke all on function public.tracking_arquivar(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.tracking_arquivar(timestamptz, timestamptz) to service_role;


-- ---------------------------------------------------------------------------
-- 3. Uma passada na fila inteira de hoje
-- ---------------------------------------------------------------------------
-- O que ainda esta na fila e a 079 gravou sem id ganha o trio da URL agora. E
-- a passada (null, null), a unica que rele evento ja arquivado (ver `d` no
-- tracking_arquivar): o purge_tracking() nunca roda essa, entao e aqui ou
-- nunca. Idempotente: rodar de novo nao muda nada. Linha gravada com id nao
-- muda.
--
-- O LOCK espera o purge que estiver no meio (so ele escreve no historico) e
-- segura o seguinte ate o commit. Sem ele, um purge ainda com o corpo da 079
-- que gravasse depois desta passada, com o retrato de antes dela, devolvia o
-- trio vazio -- e nenhuma passada da hora rele o evento. SHARE ROW EXCLUSIVE
-- nao barra leitura (painel, Campanhas) nem o coletor (que escreve na fila,
-- nao aqui). Estourou o lock_timeout: tudo volta atras, e e so rodar de novo.
set lock_timeout = '10s';
lock table public.tracking_historico in share row exclusive mode;
select public.tracking_arquivar(null, null);
analyze public.tracking_historico;
reset lock_timeout;


-- ============================================================================
-- Conferir depois de aplicar (027: o revoke responde sucesso sem garantir nada).
--
-- (a) As quatro primeiras devem dar false; as duas ultimas, true:
--   select has_function_privilege('anon', 'public.tracking_anuncio_da_url(text, boolean)', 'execute');
--   select has_function_privilege('authenticated', 'public.tracking_anuncio_da_url(text, boolean)', 'execute');
--   select has_function_privilege('anon', 'public.tracking_arquivar(timestamptz, timestamptz)', 'execute');
--   select has_function_privilege('authenticated', 'public.tracking_arquivar(timestamptz, timestamptz)', 'execute');
--   select has_function_privilege('service_role', 'public.tracking_anuncio_da_url(text, boolean)', 'execute');
--   select has_function_privilege('service_role', 'public.tracking_arquivar(timestamptz, timestamptz)', 'execute');
--
-- (b) A regra, sem tocar em dado (como service_role ou postgres):
--   select * from public.tracking_anuncio_da_url(
--     'https://loja.shop/p?utm_source=fb&utm_medium=paid&utm_campaign=120200000000000001&utm_term=120200000000000002&utm_content=120200000000000003', false);
--     -- (120200000000000001, 120200000000000002, 120200000000000003): Meta, conjunto no utm_term
--   select * from public.tracking_anuncio_da_url(
--     'https://loja.shop/p?utm_source=google&utm_medium=cpc&utm_campaign=Campanha%7C1234567&utm_term=7654321', false);
--     -- (1234567, null, null): fora do Meta o utm_term nao e conjunto
--   select * from public.tracking_anuncio_da_url(
--     'https://loja.shop/p?utm_source=tiktok&utm_medium=1845123456789013&utm_campaign=1845123456789012&utm_content=18451234', true);
--     -- (1845123456789012, 1845123456789013, null): a page.url do TikTok pode ser a
--     -- original cortada no meio do utm_content -- o anuncio nao sai
--
-- (c) page_view e view_item com campanha, ANTES e DEPOIS de aplicar (a medida
--     de 24/10: page_view 0 -> 578 de 689; view_item 652 -> 783 de 3.109):
--   select evento, count(*) as eventos, count(*) filter (where campanha_id is not null) as com_campanha
--     from public.tracking_historico
--    where evento in ('page_view', 'view_item')
--    group by 1 order by 1;
--
-- (d) Logo depois de aplicar: nenhum evento de funil ainda na fila com id na
--     URL e o trio vazio no historico (a passada do fim deste arquivo os
--     preencheu). Esperado 0, como service_role ou postgres:
--   select count(*) from public.tracking_historico h
--     join public.tracking_events e on e.store_id = h.store_id and md5(e.event_id)::uuid = h.chave
--     cross join lateral public.tracking_anuncio_da_url(e.payload ->> 'event_source_url', false) u
--    where h.pedido_id is null
--      and coalesce(u.campanha_id, u.conjunto_id, u.anuncio_id) is not null
--      and coalesce(h.campanha_id, h.conjunto_id, h.anuncio_id) is null;
-- ============================================================================
