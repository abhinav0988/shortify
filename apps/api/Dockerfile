FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm ci

COPY apps/api apps/api
COPY packages/shared packages/shared

RUN npm run build --workspace=@shortify/shared && npm run build --workspace=@shortify/api

FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm ci --omit=dev && addgroup -S shortify && adduser -S shortify -G shortify

COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/packages/shared/dist packages/shared/dist

RUN chown -R shortify:shortify /app
USER shortify

EXPOSE 8080

CMD ["node", "apps/api/dist/server.js"]
