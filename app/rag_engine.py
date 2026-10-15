import os
import shutil
import stat
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

# Koneksi ke ChromaDB sebagai service terpisah via HTTP client
CHROMA_HOST = os.getenv("CHROMA_HOST", "chromadb")
CHROMA_PORT = int(os.getenv("CHROMA_PORT", "8001"))
COLLECTION_NAME = "knowledge_base"

chroma_client = chromadb.HttpClient(host=CHROMA_HOST, port=CHROMA_PORT)

# Inisialisasi Embedding Model via FastEmbed (ONNX-based, ringan & gratis)
# Model intfloat/multilingual-e5-small akan di-download otomatis saat pertama kali jalan
embeddings = FastEmbedEmbeddings(
    model_name="intfloat/multilingual-e5-small",
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

def process_and_store_document(file_path: str) -> int:
    """
    Membaca file PDF/TXT/DOCX/CSV, memotongnya menjadi chunks,
    lalu menyimpan vektornya ke ChromaDB service.
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

    # Menyimpan ke ChromaDB via HTTP
    vectorstore = _get_vectorstore()
    vectorstore.add_documents(docs)

    return len(docs)

def reset_vector_database() -> bool:
    """
    Menghapus seluruh koleksi di ChromaDB melalui HTTP client.
    """
    try:
        chroma_client.delete_collection(COLLECTION_NAME)
        # Buat ulang koleksi kosong agar siap digunakan kembali
        chroma_client.get_or_create_collection(COLLECTION_NAME)
        return True
    except Exception as e:
        raise RuntimeError(f"Gagal mengosongkan database: {str(e)}")

def list_documents() -> list[dict]:
    """
    Mengambil daftar file unik yang telah di-ingest ke ChromaDB beserta jumlah chunks-nya.
    Mengembalikan list of dict: { source, filename, chunks }
    """
    try:
        collection = chroma_client.get_or_create_collection(COLLECTION_NAME)
        result = collection.get(include=["metadatas"])
        metadatas = result.get("metadatas", [])

        # Agregasi berdasarkan source
        doc_map: dict[str, int] = {}
        for meta in metadatas:
            if meta:
                src = meta.get("source", "Unknown")
                doc_map[src] = doc_map.get(src, 0) + 1

        docs = []
        for src, chunks in doc_map.items():
            filename = os.path.basename(src)
            docs.append({
                "source": src,
                "filename": filename,
                "chunks": chunks
            })
        return docs
    except Exception as e:
        raise RuntimeError(f"Gagal mengambil daftar dokumen: {str(e)}")

def delete_document_by_source(filename: str) -> int:
    """
    Menghapus semua chunks milik dokumen tertentu dari ChromaDB berdasarkan nama file.
    Mengembalikan jumlah chunks yang dihapus.
    """
    try:
        collection = chroma_client.get_or_create_collection(COLLECTION_NAME)
        result = collection.get(include=["metadatas"])
        metadatas = result.get("metadatas", [])
        ids = result.get("ids", [])

        # Cari ID yang memiliki source mengandung nama file
        ids_to_delete = []
        for doc_id, meta in zip(ids, metadatas):
            if meta:
                src = meta.get("source", "")
                if os.path.basename(src) == filename:
                    ids_to_delete.append(doc_id)

        if not ids_to_delete:
            raise ValueError(f"Dokumen '{filename}' tidak ditemukan di Knowledge Base.")

        collection.delete(ids=ids_to_delete)
        return len(ids_to_delete)
    except ValueError:
        raise
    except Exception as e:
        raise RuntimeError(f"Gagal menghapus dokumen '{filename}': {str(e)}")

def query_knowledge_base(question: str) -> dict:
    """
    Mengambil context relevan dari ChromaDB dan mengirimkan ke Groq LLM
    untuk menghasilkan jawaban beserta sumber dokumen.
    """
    vectorstore = _get_vectorstore()
    # Mengambil 3 chunk teratas paling relevan
    retriever = vectorstore.as_retriever(search_kwargs={"k": 3})

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