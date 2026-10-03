// ============================================================================
// O formato do que as rotas de API do admin devolvem. As rotas sao o contrato
// (nao mudam); estes tipos so descrevem o JSON delas para as telas. Sem
// import de servidor: o cliente tambem usa.
// ============================================================================

export interface LojaResumida {
  domain: string;
  name: string;
}

/** Um usuario em GET /api/admin/overview (campo `users`). */
export interface UsuarioAdmin {
  id: string;
  email: string;
  plan: string | null;
  subscriptionStatus: string | null;
  aiCredits: number | null;
  accessGranted: boolean;
  isAdmin: boolean;
  hasAccess: boolean;
  stores: LojaResumida[];
  usageThisMonth: { costUsd: number; costBrl: number; credits: number };
  createdAt: string | null;
}

export interface CompraCredito {
  email: string;
  credits: number;
  amountBrl: number;
  currency: string;
  createdAt: string;
}

/** GET /api/admin/overview */
export interface VisaoAdmin {
  summary: {
    totalUsers: number;
    proUsers: number;
    withAccess: number;
    newUsersThisMonth: number;
    mrrBrl: number;
    aiCostThisMonthUsd: number;
    aiCostThisMonthBrl: number;
    usdBrlRate: number;
    totalStores: number;
    creditRevenueMonthBrl: number;
    creditRevenueTotalBrl: number;
    creditPurchasesTotal: number;
    grossMarginMonthBrl: number;
    payingUsers: number;
  };
  recentPurchases: CompraCredito[];
  /** Ultimos 6 meses, do mais antigo ao atual. `mes` = "2026-10". */
  revenueByMonth: { mes: string; creditoBrl: number; compras: number }[];
  users: UsuarioAdmin[];
}

/** GET /api/admin/analytics */
export interface AnaliseAdmin {
  byAction: { action: string; costUsd: number; count: number; credits: number }[];
  /** 30 dias corridos em UTC, do mais antigo a hoje. `date` = "2026-10-03". */
  byDay: { date: string; costUsd: number }[];
  /** 6 meses. No mes corrente `revenueBrl` ja soma a assinatura estimada. */
  byMonth: { month: string; revenueBrl: number; newUsers: number }[];
  revenue: { mrrBrl: number; creditSalesThisMonthBrl: number; revenueThisMonthBrl: number };
  cost: { thisMonthUsd: number; thisMonthBrl: number };
  marginBrl: number;
  usdBrlRate: number;
}

/** GET /api/admin/users/[id] */
export interface DetalheUsuarioAdmin {
  profile: {
    id: string;
    email: string;
    plan: string | null;
    subscription_status: string | null;
    ai_credits: number | null;
    current_period_end: string | null;
    access_granted: boolean | null;
    is_admin: boolean | null;
    hasAccess: boolean;
    created_at: string | null;
  };
  stores: {
    id: string;
    shop_domain: string;
    name: string | null;
    niche: string | null;
    target_language: string | null;
    created_at: string | null;
    productCount: number;
  }[];
  routes: {
    id: string;
    name: string | null;
    public_token: string;
    enabled: boolean | null;
    source_store_id: string | null;
    target_store_id: string | null;
    sourceName: string;
    targetName: string;
  }[];
  totals: { stores: number; products: number; routes: number };
  usage: { action: string; cost_usd: number; credits_used: number; created_at: string }[];
  purchases: { credits: number; amount_cents: number; currency: string; created_at: string }[];
}

/** O que a tela precisa de um usuario para gerenciar acesso, plano e creditos. */
export interface UsuarioGerenciavel {
  id: string;
  email: string;
  plan: string | null;
  aiCredits: number | null;
  accessGranted: boolean;
  isAdmin: boolean;
}
