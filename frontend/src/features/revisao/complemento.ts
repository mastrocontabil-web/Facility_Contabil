import type { ComplementoModo } from './BulkBar';

/** Como o complemento vai sair no arquivo do Domínio, dado o modo escolhido. */
export function composeComplemento(
  modo: ComplementoModo,
  descricaoExtrato: string,
  textoDigitado: string,
): string {
  const extrato = (descricaoExtrato ?? '').trim();
  const digitado = (textoDigitado ?? '').trim();
  if (modo === 'extrato') return extrato;
  if (modo === 'complemento') return digitado;
  return [extrato, digitado].filter(Boolean).join(' ');
}
