# Stage 1: Build Next.js frontend
FROM node:20-alpine AS frontend-build
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Stage 2: Python dependencies
FROM python:3.12-slim AS python-deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends gcc && \
    rm -rf /var/lib/apt/lists/*
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Stage 3: Final image
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    nginx supervisor curl gettext-base && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

# Copy Python deps
COPY --from=python-deps /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=python-deps /usr/local/bin /usr/local/bin

# Copy backend app
COPY backend/ /app/backend/

# Copy Next.js standalone build (includes server + static + public)
COPY --from=frontend-build /build/.next/standalone /app
COPY --from=frontend-build /build/.next/static /app/.next/static
COPY --from=frontend-build /build/public /app/public

# Copy config files
COPY nginx.conf /etc/nginx/nginx.conf.template
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY start.sh /start.sh
RUN chmod +x /start.sh

WORKDIR /app

EXPOSE 80

CMD ["/start.sh"]
