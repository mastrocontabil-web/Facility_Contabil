export function onlyDigits(v: string): string {
  return (v ?? '').replace(/\D/g, '');
}

export function formatCnpjCpf(value: string): string {
  const d = onlyDigits(value);
  if (d.length === 14)
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  return value;
}

export function formatDate(iso: string): string {
  // 'YYYY-MM-DD' puro é interpretado como UTC pelo Date() — em UTC-3 isso volta
  // um dia. Formata a data-só na mão pra evitar o deslocamento de fuso.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return new Date(iso).toLocaleDateString('pt-BR');
}

export function formatMoney(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
