import { describe, expect, it } from 'vitest';
import { montarRazao } from './razaoEngine.js';
import { makeFakeSupabase, type FakeHandler } from '../test/fakeSupabase.js';

const CID = '11111111-1111-1111-1111-111111111111';
const PERIODO_ID = '22222222-2222-2222-2222-222222222222';
const PERIODO = { id: PERIODO_ID, client_id: CID, ano: 2026, mes: 7, status: 'aberto', fechado_em: null };

const CONTA_CAIXA = { id: 'c-caixa', client_id: CID, codigo: '5', nome: 'CAIXA GERAL', tipo: 'A' };
const CONTA_SINTETICA = { id: 'c-sint', client_id: CID, codigo: '1', nome: 'ATIVO', tipo: 'S' };
const CONTA_OUTRO_CLIENTE = { id: 'c-outro', client_id: 'outro-cliente', codigo: '9', nome: 'X', tipo: 'A' };

const SALDO_ANTERIOR = { saldo_anterior_cents: 10000, saldo_anterior_natureza: 'D' };

const LANC_1 = {
  id: 'l1',
  data: '2026-07-05',
  historico_codigo: '138',
  historico_complemento: 'Recebimento cliente',
  created_at: '2026-07-05T10:00:00.000Z',
};
const LANC_2 = {
  id: 'l2',
  data: '2026-07-10',
  historico_codigo: null,
  historico_complemento: 'Pagamento fornecedor',
  created_at: '2026-07-10T09:00:00.000Z',
};

function montarHandler(opts: {
  periodo?: typeof PERIODO | null;
  conta?: typeof CONTA_CAIXA | null;
  saldo?: typeof SALDO_ANTERIOR | null;
  lancamentos?: (typeof LANC_1)[];
  partidas?: Array<{ id: string; lancamento_id: string; tipo: 'D' | 'C'; valor_cents: number; ordem: number }>;
}): FakeHandler {
  const { periodo = PERIODO, conta = CONTA_CAIXA, saldo = SALDO_ANTERIOR, lancamentos = [], partidas = [] } = opts;
  return (op) => {
    if (op.table === 'periodos_contabeis') return { data: periodo, error: null };
    if (op.table === 'plano_contas') return { data: conta, error: null };
    if (op.table === 'saldos_contabeis') return { data: saldo, error: null };
    if (op.table === 'lancamentos') return { data: lancamentos, error: null };
    if (op.table === 'lancamento_partidas') return { data: partidas, error: null };
    return { data: null, error: null };
  };
}

describe('montarRazao', () => {
  it('caminha cronologicamente a partir do saldo anterior, um lançamento por vez', async () => {
    const { client } = makeFakeSupabase(
      montarHandler({
        lancamentos: [LANC_1, LANC_2],
        partidas: [
          { id: 'p1', lancamento_id: 'l1', tipo: 'D', valor_cents: 5000, ordem: 0 },
          { id: 'p2', lancamento_id: 'l2', tipo: 'C', valor_cents: 2000, ordem: 0 },
        ],
      }),
    );
    const razao = await montarRazao(client, PERIODO_ID, CONTA_CAIXA.id);

    expect(razao.conta).toEqual({ codigo: '5', nome: 'CAIXA GERAL' });
    expect(razao.saldo_anterior_cents).toBe(10000);
    expect(razao.saldo_anterior_natureza).toBe('D');
    expect(razao.linhas).toHaveLength(2);
    // 10000D + 5000 (débito) = 15000D
    expect(razao.linhas[0]).toMatchObject({ lancamento_id: 'l1', saldo_cents: 15000, saldo_natureza: 'D' });
    // 15000D - 2000 (crédito) = 13000D
    expect(razao.linhas[1]).toMatchObject({ lancamento_id: 'l2', saldo_cents: 13000, saldo_natureza: 'D' });
    expect(razao.saldo_atual_cents).toBe(13000);
    expect(razao.saldo_atual_natureza).toBe('D');
  });

  it('duas partidas do MESMO lançamento na mesma conta são ordenadas por `ordem`, não pela ordem de chegada do banco', async () => {
    const LANC_X = { ...LANC_1, id: 'lx' };
    // Devolvidas propositalmente fora de ordem (ordem 1 antes da ordem 0) —
    // sem o terceiro critério de ordenação, isso ficaria na ordem do banco.
    const { client } = makeFakeSupabase(
      montarHandler({
        saldo: { saldo_anterior_cents: 0, saldo_anterior_natureza: null } as unknown as typeof SALDO_ANTERIOR,
        lancamentos: [LANC_X],
        partidas: [
          { id: 'pa', lancamento_id: 'lx', tipo: 'D', valor_cents: 1000, ordem: 1 },
          { id: 'pb', lancamento_id: 'lx', tipo: 'C', valor_cents: 400, ordem: 0 },
        ],
      }),
    );
    const razao = await montarRazao(client, PERIODO_ID, CONTA_CAIXA.id);

    expect(razao.linhas).toHaveLength(2);
    // ordem 0 (crédito 400) aplicada primeiro: 0 - 400 = 400C
    expect(razao.linhas[0]).toMatchObject({ tipo: 'C', valor_cents: 400, saldo_cents: 400, saldo_natureza: 'C' });
    // ordem 1 (débito 1000) aplicada depois: -400 + 1000 = 600D
    expect(razao.linhas[1]).toMatchObject({ tipo: 'D', valor_cents: 1000, saldo_cents: 600, saldo_natureza: 'D' });
  });

  it('período fechado sem lançamentos manuais (pós-importação de Balancete) não lança erro — devolve saldo igual ao anterior', async () => {
    // Cenário real: importar o Balancete fecha o período e sobrescreve
    // saldos_contabeis com o PDF do Domínio, sem tocar em `lancamentos`.
    // montarRazao nunca compara seu resultado com saldos_contabeis.saldo_atual
    // (só lê saldo_anterior) — não há nada pra "divergir" e travar aqui.
    const { client } = makeFakeSupabase(
      montarHandler({
        periodo: { ...PERIODO, status: 'fechado' },
        lancamentos: [],
        partidas: [],
      }),
    );
    const razao = await montarRazao(client, PERIODO_ID, CONTA_CAIXA.id);
    expect(razao.linhas).toEqual([]);
    expect(razao.saldo_atual_cents).toBe(razao.saldo_anterior_cents);
    expect(razao.saldo_atual_natureza).toBe(razao.saldo_anterior_natureza);
  });

  it('conta sintética lança badRequest — razão é só pra conta analítica', async () => {
    const { client } = makeFakeSupabase(montarHandler({ conta: CONTA_SINTETICA }));
    await expect(montarRazao(client, PERIODO_ID, CONTA_SINTETICA.id)).rejects.toMatchObject({ status: 400 });
  });

  it('conta de outro cliente lança badRequest', async () => {
    const { client } = makeFakeSupabase(montarHandler({ conta: CONTA_OUTRO_CLIENTE }));
    await expect(montarRazao(client, PERIODO_ID, CONTA_OUTRO_CLIENTE.id)).rejects.toMatchObject({ status: 400 });
  });

  it('período inexistente lança 404', async () => {
    const { client } = makeFakeSupabase(montarHandler({ periodo: null }));
    await expect(montarRazao(client, PERIODO_ID, CONTA_CAIXA.id)).rejects.toMatchObject({ status: 404 });
  });

  it('conta inexistente lança 404', async () => {
    const { client } = makeFakeSupabase(montarHandler({ conta: null }));
    await expect(montarRazao(client, PERIODO_ID, 'conta-inexistente')).rejects.toMatchObject({ status: 404 });
  });

  it('sem linha de saldo ainda calculada pro período (defensivo) — assume saldo anterior zero/nulo', async () => {
    const { client } = makeFakeSupabase(montarHandler({ saldo: null, lancamentos: [], partidas: [] }));
    const razao = await montarRazao(client, PERIODO_ID, CONTA_CAIXA.id);
    expect(razao.saldo_anterior_cents).toBe(0);
    expect(razao.saldo_anterior_natureza).toBeNull();
  });
});
