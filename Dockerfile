# =============================================================================
# Stage 1 — Builder
# Install dependency Python di environment terpisah.
# =============================================================================
FROM python:3.12-slim AS builder

WORKDIR /install

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir --prefix=/install/packages -r requirements.txt

# =============================================================================
# Stage 2 — Runtime
# Image final yang sangat ringan: tanpa torch, tanpa TF, tanpa build tools.
# =============================================================================
FROM python:3.12-slim AS runtime

WORKDIR /app

# Salin hasil instalasi dari builder
COPY --from=builder /install/packages /usr/local

# Salin kode aplikasi
COPY app/ ./app/

# Expose port FastAPI
EXPOSE 8000

# Jalankan FastAPI via Uvicorn (menggunakan $PORT dari cloud/Render jika ada, default 8000)
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]