FROM dockerhub.tezign.com/tekton/node:22.17.1-pnpm AS base

# Prisma needs libssl to pick debian-openssl-3.0.x from the npm package.
# Without it, generate falls back to openssl-1.1.x and tries binaries.prisma.sh
# (blocked in the Tezign build network).
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

# Install dependencies based on the preferred package manager
COPY package.json yarn.lock* package-lock.json* pnpm-lock.yaml* ./
# prisma generate need this folder
COPY prisma ./prisma
RUN npm install -g pnpm@9.12.3
RUN pnpm i --frozen-lockfile
RUN pnpm exec prisma generate

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
COPY --from=deps /app/src/prisma/client ./src/prisma/client

# Accept the encryption key as a build argument
ARG NEXT_SERVER_ACTIONS_ENCRYPTION_KEY
ENV NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=$NEXT_SERVER_ACTIONS_ENCRYPTION_KEY
RUN npm install -g pnpm@9.12.3
RUN pnpm exec prisma generate
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
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma
COPY ./load-apollo.sh /docker-load-apollo.sh
RUN chmod +x /docker-load-apollo.sh

USER nextjs

# Tezign 测试环境 / Istio sidecar 默认探活 8080；ACK 清单需与此一致，或用 PORT 覆盖。
EXPOSE 8080
ENV PORT=8080
# 限制 V8 老生代堆上限，让其在容器 cgroup 触发 OOM Kill 之前主动 GC。
# 生产容器内存 limit = 1Gi（request==limit，无突发空间），堆上限设 640MB，
# 其余约 384MB 留给 Next.js 基础 RSS、sharp 原生内存与系统开销。
# 若后续把容器内存调大，可同步上调此值（约取上限的 ~65%）。可在部署层用环境变量覆盖。
ENV NODE_OPTIONS="--max-old-space-size=640"

ENTRYPOINT ["/docker-load-apollo.sh"]

# server.js is created by next build from the standalone output
# https://nextjs.org/docs/pages/api-reference/next-config-js/output
CMD HOSTNAME="0.0.0.0" node server.js
