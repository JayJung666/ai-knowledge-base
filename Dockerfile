# Gunakan base image Python 3.12 yang ringan
FROM python:3.12-slim

# Set working directory di dalam container
WORKDIR /app

# Install pustaka sistem yang dibutuhkan
RUN apt-get update && apt-get install -y \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Salin file requirements.txt dan install dependensi Python
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Salin seluruh kode aplikasi ke dalam container
COPY . .

# Expose port 8000 untuk FastAPI
EXPOSE 8000

# Perintah untuk menjalankan FastAPI via Uvicorn
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]