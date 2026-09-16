# prisma/ — cópia de leitura do schema

`schema.prisma` aqui é uma **cópia byte a byte** do schema do serviço backend.
Ele existe por um motivo só: gerar o Prisma Client (tipos + query engine) deste
app. Este serviço **nunca** roda migrations.

## Regras

- **Fonte da verdade é o backend.** Toda alteração de schema nasce lá, com a
  migration correspondente. Aqui só chega a cópia.
- **Não existe `prisma/migrations/` neste repositório**, de propósito. Rodar
  `prisma migrate dev` aqui criaria um histórico paralelo e divergente do banco.
  Só `prisma generate` é usado (`npm run prisma:generate`).
- **A cópia tem que ser idêntica.** Um campo que existe no banco mas não nesta
  cópia não quebra nada; um campo que existe nesta cópia mas não no banco
  derruba a query em runtime. Por isso a cópia é integral, nunca parcial.

## Atualizando após uma mudança no backend

```bash
cp ../backend/prisma/schema.prisma prisma/schema.prisma   # ajuste o caminho
npm run prisma:generate
npm run build
```

## Detectando divergência

```bash
npm run schema:check                                   # usa ../backend/prisma/schema.prisma
npm run schema:check -- /caminho/do/backend/prisma/schema.prisma
BACKEND_SCHEMA_PATH=/caminho/schema.prisma npm run schema:check
```

Sai com código 1 se os arquivos diferirem, apontando as primeiras linhas
divergentes. Bom candidato a step de CI e a pre-commit hook.
