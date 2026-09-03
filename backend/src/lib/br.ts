/** Utilidades de dados brasileiros (CNPJ/CPF). */

export function onlyDigits(v: string): string {
  return (v ?? '').replace(/\D/g, '');
}

/** Valida os dígitos verificadores de um CNPJ (14 dígitos). */
export function isValidCnpj(value: string): boolean {
  const c = onlyDigits(value);
  if (c.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(c)) return false;

  const calc = (len: number): number => {
    const nums = c.slice(0, len).split('').map(Number);
    let pos = len - 7;
    let sum = 0;
    for (let i = 0; i < len; i++) {
      sum += nums[i]! * pos--;
      if (pos < 2) pos = 9;
    }
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };

  return calc(12) === Number(c[12]) && calc(13) === Number(c[13]);
}

/** Valida os dígitos verificadores de um CPF (11 dígitos). */
export function isValidCpf(value: string): boolean {
  const c = onlyDigits(value);
  if (c.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(c)) return false;

  const calc = (len: number): number => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(c[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };

  return calc(9) === Number(c[9]) && calc(10) === Number(c[10]);
}

/** Aceita CNPJ (14) ou CPF (11) — alguns clientes são pessoa física / EI. */
export function isValidCnpjOrCpf(value: string): boolean {
  const d = onlyDigits(value);
  return d.length === 14 ? isValidCnpj(d) : d.length === 11 ? isValidCpf(d) : false;
}

export function formatCnpjCpf(value: string): string {
  const d = onlyDigits(value);
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  return value;
}
