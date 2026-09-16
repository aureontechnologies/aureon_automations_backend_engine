# Deploy — Aureon Automations / serviço `backend-engine`

Motor de execução dos workflows publicados. Processo **sem HTTP**: não abre
porta, não tem domínio, não recebe request. Consome RabbitMQ e lê/escreve no
Postgres. Repositório **independente**: tudo o que precisa para buildar e rodar
está aqui dentro.

```
Meta/WhatsApp ──► backend (outro repositório) ──┐
                                                │ publish
                     ┌──────────┐  ┌────────────▼─┐
                     │ Postgres │  │  RabbitMQ    │  ← fronteira entre os dois
                     └────▲─────┘  └────┬─────────┘
                          │             │ consume (aureon.engine.triggers)
                     ┌────┴─────────────▼────┐
                     │ backend-engine (ESTE) │  worker · sem porta · 1 réplica
                     └───────────────────────┘
```

## O contrato com o `backend`

Os dois serviços não compartilham código, repositório nem imagem. A integração
acontece por três acordos, e só por eles:

| Acordo | O que significa |
|---|---|
| **Mesmo Postgres** | `DATABASE_URL` idêntica à do backend. Ele é o dono do schema e o único que roda migrations; este serviço só lê e escreve nas tabelas já migradas. |
| **Mesmo RabbitMQ** | `RABBITMQ_URL` idêntica. Exchange `aureon.events` (topic). Este serviço consome `automation.trigger` e `contato.respondeu` pela fila `aureon.engine.triggers`; publica `channel.message.send`. |
| **Mesma `ENCRYPTION_KEY`** | Este serviço decifra tokens que o backend cifrou (WhatsApp, chave OpenAI do agente). Valor diferente = falha ao decifrar em todo nó que envia mensagem. |

Nenhum dos três falha no boot quando está errado. Apontar para outro banco ou
outro broker sobe o processo normalmente e simplesmente **nenhum workflow
executa** — é o modo de falha a procurar primeiro quando "não acontece nada".

### Schema do Prisma

`prisma/schema.prisma` é uma **cópia** do schema do backend, usada só para
gerar o Prisma Client. Este serviço nunca roda migration. Ver
[prisma/README.md](prisma/README.md).

Depois de qualquer migration no backend:

```bash
cp ../backend/prisma/schema.prisma prisma/schema.prisma   # ajuste o caminho
npm run prisma:generate
npm run schema:check                                      # confirma paridade
```

`npm run schema:check` sai com código 1 se divergir — bom step de CI.

---

## Arquivos de deploy

| Arquivo | Papel |
|---|---|
| `Dockerfile` | Imagem do worker. Contexto de build = raiz deste repositório. |
| `railway.json` | Config-as-code da Railway. Nome padrão, na raiz — nenhum caminho para configurar. |
| `.dockerignore` | Filtros do contexto de build. |
| `docker-compose.yml` | Stack local de dev: só este serviço, entrando na rede do backend. |
| `docker-compose.prod.yml` | Stack de produção — validar a imagem antes do deploy, ou rodar num VPS. |
| `.env.example` | Modelo versionado de variáveis. |

---

## 1. Serviço na Railway

Use o **mesmo projeto** onde estão o Postgres e o RabbitMQ do backend — é
assim que as referências `${{Postgres.DATABASE_URL}}` ficam disponíveis e o
tráfego fica na rede privada.

**+ New → GitHub Repo** → este repositório.
**Settings → Source**: branch, **Root Directory = `/`**.

Nada mais. `Dockerfile` e `railway.json` estão na raiz, com os nomes padrão —
a Railway acha os dois sozinha. Não preencha config-as-code e não crie a
variável `RAILWAY_DOCKERFILE_PATH`.

**Sem domínio, sem healthcheck, sem migrations.** Não clique em Generate
Domain: este processo não escuta em porta nenhuma, e um healthcheck HTTP
marcaria o deploy como falho para sempre.

## 2. Variáveis

```
DATABASE_URL = ${{Postgres.DATABASE_URL}}
RABBITMQ_URL = ${{RabbitMQ.RABBITMQ_URL}}
```

| Variável | Obrigatória | Observação |
|---|:--:|---|
| `NODE_ENV=production` | ✅ | |
| `DATABASE_URL` | ✅ | **mesma** do serviço backend |
| `RABBITMQ_URL` | ✅ | **mesma** do serviço backend |
| `ENCRYPTION_KEY` | ✅ | **idêntica** à do serviço backend |

É a lista inteira. Este serviço não fala com a Meta e não tem chave própria de
OpenAI — a chave de cada nó de IA vem do banco, por agente, cifrada com
`ENCRYPTION_KEY`.

---

## Rodando local

A infra (Postgres + RabbitMQ) pertence ao repositório do backend. Suba ele
primeiro:

```bash
# no repositório do backend
docker compose up --build

# aqui
docker compose up --build
```

Se aparecer `network aureon_net declared as external, but could not be found`,
é sinal de que o passo 1 não foi feito.

Fora do Docker:

```bash
npm ci
npm run prisma:generate
npm run start:dev      # lê .env.dev
```

Paridade de produção:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
```

---

## Pontos de atenção

**Escalar além de 1 réplica.** O `wait-timeout-poller.service.ts` roda dentro
do processo; com N réplicas, N pollers varrem a mesma tabela ao mesmo tempo. A
migration `execution_node_claim_unique` sugere claim idempotente nos nós —
confirme que o poller também usa claim atômico
(`UPDATE ... WHERE status = 'aguardando' RETURNING`) antes de subir esse
número. Enquanto não confirmar, as filas do RabbitMQ absorvem pico sem perder
mensagem.

**Este serviço sobe antes do banco existir.** Não há `depends_on` entre
repositórios diferentes. Se o Postgres ainda não estiver de pé, o processo sai
no boot e a política de restart o traz de volta até conectar. Em produção isso
aparece como alguns restarts logo após um deploy de infra — não é bug.

**Lockfiles precisam ser gerados em Linux.** O npm no Windows omite
dependências opcionais de outra plataforma e o `npm ci` do build quebra com
`Missing: @emnapi/... from lock file`. Regenere assim:

```bash
docker run --rm -v "$PWD:/app" -w /app node:20-slim \
  npm install --package-lock-only --ignore-scripts
```
