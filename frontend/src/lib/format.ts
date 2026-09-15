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

export function formatCompetencia(ano: number, mes: number): string {
  return `${String(mes).padStart(2, '0')}/${ano}`;
}

/**
 * "1.234,56" → 123456 (centavos). Mesma ambiguidade de "só ponto" do
 * parseMoney de ImportPage.tsx (resolve pelo nº de dígitos depois do
 * último ponto) — só que devolve centavos (int), não reais (float), porque
 * as tabelas do módulo Contábil guardam _cents em vez de numeric.
 */
export function parseMoneyToCents(s: string): number {
  const v = s.trim();
  let reais: number;
  if (v.includes(',')) {
    reais = Number(v.replace(/\./g, '').replace(',', '.')) || 0;
  } else {
    const pontos = v.split('.').length - 1;
    const casasFinais = pontos > 0 ? v.length - v.lastIndexOf('.') - 1 : 0;
    reais = pontos > 0 && (pontos > 1 || casasFinais === 3) ? Number(v.replace(/\./g, '')) || 0 : Number(v) || 0;
  }
  return Math.round(reais * 100);
}

export function centsToMoneyInput(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',');
}
