import React, { useState } from "react";
import {
  Upload,
  Database,
  MessageSquare,
  Trash2,
  FileText,
  Send,
  Sparkles,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

interface Source {
  source: string;
  page?: number | null;
  content_preview: string;
}

export default function App() {
  const [apiUrl, setApiUrl] = useState(
    import.meta.env.VITE_API_URL || "http://localhost:8000"
  );
  const [file, setFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<{
    type: "success" | "error" | "loading" | null;
    message: string;
  }>({ type: null, message: "" });

  const [question, setQuestion] = useState("");
  const [loadingQuery, setLoadingQuery] = useState(false);
  const [chatHistory, setChatHistory] = useState<
    Array<{ question: string; answer: string; sources: Source[] }>
  >([]);

  const [expandedSource, setExpandedSource] = useState<number | null>(null);

  // Handle File Upload
  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    setUploadStatus({
      type: "loading",
      message: "Memproses dan memasukkan dokumen ke ChromaDB...",
    });
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`${apiUrl}/upload`, {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (res.ok) {
        setUploadStatus({
          type: "success",
          message: data.message || "Dokumen berhasil diunggah!",
        });
        setFile(null);
      } else {
        // Menampilkan pesan detail dari FastAPI jika status 500
        setUploadStatus({
          type: "error",
          message: `Error (${res.status}): ${
            data.detail || "Gagal memproses dokumen di server."
          }`,
        });
      }
    } catch (err) {
      setUploadStatus({
        type: "error",
        message: "Gagal terhubung ke backend FastAPI.",
      });
    }
  };

  // Handle Query
  const handleQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim()) return;

    const currentQuestion = question;
    setQuestion("");
    setLoadingQuery(true);

    try {
      const res = await fetch(`${apiUrl}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: currentQuestion }),
      });

      const data = await res.json();

      if (res.ok) {
        setChatHistory((prev) => [
          ...prev,
          {
            question: currentQuestion,
            answer: data.answer,
            sources: data.sources || [],
          },
        ]);
      } else {
        setChatHistory((prev) => [
          ...prev,
          {
            question: currentQuestion,
            answer: `Error: ${data.detail}`,
            sources: [],
          },
        ]);
      }
    } catch (err) {
      setChatHistory((prev) => [
        ...prev,
        {
          question: currentQuestion,
          answer: "Gagal terhubung ke server FastAPI.",
          sources: [],
        },
      ]);
    } finally {
      setLoadingQuery(false);
    }
  };

  // Handle Reset DB
  const handleReset = async () => {
    if (
      !window.confirm(
        "Apakah Anda yakin ingin mengosongkan seluruh Knowledge Base?"
      )
    )
      return;

    try {
      const res = await fetch(`${apiUrl}/reset-knowledge-base`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (res.ok) {
        alert("Database ChromaDB berhasil dikosongkan!");
        setChatHistory([]);
      } else {
        alert(`Gagal: ${data.detail}`);
      }
    } catch (err) {
      alert("Gagal menghubungi server.");
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans">
      {/* Top Header */}
      <header className="border-b border-slate-800 bg-slate-950/50 backdrop-blur px-6 py-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-600 rounded-lg shadow-lg shadow-indigo-500/30">
            <Sparkles className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">
              RAG AI Knowledge Base
            </h1>
            <p className="text-xs text-slate-400">
              FastAPI + ChromaDB + Groq LLM
            </p>
          </div>
        </div>

        <button
          onClick={handleReset}
          className="flex items-center gap-2 px-3 py-2 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 border border-rose-500/20 rounded-lg text-sm font-medium transition"
        >
          <Trash2 className="w-4 h-4" />
          Reset DB
        </button>
      </header>

      {/* Main Layout */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 p-6 max-w-7xl mx-auto w-full">
        {/* Left Sidebar - Document Ingestion */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5 backdrop-blur">
            <h2 className="text-base font-semibold flex items-center gap-2 mb-4 text-indigo-400">
              <Upload className="w-5 h-5" />
              Unggah Dokumen
            </h2>

            <form onSubmit={handleUpload} className="space-y-4">
              <div className="border-2 border-dashed border-slate-700 hover:border-indigo-500/50 rounded-xl p-6 text-center transition bg-slate-900/40">
                <FileText className="w-10 h-10 mx-auto text-slate-500 mb-2" />
                <label className="block text-sm text-slate-300 font-medium cursor-pointer">
                  <span className="text-indigo-400 hover:underline">
                    Pilih file
                  </span>{" "}
                  atau seret ke sini
                  <input
                    type="file"
                    className="hidden"
                    accept=".pdf,.docx,.doc,.txt,.csv"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                  />
                </label>
                <p className="text-xs text-slate-500 mt-1">
                  PDF, DOCX, TXT, CSV
                </p>
                {file && (
                  <div className="mt-3 p-2 bg-indigo-500/10 border border-indigo-500/20 rounded text-xs text-indigo-300 font-mono truncate">
                    {file.name}
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={!file || uploadStatus.type === "loading"}
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:hover:bg-indigo-600 text-white font-medium rounded-lg text-sm transition shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-2"
              >
                {uploadStatus.type === "loading" ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" /> Memproses...
                  </>
                ) : (
                  "Ingest ke Vector Store"
                )}
              </button>
            </form>

            {/* Upload Feedback */}
            {uploadStatus.type && (
              <div
                className={`mt-4 p-3 rounded-lg text-xs flex items-start gap-2 ${
                  uploadStatus.type === "success"
                    ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
                    : uploadStatus.type === "error"
                    ? "bg-rose-500/10 border border-rose-500/20 text-rose-400"
                    : "bg-indigo-500/10 border border-indigo-500/20 text-indigo-300"
                }`}
              >
                {uploadStatus.type === "success" && (
                  <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
                )}
                {uploadStatus.type === "error" && (
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                )}
                <span>{uploadStatus.message}</span>
              </div>
            )}
          </div>
        </div>

        {/* Right Area - Chat & QnA */}
        <div className="lg:col-span-8 flex flex-col bg-slate-800/50 border border-slate-700/50 rounded-xl overflow-hidden backdrop-blur h-[650px]">
          {/* Chat Messages */}
          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            {chatHistory.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500 space-y-3">
                <MessageSquare className="w-12 h-12 stroke-[1.5] text-slate-600" />
                <div>
                  <p className="font-medium text-slate-400">
                    Belum ada percakapan
                  </p>
                  <p className="text-xs">
                    Unggah dokumen di sebelah kiri dan mulailah mengajukan
                    pertanyaan.
                  </p>
                </div>
              </div>
            ) : (
              chatHistory.map((item, idx) => (
                <div key={idx} className="space-y-3">
                  {/* Question */}
                  <div className="flex justify-end">
                    <div className="bg-indigo-600 text-white rounded-2xl rounded-tr-none px-4 py-2.5 max-w-[80%] text-sm">
                      {item.question}
                    </div>
                  </div>

                  {/* Answer */}
                  <div className="flex justify-start">
                    <div className="bg-slate-900 border border-slate-700/60 text-slate-200 rounded-2xl rounded-tl-none p-4 max-w-[90%] space-y-3 text-sm leading-relaxed">
                      <p className="whitespace-pre-wrap">{item.answer}</p>

                      {/* Sources Accordion */}
                      {item.sources && item.sources.length > 0 && (
                        <div className="pt-3 border-t border-slate-800 space-y-2">
                          <button
                            onClick={() =>
                              setExpandedSource(
                                expandedSource === idx ? null : idx
                              )
                            }
                            className="flex items-center justify-between w-full text-xs text-indigo-400 hover:text-indigo-300 font-medium"
                          >
                            <span>
                              📄 Dokumen Sumber ({item.sources.length})
                            </span>
                            {expandedSource === idx ? (
                              <ChevronUp className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronDown className="w-3.5 h-3.5" />
                            )}
                          </button>

                          {expandedSource === idx && (
                            <div className="space-y-2 pt-1">
                              {item.sources.map((src, sIdx) => (
                                <div
                                  key={sIdx}
                                  className="p-2.5 bg-slate-950/60 rounded border border-slate-800/80 text-xs font-mono space-y-1"
                                >
                                  <div className="flex justify-between text-indigo-300 font-semibold">
                                    <span className="truncate">
                                      {src.source}
                                    </span>
                                    {src.page !== null &&
                                      src.page !== undefined && (
                                        <span>Hal. {src.page + 1}</span>
                                      )}
                                  </div>
                                  <p className="text-slate-400 font-sans text-[11px] leading-normal">
                                    {src.content_preview}
                                  </p>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}

            {loadingQuery && (
              <div className="flex justify-start">
                <div className="bg-slate-900 border border-slate-700/60 text-slate-400 rounded-2xl rounded-tl-none px-4 py-3 text-sm flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-indigo-400" />
                  Mencari jawaban dari Groq LLM...
                </div>
              </div>
            )}
          </div>

          {/* Chat Input */}
          <form
            onSubmit={handleQuery}
            className="p-4 border-t border-slate-700/50 bg-slate-900/60 flex gap-2"
          >
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Tanyakan sesuatu tentang dokumen yang telah diunggah..."
              className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-indigo-500 text-slate-100 placeholder-slate-500"
            />
            <button
              type="submit"
              disabled={!question.trim() || loadingQuery}
              className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg transition flex items-center justify-center shadow-lg shadow-indigo-600/20"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
