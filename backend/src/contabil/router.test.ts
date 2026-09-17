import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('./parserClient.js', () => ({
  callPlanoContasParser: vi.fn(),
  callBalanceteParser: vi.fn(),
  callGerarBalancetePdf: vi.fn(),
  callGerarDrePdf: vi.fn(),
  callGerarRazaoPdf: vi.fn(),
  callGerarLivroDiarioPdf: vi.fn(),
}));
vi.mock('./saldoEngine.js', () => ({ recomputeSaldosCascade: vi.fn() }));
vi.mock('./dreEngine.js', () => ({ montarDreRelatorio: vi.fn() }));
vi.mock('./razaoEngine.js', () => ({ montarRazao: vi.fn() }));
import {
  callBalanceteParser,
  callGerarBalancetePdf,
  callGerarDrePdf,
  callGerarLivroDiarioPdf,
  callGerarRazaoPdf,
  callPlanoContasParser,
} from './parserClient.js';
import { recomputeSaldosCascade } from './saldoEngine.js';
import { montarDreRelatorio, type DreRelatorio } from './dreEngine.js';
import { montarRazao, type RazaoRelatorio } from './razaoEngine.js';
import { contabilRouter } from './router.js';
import { errorHandler } from '../middleware/error.js';
import { badGateway, badRequest } from '../lib/httpError.js';
import { makeFakeSupabase, type FakeHandler, type FakeOp } from '../test/fakeSupabase.js';

const mockedParser = vi.mocked(callPlanoContasParser);
const mockedBalanceteParser = vi.mocked(callBalanceteParser);
const mockedRecompute = vi.mocked(recomputeSaldosCascade);
const mockedGerarBalancetePdf = vi.mocked(callGerarBalancetePdf);
const mockedGerarDrePdf = vi.mocked(callGerarDrePdf);
const mockedGerarRazaoPdf = vi.mocked(callGerarRazaoPdf);
const mockedGerarLivroDiarioPdf = vi.mocked(callGerarLivroDiarioPdf);
const mockedMontarDre = vi.mocked(montarDreRelatorio);
const mockedMontarRazao = vi.mocked(montarRazao);

function appWith(handler: FakeHandler) {
  const { client, ops, rpcOps } = makeFakeSupabase(handler);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { userId: 'user-1', email: 'a@b.com', token: 't' };
    req.supabase = client;
    next();
  });
  app.use('/contabil', contabilRouter);
  app.use(errorHandler);
  return { app, ops, rpcOps };
}

/** Handler que responde por (tabela, verbo). */
function handlerFor(map: Record<string, (op: FakeOp) => unknown>): FakeHandler {
  return (op) => {
    const key = `${op.table}.${op.verb}`;
    const fn = map[key] ?? map[op.table];
    return { data: fn ? fn(op) : null, error: null };
  };
}

const CID = '11111111-1111-1111-1111-111111111111';
const contaSample = {
  id: 'pc-1',
  client_id: CID,
  codigo: '1',
  tipo: 'S',
  classificacao: '1',
  nome: 'ATIVO',
  grau: 1,
  parent_id: null,
  natureza: null,
  ativo: true,
};

const PERIODO_ID = '22222222-2222-2222-2222-222222222222';
const periodoSample = {
  id: PERIODO_ID,
  client_id: CID,
  ano: 2026,
  mes: 6,
  status: 'fechado',
  fechado_em: '2026-06-30T00:00:00.000Z',
};
const saldoSample = {
  id: 's1',
  periodo_id: PERIODO_ID,
  plano_conta_id: 'pc-1',
  codigo: '1',
  nome: 'ATIVO',
  tipo: 'S',
  ordem: 0,
  saldo_anterior_cents: 100,
  saldo_anterior_natureza: 'D',
  debito_cents: 0,
  credito_cents: 0,
  saldo_atual_cents: 100,
  saldo_atual_natureza: 'D',
};

beforeEach(() => {
  mockedParser.mockReset();
  mockedBalanceteParser.mockReset();
  mockedRecompute.mockReset();
  mockedRecompute.mockResolvedValue(undefined);
  mockedGerarBalancetePdf.mockReset();
  mockedGerarBalancetePdf.mockResolvedValue(Buffer.from('%PDF-fake-balancete'));
  mockedGerarDrePdf.mockReset();
  mockedGerarDrePdf.mockResolvedValue(Buffer.from('%PDF-fake-dre'));
  mockedMontarDre.mockReset();
  mockedGerarRazaoPdf.mockReset();
  mockedGerarRazaoPdf.mockResolvedValue(Buffer.from('%PDF-fake-razao'));
  mockedGerarLivroDiarioPdf.mockReset();
  mockedGerarLivroDiarioPdf.mockResolvedValue(Buffer.from('%PDF-fake-livro-diario'));
  mockedMontarRazao.mockReset();
});

describe('GET /contabil/plano-contas', () => {
  it('exige client_id', async () => {
    const { app } = appWith(() => ({ data: [], error: null }));
    const res = await request(app).get('/contabil/plano-contas');
    expect(res.status).toBe(400);
  });

  it('lista ordenado por classificação', async () => {
    const { app, ops } = appWith(() => ({ data: [contaSample], error: null }));
    const res = await request(app).get(`/contabil/plano-contas?client_id=${CID}`);
    expect(res.status).toBe(200);
    expect(res.body.contas).toHaveLength(1);
    expect(ops[0]).toMatchObject({ orderBy: 'classificacao' });
  });
});

describe('POST /contabil/plano-contas/importar', () => {
  it('exige arquivo', async () => {
    const { app } = appWith(() => ({ data: null, error: null }));
    const res = await request(app).post('/contabil/plano-contas/importar').field('client_id', CID);
    expect(res.status).toBe(400);
  });

  it('lê o PDF e grava por upsert (código novo = criada)', async () => {
    mockedParser.mockResolvedValue({
      items: [
        { codigo: '1', tipo: 'S', classificacao: '1', nome: 'ATIVO', grau: 1 },
        { codigo: '2', tipo: 'A', classificacao: '1.1', nome: 'CAIXA', grau: 2 },
      ],
      warnings: [],
    });

    let planoSelectCalls = 0;
    const { app, ops, rpcOps } = appWith((op) => {
      if (op.table === 'clients') return { data: { id: CID }, error: null };
      if (op.table === 'plano_contas' && op.verb === 'select') {
        planoSelectCalls++;
        if (planoSelectCalls === 1) return { data: [], error: null }; // nada existente ainda
        return {
          data: [
            { ...contaSample, id: 'p1' },
            {
              ...contaSample,
              id: 'p2',
              codigo: '2',
              tipo: 'A',
              classificacao: '1.1',
              nome: 'CAIXA',
              grau: 2,
              parent_id: 'p1',
            },
          ],
          error: null,
        };
      }
      return { data: null, error: null };
    });

    const res = await request(app)
      .post('/contabil/plano-contas/importar')
      .field('client_id', CID)
      .attach('file', Buffer.from('%PDF-fake'), 'plano.pdf');

    expect(res.status).toBe(201);
    expect(res.body.criadas).toBe(2);
    expect(res.body.atualizadas).toBe(0);
    expect(res.body.contas).toHaveLength(2);

    const upsertOp = ops.find((o) => o.table === 'plano_contas' && o.verb === 'upsert');
    expect(upsertOp?.onConflict).toBe('client_id,codigo');
    // parent_id é religado via RPC no servidor, nunca por upsert parcial (client_id
    // é NOT NULL e um upsert só com {id, parent_id} quebra na validação da linha).
    expect(rpcOps).toContainEqual({ fn: 'relink_plano_contas_parents', args: { p_client: CID } });
  });

  it('404 quando o cliente não existe', async () => {
    mockedParser.mockResolvedValue({ items: [], warnings: [] });
    const { app } = appWith(() => ({ data: null, error: null }));
    const res = await request(app)
      .post('/contabil/plano-contas/importar')
      .field('client_id', CID)
      .attach('file', Buffer.from('%PDF-fake'), 'plano.pdf');
    expect(res.status).toBe(404);
  });
});

describe('DELETE /contabil/plano-contas/:id', () => {
  it('bloqueia quando a conta tem filhas', async () => {
    const { app, ops } = appWith((op) =>
      op.table === 'plano_contas' && op.verb === 'select'
        ? { data: null, error: null, count: 3 }
        : { data: null, error: null, count: 1 },
    );
    const res = await request(app).delete('/contabil/plano-contas/pc-1');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/filha/i);
    expect(ops.some((o) => o.table === 'plano_contas' && o.verb === 'delete')).toBe(false);
  });

  it('204 quando não tem filhas', async () => {
    const { app } = appWith((op) =>
      op.table === 'plano_contas' && op.verb === 'select'
        ? { data: null, error: null, count: 0 }
        : { data: null, error: null, count: 1 },
    );
    const res = await request(app).delete('/contabil/plano-contas/pc-1');
    expect(res.status).toBe(204);
  });
});

describe('históricos padrão', () => {
  it('POST /historicos cria e injeta owner_id', async () => {
    const sample = { id: 'h1', codigo: '1', descricao: 'CONFORME NOTA FISCAL', ativo: true };
    const { app, ops } = appWith(handlerFor({ 'historicos_padrao.insert': () => sample }));
    const res = await request(app)
      .post('/contabil/historicos')
      .send({ codigo: '1', descricao: 'Conforme nota fiscal' });
    expect(res.status).toBe(201);
    const payload = ops[0]?.payload as Record<string, unknown>;
    expect(payload.owner_id).toBe('user-1');
  });

  it('POST /historicos 400 em código duplicado', async () => {
    const { app } = appWith(() => ({
      data: null,
      error: { code: '23505', message: 'duplicate key' },
    }));
    const res = await request(app)
      .post('/contabil/historicos')
      .send({ codigo: '1', descricao: 'Conforme nota fiscal' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/já existe/i);
  });

  it('PATCH /historicos/:id atualiza só o que veio', async () => {
    const { app, ops } = appWith(() => ({
      data: { id: 'h1', codigo: '1', descricao: 'X', ativo: false },
      error: null,
    }));
    const res = await request(app).patch('/contabil/historicos/h1').send({ ativo: false });
    expect(res.status).toBe(200);
    expect(Object.keys(ops[0]?.payload as object)).toEqual(['ativo']);
  });

  it('DELETE /historicos/:id 404 quando não existe', async () => {
    const { app } = appWith(() => ({ data: null, error: null, count: 0 }));
    const res = await request(app).delete('/contabil/historicos/h1');
    expect(res.status).toBe(404);
  });
});

describe('POST /contabil/balancete/importar', () => {
  it('exige arquivo', async () => {
    const { app } = appWith(() => ({ data: null, error: null }));
    const res = await request(app).post('/contabil/balancete/importar').field('client_id', CID);
    expect(res.status).toBe(400);
  });

  it('404 quando o cliente não existe', async () => {
    mockedBalanceteParser.mockResolvedValue({ periodo: { ano: 2026, mes: 6 }, items: [], warnings: [] });
    const { app } = appWith(() => ({ data: null, error: null }));
    const res = await request(app)
      .post('/contabil/balancete/importar')
      .field('client_id', CID)
      .attach('file', Buffer.from('%PDF-fake'), 'balancete.pdf');
    expect(res.status).toBe(404);
  });

  it('400 quando o balancete não tem contas', async () => {
    mockedBalanceteParser.mockResolvedValue({ periodo: { ano: 2026, mes: 6 }, items: [], warnings: [] });
    const { app } = appWith((op) =>
      op.table === 'clients' ? { data: { id: CID }, error: null } : { data: null, error: null },
    );
    const res = await request(app)
      .post('/contabil/balancete/importar')
      .field('client_id', CID)
      .attach('file', Buffer.from('%PDF-fake'), 'balancete.pdf');
    expect(res.status).toBe(400);
  });

  it('lê o PDF, fecha o período e grava saldos linkando por código (upsert)', async () => {
    mockedBalanceteParser.mockResolvedValue({
      periodo: { ano: 2026, mes: 6 },
      items: [
        {
          codigo: '1',
          nome: 'ATIVO',
          tipo: 'S',
          saldo_anterior_cents: 100,
          saldo_anterior_natureza: 'D',
          debito_cents: 0,
          credito_cents: 0,
          saldo_atual_cents: 100,
          saldo_atual_natureza: 'D',
        },
      ],
      warnings: [],
    });

    let saldoSelectCalls = 0;
    const { app, ops } = appWith((op) => {
      if (op.table === 'clients') return { data: { id: CID }, error: null };
      if (op.table === 'periodos_contabeis') return { data: periodoSample, error: null };
      if (op.table === 'plano_contas') return { data: [{ id: 'pc-1', codigo: '1', tipo: 'S' }], error: null };
      if (op.table === 'saldos_contabeis' && op.verb === 'select') {
        saldoSelectCalls++;
        return { data: saldoSelectCalls === 1 ? [] : [saldoSample], error: null }; // 1ª: nada existente; 2ª: releitura
      }
      return { data: null, error: null };
    });

    const res = await request(app)
      .post('/contabil/balancete/importar')
      .field('client_id', CID)
      .attach('file', Buffer.from('%PDF-fake'), 'balancete.pdf');

    expect(res.status).toBe(201);
    expect(res.body.criadas).toBe(1);
    expect(res.body.atualizadas).toBe(0);
    expect(res.body.periodo).toMatchObject({ ano: 2026, mes: 6, status: 'fechado' });
    expect(res.body.saldos).toHaveLength(1);
    expect(res.body.warnings).toEqual([]);

    const periodoUpsert = ops.find((o) => o.table === 'periodos_contabeis' && o.verb === 'upsert');
    expect(periodoUpsert?.onConflict).toBe('client_id,ano,mes');
    expect(periodoUpsert?.payload).toMatchObject({ ano: 2026, mes: 6, status: 'fechado' });

    const saldoUpsert = ops.find((o) => o.table === 'saldos_contabeis' && o.verb === 'upsert');
    expect(saldoUpsert?.onConflict).toBe('periodo_id,codigo');
    const payload = saldoUpsert?.payload as Array<Record<string, unknown>>;
    expect(payload[0]).toMatchObject({ codigo: '1', plano_conta_id: 'pc-1', ordem: 0 });
  });

  it('conta do balancete não encontrada no plano de contas: salva sem vínculo e avisa (caso real: código 10298)', async () => {
    mockedBalanceteParser.mockResolvedValue({
      periodo: { ano: 2026, mes: 6 },
      items: [
        {
          codigo: '10298',
          nome: 'ESCRITORIO INTELIGENTE DESENVOLVIMENTOS, COMERCIO E SERVICOS EM INFORMATICA LTDA',
          tipo: 'A',
          saldo_anterior_cents: 0,
          saldo_anterior_natureza: null,
          debito_cents: 81290,
          credito_cents: 81290,
          saldo_atual_cents: 0,
          saldo_atual_natureza: null,
        },
      ],
      warnings: [],
    });

    let saldoSelectCalls = 0;
    const { app, ops } = appWith((op) => {
      if (op.table === 'clients') return { data: { id: CID }, error: null };
      if (op.table === 'periodos_contabeis') return { data: periodoSample, error: null };
      if (op.table === 'plano_contas') return { data: [], error: null }; // 10298 não está cadastrado
      if (op.table === 'saldos_contabeis' && op.verb === 'select') {
        saldoSelectCalls++;
        return {
          data: saldoSelectCalls === 1 ? [] : [{ ...saldoSample, codigo: '10298', plano_conta_id: null }],
          error: null,
        };
      }
      return { data: null, error: null };
    });

    const res = await request(app)
      .post('/contabil/balancete/importar')
      .field('client_id', CID)
      .attach('file', Buffer.from('%PDF-fake'), 'balancete.pdf');

    expect(res.status).toBe(201);
    expect(
      res.body.warnings.some((w: string) => w.includes('10298') && w.includes('não encontrada no plano de contas')),
    ).toBe(true);

    const saldoUpsert = ops.find((o) => o.table === 'saldos_contabeis' && o.verb === 'upsert');
    const payload = saldoUpsert?.payload as Array<Record<string, unknown>>;
    expect(payload[0]).toMatchObject({ codigo: '10298', plano_conta_id: null });
  });
});

describe('GET /contabil/periodos', () => {
  it('exige client_id', async () => {
    const { app } = appWith(() => ({ data: [], error: null }));
    const res = await request(app).get('/contabil/periodos');
    expect(res.status).toBe(400);
  });

  it('lista períodos do cliente', async () => {
    const { app, ops } = appWith(() => ({ data: [periodoSample], error: null }));
    const res = await request(app).get(`/contabil/periodos?client_id=${CID}`);
    expect(res.status).toBe(200);
    expect(res.body.periodos).toHaveLength(1);
    expect(ops[0]?.filters).toContainEqual(['client_id', CID]);
  });
});

describe('GET /contabil/saldos', () => {
  it('exige periodo_id', async () => {
    const { app } = appWith(() => ({ data: [], error: null }));
    const res = await request(app).get('/contabil/saldos');
    expect(res.status).toBe(400);
  });

  it('lista saldos do período, ordenado por ordem', async () => {
    const { app, ops } = appWith(() => ({ data: [saldoSample], error: null }));
    const res = await request(app).get(`/contabil/saldos?periodo_id=${PERIODO_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.saldos).toHaveLength(1);
    expect(ops[0]).toMatchObject({ orderBy: 'ordem' });
  });
});

const LANC_ID = '33333333-3333-3333-3333-333333333333';
const contaForn = { id: '44444444-4444-4444-4444-444444444444', client_id: CID, tipo: 'A', ativo: true };
const contaCaixa = { id: '55555555-5555-5555-5555-555555555555', client_id: CID, tipo: 'A', ativo: true };
const lancBody = {
  client_id: CID,
  data: '2026-06-15',
  historico_complemento: 'Pagamento fornecedor X',
  partidas: [
    { plano_conta_id: contaForn.id, tipo: 'D', valor_cents: 10000 },
    { plano_conta_id: contaCaixa.id, tipo: 'C', valor_cents: 10000 },
  ],
};

describe('POST /contabil/lancamentos', () => {
  it('rejeita partidas desbalanceadas antes de tocar no banco', async () => {
    const { app, ops } = appWith(() => ({ data: null, error: null }));
    const res = await request(app)
      .post('/contabil/lancamentos')
      .send({ ...lancBody, partidas: [lancBody.partidas[0], { ...lancBody.partidas[1], valor_cents: 5000 }] });
    expect(res.status).toBe(400);
    expect(ops).toHaveLength(0); // zod barra antes de qualquer query
  });

  it('404 quando o cliente não existe', async () => {
    const { app } = appWith(() => ({ data: null, error: null }));
    const res = await request(app).post('/contabil/lancamentos').send(lancBody);
    expect(res.status).toBe(404);
  });

  it('rejeita posting numa conta sintética', async () => {
    const { app } = appWith((op) => {
      if (op.table === 'clients') return { data: { id: CID }, error: null };
      if (op.table === 'plano_contas') return { data: [{ ...contaForn, tipo: 'S' }, contaCaixa], error: null };
      return { data: null, error: null };
    });
    const res = await request(app).post('/contabil/lancamentos').send(lancBody);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sintética/i);
  });

  it('rejeita conta de outro cliente', async () => {
    const { app } = appWith((op) => {
      if (op.table === 'clients') return { data: { id: CID }, error: null };
      if (op.table === 'plano_contas') {
        return { data: [{ ...contaForn, client_id: 'outro-cliente' }, contaCaixa], error: null };
      }
      return { data: null, error: null };
    });
    const res = await request(app).post('/contabil/lancamentos').send(lancBody);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/não pertence/i);
  });

  it('rejeita lançar num período fechado', async () => {
    const { app } = appWith((op) => {
      if (op.table === 'clients') return { data: { id: CID }, error: null };
      if (op.table === 'plano_contas') return { data: [contaForn, contaCaixa], error: null };
      if (op.table === 'periodos_contabeis' && op.verb === 'select') {
        return { data: { id: PERIODO_ID, status: 'fechado' }, error: null };
      }
      return { data: null, error: null }; // cobre o upsert do período
    });
    const res = await request(app).post('/contabil/lancamentos').send(lancBody);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/fechado/i);
  });

  it('cria o lançamento: abre o período sem reabrir (ignoreDuplicates) e grava as partidas na ordem certa', async () => {
    const { app, ops } = appWith((op) => {
      if (op.table === 'clients') return { data: { id: CID }, error: null };
      if (op.table === 'plano_contas') return { data: [contaForn, contaCaixa], error: null };
      if (op.table === 'periodos_contabeis' && op.verb === 'select') {
        return { data: { id: PERIODO_ID, status: 'aberto' }, error: null };
      }
      if (op.table === 'lancamentos' && op.verb === 'insert') return { data: { id: LANC_ID }, error: null };
      if (op.table === 'lancamentos' && op.verb === 'select') {
        return {
          data: {
            id: LANC_ID,
            periodo_id: PERIODO_ID,
            data: lancBody.data,
            historico_codigo: null,
            historico_complemento: lancBody.historico_complemento,
            partidas: [
              {
                id: 'lp1', plano_conta_id: contaForn.id, tipo: 'D', valor_cents: 10000, ordem: 0,
                plano_conta: { codigo: '2.1.1.01', nome: 'FORNECEDORES' },
              },
              {
                id: 'lp2', plano_conta_id: contaCaixa.id, tipo: 'C', valor_cents: 10000, ordem: 1,
                plano_conta: { codigo: '1.1.1.01', nome: 'CAIXA' },
              },
            ],
          },
          error: null,
        };
      }
      return { data: null, error: null };
    });

    const res = await request(app).post('/contabil/lancamentos').send(lancBody);
    expect(res.status).toBe(201);
    expect(res.body.lancamento.partidas).toHaveLength(2);
    expect(res.body.lancamento.partidas[0].plano_conta).toEqual({ codigo: '2.1.1.01', nome: 'FORNECEDORES' });

    const periodoUpsert = ops.find((o) => o.table === 'periodos_contabeis' && o.verb === 'upsert');
    expect(periodoUpsert?.onConflict).toBe('client_id,ano,mes');
    expect(periodoUpsert?.ignoreDuplicates).toBe(true);

    const partidaInsert = ops.find((o) => o.table === 'lancamento_partidas' && o.verb === 'insert');
    const payload = partidaInsert?.payload as Array<Record<string, unknown>>;
    expect(payload).toHaveLength(2);
    expect(payload[0]).toMatchObject({ tipo: 'D', valor_cents: 10000, ordem: 0 });
    expect(payload[1]).toMatchObject({ tipo: 'C', valor_cents: 10000, ordem: 1 });

    // motor de saldos chamado com o período certo, e ANTES da resposta
    // (senão o teste acima nem teria o corpo populado — mas confirma explícito)
    expect(mockedRecompute).toHaveBeenCalledTimes(1);
    expect(mockedRecompute).toHaveBeenCalledWith(expect.anything(), 'user-1', PERIODO_ID);
  });

  it('se o motor de saldos falhar, a resposta é erro (nunca 201 com dado desatualizado)', async () => {
    mockedRecompute.mockRejectedValue(new Error('boom'));
    const { app } = appWith((op) => {
      if (op.table === 'clients') return { data: { id: CID }, error: null };
      if (op.table === 'plano_contas') return { data: [contaForn, contaCaixa], error: null };
      if (op.table === 'periodos_contabeis' && op.verb === 'select') {
        return { data: { id: PERIODO_ID, status: 'aberto' }, error: null };
      }
      if (op.table === 'lancamentos' && op.verb === 'insert') return { data: { id: LANC_ID }, error: null };
      return { data: null, error: null };
    });
    const res = await request(app).post('/contabil/lancamentos').send(lancBody);
    expect(res.status).toBe(500);
  });
});

describe('GET /contabil/lancamentos', () => {
  it('exige periodo_id', async () => {
    const { app } = appWith(() => ({ data: [], error: null }));
    const res = await request(app).get('/contabil/lancamentos');
    expect(res.status).toBe(400);
  });

  it('lista em ordem cronológica e normaliza plano_conta (array-de-um vira objeto)', async () => {
    const { app, ops } = appWith(() => ({
      data: [
        {
          id: LANC_ID,
          periodo_id: PERIODO_ID,
          data: '2026-06-15',
          historico_codigo: null,
          historico_complemento: 'Pagamento X',
          partidas: [
            {
              id: 'lp1', plano_conta_id: contaForn.id, tipo: 'D', valor_cents: 10000, ordem: 0,
              plano_conta: [{ codigo: '2.1.1.01', nome: 'FORNECEDORES' }], // Postgrest às vezes devolve assim
            },
            {
              id: 'lp2', plano_conta_id: contaCaixa.id, tipo: 'C', valor_cents: 10000, ordem: 1,
              plano_conta: { codigo: '1.1.1.01', nome: 'CAIXA' }, // e às vezes assim
            },
          ],
        },
      ],
      error: null,
    }));

    const res = await request(app).get(`/contabil/lancamentos?periodo_id=${PERIODO_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.lancamentos).toHaveLength(1);
    expect(res.body.lancamentos[0].partidas[0].plano_conta).toEqual({ codigo: '2.1.1.01', nome: 'FORNECEDORES' });
    expect(res.body.lancamentos[0].partidas[1].plano_conta).toEqual({ codigo: '1.1.1.01', nome: 'CAIXA' });

    expect(ops[0]?.orderCalls).toEqual([
      { col: 'data', foreignTable: undefined, ascending: true },
      { col: 'created_at', foreignTable: undefined, ascending: true },
      { col: 'ordem', foreignTable: 'lancamento_partidas', ascending: true },
    ]);
  });
});

describe('PATCH /contabil/lancamentos/:id', () => {
  it('404 quando não existe', async () => {
    const { app } = appWith(() => ({ data: null, error: null }));
    const res = await request(app).patch(`/contabil/lancamentos/${LANC_ID}`).send(lancBody);
    expect(res.status).toBe(404);
  });

  it('bloqueia se o período atual está fechado', async () => {
    const { app } = appWith((op) => {
      if (op.table === 'lancamentos' && op.verb === 'select') {
        return { data: { id: LANC_ID, periodo_id: PERIODO_ID }, error: null };
      }
      if (op.table === 'periodos_contabeis') {
        return { data: { id: PERIODO_ID, client_id: CID, status: 'fechado' }, error: null };
      }
      return { data: null, error: null };
    });
    const res = await request(app).patch(`/contabil/lancamentos/${LANC_ID}`).send(lancBody);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/fechado/i);
  });

  it('bloqueia se o NOVO período (mudou o mês) está fechado, sem apagar as partidas antigas', async () => {
    let periodoSelectCalls = 0;
    const { app, ops } = appWith((op) => {
      if (op.table === 'lancamentos' && op.verb === 'select') {
        return { data: { id: LANC_ID, periodo_id: PERIODO_ID }, error: null };
      }
      if (op.table === 'periodos_contabeis' && op.verb === 'select') {
        periodoSelectCalls++;
        // 1ª: período atual (aberto, passa) — 2ª: período do novo mês (fechado, barra)
        return {
          data:
            periodoSelectCalls === 1
              ? { id: PERIODO_ID, client_id: CID, status: 'aberto' }
              : { id: 'outro-periodo', status: 'fechado' },
          error: null,
        };
      }
      if (op.table === 'plano_contas') return { data: [contaForn, contaCaixa], error: null };
      return { data: null, error: null };
    });
    const res = await request(app)
      .patch(`/contabil/lancamentos/${LANC_ID}`)
      .send({ ...lancBody, data: '2026-07-01' });
    expect(res.status).toBe(400);
    expect(ops.some((o) => o.table === 'lancamento_partidas' && o.verb === 'delete')).toBe(false);
  });

  it('apaga e recria as partidas só depois de validar os dois períodos', async () => {
    let periodoSelectCalls = 0;
    let lancSelectCalls = 0;
    const { app, ops } = appWith((op) => {
      if (op.table === 'lancamentos' && op.verb === 'select') {
        lancSelectCalls++;
        if (lancSelectCalls === 1) return { data: { id: LANC_ID, periodo_id: PERIODO_ID }, error: null };
        return {
          data: { id: LANC_ID, periodo_id: PERIODO_ID, ...lancBody, partidas: [] },
          error: null,
        };
      }
      if (op.table === 'periodos_contabeis' && op.verb === 'select') {
        periodoSelectCalls++;
        return {
          data:
            periodoSelectCalls === 1
              ? { id: PERIODO_ID, client_id: CID, status: 'aberto' }
              : { id: PERIODO_ID, status: 'aberto' },
          error: null,
        };
      }
      if (op.table === 'plano_contas') return { data: [contaForn, contaCaixa], error: null };
      return { data: null, error: null };
    });

    const res = await request(app).patch(`/contabil/lancamentos/${LANC_ID}`).send(lancBody);
    expect(res.status).toBe(200);

    const deleteIdx = ops.findIndex((o) => o.table === 'lancamento_partidas' && o.verb === 'delete');
    const insertIdx = ops.findIndex((o) => o.table === 'lancamento_partidas' && o.verb === 'insert');
    const lastPeriodoIdx = ops.map((o, i) => (o.table === 'periodos_contabeis' ? i : -1)).filter((i) => i >= 0).pop();
    expect(deleteIdx).toBeGreaterThan(-1);
    expect(lastPeriodoIdx).toBeLessThan(deleteIdx);
    expect(insertIdx).toBeGreaterThan(deleteIdx);

    const insertPayload = ops[insertIdx]?.payload as Array<Record<string, unknown>>;
    expect(insertPayload).toHaveLength(2);

    // mesmo mês (novoPeriodo.id === periodoAtual.id) — motor chamado só 1x
    expect(mockedRecompute).toHaveBeenCalledTimes(1);
    expect(mockedRecompute).toHaveBeenCalledWith(expect.anything(), 'user-1', PERIODO_ID);
  });

  it('mudou de mês: recalcula os DOIS períodos (velho e novo), não confia que um cobre o outro', async () => {
    const PERIODO_NOVO = '44444444-5555-6666-7777-888888888888';
    let periodoSelectCalls = 0;
    let lancSelectCalls = 0;
    const { app } = appWith((op) => {
      if (op.table === 'lancamentos' && op.verb === 'select') {
        lancSelectCalls++;
        if (lancSelectCalls === 1) return { data: { id: LANC_ID, periodo_id: PERIODO_ID }, error: null };
        return { data: { id: LANC_ID, periodo_id: PERIODO_NOVO, ...lancBody, partidas: [] }, error: null };
      }
      if (op.table === 'periodos_contabeis' && op.verb === 'select') {
        periodoSelectCalls++;
        return {
          data:
            periodoSelectCalls === 1
              ? { id: PERIODO_ID, client_id: CID, status: 'aberto' } // período atual
              : { id: PERIODO_NOVO, status: 'aberto' }, // resolvePeriodoAberto do novo mês
          error: null,
        };
      }
      if (op.table === 'plano_contas') return { data: [contaForn, contaCaixa], error: null };
      return { data: null, error: null };
    });

    const res = await request(app)
      .patch(`/contabil/lancamentos/${LANC_ID}`)
      .send({ ...lancBody, data: '2026-07-01' });
    expect(res.status).toBe(200);

    expect(mockedRecompute).toHaveBeenCalledTimes(2);
    expect(mockedRecompute).toHaveBeenCalledWith(expect.anything(), 'user-1', PERIODO_NOVO);
    expect(mockedRecompute).toHaveBeenCalledWith(expect.anything(), 'user-1', PERIODO_ID);
  });
});

describe('DELETE /contabil/lancamentos/:id', () => {
  it('404 quando não existe', async () => {
    const { app } = appWith(() => ({ data: null, error: null }));
    const res = await request(app).delete(`/contabil/lancamentos/${LANC_ID}`);
    expect(res.status).toBe(404);
  });

  it('bloqueia se o período está fechado', async () => {
    const { app } = appWith((op) => {
      if (op.table === 'lancamentos' && op.verb === 'select') {
        return { data: { id: LANC_ID, periodo_id: PERIODO_ID }, error: null };
      }
      if (op.table === 'periodos_contabeis') return { data: { status: 'fechado' }, error: null };
      return { data: null, error: null };
    });
    const res = await request(app).delete(`/contabil/lancamentos/${LANC_ID}`);
    expect(res.status).toBe(400);
  });

  it('204 quando o período está aberto, e chama o motor de saldos', async () => {
    const { app } = appWith((op) => {
      if (op.table === 'lancamentos' && op.verb === 'select') {
        return { data: { id: LANC_ID, periodo_id: PERIODO_ID }, error: null };
      }
      if (op.table === 'periodos_contabeis') return { data: { status: 'aberto' }, error: null };
      return { data: null, error: null, count: 1 };
    });
    const res = await request(app).delete(`/contabil/lancamentos/${LANC_ID}`);
    expect(res.status).toBe(204);
    expect(mockedRecompute).toHaveBeenCalledTimes(1);
    expect(mockedRecompute).toHaveBeenCalledWith(expect.anything(), 'user-1', PERIODO_ID);
  });
});

const MODELO_TABLE = 'lancamento_modelos';
const MODELO_PARTIDA_TABLE = 'lancamento_modelo_partidas';
const MODELO_ID = '66666666-6666-6666-6666-666666666666';
const modeloBodyComValores = {
  client_id: CID,
  nome: 'Depreciação mensal',
  historico_complemento: 'Depreciação do período',
  partidas: [
    { plano_conta_id: contaForn.id, tipo: 'D', valor_cents_padrao: 10000 },
    { plano_conta_id: contaCaixa.id, tipo: 'C', valor_cents_padrao: 10000 },
  ],
};
const modeloBodySemValores = {
  client_id: CID,
  nome: 'Pró-labore sócio X',
  historico_complemento: 'Pró-labore',
  partidas: [
    { plano_conta_id: contaForn.id, tipo: 'D' },
    { plano_conta_id: contaCaixa.id, tipo: 'C' },
  ],
};

describe('GET /contabil/modelos', () => {
  it('exige client_id', async () => {
    const { app } = appWith(() => ({ data: [], error: null }));
    const res = await request(app).get('/contabil/modelos');
    expect(res.status).toBe(400);
  });

  it('lista ordenado por nome e normaliza plano_conta (array-de-um vira objeto)', async () => {
    const { app, ops } = appWith(() => ({
      data: [
        {
          id: MODELO_ID,
          client_id: CID,
          nome: 'Depreciação mensal',
          historico_codigo: null,
          historico_complemento: 'Depreciação do período',
          ativo: true,
          partidas: [
            {
              id: 'mp1', plano_conta_id: contaForn.id, tipo: 'D', valor_cents_padrao: 10000, ordem: 0,
              plano_conta: [{ codigo: '2.1.1.01', nome: 'FORNECEDORES' }],
            },
            {
              id: 'mp2', plano_conta_id: contaCaixa.id, tipo: 'C', valor_cents_padrao: null, ordem: 1,
              plano_conta: { codigo: '1.1.1.01', nome: 'CAIXA' },
            },
          ],
        },
      ],
      error: null,
    }));

    const res = await request(app).get(`/contabil/modelos?client_id=${CID}`);
    expect(res.status).toBe(200);
    expect(res.body.modelos).toHaveLength(1);
    expect(res.body.modelos[0].partidas[0].plano_conta).toEqual({ codigo: '2.1.1.01', nome: 'FORNECEDORES' });
    expect(res.body.modelos[0].partidas[1].valor_cents_padrao).toBeNull();
    expect(ops[0]?.orderCalls).toEqual([{ col: 'nome', foreignTable: undefined, ascending: true }]);
  });
});

describe('POST /contabil/modelos', () => {
  it('rejeita valores preenchidos com débito ≠ crédito antes de tocar no banco', async () => {
    const { app, ops } = appWith(() => ({ data: null, error: null }));
    const res = await request(app)
      .post('/contabil/modelos')
      .send({
        ...modeloBodyComValores,
        partidas: [
          modeloBodyComValores.partidas[0],
          { ...modeloBodyComValores.partidas[1], valor_cents_padrao: 5000 },
        ],
      });
    expect(res.status).toBe(400);
    expect(ops).toHaveLength(0);
  });

  it('aceita partidas sem valor (não força soma D=C)', async () => {
    const { app } = appWith((op) => {
      if (op.table === 'clients') return { data: { id: CID }, error: null };
      if (op.table === 'plano_contas') return { data: [contaForn, contaCaixa], error: null };
      if (op.table === MODELO_TABLE && op.verb === 'insert') return { data: { id: MODELO_ID }, error: null };
      if (op.table === MODELO_TABLE && op.verb === 'select') {
        return { data: { ...modeloBodySemValores, id: MODELO_ID, ativo: true, partidas: [] }, error: null };
      }
      return { data: null, error: null };
    });
    const res = await request(app).post('/contabil/modelos').send(modeloBodySemValores);
    expect(res.status).toBe(201);
  });

  it('404 quando o cliente não existe', async () => {
    const { app } = appWith(() => ({ data: null, error: null }));
    const res = await request(app).post('/contabil/modelos').send(modeloBodyComValores);
    expect(res.status).toBe(404);
  });

  it('rejeita posting numa conta sintética', async () => {
    const { app } = appWith((op) => {
      if (op.table === 'clients') return { data: { id: CID }, error: null };
      if (op.table === 'plano_contas') return { data: [{ ...contaForn, tipo: 'S' }, contaCaixa], error: null };
      return { data: null, error: null };
    });
    const res = await request(app).post('/contabil/modelos').send(modeloBodyComValores);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sintética/i);
  });

  it('cria o modelo e grava as partidas na ordem certa, sem mexer em período/saldo', async () => {
    const { app, ops } = appWith((op) => {
      if (op.table === 'clients') return { data: { id: CID }, error: null };
      if (op.table === 'plano_contas') return { data: [contaForn, contaCaixa], error: null };
      if (op.table === MODELO_TABLE && op.verb === 'insert') return { data: { id: MODELO_ID }, error: null };
      if (op.table === MODELO_TABLE && op.verb === 'select') {
        return {
          data: {
            id: MODELO_ID,
            client_id: CID,
            nome: modeloBodyComValores.nome,
            historico_codigo: null,
            historico_complemento: modeloBodyComValores.historico_complemento,
            ativo: true,
            partidas: [
              {
                id: 'mp1', plano_conta_id: contaForn.id, tipo: 'D', valor_cents_padrao: 10000, ordem: 0,
                plano_conta: { codigo: '2.1.1.01', nome: 'FORNECEDORES' },
              },
              {
                id: 'mp2', plano_conta_id: contaCaixa.id, tipo: 'C', valor_cents_padrao: 10000, ordem: 1,
                plano_conta: { codigo: '1.1.1.01', nome: 'CAIXA' },
              },
            ],
          },
          error: null,
        };
      }
      return { data: null, error: null };
    });

    const res = await request(app).post('/contabil/modelos').send(modeloBodyComValores);
    expect(res.status).toBe(201);
    expect(res.body.modelo.partidas).toHaveLength(2);

    const partidaInsert = ops.find((o) => o.table === MODELO_PARTIDA_TABLE && o.verb === 'insert');
    const payload = partidaInsert?.payload as Array<Record<string, unknown>>;
    expect(payload).toHaveLength(2);
    expect(payload[0]).toMatchObject({ tipo: 'D', valor_cents_padrao: 10000, ordem: 0 });
    expect(payload[1]).toMatchObject({ tipo: 'C', valor_cents_padrao: 10000, ordem: 1 });

    expect(ops.some((o) => o.table === 'periodos_contabeis')).toBe(false);
    expect(mockedRecompute).not.toHaveBeenCalled();
  });
});

describe('PATCH /contabil/modelos/:id', () => {
  it('404 quando não existe', async () => {
    const { app } = appWith(() => ({ data: null, error: null }));
    const res = await request(app).patch(`/contabil/modelos/${MODELO_ID}`).send(modeloBodyComValores);
    expect(res.status).toBe(404);
  });

  it('rejeita conta inválida', async () => {
    const { app } = appWith((op) => {
      if (op.table === MODELO_TABLE && op.verb === 'select') {
        return { data: { id: MODELO_ID, client_id: CID }, error: null };
      }
      if (op.table === 'plano_contas') return { data: [{ ...contaForn, ativo: false }, contaCaixa], error: null };
      return { data: null, error: null };
    });
    const res = await request(app).patch(`/contabil/modelos/${MODELO_ID}`).send(modeloBodyComValores);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/inativa/i);
  });

  it('apaga as partidas antigas e grava as novas', async () => {
    const { app, ops } = appWith((op) => {
      if (op.table === MODELO_TABLE && op.verb === 'select') {
        return {
          data: {
            id: MODELO_ID,
            client_id: CID,
            nome: modeloBodyComValores.nome,
            historico_codigo: null,
            historico_complemento: modeloBodyComValores.historico_complemento,
            ativo: true,
            partidas: [],
          },
          error: null,
        };
      }
      if (op.table === 'plano_contas') return { data: [contaForn, contaCaixa], error: null };
      return { data: null, error: null };
    });

    const res = await request(app)
      .patch(`/contabil/modelos/${MODELO_ID}`)
      .send({ ...modeloBodyComValores, ativo: false });
    expect(res.status).toBe(200);

    const delOp = ops.find((o) => o.table === MODELO_PARTIDA_TABLE && o.verb === 'delete');
    const insOp = ops.find((o) => o.table === MODELO_PARTIDA_TABLE && o.verb === 'insert');
    expect(ops.indexOf(delOp!)).toBeLessThan(ops.indexOf(insOp!));

    const updateOp = ops.find((o) => o.table === MODELO_TABLE && o.verb === 'update');
    expect(updateOp?.payload).toMatchObject({ ativo: false });
  });
});

describe('DELETE /contabil/modelos/:id', () => {
  it('404 quando não existe', async () => {
    const { app } = appWith(() => ({ data: null, error: null }));
    const res = await request(app).delete(`/contabil/modelos/${MODELO_ID}`);
    expect(res.status).toBe(404);
  });

  it('204 quando existe (cascade nas partidas fica a cargo do banco)', async () => {
    const { app } = appWith(() => ({ data: null, error: null, count: 1 }));
    const res = await request(app).delete(`/contabil/modelos/${MODELO_ID}`);
    expect(res.status).toBe(204);
  });
});

describe('POST /contabil/saldos/recalcular', () => {
  it('exige periodo_id', async () => {
    const { app } = appWith(() => ({ data: null, error: null }));
    const res = await request(app).post('/contabil/saldos/recalcular').send({});
    expect(res.status).toBe(400);
    expect(mockedRecompute).not.toHaveBeenCalled();
  });

  it('404 quando o período não existe', async () => {
    const { app } = appWith(() => ({ data: null, error: null }));
    const res = await request(app).post('/contabil/saldos/recalcular').send({ periodo_id: PERIODO_ID });
    expect(res.status).toBe(404);
  });

  it('chama o motor e devolve período + saldos recalculados', async () => {
    const { app } = appWith((op) => {
      if (op.table === 'periodos_contabeis') return { data: periodoSample, error: null };
      if (op.table === 'saldos_contabeis') return { data: [saldoSample], error: null };
      return { data: null, error: null };
    });
    const res = await request(app).post('/contabil/saldos/recalcular').send({ periodo_id: PERIODO_ID });
    expect(res.status).toBe(200);
    expect(mockedRecompute).toHaveBeenCalledWith(expect.anything(), 'user-1', PERIODO_ID);
    expect(res.body.periodo).toMatchObject({ id: PERIODO_ID });
    expect(res.body.saldos).toHaveLength(1);
  });

  it('propaga erro do motor (ex: período fechado com dado inconsistente) como erro HTTP', async () => {
    mockedRecompute.mockRejectedValue(new Error('saldo inconsistente'));
    const { app } = appWith(() => ({ data: periodoSample, error: null }));
    const res = await request(app).post('/contabil/saldos/recalcular').send({ periodo_id: PERIODO_ID });
    expect(res.status).toBe(500);
  });
});

const dreSample = {
  periodo: periodoSample,
  receitas: {
    raiz: {
      ...saldoSample,
      codigo: '4',
      nome: 'CONTAS DE RESULTADO - RECEITAS',
      saldo_atual_cents: 27750877,
      saldo_atual_natureza: 'C',
      debito_cents: 326806,
      credito_cents: 4329927,
    },
    linhas: [],
  },
  despesas: {
    raiz: {
      ...saldoSample,
      codigo: '5',
      nome: 'CONTAS DE RESULTADOS - CUSTOS E DESPESAS',
      saldo_atual_cents: 5511393,
      saldo_atual_natureza: 'D',
      debito_cents: 730756,
      credito_cents: 0,
    },
    linhas: [],
  },
  resultado_mes_cents: 3272365,
  resultado_mes_natureza: 'C',
  resultado_exercicio_cents: 22239484,
  resultado_exercicio_natureza: 'C',
};

const clienteSample = { razao_social: 'GABRIEL PINHEIRO LTDA', cnpj: '11222333000181', dominio_code: '168' };

describe('GET /contabil/relatorios/dre', () => {
  it('exige periodo_id', async () => {
    const { app } = appWith(() => ({ data: null, error: null }));
    const res = await request(app).get('/contabil/relatorios/dre');
    expect(res.status).toBe(400);
    expect(mockedMontarDre).not.toHaveBeenCalled();
  });

  it('devolve o relatório montado pelo motor', async () => {
    mockedMontarDre.mockResolvedValue(dreSample as unknown as DreRelatorio);
    const { app } = appWith(() => ({ data: null, error: null }));
    const res = await request(app).get(`/contabil/relatorios/dre?periodo_id=${PERIODO_ID}`);
    expect(res.status).toBe(200);
    expect(mockedMontarDre).toHaveBeenCalledWith(expect.anything(), PERIODO_ID);
    expect(res.body.resultado_mes_cents).toBe(3272365);
    expect(res.body.resultado_exercicio_cents).toBe(22239484);
    expect(res.body.receitas.raiz.codigo).toBe('4');
  });

  it('propaga erro do motor (ex: grupo de receitas/despesas não encontrado) como erro HTTP', async () => {
    mockedMontarDre.mockRejectedValue(badRequest('Não encontrei o grupo de receitas...'));
    const { app } = appWith(() => ({ data: null, error: null }));
    const res = await request(app).get(`/contabil/relatorios/dre?periodo_id=${PERIODO_ID}`);
    expect(res.status).toBe(400);
  });
});

describe('GET /contabil/relatorios/balancete/pdf', () => {
  it('exige periodo_id', async () => {
    const { app } = appWith(() => ({ data: null, error: null }));
    const res = await request(app).get('/contabil/relatorios/balancete/pdf');
    expect(res.status).toBe(400);
    expect(mockedGerarBalancetePdf).not.toHaveBeenCalled();
  });

  it('404 quando o período não existe', async () => {
    const { app } = appWith(() => ({ data: null, error: null }));
    const res = await request(app).get(`/contabil/relatorios/balancete/pdf?periodo_id=${PERIODO_ID}`);
    expect(res.status).toBe(404);
  });

  it('busca saldos+cliente, chama o parser e devolve o PDF com o nome de arquivo certo', async () => {
    const { app } = appWith((op) => {
      if (op.table === 'periodos_contabeis') return { data: periodoSample, error: null };
      if (op.table === 'saldos_contabeis') return { data: [saldoSample], error: null };
      if (op.table === 'clients') return { data: clienteSample, error: null };
      return { data: null, error: null };
    });
    const res = await request(app).get(`/contabil/relatorios/balancete/pdf?periodo_id=${PERIODO_ID}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain('(168) Balancete 06-2026.pdf');
    const body = res.body instanceof Buffer ? res.body : Buffer.from(res.text ?? '', 'binary');
    expect(body.toString()).toBe('%PDF-fake-balancete');

    expect(mockedGerarBalancetePdf).toHaveBeenCalledWith(
      expect.objectContaining({
        cliente: { razao_social: clienteSample.razao_social, cnpj: clienteSample.cnpj },
        periodo: { ano: 2026, mes: 6 },
        linhas: [expect.objectContaining({ codigo: '1', nome: 'ATIVO' })],
      }),
    );
    // não vaza id/ordem/timestamps internos pro payload do parser
    const [payload] = mockedGerarBalancetePdf.mock.calls[0]!;
    expect(payload.linhas[0]).not.toHaveProperty('id');
    expect(payload.linhas[0]).not.toHaveProperty('ordem');
  });

  it('propaga erro do parser (ex: serviço indisponível) como erro HTTP', async () => {
    mockedGerarBalancetePdf.mockRejectedValue(badGateway('Serviço de geração de PDF indisponível'));
    const { app } = appWith((op) => {
      if (op.table === 'periodos_contabeis') return { data: periodoSample, error: null };
      if (op.table === 'saldos_contabeis') return { data: [saldoSample], error: null };
      if (op.table === 'clients') return { data: clienteSample, error: null };
      return { data: null, error: null };
    });
    const res = await request(app).get(`/contabil/relatorios/balancete/pdf?periodo_id=${PERIODO_ID}`);
    expect(res.status).toBe(502);
  });
});

describe('GET /contabil/relatorios/dre/pdf', () => {
  it('exige periodo_id', async () => {
    const { app } = appWith(() => ({ data: null, error: null }));
    const res = await request(app).get('/contabil/relatorios/dre/pdf');
    expect(res.status).toBe(400);
    expect(mockedGerarDrePdf).not.toHaveBeenCalled();
  });

  it('monta o relatório, chama o parser e devolve o PDF com o nome de arquivo certo', async () => {
    mockedMontarDre.mockResolvedValue(dreSample as unknown as DreRelatorio);
    const { app } = appWith((op) => {
      if (op.table === 'clients') return { data: clienteSample, error: null };
      return { data: null, error: null };
    });
    const res = await request(app).get(`/contabil/relatorios/dre/pdf?periodo_id=${PERIODO_ID}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain('(168) DRE 06-2026.pdf');
    const body = res.body instanceof Buffer ? res.body : Buffer.from(res.text ?? '', 'binary');
    expect(body.toString()).toBe('%PDF-fake-dre');

    expect(mockedGerarDrePdf).toHaveBeenCalledWith(
      expect.objectContaining({
        cliente: { razao_social: clienteSample.razao_social, cnpj: clienteSample.cnpj },
        resultado_mes: { cents: 3272365, natureza: 'C' },
        resultado_exercicio: { cents: 22239484, natureza: 'C' },
      }),
    );
  });

  it('propaga erro do motor (ex: grupo de despesas ambíguo) como erro HTTP', async () => {
    mockedMontarDre.mockRejectedValue(badRequest('Mais de uma conta de grau 1 corresponde a despesas'));
    const { app } = appWith(() => ({ data: clienteSample, error: null }));
    const res = await request(app).get(`/contabil/relatorios/dre/pdf?periodo_id=${PERIODO_ID}`);
    expect(res.status).toBe(400);
    expect(mockedGerarDrePdf).not.toHaveBeenCalled();
  });
});

const CONTA_RAZAO_ID = '66666666-6666-6666-6666-666666666666';
const razaoSample = {
  periodo: periodoSample,
  conta: { codigo: '5', nome: 'CAIXA GERAL' },
  saldo_anterior_cents: 10000,
  saldo_anterior_natureza: 'D',
  linhas: [
    {
      lancamento_id: LANC_ID,
      data: '2026-06-15',
      historico_codigo: null,
      historico_complemento: 'Pagamento X',
      tipo: 'D',
      valor_cents: 5000,
      saldo_cents: 15000,
      saldo_natureza: 'D',
    },
  ],
  saldo_atual_cents: 15000,
  saldo_atual_natureza: 'D',
};

describe('GET /contabil/relatorios/razao', () => {
  it('exige periodo_id e plano_conta_id', async () => {
    const { app } = appWith(() => ({ data: null, error: null }));
    const res = await request(app).get(`/contabil/relatorios/razao?periodo_id=${PERIODO_ID}`);
    expect(res.status).toBe(400);
    expect(mockedMontarRazao).not.toHaveBeenCalled();
  });

  it('devolve o razão montado pelo motor', async () => {
    mockedMontarRazao.mockResolvedValue(razaoSample as unknown as RazaoRelatorio);
    const { app } = appWith(() => ({ data: null, error: null }));
    const res = await request(app).get(
      `/contabil/relatorios/razao?periodo_id=${PERIODO_ID}&plano_conta_id=${CONTA_RAZAO_ID}`,
    );
    expect(res.status).toBe(200);
    expect(mockedMontarRazao).toHaveBeenCalledWith(expect.anything(), PERIODO_ID, CONTA_RAZAO_ID);
    expect(res.body.saldo_atual_cents).toBe(15000);
    expect(res.body.linhas).toHaveLength(1);
  });

  it('propaga erro do motor (ex: conta sintética) como erro HTTP', async () => {
    mockedMontarRazao.mockRejectedValue(badRequest('Conta sintética não tem razão'));
    const { app } = appWith(() => ({ data: null, error: null }));
    const res = await request(app).get(
      `/contabil/relatorios/razao?periodo_id=${PERIODO_ID}&plano_conta_id=${CONTA_RAZAO_ID}`,
    );
    expect(res.status).toBe(400);
  });
});

describe('GET /contabil/relatorios/razao/pdf', () => {
  it('exige periodo_id e plano_conta_id', async () => {
    const { app } = appWith(() => ({ data: null, error: null }));
    const res = await request(app).get('/contabil/relatorios/razao/pdf');
    expect(res.status).toBe(400);
    expect(mockedGerarRazaoPdf).not.toHaveBeenCalled();
  });

  it('monta o razão, chama o parser e devolve o PDF com o nome de arquivo certo (inclui o código da conta)', async () => {
    mockedMontarRazao.mockResolvedValue(razaoSample as unknown as RazaoRelatorio);
    const { app } = appWith((op) => {
      if (op.table === 'clients') return { data: clienteSample, error: null };
      return { data: null, error: null };
    });
    const res = await request(app).get(
      `/contabil/relatorios/razao/pdf?periodo_id=${PERIODO_ID}&plano_conta_id=${CONTA_RAZAO_ID}`,
    );

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain('(168) Razao 5 06-2026.pdf');
    const body = res.body instanceof Buffer ? res.body : Buffer.from(res.text ?? '', 'binary');
    expect(body.toString()).toBe('%PDF-fake-razao');

    expect(mockedGerarRazaoPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        conta: { codigo: '5', nome: 'CAIXA GERAL' },
        saldo_atual_cents: 15000,
      }),
    );
    // não vaza lancamento_id pro payload do parser
    const [payload] = mockedGerarRazaoPdf.mock.calls[0]!;
    expect(payload.linhas[0]).not.toHaveProperty('lancamento_id');
  });

  it('propaga erro do parser como erro HTTP', async () => {
    mockedMontarRazao.mockResolvedValue(razaoSample as unknown as RazaoRelatorio);
    mockedGerarRazaoPdf.mockRejectedValue(badGateway('Serviço de geração de PDF indisponível'));
    const { app } = appWith((op) => {
      if (op.table === 'clients') return { data: clienteSample, error: null };
      return { data: null, error: null };
    });
    const res = await request(app).get(
      `/contabil/relatorios/razao/pdf?periodo_id=${PERIODO_ID}&plano_conta_id=${CONTA_RAZAO_ID}`,
    );
    expect(res.status).toBe(502);
  });
});

describe('GET /contabil/relatorios/livro-diario/pdf', () => {
  it('exige periodo_id', async () => {
    const { app } = appWith(() => ({ data: null, error: null }));
    const res = await request(app).get('/contabil/relatorios/livro-diario/pdf');
    expect(res.status).toBe(400);
    expect(mockedGerarLivroDiarioPdf).not.toHaveBeenCalled();
  });

  it('404 quando o período não existe', async () => {
    const { app } = appWith(() => ({ data: null, error: null }));
    const res = await request(app).get(`/contabil/relatorios/livro-diario/pdf?periodo_id=${PERIODO_ID}`);
    expect(res.status).toBe(404);
  });

  it('busca lançamentos+cliente, chama o parser e devolve o PDF com o nome certo', async () => {
    const { app } = appWith((op) => {
      if (op.table === 'periodos_contabeis') return { data: periodoSample, error: null };
      if (op.table === 'clients') return { data: clienteSample, error: null };
      if (op.table === 'lancamentos') {
        return {
          data: [
            {
              id: LANC_ID,
              periodo_id: PERIODO_ID,
              data: '2026-06-15',
              historico_codigo: null,
              historico_complemento: 'Pagamento fornecedor',
              partidas: [
                {
                  id: 'lp1', plano_conta_id: contaForn.id, tipo: 'D', valor_cents: 10000, ordem: 0,
                  plano_conta: { codigo: '2.1.1.01', nome: 'FORNECEDORES' },
                },
                {
                  id: 'lp2', plano_conta_id: contaCaixa.id, tipo: 'C', valor_cents: 10000, ordem: 1,
                  plano_conta: { codigo: '1.1.1.01', nome: 'CAIXA' },
                },
              ],
            },
          ],
          error: null,
        };
      }
      return { data: null, error: null };
    });
    const res = await request(app).get(`/contabil/relatorios/livro-diario/pdf?periodo_id=${PERIODO_ID}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain('(168) Livro Diario 06-2026.pdf');
    const body = res.body instanceof Buffer ? res.body : Buffer.from(res.text ?? '', 'binary');
    expect(body.toString()).toBe('%PDF-fake-livro-diario');

    expect(mockedGerarLivroDiarioPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        lancamentos: [
          expect.objectContaining({
            data: '2026-06-15',
            partidas: [
              { conta_codigo: '2.1.1.01', conta_nome: 'FORNECEDORES', tipo: 'D', valor_cents: 10000 },
              { conta_codigo: '1.1.1.01', conta_nome: 'CAIXA', tipo: 'C', valor_cents: 10000 },
            ],
          }),
        ],
      }),
    );
    // não vaza id/plano_conta_id/ordem internos pro payload do parser
    const [payload] = mockedGerarLivroDiarioPdf.mock.calls[0]!;
    expect(payload.lancamentos[0]!.partidas[0]).not.toHaveProperty('ordem');
  });

  it('propaga erro do parser como erro HTTP', async () => {
    mockedGerarLivroDiarioPdf.mockRejectedValue(badGateway('Serviço de geração de PDF indisponível'));
    const { app } = appWith((op) => {
      if (op.table === 'periodos_contabeis') return { data: periodoSample, error: null };
      if (op.table === 'clients') return { data: clienteSample, error: null };
      if (op.table === 'lancamentos') return { data: [], error: null };
      return { data: null, error: null };
    });
    const res = await request(app).get(`/contabil/relatorios/livro-diario/pdf?periodo_id=${PERIODO_ID}`);
    expect(res.status).toBe(502);
  });
});

describe('POST /contabil/periodos/:id/fechar', () => {
  it('404 quando período não existe', async () => {
    const { app } = appWith(() => ({ data: null, error: null }));
    const res = await request(app).post(`/contabil/periodos/${PERIODO_ID}/fechar`);
    expect(res.status).toBe(404);
  });

  it('400 se já está fechado', async () => {
    const { app } = appWith(() => ({ data: periodoSample, error: null })); // periodoSample.status === 'fechado'
    const res = await request(app).post(`/contabil/periodos/${PERIODO_ID}/fechar`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/já está fechado/);
  });

  it('400 sem nenhum lançamento no período', async () => {
    const { app } = appWith((op) => {
      if (op.table === 'periodos_contabeis') return { data: { ...periodoSample, status: 'aberto' }, error: null };
      if (op.table === 'lancamentos') return { data: null, error: null, count: 0 };
      return { data: null, error: null };
    });
    const res = await request(app).post(`/contabil/periodos/${PERIODO_ID}/fechar`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/não tem nenhum lançamento/);
    expect(mockedRecompute).not.toHaveBeenCalled();
  });

  it('caminho feliz: chama o motor de saldos ANTES de marcar o período como fechado, e registra a auditoria', async () => {
    const ordem: string[] = [];
    mockedRecompute.mockImplementation(async () => {
      ordem.push('recompute');
    });
    const { app, ops } = appWith((op) => {
      if (op.table === 'periodos_contabeis' && op.verb === 'update') {
        ordem.push('update');
        return { data: { ...periodoSample, status: 'fechado' }, error: null };
      }
      if (op.table === 'periodos_contabeis' && op.filters.some(([col]) => col === 'id')) {
        return { data: { ...periodoSample, status: 'aberto' }, error: null };
      }
      if (op.table === 'periodos_contabeis') return { data: [], error: null }; // guarda-corpo: sem período anterior
      if (op.table === 'lancamentos') return { data: null, error: null, count: 2 };
      return { data: null, error: null };
    });
    const res = await request(app).post(`/contabil/periodos/${PERIODO_ID}/fechar`);
    expect(res.status).toBe(200);
    expect(mockedRecompute).toHaveBeenCalledWith(expect.anything(), 'user-1', PERIODO_ID);
    expect(ordem).toEqual(['recompute', 'update']);
    expect(res.body.periodo.status).toBe('fechado');

    const auditoriaInsert = ops.find((o) => o.table === 'contabil_auditoria' && o.verb === 'insert');
    expect(auditoriaInsert?.payload).toMatchObject({
      periodo_id: PERIODO_ID,
      acao: 'fechado',
      detalhe: { qtd_lancamentos: 2 },
    });
  });

  it('bloqueia fechar fora de ordem cronológica (período anterior ainda aberto)', async () => {
    const { app, ops } = appWith((op) => {
      if (op.table === 'periodos_contabeis' && op.filters.some(([col]) => col === 'id')) {
        return { data: { ...periodoSample, status: 'aberto' }, error: null };
      }
      if (op.table === 'periodos_contabeis') {
        return { data: [{ id: 'outro', ano: 2026, mes: 5, status: 'aberto' }], error: null };
      }
      if (op.table === 'lancamentos') return { data: null, error: null, count: 2 };
      return { data: null, error: null };
    });
    const res = await request(app).post(`/contabil/periodos/${PERIODO_ID}/fechar`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/5\/2026/);
    expect(mockedRecompute).not.toHaveBeenCalled();
    expect(ops.some((o) => o.table === 'contabil_auditoria')).toBe(false);
  });

  it('propaga erro do motor de saldos como erro HTTP', async () => {
    mockedRecompute.mockRejectedValue(new Error('boom'));
    const { app } = appWith((op) => {
      if (op.table === 'periodos_contabeis' && op.filters.some(([col]) => col === 'id')) {
        return { data: { ...periodoSample, status: 'aberto' }, error: null };
      }
      if (op.table === 'periodos_contabeis') return { data: [], error: null };
      if (op.table === 'lancamentos') return { data: null, error: null, count: 1 };
      return { data: null, error: null };
    });
    const res = await request(app).post(`/contabil/periodos/${PERIODO_ID}/fechar`);
    expect(res.status).toBe(500);
  });
});

describe('POST /contabil/periodos/:id/reabrir', () => {
  it('404 quando período não existe', async () => {
    const { app } = appWith(() => ({ data: null, error: null }));
    const res = await request(app).post(`/contabil/periodos/${PERIODO_ID}/reabrir`);
    expect(res.status).toBe(404);
  });

  it('400 se já está aberto', async () => {
    const { app } = appWith(() => ({ data: { ...periodoSample, status: 'aberto' }, error: null }));
    const res = await request(app).post(`/contabil/periodos/${PERIODO_ID}/reabrir`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/já está aberto/);
  });

  it('bloqueia reabrir fora de ordem cronológica (período posterior já fechado)', async () => {
    const { app } = appWith((op) => {
      if (op.table === 'periodos_contabeis' && op.filters.some(([col]) => col === 'id')) {
        return { data: periodoSample, error: null }; // fechado, ano 2026 mes 6
      }
      if (op.table === 'periodos_contabeis') {
        return { data: [{ id: 'outro', ano: 2026, mes: 7, status: 'fechado' }], error: null };
      }
      return { data: null, error: null };
    });
    const res = await request(app).post(`/contabil/periodos/${PERIODO_ID}/reabrir`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/7\/2026/);
  });

  it('caminho feliz: reabre, zera fechado_em, não chama o motor de saldos, registra auditoria', async () => {
    const { app, ops } = appWith((op) => {
      if (op.table === 'periodos_contabeis' && op.verb === 'update') {
        return { data: { ...periodoSample, status: 'aberto', fechado_em: null }, error: null };
      }
      if (op.table === 'periodos_contabeis' && op.filters.some(([col]) => col === 'id')) {
        return { data: periodoSample, error: null };
      }
      if (op.table === 'periodos_contabeis') return { data: [], error: null };
      return { data: null, error: null };
    });
    const res = await request(app).post(`/contabil/periodos/${PERIODO_ID}/reabrir`);
    expect(res.status).toBe(200);
    expect(res.body.periodo.status).toBe('aberto');
    expect(res.body.periodo.fechado_em).toBeNull();
    expect(mockedRecompute).not.toHaveBeenCalled();

    const updateOp = ops.find((o) => o.table === 'periodos_contabeis' && o.verb === 'update');
    expect(updateOp?.payload).toMatchObject({ status: 'aberto', fechado_em: null });

    const auditoriaInsert = ops.find((o) => o.table === 'contabil_auditoria' && o.verb === 'insert');
    expect(auditoriaInsert?.payload).toMatchObject({ periodo_id: PERIODO_ID, acao: 'reaberto', detalhe: {} });
  });
});

describe('GET /contabil/periodos/:id/diagnostico', () => {
  it('404 quando período não existe', async () => {
    const { app } = appWith(() => ({ data: null, error: null }));
    const res = await request(app).get(`/contabil/periodos/${PERIODO_ID}/diagnostico`);
    expect(res.status).toBe(404);
  });

  it('período aberto com anterior aberto: periodo_anterior_aberto preenchido, posterior não se aplica', async () => {
    const { app } = appWith((op) => {
      if (op.table === 'periodos_contabeis' && op.filters.some(([col]) => col === 'id')) {
        return { data: { ...periodoSample, status: 'aberto' }, error: null };
      }
      if (op.table === 'periodos_contabeis') {
        return { data: [{ id: 'outro', ano: 2026, mes: 5, status: 'aberto' }], error: null };
      }
      if (op.table === 'lancamentos') return { data: null, error: null, count: 3 };
      if (op.table === 'contabil_auditoria') return { data: [], error: null };
      return { data: null, error: null };
    });
    const res = await request(app).get(`/contabil/periodos/${PERIODO_ID}/diagnostico`);
    expect(res.status).toBe(200);
    expect(res.body.qtd_lancamentos).toBe(3);
    expect(res.body.periodo_anterior_aberto).toMatchObject({ ano: 2026, mes: 5 });
    expect(res.body.periodo_posterior_fechado).toBeNull();
  });

  it('período fechado com posterior fechado: periodo_posterior_fechado preenchido, anterior não se aplica', async () => {
    const { app } = appWith((op) => {
      if (op.table === 'periodos_contabeis' && op.filters.some(([col]) => col === 'id')) {
        return { data: periodoSample, error: null }; // fechado, ano 2026 mes 6
      }
      if (op.table === 'periodos_contabeis') {
        return { data: [{ id: 'outro', ano: 2026, mes: 7, status: 'fechado' }], error: null };
      }
      if (op.table === 'lancamentos') return { data: null, error: null, count: 5 };
      if (op.table === 'contabil_auditoria') return { data: [], error: null };
      return { data: null, error: null };
    });
    const res = await request(app).get(`/contabil/periodos/${PERIODO_ID}/diagnostico`);
    expect(res.status).toBe(200);
    expect(res.body.periodo_posterior_fechado).toMatchObject({ ano: 2026, mes: 7 });
    expect(res.body.periodo_anterior_aberto).toBeNull();
  });

  it('lista os eventos de auditoria mais recente primeiro', async () => {
    const eventos = [
      { id: 'ev2', acao: 'dominio_exportado', detalhe: { lote_numero: 1 }, created_at: '2026-06-20T00:00:00.000Z' },
      { id: 'ev1', acao: 'fechado', detalhe: { qtd_lancamentos: 2 }, created_at: '2026-06-15T00:00:00.000Z' },
    ];
    const { app, ops } = appWith((op) => {
      if (op.table === 'periodos_contabeis' && op.filters.some(([col]) => col === 'id')) {
        return { data: periodoSample, error: null };
      }
      if (op.table === 'periodos_contabeis') return { data: [], error: null };
      if (op.table === 'lancamentos') return { data: null, error: null, count: 2 };
      if (op.table === 'contabil_auditoria') return { data: eventos, error: null };
      return { data: null, error: null };
    });
    const res = await request(app).get(`/contabil/periodos/${PERIODO_ID}/diagnostico`);
    expect(res.status).toBe(200);
    expect(res.body.eventos).toEqual(eventos);
    const auditoriaOp = ops.find((o) => o.table === 'contabil_auditoria' && o.verb === 'select');
    expect(auditoriaOp?.orderCalls).toEqual([{ col: 'created_at', foreignTable: undefined, ascending: false }]);
  });
});

function lancamentoRowParaExport(
  overrides: { historico_codigo?: string | null; partidas?: unknown[] } = {},
) {
  return {
    id: LANC_ID,
    periodo_id: PERIODO_ID,
    data: '2026-06-15',
    historico_codigo: overrides.historico_codigo !== undefined ? overrides.historico_codigo : '186',
    historico_complemento: 'Pagamento fornecedor',
    created_at: '2026-06-15T10:00:00.000Z',
    updated_at: '2026-06-15T10:00:00.000Z',
    partidas: overrides.partidas ?? [
      {
        id: 'lp1', plano_conta_id: contaForn.id, tipo: 'D', valor_cents: 10000, ordem: 0,
        plano_conta: { codigo: '272', nome: 'FORNECEDORES' },
      },
      {
        id: 'lp2', plano_conta_id: contaCaixa.id, tipo: 'C', valor_cents: 10000, ordem: 1,
        plano_conta: { codigo: '10002', nome: 'CAIXA' },
      },
    ],
  };
}

describe('GET /contabil/relatorios/exportar-dominio', () => {
  it('exige periodo_id', async () => {
    const { app } = appWith(() => ({ data: null, error: null }));
    const res = await request(app).get('/contabil/relatorios/exportar-dominio');
    expect(res.status).toBe(400);
  });

  it('404 quando o período não existe', async () => {
    const { app } = appWith(() => ({ data: null, error: null }));
    const res = await request(app).get(`/contabil/relatorios/exportar-dominio?periodo_id=${PERIODO_ID}`);
    expect(res.status).toBe(404);
  });

  it('400 se o período ainda está aberto', async () => {
    const { app } = appWith((op) => {
      if (op.table === 'periodos_contabeis') return { data: { ...periodoSample, status: 'aberto' }, error: null };
      return { data: null, error: null };
    });
    const res = await request(app).get(`/contabil/relatorios/exportar-dominio?periodo_id=${PERIODO_ID}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/fechado/);
  });

  it('gera o .txt do lançamento simples com os headers certos (partida decomposta em 1 par)', async () => {
    const { app } = appWith((op) => {
      if (op.table === 'periodos_contabeis') return { data: periodoSample, error: null }; // fechado, ano 2026 mes 6
      if (op.table === 'clients') return { data: clienteSample, error: null };
      if (op.table === 'lancamentos') return { data: [lancamentoRowParaExport()], error: null };
      return { data: null, error: null };
    });
    const res = await request(app).get(`/contabil/relatorios/exportar-dominio?periodo_id=${PERIODO_ID}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.headers['content-type']).toContain('iso-8859-1');
    expect(res.headers['content-disposition']).toContain('(168) Dominio 06-2026.txt');
    expect(res.headers['x-export-sha256']).toBeTruthy();
    expect(res.headers['x-export-linhas']).toBe('4'); // 01 + 02 + 03 + 99

    const body = res.body instanceof Buffer ? res.body : Buffer.from(res.text ?? '', 'binary');
    const linhas = body.toString('latin1').replace(/\r\n$/, '').split('\r\n');
    expect(linhas).toHaveLength(4);
    expect(linhas[2]!.slice(9, 16)).toBe('0000272'); // débito
    expect(linhas[2]!.slice(16, 23)).toBe('0010002'); // crédito
  });

  it('lançamento com partida múltipla decompõe em mais de um registro 03', async () => {
    const { app } = appWith((op) => {
      if (op.table === 'periodos_contabeis') return { data: periodoSample, error: null };
      if (op.table === 'clients') return { data: clienteSample, error: null };
      if (op.table === 'lancamentos') {
        return {
          data: [
            lancamentoRowParaExport({
              partidas: [
                { id: 'lp1', plano_conta_id: 'x', tipo: 'D', valor_cents: 10000, ordem: 0, plano_conta: { codigo: '100', nome: 'A' } },
                { id: 'lp2', plano_conta_id: 'y', tipo: 'C', valor_cents: 6000, ordem: 0, plano_conta: { codigo: '200', nome: 'B' } },
                { id: 'lp3', plano_conta_id: 'z', tipo: 'C', valor_cents: 4000, ordem: 1, plano_conta: { codigo: '300', nome: 'C' } },
              ],
            }),
          ],
          error: null,
        };
      }
      return { data: null, error: null };
    });
    const res = await request(app).get(`/contabil/relatorios/exportar-dominio?periodo_id=${PERIODO_ID}`);
    expect(res.status).toBe(200);
    const body = res.body instanceof Buffer ? res.body : Buffer.from(res.text ?? '', 'binary');
    const linhas = body.toString('latin1').replace(/\r\n$/, '').split('\r\n');
    expect(linhas).toHaveLength(5); // 01 + 02 + 03 + 03 + 99
  });

  it('histórico nulo (lançamento em texto livre) não trava a exportação', async () => {
    const { app } = appWith((op) => {
      if (op.table === 'periodos_contabeis') return { data: periodoSample, error: null };
      if (op.table === 'clients') return { data: clienteSample, error: null };
      if (op.table === 'lancamentos') {
        return { data: [lancamentoRowParaExport({ historico_codigo: null })], error: null };
      }
      return { data: null, error: null };
    });
    const res = await request(app).get(`/contabil/relatorios/exportar-dominio?periodo_id=${PERIODO_ID}`);
    expect(res.status).toBe(200);
  });

  it('conta com código longo demais vira erro 400 (ExportError propagado como badRequest)', async () => {
    const { app } = appWith((op) => {
      if (op.table === 'periodos_contabeis') return { data: periodoSample, error: null };
      if (op.table === 'clients') return { data: clienteSample, error: null };
      if (op.table === 'lancamentos') {
        return {
          data: [
            lancamentoRowParaExport({
              partidas: [
                { id: 'lp1', plano_conta_id: 'x', tipo: 'D', valor_cents: 100, ordem: 0, plano_conta: { codigo: '123456789', nome: 'A' } },
                { id: 'lp2', plano_conta_id: 'y', tipo: 'C', valor_cents: 100, ordem: 1, plano_conta: { codigo: '272', nome: 'B' } },
              ],
            }),
          ],
          error: null,
        };
      }
      return { data: null, error: null };
    });
    const res = await request(app).get(`/contabil/relatorios/exportar-dominio?periodo_id=${PERIODO_ID}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/7 dígitos/);
  });

  it('registra o evento de auditoria dominio_exportado com lote/qtd/sha256', async () => {
    const { app, ops } = appWith((op) => {
      if (op.table === 'periodos_contabeis') return { data: periodoSample, error: null };
      if (op.table === 'clients') return { data: clienteSample, error: null };
      if (op.table === 'lancamentos') return { data: [lancamentoRowParaExport()], error: null };
      return { data: null, error: null };
    });
    const res = await request(app).get(
      `/contabil/relatorios/exportar-dominio?periodo_id=${PERIODO_ID}&lote_numero=3`,
    );
    expect(res.status).toBe(200);

    const auditoriaInsert = ops.find((o) => o.table === 'contabil_auditoria' && o.verb === 'insert');
    expect(auditoriaInsert?.payload).toMatchObject({
      periodo_id: PERIODO_ID,
      acao: 'dominio_exportado',
      detalhe: { lote_numero: 3, qtd_lancamentos: 1, sha256: res.headers['x-export-sha256'] },
    });
  });
});

const STATEMENT_ID = '77777777-7777-7777-7777-777777777777';
const TXN_ID = '88888888-8888-8888-8888-888888888888';
const CONTA_BANCO = { id: 'cb-1', client_id: CID, codigo: '10002', tipo: 'A', ativo: true };
const CONTA_CONTRAPARTIDA = { id: 'cc-1', client_id: CID, codigo: '272', tipo: 'A', ativo: true };

function statementSample(over: Record<string, unknown> = {}) {
  return { id: STATEMENT_ID, banco_conta_contabil: '10002', complemento_modo: 'extrato', ...over };
}

function transacaoSample(over: Record<string, unknown> = {}) {
  return {
    id: TXN_ID,
    statement_id: STATEMENT_ID,
    ordem: 0,
    data: '2026-06-10',
    descricao_raw: 'PIX recebido',
    valor: '150.00',
    direction: 'entrada',
    conta_contabil: '272',
    hist_code: '138',
    hist_complemento: '',
    ...over,
  };
}

describe('POST /contabil/lancamentos/importar-transacoes', () => {
  it('404 quando o cliente não existe', async () => {
    const { app } = appWith(() => ({ data: null, error: null }));
    const res = await request(app)
      .post('/contabil/lancamentos/importar-transacoes')
      .send({ client_id: CID, ano: 2026, mes: 6 });
    expect(res.status).toBe(404);
  });

  it('400 se o período já está fechado — não toca em transactions/statements', async () => {
    const { app, ops } = appWith((op) => {
      if (op.table === 'clients') return { data: { id: CID }, error: null };
      if (op.table === 'periodos_contabeis' && op.single === 'single') {
        return { data: { id: PERIODO_ID, status: 'fechado' }, error: null };
      }
      return { data: null, error: null };
    });
    const res = await request(app)
      .post('/contabil/lancamentos/importar-transacoes')
      .send({ client_id: CID, ano: 2026, mes: 6 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/fechado/);
    expect(ops.some((o) => o.table === 'transactions')).toBe(false);
    expect(ops.some((o) => o.table === 'statements')).toBe(false);
  });

  function montarHandlerFeliz(opts: {
    transacoes?: Record<string, unknown>[];
    statements?: Record<string, unknown>[];
    jaImportadas?: string[];
    historicos?: string[];
  }): FakeHandler {
    const {
      transacoes = [transacaoSample()],
      statements = [statementSample()],
      jaImportadas = [],
      historicos = ['138', '186'],
    } = opts;
    let seqLancamento = 0;
    return (op) => {
      if (op.table === 'clients') return { data: { id: CID }, error: null };
      if (op.table === 'periodos_contabeis' && op.single === 'single') {
        return { data: { id: PERIODO_ID, status: 'aberto' }, error: null };
      }
      if (op.table === 'periodos_contabeis') return { data: null, error: null }; // upsert
      if (op.table === 'statements') return { data: statements, error: null };
      if (op.table === 'transactions') return { data: transacoes, error: null };
      if (op.table === 'lancamentos' && op.verb === 'select') {
        return { data: jaImportadas.map((id) => ({ origem_transaction_id: id })), error: null };
      }
      if (op.table === 'lancamentos' && op.verb === 'insert') {
        seqLancamento++;
        return { data: { id: `lanc-${seqLancamento}` }, error: null };
      }
      if (op.table === 'plano_contas') return { data: [CONTA_BANCO, CONTA_CONTRAPARTIDA], error: null };
      if (op.table === 'historicos_padrao') return { data: historicos.map((codigo) => ({ codigo })), error: null };
      if (op.table === 'lancamento_partidas') return { data: null, error: null };
      return { data: null, error: null };
    };
  }

  it('transação sem conta_contabil classificada é ignorada com aviso', async () => {
    const { app } = appWith(montarHandlerFeliz({ transacoes: [transacaoSample({ conta_contabil: null })] }));
    const res = await request(app)
      .post('/contabil/lancamentos/importar-transacoes')
      .send({ client_id: CID, ano: 2026, mes: 6 });
    expect(res.status).toBe(200);
    expect(res.body.importados).toBe(0);
    expect(res.body.ignorados).toBe(1);
    expect(res.body.warnings[0]).toMatch(/sem conta contábil/);
  });

  it('conta que não existe no plano de contas é ignorada com aviso nomeando o código', async () => {
    const { app } = appWith(
      montarHandlerFeliz({ transacoes: [transacaoSample({ conta_contabil: '999999' })] }),
    );
    const res = await request(app)
      .post('/contabil/lancamentos/importar-transacoes')
      .send({ client_id: CID, ano: 2026, mes: 6 });
    expect(res.status).toBe(200);
    expect(res.body.importados).toBe(0);
    expect(res.body.ignorados).toBe(1);
    expect(res.body.warnings[0]).toMatch(/999999/);
  });

  it('conta sintética (não analítica) também conta como "não resolve"', async () => {
    const base = montarHandlerFeliz({});
    const { app } = appWith((op) => {
      if (op.table === 'plano_contas') {
        return { data: [CONTA_BANCO, { ...CONTA_CONTRAPARTIDA, tipo: 'S' }], error: null };
      }
      return base(op);
    });
    const res = await request(app)
      .post('/contabil/lancamentos/importar-transacoes')
      .send({ client_id: CID, ano: 2026, mes: 6 });
    expect(res.status).toBe(200);
    expect(res.body.importados).toBe(0);
    expect(res.body.ignorados).toBe(1);
  });

  it('filtra ignorado=false na busca de transações', async () => {
    const { app, ops } = appWith(montarHandlerFeliz({}));
    await request(app)
      .post('/contabil/lancamentos/importar-transacoes')
      .send({ client_id: CID, ano: 2026, mes: 6 });
    const opTx = ops.find((o) => o.table === 'transactions');
    expect(opTx?.filters).toContainEqual(['ignorado', false]);
  });

  it('transação já importada é pulada sem virar aviso', async () => {
    const { app } = appWith(montarHandlerFeliz({ jaImportadas: [TXN_ID] }));
    const res = await request(app)
      .post('/contabil/lancamentos/importar-transacoes')
      .send({ client_id: CID, ano: 2026, mes: 6 });
    expect(res.status).toBe(200);
    expect(res.body.importados).toBe(0);
    expect(res.body.ignorados).toBe(0);
    expect(res.body.warnings).toEqual([]);
  });

  it('historico_codigo fora do catálogo (vazio) vira null, sem erro', async () => {
    const { app, ops } = appWith(montarHandlerFeliz({ historicos: [] }));
    const res = await request(app)
      .post('/contabil/lancamentos/importar-transacoes')
      .send({ client_id: CID, ano: 2026, mes: 6 });
    expect(res.status).toBe(200);
    expect(res.body.importados).toBe(1);
    const insert = ops.find((o) => o.table === 'lancamentos' && o.verb === 'insert');
    expect((insert?.payload as { historico_codigo: unknown }).historico_codigo).toBeNull();
  });

  it('entrada: D banco / C contrapartida', async () => {
    const { app, ops } = appWith(montarHandlerFeliz({ transacoes: [transacaoSample({ direction: 'entrada' })] }));
    const res = await request(app)
      .post('/contabil/lancamentos/importar-transacoes')
      .send({ client_id: CID, ano: 2026, mes: 6 });
    expect(res.status).toBe(200);
    expect(res.body.importados).toBe(1);
    const partidasInsert = ops.find((o) => o.table === 'lancamento_partidas');
    const partidas = partidasInsert?.payload as Array<{ plano_conta_id: string; tipo: string }>;
    expect(partidas.find((p) => p.tipo === 'D')?.plano_conta_id).toBe(CONTA_BANCO.id);
    expect(partidas.find((p) => p.tipo === 'C')?.plano_conta_id).toBe(CONTA_CONTRAPARTIDA.id);
  });

  it('saída: D contrapartida / C banco', async () => {
    const { app, ops } = appWith(montarHandlerFeliz({ transacoes: [transacaoSample({ direction: 'saida' })] }));
    const res = await request(app)
      .post('/contabil/lancamentos/importar-transacoes')
      .send({ client_id: CID, ano: 2026, mes: 6 });
    expect(res.status).toBe(200);
    expect(res.body.importados).toBe(1);
    const partidasInsert = ops.find((o) => o.table === 'lancamento_partidas');
    const partidas = partidasInsert?.payload as Array<{ plano_conta_id: string; tipo: string }>;
    expect(partidas.find((p) => p.tipo === 'D')?.plano_conta_id).toBe(CONTA_CONTRAPARTIDA.id);
    expect(partidas.find((p) => p.tipo === 'C')?.plano_conta_id).toBe(CONTA_BANCO.id);
  });

  it('recomputeSaldosCascade é chamado uma única vez, mesmo com várias transações no lote', async () => {
    const TXN_ID_2 = '99999999-9999-9999-9999-999999999999';
    const { app } = appWith(
      montarHandlerFeliz({
        transacoes: [transacaoSample(), transacaoSample({ id: TXN_ID_2, ordem: 1, data: '2026-06-12' })],
      }),
    );
    const res = await request(app)
      .post('/contabil/lancamentos/importar-transacoes')
      .send({ client_id: CID, ano: 2026, mes: 6 });
    expect(res.status).toBe(200);
    expect(res.body.importados).toBe(2);
    expect(mockedRecompute).toHaveBeenCalledTimes(1);
    expect(mockedRecompute).toHaveBeenCalledWith(expect.anything(), 'user-1', PERIODO_ID);
  });

  it('lote sem nenhuma transação candidata não chama o motor de saldos', async () => {
    const { app } = appWith(montarHandlerFeliz({ transacoes: [] }));
    const res = await request(app)
      .post('/contabil/lancamentos/importar-transacoes')
      .send({ client_id: CID, ano: 2026, mes: 6 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ importados: 0, ignorados: 0, warnings: [] });
    expect(mockedRecompute).not.toHaveBeenCalled();
  });
});
