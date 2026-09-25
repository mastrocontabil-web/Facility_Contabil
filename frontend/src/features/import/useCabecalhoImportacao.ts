import { useEffect, useMemo, useRef, useState } from 'react';
import { useClients } from '@/features/clients/api';
import type { CabecalhoInput } from '@/features/statements/api';

/**
 * "1.234,56" → 1234.56 ; "" → 0. Só ponto (sem vírgula) é ambíguo — "1.500"
 * é separador de milhar (1500), mas "1500.5" é decimal — resolve pelo nº de
 * dígitos depois do último ponto, igual ao `money` do backend.
 */
function parseMoney(s: string): number {
  const v = s.trim();
  if (v.includes(',')) return Number(v.replace(/\./g, '').replace(',', '.')) || 0;
  const pontos = v.split('.').length - 1;
  if (pontos > 0) {
    const casasFinais = v.length - v.lastIndexOf('.') - 1;
    if (pontos > 1 || casasFinais === 3) return Number(v.replace(/\./g, '')) || 0;
  }
  return Number(v) || 0;
}

/** 1234.56 → "1234,56" (pro campo de texto) */
function moneyToInput(v: string | number | null | undefined): string {
  return String(Number(v ?? 0)).replace('.', ',');
}

/**
 * Cabeçalho de uma importação nova (cliente, conta do banco, históricos, lote,
 * saldo inicial) — o mesmo na importação de extrato e na de planilha Excel.
 * Escolher o cliente preenche com o cadastro dele.
 */
export function useCabecalhoImportacao() {
  const { data: clients, isLoading: loadingClients } = useClients({ ativo: 'true' });

  const [clientId, setClientId] = useState('');
  const [contaBanco, setContaBanco] = useState('');
  const [histEntrada, setHistEntrada] = useState('138');
  const [histSaida, setHistSaida] = useState('186');
  const [lote, setLote] = useState(1);
  const [saldoInicial, setSaldoInicial] = useState('0');
  const saldoTocado = useRef(false);

  const selected = useMemo(
    () => clients?.find((c) => c.id === clientId),
    [clients, clientId],
  );

  useEffect(() => {
    if (selected) {
      setContaBanco(selected.banco_conta_contabil ?? '');
      setHistEntrada(selected.hist_code_entrada);
      setHistSaida(selected.hist_code_saida);
    }
  }, [selected]);

  // Trocar de um cliente pra outro volta a preencher com o cadastro do novo (o
  // digitado valia pro anterior); escolher o primeiro cliente não apaga o digitado.
  const clienteAnterior = useRef('');
  useEffect(() => {
    if (clienteAnterior.current && clienteAnterior.current !== clientId) saldoTocado.current = false;
    clienteAnterior.current = clientId;
  }, [clientId]);

  // Saldo inicial = o do cadastro do cliente, até o operador digitar outro.
  useEffect(() => {
    if (!selected || saldoTocado.current) return;
    setSaldoInicial(moneyToInput(selected.saldo_inicial ?? 0));
  }, [selected]);

  const dados: CabecalhoInput = {
    client_id: clientId,
    banco_conta_contabil: contaBanco,
    hist_code_entrada: histEntrada,
    hist_code_saida: histSaida,
    lote_numero: lote,
    saldo_inicial: saldoInicial || '0',
  };

  return {
    clients,
    loadingClients,
    selected,
    clientId,
    setClientId,
    contaBanco,
    setContaBanco,
    histEntrada,
    setHistEntrada,
    histSaida,
    setHistSaida,
    lote,
    setLote,
    saldoInicial,
    /** saldo vindo de fora do campo (ex.: "ajustar saldo inicial" depois de ler) */
    setSaldoInicial,
    /** o operador digitou: deixa de acompanhar o cadastro do cliente */
    digitarSaldoInicial: (v: string) => {
      setSaldoInicial(v);
      saldoTocado.current = true;
    },
    saldoInicialNum: parseMoney(saldoInicial),
    /** cliente e conta do banco escolhidos */
    completo: !!clientId && !!contaBanco.trim(),
    dados,
  };
}

export type CabecalhoImportacao = ReturnType<typeof useCabecalhoImportacao>;
