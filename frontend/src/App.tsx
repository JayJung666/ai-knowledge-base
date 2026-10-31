import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import {
  Database, Upload, MessageSquare, Settings, Trash2, FileText,
  CheckCircle, Layers, ChevronDown, ChevronRight,
  Send, Sparkles, HardDrive, Moon, Sun, X, File,
  Server, Zap, Check, Link2, RefreshCw, FilePlus2, Loader2,
  Plus, Search, PanelLeftClose, PanelLeft, PanelRightClose, PanelRight,
  Copy, RotateCcw, FolderLock, Pencil,
} from 'lucide-react';

marked.setOptions({
  gfm: true,
  breaks: true,
});

interface Source {
  source: string;
  page?: number | null;
  content_preview: string;
}

interface ChatMessage {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  timestamp: string;
  sources?: Source[];
}

interface Thread {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

interface KBDocument {
  source: string;
  filename: string;
  chunks: number;
  thread_id?: string;
}

interface UploadQueueItem {
  file: File;
  status: 'pending' | 'uploading' | 'done' | 'error';
  progress: number;
  chunks?: number;
  error?: string;
}


function formatBytes(b: number) {
  if (!b) return '0 B';
  const k = 1024;
  const s = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return `${+(b / Math.pow(k, i)).toFixed(2)} ${s[i]}`;
}

// Batasan resource untuk memastikan stabilitas di Render Free Tier (512 MB RAM)
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB per file
const MAX_QUEUE_ITEMS = 5; // Maks 5 file per batch upload
const MAX_DOCS_PER_THREAD = 10; // Maks 10 dokumen per thread
const MAX_QUEUE_TOTAL_BYTES = 15 * 1024 * 1024; // 15 MB akumulasi antrean

const DEFAULT_WELCOME_MSG: ChatMessage = {
  id: 'welcome-msg',
  sender: 'ai',
  text: 'Halo! Saya asisten **RAG AI Knowledge Base**.\n\nDokumen yang diunggah di kolom kanan **terisolasi khusus untuk obrolan ini**. Silakan unggah dokumen atau ajukan pertanyaan seputar isi dokumen Anda.',
  timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  sources: [],
};

export default function App() {
  const [baseUrl, setBaseUrl] = useState(() => (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/+$/, ''));
  const [mockMode, setMockMode] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [apiConnected, setApiConnected] = useState(false);
  const [kbDocs, setKbDocs] = useState<KBDocument[]>([]);
  const [statsLoading, setStatsLoading] = useState(false);
  const [docSearchQuery, setDocSearchQuery] = useState('');

  // Resizable right sidebar
  const [rightSidebarWidth, setRightSidebarWidth] = useState(320);
  const isResizing = useRef(false);

  // Sidebar visibility toggles
  const [showLeftSidebar, setShowLeftSidebar] = useState(true);
  const [showRightSidebar, setShowRightSidebar] = useState(true);

  // Threads Management
  const [threads, setThreads] = useState<Thread[]>(() => {
    try {
      const saved = localStorage.getItem('rag_chat_threads');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // fallback
    }
    return [{
      id: 'thread-' + Date.now(),
      title: 'Percakapan Pertama',
      createdAt: new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }),
      updatedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      messages: [DEFAULT_WELCOME_MSG],
    }];
  });

  const [activeThreadId, setActiveThreadId] = useState<string>(() => threads[0]?.id || 'thread-1');
  const [threadSearch, setThreadSearch] = useState('');
  const [inputQuery, setInputQuery] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // File Upload State
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [deletingFile, setDeletingFile] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Store mock documents per thread in memory
  const [allMockDocs, setAllMockDocs] = useState<KBDocument[]>([]);

  // Rename state
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  // addLog is kept as a no-op (log panel removed from UI)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const addLog = useCallback((_msg: string, _type?: string) => {}, []);

  const handleStartRename = (thread: Thread, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditingThreadId(thread.id);
    setEditingTitle(thread.title);
  };

  const handleSaveRename = (threadId: string, e?: React.MouseEvent | React.FormEvent) => {
    e?.stopPropagation();
    e?.preventDefault();
    const clean = editingTitle.trim();
    if (clean) {
      setThreads(prev => prev.map(t => t.id === threadId ? { ...t, title: clean } : t));
      addLog(`Nama obrolan diubah menjadi "${clean}".`, 'info');
    }
    setEditingThreadId(null);
    setEditingTitle('');
  };

  const handleCancelRename = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditingThreadId(null);
    setEditingTitle('');
  };

  // Save threads to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('rag_chat_threads', JSON.stringify(threads));
    } catch {
      // ignore
    }
  }, [threads]);

  // Current active thread
  const activeThread = useMemo(() => {
    return threads.find(t => t.id === activeThreadId) || threads[0] || null;
  }, [threads, activeThreadId]);

  const totalChunks = kbDocs.reduce((s, d) => s + d.chunks, 0);

  // Health check
  useEffect(() => {
    const check = async () => {
      if (mockMode) {
        setApiConnected(true);
        return;
      }
      try {
        const c = new AbortController();
        const t = setTimeout(() => c.abort(), 2500);
        const r = await fetch(`${baseUrl}/docs`, { signal: c.signal });
        clearTimeout(t);
        setApiConnected(r.ok || r.status === 200);
      } catch {
        setApiConnected(false);
      }
    };
    check();
    const iv = setInterval(check, 10000);
    return () => clearInterval(iv);
  }, [baseUrl, mockMode]);

  // Fetch documents list from ChromaDB for the active thread
  const fetchDocuments = useCallback(async (targetThreadId?: string) => {
    const tid = targetThreadId || activeThreadId;
    if (!tid) return;

    if (mockMode) {
      setKbDocs(allMockDocs.filter(d => d.thread_id === tid));
      return;
    }

    setStatsLoading(true);
    try {
      const r = await fetch(`${baseUrl}/documents?thread_id=${encodeURIComponent(tid)}`);
      if (r.ok) {
        const d = await r.json();
        setKbDocs(d.documents || []);
        addLog(`GET /documents (thread: ${tid}) - ${d.total} dokumen dimuat.`, 'success');
      }
    } catch {
      addLog(`GET /documents (thread: ${tid}) - Gagal terhubung ke ChromaDB.`, 'error');
    } finally {
      setStatsLoading(false);
    }
  }, [baseUrl, mockMode, activeThreadId, allMockDocs, addLog]);

  // Refetch documents whenever active thread changes
  useEffect(() => {
    fetchDocuments(activeThreadId);
  }, [activeThreadId, fetchDocuments]);

  // Scroll to bottom when messages change
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeThread?.messages, isGenerating]);

  // Thread actions
  const handleCreateNewThread = () => {
    const newId = 'thread-' + Date.now();
    const newThread: Thread = {
      id: newId,
      title: 'Percakapan Baru',
      createdAt: new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }),
      updatedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      messages: [DEFAULT_WELCOME_MSG],
    };
    setThreads(prev => [newThread, ...prev]);
    setActiveThreadId(newId);
    setKbDocs([]);
    setUploadQueue([]);
    addLog(`Obrolan baru '${newThread.title}' dibuat. Dokumen terisolasi.`, 'info');
  };

  const handleDeleteThread = async (threadId: string, e: React.MouseEvent) => {
    e.stopPropagation();

    // Clean up documents in ChromaDB for this thread
    if (!mockMode) {
      try {
        await fetch(`${baseUrl}/threads/${encodeURIComponent(threadId)}/documents`, { method: 'DELETE' });
        addLog(`Dokumen untuk obrolan '${threadId}' dibersihkan dari ChromaDB.`, 'info');
      } catch {
        // ignore
      }
    } else {
      setAllMockDocs(p => p.filter(d => d.thread_id !== threadId));
    }

    setThreads(prev => {
      const filtered = prev.filter(t => t.id !== threadId);
      if (filtered.length === 0) {
        const fallback: Thread = {
          id: 'thread-' + Date.now(),
          title: 'Percakapan Baru',
          createdAt: new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }),
          updatedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          messages: [DEFAULT_WELCOME_MSG],
        };
        setActiveThreadId(fallback.id);
        return [fallback];
      }
      if (activeThreadId === threadId) {
        setActiveThreadId(filtered[0].id);
      }
      return filtered;
    });
    addLog('Obrolan dihapus.', 'info');
  };

  const handleClearCurrentChat = () => {
    if (!activeThread) return;
    setThreads(prev => prev.map(t => {
      if (t.id === activeThread.id) {
        return {
          ...t,
          messages: [DEFAULT_WELCOME_MSG],
          updatedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
      }
      return t;
    }));
    addLog(`Riwayat pesan pada obrolan '${activeThread.title}' dibersihkan.`, 'info');
  };

  // Send query isolated per activeThreadId
  const handleSendQuery = async (customQuery?: string) => {
    const q = (typeof customQuery === 'string' ? customQuery : inputQuery).trim();
    if (!q || isGenerating || !activeThread) return;

    setInputQuery('');
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      sender: 'user',
      text: q,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    // Auto-update thread title if it's default or new
    setThreads(prev => prev.map(t => {
      if (t.id === activeThread.id) {
        const isNewThread = t.title === 'Percakapan Baru' || t.title === 'Percakapan Pertama';
        const updatedTitle = isNewThread ? (q.length > 28 ? q.slice(0, 28) + '...' : q) : t.title;
        return {
          ...t,
          title: updatedTitle,
          updatedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          messages: [...t.messages, userMsg],
        };
      }
      return t;
    }));

    setIsGenerating(true);
    addLog(`POST /query (thread: ${activeThread.id}) - "${q}"`, 'info');

    if (mockMode) {
      setTimeout(() => {
        const hasDocs = kbDocs.length > 0;
        const aiMsg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          sender: 'ai',
          text: hasDocs
            ? `**[Mock Mode Response]**\n\nHasil pencarian terisolasi untuk thread *"${activeThread.title}"*:\n\n1. Dokumen relevan (${kbDocs.length} file) berhasil ditemukan.\n2. Ringkasan poin penting telah diolah oleh Groq LLM.\n3. Dokumen terisolasi hanya untuk obrolan ini.`
            : `**[Mock Mode]**\n\nBelum ada dokumen yang diunggah untuk obrolan ini. Silakan unggah dokumen di kolom kanan agar saya dapat menganalisis data spesifik thread ini.`,
          sources: hasDocs
            ? [{ source: `./temp/${kbDocs[0]?.filename || 'sample.pdf'}`, page: 0, content_preview: 'Cuplikan referensi konteks terisolasi pada thread ini...' }]
            : [],
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };

        setThreads(prev => prev.map(t => {
          if (t.id === activeThread.id) {
            return { ...t, messages: [...t.messages, aiMsg] };
          }
          return t;
        }));
        setIsGenerating(false);
        addLog('POST /query - OK (Mock).', 'success');
      }, 1000);
      return;
    }

    try {
      const r = await fetch(`${baseUrl}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, thread_id: activeThread.id }),
      });
      if (!r.ok) {
        const errData = await r.json().catch(() => ({}));
        throw new Error(errData.detail || 'Gagal memproses query');
      }
      const d = await r.json();
      const aiMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        sender: 'ai',
        text: d.answer,
        sources: d.sources || [],
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setThreads(prev => prev.map(t => {
        if (t.id === activeThread.id) {
          return { ...t, messages: [...t.messages, aiMsg] };
        }
        return t;
      }));
      addLog(`POST /query - OK (${d.sources?.length || 0} sumber ditemukan).`, 'success');
    } catch (err: unknown) {
      const m = err instanceof Error ? err.message : 'Terjadi kesalahan sistem';
      addLog(`POST /query Error: ${m}`, 'error');
      const errorMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        sender: 'ai',
        text: `⚠️ **Gagal mengambil jawaban**: ${m}\n\n*Pastikan backend FastAPI sudah berjalan di ${baseUrl} atau aktifkan **Mock Mode** di Pengaturan.*`,
        sources: [],
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setThreads(prev => prev.map(t => {
        if (t.id === activeThread.id) {
          return { ...t, messages: [...t.messages, errorMsg] };
        }
        return t;
      }));
    } finally {
      setIsGenerating(false);
    }
  };

  // File queue management dengan proteksi resource (Free Tier 512MB RAM)
  const addFilesToQueue = (files: FileList | File[]) => {
    const ok = ['.pdf', '.txt', '.docx', '.doc', '.csv'];
    const items: UploadQueueItem[] = [];
    const currentQueueCount = uploadQueue.length;
    let currentQueueBytes = uploadQueue.reduce((acc, q) => acc + q.file.size, 0);

    const activeDocsCount = kbDocs.length;
    if (activeDocsCount >= MAX_DOCS_PER_THREAD) {
      addLog(`Batas maksimal (${MAX_DOCS_PER_THREAD} dokumen) untuk obrolan ini telah tercapai. Hapus dokumen lama terlebih dahulu.`, 'warn');
      return;
    }

    const fileList = Array.from(files);
    for (const f of fileList) {
      const ext = '.' + f.name.split('.').pop()?.toLowerCase();
      if (!ok.includes(ext)) {
        addLog(`'${f.name}' ditolak - format tidak didukung (gunakan PDF, TXT, DOCX, CSV).`, 'warn');
        continue;
      }

      if (f.size > MAX_FILE_SIZE_BYTES) {
        addLog(`'${f.name}' ditolak - ukuran (${formatBytes(f.size)}) melebihi batas maksimal 5 MB.`, 'error');
        continue;
      }

      if (currentQueueCount + items.length >= MAX_QUEUE_ITEMS) {
        addLog(`Antrean penuh: maksimal ${MAX_QUEUE_ITEMS} file per batch upload. Sisa file diabaikan.`, 'warn');
        break;
      }

      if (currentQueueBytes + f.size > MAX_QUEUE_TOTAL_BYTES) {
        addLog(`Total ukuran antrean melebihi batas 15 MB. '${f.name}' diabaikan.`, 'warn');
        break;
      }

      if (activeDocsCount + items.length >= MAX_DOCS_PER_THREAD) {
        addLog(`Maksimal ${MAX_DOCS_PER_THREAD} dokumen per obrolan. Dokumen '${f.name}' diabaikan.`, 'warn');
        break;
      }

      items.push({ file: f, status: 'pending', progress: 0 });
      currentQueueBytes += f.size;
    }

    if (items.length > 0) {
      setUploadQueue(p => [...p, ...items]);
    }
  };

  const uploadSingleFile = useCallback(async (item: UploadQueueItem, idx: number) => {
    setUploadQueue(p => p.map((q, i) => (i === idx ? { ...q, status: 'uploading', progress: 30 } : q)));
    addLog(`POST /upload - ${item.file.name} (obrolan: ${activeThreadId})`, 'info');

    if (mockMode) {
      await new Promise(r => setTimeout(r, 800));
      const ch = Math.floor(Math.random() * 15) + 5;
      const newDoc: KBDocument = { source: `./temp/${item.file.name}`, filename: item.file.name, chunks: ch, thread_id: activeThreadId };
      setUploadQueue(p => p.map((q, i) => (i === idx ? { ...q, status: 'done', progress: 100, chunks: ch } : q)));
      setAllMockDocs(p => [...p, newDoc]);
      setKbDocs(p => [...p, newDoc]);
      addLog(`POST /upload - OK (Mock): '${item.file.name}' (${ch} chunks) untuk obrolan ini.`, 'success');
      return;
    }

    try {
      const form = new FormData();
      form.append('file', item.file);
      form.append('thread_id', activeThreadId);
      setUploadQueue(p => p.map((q, i) => (i === idx ? { ...q, progress: 60 } : q)));

      const r = await fetch(`${baseUrl}/upload`, { method: 'POST', body: form });
      if (!r.ok) {
        const errJson = await r.json().catch(() => ({}));
        throw new Error(errJson.detail || 'Upload gagal');
      }
      const d = await r.json();
      const ch = d.processed_chunks || 0;
      setUploadQueue(p => p.map((q, i) => (i === idx ? { ...q, status: 'done', progress: 100, chunks: ch } : q)));
      addLog(`POST /upload - OK: '${item.file.name}' (${ch} chunks terisolasi untuk thread ini).`, 'success');
      fetchDocuments(activeThreadId);
    } catch (err: unknown) {
      const m = err instanceof Error ? err.message : 'Error';
      setUploadQueue(p => p.map((q, i) => (i === idx ? { ...q, status: 'error', progress: 0, error: m } : q)));
      addLog(`POST /upload Error: ${m}`, 'error');
    }
  }, [baseUrl, mockMode, activeThreadId, addLog, fetchDocuments]);

  const handleUploadAll = async () => {
    const pending = uploadQueue.map((item, i) => ({ item, i })).filter(({ item }) => item.status === 'pending');
    for (const { item, i } of pending) {
      await uploadSingleFile(item, i);
    }
  };

  // Delete single document isolated to activeThreadId
  const handleDeleteDocument = async (filename: string) => {
    setDeletingFile(filename);
    addLog(`DELETE /documents/${filename}?thread_id=${activeThreadId}`, 'info');

    if (mockMode) {
      await new Promise(r => setTimeout(r, 600));
      setKbDocs(p => p.filter(d => d.filename !== filename));
      setAllMockDocs(p => p.filter(d => !(d.filename === filename && d.thread_id === activeThreadId)));
      setDeletingFile(null);
      setDeleteConfirm(null);
      addLog(`DELETE - OK (Mock): '${filename}' dihapus dari thread ini.`, 'success');
      return;
    }

    try {
      const r = await fetch(`${baseUrl}/documents/${encodeURIComponent(filename)}?thread_id=${encodeURIComponent(activeThreadId)}`, { method: 'DELETE' });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Gagal menghapus');
      const d = await r.json();
      setKbDocs(p => p.filter(x => x.filename !== filename));
      addLog(`DELETE - OK: '${filename}' (${d.deleted_chunks} chunks dihapus dari obrolan ini).`, 'success');
    } catch (err: unknown) {
      addLog(`DELETE Error: ${err instanceof Error ? err.message : 'Error'}`, 'error');
    } finally {
      setDeletingFile(null);
      setDeleteConfirm(null);
    }
  };

  // Filtered lists
  const filteredThreads = useMemo(() => {
    if (!threadSearch.trim()) return threads;
    return threads.filter(t => t.title.toLowerCase().includes(threadSearch.toLowerCase()));
  }, [threads, threadSearch]);

  const filteredDocs = useMemo(() => {
    if (!docSearchQuery.trim()) return kbDocs;
    return kbDocs.filter(d => d.filename.toLowerCase().includes(docSearchQuery.toLowerCase()));
  }, [kbDocs, docSearchQuery]);

  // Color tokens
  const D = theme === 'dark';
  const surf = D ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200';
  const mut = D ? 'text-slate-400' : 'text-slate-500';
  const inp = D
    ? 'bg-slate-950 border-slate-800 text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500'
    : 'bg-white border-slate-300 text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500';
  const pendCount = uploadQueue.filter(q => q.status === 'pending').length;
  const uploadingCount = uploadQueue.filter(q => q.status === 'uploading').length;

  return (
    <div className={`h-screen w-screen flex flex-col font-sans overflow-hidden transition-colors duration-200 ${D ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-800'}`}>

      {/* TOP COMPACT HEADER */}
      <header className={`h-14 border-b px-4 flex items-center justify-between shrink-0 select-none z-20 ${D ? 'bg-slate-900/95 border-slate-800' : 'bg-white/95 border-slate-200 shadow-sm'}`}>
        <div className="flex items-center space-x-3">
          <button
            onClick={() => setShowLeftSidebar(p => !p)}
            className={`p-1.5 rounded-lg border transition-colors ${D ? 'border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800' : 'border-slate-200 text-slate-600 hover:bg-slate-100'}`}
            title={showLeftSidebar ? 'Sembunyikan Kolom Riwayat' : 'Tampilkan Kolom Riwayat'}
          >
            {showLeftSidebar ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeft className="w-4 h-4" />}
          </button>

          <div className="flex items-center space-x-2.5">
            <div className="bg-gradient-to-tr from-indigo-600 to-violet-500 p-2 rounded-xl text-white shadow-md shadow-indigo-500/20">
              <Database className="w-4 h-4" />
            </div>
            <div className="flex items-center space-x-2">
              <h1 className="text-sm font-bold tracking-tight">RAG Knowledge Base</h1>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hidden sm:inline-flex items-center space-x-1">
                <FolderLock className="w-3 h-3" />
                <span>Obrolan Terisolasi</span>
              </span>
            </div>
          </div>
        </div>

        {/* Stats Pill in Header */}
        <div className="hidden md:flex items-center space-x-3 text-xs">
          <div className={`px-3 py-1 rounded-full border flex items-center space-x-2 ${D ? 'bg-slate-950/60 border-slate-800 text-slate-300' : 'bg-slate-100 border-slate-200 text-slate-700'}`}>
            <FileText className="w-3.5 h-3.5 text-indigo-400" />
            <span>Obrolan ini: <strong>{kbDocs.length}</strong> Dokumen</span>
            <span className="text-slate-600">•</span>
            <Layers className="w-3.5 h-3.5 text-violet-400" />
            <span><strong>{totalChunks}</strong> Chunks</span>
          </div>
        </div>

        {/* Header Right Actions */}
        <div className="flex items-center space-x-2">
          {/* Connection status badge */}
          <div className={`flex items-center space-x-1.5 text-xs px-2.5 py-1 rounded-full border ${apiConnected ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' : 'bg-amber-500/10 text-amber-400 border-amber-500/30'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${apiConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
            <span className="text-[11px] font-medium hidden sm:inline">
              {mockMode ? 'Mock' : apiConnected ? 'Online' : 'Offline'}
            </span>
          </div>

          <button
            onClick={() => setTheme(D ? 'light' : 'dark')}
            className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${D ? 'bg-slate-800 border-slate-700 hover:bg-slate-700 text-slate-300' : 'bg-slate-100 border-slate-200 hover:bg-slate-200 text-slate-700'}`}
            title="Ganti Tema"
          >
            {D ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          <button
            onClick={() => setIsSettingsOpen(true)}
            className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${D ? 'bg-slate-800 border-slate-700 hover:bg-slate-700 text-slate-300' : 'bg-slate-100 border-slate-200 hover:bg-slate-200 text-slate-700'}`}
            title="Pengaturan"
          >
            <Settings className="w-4 h-4" />
          </button>

          <button
            onClick={() => setShowRightSidebar(p => !p)}
            className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${D ? 'border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800' : 'border-slate-200 text-slate-600 hover:bg-slate-100'}`}
            title={showRightSidebar ? 'Sembunyikan Kolom Dokumen' : 'Tampilkan Kolom Dokumen'}
          >
            {showRightSidebar ? <PanelRightClose className="w-4 h-4" /> : <PanelRight className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* 3-COLUMN UNIFIED WORKSPACE */}
      <div className="flex-1 flex overflow-hidden min-h-0 relative">

        {/* ======================================================== */}
        {/* KOLOM 1: HISTORY CHAT / THREADS (LEFT COLUMN)           */}
        {/* ======================================================== */}
        <aside
          className={`${showLeftSidebar ? 'w-64 md:w-68 lg:w-72 xl:w-76' : 'w-0 overflow-hidden border-none'} border-r transition-all duration-200 shrink-0 flex flex-col h-full ${D ? 'bg-slate-900/50 border-slate-800/80' : 'bg-slate-100/70 border-slate-200'}`}
        >
          {/* New Chat Button */}
          <div className="p-3 border-b border-slate-800/60">
            <button
              onClick={handleCreateNewThread}
              className="w-full flex items-center justify-center space-x-2 py-2.5 px-3 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-medium text-xs hover:from-indigo-500 hover:to-violet-500 shadow-md shadow-indigo-600/20 transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Obrolan Baru</span>
            </button>
          </div>

          {/* Search Threads */}
          <div className="px-3 pt-2.5 pb-2">
            <div className={`flex items-center space-x-2 px-2.5 py-1.5 rounded-xl border text-xs ${inp}`}>
              <Search className="w-3.5 h-3.5 opacity-50 shrink-0" />
              <input
                type="text"
                placeholder="Cari riwayat percakapan..."
                value={threadSearch}
                onChange={e => setThreadSearch(e.target.value)}
                className="w-full bg-transparent border-none outline-none text-xs"
              />
              {threadSearch && (
                <button onClick={() => setThreadSearch('')} className="text-slate-400 hover:text-white cursor-pointer">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Threads List */}
          <div className="flex-1 overflow-y-auto px-2 py-1 space-y-1">
            <div className={`px-2 py-1 text-[10px] font-semibold uppercase tracking-wider ${mut}`}>
              Riwayat Obrolan ({filteredThreads.length})
            </div>

            {filteredThreads.length === 0 ? (
              <div className={`text-center py-8 text-xs ${mut}`}>
                {threadSearch ? 'Tidak ada riwayat yang cocok' : 'Belum ada obrolan'}
              </div>
            ) : (
              filteredThreads.map(t => {
                const isActive = t.id === activeThread?.id;
                const msgCount = t.messages.length;
                const isEditing = editingThreadId === t.id;

                if (isEditing) {
                  return (
                    <form
                      key={t.id}
                      onSubmit={e => handleSaveRename(t.id, e)}
                      onClick={e => e.stopPropagation()}
                      className={`flex items-center space-x-1 p-1.5 rounded-xl border ${D ? 'bg-slate-900 border-indigo-500/50' : 'bg-white border-indigo-300 shadow-sm'}`}
                    >
                      <input
                        type="text"
                        autoFocus
                        value={editingTitle}
                        onChange={e => setEditingTitle(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Escape') handleCancelRename();
                        }}
                        className={`flex-1 px-2 py-1 text-xs rounded-lg border outline-none ${inp}`}
                        placeholder="Nama obrolan..."
                      />
                      <button
                        type="submit"
                        className="p-1 rounded text-emerald-400 hover:bg-emerald-500/10 cursor-pointer"
                        title="Simpan nama"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={handleCancelRename}
                        className="p-1 rounded text-slate-400 hover:text-slate-200 cursor-pointer"
                        title="Batal"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </form>
                  );
                }

                return (
                  <div
                    key={t.id}
                    onClick={() => {
                      setActiveThreadId(t.id);
                      fetchDocuments(t.id);
                    }}
                    className={`group relative flex items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer text-xs transition-all ${
                      isActive
                        ? D
                          ? 'bg-indigo-600/15 border border-indigo-500/40 text-indigo-300 font-medium'
                          : 'bg-white border border-indigo-200 text-indigo-700 shadow-sm font-medium'
                        : D
                          ? 'text-slate-300 hover:bg-slate-800/60 border border-transparent'
                          : 'text-slate-700 hover:bg-slate-200/60 border border-transparent'
                    }`}
                  >
                    <div className="flex items-center space-x-2.5 min-w-0 pr-2">
                      <MessageSquare className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-indigo-400' : 'text-slate-500'}`} />
                      <div className="truncate">
                        <div className="truncate text-xs font-medium">{t.title}</div>
                        <div className={`text-[10px] ${mut} flex items-center space-x-1 mt-0.5`}>
                          <span>{t.createdAt}</span>
                          <span>•</span>
                          <span>{msgCount} pesan</span>
                        </div>
                      </div>
                    </div>

                    {/* Rename & Delete buttons on hover */}
                    <div className="opacity-0 group-hover:opacity-100 flex items-center space-x-0.5 shrink-0 transition-all">
                      <button
                        onClick={e => handleStartRename(t, e)}
                        className={`p-1 rounded-lg text-slate-400 hover:text-indigo-400 transition-all cursor-pointer ${D ? 'hover:bg-slate-800' : 'hover:bg-slate-200'}`}
                        title="Ganti nama obrolan"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        onClick={e => handleDeleteThread(t.id, e)}
                        className={`p-1 rounded-lg text-slate-400 hover:text-red-400 transition-all cursor-pointer ${D ? 'hover:bg-slate-800' : 'hover:bg-slate-200'}`}
                        title="Hapus obrolan & berkas terkait"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Left Sidebar Footer */}
          <div className={`p-3 border-t text-[11px] flex items-center justify-between ${D ? 'border-slate-800 bg-slate-950/40 text-slate-400' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
            <span>{threads.length} Obrolan tersimpan</span>
            <button
              onClick={() => {
                if (confirm('Bersihkan semua riwayat percakapan?')) {
                  const fresh: Thread = {
                    id: 'thread-' + Date.now(),
                    title: 'Percakapan Baru',
                    createdAt: new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }),
                    updatedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    messages: [DEFAULT_WELCOME_MSG],
                  };
                  setThreads([fresh]);
                  setActiveThreadId(fresh.id);
                  setKbDocs([]);
                  addLog('Semua riwayat percakapan telah dibersihkan.', 'info');
                }
              }}
              className="text-[10px] text-slate-500 hover:text-red-400 transition-colors cursor-pointer"
            >
              Reset Semua
            </button>
          </div>
        </aside>

        {/* ======================================================== */}
        {/* KOLOM 2: CHAT AREA (MIDDLE COLUMN)                       */}
        {/* ======================================================== */}
        <main className="flex-1 flex flex-col h-full min-w-0 bg-transparent relative overflow-hidden">

          {/* Chat Column Sub-Header */}
          <div className={`h-11 px-4 border-b flex items-center justify-between shrink-0 text-xs ${D ? 'bg-slate-900/40 border-slate-800/80' : 'bg-white border-slate-200'}`}>
            <div className="flex items-center space-x-2 truncate">
              {editingThreadId === activeThread?.id ? (
                <form
                  onSubmit={e => handleSaveRename(activeThread.id, e)}
                  className="flex items-center space-x-1.5"
                >
                  <input
                    type="text"
                    autoFocus
                    value={editingTitle}
                    onChange={e => setEditingTitle(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Escape') handleCancelRename();
                    }}
                    className={`px-2 py-0.5 text-xs rounded border outline-none font-semibold ${inp}`}
                    placeholder="Nama obrolan..."
                  />
                  <button
                    type="submit"
                    className="p-1 rounded text-emerald-400 hover:bg-emerald-500/10 cursor-pointer"
                    title="Simpan nama"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelRename}
                    className="p-1 rounded text-slate-400 hover:text-slate-200 cursor-pointer"
                    title="Batal"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </form>
              ) : (
                <div className="flex items-center space-x-1.5 group">
                  <span className="font-semibold truncate max-w-[200px] sm:max-w-[320px]">
                    {activeThread?.title || 'Obrolan'}
                  </span>
                  {activeThread && (
                    <button
                      onClick={e => handleStartRename(activeThread, e)}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded text-slate-400 hover:text-indigo-400 transition-all cursor-pointer"
                      title="Ganti nama obrolan ini"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                  )}
                </div>
              )}

              <span className={`text-[10px] px-1.5 py-0.5 rounded ${D ? 'bg-slate-800 text-slate-400' : 'bg-slate-100 text-slate-500'}`}>
                {activeThread?.messages.length || 0} pesan
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-mono hidden sm:inline">
                {kbDocs.length} file terisolasi
              </span>
            </div>

            <div className="flex items-center space-x-2">
              <button
                onClick={handleClearCurrentChat}
                className={`flex items-center space-x-1 px-2 py-1 rounded-lg text-[11px] transition-colors cursor-pointer ${D ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-800' : 'text-slate-600 hover:bg-slate-100'}`}
                title="Bersihkan isi obrolan ini"
              >
                <RotateCcw className="w-3 h-3" />
                <span className="hidden sm:inline">Bersihkan Chat</span>
              </button>
            </div>
          </div>

          {/* Messages Feed */}
          <div className="flex-1 p-4 lg:p-6 overflow-y-auto space-y-4">
            {activeThread?.messages.map(msg => (
              <ChatBubble key={msg.id} message={msg} isDark={D} />
            ))}

            {/* Quick Suggestions when chat is still fresh */}
            {activeThread?.messages.length === 1 && (
              <div className="my-6 max-w-xl mx-auto text-center">
                <div className="inline-flex items-center justify-center p-3 rounded-2xl bg-indigo-500/10 text-indigo-400 mb-3 border border-indigo-500/20">
                  <Sparkles className="w-6 h-6 animate-pulse" />
                </div>
                <h3 className="text-sm font-semibold mb-1">
                  {kbDocs.length > 0 ? 'Mulai Ajukan Pertanyaan' : 'Unggah Dokumen untuk Obrolan Ini'}
                </h3>
                <p className={`text-xs mb-4 ${mut}`}>
                  {kbDocs.length > 0
                    ? `Obrolan ini memiliki ${kbDocs.length} dokumen terisolasi di ChromaDB yang siap dianalisis.`
                    : 'Obrolan ini belum memiliki dokumen referensi. File yang diunggah di kolom kanan hanya akan terbaca oleh obrolan ini.'}
                </p>
                {kbDocs.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-left">
                    {[
                      'Ringkas dokumen utama yang telah diunggah',
                      'Apa topik dan kesimpulan paling penting?',
                      'Jelaskan data teknis atau fakta penting di dokumen',
                      'Daftar informasi penting apa saja yang tersedia?',
                    ].map((chip, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleSendQuery(chip)}
                        className={`p-2.5 rounded-xl border text-xs text-left transition-all cursor-pointer ${
                          D
                            ? 'border-slate-800 bg-slate-900/60 text-slate-300 hover:border-indigo-500/50 hover:bg-indigo-600/10'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-indigo-400 hover:bg-indigo-50/50 shadow-sm'
                        }`}
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                ) : (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center space-x-2 px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-500 transition-colors shadow-md cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Unggah Dokumen untuk Obrolan Ini</span>
                  </button>
                )}
              </div>
            )}

            {/* Generating Indicator */}
            {isGenerating && (
              <div className="flex items-start space-x-3">
                <div className="p-2 rounded-xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 animate-pulse">
                  <Sparkles className="w-4 h-4 animate-spin" />
                </div>
                <div className={`p-3 rounded-2xl border text-xs flex items-center space-x-2.5 ${D ? 'bg-slate-800/50 border-slate-700/80 text-slate-300' : 'bg-slate-100 border-slate-200 text-slate-600'}`}>
                  <span className="w-2 h-2 rounded-full bg-indigo-400 animate-ping inline-block" />
                  <span>Mencari vektor di ChromaDB ({activeThread?.title}) &amp; menyusun jawaban via Groq LLM...</span>
                </div>
              </div>
            )}

            <div ref={chatBottomRef} />
          </div>

          {/* Chat Input Bar */}
          <div className={`p-3 lg:p-4 border-t ${D ? 'bg-slate-900/90 border-slate-800/80' : 'bg-white border-slate-200'}`}>
            <form
              onSubmit={e => {
                e.preventDefault();
                handleSendQuery();
              }}
              className="flex items-center space-x-2"
            >
              <input
                type="text"
                value={inputQuery}
                onChange={e => setInputQuery(e.target.value)}
                placeholder={
                  kbDocs.length > 0
                    ? `Tanyakan isi dokumen pada "${activeThread?.title}"...`
                    : `Ketik pertanyaan (unggah file di kanan untuk referensi obrolan ini)...`
                }
                disabled={isGenerating}
                className={`flex-1 px-4 py-3 text-sm rounded-xl border outline-none transition-all ${inp}`}
              />
              <button
                type="submit"
                disabled={!inputQuery.trim() || isGenerating}
                className="px-5 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-medium text-sm hover:from-indigo-500 hover:to-violet-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2 shadow-lg shadow-indigo-500/25 transition-all cursor-pointer"
              >
                <span>Kirim</span>
                <Send className="w-4 h-4" />
              </button>
            </form>
            <div className={`mt-1.5 px-1 text-[11px] ${mut} flex items-center justify-between`}>
              <span>Tekan <strong>Enter</strong> untuk mengirim pertanyaan</span>
              <span>Konteks: <strong>{kbDocs.length} Dokumen</strong> terisolasi pada obrolan ini</span>
            </div>
          </div>
        </main>

        {/* ======================================================== */}
        {/* KOLOM 3: UPLOAD & DAFTAR FILE (RIGHT COLUMN — RESIZABLE) */}
        {/* ======================================================== */}
        {showRightSidebar && (
          /* Drag-resize handle on the LEFT edge of the right sidebar */
          <div
            className={`w-1 shrink-0 cursor-col-resize select-none group relative z-10 ${
              D ? 'hover:bg-indigo-500/50' : 'hover:bg-indigo-400/40'
            } transition-colors`}
            onMouseDown={(e) => {
              e.preventDefault();
              isResizing.current = true;
              const startX = e.clientX;
              const startW = rightSidebarWidth;
              const onMove = (ev: MouseEvent) => {
                if (!isResizing.current) return;
                const delta = startX - ev.clientX;
                const next = Math.min(520, Math.max(240, startW + delta));
                setRightSidebarWidth(next);
              };
              const onUp = () => {
                isResizing.current = false;
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
              };
              window.addEventListener('mousemove', onMove);
              window.addEventListener('mouseup', onUp);
            }}
          >
            <div className={`absolute inset-y-0 left-0 w-0.5 ${
              D ? 'bg-slate-800 group-hover:bg-indigo-500' : 'bg-slate-200 group-hover:bg-indigo-400'
            } transition-colors`} />
          </div>
        )}
        <aside
          style={showRightSidebar ? { width: `${rightSidebarWidth}px` } : undefined}
          className={`${
            showRightSidebar ? 'border-l' : 'w-0 overflow-hidden border-none'
          } transition-[border] duration-200 shrink-0 flex flex-col h-full ${D ? 'bg-slate-900/60 border-slate-800/80' : 'bg-slate-100/60 border-slate-200'}`}
        >
          {/* Right Panel Header */}
          <div className={`px-3 py-2 border-b flex items-center justify-between shrink-0 ${D ? 'border-slate-800 bg-slate-900/80' : 'border-slate-200 bg-white'}`}>
            <div className="flex items-center space-x-2 text-xs font-semibold">
              <FileText className="w-3.5 h-3.5 text-indigo-400" />
              <span>Dokumen ({kbDocs.length})</span>
            </div>
            <button
              onClick={() => fetchDocuments(activeThreadId)}
              disabled={statsLoading}
              className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${D ? 'border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800' : 'border-slate-200 text-slate-600 hover:bg-slate-100'}`}
              title="Refresh Dokumen Obrolan Ini"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${statsLoading ? 'animate-spin text-indigo-400' : ''}`} />
            </button>
          </div>

          {/* Thread Indicator Banner */}
          <div className={`px-3 py-1.5 border-b text-[11px] flex items-center justify-between ${D ? 'bg-indigo-950/30 border-slate-800/80 text-indigo-300' : 'bg-indigo-50/70 border-slate-200 text-indigo-700'}`}>
            <span className="flex items-center space-x-1 truncate max-w-[200px]">
              <FolderLock className="w-3 h-3 shrink-0" />
              <span className="truncate">Obrolan: <strong>{activeThread?.title || 'Aktif'}</strong></span>
            </span>
            <span className="text-[10px] opacity-75 font-mono">Terisolasi</span>
          </div>

          {/* Right Panel Content */}
          {
            <div className="flex-1 overflow-y-auto p-3 space-y-3.5">

              {/* 1. UPLOAD FILE DROPZONE */}
              <div
                onDragOver={e => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={e => {
                  e.preventDefault();
                  setIsDragging(false);
                  if (e.dataTransfer.files?.length) addFilesToQueue(e.dataTransfer.files);
                }}
                onClick={() => fileInputRef.current?.click()}
                className={`p-4 rounded-xl border-2 border-dashed transition-all flex flex-col items-center justify-center text-center cursor-pointer ${
                  isDragging
                    ? 'border-indigo-500 bg-indigo-500/10 scale-[0.99]'
                    : D
                      ? 'border-slate-700 bg-slate-900/50 hover:border-indigo-500/60 hover:bg-slate-900'
                      : 'border-slate-300 bg-white hover:border-indigo-400'
                }`}
              >
                <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400 mb-2 border border-indigo-500/20">
                  <FilePlus2 className="w-5 h-5" />
                </div>
                <h3 className="text-xs font-semibold mb-0.5">Unggah Berkas ke Obrolan Ini</h3>
                <p className={`text-[11px] mb-2 ${mut}`}>
                  File hanya terhubung ke <strong>{activeThread?.title}</strong>
                </p>
                <div className="flex items-center space-x-1.5 text-[10px] text-indigo-400 font-mono">
                  <span>PDF</span>•<span>DOCX</span>•<span>CSV</span>•<span>TXT</span>
                </div>
                <div className={`mt-2 text-[10px] ${mut} flex flex-col items-center gap-0.5 leading-tight`}>
                  <span>Maks. <strong>5 MB</strong> / file • Maks. <strong>5 file</strong> / antrean</span>
                  <span>Maks. <strong>10 dokumen</strong> per obrolan ({kbDocs.length}/10)</span>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.docx,.doc,.csv,.txt"
                  className="hidden"
                  onChange={e => e.target.files && addFilesToQueue(e.target.files)}
                />
              </div>

              {/* 2. UPLOAD QUEUE */}
              {uploadQueue.length > 0 && (
                <div className={`rounded-xl border overflow-hidden ${surf}`}>
                  <div className={`px-3 py-2 border-b flex items-center justify-between text-xs ${D ? 'border-slate-800' : 'border-slate-200'}`}>
                    <span className="font-bold flex items-center space-x-1.5">
                      <Upload className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Antrian ({uploadQueue.length})</span>
                    </span>
                    <div className="flex items-center space-x-1.5">
                      {pendCount > 0 && uploadingCount === 0 && (
                        <button
                          onClick={handleUploadAll}
                          className="flex items-center space-x-1 px-2 py-1 rounded bg-indigo-600 text-white text-[10px] font-semibold hover:bg-indigo-500 transition-colors cursor-pointer"
                        >
                          <Zap className="w-3 h-3" />
                          <span>Upload ({pendCount})</span>
                        </button>
                      )}
                      <button
                        onClick={() => setUploadQueue([])}
                        className={`text-[10px] ${mut} hover:text-red-400 transition-colors cursor-pointer`}
                      >
                        Hapus
                      </button>
                    </div>
                  </div>
                  <div className="divide-y divide-slate-800/30 max-h-48 overflow-y-auto">
                    {uploadQueue.map((item, i) => (
                      <div key={i} className={`p-2 text-xs flex items-center space-x-2 ${D ? 'hover:bg-slate-800/20' : 'hover:bg-slate-50'}`}>
                        <File className={`w-3.5 h-3.5 shrink-0 ${item.status === 'done' ? 'text-emerald-400' : item.status === 'error' ? 'text-red-400' : 'text-indigo-400'}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="truncate max-w-[140px] font-medium">{item.file.name}</span>
                            <span className={`text-[9px] ${mut}`}>{formatBytes(item.file.size)}</span>
                          </div>
                          {item.status === 'uploading' && (
                            <div className={`w-full h-1 mt-1 rounded-full overflow-hidden ${D ? 'bg-slate-700' : 'bg-slate-200'}`}>
                              <div className="h-full bg-indigo-500 animate-pulse" style={{ width: `${item.progress}%` }} />
                            </div>
                          )}
                          {item.status === 'done' && <span className="text-[9px] text-emerald-400">Selesai • {item.chunks} chunks</span>}
                          {item.status === 'error' && <span className="text-[9px] text-red-400 truncate">{item.error}</span>}
                          {item.status === 'pending' && <span className={`text-[9px] ${mut}`}>Menunggu...</span>}
                        </div>
                        <div className="flex items-center space-x-0.5 shrink-0">
                          {item.status === 'pending' && (
                            <button
                              onClick={() => uploadSingleFile(item, i)}
                              className="p-1 rounded text-indigo-400 hover:bg-indigo-500/10 cursor-pointer"
                              title="Upload file ini"
                            >
                              <Upload className="w-3 h-3" />
                            </button>
                          )}
                          <button
                            onClick={() => setUploadQueue(p => p.filter((_, j) => j !== i))}
                            className="p-1 rounded text-slate-500 hover:text-red-400 cursor-pointer"
                            title="Batal"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 3. DAFTAR FILE TERISOLASI DALAM THREAD INI */}
              <div className={`rounded-xl border overflow-hidden ${surf}`}>
                {/* Search in Documents */}
                <div className={`p-2.5 border-b space-y-2 ${D ? 'border-slate-800' : 'border-slate-200'}`}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold flex items-center space-x-1.5">
                      <HardDrive className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Dokumen Obrolan Ini ({kbDocs.length})</span>
                    </span>
                    <span className={`text-[10px] ${mut}`}>{totalChunks} chunks</span>
                  </div>
                  <div className={`flex items-center space-x-2 px-2.5 py-1.5 rounded-lg border text-xs ${inp}`}>
                    <Search className="w-3 h-3 opacity-50 shrink-0" />
                    <input
                      type="text"
                      placeholder="Cari file dalam obrolan ini..."
                      value={docSearchQuery}
                      onChange={e => setDocSearchQuery(e.target.value)}
                      className="w-full bg-transparent border-none outline-none text-xs"
                    />
                    {docSearchQuery && (
                      <button onClick={() => setDocSearchQuery('')} className="text-slate-400 hover:text-white cursor-pointer">
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Documents List */}
                <div className="divide-y divide-slate-800/30 max-h-[calc(100vh-410px)] overflow-y-auto">
                  {kbDocs.length === 0 ? (
                    <div className={`p-6 text-center text-xs ${mut}`}>
                      {statsLoading ? (
                        <span className="flex items-center justify-center space-x-1.5">
                          <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                          <span>Memuat dokumen obrolan...</span>
                        </span>
                      ) : (
                        <div>
                          <p className="font-semibold text-slate-400 mb-1">Belum ada dokumen untuk obrolan ini</p>
                          <p className="text-[11px] opacity-75">
                            Dokumen yang diunggah di atas akan tersimpan khusus untuk obrolan "{activeThread?.title}".
                          </p>
                        </div>
                      )}
                    </div>
                  ) : filteredDocs.length === 0 ? (
                    <div className={`p-4 text-center text-xs ${mut}`}>Tidak ada file yang cocok dengan pencarian</div>
                  ) : (
                    filteredDocs.map(doc => {
                      const ext = doc.filename.split('.').pop()?.toUpperCase() || 'FILE';
                      const isDeleting = deletingFile === doc.filename;
                      return (
                        <div
                          key={doc.filename}
                          className={`p-2.5 flex items-center justify-between text-xs transition-colors ${
                            D ? 'hover:bg-slate-800/30' : 'hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-center space-x-2 min-w-0 pr-2">
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold shrink-0 ${
                              ext === 'PDF'
                                ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                                : ext === 'CSV'
                                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                  : 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'
                            }`}>
                              {ext}
                            </span>
                            <div className="truncate">
                              <div className="truncate font-medium text-xs" title={doc.filename}>{doc.filename}</div>
                              <div className={`text-[10px] ${mut} flex items-center space-x-1 mt-0.5`}>
                                <span className="text-indigo-400 font-mono">{doc.chunks} chunks</span>
                                <span>•</span>
                                <span className="text-emerald-400 flex items-center space-x-0.5">
                                  <Check className="w-2.5 h-2.5 inline" />
                                  <span>Vectorized</span>
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="shrink-0">
                            {deleteConfirm === doc.filename ? (
                              <div className="flex items-center space-x-1">
                                <button
                                  onClick={() => handleDeleteDocument(doc.filename)}
                                  disabled={isDeleting}
                                  className="px-2 py-0.5 rounded bg-red-600 text-white text-[10px] font-semibold hover:bg-red-500 cursor-pointer"
                                >
                                  {isDeleting ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : 'Ya'}
                                </button>
                                <button
                                  onClick={() => setDeleteConfirm(null)}
                                  className={`px-1.5 py-0.5 rounded text-[10px] border cursor-pointer ${D ? 'border-slate-700 hover:bg-slate-700' : 'border-slate-300 hover:bg-slate-200'}`}
                                >
                                  Batal
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setDeleteConfirm(doc.filename)}
                                className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                                title={`Hapus ${doc.filename} dari obrolan ini`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

            </div>
          }

          {/* Right Sidebar Footer */}
          <div className={`p-2.5 border-t text-[11px] flex items-center justify-between ${D ? 'border-slate-800 bg-slate-950/40 text-slate-400' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
            <span className="flex items-center space-x-1.5">
              <CheckCircle className="w-3 h-3 text-emerald-400" />
              <span>ChromaDB Namespace</span>
            </span>
            <span className="font-mono text-[10px] text-indigo-400 truncate max-w-[120px]">{activeThread?.id}</span>
          </div>
        </aside>

      </div>

      {/* SETTINGS MODAL */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className={`max-w-md w-full p-6 rounded-2xl border shadow-2xl relative ${D ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-800'}`}>
            <button
              onClick={() => setIsSettingsOpen(false)}
              className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-400 hover:text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
            <h3 className="text-base font-bold mb-4 flex items-center space-x-2">
              <Settings className="w-5 h-5 text-indigo-400" />
              <span>Pengaturan Koneksi Backend</span>
            </h3>
            <div className="space-y-4 text-xs">
              <div>
                <label className={`block mb-1 font-medium ${mut}`}>FastAPI Base URL</label>
                <div className="flex items-center space-x-2">
                  <div className={`p-2.5 rounded-xl border ${D ? 'bg-slate-800 border-slate-700 text-slate-400' : 'bg-slate-100 border-slate-200 text-slate-500'}`}>
                    <Link2 className="w-4 h-4" />
                  </div>
                  <input
                    type="text"
                    value={baseUrl}
                    onChange={e => setBaseUrl(e.target.value)}
                    className={`flex-1 p-2.5 rounded-xl border outline-none ${inp}`}
                    placeholder="http://localhost:8000"
                  />
                </div>
              </div>
              <div className={`p-3 rounded-xl border flex items-center justify-between ${D ? 'border-slate-800 bg-slate-950/50' : 'border-slate-200 bg-slate-50'}`}>
                <div>
                  <div className={`font-semibold ${D ? 'text-slate-200' : 'text-slate-700'}`}>Mock API Mode</div>
                  <div className={`text-[11px] ${mut}`}>Simulasi respon lokal saat FastAPI offline</div>
                </div>
                <input
                  type="checkbox"
                  checked={mockMode}
                  onChange={e => {
                    setMockMode(e.target.checked);
                    addLog(`Mock Mode: ${e.target.checked}`, 'info');
                  }}
                  className="w-4 h-4 accent-indigo-600 cursor-pointer"
                />
              </div>
              <div className={`p-3 rounded-xl border text-[11px] ${D ? 'border-slate-800 bg-slate-950/30 text-slate-500' : 'border-slate-200 bg-slate-50 text-slate-400'}`}>
                <div className="flex items-center space-x-1.5 font-semibold mb-1 text-slate-400">
                  <Server className="w-3.5 h-3.5" />
                  <span>API Endpoints (Terisolasi per Obrolan)</span>
                </div>
                <ul className="space-y-0.5 font-mono">
                  <li>GET /documents?thread_id=:id</li>
                  <li>POST /upload (file, thread_id)</li>
                  <li>POST /query &#123;question, thread_id&#125;</li>
                  <li>DELETE /documents/:file?thread_id=:id</li>
                  <li>DELETE /obrolan/:obrolan_id/documents</li>
                </ul>
              </div>
            </div>
            <button
              onClick={() => setIsSettingsOpen(false)}
              className="w-full mt-6 py-2.5 rounded-xl bg-indigo-600 text-white font-semibold text-xs hover:bg-indigo-500 transition-colors cursor-pointer"
            >
              Simpan Pengaturan
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Chat bubble component
function ChatBubble({ message, isDark }: { message: ChatMessage; isDark: boolean }) {
  const u = message.sender === 'user';
  const [copied, setCopied] = useState(false);

  const htmlContent = useMemo(() => {
    if (u) return null;
    const rawHtml = marked.parse(message.text) as string;
    return DOMPurify.sanitize(rawHtml);
  }, [message.text, u]);

  const handleCopy = () => {
    navigator.clipboard.writeText(message.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`flex items-start space-x-3 ${u ? 'flex-row-reverse space-x-reverse' : ''}`}>
      <div
        className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 text-white shadow-md ${
          u ? 'bg-indigo-600' : 'bg-gradient-to-tr from-violet-600 to-indigo-600'
        }`}
      >
        {u ? <MessageSquare className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
      </div>
      <div
        className={`max-w-[85%] rounded-2xl p-4 border text-xs leading-relaxed space-y-3 relative group ${
          u
            ? 'bg-indigo-600 text-white border-indigo-500'
            : isDark
              ? 'bg-slate-900/80 border-slate-800 text-slate-200'
              : 'bg-white border-slate-200 text-slate-800 shadow-sm'
        }`}
      >
        {u ? (
          <div className="whitespace-pre-wrap font-sans">{message.text}</div>
        ) : (
          <div
            className="markdown-content font-sans text-xs"
            dangerouslySetInnerHTML={{ __html: htmlContent || '' }}
          />
        )}

        {/* Source References */}
        {!u && message.sources && message.sources.length > 0 && (
          <div className="pt-2 border-t border-slate-800/80">
            <div className="text-[11px] font-bold text-indigo-400 mb-2 flex items-center space-x-1.5">
              <FileText className="w-3.5 h-3.5" />
              <span>Sumber Rujukan Dokumen ({message.sources.length}):</span>
            </div>
            <div className="space-y-1.5">
              {message.sources.map((s, i) => (
                <SourceCard key={i} source={s} index={i + 1} />
              ))}
            </div>
          </div>
        )}

        {/* Timestamp & copy action */}
        <div className="flex items-center justify-between pt-1 text-[10px] opacity-60">
          <span>{message.timestamp}</span>
          {!u && (
            <button
              onClick={handleCopy}
              className="opacity-0 group-hover:opacity-100 flex items-center space-x-1 hover:text-indigo-400 transition-opacity cursor-pointer"
              title="Salin jawaban"
            >
              {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              <span>{copied ? 'Tersalin' : 'Salin'}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Source accordion component
function SourceCard({ source, index }: { source: Source; index: number }) {
  const [open, setOpen] = useState(false);
  const name = source.source.split(/[/\\]/).pop() || source.source;
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 overflow-hidden text-[11px]">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-2.5 py-1.5 flex items-center justify-between text-slate-300 hover:bg-slate-800/50 transition-colors text-left cursor-pointer"
      >
        <span className="font-semibold truncate max-w-[240px]">
          #{index}. {name}{source.page != null && ` (Hal: ${source.page + 1})`}
        </span>
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </button>
      {open && (
        <div className="p-2.5 border-t border-slate-800 text-slate-400 font-mono text-[10px] bg-slate-950/90 leading-relaxed">
          {source.content_preview}
        </div>
      )}
    </div>
  );
}
