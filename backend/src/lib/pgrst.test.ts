import { describe, expect, it } from 'vitest';
import type { PostgrestError } from '@supabase/supabase-js';
import { HttpError } from './httpError.js';
import { LIMITE_LINHAS, emLotes, lerTodas } from './pgrst.js';

/** Simula o PostgREST: devolve a fatia pedida no .range(), cortada no max rows (1000). */
function tabela(total: number) {
  const linhas = Array.from({ length: total }, (_, i) => ({ i }));
  const pedidos: Array<[number, number]> = [];
  const pagina = (de: number, ate: number) => {
    pedidos.push([de, ate]);
    return Promise.resolve({ data: linhas.slice(de, Math.min(ate + 1, de + 1000)), error: null });
  };
  return { pagina, pedidos };
}

describe('lerTodas', () => {
  it('passa do corte de 1000 do Supabase lendo em páginas', async () => {
    const { pagina, pedidos } = tabela(1211); // extrato real do Mercado Pago
    const linhas = await lerTodas(pagina, 'ler');
    expect(linhas).toHaveLength(1211);
    expect(linhas.at(-1)).toEqual({ i: 1210 });
    expect(pedidos).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it('para na 1ª página quando cabe nela (um pedido só, como antes)', async () => {
    const { pagina, pedidos } = tabela(40);
    expect(await lerTodas(pagina, 'ler')).toHaveLength(40);
    expect(pedidos).toHaveLength(1);
  });

  it('múltiplo exato de 1000: confirma com uma página vazia', async () => {
    const { pagina, pedidos } = tabela(2000);
    expect(await lerTodas(pagina, 'ler')).toHaveLength(2000);
    expect(pedidos).toHaveLength(3);
  });

  it('lê até o limite de 10.000', async () => {
    const { pagina } = tabela(LIMITE_LINHAS);
    expect(await lerTodas(pagina, 'ler')).toHaveLength(LIMITE_LINHAS);
  });

  it('passou do limite: erro em vez de cortar calado', async () => {
    const { pagina } = tabela(LIMITE_LINHAS + 1);
    const err = await lerTodas(pagina, 'buscar lançamentos').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(400);
    expect((err as HttpError).message).toMatch(/Mais de 10\.000 registros ao buscar lançamentos/);
  });

  it("passou do limite com passouDoLimite: 'avisar': segue com os 10.000 primeiros", async () => {
    const { pagina } = tabela(LIMITE_LINHAS + 5);
    const linhas = await lerTodas(pagina, 'ler memórias', { passouDoLimite: 'avisar' });
    expect(linhas).toHaveLength(LIMITE_LINHAS);
  });

  it('erro do PostgREST vira HttpError com o contexto', async () => {
    const pagina = () =>
      Promise.resolve({
        data: null,
        error: { code: 'XX000', message: 'boom', details: '', hint: '' } as unknown as PostgrestError,
      });
    const err = await lerTodas(pagina, 'ler saldos').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).message).toBe('Falha em ler saldos');
  });
});

describe('emLotes', () => {
  it('divide em lotes do tamanho pedido', () => {
    expect(emLotes([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(emLotes(Array.from({ length: 250 }, (_, i) => i)).map((l) => l.length)).toEqual([100, 100, 50]);
    expect(emLotes([])).toEqual([]);
  });
});
