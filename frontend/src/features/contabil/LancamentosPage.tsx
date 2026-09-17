import { useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ApiError } from '@/lib/api';
import { useClients } from '@/features/clients/api';
import { formatCompetencia, formatDate, formatMoney } from '@/lib/format';
import type { DiagnosticoPeriodo as DiagnosticoPeriodoData, EventoAuditoria, Lancamento } from '@/lib/types';
import {
  useDeleteLancamento,
  useDiagnosticoPeriodo,
  useExportarDominio,
  useFecharPeriodo,
  useImportarTransacoes,
  useLancamentos,
  usePeriodos,
  useReabrirPeriodo,
} from './api';
import { LancamentoModal } from './LancamentoModal';
import { Historico } from './SaldoRow';

export function LancamentosPage() {
  const { data: clients, isLoading: loadingClients } = useClients({ ativo: 'true' });
  const [clientId, setClientId] = useState('');
  const [periodoId, setPeriodoId] = useState('');
  const [modal, setModal] = useState<{ lancamento: Lancamento | null } | null>(null);
  const [deleting, setDeleting] = useState<Lancamento | null>(null);
  const [confirmandoFechar, setConfirmandoFechar] = useState(false);
  const [confirmandoReabrir, setConfirmandoReabrir] = useState(false);
  const [loteNumero, setLoteNumero] = useState(1);
  const [mesImportar, setMesImportar] = useState('');
  const [resultadoImportar, setResultadoImportar] = useState<{
    importados: number;
    ignorados: number;
    warnings: string[];
  } | null>(null);

  const { data: periodos, isLoading: loadingPeriodos } = usePeriodos(clientId || undefined);
  const { data: lancamentos, isLoading, error } = useLancamentos(periodoId || undefined);
  const deleteMut = useDeleteLancamento(periodoId || undefined);
  const fecharMut = useFecharPeriodo(clientId || undefined);
  const reabrirMut = useReabrirPeriodo(clientId || undefined);
  const exportarMut = useExportarDominio();
  const importarMut = useImportarTransacoes(clientId || undefined);
  const { data: diagnostico } = useDiagnosticoPeriodo(periodoId || undefined);

  const periodoSelecionado = periodos?.find((p) => p.id === periodoId);
  const fechado = periodoSelecionado?.status === 'fechado';

  const errMsg = (mut: { error: unknown }) =>
    mut.error instanceof ApiError ? mut.error.message : mut.error ? 'Falha na operação' : null;

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Lançamentos</h1>
        <p className="text-sm text-slate-500">
          Lançamento manual em partida dobrada (simples ou múltipla). O período abre sozinho como
          "aberto" no mês da data lançada — não dá pra lançar num período já fechado (importado pelo
          Balancete).
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select
          className="input max-w-md"
          value={clientId}
          onChange={(e) => {
            setClientId(e.target.value);
            setPeriodoId('');
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

        {clientId && (
          <select
            className="input max-w-xs"
            value={periodoId}
            onChange={(e) => {
              setPeriodoId(e.target.value);
              const p = periodos?.find((x) => x.id === e.target.value);
              if (p) setMesImportar(`${p.ano}-${String(p.mes).padStart(2, '0')}`);
            }}
            disabled={loadingPeriodos}
          >
            <option value="">{loadingPeriodos ? 'Carregando…' : 'Selecione um período…'}</option>
            {periodos?.map((p) => (
              <option key={p.id} value={p.id}>
                {formatCompetencia(p.ano, p.mes)} {p.status === 'fechado' ? '🔒 fechado' : ''}
              </option>
            ))}
          </select>
        )}
      </div>

      {!clientId ? (
        <p className="card p-6 text-sm text-slate-400">Escolha um cliente.</p>
      ) : (
        <>
          {(errMsg(fecharMut) || errMsg(reabrirMut) || errMsg(exportarMut) || errMsg(importarMut)) && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {errMsg(fecharMut) || errMsg(reabrirMut) || errMsg(exportarMut) || errMsg(importarMut)}
            </p>
          )}

          {periodoId && diagnostico && (
            <DiagnosticoPeriodoBloco diagnostico={diagnostico} />
          )}

          {resultadoImportar && (
            <div className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
              <p>
                {resultadoImportar.importados} lançamento(s) importado(s) da Importação
                {resultadoImportar.ignorados > 0 && `, ${resultadoImportar.ignorados} ignorado(s)`}.
              </p>
              {resultadoImportar.warnings.length > 0 && (
                <ul className="ml-4 mt-1 list-disc text-amber-800">
                  {resultadoImportar.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
            <div className="flex items-center gap-2">
              <input
                type="month"
                className="input w-40"
                value={mesImportar}
                onChange={(e) => setMesImportar(e.target.value)}
                title="Mês pra importar do módulo Importação"
              />
              <button
                type="button"
                className="btn-ghost"
                disabled={!mesImportar || importarMut.isPending}
                onClick={() => {
                  const [anoStr, mesStr] = mesImportar.split('-');
                  const ano = Number(anoStr);
                  const mes = Number(mesStr);
                  setResultadoImportar(null);
                  importarMut.mutate(
                    { client_id: clientId, ano, mes },
                    {
                      onSuccess: (data) => {
                        setResultadoImportar({
                          importados: data.importados,
                          ignorados: data.ignorados,
                          warnings: data.warnings,
                        });
                        setPeriodoId(data.periodo.id);
                      },
                    },
                  );
                }}
              >
                {importarMut.isPending ? 'Importando…' : 'Importar da Importação'}
              </button>
            </div>
            {periodoId && !fechado && (
              <button type="button" className="btn-ghost" onClick={() => setConfirmandoFechar(true)}>
                Fechar período
              </button>
            )}
            {periodoId && fechado && (
              <>
                <button type="button" className="btn-ghost" onClick={() => setConfirmandoReabrir(true)}>
                  Reabrir período
                </button>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={99999999}
                    className="input w-24"
                    value={loteNumero}
                    onChange={(e) => setLoteNumero(Math.max(0, Number(e.target.value) || 0))}
                    title="Número do lote"
                  />
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={exportarMut.isPending}
                    onClick={() => exportarMut.mutate({ periodoId, loteNumero })}
                  >
                    {exportarMut.isPending ? 'Gerando…' : 'Exportar pro Domínio'}
                  </button>
                </div>
              </>
            )}
            {!fechado && (
              <button className="btn-primary" onClick={() => setModal({ lancamento: null })}>
                + novo lançamento
              </button>
            )}
          </div>

          {fechado && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Este período está fechado — não aceita mais lançamento, edição ou exclusão. Só resta
              exportar pro Domínio.
            </p>
          )}

          {!periodoId ? (
            <p className="card p-6 text-sm text-slate-400">
              {periodos?.length
                ? 'Escolha um período acima pra ver os lançamentos.'
                : 'Esse cliente ainda não tem período nenhum — crie o primeiro lançamento acima (o período abre sozinho).'}
            </p>
          ) : (
            <div className="card overflow-x-auto p-0">
              {isLoading ? (
                <p className="p-4 text-sm text-slate-400">Carregando…</p>
              ) : error ? (
                <p className="p-4 text-sm text-red-600">
                  {error instanceof Error ? error.message : 'Falha ao carregar'}
                </p>
              ) : !lancamentos?.length ? (
                <p className="p-4 text-sm text-slate-400">Nenhum lançamento nesse período ainda.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="px-4 py-2">Data</th>
                      <th className="px-4 py-2">Histórico</th>
                      <th className="px-4 py-2">Partidas</th>
                      <th className="px-4 py-2 text-right">Valor</th>
                      <th className="px-4 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {lancamentos.map((l) => (
                      <LancamentoRow
                        key={l.id}
                        lancamento={l}
                        onEdit={fechado ? undefined : () => setModal({ lancamento: l })}
                        onDelete={fechado ? undefined : () => setDeleting(l)}
                      />
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </>
      )}

      {modal && (
        <LancamentoModal
          key={modal.lancamento?.id ?? 'novo'}
          clientId={clientId}
          periodoId={periodoId}
          lancamento={modal.lancamento}
          onClose={() => setModal(null)}
          onSaved={(l) => {
            setPeriodoId(l.periodo_id);
            setModal(null);
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Excluir lançamento"
        message={`Excluir o lançamento de ${deleting ? formatDate(deleting.data) : ''} — "${deleting?.historico_complemento}"?`}
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

      <ConfirmDialog
        open={confirmandoFechar}
        title="Fechar período"
        message={`Fechar ${periodoSelecionado ? formatCompetencia(periodoSelecionado.ano, periodoSelecionado.mes) : 'esse período'}? Não aceita mais lançamento, edição ou exclusão depois disso — só dá pra exportar pro Domínio.`}
        confirmLabel="Fechar"
        busy={fecharMut.isPending}
        error={
          fecharMut.isError
            ? fecharMut.error instanceof ApiError
              ? fecharMut.error.message
              : 'Falha ao fechar'
            : null
        }
        onConfirm={() =>
          periodoId && fecharMut.mutate(periodoId, { onSuccess: () => setConfirmandoFechar(false) })
        }
        onCancel={() => {
          setConfirmandoFechar(false);
          fecharMut.reset();
        }}
      />

      <ConfirmDialog
        open={confirmandoReabrir}
        title="Reabrir período"
        message={
          diagnostico?.periodo_posterior_fechado
            ? `Não é possível reabrir agora: o período ${formatCompetencia(diagnostico.periodo_posterior_fechado.ano, diagnostico.periodo_posterior_fechado.mes)} já está fechado — reabra os períodos em ordem cronológica inversa a partir dele.`
            : `Reabrir ${periodoSelecionado ? formatCompetencia(periodoSelecionado.ano, periodoSelecionado.mes) : 'esse período'}? Volta a aceitar lançamento, edição e exclusão. Se esse período já foi exportado pro Domínio antes, o arquivo já gerado não reflete mudanças feitas depois da reabertura — gere de novo quando fechar.`
        }
        confirmLabel="Reabrir"
        busy={reabrirMut.isPending}
        error={
          reabrirMut.isError
            ? reabrirMut.error instanceof ApiError
              ? reabrirMut.error.message
              : 'Falha ao reabrir'
            : null
        }
        onConfirm={() =>
          periodoId &&
          !diagnostico?.periodo_posterior_fechado &&
          reabrirMut.mutate(periodoId, { onSuccess: () => setConfirmandoReabrir(false) })
        }
        onCancel={() => {
          setConfirmandoReabrir(false);
          reabrirMut.reset();
        }}
      />
    </section>
  );
}

function DiagnosticoPeriodoBloco({ diagnostico }: { diagnostico: DiagnosticoPeriodoData }) {
  const [mostrarHistorico, setMostrarHistorico] = useState(false);

  return (
    <div className="space-y-2">
      {diagnostico.periodo_anterior_aberto && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          A competência {formatCompetencia(diagnostico.periodo_anterior_aberto.ano, diagnostico.periodo_anterior_aberto.mes)}{' '}
          ainda está aberta — feche os períodos em ordem cronológica antes deste.
        </p>
      )}
      {diagnostico.periodo_posterior_fechado && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          A competência {formatCompetencia(diagnostico.periodo_posterior_fechado.ano, diagnostico.periodo_posterior_fechado.mes)}{' '}
          já está fechada — pra reabrir este período, reabra primeiro os posteriores, em ordem inversa.
        </p>
      )}
      <button
        type="button"
        className="text-xs text-slate-400 hover:text-slate-600"
        onClick={() => setMostrarHistorico((v) => !v)}
      >
        {mostrarHistorico ? 'ocultar' : 'ver'} histórico do período ({diagnostico.eventos.length})
      </button>
      {mostrarHistorico && (
        <ul className="space-y-1 rounded-md border border-slate-100 bg-slate-50 p-3 text-xs text-slate-500">
          {diagnostico.eventos.length === 0 ? (
            <li>Nenhum evento registrado ainda.</li>
          ) : (
            diagnostico.eventos.map((ev) => <li key={ev.id}>{descreverEvento(ev)}</li>)
          )}
        </ul>
      )}
    </div>
  );
}

function descreverEvento(ev: EventoAuditoria): string {
  const quando = new Date(ev.created_at).toLocaleString('pt-BR');
  if (ev.acao === 'fechado') return `Fechado em ${quando} (${ev.detalhe.qtd_lancamentos} lançamento(s))`;
  if (ev.acao === 'reaberto') return `Reaberto em ${quando}`;
  if (ev.acao === 'dominio_exportado') {
    return `Exportado pro Domínio em ${quando} (lote ${ev.detalhe.lote_numero}, ${ev.detalhe.qtd_lancamentos} lançamento(s))`;
  }
  return `${ev.acao} em ${quando}`;
}

function LancamentoRow({
  lancamento,
  onEdit,
  onDelete,
}: {
  lancamento: Lancamento;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const partidas = lancamento.partidas.slice().sort((a, b) => a.ordem - b.ordem);
  const totalDebito = partidas.filter((p) => p.tipo === 'D').reduce((s, p) => s + p.valor_cents, 0);

  const [primeira, segunda] = partidas;
  const resumo =
    primeira && segunda && partidas.length === 2
      ? `${nomeConta(primeira)} → ${nomeConta(segunda)}`
      : `${partidas.length} contas`;

  return (
    <tr className="text-slate-600">
      <td className="whitespace-nowrap px-4 py-1.5">{formatDate(lancamento.data)}</td>
      <td className="px-4 py-1.5">
        <Historico codigo={lancamento.historico_codigo} complemento={lancamento.historico_complemento} />
        {lancamento.origem_transaction_id && (
          <span
            className="ml-2 rounded bg-sky-100 px-1.5 py-0.5 text-xs font-normal text-sky-700"
            title="Trazido do módulo Importação"
          >
            importado
          </span>
        )}
      </td>
      <td className="px-4 py-1.5 text-xs text-slate-500">{resumo}</td>
      <td className="whitespace-nowrap px-4 py-1.5 text-right">{formatMoney(totalDebito)}</td>
      <td className="whitespace-nowrap px-4 py-1.5 text-right text-xs">
        {onEdit && (
          <button className="text-slate-400 hover:text-brand-600" onClick={onEdit}>
            editar
          </button>
        )}
        {onDelete && (
          <button className="ml-3 text-slate-400 hover:text-red-600" onClick={onDelete}>
            excluir
          </button>
        )}
      </td>
    </tr>
  );
}

function nomeConta(p: Lancamento['partidas'][number]): string {
  return p.plano_conta ? `${p.plano_conta.codigo} ${p.plano_conta.nome}` : p.plano_conta_id;
}
