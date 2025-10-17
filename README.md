# TealScript Compiler Server

A REST API server for compiling TealScript smart contracts to Algorand bytecode and ABI artifacts.

## Features

- Compile TealScript contracts via HTTP API
- Returns ARC32 and ARC4 JSON artifacts
- Docker containerized for easy deployment
- Pre-configured with TealScript dependencies

## Quick Start

### Using Docker

1. **Build the container:**
```bash
docker build -t tealscript-compiler .
```

2. **Run the server:**
```bash
docker run -p 3000:3000 tealscript-compiler
```

The server will be available at `http://localhost:3000`

### Local Development

1. **Install dependencies:**
```bash
npm install
```

2. **Start the server:**
```bash
node server.js
```

## API Usage

### Compile Contract

**Endpoint:** `POST /compile`

**Request Body:**
```json
{
  "filename": "contract.algo.ts",
  "code": "import { Contract } from '@algorandfoundation/tealscript'\n\nexport default class Simple extends Contract {\n  counter = GlobalStateKey<uint64>({ key: 'counter' });\n\n  incr(i: uint64): void {\n    this.counter.value = this.counter.value + i;\n  }\n}"
}
```

**Response:**
```json
{
  "ok": true,
  "files": {
    "Simple.arc32.json": {
      "encoding": "utf8",
      "data": "{ ... ARC32 contract specification ... }"
    },
    "Simple.arc4.json": {
      "encoding": "utf8", 
      "data": "{ ... ARC4 contract specification ... }"
    }
  }
}
```

### Example with curl

```bash
curl -X POST http://localhost:3000/compile \
  -H "Content-Type: application/json" \
  -d '{
    "filename": "contract.algo.ts",
    "code": "import { Contract } from '\''@algorandfoundation/tealscript'\''\n\nexport default class Simple extends Contract {\n  counter = GlobalStateKey<uint64>({ key: '\''counter'\'' });\n\n  incr(i: uint64): void {\n    this.counter.value = this.counter.value + i;\n  }\n}"
  }'
```

## Environment Variables

- `PORT` - Server port (default: 3000)
- `TEALSCRIPT_TIMEOUT_MS` - Compilation timeout (default: 20000)
- `BODY_LIMIT` - Request body size limit (default: 2mb)
- `ALGOD_PORT` - Algorand node port (default: 443)
- `ALGOD_SERVER` - Algorand node URL (default: https://testnet-api.4160.nodely.dev)

## Docker Deployment

### Production Deployment

```bash
# Build
docker build -t tealscript-compiler .

# Run with custom port
docker run -p 8080:3000 -e PORT=3000 tealscript-compiler

# Run with environment variables
docker run -p 3000:3000 \
  -e TEALSCRIPT_TIMEOUT_MS=30000 \
  -e ALGOD_SERVER=https://your-algod-server.com \
  tealscript-compiler
```

### Docker Compose

```yaml
version: '3.8'
services:
  tealscript-compiler:
    build: .
    ports:
      - "3000:3000"
    environment:
      - PORT=3000
      - TEALSCRIPT_TIMEOUT_MS=20000
      - ALGOD_SERVER=https://testnet-api.4160.nodely.dev
```

## Contributing

### Development Setup

1. **Fork and clone the repository**
2. **Install dependencies:**
```bash
npm install
```

3. **Make your changes**
4. **Test locally:**
```bash
node server.js
```

5. **Test with Docker:**
```bash
docker build -t tealscript-compiler-test .
docker run -p 3000:3000 tealscript-compiler-test
```

### Code Style

- Use TypeScript/JavaScript ES modules
- Follow existing code formatting
- Add error handling for new features
- Include debug logging where appropriate

### Submitting Changes

1. Create a feature branch
2. Make your changes
3. Test thoroughly
4. Submit a pull request with:
   - Clear description of changes
   - Test results
   - Any breaking changes noted

### Testing

Test the compilation endpoint:

```bash
# Test successful compilation
curl -X POST http://localhost:3000/compile \
  -H "Content-Type: application/json" \
  -d @payload.json

# Test error handling
curl -X POST http://localhost:3000/compile \
  -H "Content-Type: application/json" \
  -d '{"filename": "test.algo.ts", "code": "invalid code"}'
```

### Architecture

- `server.js` - Main Express server
- `Dockerfile` - Container configuration
- `tsconfig.json` - TypeScript configuration
- `/tmp/tealscript-template/` - Pre-seeded dependencies in container

The server creates temporary directories for each compilation request, copies the TealScript dependencies, compiles the contract, and returns the generated artifacts.

## License

MIT License - see LICENSE file for details.