export type Client = {
  id: string;
  razao_social: string;
  cnpj: string;
  dominio_code: string;
  banco_conta_contabil: string | null;
  hist_code_entrada: string;
  hist_code_saida: string;
  conta_width: number;
  saldo_inicial: string;
  ativo: boolean;
  observacoes: string | null;
  created_at: string;
  updated_at: string;
};

export type ClientInput = {
  razao_social: string;
  cnpj: string;
  dominio_code: string;
  banco_conta_contabil?: string | null;
  hist_code_entrada?: string;
  hist_code_saida?: string;
  conta_width?: number;
  saldo_inicial?: string | number;
  ativo?: boolean;
  observacoes?: string | null;
};

export type Direction = 'entrada' | 'saida';
export type StatementStatus = 'parsing' | 'classificacao' | 'revisao' | 'gerado' | 'erro';
export type ComplementoModo = 'extrato' | 'complemento' | 'ambos' | 'extrato_classificacao' | 'tudo';
export type OrigemModulo = 'importacao' | 'classificacao';

export type StatementTotais = {
  qtd: number;
  entradas: { n: number; valor_cents: number };
  saidas: { n: number; valor_cents: number };
};

export type Statement = {
  id: string;
  client_id: string;
  arquivo_nome: string;
  storage_path: string | null;
  formato: 'pdf' | 'ofx' | 'csv' | 'xls' | 'xlsx';
  banco_id: string | null;
  conta_ofx: string | null;
  period_start: string | null;
  period_end: string | null;
  banco_conta_contabil: string | null;
  hist_code_entrada: string;
  hist_code_saida: string;
  lote_numero: number;
  saldo_inicial: string | null;
  saldo_final: string | null;
  complemento_modo: ComplementoModo;
  status: StatementStatus;
  origem_modulo: OrigemModulo;
  erro_msg: string | null;
  totais: StatementTotais | Record<string, never>;
  created_at: string;
  updated_at: string;
  client?: Pick<Client, 'id' | 'razao_social' | 'cnpj' | 'dominio_code'> & { conta_width?: number };
};

export type Transaction = {
  id: string;
  ordem: number;
  data: string;
  descricao_raw: string;
  valor: string; // numeric vem como string do PostgREST
  direction: Direction;
  conta_contabil: string | null;
  hist_code: string | null;
  hist_complemento: string | null;
  cod_complemento_hist: string;
  ignorado: boolean;
  regra_id: string | null;
  origem_preenchimento: 'vazio' | 'manual' | 'regra' | 'memoria' | 'conferir';
  classificacao_id: string | null;
};

export type Classificacao = {
  id: string;
  client_id: string;
  direction: Direction;
  nome: string;
  ativo: boolean;
  created_at: string;
  updated_at: string;
};

export type MatchType = 'contains' | 'starts_with' | 'regex' | 'exact';

export type MappingRule = {
  id: string;
  client_id: string;
  direction: Direction;
  match_type: MatchType;
  pattern: string;
  conta_contabil: string | null;
  hist_code: string | null;
  hist_complemento_template: string | null;
  prioridade: number;
  hits: number;
  last_used_at: string | null;
  ativo: boolean;
  auto: boolean;
  created_at: string;
  updated_at: string;
};

