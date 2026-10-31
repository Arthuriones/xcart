# App do celular do Panda Track

Expo SDK 58 + Expo Router. O plano está em [`../plano-de-acao/01-app-celular.md`](../plano-de-acao/01-app-celular.md) (Fase 3).

- **Abas:**
  - Dashboard: o mesmo lucro do site;
  - Campanhas: com ligar/pausar, orçamento e lance do Meta;
  - Ajustes: aviso de venda, sair e excluir a conta.
- **Login:** a mesma conta do site. O app não vende plano (regra 3.1.1 da Apple).
- **Dados:** tudo vem das rotas `/api/app/v1/*` e `/api/ads/meta/*` do site, com `Authorization: Bearer <token do Supabase>`. O filtro (loja, período, moeda, comparação) vai nos cabeçalhos `x-xc-*`.

## Fica fora do site

`mobile/` tem `package.json`, `tsconfig` e lint próprios. Ele está fora do typecheck, do lint e do deploy do site (`tsconfig.json`, `eslint.config.mjs` e `vercel.json` da raiz): commit que só mexe aqui não gera deploy na Vercel.

## Rodar no computador

```bash
cd mobile
npm install
npx expo start --web
```

- `.env.local` (não vai para o git) leva `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` (a chave **pública**, a mesma `NEXT_PUBLIC_` do site) e `EXPO_PUBLIC_API_URL`.
- O navegador serve para ver as telas. O aviso de venda (push) só funciona no celular, com um *development build*.

Conferências:

```bash
npx tsc --noEmit
npx expo-doctor
```

## Gerar o app (EAS)

Precisa de conta na Expo (grátis) e, para as lojas, das contas da Apple e do Google (Fase 0 do plano).

```bash
npm i -g eas-cli
eas login
eas init                      # grava extra.eas.projectId no app.json (o push precisa dele)
eas env:create --name EXPO_PUBLIC_SUPABASE_URL --value <URL do Supabase> --environment production --environment preview --environment development
eas env:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <chave pública> --environment production --environment preview --environment development
eas build --profile development --platform android   # instala no celular para testar o push
eas build --profile production --platform all        # para as lojas
```

- **Push no Android:** precisa da chave do Firebase (FCM V1) enviada com `eas credentials`.
- **Push no iPhone:** o `eas build` cria a chave na conta da Apple.

## Identificadores

- iOS: `app.xcart.pandatrack`
- Android: `app.xcart.pandatrack`
- Esquema de link: `pandatrack://`
