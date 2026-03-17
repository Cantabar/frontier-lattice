# ── Stage 1: Compile circom circuits ─────────────────────────────
# Installs a Rust toolchain + circom, then builds the Groth16
# artifacts (vkeys, wasm, zkeys) that the indexer serves and uses.
FROM node:20-alpine AS circom-builder
WORKDIR /app

# Rust toolchain (needed to compile circom from source)
RUN apk add --no-cache curl build-base && \
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
ENV PATH="/root/.cargo/bin:${PATH}"
RUN cargo install circom

# Node deps (snarkjs + circomlib needed by the build script)
COPY package*.json ./
RUN npm ci

# Circuit sources + build script
COPY circuits/ circuits/
COPY scripts/build-zk-artifacts.sh scripts/
RUN bash scripts/build-zk-artifacts.sh

# ── Stage 2: TypeScript build ────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

# ── Stage 3: Runtime ─────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache tini
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./

# ZK circuit artifacts: vkeys for server-side proof verification,
# wasm + zkey files served to the web client for proof generation.
COPY --from=circom-builder /app/circuits/artifacts/ ./circuits/artifacts/

ENV NODE_ENV=production
ENV API_PORT=3100
# DATABASE_URL must be provided at runtime

EXPOSE 3100

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
