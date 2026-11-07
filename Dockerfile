FROM node:24-bookworm-slim AS frontend-build
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim-bookworm AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    BASE_DIR=/app \
    BULK_TEMP_DIR=/app/backend/tmp/bulk
WORKDIR /app/backend
COPY backend/requirements.txt ./requirements.txt
RUN python -m pip install --no-cache-dir -r requirements.txt
RUN groupadd --gid 10001 sportsnap \
    && useradd --uid 10001 --gid sportsnap --create-home sportsnap \
    && mkdir -p /app/backend/tmp/bulk \
    && chown -R sportsnap:sportsnap /app/backend/tmp
COPY backend/ ./
COPY --from=frontend-build /build/frontend/dist /app/frontend/dist
USER sportsnap
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
    CMD ["python", "-c", "import json, urllib.request; response = urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4); health = json.load(response); assert health['status'] == 'ok' and health['model_loaded'] is True"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
