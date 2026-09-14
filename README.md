# Financeiro CDL Marília

Controle financeiro da CDL Marília, em **React + Vite + Supabase**.

## O que já está pronto

| Tela | O que faz |
|---|---|
| Dashboard | KPIs do período, despesas por categoria, série dos últimos 12 meses, filtro por conta |
| Preparação de arquivo | Junta os extratos das 3 contas num arquivo só, **remove as transferências entre elas** e entrega nas colunas que o importador espera |
| Importar extrato | CSV/XLSX com as colunas Data, Conta, Descrição, Valor, Tipo e Categoria · **revisão antes de gravar**, criação automática de categorias novas, reversão do lote |
| Transações | Filtros e paginação **no banco**, edição, exclusão, **anexo do comprovante fiscal**, exportação XLSX/CSV do resultado filtrado |
| Relatórios | Receitas × despesas por categoria, saldo acumulado, exportação CSV e impressão em PDF |
| Categorias | CRUD + **regras de categorização editáveis** (sem mexer no código) |
| Contas | Saldo das 3 contas, saldo consolidado e gestão de papéis dos usuários |
| Logs | Auditoria completa com **desfazer** transacional |

---

## Passo a passo do setup

### 1. Criar o projeto no Supabase

1. Acesse supabase.com → **New project** (região: São Paulo).
2. Anote a senha do banco.
3. Em **SQL Editor**, cole e execute **na ordem**:
   - `supabase/migrations/0001_schema.sql`
   - `supabase/migrations/0002_rls.sql`
   - `supabase/migrations/0003_functions.sql`
   - `supabase/migrations/0004_seed.sql`
   - `supabase/migrations/0005_comprovantes.sql`

O seed já cria as contas **Cresol**, **Mercado Pago** e **Cora** e as regras de
categorização equivalentes às do sistema atual. O `0005` cria o bucket
`comprovantes`, onde ficam os anexos das transações.

### 2. Criar os acessos (e-mail e senha)

O login é por **e-mail e senha** — não precisa de Google nem de nenhuma conta externa.

1. Supabase → **Authentication → Sign In / Providers → Email**: deixe **Enable Email provider** ligado
   e **desligue "Confirm email"** (com poucos usuários, evita depender de e-mail de confirmação).
2. Supabase → **Authentication → Users → Add user → Create new user**:
   - e-mail e senha de quem vai lançar (você)
   - marque **Auto Confirm User**
3. Repita para a segunda pessoa (a que só consulta).
4. Ainda em **Authentication → Providers → Email**, desligue **Allow new users to sign up**
   para que ninguém crie conta sozinho.

> O **primeiro** usuário que entrar no sistema vira **administrador** automaticamente.
> Entre você primeiro; depois promova ou rebaixe a outra pessoa na tela **Contas**.

**Esqueci minha senha:** a tela de login tem o link, que envia um e-mail de redefinição.
O serviço de e-mail padrão do Supabase é limitado a poucos envios por hora — para 2 usuários
resolve, e a alternativa sempre disponível é o admin trocar a senha em
*Authentication → Users → (usuário) → Reset password*. Quem está logado também troca a
própria senha na tela **Contas**.

### 3. Rodar localmente

```bash
cp .env.example .env     # preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY
npm install
npm run dev              # http://localhost:5173
```

As chaves estão em Supabase → **Settings → API Keys** (a *publishable key*, que começa
com `sb_publishable_`, ou a *anon public* legada) e a URL em **Settings → General →
Project URL**. O botão **Connect** no topo do painel mostra as duas juntas.

### 4. Publicar na Vercel

1. Suba o projeto para um repositório no GitHub.
2. Vercel → **Add New Project** → importe o repositório.
3. Framework: **Vite** (detecção automática). Build: `npm run build`. Output: `dist`.
4. Em **Environment Variables**, adicione `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.
5. Deploy. Depois volte no Supabase e coloque a URL da Vercel em
   *Authentication → URL Configuration → Site URL* (necessário para o link de redefinição de senha apontar para o lugar certo).

O `vercel.json` já trata as rotas do SPA.

---

## Preparação de arquivo

O extrato que o banco entrega não serve direto para a tela **Importar extrato**:
ele não tem as colunas Conta, Tipo e Categoria, e cada banco nomeia as suas do
seu jeito. A tela **Preparação de arquivo** resolve isso.

O fluxo é: envie um extrato por conta (CSV ou XLSX, como vem do banco), confira
as transferências que o sistema encontrou, e baixe o arquivo unificado — que aí
sim entra na tela Importar extrato.

Da leitura do extrato bruto, só três colunas são obrigatórias: **data**,
**descrição** (ou histórico) e **valor**. A conta vem da tela, já que cada
arquivo é de um banco só, e a categoria sai em branco para as regras
automáticas resolverem na importação. Valor pode vir numa coluna única, com
negativo para saída, ou em duas colunas separadas de débito e crédito.

### Por que remover as transferências

Um PIX de R$ 500 da Cresol para a Cora aparece **duas vezes**: como saída num
extrato e como entrada no outro. Nenhuma das duas é despesa ou receita — é o
mesmo dinheiro mudando de lugar. Se as duas entrassem, o mês fecharia com
R$ 500 a mais de receita e R$ 500 a mais de despesa.

O pareamento exige valor igual, contas diferentes, sentidos opostos e datas
próximas. A tolerância padrão é de **3 dias**, porque TED e PIX entre bancos
nem sempre compensam no mesmo dia, e é ajustável na tela. Cada linha só pode
parear uma vez, e entre candidatos empatados vence o de data mais próxima.

Nada é removido às escondidas: a tela lista as transferências encontradas e a
revisão final permite marcar ou desmarcar qualquer linha antes de baixar.

## Formato do arquivo de importação

O arquivo precisa ter estas seis colunas (a ordem não importa, o nome do cabeçalho é
reconhecido com ou sem acento/maiúscula):

```
Data;Conta;Descrição;Valor;Tipo;Categoria
01/07/2026;Cresol;Dízimo recebido;200,00;receita;Dízimos
05/07/2026;Cora;Compra supermercado;-150,50;despesa;Alimentação
```

- **Data** — DD/MM/AAAA, AAAA-MM-DD ou data nativa do Excel
- **Conta** — precisa bater com uma conta cadastrada (Cresol, Mercado Pago, Cora)
- **Valor** — vírgula decimal, com ou sem "R$"; negativo entre parênteses também vale
- **Tipo** — receita/despesa, entrada/saída ou crédito/débito. Em branco, o sinal do valor decide
- **Categoria** — se ainda não existir no sistema, é criada automaticamente ao importar;
  quando a coluna vem vazia, as regras automáticas tentam classificar

Na tela de revisão, conta, tipo e categoria de cada linha podem ser corrigidos antes de gravar,
e há um campo de conta padrão para as linhas cuja conta não foi reconhecida.

Lançamentos repetidos entram normalmente — dois PIX de mesmo valor no mesmo dia são
comuns e não são tratados como erro. Se uma importação sair errada, o histórico permite
reverter o lote inteiro.

---

## Comprovante fiscal

Cada transação aceita **um** anexo — nota, recibo ou comprovante de PIX — em
PDF, JPG, PNG ou WEBP, até 10 MB. O botão fica no formulário da tela
**Transações**, e as linhas que têm anexo mostram um clipe ao lado da
descrição, que abre o arquivo.

O bucket é **privado**: o arquivo nunca fica acessível por URL fixa. Ao clicar
para abrir, o sistema gera um link assinado válido por um minuto. Quem tem
papel `leitura` consegue abrir os comprovantes, mas só `admin` e `lancador`
conseguem anexar.

O sistema **nunca apaga** arquivo do bucket. Remover o anexo de uma transação
desfaz só o vínculo, e excluir a transação também não apaga o arquivo — é o
que mantém o *desfazer* da tela Logs funcionando e preserva o documento
fiscal. A limpeza de arquivos soltos, se um dia for necessária, é manual pelo
painel do Supabase (**Storage → comprovantes**).

## Papéis de acesso

| Papel | Pode |
|---|---|
| `admin` | Tudo, inclusive criar contas bancárias e mudar papéis |
| `lancador` | Importar, criar, editar, excluir transações e categorias |
| `leitura` | Apenas visualizar e exportar |

As permissões são aplicadas pelo **RLS do Postgres**, não só pela interface —
ocultar um botão não libera o banco.

---

## Manutenção

- **Nova regra de categorização:** tela Categorias → aba *Regras automáticas*.
  Prioridade menor é avaliada primeiro.
- **Desfazer uma importação errada:** tela Importar → histórico → *Reverter*.
- **Desfazer um lançamento:** tela Logs → *Desfazer*.
- **Acelerar o dashboard com base muito grande:** a view `monthly_summary` já
  existe; rode `select refresh_monthly_summary();` (ou agende no Supabase) e
  troque as RPCs para lerem dela.

## Estrutura

```
src/
├── components/   Layout, componentes de UI e os gráficos
├── hooks/        useAuth (sessão + papel)
├── lib/          cliente Supabase, formatação pt-BR, parser de extratos
└── pages/        as 7 telas
supabase/migrations/   schema, RLS, funções e seed
```
