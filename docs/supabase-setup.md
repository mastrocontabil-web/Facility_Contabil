# Criar o projeto Supabase

## 1. Criar o projeto

1. Entre em https://app.supabase.com e clique **New project**.
2. Nome: `extrato-dominio` (ou o que preferir). Escolha uma senha forte para o
   banco (guarde) e a região mais próxima (ex: `South America (São Paulo)`).
3. Aguarde ~2 min o provisionamento.

## 2. Pegar as chaves

**Project Settings → API**:

| Campo no painel            | Vai para                                   |
|----------------------------|--------------------------------------------|
| Project URL                | `SUPABASE_URL` / `VITE_SUPABASE_URL`       |
| Project API keys → `anon`  | `SUPABASE_ANON_KEY` / `VITE_SUPABASE_ANON_KEY` |
| Project API keys → `service_role` | `SUPABASE_SERVICE_ROLE_KEY` (só no backend!) |

**Project Settings → API → JWT Settings → JWT Secret** → `SUPABASE_JWT_SECRET`
(opcional; se preenchido, o backend valida o token localmente e fica mais rápido).

**Project Settings → Database → Connection string → URI** → `SUPABASE_DB_URL`
(usada só pelo runner de migrations). Use a string do **Session pooler**. A senha
costuma ter `#`/`@` — deixe o valor **entre aspas** no `.env`.

> ⚠️ A `service_role` key ignora RLS. Nunca a coloque no frontend nem commite.

## 3. Aplicar as migrations

### Opção A — runner do projeto (recomendado)

Com `SUPABASE_DB_URL` no `backend/.env`:

```bash
npm run migrate         -w backend   # aplica o que falta (idempotente)
npm run migrate:status  -w backend   # só mostra o que já foi aplicado
```

Roda todos os `supabase/migrations/*.sql` em ordem e registra o que já aplicou na
tabela `_migrations`.

### Opção B — SQL Editor (manual)

**SQL Editor → New query**, cole e rode `supabase/migrations/*.sql` na ordem
numérica (`0001` … `0006`).

## 4. Criar o primeiro usuário

**Authentication → Users → Add user → Create new user**. Marque
*Auto Confirm User*. Use esse e-mail/senha para logar no sistema.

(Opcional) Em **Authentication → Providers → Email**, desligue *Enable Sign Ups*
para que só usuários criados manualmente por você tenham acesso.

## 5. Conferir

No **Table Editor** devem existir: `clients`, `chart_accounts`, `mapping_rules`,
`statements`, `transactions`, `export_files`. Em **Storage**: buckets `statements`
e `exports` (privados).

Rode `GET http://localhost:8080/api/health/deep` — `supabase` deve vir `ok: true`.
