# assets

Cópias standalone dos SVGs usados na interface, na paleta Facility Contábil.

| Arquivo | Onde é usado no app |
|---|---|
| `ilustracao-hub.svg` | hero da tela inicial e do login (`frontend/src/components/FinanceIllustration.tsx`) |
| `icones/cadastros.svg` | módulo Cadastros na barra lateral |
| `icones/importacao.svg` | módulo Importação na barra lateral |
| `icones/classificacao.svg` | módulo Classificação na barra lateral |
| `icones/sair.svg` | botão "Sair" |
| `icones/inicio.svg` | ícone de início (reserva) |

**Fonte de verdade é o código** (`frontend/src/components/`). Estes arquivos são
exportações para reuso fora do app (documentos, apresentações, etc.) — se mexer
no componente, reexporte aqui.

Paleta: `#1E293B` `#334155` `#5C6B66` `#8A7D7B` `#C8A99D` `#F2E6D6`.
Ícones: linha de 1,75, traço `#1E293B` (troque por `currentColor` se quiser
recolorir via CSS).
