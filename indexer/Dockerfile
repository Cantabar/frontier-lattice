FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache tini
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./

ENV NODE_ENV=production
ENV API_PORT=3100
# DATABASE_URL must be provided at runtime

EXPOSE 3100

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
