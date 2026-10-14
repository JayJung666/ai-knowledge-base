# 📚 RAG-Based AI Knowledge Base Application

A production-ready Retrieval-Augmented Generation (RAG) Knowledge Base system built using **FastAPI**, **LangChain**, **ChromaDB**, and **Groq LLM**, fully containerized with **Docker Compose**.

This application allows users to upload custom documents in various formats, automatically chunk and embed their content into a vector database, and query the knowledge base using LLMs with full source attribution and transparency.

## ✨ Features

* **Multi-Format Document Ingestion**: Supports `.pdf`, `.docx`, `.csv`, and `.txt` files.

* **Optimized Text Chunking**: Powered by `RecursiveCharacterTextSplitter` with tuned chunk sizes and overlaps for accurate context retrieval.

* **Fast Vector Search**: Utilizes **ChromaDB** with `all-MiniLM-L6-v2` HuggingFace embeddings for efficient semantic retrieval.

* **High-Performance Inference**: Integrated with **Groq LLM** (`qwen/qwen3.8-27b`) for ultra-fast generation.

* **Source Attribution**: Returns direct citation sources (file name, page number, and chunk preview) alongside every answer.

* **Knowledge Base Reset**: Dedicated `/reset-knowledge-base` endpoint to clear persistent storage securely.

* **Containerized Environment**: One-command orchestration via `docker-compose` with live code volume mounting.

## 🏗️ Architecture & Tech Stack

* **Framework**: [FastAPI](https://fastapi.tiangolo.com/)

* **Orchestration**: [LangChain](https://www.langchain.com/)

* **LLM**: [Groq API](https://groq.com/)

* **Embeddings**: [HuggingFace Embeddings](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) (`all-MiniLM-L6-v2`)

* **Vector Database**: [ChromaDB](https://www.trychroma.com/)

* **Containerization**: Docker & Docker Compose

## 📁 Project Structure

```
ai-knowledge-base/
├── app/
│   ├── main.py            # FastAPI application routes & endpoints
│   ├── rag_engine.py      # Core RAG pipeline logic (ingestion, vectorstore, querying)
│   └── temp_uploads/      # Temporary storage for file processing
├── chroma_db/             # Local ChromaDB persistent vector storage
├── Dockerfile             # Docker container configuration
├── docker-compose.yml     # Service orchestration configuration
├── requirements.txt       # Python dependencies
├── .env.example           # Template for environment variables
└── README.md              # Project documentation

```

## 🚀 Getting Started

### Prerequisites

* [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running.

* A [Groq API Key](https://console.groq.com/).

### 1. Clone the Repository

```
git clone https://github.com/YOUR_USERNAME/ai-knowledge-base.git
cd ai-knowledge-base

```

### 2. Set Up Environment Variables

Create a `.env` file in the root directory based on `.env.example`:

```
cp .env.example .env

```

Open `.env` and insert your Groq API key:

```
GROQ_API_KEY=your_actual_groq_api_key_here

```

### 3. Build and Run with Docker Compose

Start the application container in detached mode:

```
docker-compose up -d

```

The server will automatically start at `http://localhost:8000`.

## 📖 API Documentation & Usage

Once the container is running, access the interactive Swagger UI documentation at: 👉 **`http://localhost:8000/docs`**

### Available Endpoints

#### 1. Upload Document (`POST /upload`)

Uploads a document (`.pdf`, `.docx`, `.txt`, or `.csv`) to be processed, chunked, and stored in ChromaDB.

* **Request**: `multipart/form-data` with key `file`.

* **Response Example**:

  ```
  {
    "message": "File 'sample.pdf' berhasil di-ingest.",
    "total_chunks": 12
  }
  
  ```

#### 2. Query Knowledge Base (`POST /query`)

Submits a query to the knowledge base and returns an AI-generated answer along with the source citations used.

* **Request Body**:

  ```
  {
    "question": "What are the requirements listed in the document?"
  }
  
  ```

* **Response Example**:

  ```
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

#### 3. Reset Knowledge Base (`DELETE /reset-knowledge-base`)

Clears all vector data and collections stored inside ChromaDB.

* **Response Example**:

  ```
  {
    "message": "Knowledge base berhasil dikosongkan total."
  }
  
  ```

## 🛠️ Management & Maintenance

* **View Logs**:

  ```
  docker-compose logs -f
  
  ```

* **Stop Containers**:

  ```
  docker-compose down
  
  ```

* 