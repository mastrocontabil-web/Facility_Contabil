import type { ComplementoModo } from '@/lib/types';

/** Como o complemento vai sair no arquivo do Domínio, dado o modo escolhido.
 *  `classificacao` só existe em lançamentos vindos do módulo Classificação. */
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
    case 'extrato':
      return extrato;
    case 'complemento':
      return digitado;
    case 'extrato_classificacao':
      return [extrato, classif].filter(Boolean).join(' ');
    case 'tudo':
      return [extrato, digitado, classif].filter(Boolean).join(' ');
    default:
      return [extrato, digitado].filter(Boolean).join(' ');
  }
}
