FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm ci

COPY packages/shared packages/shared
COPY apps/web apps/web

ARG VITE_API_URL=http://localhost:8080
ARG VITE_API_BASE_URL=http://localhost:8080
ARG VITE_SHORT_URL_ORIGIN=http://localhost:8080
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_SHORT_URL_ORIGIN=$VITE_SHORT_URL_ORIGIN

RUN npm run build --workspace=@shortify/shared && npm run build --workspace=@shortify/web

FROM nginx:1.27-alpine

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80
