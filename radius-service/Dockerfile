FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    wireguard-tools iproute2 iptables ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY src ./src

EXPOSE 1812/udp 1813/udp 51820/udp
CMD ["node", "src/index.js"]
