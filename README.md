# 📚 RAG-Based AI Knowledge Base Application

[![CI Pipeline](https://github.com/JayJung666/ai-knowledge-base/actions/workflows/ci.yml/badge.svg)](https://github.com/JayJung666/ai-knowledge-base/actions/workflows/ci.yml)
[![Version](https://img.shields.io/badge/version-v1.1.0-blue.svg)](https://github.com/JayJung666/ai-knowledge-base/releases)

A production-ready Retrieval-Augmented Generation (RAG) Knowledge Base system built using **FastAPI**, **LangChain**, **ChromaDB**, and **Groq LLM**, fully containerized with **Docker Compose**.

This application allows users to upload custom documents in various formats, automatically chunk and embed their content into a vector database, and query the knowledge base using LLMs with full source attribution and transparency.

## 🌐 Live Deployments

| Component | Platform | URL / Link | Status |
|---|---|---|:---:|
| **Frontend Dashboard** | **Vercel** | [https://vercel.com/jay-jung666/ai-knowledge-base](https://vercel.com/jay-jung666/ai-knowledge-base) | 🟢 Live |
| **Backend API** | **Render** | [https://ai-knowledge-base-naq1.onrender.com/](https://ai-knowledge-base-naq1.onrender.com/) | 🟢 Live |
| **Swagger API Docs** | **Render** | [https://ai-knowledge-base-naq1.onrender.com/docs](https://ai-knowledge-base-naq1.onrender.com/docs) | 🟢 Live |

## ✨ Features

* **Multi-Format Document Ingestion**: Supports `.pdf`, `.docx`, `.csv`, and `.txt` files.

* **Optimized Text Chunking**: Powered by `RecursiveCharacterTextSplitter` with tuned chunk sizes and overlaps for accurate context retrieval.

* **Fast Vector Search**: Utilizes **ChromaDB** with `sentence-transformers/all-MiniLM-L6-v2` via **FastEmbed** (ONNX-based) for efficient local semantic retrieval.

* **High-Performance Inference**: Integrated with **Groq LLM** (`qwen/qwen3.8-27b`) for ultra-fast generation.

* **Source Attribution**: Returns direct citation sources (file name, page number, and chunk preview) alongside every answer.

* **Per-Conversation Document Isolation**: Every conversation ("Obrolan") has its own isolated namespace in ChromaDB. Documents uploaded in one conversation are completely invisible to other conversations — similar to Projects in NotebookLM.

* **3-Column Unified UI**: Single-screen layout with a left sidebar (conversation history), center chat area, and right panel (upload + document list). No tab switching required.

* **Conversation Management**: Create, rename, delete, and search conversations. Each conversation title is auto-generated from the first message sent.

* **Knowledge Base Reset**: Dedicated `/reset-knowledge-base` endpoint to clear persistent storage securely.

* **Lightweight Containerized Environment**: Decomposed multi-service Docker Compose setup with multi-stage builds for minimal image size.

## 🏗️ Architecture & Tech Stack

```
┌─────────────────────────────────────────────────────────┐
│                    docker-compose                       │
│                                                         │
│  ┌─────────────────────┐     ┌──────────────────────┐  │
│  │   api (FastAPI)     │────▶│  chromadb (official) │  │
│  │   port: 8000        │     │  port: 8001 (host)   │  │
│  │   ~150–200 MB       │     │  ~100–200 MB         │  │
│  └─────────────────────┘     └──────────────────────┘  │
│                                        │                │
│                              ┌─────────▼─────────┐     │
│                              │   chroma_data      │     │
│                              │   (Docker Volume)  │     │
│                              └────────────────────┘     │
└─────────────────────────────────────────────────────────┘
```

* **Framework**: [FastAPI](https://fastapi.tiangolo.com/)
* **Orchestration**: [LangChain](https://www.langchain.com/)
* **LLM**: [Groq API](https://groq.com/) — `qwen/qwen3.8-27b`
* **Embeddings**: [FastEmbed](https://github.com/qdrant/fastembed) — `sentence-transformers/all-MiniLM-L6-v2` (ONNX-based, 100% lokal & gratis, tanpa PyTorch)
* **Vector Database**: [ChromaDB](https://www.trychroma.com/) — deployed as isolated HTTP service
* **Containerization**: Docker & Docker Compose (multi-stage build)

## 🐳 Docker Decomposition

Image sebelumnya monolitik (~2.5–3 GB). Setelah refaktor:

| Service | Image | Ukuran Estimasi | Perubahan |
|---|---|---|---|
| `api` | Custom build (multi-stage) | **~150–200 MB** | ✅ Tanpa `torch`, `tensorflow`, `sentence-transformers` |
| `chromadb` | `chromadb/chroma:latest` | ~100–200 MB | ✅ Official image, persistent volume terpisah |

**Yang dihapus dari `api` image:**
- `tensorflow-cpu` (~400–600 MB) — diganti pure Python validator
- `torch` + `sentence-transformers` (~800 MB–1.5 GB) — diganti `fastembed` berbasis ONNX (~130 MB)
- `psycopg2-binary` — tidak ada PostgreSQL
- Build tools (`build-essential`) — tidak dibawa ke runtime stage

## 📁 Project Structure

```
ai-knowledge-base/
├── app/
│   ├── main.py            # FastAPI routes & endpoints (CORS via env var, thread_id support)
│   ├── rag_engine.py      # Core RAG pipeline (ChromaDB HTTP client, per-thread namespace)
│   └── tf_classifier.py   # Query validator (pure Python, tanpa TensorFlow)
├── frontend/              # React + Vite + Vanilla CSS
│   ├── src/App.tsx        # UI utama — 3-column single screen layout
│   ├── vercel.json        # Config SPA routing untuk Vercel
│   └── .env.example       # Template env frontend
├── Dockerfile             # Multi-stage Docker build (backend only)
├── docker-compose.yml     # 2-service orchestration (api + chromadb)
├── requirements.txt       # Python dependencies (ringan, tanpa TF)
├── .env.example           # Template environment variables backend
└── README.md
```

## 🚀 Getting Started

### Prerequisites

* [Docker Desktop](https://www.docker.com/products/docker-desktop/) (lokal) atau VM cloud dengan Docker.
* [Groq API Key](https://console.groq.com/) — gratis.

### 1. Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/ai-knowledge-base.git
cd ai-knowledge-base
```

### 2. Set Up Environment Variables

```bash
cp .env.example .env
```

Isi `.env`:

```env
GROQ_API_KEY=your_actual_groq_api_key_here
CORS_ORIGINS=https://your-app.vercel.app
```

### 3. Build and Run Backend

```bash
docker-compose up -d --build
```

| Service | URL |
|---|---|
| FastAPI API | http://localhost:8000 |
| Swagger UI | http://localhost:8000/docs |
| ChromaDB (debug) | http://localhost:8001 |

---

## ☁️ Frontend Deployment (Vercel)

Frontend (React + Vite) di-deploy ke **Vercel**, backend tetap berjalan di server via Docker.

```
Browser ──▶ Vercel (React) ──▶ Server Kamu (FastAPI + ChromaDB)
```

### Langkah Deploy ke Vercel

**1. Import project ke Vercel**

- Buka [vercel.com](https://vercel.com) → **Add New Project** → import repo GitHub kamu
- Atur konfigurasi project:

| Setting | Value |
|---|---|
| **Root Directory** | `frontend` |
| **Framework Preset** | `Vite` |
| **Build Command** | `npm run build` |
| **Output Directory** | `dist` |

**2. Set Environment Variable**

Di Vercel Dashboard → **Settings → Environment Variables**:

| Key | Value |
|---|---|
| `VITE_API_URL` | URL publik backend kamu, misal `https://api.yourdomain.com` |

> ⚠️ Backend harus bisa diakses dari internet. Gunakan IP publik atau domain, bukan `localhost`.

**3. Update CORS di backend**

Setelah dapat URL Vercel (misal `https://my-kb.vercel.app`), update `.env` di server:

```env
CORS_ORIGINS=https://my-kb.vercel.app
```

Restart API:
```bash
docker-compose restart api
```

**4. Deploy**

Push ke branch `main` — Vercel akan otomatis build dan deploy.

---

## 📖 API Documentation & Usage


### Available Endpoints

#### 1. `POST /upload` — Upload Document (Isolated per Conversation)

Uploads a document to be processed, chunked, and stored in ChromaDB under the conversation's namespace.

* **Request**: `multipart/form-data` with keys `file` and `thread_id`

* **Response Example**:
  ```json
  {
    "status": "success",
    "filename": "sample.pdf",
    "processed_chunks": 12,
    "message": "Dokumen berhasil disimpan ke Knowledge Base."
  }
  ```

#### 2. `POST /query` — Query Knowledge Base (Isolated per Conversation)

Submits a question and returns an AI-generated answer with source citations, scoped to the given conversation's documents.

* **Request Body**:
  ```json
  {
    "question": "What are the requirements listed in the document?",
    "thread_id": "thread-1234567890"
  }
  ```

* **Response Example**:
  ```json
  {
    "question": "What are the requirements listed in the document?",
    "answer": "Based on the uploaded document, applicants must have a minimum GPA of 3.50...",
    "sources": [
      {
        "source": "./temp_uploads/sample.pdf",
        "page": 0,
        "content_preview": "Qualifications: 1. Bachelor degree in CS. 2. Minimum GPA 3.50..."
      }
    ]
  }
  ```

#### 3. `GET /documents` — List Documents for a Conversation

Returns the list of documents stored in a specific conversation's namespace.

* **Query Param**: `?thread_id=thread-1234567890`

#### 4. `DELETE /documents/{filename}` — Delete a Document from a Conversation

* **Query Param**: `?thread_id=thread-1234567890`

#### 5. `DELETE /threads/{thread_id}/documents` — Delete All Documents for a Conversation

Clears all documents belonging to a specific conversation namespace from ChromaDB.

#### 6. `DELETE /reset-knowledge-base` — Reset Entire Knowledge Base

Clears **all** vector data from ChromaDB (all conversations).

* **Response Example**:
  ```json
  {
    "status": "success",
    "message": "Knowledge base berhasil dikosongkan total."
  }
  ```

## 🛠️ Management & Maintenance

```bash
# Lihat log semua service
docker-compose logs -f

# Lihat log service tertentu
docker-compose logs -f api
docker-compose logs -f chromadb

# Stop semua container
docker-compose down

# Stop dan hapus volume (reset total data ChromaDB)
docker-compose down -v

# Rebuild hanya API image
docker-compose build api
docker-compose up -d api
```

## 🔧 Environment Variables

| Variable | Default | Keterangan |
|---|---|---|
| `GROQ_API_KEY` | — | **Wajib.** API key dari [console.groq.com](https://console.groq.com) |
| `CHROMA_HOST` | `chromadb` | Hostname service ChromaDB (nama service di Compose) |
| `CHROMA_PORT` | `8000` | Port internal ChromaDB (di dalam Docker network) |
| `CORS_ORIGINS` | `*` | Daftar origin yang diizinkan, pisahkan dengan koma |
| `VITE_API_URL` | `http://localhost:8000` | URL backend untuk frontend (set di Vercel dashboard) |

---

## 🚀 Cloud Deployment

### 1. Frontend (Vercel)
* **Project Dashboard:** [https://vercel.com/jay-jung666/ai-knowledge-base](https://vercel.com/jay-jung666/ai-knowledge-base)
* **Framework:** Vite + React
* **Root Directory:** `frontend`
* **Environment Variable:**
  ```env
  VITE_API_URL=https://ai-knowledge-base-naq1.onrender.com
  ```

### 2. Backend (Render)
* **Live Service:** [https://ai-knowledge-base-naq1.onrender.com/](https://ai-knowledge-base-naq1.onrender.com/)
* **Interactive Docs:** [https://ai-knowledge-base-naq1.onrender.com/docs](https://ai-knowledge-base-naq1.onrender.com/docs)
* **Runtime:** Docker (Multi-stage build)
* **Vector Store:** ChromaDB (Persistent in-process)
* **Environment Variables:**
  * `GROQ_API_KEY`: API Key Groq
  * `CORS_ORIGINS`: `*`

---

## 🔄 CI/CD Pipeline (GitHub Actions)

Proyek ini telah dilengkapi dengan pipeline otomatis **Continuous Integration & Continuous Deployment**:

```
[ Git Push / PR ] 
       │
       ▼
┌────────────────────────────────────────────────────────┐
│             GitHub Actions CI Pipeline                 │
├───────────────────────────┬────────────────────────────┤
│   Backend CI (Python)     │   Frontend CI (Node.js)    │
│   • Python 3.12 Setup     │   • Node 20 Setup          │
│   • pip dependencies      │   • npm dependencies       │
│   • Pytest Unit Tests     │   • oxlint Linting         │
│   • API Health Check      │   • TypeScript & Vite      │
│   • Query Validation Test │     Production Build       │
└─────────────┬─────────────┴─────────────┬──────────────┘
              │ (All Tests Pass)          │
              ▼                           ▼
       [ Render.com CD ]          [ Vercel Edge CD ]
   Docker Build & Auto-Deploy    Production Static Deploy
```

1. **Continuous Integration (CI):**
   * Dijalankan otomatis di setiap `push` dan `pull_request` ke branch `main`.
   * Memvalidasi kode backend (tes endpoint, validasi query, upload format) dan frontend (linting & validasi tipe TypeScript).
2. **Continuous Deployment (CD):**
   * **Vercel** langsung merilis versi frontend terbaru setelah push.
   * **Render** otomatis mem-build image Docker dan me-restart container backend.

---

## 🖥️ Alternative: Backend Deployment (Oracle Cloud Always Free)

Untuk deployment **gratis selamanya**, gunakan Oracle Cloud Always Free:

### Spesifikasi Gratis

| Resource | Jumlah |
|---|---|
| **CPU** | 4 OCPUs (Ampere A1) |
| **RAM** | 24 GB |
| **Storage** | 200 GB |
| **Bandwidth** | 10 TB/bulan |
| **Biaya** | **$0 selamanya** |

### Langkah Deploy

**1. Daftar di [cloud.oracle.com](https://cloud.oracle.com)**

Pilih **Always Free** tier — tidak perlu kartu kredit untuk resource Always Free.

**2. Buat VM Instance**

- Shape: `VM.Standard.A1.Flex` (Ampere A1)
- OCPU: 1 (cukup untuk app ini)
- RAM: 6 GB
- OS: Ubuntu 22.04 atau Oracle Linux
- Buka port **8000** di Security List

**3. Install Docker di VM**

```bash
# SSH ke VM
ssh -i your-key.pem ubuntu@<PUBLIC_IP>

# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker

# Install Docker Compose
sudo apt install docker-compose-plugin -y
```

**4. Clone dan Jalankan**

```bash
git clone https://github.com/YOUR_USERNAME/ai-knowledge-base.git
cd ai-knowledge-base
cp .env.example .env
# Edit .env dengan nano/vim: isi GROQ_API_KEY dan CORS_ORIGINS
nano .env

docker compose up -d --build
```

**5. Set VITE_API_URL di Vercel**

Di Vercel Dashboard → Environment Variables:

```
VITE_API_URL=http://<ORACLE_VM_PUBLIC_IP>:8000
```

**6. Set CORS di `.env` server**

```env
CORS_ORIGINS=https://your-app.vercel.app
```

```bash
docker compose restart api
```