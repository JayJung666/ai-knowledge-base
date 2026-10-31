import shutil
import os
from fastapi import FastAPI, UploadFile, File, Form, Query, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from app.rag_engine import (
    process_and_store_document,
    query_knowledge_base,
    reset_vector_database,
    list_documents,
    delete_document_by_source,
    delete_thread_documents,
)
from app.tf_classifier import is_valid_query

load_dotenv()

app = FastAPI(
    title="AI Knowledge Base API",
    description="RAG-based Enterprise Knowledge Base System with FastAPI, LangChain, and Groq LLM",
    version="1.0.0"
)

# CORS: baca dari env var, fallback ke wildcard untuk dev lokal
# Contoh: CORS_ORIGINS=https://your-app.vercel.app,https://yourdomain.com
_cors_env = os.getenv("CORS_ORIGINS", "*")
allowed_origins: list[str] = [o.strip() for o in _cors_env.split(",")] if _cors_env != "*" else ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Folder temporary untuk upload file
UPLOAD_DIR = "./temp_uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Batasan resource untuk memastikan keandalan di lingkungan Render Free Tier (512 MB RAM)
MAX_FILE_SIZE_MB = int(os.getenv("MAX_FILE_SIZE_MB", "5"))
MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024
MAX_DOCS_PER_THREAD = int(os.getenv("MAX_DOCS_PER_THREAD", "10"))

class QueryRequest(BaseModel):
    question: str
    thread_id: str | None = "default"

@app.get("/")
def read_root():
    return {"status": "online", "message": "AI Knowledge Base API is running!"}

@app.post("/upload")
async def upload_document(
    file: UploadFile = File(...),
    thread_id: str = Form("default")
):
    """
    Endpoint untuk mengunggah file (PDF, TXT, DOCX, CSV) dan menyimpannya ke Knowledge Base (ChromaDB)
    terisolasi per thread_id dengan proteksi batas ukuran file dan kuota dokumen.
    """
    allowed_extensions = (".pdf", ".txt", ".docx", ".doc", ".csv")
    if not file.filename.lower().endswith(allowed_extensions):
        raise HTTPException(
            status_code=400,
            detail="Hanya file dengan format PDF, TXT, DOCX, atau CSV yang didukung."
        )

    # Validasi kuota dokumen per thread
    current_docs = list_documents(thread_id=thread_id)
    existing_filenames = [d.get("filename") for d in current_docs]
    if file.filename not in existing_filenames and len(current_docs) >= MAX_DOCS_PER_THREAD:
        raise HTTPException(
            status_code=400,
            detail=f"Batas dokumen tercapai ({MAX_DOCS_PER_THREAD} dokumen untuk obrolan '{thread_id}'). Silakan hapus dokumen lama sebelum mengunggah yang baru."
        )

    file_path = os.path.join(UPLOAD_DIR, file.filename)
    chunk_size = 1024 * 1024  # 1 MB chunk buffer
    total_bytes = 0

    try:
        with open(file_path, "wb") as buffer:
            while chunk := await file.read(chunk_size):
                total_bytes += len(chunk)
                if total_bytes > MAX_FILE_SIZE_BYTES:
                    buffer.close()
                    if os.path.exists(file_path):
                        os.remove(file_path)
                    raise HTTPException(
                        status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                        detail=f"Ukuran file '{file.filename}' melebihi batas maksimal ({MAX_FILE_SIZE_MB} MB). Silakan unggah dokumen yang lebih kecil."
                    )
                buffer.write(chunk)

        # Proses dokumen ke ChromaDB dengan thread_id
        num_chunks = process_and_store_document(file_path, thread_id=thread_id)

        # Hapus file temporary setelah berhasil diproses
        if os.path.exists(file_path):
            os.remove(file_path)

        return {
            "status": "success",
            "filename": file.filename,
            "thread_id": thread_id,
            "processed_chunks": num_chunks,
            "message": f"Dokumen berhasil disimpan ke Knowledge Base untuk thread '{thread_id}'."
        }
    except HTTPException:
        raise
    except Exception as e:
        if os.path.exists(file_path):
            os.remove(file_path)
        raise HTTPException(status_code=500, detail=f"Gagal memproses dokumen: {str(e)}")

@app.get("/documents")
def get_documents(thread_id: str | None = Query(None)):
    """
    Endpoint untuk mengambil daftar dokumen yang telah di-ingest ke ChromaDB.
    Jika thread_id disertakan, hanya mengambil dokumen untuk thread tersebut.
    """
    try:
        docs = list_documents(thread_id=thread_id)
        return {
            "status": "success",
            "thread_id": thread_id,
            "documents": docs,
            "total": len(docs)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gagal mengambil daftar dokumen: {str(e)}")

@app.delete("/documents/{filename}", status_code=status.HTTP_200_OK)
def delete_document(filename: str, thread_id: str | None = Query(None)):
    """
    Endpoint untuk menghapus semua chunks dari dokumen tertentu di ChromaDB
    berdasarkan nama file dan thread_id.
    """
    try:
        deleted_count = delete_document_by_source(filename, thread_id=thread_id)
        return {
            "status": "success",
            "filename": filename,
            "thread_id": thread_id,
            "deleted_chunks": deleted_count,
            "message": f"Dokumen '{filename}' berhasil dihapus dari Knowledge Base ({deleted_count} chunks)."
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/threads/{thread_id}/documents", status_code=status.HTTP_200_OK)
def delete_thread_docs(thread_id: str):
    """
    Endpoint untuk membersihkan semua dokumen milik sebuah thread saat thread dihapus.
    """
    try:
        deleted_count = delete_thread_documents(thread_id)
        return {
            "status": "success",
            "thread_id": thread_id,
            "deleted_chunks": deleted_count,
            "message": f"Semua dokumen untuk thread '{thread_id}' berhasil dibersihkan ({deleted_count} chunks)."
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/reset-knowledge-base", status_code=status.HTTP_200_OK)
def reset_knowledge_base():
    """
    Endpoint untuk menghapus seluruh koleksi dan data di ChromaDB.
    """
    try:
        reset_vector_database()
        return {
            "status": "success",
            "message": "Knowledge base berhasil dikosongkan total."
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/query")
def ask_question(request: QueryRequest):
    """
    Endpoint untuk mengajukan pertanyaan terisolasi per thread dan mengembalikan jawaban beserta sumbernya.
    """
    if not is_valid_query(request.question):
        raise HTTPException(status_code=400, detail="Pertanyaan tidak valid atau terlalu pendek.")

    try:
        result = query_knowledge_base(request.question, thread_id=request.thread_id)
        return {
            "question": request.question,
            "thread_id": request.thread_id,
            "answer": result["answer"],
            "sources": result["sources"]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gagal memproses pertanyaan: {str(e)}")