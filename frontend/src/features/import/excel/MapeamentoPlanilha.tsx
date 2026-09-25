import { useMemo, useState } from 'react';
import { formatDate, formatMoney } from '@/lib/format';
import type { Planilha } from '@/lib/types';
import {
  definirFuncao,
  funcaoDa,
  incluida,
  letraColuna,
  type Colunas,
  type Funcao,
  type LinhaLida,
} from './planilha';

type Filtro = 'todas' | 'entram' | 'fora';

const PAGINA = 100;

/**
 * A planilha como está no Excel, com a escolha da função de cada coluna em
 * cima e, em cada linha, como ela vai entrar (ou por que fica de fora).
 */
export function MapeamentoPlanilha({
  planilha,
  colunas,
  onColunas,
  linhas,
  invertidas,
  onInverter,
}: {
  planilha: Planilha;
  colunas: Colunas;
  onColunas: (c: Colunas) => void;
  /** `lerLinhas(planilha, colunas)` — na mesma ordem de `planilha.linhas` */
  linhas: LinhaLida[];
  invertidas: ReadonlySet<number>;
  onInverter: (n: number) => void;
}) {
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [limite, setLimite] = useState(PAGINA);

  const cols = useMemo(() => Array.from({ length: planilha.colunas }, (_, i) => i), [planilha.colunas]);
  const celulas = useMemo(() => new Map(planilha.linhas.map((l) => [l.n, l.c])), [planilha.linhas]);
  const dentro = useMemo(
    () => new Set(linhas.filter((l) => incluida(l, invertidas)).map((l) => l.n)),
    [linhas, invertidas],
  );
  const lendo = colunas.data != null && colunas.valor != null;
  const filtradas = useMemo(
    () =>
      filtro === 'todas' || !lendo
        ? linhas
        : linhas.filter((l) => (filtro === 'entram') === dentro.has(l.n)),
    [linhas, filtro, dentro, lendo],
  );
  const mostradas = filtradas.slice(0, limite);

  function filtrar(f: Filtro) {
    setFiltro(f);
    setLimite(PAGINA);
  }

  if (!planilha.linhas.length) {
    return <p className="card p-6 text-sm text-slate-400">Essa aba está vazia.</p>;
  }

  return (
    <div className="space-y-2">
      {/* sem Data e Valor escolhidos, "entram (0)" só confundiria */}
      {lendo && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <FilterBtn active={filtro === 'todas'} onClick={() => filtrar('todas')}>
            Todas as linhas ({linhas.length})
          </FilterBtn>
          <FilterBtn active={filtro === 'entram'} onClick={() => filtrar('entram')}>
            Entram ({dentro.size})
          </FilterBtn>
          <FilterBtn active={filtro === 'fora'} onClick={() => filtrar('fora')}>
            Ficam de fora ({linhas.length - dentro.size})
          </FilterBtn>
          <span className="text-xs text-slate-400">Desmarque a caixinha pra tirar uma linha da importação.</span>
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="w-8 px-3 py-2" />
              <th className="px-2 py-2 text-right font-medium">Linha</th>
              <th className="whitespace-nowrap px-3 py-2 font-medium">Vai entrar como</th>
              {cols.map((i) => {
                const f = funcaoDa(colunas, i);
                return (
                  <th key={i} className={`px-2 py-2 align-bottom ${f ? 'bg-brand-100' : ''}`}>
                    <div className="mb-1 font-semibold text-slate-600">Coluna {letraColuna(i)}</div>
                    <select
                      aria-label={`Função da coluna ${letraColuna(i)}`}
                      className={`w-full min-w-[8.5rem] rounded-md border bg-white px-2 py-1 text-xs ${
                        f ? 'border-brand-600 font-semibold text-slate-800' : 'border-slate-300 text-slate-500'
                      }`}
                      value={f ?? ''}
                      onChange={(e) => onColunas(definirFuncao(colunas, i, (e.target.value || null) as Funcao | null))}
                    >
                      <option value="">não usar</option>
                      <option value="data">Data</option>
                      <option value="valor">Valor</option>
                      <option value="historico">Histórico</option>
                    </select>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {mostradas.map((l) => {
              const vai = dentro.has(l.n);
              const c = celulas.get(l.n) ?? [];
              return (
                <tr key={l.n} className={vai || !lendo ? 'text-slate-700' : 'text-slate-400'}>
                  <td className="px-3 py-1.5">
                    <input
                      type="checkbox"
                      aria-label={`Importar a linha ${l.n}`}
                      checked={vai}
                      disabled={l.situacao !== 'entra'}
                      onChange={() => onInverter(l.n)}
                    />
                  </td>
                  <td className="px-2 py-1.5 text-right text-xs tabular-nums text-slate-400">{l.n}</td>
                  <td className="whitespace-nowrap px-3 py-1.5">
                    {lendo ? <Resultado l={l} vai={vai} /> : <span className="text-slate-300">—</span>}
                  </td>
                  {cols.map((i) => (
                    <td
                      key={i}
                      title={c[i]?.t}
                      className={`max-w-[16rem] truncate px-3 py-1.5 ${funcaoDa(colunas, i) ? 'bg-brand-50' : ''}`}
                    >
                      {c[i]?.t ?? ''}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtradas.length > mostradas.length && (
          <div className="flex items-center gap-3 border-t border-slate-200 px-4 py-2 text-sm text-slate-500">
            Mostrando {mostradas.length} de {filtradas.length} linhas.
            <button className="font-medium text-brand-600 hover:underline" onClick={() => setLimite((n) => n + PAGINA)}>
              Mostrar mais {Math.min(PAGINA, filtradas.length - mostradas.length)}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Resultado({ l, vai }: { l: LinhaLida; vai: boolean }) {
  if (l.situacao === 'sem_data') return <span className="text-xs">fora · sem data</span>;
  if (l.situacao === 'sem_valor') return <span className="text-xs">fora · sem valor</span>;
  if (l.situacao === 'valor_zero') return <span className="text-xs">fora · valor zero</span>;
  if (!vai) {
    return l.pareceSaldo ? (
      <span
        className="rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-800"
        title="O histórico começa com saldo/total — se for um lançamento de verdade, marque a caixinha"
      >
        fora · saldo/total?
      </span>
    ) : (
      <span className="text-xs">fora · tirada por você</span>
    );
  }
  const saida = l.valor! < 0;
  return (
    <>
      <span className="tabular-nums text-slate-500">{formatDate(l.data!)}</span>{' '}
      <span
        className={`rounded px-1.5 py-0.5 text-xs font-medium ${
          saida ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
        }`}
      >
        {saida ? 'saída' : 'entrada'} {formatMoney(Math.abs(l.valor!))}
      </span>
    </>
  );
}

function FilterBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 font-medium ${
        active ? 'bg-brand-600 text-white' : 'border border-slate-300 bg-white text-slate-600'
      }`}
    >
      {children}
    </button>
  );
}
