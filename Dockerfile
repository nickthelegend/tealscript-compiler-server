# Dockerfile - puya-ts compiler with node-slim
FROM node:22-slim

ENV NODE_ENV=production
ENV USE_LOCAL_PUYA=1
ENV PATH=/usr/local/bin:$PATH
ENV ALGOD_PORT=443
ENV ALGOD_SERVER=https://testnet-api.4160.nodely.dev

WORKDIR /app

# Install dependencies
RUN apt-get update && \
    apt-get install -y curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Download Puya binary and extract it


# Install puya-ts globally
RUN npm install -g @algorandfoundation/tealscript

# Copy package files and install dependencies
COPY package.json package-lock.json* ./
COPY tsconfig.json ./
RUN npm install 
RUN npm ci

# Install algorand-typescript locally

# Copy app source
COPY server.js ./

# Pre-seed /tmp with package.json and node_modules for puya-ts
RUN mkdir -p /tmp/puya-template
COPY package.json /tmp/puya-template/
RUN cd /tmp/puya-template && npm install @algorandfoundation/algorand-typescript
RUN mkdir -p /app/tmp

EXPOSE 3000

CMD ["node", "server.js"]
