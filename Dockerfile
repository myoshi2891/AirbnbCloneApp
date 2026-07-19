FROM oven/bun:1.3.12-alpine AS dependencies

WORKDIR /app

COPY package.json bun.lock ./
RUN bun ci

FROM dependencies AS builder

RUN apk add --no-cache openssl tzdata

ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_WEBSITE_URL

ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}
ENV NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=${NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY}
ENV NEXT_PUBLIC_WEBSITE_URL=${NEXT_PUBLIC_WEBSITE_URL}
ENV TZ=Asia/Tokyo
ENV NEXT_TELEMETRY_DISABLED=1

COPY . .
RUN test -n "$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY" \
	&& test -n "$NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY" \
	&& test -n "$NEXT_PUBLIC_WEBSITE_URL" \
	&& bun run build

FROM node:20-alpine AS runner

WORKDIR /app

RUN apk add --no-cache openssl tzdata

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV TZ=Asia/Tokyo
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs \
	&& adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
