# 🏖️ BeT Tech — Guia de Configuração

## Estrutura do Projeto

```
bet-tech/
├── supabase/
│   └── schema.sql          ← Execute no Supabase
├── backend/
│   ├── server.js           ← API Node.js + Express
│   ├── package.json
│   └── .env.example        ← Copie para .env
└── frontend/
    └── index.html          ← Abra no navegador
```

---

## PASSO 1 — Criar projeto no Supabase

1. Acesse **https://supabase.com** e faça login
2. Clique em **"New Project"**
3. Preencha:
   - **Name:** BeT Tech
   - **Database Password:** (anote, vai precisar)
   - **Region:** South America (São Paulo)
4. Aguarde ~2 minutos até o projeto ficar pronto

---

## PASSO 2 — Criar o banco de dados

1. No painel do Supabase, clique em **"SQL Editor"** (menu lateral)
2. Clique em **"New Query"**
3. Copie TODO o conteúdo de `supabase/schema.sql`
4. Cole no editor e clique em **"Run"** (▶)
5. Deve aparecer: *"Success. No rows returned"*

---

## PASSO 3 — Pegar as chaves da API

1. No Supabase, vá em **Settings → API** (ícone de engrenagem)
2. Copie:
   - **Project URL** → ex: `https://abcdefgh.supabase.co`
   - **service_role** (em "Project API keys") → começa com `eyJ...`
   
   ⚠️ **NUNCA exponha a service_role no frontend!**

---

## PASSO 4 — Configurar o backend

```bash
# Entrar na pasta do backend
cd backend

# Instalar dependências
npm install

# Criar o arquivo .env
cp .env.example .env
```

Abra o arquivo `.env` e preencha:

```env
SUPABASE_URL=https://SEU-PROJETO.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOiJ...sua_chave_aqui
PORT=3001
```

---

## PASSO 5 — Rodar o backend

```bash
# Desenvolvimento (com auto-reload)
npm run dev

# Produção
npm start
```

Você verá: `🏖️  BeT Tech API rodando na porta 3001`

---

## PASSO 6 — Abrir o frontend

Simplesmente abra o arquivo `frontend/index.html` no navegador.

> Para ambiente de produção, hospede o `index.html` em qualquer serviço
> de hospedagem estática (Vercel, Netlify, GitHub Pages, etc.)

---

## PASSO 7 — Primeiro acesso

1. Na tela de login, clique em **"Nova Escola"**
2. Preencha o nome da escola, seus dados e uma senha
3. Clique em **"Criar minha escola"**
4. O sistema fará login automaticamente

---

## Endpoints da API

| Método | Rota | Descrição | Acesso |
|--------|------|-----------|--------|
| POST | `/api/auth/registrar` | Cria escola + dono | Público |
| POST | `/api/auth/login` | Login | Público |
| GET | `/api/escola` | Dados da escola | Dono |
| PUT | `/api/escola` | Atualiza escola | Dono |
| GET | `/api/professores` | Lista professores | Todos |
| POST | `/api/professores` | Cria professor | Dono |
| DELETE | `/api/professores/:id` | Desativa professor | Dono |
| GET | `/api/alunos` | Lista alunos | Todos |
| POST | `/api/alunos` | Cria aluno | Todos |
| PUT | `/api/alunos/:id` | Edita aluno | Todos |
| DELETE | `/api/alunos/:id` | Remove aluno | Dono |
| GET | `/api/turmas` | Lista turmas | Todos |
| POST | `/api/turmas` | Cria turma | Dono |
| PUT | `/api/turmas/:id` | Edita turma | Dono |
| DELETE | `/api/turmas/:id` | Desativa turma | Dono |
| POST | `/api/turmas/:id/matriculas` | Matricula aluno | Todos |
| DELETE | `/api/turmas/:id/matriculas/:alunoId` | Remove matrícula | Todos |
| GET | `/api/grade?semana=YYYY-MM-DD` | Grade semanal | Todos |
| PATCH | `/api/presencas/:id` | Atualiza status | Todos |
| GET | `/api/presencas/aula/:aulaId` | Presenças de aula | Todos |

---

## Contato

- bettech6@gmail.com.br
- @bettech.oficial