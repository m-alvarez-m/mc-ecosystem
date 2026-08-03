# Genesis · Dockerfile multi-stage (D1).
#
# Stage 1 (builder): Node compila la SPA a estaticos en /app/dist.
# Stage 2 (runtime): nginx:alpine sirve los estaticos y hace reverse
#   proxy a la API de la red compose.
#
# No hay runtime Node en producción — el contenedor final pesa poco
# y el healthcheck es trivial (200 OK en /health).

# ---------- Stage 1: build ----------
FROM node:22-alpine AS builder

WORKDIR /app

# package.json + package-lock.json primero para maximizar cache de
# capa cuando cambian solo fuentes.
COPY package.json package-lock.json ./
RUN npm ci

# Fuentes.
COPY tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts index.html ./
COPY src ./src

# Build de produccion. tsc -b valida types + Vite bundlea a /app/dist.
RUN npm run build

# ---------- Stage 2: runtime ----------
FROM nginx:alpine AS runtime

# Config custom (reemplaza el default de nginx:alpine).
COPY nginx.conf /etc/nginx/conf.d/default.conf

# SPA compilada.
COPY --from=builder /app/dist /usr/share/nginx/html

# nginx:alpine ya expone 80 y arranca el master en foreground.
EXPOSE 80
