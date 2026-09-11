/** Ícones de linha inline (sem dependência). 24×24, herdam `currentColor`. */
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function Base({ children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

/** Cadastros — ficha de cliente. */
export function IconCadastros(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <circle cx="8" cy="11" r="2.25" />
      <path d="M4.75 16.4c.5-1.6 1.75-2.4 3.25-2.4s2.75.8 3.25 2.4" />
      <path d="M14.75 10h4M14.75 13.5h4" />
    </Base>
  );
}

/** Importação — extrato entrando no sistema. */
export function IconImportacao(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M12 10.5v6.5" />
      <path d="m9.25 14.25 2.75 2.75 2.75-2.75" />
    </Base>
  );
}

/** Classificação — etiqueta de categoria. */
export function IconClassificacao(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M13.4 3.5H6A2.5 2.5 0 0 0 3.5 6v7.4a2 2 0 0 0 .58 1.4l6.9 6.94a2 2 0 0 0 2.84 0l7.02-7.02a2 2 0 0 0 0-2.84l-6.9-6.9a2 2 0 0 0-1.54-.58Z" />
      <circle cx="8.4" cy="8.4" r="1.5" fill="currentColor" stroke="none" />
    </Base>
  );
}

/** Contábil — livro razão aberto. */
export function IconContabil(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 6.5c-1.5-1-3.5-1.5-5.5-1.5-1 0-2 .1-3 .3v12c1-.2 2-.3 3-.3 2 0 4 .5 5.5 1.5 1.5-1 3.5-1.5 5.5-1.5 1 0 2 .1 3 .3v-12c-1-.2-2-.3-3-.3-2 0-4 .5-5.5 1.5Z" />
      <path d="M12 6.5v12" />
    </Base>
  );
}

/** Sair. */
export function IconLogout(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3" />
      <path d="m15.5 16.5 4.5-4.5-4.5-4.5" />
      <path d="M20 12H9" />
    </Base>
  );
}

/** Início / marca. */
export function IconHome(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 11.5 12 4l8 7.5" />
      <path d="M5.5 10.5V19a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-8.5" />
      <path d="M10 20v-5h4v5" />
    </Base>
  );
}
