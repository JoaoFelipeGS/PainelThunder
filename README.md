# Central de Vendas — Mercado Livre + Shopee

Painel pessoal em Next.js + TypeScript, Tailwind CSS, Supabase/PostgreSQL e autenticação Supabase. Tema escuro. Inclui dashboard, cadastro básico de produtos, visão de estoque, pedidos, faturamento e página de configuração.

> Estado atual: cadastro e estoque internos usam dados reais do Supabase. Há uma base server-side para OAuth e publicação de estoque em anúncios vinculados, ainda dependente da migration `0004`, configuração de cron e validação em sandbox. Importação de pedidos e criação de anúncios pelo painel ainda não estão implementadas. Não há dados simulados.

## Requisitos

- Node.js LTS compatível com Next.js 15
- npm
- Conta Supabase
- GitHub e Vercel (opcionais para desenvolvimento local; necessários para fluxo de deploy sugerido)

## 1. Instalar dependências

No terminal do VS Code, na pasta do projeto:

```powershell
npm install
```

## 2. Configurar Supabase

1. Crie/abra um projeto no Supabase.
2. Em Project Settings / API, copie a Project URL e a chave pública (publishable/anon).
3. Copie `.env.example` para `.env.local`.
4. Preencha `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY`. A chave `service_role` deve permanecer apenas no servidor.
5. Gere valores aleatórios para `MARKETPLACE_TOKEN_ENCRYPTION_KEY` (32 bytes em Base64) e `MARKETPLACE_OAUTH_STATE_SECRET` (pelo menos 32 bytes). Por exemplo, no Node.js:

```powershell
node -e "const c=require('node:crypto'); console.log('MARKETPLACE_TOKEN_ENCRYPTION_KEY='+c.randomBytes(32).toString('base64')); console.log('MARKETPLACE_OAUTH_STATE_SECRET='+c.randomBytes(48).toString('base64url')); console.log('CRON_SECRET='+c.randomBytes(32).toString('base64url'))"
```

6. Para conectar marketplaces, registre os aplicativos nas plataformas e configure os respectivos IDs, segredos e URLs de callback no ambiente privado do servidor. A URL deve usar o caminho exato `/api/marketplaces/mercado-livre/callback` ou `/api/marketplaces/shopee/callback`.

PowerShell:

```powershell
Copy-Item .env.example .env.local
```

Não adicione `service_role`, client secrets ou tokens OAuth em variáveis `NEXT_PUBLIC_*`. Não comite `.env.local`.

## 3. Criar tabelas

No Supabase Dashboard, abra SQL Editor e execute as migrations em ordem, cada uma em uma nova query:

1. `supabase/migrations/0001_initial_schema.sql`
2. `supabase/migrations/0002_product_variants_inventory.sql`
3. `supabase/migrations/0003_marketplace_connections.sql`
4. `supabase/migrations/0004_marketplace_stock_sync.sql`

As migrations são incrementais e dependem da ordem acima; não apague nem substitua migrations antigas. Antes da terceira migration, confira duplicidades nas combinações de anúncios/pedidos existentes, pois a criação dos índices únicos falhará se houver registros duplicados. Esta instrução não aplica as migrations remotamente.

As migrations criam as tabelas, RLS, trigger de perfil e funções atômicas para cadastro de produto/variações/estoque e movimentação de estoque.

## 4. Criar usuário de login

No Supabase: Authentication → Users → Add user. Crie seu e-mail e senha. Para uso individual, desative o cadastro público (signups) nas configurações de Auth. Configure URLs de redirecionamento conforme seu domínio.

## 5. Rodar localmente

```powershell
npm run dev
```

Abra http://localhost:3000. Entre com o usuário criado no Supabase.

Se as variáveis de ambiente forem alteradas com o servidor rodando, reinicie o `npm run dev`.

## 6. GitHub

Crie um repositório privado vazio no GitHub. Depois:

```powershell
git init
git add .
git commit -m "Inicializa Central de Vendas"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/SEU-REPOSITORIO.git
git push -u origin main
```

Substitua a URL pelo endereço real do seu repositório. Se o Git já estiver inicializado, não repita `git init`; se já existir um remote, verifique com `git remote -v`.

## 7. Deploy na Vercel

1. Importe o repositório GitHub na Vercel.
2. Configure as variáveis do Supabase, credenciais privadas dos marketplaces e segredos server-side em Project Settings → Environment Variables. Não use o prefixo `NEXT_PUBLIC_` para valores secretos.
3. Faça o deploy.
4. No Supabase Auth, adicione o domínio de produção às URLs permitidas.
5. Teste login, leitura e escrita de produtos e ajuste de estoque.

Verifique o plano da Vercel e as condições de uso comercial antes de usar em produção. O plano gratuito pode não ser apropriado para uso comercial.

## Páginas atuais

- `/login` — login com e-mail/senha
- `/app` — dashboard
- `/app/produtos` — cadastro/edição de produtos, variações opcionais e estoque inicial
- `/app/estoque` — busca, filtros, custos, entradas, saídas, ajustes justificados e histórico
- `/app/anuncios` — vínculo manual de anúncios existentes com variações internas
- `/app/pedidos` — pedidos importados
- `/app/faturamento` — resumo bruto de pedidos importados
- `/app/configuracoes` — estado das conexões OAuth dos marketplaces

## Importante sobre estoque e cadastro

O cadastro cria o produto, suas variações e um registro de estoque por variação em uma única chamada transacional ao PostgreSQL. Mesmo produtos sem tamanho ou cor têm uma variação interna para controlar estoque. Quantidades iniciais positivas geram uma movimentação de entrada. Produtos existentes podem ser editados e receber novas variações; as variações e quantidades já cadastradas não são substituídas ao editar o produto.

A página de estoque lê dados reais do Supabase. Entradas, saídas e ajustes exigem justificativa, ficam no histórico e são aplicados atomicamente. Saídas não podem ultrapassar a quantidade disponível nem deixar o estoque abaixo das reservas. Operações de estoque usam identificadores idempotentes para impedir a duplicação de movimentações ao repetir uma solicitação.

Pedidos ainda não são importados automaticamente e suas reservas/baixas não são aplicadas. Depois de vincular anúncios, ajustes de estoque interno podem ser publicados nos canais pela fila; a migration `0004` agenda as tarefas e a rota protegida de cron as processa.

## Estado das integrações

A base implementa rotas server-side de início/callback de OAuth, cifragem de tokens, renovação e remoção local das credenciais. Ela ainda depende das migrations, credenciais oficiais e validação real de cada fluxo. O endpoint Shopee está configurado para a região Brasil; confirme em ambiente sandbox o retorno de `state` e a troca/renovação antes de usar uma conta real. A validade Shopee é normalizada a partir de duração em segundos ou timestamp Unix.

Após aplicar a migration `0004`, o painel permite vincular manualmente anúncios que já existem. As atualizações de quantidade (disponível = físico menos reservado) são colocadas numa fila e publicadas pela API oficial ao Mercado Livre e à Shopee; a tela de Configurações também permite enfileirar uma sincronização inicial. A fila usa retentativas com backoff e a rota de processamento exige segredo de cron.

Ainda não foram implementados: importação incremental de pedidos, reservas/baixas/cancelamentos automáticos, criação de novos anúncios a partir do cadastro, descoberta automática de anúncios, webhooks e reconciliação. A política escolhida para pedidos será reservar no pedido válido, baixar ao confirmar/pagar e liberar ao cancelar; ela só passa a operar quando a ingestão idempotente de pedidos for implementada. Não considere o fluxo de vendas automatizado ainda.

Para validar OAuth e estoque publicado, registre nos portais oficiais os callbacks exatos, configure credenciais e `CRON_SECRET` apenas no servidor, habilite a agenda Vercel definida em `vercel.json`, aplique a migration `0004` depois das anteriores, vincule anúncios sandbox em `/app/anuncios` e execute conexão, publicação, renovação e desconexão. No plano Hobby, a agenda roda uma vez ao dia às 12:00 UTC (09:00 no horário de Brasília); tarefas enfileiradas podem aguardar até a próxima execução para serem processadas. O botão "Sincronizar estoque" apenas agenda tarefas; a rota de cron deve executá-las. No plano Pro, a frequência pode ser aumentada conforme a necessidade operacional. Não use pedidos nem credenciais reais em testes.

## Próximas tarefas técnicas

1. Validar OAuth e publicação de estoque de cada plataforma com aplicativos e anúncios sandbox oficiais.
2. Implementar importação incremental idempotente de pedidos e regras atômicas de reserva/baixa/cancelamento.
3. Implementar importação automática de anúncios e criação de novas publicações com atributos/regras de cada marketplace.
4. Implementar webhooks validados e reconciliação de estoque externo.
5. Importar taxas, frete, descontos, reembolsos e repasses.
6. Adicionar testes automatizados de integração, observabilidade, backups e política de recuperação.

## Segurança

- Tokens OAuth não devem ser expostos ao navegador.
- A chave `service_role` do Supabase nunca deve ser usada no frontend nem com prefixo `NEXT_PUBLIC_`.
- A migration usa RLS por usuário; teste as políticas antes de colocar dados reais.
- Webhooks e sincronização de pedidos ainda não foram implementados; publicação de estoque usa a fila agendada da migration `0004`.
