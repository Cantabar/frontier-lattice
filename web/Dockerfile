# Multi-stage build for Frontier Corm Web UI
# Serves static assets via nginx

# --- Build stage ---
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_SUI_NETWORK=localnet
ARG VITE_TRIBE_PACKAGE_ID=0x0
ARG VITE_CORM_AUTH_PACKAGE_ID=0x0
ARG VITE_TRUSTLESS_CONTRACTS_PACKAGE_ID=0x0
ARG VITE_WORLD_PACKAGE_ID=0x0
ARG VITE_COIN_TYPE=0x2::sui::SUI
ARG VITE_INDEXER_URL=/api/v1
ARG VITE_WEB_UI_HOST=http://localhost:5173
RUN npm run build

# --- Serve stage ---
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
# SPA fallback: route all paths to index.html
RUN echo 'server { listen 80; location / { root /usr/share/nginx/html; try_files $uri $uri/ /index.html; } }' > /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
