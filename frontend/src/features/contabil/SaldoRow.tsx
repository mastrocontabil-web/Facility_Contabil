import { formatMoney } from '@/lib/format';
import type { SaldoContabil } from '@/lib/types';

export function SaldoRow({ saldo }: { saldo: SaldoContabil }) {
  const sintetica = saldo.tipo === 'S';
  return (
    <tr className={sintetica ? 'bg-slate-50/60 font-medium text-slate-800' : 'text-slate-600'}>
      <td className="whitespace-nowrap px-4 py-1.5 font-mono">{saldo.codigo}</td>
      <td className="px-4 py-1.5">
        {saldo.nome}
        {!saldo.plano_conta_id && (
          <span
            className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-normal text-amber-700"
            title="Essa conta não está cadastrada no plano de contas — importe/corrija o plano pra linkar."
          >
            sem vínculo
          </span>
        )}
      </td>
      <td className="whitespace-nowrap px-4 py-1.5 text-right">
        <Dinheiro cents={saldo.saldo_anterior_cents} natureza={saldo.saldo_anterior_natureza} />
      </td>
      <td className="whitespace-nowrap px-4 py-1.5 text-right">{formatMoney(saldo.debito_cents)}</td>
      <td className="whitespace-nowrap px-4 py-1.5 text-right">{formatMoney(saldo.credito_cents)}</td>
      <td className="whitespace-nowrap px-4 py-1.5 text-right">
        <Dinheiro cents={saldo.saldo_atual_cents} natureza={saldo.saldo_atual_natureza} />
      </td>
    </tr>
  );
}

export function Dinheiro({ cents, natureza }: { cents: number; natureza: 'D' | 'C' | null }) {
  return (
    <>
      {formatMoney(cents)}
      {natureza && <span className="ml-1 text-xs text-slate-400">{natureza}</span>}
    </>
  );
}

export function Historico({ codigo, complemento }: { codigo: string | null; complemento: string }) {
  return (
    <>
      {codigo && <span className="mr-1 font-mono text-xs text-slate-400">{codigo}</span>}
      {complemento}
    </>
  );
}
