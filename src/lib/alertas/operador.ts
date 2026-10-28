import "server-only";

// ============================================================================
// A conta de quem opera o xcart (o Arthur): onde abrem os alertas que sao do
// xcart, nao de um lojista -- hoje so ia_imagem_fora_do_ar (o saldo pre-pago
// do Google AI Studio acabou e a fila de fotos com IA para de sair).
//
// Por ID de conta, nunca is_admin: ha outro admin (a conta de demonstracao),
// a mesma regra de checkouts-externos/liberadas.ts. O alerta vai pelo Telegram
// configurado em Notificacoes desta conta.
// ============================================================================

export const CONTA_DO_OPERADOR = "55c773d6-873a-456a-8695-296ff1433a53";
