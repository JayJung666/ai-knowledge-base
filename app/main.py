import shutil
import os
from fastapi import FastAPI, UploadFile, File, HTTPException, status
from pydantic import BaseModel
from app.rag_engine import process_and_store_document, query_knowledge_base, reset_vector_database
from app.tf_classifier import is_valid_query

app = FastAPI(
    title="AI Knowledge Base API",
    description="RAG-based Enterprise Knowledge Base System with FastAPI, LangChain, and Groq LLM",
    version="1.0.0"
)

# Folder temporary untuk upload file
UPLOAD_DIR = "./temp_uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

class QueryRequest(BaseModel):
    question: str

@app.get("/")
def read_root():
    return {"status": "online", "message": "AI Knowledge Base API is running!"}

@app.post("/upload")
async def upload_document(file: UploadFile = File(...)):
    """
    Endpoint untuk mengunggah file (PDF, TXT, DOCX, CSV) dan menyimpannya ke Knowledge Base (ChromaDB).
    """
    allowed_extensions = (".pdf", ".txt", ".docx", ".doc", ".csv")
    if not file.filename.lower().endswith(allowed_extensions):
        raise HTTPException(
            status_code=400,
            detail="Hanya file dengan format PDF, TXT, DOCX, atau CSV yang didukung."
        )

    file_path = os.path.join(UPLOAD_DIR, file.filename)
    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        # Proses dokumen ke ChromaDB
        num_chunks = process_and_store_document(file_path)

        # Hapus file temporary setelah berhasil diproses
        os.remove(file_path)

        return {
            "status": "success",
            "filename": file.filename,
            "processed_chunks": num_chunks,
            "message": "Dokumen berhasil disimpan ke Knowledge Base."
        }
    except Exception as e:
        if os.path.exists(file_path):
            os.remove(file_path)
        raise HTTPException(status_code=500, detail=f"Gagal memproses dokumen: {str(e)}")

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
    Endpoint untuk mengajukan pertanyaan dan mengembalikan jawaban beserta dokumen sumbernya.
    """
    if not is_valid_query(request.question):
        raise HTTPException(status_code=400, detail="Pertanyaan tidak valid atau terlalu pendek.")

    try:
        result = query_knowledge_base(request.question)
        return {
            "question": request.question,
            "answer": result["answer"],
            "sources": result["sources"]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gagal memproses pertanyaan: {str(e)}")