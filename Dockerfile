FROM node:22-bookworm-slim

# Install FFmpeg and CA certificates
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy project files
COPY package.json ./
COPY src/ ./src/

# Default environment variables for production / Render
ENV HOST=0.0.0.0 \
    PORT=8000 \
    NODE_ENV=production

# Health check using built-in Node 22 fetch
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8000) + '/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Use non-root node user for security
USER node

EXPOSE 8000

CMD ["node", "src/server.js"]
