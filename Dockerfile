# Motor de execução de workflows — processo sem HTTP, consome RabbitMQ e fala
# com o mesmo Postgres do serviço backend. Build multi-stage, usuário
# não-root, sem porta exposta.
#
# O contexto de build é a RAIZ DESTE REPOSITÓRIO. Este serviço é autocontido:
# não depende de nenhum arquivo de fora, incluindo o schema do Prisma, que
# vive em prisma/schema.prisma como cópia do schema do backend (ver
# prisma/README.md).
#
#   docker build -t aureon-engine .
#
# Na Railway isso significa Root Directory = `/` e nenhum caminho customizado:
# ela acha Dockerfile e railway.json pelos nomes padrão, na raiz.

# ---------- base: openssl para o query engine do Prisma ----------
# node:20-slim não traz libssl; sem ela o Prisma loga "failed to detect the
# libssl/openssl version" e cai num engine padrão que pode não funcionar.
FROM node:20-slim AS base
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# ---------- deps: árvore completa, só para compilar ----------
FROM base AS deps
WORKDIR /app
COPY package*.json ./
# --ignore-scripts: nenhum postinstall de terceiro roda com a rede/FS do build.
RUN npm ci --ignore-scripts

# ---------- build: Prisma Client + dist/ ----------
FROM deps AS build
WORKDIR /app
COPY tsconfig*.json nest-cli.json ./
COPY prisma ./prisma
COPY src ./src
# O client é gravado em node_modules/.prisma da árvore do próprio schema —
# que agora é esta, e não mais a do backend. É esse diretório que o estágio
# runner copia.
RUN npx prisma generate && npm run build

# ---------- prod-deps: node_modules enxuto, sem toolchain de dev ----------
FROM base AS prod-deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

# ---------- runner ----------
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN groupadd -r engine && useradd -r -g engine engine
COPY --from=prod-deps /app/node_modules ./node_modules
# O CLI do Prisma é devDependency e não entra na imagem final: este serviço
# nunca roda migrations nem generate em runtime. Só o client já gerado, vindo
# do estágio de build, é copiado por cima da árvore de produção — onde
# @prisma/client (dependency) já está.
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/dist ./dist
COPY package.json ./package.json
USER engine
CMD ["node", "--enable-source-maps", "dist/main.js"]
