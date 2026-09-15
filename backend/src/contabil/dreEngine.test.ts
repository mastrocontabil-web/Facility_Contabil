import { describe, expect, it } from 'vitest';
import {
  calcularResultado,
  coletarDescendentes,
  encontrarRaizUnica,
  magnitudeComoEsperado,
  montarDreRelatorio,
} from './dreEngine.js';
import { makeFakeSupabase, type FakeHandler } from '../test/fakeSupabase.js';

describe('magnitudeComoEsperado', () => {
  it('saldo do lado esperado é positivo', () => {
    expect(magnitudeComoEsperado({ cents: 1000, natureza: 'C' }, 'C')).toBe(1000);
  });

  it('saldo invertido (do lado errado) é negativo', () => {
    expect(magnitudeComoEsperado({ cents: 1000, natureza: 'D' }, 'C')).toBe(-1000);
  });

  it('saldo nulo (zero) é zero, não importa o lado esperado', () => {
    expect(magnitudeComoEsperado({ cents: 0, natureza: null }, 'D')).toBe(0);
  });
});

describe('calcularResultado', () => {
  it('bate cent-a-cent com o RESUMO DO BALANCETE real (GABRIEL PINHEIRO, 06/2026)', () => {
    // Receitas 277.508,77C, Despesas 55.113,93D -> Resultado do Exercício 222.394,84C
    const r = calcularResultado({ cents: 27750877, natureza: 'C' }, { cents: 5511393, natureza: 'D' });
    expect(r).toEqual({ cents: 22239484, natureza: 'C' });
  });

  it('despesa invertida (saldo credor, ex: estorno) soma em vez de subtrair — o dado real não cobre esse ramo', () => {
    // Se a fórmula fizesse `receita.cents - despesa.cents` direto (sem olhar
    // natureza), erraria por 2x o valor invertido — mesma classe do bug que
    // o C4 já tinha achado uma vez. Aqui: despesa 100,00C (invertida) deveria
    // SOMAR ao resultado (estorno reduz despesa líquida), não subtrair.
    const r = calcularResultado({ cents: 277508_77, natureza: 'C' }, { cents: 100_00, natureza: 'C' });
    expect(r).toEqual({ cents: 277508_77 + 100_00, natureza: 'C' });
  });

  it('receita invertida (saldo devedor) também inverte certo', () => {
    const r = calcularResultado({ cents: 500_00, natureza: 'D' }, { cents: 200_00, natureza: 'D' });
    // magnitudeComoEsperado(receita,'C') = -50000; magnitudeComoEsperado(despesa,'D') = 20000
    // signed = -50000 - 20000 = -70000 -> D
    expect(r).toEqual({ cents: 700_00, natureza: 'D' });
  });

  it('receita e despesa se cancelam exatamente -> natureza nula', () => {
    const r = calcularResultado({ cents: 1000, natureza: 'C' }, { cents: 1000, natureza: 'D' });
    expect(r).toEqual({ cents: 0, natureza: null });
  });

  it('ambos os lados zerados/nulos -> resultado nulo', () => {
    const r = calcularResultado({ cents: 0, natureza: null }, { cents: 0, natureza: null });
    expect(r).toEqual({ cents: 0, natureza: null });
  });
});

describe('encontrarRaizUnica', () => {
  const contas = [
    { id: 'c1', codigo: '1', nome: 'ATIVO', tipo: 'S' as const, grau: 1, parent_id: null },
    { id: 'c4', codigo: '4', nome: 'CONTAS DE RESULTADO - RECEITAS', tipo: 'S' as const, grau: 1, parent_id: null },
    {
      id: 'c5',
      codigo: '5',
      nome: 'CONTAS DE RESULTADOS - CUSTOS E DESPESAS',
      tipo: 'S' as const,
      grau: 1,
      parent_id: null,
    },
    // órfã de grau > 1 cujo parent_id caiu pra null via fallback do
    // relink_plano_contas_parents — não pode contar como raiz só por parent_id null.
    { id: 'c99', codigo: '9.9', nome: 'RECEITAS A RECEBER (órfã)', tipo: 'A' as const, grau: 3, parent_id: null },
  ];

  it('acha a única conta de grau 1 que bate com o regex', () => {
    const r = encontrarRaizUnica(contas, /RECEITA/i, 'receitas');
    expect(r.id).toBe('c4');
  });

  it('conta órfã de grau > 1 não conta como candidata (grau === 1 é obrigatório)', () => {
    // Sem o filtro de grau, "RECEITAS A RECEBER" também bateria no regex e
    // isso teria 2 candidatas (c4 e c99) em vez de 1.
    const r = encontrarRaizUnica(contas, /RECEITA/i, 'receitas');
    expect(r.id).not.toBe('c99');
  });

  it('zero candidatas lança erro nomeando o lado', () => {
    expect(() => encontrarRaizUnica(contas, /INEXISTENTE/i, 'receitas')).toThrow(/receitas/);
  });

  it('duas ou mais candidatas lança erro (não adivinha)', () => {
    const duplicado = [
      ...contas,
      { id: 'c4b', codigo: '4b', nome: 'OUTRA CONTA DE RECEITA', tipo: 'S' as const, grau: 1, parent_id: null },
    ];
    expect(() => encontrarRaizUnica(duplicado, /RECEITA/i, 'receitas')).toThrow(/Mais de uma/);
  });
});

describe('coletarDescendentes', () => {
  it('anda a árvore inteira (não só filhos diretos), via parent_id', () => {
    const contas = [
      { id: 'raiz', codigo: '1', nome: 'RAIZ', tipo: 'S' as const, grau: 1, parent_id: null },
      { id: 'meio', codigo: '1.1', nome: 'MEIO', tipo: 'S' as const, grau: 2, parent_id: 'raiz' },
      { id: 'folha', codigo: '1.1.1', nome: 'FOLHA', tipo: 'A' as const, grau: 3, parent_id: 'meio' },
      { id: 'fora', codigo: '2', nome: 'FORA DA ÁRVORE', tipo: 'A' as const, grau: 1, parent_id: null },
    ];
    const descendentes = coletarDescendentes(contas, 'raiz');
    expect(descendentes).toEqual(new Set(['meio', 'folha']));
  });

  it('raiz sem filhos -> conjunto vazio', () => {
    const contas = [{ id: 'raiz', codigo: '1', nome: 'RAIZ', tipo: 'A' as const, grau: 1, parent_id: null }];
    expect(coletarDescendentes(contas, 'raiz')).toEqual(new Set());
  });
});

// --------------------------------------------------------------------------- #
// montarDreRelatorio — cenário completo com fake do Supabase
// --------------------------------------------------------------------------- #

const CID = '11111111-1111-1111-1111-111111111111';
const P_JUN = { id: 'p-jun', client_id: CID, ano: 2026, mes: 6, status: 'fechado', fechado_em: null };

const RAIZ_RECEITAS = { id: 'c-rec', codigo: '4', nome: 'CONTAS DE RESULTADO - RECEITAS', tipo: 'S' as const, grau: 1, parent_id: null };
const FILHA_RECEITA = { id: 'c-rec-venda', codigo: '4.1', nome: 'RECEITA DE VENDAS', tipo: 'A' as const, grau: 2, parent_id: 'c-rec' };
const RAIZ_DESPESAS = { id: 'c-desp', codigo: '5', nome: 'CONTAS DE RESULTADOS - CUSTOS E DESPESAS', tipo: 'S' as const, grau: 1, parent_id: null };
const FILHA_DESPESA = { id: 'c-desp-agua', codigo: '355', nome: 'ÁGUA E ESGOTO', tipo: 'A' as const, grau: 2, parent_id: 'c-desp' };
const PLANO = [RAIZ_RECEITAS, FILHA_RECEITA, RAIZ_DESPESAS, FILHA_DESPESA];

// Números reais do RESUMO DO BALANCETE (GABRIEL PINHEIRO, 06/2026).
const SALDO_RAIZ_RECEITAS = {
  id: 's-rec', periodo_id: P_JUN.id, plano_conta_id: RAIZ_RECEITAS.id, codigo: '4', nome: RAIZ_RECEITAS.nome,
  tipo: 'S', ordem: 1, saldo_anterior_cents: 23747756, saldo_anterior_natureza: 'C',
  debito_cents: 326806, credito_cents: 4329927, saldo_atual_cents: 27750877, saldo_atual_natureza: 'C',
  created_at: '', updated_at: '',
};
const SALDO_FILHA_RECEITA = {
  id: 's-rec-venda', periodo_id: P_JUN.id, plano_conta_id: FILHA_RECEITA.id, codigo: '4.1', nome: FILHA_RECEITA.nome,
  tipo: 'A', ordem: 2, saldo_anterior_cents: 23747756, saldo_anterior_natureza: 'C',
  debito_cents: 326806, credito_cents: 4329927, saldo_atual_cents: 27750877, saldo_atual_natureza: 'C',
  created_at: '', updated_at: '',
};
const SALDO_RAIZ_DESPESAS = {
  id: 's-desp', periodo_id: P_JUN.id, plano_conta_id: RAIZ_DESPESAS.id, codigo: '5', nome: RAIZ_DESPESAS.nome,
  tipo: 'S', ordem: 3, saldo_anterior_cents: 4780637, saldo_anterior_natureza: 'D',
  debito_cents: 730756, credito_cents: 0, saldo_atual_cents: 5511393, saldo_atual_natureza: 'D',
  created_at: '', updated_at: '',
};
const SALDO_FILHA_DESPESA = {
  id: 's-desp-agua', periodo_id: P_JUN.id, plano_conta_id: FILHA_DESPESA.id, codigo: '355', nome: FILHA_DESPESA.nome,
  tipo: 'A', ordem: 4, saldo_anterior_cents: 4780637, saldo_anterior_natureza: 'D',
  debito_cents: 730756, credito_cents: 0, saldo_atual_cents: 5511393, saldo_atual_natureza: 'D',
  created_at: '', updated_at: '',
};

function montarHandler(saldos: Record<string, unknown>[]): FakeHandler {
  return (op) => {
    if (op.table === 'periodos_contabeis') {
      const id = op.filters.find(([c]) => c === 'id')?.[1];
      return { data: id === P_JUN.id ? P_JUN : null, error: null };
    }
    if (op.table === 'plano_contas') return { data: PLANO, error: null };
    if (op.table === 'saldos_contabeis') return { data: saldos, error: null };
    return { data: null, error: null };
  };
}

describe('montarDreRelatorio', () => {
  it('bate cent-a-cent com o RESUMO DO BALANCETE real (receitas/despesas e os dois resultados)', async () => {
    const { client } = makeFakeSupabase(
      montarHandler([SALDO_RAIZ_RECEITAS, SALDO_FILHA_RECEITA, SALDO_RAIZ_DESPESAS, SALDO_FILHA_DESPESA]),
    );
    const dre = await montarDreRelatorio(client, P_JUN.id);

    expect(dre.receitas.raiz.saldo_atual_cents).toBe(27750877);
    expect(dre.receitas.linhas.map((l) => l.codigo)).toEqual(['4.1']);
    expect(dre.despesas.raiz.saldo_atual_cents).toBe(5511393);
    expect(dre.despesas.linhas.map((l) => l.codigo)).toEqual(['355']);

    expect(dre.resultado_mes_cents).toBe(3272365);
    expect(dre.resultado_mes_natureza).toBe('C');
    expect(dre.resultado_exercicio_cents).toBe(22239484);
    expect(dre.resultado_exercicio_natureza).toBe('C');
  });

  it('raiz sem nenhuma linha de saldo no período vira linha virtual zerada, não erro', async () => {
    // Só despesas tem saldo nesse período — nada foi lançado do lado de
    // receitas ainda (estado normal, não integridade quebrada).
    const { client } = makeFakeSupabase(montarHandler([SALDO_RAIZ_DESPESAS, SALDO_FILHA_DESPESA]));
    const dre = await montarDreRelatorio(client, P_JUN.id);

    expect(dre.receitas.raiz.plano_conta_id).toBe(RAIZ_RECEITAS.id);
    expect(dre.receitas.raiz.saldo_atual_cents).toBe(0);
    expect(dre.receitas.raiz.saldo_atual_natureza).toBeNull();
    expect(dre.receitas.linhas).toEqual([]);

    // resultado do exercício = 0 (receita) - 5511393D (despesa) = -5511393 -> D
    expect(dre.resultado_exercicio_cents).toBe(5511393);
    expect(dre.resultado_exercicio_natureza).toBe('D');
  });

  it('período não encontrado lança 404', async () => {
    const { client } = makeFakeSupabase(montarHandler([]));
    await expect(montarDreRelatorio(client, 'periodo-inexistente')).rejects.toMatchObject({ status: 404 });
  });
});
