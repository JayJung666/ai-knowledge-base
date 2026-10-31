import os
import shutil
import stat
import gc
from dotenv import load_dotenv
from langchain_community.document_loaders import (
    PyPDFLoader,
    TextLoader,
    Docx2txtLoader,
    CSVLoader
)
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.embeddings import FastEmbedEmbeddings
from langchain_chroma import Chroma
from langchain_groq import ChatGroq
import chromadb

from langchain_classic.chains import create_retrieval_chain
from langchain_classic.chains.combine_documents import create_stuff_documents_chain
from langchain_core.prompts import ChatPromptTemplate

# Load environment variables (.env)
load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")

# Koneksi ke ChromaDB:
# Jika CHROMA_HOST diisi (misal Docker Compose lokal), gunakan HttpClient.
# Jika tidak diisi (misal Render, Hugging Face, Cloud), gunakan PersistentClient in-process.
CHROMA_HOST = os.getenv("CHROMA_HOST", None)
CHROMA_PORT = int(os.getenv("CHROMA_PORT", "8001"))
COLLECTION_NAME = "knowledge_base"

if CHROMA_HOST and CHROMA_HOST.lower() not in ("none", "false", "", "local"):
    try:
        chroma_client = chromadb.HttpClient(host=CHROMA_HOST, port=CHROMA_PORT)
    except Exception:
        chroma_client = chromadb.PersistentClient(path="./chroma_db")
else:
    chroma_client = chromadb.PersistentClient(path="./chroma_db")

# Inisialisasi Embedding Model via FastEmbed (ONNX-based, ultra-ringan ~80MB & gratis)
# Model sentence-transformers/all-MiniLM-L6-v2 hemat memori, ideal untuk limit 512MB RAM di Render Free
cache_path = os.getenv("FASTEMBED_CACHE_PATH", "./fastembed_cache")
embeddings = FastEmbedEmbeddings(
    model_name="sentence-transformers/all-MiniLM-L6-v2",
    cache_dir=cache_path if os.path.exists(cache_path) else None,
)

# Inisialisasi LLM dari Groq
llm = ChatGroq(
    groq_api_key=GROQ_API_KEY,
    model_name="qwen/qwen3.8-27b",
    temperature=0.2
)

def _get_vectorstore() -> Chroma:
    """Membuat instance Chroma yang terhubung ke ChromaDB HTTP service."""
    return Chroma(
        client=chroma_client,
        collection_name=COLLECTION_NAME,
        embedding_function=embeddings,
    )

def process_and_store_document(file_path: str, thread_id: str = "default") -> int:
    """
    Membaca file PDF/TXT/DOCX/CSV, memotongnya menjadi chunks,
    menambahkan metadata thread_id, lalu menyimpan vektornya ke ChromaDB.
    """
    ext = os.path.splitext(file_path)[1].lower()

    if ext == ".pdf":
        loader = PyPDFLoader(file_path)
    elif ext == ".txt":
        loader = TextLoader(file_path, encoding="utf-8")
    elif ext in [".docx", ".doc"]:
        loader = Docx2txtLoader(file_path)
    elif ext == ".csv":
        loader = CSVLoader(file_path)
    else:
        raise ValueError("Format file tidak didukung. Gunakan PDF, TXT, DOCX, atau CSV.")

    documents = loader.load()

    # Memotong dokumen menjadi potongan-potongan teks kecil (chunks)
    text_splitter = RecursiveCharacterTextSplitter(chunk_size=800, chunk_overlap=100)
    docs = text_splitter.split_documents(documents)

    # Kaitkan setiap chunk dengan thread_id agar terisolasi per percakapan
    for doc in docs:
        doc.metadata["thread_id"] = thread_id

    num_chunks = len(docs)

    # Menyimpan ke ChromaDB secara bertahap (mini-batches) untuk mencegah lonjakan RAM di Render Free (512MB)
    vectorstore = _get_vectorstore()
    batch_size = 20
    for i in range(0, num_chunks, batch_size):
        batch = docs[i : i + batch_size]
        vectorstore.add_documents(batch)
        gc.collect()

    del documents
    del docs
    gc.collect()

    return num_chunks

def reset_vector_database() -> bool:
    """
    Menghapus seluruh koleksi di ChromaDB melalui HTTP client.
    """
    try:
        chroma_client.delete_collection(COLLECTION_NAME)
        # Buat ulang koleksi kosong agar siap digunakan kembali
        chroma_client.get_or_create_collection(COLLECTION_NAME)
        gc.collect()
        return True
    except Exception as e:
        raise RuntimeError(f"Gagal mengosongkan database: {str(e)}")

def list_documents(thread_id: str | None = None) -> list[dict]:
    """
    Mengambil daftar file unik yang telah di-ingest ke ChromaDB.
    Jika thread_id diberikan, hanya mengambil dokumen milik thread tersebut.
    Mengembalikan list of dict: { source, filename, chunks, thread_id }
    """
    try:
        collection = chroma_client.get_or_create_collection(COLLECTION_NAME)
        result = collection.get(include=["metadatas"])
        metadatas = result.get("metadatas", [])

        doc_map: dict[str, dict] = {}
        for meta in metadatas:
            if meta:
                doc_thread = meta.get("thread_id", "default")
                if thread_id is not None and doc_thread != thread_id:
                    continue
                src = meta.get("source", "Unknown")
                if src not in doc_map:
                    doc_map[src] = {
                        "source": src,
                        "filename": os.path.basename(src),
                        "chunks": 0,
                        "thread_id": doc_thread,
                    }
                doc_map[src]["chunks"] += 1

        return list(doc_map.values())
    except Exception as e:
        raise RuntimeError(f"Gagal mengambil daftar dokumen: {str(e)}")

def delete_document_by_source(filename: str, thread_id: str | None = None) -> int:
    """
    Menghapus semua chunks milik dokumen tertentu dari ChromaDB berdasarkan nama file
    dan (opsional) thread_id.
    """
    try:
        collection = chroma_client.get_or_create_collection(COLLECTION_NAME)
        result = collection.get(include=["metadatas"])
        metadatas = result.get("metadatas", [])
        ids = result.get("ids", [])

        ids_to_delete = []
        for doc_id, meta in zip(ids, metadatas):
            if meta:
                src = meta.get("source", "")
                doc_thread = meta.get("thread_id", "default")
                if os.path.basename(src) == filename:
                    if thread_id is None or doc_thread == thread_id:
                        ids_to_delete.append(doc_id)

        if not ids_to_delete:
            raise ValueError(f"Dokumen '{filename}' tidak ditemukan di Knowledge Base.")

        collection.delete(ids=ids_to_delete)
        gc.collect()
        return len(ids_to_delete)
    except ValueError:
        raise
    except Exception as e:
        raise RuntimeError(f"Gagal menghapus dokumen '{filename}': {str(e)}")

def delete_thread_documents(thread_id: str) -> int:
    """
    Menghapus semua chunks dokumen yang terafiliasi dengan thread_id tertentu di ChromaDB.
    """
    try:
        collection = chroma_client.get_or_create_collection(COLLECTION_NAME)
        result = collection.get(where={"thread_id": thread_id})
        ids = result.get("ids", [])
        if ids:
            collection.delete(ids=ids)
            gc.collect()
        return len(ids)
    except Exception as e:
        raise RuntimeError(f"Gagal menghapus dokumen untuk thread '{thread_id}': {str(e)}")

def query_knowledge_base(question: str, thread_id: str | None = None) -> dict:
    """
    Mengambil context relevan dari ChromaDB yang terisolasi berdasarkan thread_id
    dan mengirimkannya ke Groq LLM untuk menghasilkan jawaban beserta sumber dokumen.
    """
    collection = chroma_client.get_or_create_collection(COLLECTION_NAME)
    filter_dict = {"thread_id": thread_id} if thread_id else None

    # Jika thread_id dispesifikasikan, periksa apakah thread ini memiliki dokumen
    if filter_dict:
        existing = collection.get(where=filter_dict, limit=1)
        if not existing.get("ids"):
            return {
                "answer": "Belum ada dokumen yang diunggah untuk thread ini. Silakan unggah dokumen di kolom kanan terlebih dahulu agar saya dapat menjawab berdasarkan isi dokumen tersebut.",
                "sources": []
            }

    vectorstore = _get_vectorstore()
    search_kwargs = {"k": 3}
    if filter_dict:
        search_kwargs["filter"] = filter_dict

    retriever = vectorstore.as_retriever(search_kwargs=search_kwargs)

    system_prompt = (
        "Anda adalah asisten AI analitis yang membantu menjawab pertanyaan berdasarkan konteks berikut:\n"
        "{context}\n\n"
        "Jika jawaban tidak ada dalam konteks, katakan bahwa informasi tidak ditemukan dalam dokumen."
    )
    prompt = ChatPromptTemplate.from_messages([
        ("system", system_prompt),
        ("human", "{input}"),
    ])

    question_answer_chain = create_stuff_documents_chain(llm, prompt)
    rag_chain = create_retrieval_chain(retriever, question_answer_chain)

    response = rag_chain.invoke({"input": question})

    # Extract source documents / metadata
    sources = []
    if "context" in response:
        for doc in response["context"]:
            sources.append({
                "source": doc.metadata.get("source", "Unknown"),
                "page": doc.metadata.get("page", None),  # Hanya ada di PDF
                "content_preview": doc.page_content[:200] + "..."  # Cuplikan isi chunk
            })

    return {
        "answer": response["answer"],
        "sources": sources
    }