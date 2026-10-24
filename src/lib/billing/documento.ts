// Validacao de CPF/CNPJ. A Pagou exige o documento do pagador em Pix e so
// devolve um 422 generico quando ele e invalido — validar aqui da mensagem
// util e evita ida e volta.

export function digitos(v: string): string {
  return (v || "").replace(/\D/g, "");
}

export function cpfValido(cpf: string): boolean {
  // O guard de digitos repetidos nao e detalhe: 11111111111 PASSA no digito
  // verificador.
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  for (const [ate, pos] of [[9, 10], [10, 11]] as const) {
    let soma = 0;
    for (let i = 0; i < ate; i++) soma += Number(cpf[i]) * (pos - i);
    let d = (soma * 10) % 11;
    if (d === 10) d = 0;
    if (d !== Number(cpf[ate])) return false;
  }
  return true;
}

export function cnpjValido(cnpj: string): boolean {
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const calc = (base: string) => {
    let peso = base.length - 7;
    let soma = 0;
    for (let i = 0; i < base.length; i++) {
      soma += Number(base[i]) * peso--;
      if (peso < 2) peso = 9;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return (
    calc(cnpj.slice(0, 12)) === Number(cnpj[12]) &&
    calc(cnpj.slice(0, 13)) === Number(cnpj[13])
  );
}

export type TipoDoc = "CPF" | "CNPJ";

// Devolve o documento normalizado ou null se invalido.
export function normalizarDocumento(
  bruto: string
): { type: TipoDoc; number: string } | null {
  const d = digitos(bruto);
  if (!d) return null;
  const type: TipoDoc = d.length > 11 ? "CNPJ" : "CPF";
  const ok = type === "CPF" ? cpfValido(d) : cnpjValido(d);
  return ok ? { type, number: d } : null;
}
