import { useState } from 'react';
import { Modal } from '@/components/Modal';
import { ApiError } from '@/lib/api';
import { centsToMoneyInput, parseMoneyToCents } from '@/lib/format';
import type { Lancamento, NaturezaDC } from '@/lib/types';
import { useCreateLancamento, useHistoricosPadrao, usePlanoContas, useUpdateLancamento } from './api';

type LinhaPartida = { plano_conta_id: string; tipo: NaturezaDC; valorInput: string };

function linhasIniciais(lancamento: Lancamento | null | undefined): LinhaPartida[] {
  if (!lancamento) {
    return [
      { plano_conta_id: '', tipo: 'D', valorInput: '' },
      { plano_conta_id: '', tipo: 'C', valorInput: '' },
    ];
  }
  return lancamento.partidas
    .slice()
    .sort((a, b) => a.ordem - b.ordem)
    .map((p) => ({
      plano_conta_id: p.plano_conta_id,
      tipo: p.tipo,
      valorInput: centsToMoneyInput(p.valor_cents),
    }));
}

/**
 * Sem prop `open`: quem chama controla a visibilidade renderizando/removendo
 * esse componente (com `key` trocando entre "novo" e o id editado), pra cada
 * abertura já nascer com o estado certo sem precisar de useEffect de sincronia.
 */
export function LancamentoModal({
  clientId,
  periodoId,
  lancamento,
  onClose,
  onSaved,
}: {
  clientId: string;
  periodoId: string | undefined;
  lancamento?: Lancamento | null;
  onClose: () => void;
  onSaved: (lancamento: Lancamento) => void;
}) {
  const { data: contas } = usePlanoContas(clientId);
  const { data: historicos } = useHistoricosPadrao();
  const createMut = useCreateLancamento(periodoId);
  const updateMut = useUpdateLancamento(periodoId);
  const mut = lancamento ? updateMut : createMut;

  const [data, setData] = useState(lancamento?.data ?? '');
  const [historicoCodigo, setHistoricoCodigo] = useState(lancamento?.historico_codigo ?? '');
  const [complemento, setComplemento] = useState(lancamento?.historico_complemento ?? '');
  const [linhas, setLinhas] = useState<LinhaPartida[]>(linhasIniciais(lancamento));

  const contasAnaliticas = (contas ?? []).filter((c) => c.tipo === 'A' && c.ativo);

  function selecionarHistorico(codigo: string) {
    setHistoricoCodigo(codigo);
    const h = historicos?.find((x) => x.codigo === codigo);
    if (h) setComplemento(h.descricao);
  }

  function atualizarLinha(idx: number, patch: Partial<LinhaPartida>) {
    setLinhas((prev) => {
      const next = prev.map((l, i) => (i === idx ? { ...l, ...patch } : l));
      // caso simples (2 linhas): valor de uma reflete na outra, débito = crédito por definição.
      if (next.length === 2 && patch.valorInput !== undefined) {
        const outro = idx === 0 ? 1 : 0;
        const valorInput = patch.valorInput;
        return next.map((l, i) => (i === outro ? { ...l, valorInput } : l));
      }
      return next;
    });
  }

  function adicionarLinha() {
    setLinhas((prev) => [...prev, { plano_conta_id: '', tipo: 'D', valorInput: '' }]);
  }

  function removerLinha(idx: number) {
    setLinhas((prev) => prev.filter((_, i) => i !== idx));
  }

  const totalD = linhas
    .filter((l) => l.tipo === 'D')
    .reduce((s, l) => s + parseMoneyToCents(l.valorInput || '0'), 0);
  const totalC = linhas
    .filter((l) => l.tipo === 'C')
    .reduce((s, l) => s + parseMoneyToCents(l.valorInput || '0'), 0);
  const balanceado = totalD === totalC && totalD > 0;
  const linhasCompletas = linhas.every((l) => l.plano_conta_id && parseMoneyToCents(l.valorInput || '0') > 0);
  const podeSalvar = balanceado && linhasCompletas && !!data && !!complemento.trim();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!podeSalvar) return;
    const partidas = linhas.map((l) => ({
      plano_conta_id: l.plano_conta_id,
      tipo: l.tipo,
      valor_cents: parseMoneyToCents(l.valorInput || '0'),
    }));
    const comum = {
      data,
      historico_codigo: historicoCodigo || null,
      historico_complemento: complemento.trim(),
      partidas,
    };
    if (lancamento) {
      updateMut.mutate(
        { id: lancamento.id, input: comum },
        { onSuccess: (r) => onSaved(r.lancamento) },
      );
    } else {
      createMut.mutate({ client_id: clientId, ...comum }, { onSuccess: (r) => onSaved(r.lancamento) });
    }
  }

  const errMsg = mut.error instanceof ApiError ? mut.error.message : mut.error ? 'Falha ao salvar' : null;

  return (
    <Modal open onClose={onClose} title={lancamento ? 'Editar lançamento' : 'Novo lançamento'} wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className="label">Data</label>
            <input
              className="input"
              type="date"
              value={data}
              onChange={(e) => setData(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label">Cód. histórico (opcional)</label>
            <select
              className="input"
              value={historicoCodigo}
              onChange={(e) => selecionarHistorico(e.target.value)}
            >
              <option value="">— texto livre —</option>
              {historicos?.map((h) => (
                <option key={h.id} value={h.codigo}>
                  {h.codigo} — {h.descricao}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-1" />
        </div>

        <div>
          <label className="label">Histórico</label>
          <textarea
            className="input"
            rows={2}
            value={complemento}
            onChange={(e) => setComplemento(e.target.value)}
            placeholder="descrição do lançamento"
            required
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="label mb-0">Partidas</label>
            <button type="button" className="btn-ghost h-7 px-2 text-xs" onClick={adicionarLinha}>
              + adicionar linha
            </button>
          </div>

          <div className="space-y-1.5">
            {linhas.map((linha, idx) => (
              <div key={idx} className="flex items-center gap-1.5">
                <select
                  className="input h-9 w-16"
                  value={linha.tipo}
                  onChange={(e) => atualizarLinha(idx, { tipo: e.target.value as NaturezaDC })}
                >
                  <option value="D">D</option>
                  <option value="C">C</option>
                </select>
                <select
                  className="input h-9 flex-1"
                  value={linha.plano_conta_id}
                  onChange={(e) => atualizarLinha(idx, { plano_conta_id: e.target.value })}
                >
                  <option value="">Selecione a conta…</option>
                  {contasAnaliticas.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.codigo} — {c.nome}
                    </option>
                  ))}
                </select>
                <input
                  className="input h-9 w-32 text-right"
                  value={linha.valorInput}
                  onChange={(e) => atualizarLinha(idx, { valorInput: e.target.value })}
                  placeholder="0,00"
                  inputMode="decimal"
                />
                <button
                  type="button"
                  className="w-6 shrink-0 text-slate-300 hover:text-red-600 disabled:invisible"
                  disabled={linhas.length <= 2}
                  onClick={() => removerLinha(idx)}
                  title="Remover linha"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <div
            className={`flex justify-end gap-4 rounded-md px-3 py-1.5 text-xs font-medium ${
              balanceado ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
            }`}
          >
            <span>Débito: {(totalD / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
            <span>Crédito: {(totalC / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
            <span>{balanceado ? 'batido ✓' : 'não bate'}</span>
          </div>
        </div>

        {errMsg && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{errMsg}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn-primary" disabled={!podeSalvar || mut.isPending}>
            {mut.isPending ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
