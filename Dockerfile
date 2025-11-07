# Dockerfile - tealscript compiler with node-slim
FROM node:22-slim

ENV NODE_ENV=production
ENV USE_LOCAL_TEALSCRIPT=1
ENV PATH=/usr/local/bin:$PATH
ENV ALGOD_PORT=443
ENV ALGOD_SERVER=https://testnet-api.4160.nodely.dev

WORKDIR /app

# Install dependencies
RUN apt-get update && \
    apt-get install -y curl ca-certificates python3 python3-pip && \
    rm -rf /var/lib/apt/lists/*

# Install tealscript and algokit globally
RUN npm install -g @algorandfoundation/tealscript
RUN pip3 install --break-system-packages algokit

# Copy package files and install dependencies
COPY package.json package-lock.json* ./
COPY tsconfig.json ./
RUN npm install 
RUN npm ci

# Copy app source
COPY server.js ./

# Pre-seed /tmp with package.json and node_modules for tealscript
RUN mkdir -p /tmp/tealscript-template
COPY package.json /tmp/tealscript-template/
COPY tsconfig.json /tmp/tealscript-template/
RUN cd /tmp/tealscript-template && npm install @algorandfoundation/tealscript
RUN mkdir -p /app/tmp

EXPOSE 3000

CMD ["node", "server.js"]
