export type ComplementoModo = 'extrato' | 'complemento' | 'ambos' | 'extrato_classificacao' | 'tudo';

/**
 * Como o complemento do histórico sai no arquivo, dado o modo escolhido.
 * `classificacao` só existe em lançamentos vindos do módulo Classificação —
 * nos demais modos ela é ignorada, e em extrato_classificacao/tudo some
 * silenciosamente se não houver (statement puramente da Importação).
 */
export function composeComplemento(
  modo: ComplementoModo,
  descricaoExtrato: string,
  textoDigitado: string,
  classificacao = '',
): string {
  const extrato = (descricaoExtrato ?? '').trim();
  const digitado = (textoDigitado ?? '').trim();
  const classif = (classificacao ?? '').trim();
  switch (modo) {
    case 'complemento':
      return digitado;
    case 'extrato':
      return extrato;
    case 'extrato_classificacao':
      return [extrato, classif].filter(Boolean).join(' ');
    case 'tudo':
      return [extrato, digitado, classif].filter(Boolean).join(' ');
    default:
      return [extrato, digitado].filter(Boolean).join(' ');
  }
}
