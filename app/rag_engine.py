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
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_chroma import Chroma
from langchain_groq import ChatGroq

from langchain_classic.chains import create_retrieval_chain
from langchain_classic.chains.combine_documents import create_stuff_documents_chain
from langchain_core.prompts import ChatPromptTemplate

# Load environment variables (.env)
load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")

# Inisialisasi Vector Store & Embedding Model
PERSIST_DIRECTORY = "./chroma_db"
embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")

# Inisialisasi LLM dari Groq
llm = ChatGroq(
    groq_api_key=GROQ_API_KEY,
    model_name="qwen/qwen3.8-27b",
    temperature=0.2
)

def process_and_store_document(file_path: str):
    """
    Membaca file PDF/TXT/DOCX/CSV, memotongnya menjadi chunks,
    lalu menyimpan vektornya ke ChromaDB.
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

    # Menyimpan ke ChromaDB lokal
    vectorstore = Chroma.from_documents(
        documents=docs,
        embedding=embeddings,
        persist_directory=PERSIST_DIRECTORY
    )
    return len(docs)

def remove_readonly(func, path, exc_info):
    """Mengubah hak akses file read-only agar bisa dihapus oleh sistem."""
    os.chmod(path, stat.S_IWRITE)
    func(path)

def reset_vector_database():
    """
    Menghapus seluruh isi koleksi data di ChromaDB tanpa menghapus folder induknya.
    """
    try:
        # 1. Inisialisasi instance Chroma
        vectorstore = Chroma(
            persist_directory=PERSIST_DIRECTORY,
            embedding_function=embeddings
        )
        
        # 2. Hapus seluruh data vektor lewat Chroma API
        try:
            vectorstore.reset_collection()
        except AttributeError:
            try:
                vectorstore.delete_collection()
            except Exception:
                pass

        # 3. Hapus isi berkas di dalam folder chroma_db (bukan hapus folder induknya)
        if os.path.exists(PERSIST_DIRECTORY):
            for item in os.listdir(PERSIST_DIRECTORY):
                item_path = os.path.join(PERSIST_DIRECTORY, item)
                try:
                    if os.path.isfile(item_path) or os.path.islink(item_path):
                        os.unlink(item_path)
                    elif os.path.isdir(item_path):
                        shutil.rmtree(item_path)
                except Exception:
                    pass  # Abaikan jika ada berkas yang sedang terunci sementara oleh SQLite
                    
        return True
    except Exception as e:
        raise RuntimeError(f"Gagal mengosongkan database: {str(e)}")

def query_knowledge_base(question: str):
    vectorstore = Chroma(
        persist_directory=PERSIST_DIRECTORY,
        embedding_function=embeddings
    )
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
                "page": doc.metadata.get("page", None), # Hanya ada di PDF
                "content_preview": doc.page_content[:200] + "..." # Cuplikan isi chunk
            })

    return {
        "answer": response["answer"],
        "sources": sources
    }