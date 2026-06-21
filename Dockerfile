FROM node:22-alpine AS base

# Install dependencies only when needed
FROM base AS deps
# Check https://github.com/nodejs/docker-node/tree/b4117f9333da4138b03a546ec926ef50a31506c3#nodealpine to understand why libc6-compat might be needed.
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Install dependencies based on the preferred package manager
COPY package.json yarn.lock* package-lock.json* pnpm-lock.yaml* ./
# prisma generate need this folder
COPY prisma ./prisma
RUN npm install -g pnpm@10.6.2
RUN pnpm i --frozen-lockfile

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
COPY --from=deps /app/src/prisma/client ./src/prisma/client

# Accept the encryption key as a build argument
ARG NEXT_SERVER_ACTIONS_ENCRYPTION_KEY
ENV NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=$NEXT_SERVER_ACTIONS_ENCRYPTION_KEY
RUN npm install -g pnpm@10.6.2
RUN pnpm run build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

# Set the correct permission for prerender cache
RUN mkdir .next
RUN chown nextjs:nodejs .next

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
# 限制 V8 老生代堆上限。生产容器内存 limit 当前为 2Gi。
# 注意：图片处理(sharp/libvips)与图片 Buffer 属于【堆外内存】，不受此参数约束，
# 它们才是 OOMKilled 的主因——控制堆外内存靠"降低图片并发 + sharp.cache(false)/
# concurrency(1)"(见 queue.ts / classification-image.tsx)，而不是调高这个值。
# 故此处刻意保守(640MB)，给堆外的 sharp/Buffer 留足空间；待内存曲线稳定且有富余后，
# 可在部署层用环境变量上调。
ENV NODE_OPTIONS="--max-old-space-size=640"

# server.js is created by next build from the standalone output
# https://nextjs.org/docs/pages/api-reference/next-config-js/output
CMD HOSTNAME="0.0.0.0" node server.js
