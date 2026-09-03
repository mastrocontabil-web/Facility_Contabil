export type ComplementoModo = 'extrato' | 'complemento' | 'ambos';

/** Como o complemento do histórico sai no arquivo, dado o modo escolhido. */
export function composeComplemento(
  modo: ComplementoModo,
  descricaoExtrato: string,
  textoDigitado: string,
): string {
  const extrato = (descricaoExtrato ?? '').trim();
  const digitado = (textoDigitado ?? '').trim();
  if (modo === 'complemento') return digitado;
  if (modo === 'extrato') return extrato;
  return [extrato, digitado].filter(Boolean).join(' ');
}
