# Mendoza IA

Plataforma profissional de automação de WhatsApp com capacidade white-label. CRM moderno com automação, preparado para SaaS e multi-tenant.

## Arquitetura

- **Aplicação**: Next.js 16 (App Router) na Vercel
- **Banco de dados**: PostgreSQL via Neon
- **WhatsApp**: API externa na VPS (Evolution API / WAHA)

## Tecnologias

- Next.js 16, React 19, TypeScript
- Tailwind CSS
- Drizzle ORM + Neon Serverless
- NextAuth v5 (Auth.js)

## Setup

1. Clone e instale dependências:

```bash
git clone https://github.com/mateusdiasyt/mendozaia.git
cd mendozaia
npm install
```

2. Configure o ambiente:

```bash
cp .env.example .env.local
# Edite .env.local com suas credenciais
```

3. Aplique o schema no banco:

```bash
npm run db:push
```

4. Inicie o servidor:

```bash
npm run dev
```

## Variáveis de ambiente

| Variável | Descrição |
|----------|-----------|
| `DATABASE_URL` | Connection string do Neon PostgreSQL |
| `AUTH_SECRET` | Segredo para NextAuth (gere com `openssl rand -base64 32`) |
| `NEXTAUTH_URL` | URL base da aplicação |
| `WHATSAPP_API_URL` | URL da Evolution API (ex: https://mendozaia-evolution-api.bohu4g.easypanel.host) |
| `EVOLUTION_API_KEY` | API key da Evolution API (obtida no Manager) |

## Estrutura

```
src/
├── app/
│   ├── (auth)/          # Login, registro
│   ├── (dashboard)/     # Painel principal
│   ├── actions/         # Server Actions
│   └── api/             # Route Handlers
├── components/
├── lib/
│   └── db/              # Drizzle schema e conexão
└── auth/                # Config NextAuth
```

## Scripts

- `npm run dev` - Desenvolvimento
- `npm run build` - Build de produção
- `npm run start` - Servidor de produção
- `npm run db:push` - Aplicar schema no banco
- `npm run db:generate` - Gerar migrações

## Troubleshooting

**Erro 500 ao criar conta?** Verifique:

1. **Tabelas existem?** Rode `npm run db:push` localmente com o mesmo `DATABASE_URL` da Vercel (copie do projeto Vercel → Settings → Environment Variables)
2. **DATABASE_URL** está correta na Vercel e aponta para o Neon
3. Após alterar variáveis na Vercel, faça um novo deploy (Redeploy)
