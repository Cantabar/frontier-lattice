# Build context: repo root (docker build -f continuity-engine/Dockerfile .)
FROM golang:1.23-alpine AS builder

WORKDIR /build
COPY continuity-engine/go.mod continuity-engine/go.sum ./
RUN go mod download

COPY continuity-engine/ .
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/continuity-engine .

FROM alpine:3.19
RUN apk --no-cache add ca-certificates

# Binary + entrypoint wrapper (assembles DATABASE_URL from ECS secrets)
COPY --from=builder /out/continuity-engine /usr/local/bin/continuity-engine
COPY continuity-engine/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Item registry data (only the files registry.go reads)
COPY static-data/data/phobos/fsd_built/types.json  /data/registry/types.json
COPY static-data/data/phobos/fsd_built/groups.json  /data/registry/groups.json
COPY continuity-engine/data/item-values.json        /data/item-values.json

EXPOSE 3300
ENV PORT=3300

ENTRYPOINT ["entrypoint.sh"]
CMD ["continuity-engine"]
