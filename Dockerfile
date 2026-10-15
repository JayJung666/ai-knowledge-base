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

# Set environment variable untuk cache model FastEmbed di dalam image
ENV FASTEMBED_CACHE_PATH=/app/fastembed_cache

# Salin kode aplikasi
COPY app/ ./app/

# Pre-download embedding model saat docker build (memanfaatkan build-time RAM)
# sehingga saat runtime di Render (limit 512MB) TIDAK ada proses download/ekstraksi yang memicu OOM
RUN python -c "from fastembed import TextEmbedding; TextEmbedding(model_name='sentence-transformers/all-MiniLM-L6-v2', cache_dir='/app/fastembed_cache')"

# Expose port FastAPI
EXPOSE 8000

# Jalankan FastAPI via Uvicorn (menggunakan $PORT dari cloud/Render jika ada, default 8000)
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]