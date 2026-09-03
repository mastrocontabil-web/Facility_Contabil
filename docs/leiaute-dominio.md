# Leiaute Domínio — Lançamentos Contábeis em Lote

Formato do arquivo `.txt` gerado para importar no **Domínio Contábil**
(`Utilitários → Importação → ... → "Lançamentos Contábeis em Lote (Leiaute
Domínio Sistemas)"`).

Decodificado a partir de um **export real do Domínio** (`Utilitários →
Exportação → Lançamentos`) — o formato de importação é o mesmo do de exportação.
O exportador (`backend/src/dominio/exporter.ts`) tem um golden test que reproduz
cada registro 02+03 de partida simples de um export real, idêntico.

> ⚠️ Um arquivo modelo anterior (`(168) Dominio.txt`) tinha estrutura diferente
> (BOM UTF-8, campos de outra largura) e **não** importava. Ignorar.

## Características gerais

- **Posicional** (largura fixa por campo), sem separador.
- **SEM BOM.** Encoding **Latin-1 / Windows-1252** (não UTF-8).
- Quebra de linha **CRLF** (`\r\n`), inclusive após a última linha.
- Números: zero-padding à esquerda. Datas: `dd/mm/aaaa`. Textos: padding com
  espaço à direita.
- Valores: **em centavos**, sem vírgula nem ponto (`R$ 102,58` → 15 dígitos
  `000000000010258`).
- Ordem dos lançamentos: **não importa** para o Domínio (o export real não
  ordena). O exportador usa ordem cronológica (data crescente).

## Estrutura

```
01  cabeçalho (1x, 55 chars)
02  lançamento (cabeçalho)   ┐ um par por lançamento
03  partida (débito/crédito) ┘  sequencial GLOBAL: 02 ímpar, 03 par
99  rodapé (1x, "9"×100)
```

Um lançamento simples (partida dobrada) = um `02` + um `03`. Sequencial global:
lançamento *i* (0-based) → `02` = `2i+1`, `03` = `2i+2`.

### Registro 01 — cabeçalho (55 chars)

| Ini | Tam | Campo | Exemplo |
|----:|----:|-------|---------|
| 0  | 2  | Tipo (`01`) | `01` |
| 2  | 7  | Código da empresa no Domínio (zero-pad) | `0000042` |
| 9  | 14 | CNPJ/CPF (só dígitos, zero-pad) | `11222333000181` |
| 23 | 10 | Data inicial | `01/06/2026` |
| 33 | 10 | Data final | `30/06/2026` |
| 43 | 1  | Fixo | `N` |
| 44 | 2  | Fixo | `05` |
| 46 | 8  | Número do lote (zero-pad) | `00000018` |
| 54 | 1  | Fixo | `1` |

> **A confirmar no 1º uso real:** o campo do lote (pos. 46) e o `1` final
> (pos. 54). No export real veio `00000018` + `1`; o exportador usa
> `statements.lote_numero` + `1`.

### Registro 02 — lançamento (165 chars)

| Ini | Tam | Campo | Exemplo |
|----:|----:|-------|---------|
| 0  | 2   | Tipo (`02`) | `02` |
| 2  | 7   | Sequencial ímpar | `0000001` |
| 9  | 1   | Fixo | `X` |
| 10 | 10  | Data do lançamento | `03/06/2026` |
| 20 | 45  | Texto livre (nome do usuário Domínio no export) — **o exportador deixa em branco** | (espaços) |
| 65 | 1   | Fixo | `N` |
| 66 | 99  | Espaços | |

### Registro 03 — partida contábil (664 chars)

| Ini | Tam | Campo | Exemplo |
|----:|----:|-------|---------|
| 0   | 2   | Tipo (`03`) | `03` |
| 2   | 7   | Sequencial par | `0000002` |
| 9   | 7   | Conta **débito** (código reduzido, zero-pad) — **sempre 7** | `0000467` |
| 16  | 7   | Conta **crédito** (código reduzido, zero-pad) — **sempre 7** | `0010018` |
| 23  | 15  | Valor em centavos (zero-pad) | `000000000010258` |
| 38  | 7   | Código do histórico (zero-pad; `0000000` = sem código) | `0000186` |
| 45  | 512 | Complemento do histórico (texto, uppercase, pad à direita) | `SERVICOS PRESTADOS ...` |
| 557 | 7   | Código da empresa no Domínio (zero-pad) — repetido | `0000042` |
| 564 | 100 | Espaços | |

> A largura do campo de conta é **sempre 7**, independente de quantos dígitos o
> plano de contas usa. `467` → `0000467`. (O campo `conta_width` do cliente
> **não** entra aqui — usar 5 quebrou o alinhamento e o Domínio recusou.)

### Registro 99 — rodapé

`9` × 100.

## Lógica contábil (partida dobrada)

Seja **B** = conta contábil do banco (campo único da importação) e **C** = conta
de contrapartida escolhida na linha:

| Direção | Débito | Crédito |
|---------|--------|---------|
| **Entrada** (crédito no banco: PIX recebido, venda…) | **B** | **C** |
| **Saída** (débito no banco: despesa, transferência…) | **C** | **B** |

O código de histórico (`138` entrada / `186` saída por padrão) é configurável por
cliente e por importação. O **complemento** é montado a partir da descrição do
extrato e/ou do texto digitado, conforme o modo escolhido
(`statements.complemento_modo`).

## Pendências / a confirmar no 1º import real

- Campo do lote e o `1` no fim do registro 01.
- Se o Domínio aceita o registro 02 com o campo de texto (pos. 20) em branco.
- Se o Domínio aceita o código de histórico preenchido (`0000186`) mesmo que o
  histórico 186 não esteja cadastrado na empresa — se der erro, mandar `0000000`.
