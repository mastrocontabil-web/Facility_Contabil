import { useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useClients } from '@/features/clients/api';
import { ApiError } from '@/lib/api';
import { centsToMoneyInput, parseMoneyToCents } from '@/lib/format';
import type { LancamentoModelo, NaturezaDC } from '@/lib/types';
import {
  useCreateModelo,
  useDeleteModelo,
  useHistoricosPadrao,
  useModelos,
  usePlanoContas,
  useUpdateModelo,
} from './api';

type LinhaModelo = { plano_conta_id: string; tipo: NaturezaDC; valorInput: string };

function linhasVazias(): LinhaModelo[] {
  return [
    { plano_conta_id: '', tipo: 'D', valorInput: '' },
    { plano_conta_id: '', tipo: 'C', valorInput: '' },
  ];
}

function linhasDe(modelo: LancamentoModelo): LinhaModelo[] {
  return modelo.partidas
    .slice()
    .sort((a, b) => a.ordem - b.ordem)
    .map((p) => ({
      plano_conta_id: p.plano_conta_id,
      tipo: p.tipo,
      valorInput: p.valor_cents_padrao != null ? centsToMoneyInput(p.valor_cents_padrao) : '',
    }));
}

function nomeConta(p: LancamentoModelo['partidas'][number]): string {
  return p.plano_conta ? `${p.plano_conta.codigo} ${p.plano_conta.nome}` : p.plano_conta_id;
}

export function ModelosPage() {
  const { data: clients, isLoading: loadingClients } = useClients({ ativo: 'true' });
  const [clientId, setClientId] = useState('');
  const { data: modelos, isLoading, error } = useModelos(clientId || undefined);
  const { data: contas } = usePlanoContas(clientId || undefined);
  const { data: historicos } = useHistoricosPadrao();
  const createMut = useCreateModelo();
  const updateMut = useUpdateModelo(clientId || undefined);
  const deleteMut = useDeleteModelo(clientId || undefined);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nome, setNome] = useState('');
  const [historicoCodigo, setHistoricoCodigo] = useState('');
  const [complemento, setComplemento] = useState('');
  const [linhas, setLinhas] = useState<LinhaModelo[]>(linhasVazias());
  const [deleting, setDeleting] = useState<LancamentoModelo | null>(null);

  const contasAnaliticas = (contas ?? []).filter((c) => c.tipo === 'A' && c.ativo);

  function resetForm() {
    setEditingId(null);
    setNome('');
    setHistoricoCodigo('');
    setComplemento('');
    setLinhas(linhasVazias());
    setFormOpen(false);
    createMut.reset();
    updateMut.reset();
  }

  function abrirEdicao(m: LancamentoModelo) {
    setEditingId(m.id);
    setNome(m.nome);
    setHistoricoCodigo(m.historico_codigo ?? '');
    setComplemento(m.historico_complemento);
    setLinhas(linhasDe(m));
    setFormOpen(true);
  }

  function selecionarHistorico(codigo: string) {
    setHistoricoCodigo(codigo);
    const h = historicos?.find((x) => x.codigo === codigo);
    if (h) setComplemento(h.descricao);
  }

  function atualizarLinha(idx: number, patch: Partial<LinhaModelo>) {
    setLinhas((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function adicionarLinha() {
    setLinhas((prev) => [...prev, { plano_conta_id: '', tipo: 'D', valorInput: '' }]);
  }

  function removerLinha(idx: number) {
    setLinhas((prev) => prev.filter((_, i) => i !== idx));
  }

  const valoresPreenchidos = linhas.every((l) => l.valorInput.trim() !== '');
  const totalD = linhas
    .filter((l) => l.tipo === 'D')
    .reduce((s, l) => s + parseMoneyToCents(l.valorInput || '0'), 0);
  const totalC = linhas
    .filter((l) => l.tipo === 'C')
    .reduce((s, l) => s + parseMoneyToCents(l.valorInput || '0'), 0);
  const balanceado = totalD === totalC && totalD > 0;
  const linhasCompletas = linhas.every((l) => l.plano_conta_id);
  const podeSalvar =
    linhasCompletas && linhas.length >= 2 && !!nome.trim() && !!complemento.trim() && (!valoresPreenchidos || balanceado);

  const mut = editingId ? updateMut : createMut;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!podeSalvar || !clientId) return;
    const partidas = linhas.map((l) => ({
      plano_conta_id: l.plano_conta_id,
      tipo: l.tipo,
      valor_cents_padrao: l.valorInput.trim() ? parseMoneyToCents(l.valorInput) : null,
    }));
    const comum = {
      nome: nome.trim(),
      historico_codigo: historicoCodigo || null,
      historico_complemento: complemento.trim(),
      partidas,
    };
    if (editingId) {
      updateMut.mutate({ id: editingId, input: comum }, { onSuccess: () => resetForm() });
    } else {
      createMut.mutate({ client_id: clientId, ...comum }, { onSuccess: () => resetForm() });
    }
  }

  const errMsg = mut.error instanceof ApiError ? mut.error.message : mut.error ? 'Falha ao salvar' : null;

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Modelos de lançamento</h1>
        <p className="text-sm text-slate-500">
          Molde reutilizável pra lançamento recorrente (depreciação, pró-labore, aluguel...). Salve a
          estrutura de contas uma vez — com ou sem valor fixo — e escolha o modelo na hora de criar um
          novo lançamento pra não digitar tudo de novo todo mês.
        </p>
      </div>

      <select
        className="input max-w-md"
        value={clientId}
        onChange={(e) => {
          setClientId(e.target.value);
          resetForm();
        }}
        disabled={loadingClients}
      >
        <option value="">{loadingClients ? 'Carregando…' : 'Selecione o cliente…'}</option>
        {clients?.map((c) => (
          <option key={c.id} value={c.id}>
            {c.razao_social} — Domínio {c.dominio_code}
          </option>
        ))}
      </select>

      {!clientId ? (
        <p className="card p-6 text-sm text-slate-400">Escolha um cliente.</p>
      ) : (
        <>
          {!formOpen && (
            <div className="flex justify-end">
              <button className="btn-primary" onClick={() => setFormOpen(true)}>
                + novo modelo
              </button>
            </div>
          )}

          {formOpen && (
            <form onSubmit={submit} className="card space-y-4 p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="label">Nome do modelo</label>
                  <input
                    className="input"
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    placeholder="ex: Depreciação mensal"
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
                  <label className="label mb-0">Partidas (valor é opcional — fica em branco pra digitar na hora)</label>
                  <button type="button" className="btn-ghost h-7 px-2 text-xs" onClick={adicionarLinha}>
                    + adicionar linha
                  </button>
                </div>

                <div className="space-y-1.5">
                  {linhas.map((linha, idx) => (
                    <div key={idx} className="flex flex-wrap items-center gap-1.5">
                      <select
                        className="input h-9 w-16 shrink-0"
                        value={linha.tipo}
                        onChange={(e) => atualizarLinha(idx, { tipo: e.target.value as NaturezaDC })}
                      >
                        <option value="D">D</option>
                        <option value="C">C</option>
                      </select>
                      <select
                        className="input h-9 order-3 w-full min-w-0 sm:order-none sm:w-auto sm:flex-1"
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
                        className="input h-9 w-24 shrink-0 text-right sm:w-32"
                        value={linha.valorInput}
                        onChange={(e) => atualizarLinha(idx, { valorInput: e.target.value })}
                        placeholder="opcional"
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
                    !valoresPreenchidos
                      ? 'bg-slate-50 text-slate-500'
                      : balanceado
                        ? 'bg-green-50 text-green-700'
                        : 'bg-amber-50 text-amber-700'
                  }`}
                >
                  <span>Débito: {(totalD / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                  <span>Crédito: {(totalC / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                  <span>{!valoresPreenchidos ? 'opcional (preencha os dois lados pra conferir)' : balanceado ? 'batido ✓' : 'não bate'}</span>
                </div>
              </div>

              {errMsg && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{errMsg}</p>}

              <div className="flex justify-end gap-2">
                <button type="button" className="btn-ghost" onClick={resetForm}>
                  Cancelar
                </button>
                <button type="submit" className="btn-primary" disabled={!podeSalvar || mut.isPending}>
                  {mut.isPending ? 'Salvando…' : 'Salvar'}
                </button>
              </div>
            </form>
          )}

          <div className="card overflow-x-auto p-0">
            {isLoading ? (
              <p className="p-4 text-sm text-slate-400">Carregando…</p>
            ) : error ? (
              <p className="p-4 text-sm text-red-600">
                {error instanceof Error ? error.message : 'Falha ao carregar'}
              </p>
            ) : !modelos?.length ? (
              <p className="p-4 text-sm text-slate-400">Nenhum modelo cadastrado ainda.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-4 py-2">Nome</th>
                    <th className="px-4 py-2">Histórico</th>
                    <th className="px-4 py-2">Partidas</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {modelos.map((m) => {
                    const partidas = m.partidas.slice().sort((a, b) => a.ordem - b.ordem);
                    const [primeira, segunda] = partidas;
                    const resumo =
                      primeira && segunda && partidas.length === 2
                        ? `${nomeConta(primeira)} → ${nomeConta(segunda)}`
                        : `${partidas.length} contas`;
                    return (
                      <tr key={m.id} className="text-slate-600">
                        <td className={`px-4 py-1.5 ${m.ativo ? '' : 'text-slate-400 line-through'}`}>{m.nome}</td>
                        <td className="px-4 py-1.5 text-xs text-slate-500">{m.historico_complemento}</td>
                        <td className="px-4 py-1.5 text-xs text-slate-500">{resumo}</td>
                        <td className="whitespace-nowrap px-4 py-1.5 text-right text-xs">
                          <button className="text-slate-400 hover:text-brand-600" onClick={() => abrirEdicao(m)}>
                            editar
                          </button>
                          <button
                            className="ml-3 text-slate-400 hover:text-slate-600"
                            title={m.ativo ? 'Desativar (não aparece mais pra escolher)' : 'Reativar'}
                            onClick={() =>
                              updateMut.mutate({
                                id: m.id,
                                input: {
                                  nome: m.nome,
                                  historico_codigo: m.historico_codigo,
                                  historico_complemento: m.historico_complemento,
                                  partidas: m.partidas.map((p) => ({
                                    plano_conta_id: p.plano_conta_id,
                                    tipo: p.tipo,
                                    valor_cents_padrao: p.valor_cents_padrao,
                                  })),
                                  ativo: !m.ativo,
                                },
                              })
                            }
                          >
                            {m.ativo ? 'desativar' : 'reativar'}
                          </button>
                          <button className="ml-3 text-slate-400 hover:text-red-600" onClick={() => setDeleting(m)}>
                            excluir
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Excluir modelo"
        message={`Excluir o modelo "${deleting?.nome}"? Lançamentos já gerados a partir dele não são afetados.`}
        busy={deleteMut.isPending}
        error={
          deleteMut.isError
            ? deleteMut.error instanceof ApiError
              ? deleteMut.error.message
              : 'Falha ao excluir'
            : null
        }
        onConfirm={() => deleting && deleteMut.mutate(deleting.id, { onSuccess: () => setDeleting(null) })}
        onCancel={() => {
          setDeleting(null);
          deleteMut.reset();
        }}
      />
    </section>
  );
}
