/** Módulos do sistema — usado pelo hub (seleção) e pelo layout (nav contextual). */
export type ModuleDef = {
  id: string;
  label: string;
  description: string;
  home: string;
  match: (pathname: string) => boolean;
  nav: { to: string; label: string }[];
};

export const MODULES: ModuleDef[] = [
  {
    id: 'cadastros',
    label: 'Cadastros',
    description: 'Cadastro de clientes e os ajustes ligados a eles (código Domínio, conta do banco, saldo inicial).',
    home: '/clientes',
    match: (p) => p.startsWith('/clientes'),
    nav: [{ to: '/clientes', label: 'Clientes' }],
  },
  {
    id: 'importacao',
    label: 'Importação',
    description: 'Escolhe o cliente, importa o extrato (ou puxa do módulo Classificação), define a conta contábil de cada lançamento e gera o arquivo do Domínio.',
    home: '/importar',
    match: (p) => p.startsWith('/importar') || p.startsWith('/historico') || p.startsWith('/memoria') || p.startsWith('/revisao'),
    nav: [
      { to: '/importar', label: 'Nova importação' },
      { to: '/historico', label: 'Histórico' },
      { to: '/memoria', label: 'Memória' },
    ],
  },
  {
    id: 'classificacao',
    label: 'Classificação',
    description: 'Importa o extrato e classifica cada lançamento por categoria (água, luz, recebimentos...) antes de virar contabilidade.',
    home: '/classificacao',
    match: (p) => p.startsWith('/classificacao'),
    nav: [
      { to: '/classificacao', label: 'Nova importação' },
      { to: '/classificacao/historico', label: 'Histórico' },
      { to: '/classificacao/categorias', label: 'Classificações' },
    ],
  },
];

export function moduleAtPath(pathname: string): ModuleDef | undefined {
  return MODULES.find((m) => m.match(pathname));
}
