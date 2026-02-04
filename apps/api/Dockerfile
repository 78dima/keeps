FROM node:20-alpine AS base

# --- 1. Prune (Оставляем только нужное для api) ---
FROM base AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app
RUN npm install -g turbo
COPY . .
# Эта команда создаст папку out, где будет только package.json и код для API
RUN turbo prune --scope=@monokeep/api --docker

# --- 2. Install & Build (Собираем приложение) ---
FROM base AS installer
WORKDIR /app
RUN apk add --no-cache libc6-compat

# Копируем только файлы зависимостей
COPY --from=builder /app/out/json/ .
COPY --from=builder /app/out/package-lock.json ./package-lock.json
RUN npm install

# Копируем исходный код
COPY --from=builder /app/out/full/ .
# COPY prisma ./prisma/ 
# Генерируем клиент prisma
RUN npx prisma generate --schema=./apps/api/prisma/schema.prisma

# Билдим
RUN npm run build --filter=@monokeep/api...

# --- 3. Runner (Запускаем) ---
FROM base AS runner
WORKDIR /app
RUN apk add --no-cache openssl

# Создаем пользователя, чтобы не запускать от root (безопасность)
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nestjs

# Копируем только собранное приложение и нужные зависимости
# COPY --from=installer /app/apps/api/package.json . # Если нужно
COPY --from=installer --chown=nestjs:nodejs /app/apps/api/dist ./dist
COPY --from=installer --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=installer --chown=nestjs:nodejs /app/packages ./packages
# Если Prisma используется в рантайме, ей может понадобиться schema
COPY --from=installer /app/apps/api/prisma.config.ts ./prisma.config.ts
COPY --from=installer --chown=nestjs:nodejs /app/apps/api/prisma ./prisma 

USER nestjs
EXPOSE 3001
CMD ["node", "dist/src/main"]