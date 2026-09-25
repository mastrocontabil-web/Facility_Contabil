import { formatMoney } from '@/lib/format';
import type { CabecalhoImportacao } from './useCabecalhoImportacao';

/** Campos do cabeçalho da importação: cliente, conta do banco, lote, históricos e saldo inicial. */
export function CamposCabecalho({ cab }: { cab: CabecalhoImportacao }) {
  const { selected } = cab;
  return (
    <>
      <div>
        <label className="label">Cliente</label>
        <select
          className="input"
          value={cab.clientId}
          onChange={(e) => cab.setClientId(e.target.value)}
          disabled={cab.loadingClients}
          required
        >
          <option value="">{cab.loadingClients ? 'Carregando…' : 'Selecione…'}</option>
          {cab.clients?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.razao_social} — Domínio {c.dominio_code}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Conta contábil do banco</label>
          <input
            className="input"
            value={cab.contaBanco}
            onChange={(e) => cab.setContaBanco(e.target.value)}
            placeholder="ex: 10002"
            required
          />
        </div>
        <div>
          <label className="label">Número do lote (Domínio)</label>
          <input
            className="input"
            type="number"
            min={0}
            value={cab.lote}
            onChange={(e) => cab.setLote(Number(e.target.value))}
          />
        </div>
        <div>
          <label className="label">Cód. histórico entrada</label>
          <input
            className="input"
            value={cab.histEntrada}
            onChange={(e) => cab.setHistEntrada(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Cód. histórico saída</label>
          <input
            className="input"
            value={cab.histSaida}
            onChange={(e) => cab.setHistSaida(e.target.value)}
          />
        </div>
      </div>

      <div>
        <label className="label">Saldo inicial da conta bancária</label>
        <input
          className="input"
          inputMode="decimal"
          value={cab.saldoInicial}
          onChange={(e) => cab.digitarSaldoInicial(e.target.value)}
          placeholder="0,00"
        />
        <p className="mt-1 text-xs text-slate-400">
          {selected
            ? `Cadastro do cliente: ${formatMoney(Math.round(Number(selected.saldo_inicial ?? 0) * 100))}. Se o extrato começa com outro saldo, digite aqui — vale o que estiver neste campo.`
            : 'Vem do cadastro do cliente; digite outro se o extrato começar com saldo diferente. Serve para conferir o saldo do fim do mês.'}
        </p>
      </div>
    </>
  );
}

/** Nota embaixo do formulário: como entradas e saídas viram débito/crédito. */
export function NotaContaBanco({ cab }: { cab: CabecalhoImportacao }) {
  if (!cab.selected) return null;
  return (
    <p className="text-xs text-slate-400">
      Entradas serão lançadas a débito da conta {cab.contaBanco || '—'} e crédito da conta que
      você classificar; saídas o contrário. Você ajusta tudo na próxima tela.{' '}
      {cab.selected.banco_conta_contabil ? '' : '(esse cliente ainda não tem conta do banco no cadastro)'}
    </p>
  );
}
