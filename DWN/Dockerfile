FROM ubuntu:24.04 AS builder

RUN apt-get update && apt-get install -y \
    build-essential \
    cmake \
    pkg-config \
    git \
    libleveldb-dev \
    libboost-all-dev \
    libssl-dev \
    libsodium-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .

RUN rm -rf build && \
    cmake -S . -B build -DBUILD_TESTS=OFF && \
    cmake --build build -j"$(nproc)"

FROM ubuntu:24.04

RUN apt-get update && apt-get install -y \
    nginx \
    libleveldb1d \
    libboost-system1.83.0 \
    libboost-thread1.83.0 \
    libssl3 \
    libsodium23 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/build/DWN /usr/local/bin/DWN
COPY --from=builder /app/ui /var/www/dwn-ui
COPY nginx.conf.template /etc/nginx/conf.d/default.conf.template

RUN mkdir -p /var/lib/DWN/leveldb && \
    rm -f /etc/nginx/sites-enabled/default

ENV DWN_LEVELDB_PATH=/var/lib/DWN/leveldb
ENV DWN_HOST=127.0.0.1

EXPOSE 10000

CMD ["sh", "-c", "DWN_PORT=10001 DWN >/tmp/dwn.log 2>&1 & sed \"s/__PORT__/${PORT:-10000}/g\" /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf && exec nginx -g 'daemon off;'"]
