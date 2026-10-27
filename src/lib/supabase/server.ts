import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { comPrazoDoSupabase } from "./middleware";

// Prazo de 10 s por ida ao Supabase (login, banco, storage): acima dos 8 s do
// statement timeout, entao a consulta lenta ainda chega com o erro do banco
// (57014). Sem prazo, Auth ou PostgREST pendurado deixava a tela no esqueleto
// ate a Vercel matar a funcao. A renovacao do token fica com 15 s (o porque em
// comPrazoDoSupabase). O admin.ts fica sem: cron, upload e RPC longos.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { fetch: comPrazoDoSupabase(10_000) },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    }
  );
}
