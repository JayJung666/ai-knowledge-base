import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import {
  Database, Upload, MessageSquare, Settings, Trash2, FileText,
  CheckCircle, Cpu, Layers, ChevronDown, ChevronRight,
  Send, Sparkles, Terminal, Activity, HardDrive, Moon, Sun, X, File,
  Server, Zap, Check, Link2, RefreshCw, FilePlus2, Loader2,
} from 'lucide-react';

marked.setOptions({
  gfm: true,
  breaks: true,
});

interface Source { source: string; page?: number | null; content_preview: string; }
interface ChatMessage { id: string; sender: 'user' | 'ai'; text: string; timestamp: string; sources?: Source[]; }
interface KBDocument { source: string; filename: string; chunks: number; }
interface UploadQueueItem { file: File; status: 'pending' | 'uploading' | 'done' | 'error'; progress: number; chunks?: number; error?: string; }
interface LogEntry { id: number; type: 'info' | 'success' | 'error' | 'warn'; time: string; msg: string; }

function formatBytes(b: number) {
  if (!b) return '0 B';
  const k = 1024, s = ['B','KB','MB','GB'], i = Math.floor(Math.log(b)/Math.log(k));
  return `${+(b/Math.pow(k,i)).toFixed(2)} ${s[i]}`;
}

export default function App() {
  const [baseUrl, setBaseUrl] = useState(() => (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/+$/, ''));
  const [mockMode, setMockMode] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat'|'documents'|'logs'>('chat');
  const [theme, setTheme] = useState<'dark'|'light'>('dark');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [apiConnected, setApiConnected] = useState(false);
  const [kbDocs, setKbDocs] = useState<KBDocument[]>([]);
  const [statsLoading, setStatsLoading] = useState(false);
  const totalChunks = kbDocs.reduce((s,d) => s+d.chunks, 0);
  const [messages, setMessages] = useState<ChatMessage[]>([{
    id:'1', sender:'ai',
    text:'Halo! Saya asisten RAG AI Knowledge Base kamu. Silakan ajukan pertanyaan seputar dokumen yang telah diunggah.',
    timestamp: new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}), sources:[],
  }]);
  const [inputQuery, setInputQuery] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [deletingFile, setDeletingFile] = useState<string|null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string|null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([
    {id:1,type:'info',time:new Date().toLocaleTimeString(),msg:'Aplikasi UI berhasil diinisialisasi.'},
  ]);

  const addLog = useCallback((msg: string, type: LogEntry['type'] = 'info') => {
    setLogs(p => [{id:Date.now(),type,time:new Date().toLocaleTimeString(),msg},...p]);
  }, []);

  // Health check
  useEffect(() => {
    const check = async () => {
      if (mockMode) { setApiConnected(true); return; }
      try {
        const c = new AbortController();
        const t = setTimeout(() => c.abort(), 2500);
        const r = await fetch(`${baseUrl}/docs`, {signal:c.signal});
        clearTimeout(t);
        setApiConnected(r.ok || r.status === 200);
      } catch { setApiConnected(false); }
    };
    check(); const iv = setInterval(check, 10000); return () => clearInterval(iv);
  }, [baseUrl, mockMode]);

  // Fetch documents list from ChromaDB
  const fetchDocuments = useCallback(async () => {
    if (mockMode) return;
    setStatsLoading(true);
    try {
      const r = await fetch(`${baseUrl}/documents`);
      if (r.ok) {
        const d = await r.json();
        setKbDocs(d.documents || []);
        addLog(`GET /documents - ${d.total} dokumen dimuat.`, 'success');
      }
    } catch { addLog('GET /documents - Gagal.', 'error'); }
    finally { setStatsLoading(false); }
  }, [baseUrl, mockMode, addLog]);

  useEffect(() => { fetchDocuments(); }, [fetchDocuments]);
  useEffect(() => { chatBottomRef.current?.scrollIntoView({behavior:'smooth'}); }, [messages, isGenerating]);

  // Send query
  const handleSendQuery = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputQuery.trim() || isGenerating) return;
    const t = inputQuery.trim(); setInputQuery('');
    setMessages(p => [...p, {id:Date.now().toString(),sender:'user',text:t,timestamp:new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}]);
    setIsGenerating(true);
    addLog(`POST /query - "${t}"`, 'info');
    if (mockMode) {
      setTimeout(() => {
        setMessages(p => [...p, {id:(Date.now()+1).toString(),sender:'ai',
          text:`[Mock] Jawaban untuk: "${t}"\n\n1. Poin pertama dari dokumen.\n2. Poin kedua dari dokumen.\n3. Kesimpulan berdasarkan konteks.`,
          sources:[{source:'./temp/sample.pdf',page:0,content_preview:'Cuplikan konten mock dari dokumen.'}],
          timestamp:new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}]);
        setIsGenerating(false); addLog('POST /query - OK (Mock).','success');
      }, 1200); return;
    }
    try {
      const r = await fetch(`${baseUrl}/query`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:t})});
      if (!r.ok) throw new Error((await r.json().catch(()=>({}))).detail || 'Error');
      const d = await r.json();
      setMessages(p => [...p, {id:(Date.now()+1).toString(),sender:'ai',text:d.answer,sources:d.sources||[],timestamp:new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}]);
      addLog(`POST /query - OK (${d.sources?.length||0} sumber).`, 'success');
    } catch(err: unknown) {
      const m = err instanceof Error ? err.message : 'Error';
      addLog(`POST /query Error: ${m}`, 'error');
      setMessages(p => [...p, {id:(Date.now()+1).toString(),sender:'ai',
        text:`Gagal: ${m}\n\nAktifkan Mock Mode atau pastikan backend berjalan.`,sources:[],
        timestamp:new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}]);
    } finally { setIsGenerating(false); }
  };

  // File queue management
  const addFilesToQueue = (files: FileList | File[]) => {
    const ok = ['.pdf','.txt','.docx','.doc','.csv'];
    const items: UploadQueueItem[] = [];
    Array.from(files).forEach(f => {
      const ext = '.' + f.name.split('.').pop()?.toLowerCase();
      if (ok.includes(ext)) items.push({file:f,status:'pending',progress:0});
      else addLog(`'${f.name}' ditolak - format tidak didukung.`, 'warn');
    });
    setUploadQueue(p => [...p, ...items]);
  };

  const uploadSingleFile = useCallback(async (item: UploadQueueItem, idx: number) => {
    setUploadQueue(p => p.map((q,i) => i===idx ? {...q,status:'uploading',progress:30} : q));
    addLog(`POST /upload - ${item.file.name}`, 'info');
    if (mockMode) {
      await new Promise(r => setTimeout(r, 900));
      const ch = Math.floor(Math.random()*15)+5;
      setUploadQueue(p => p.map((q,i) => i===idx ? {...q,status:'done',progress:100,chunks:ch} : q));
      setKbDocs(p => [...p, {source:`./temp/${item.file.name}`,filename:item.file.name,chunks:ch}]);
      addLog(`POST /upload - OK (Mock): '${item.file.name}' (${ch} chunks).`, 'success'); return;
    }
    try {
      const form = new FormData(); form.append('file', item.file);
      setUploadQueue(p => p.map((q,i) => i===idx ? {...q,progress:60} : q));
      const r = await fetch(`${baseUrl}/upload`, {method:'POST',body:form});
      if (!r.ok) throw new Error((await r.json().catch(()=>({}))).detail || 'Upload gagal');
      const d = await r.json(); const ch = d.processed_chunks || 0;
      setUploadQueue(p => p.map((q,i) => i===idx ? {...q,status:'done',progress:100,chunks:ch} : q));
      addLog(`POST /upload - OK: '${item.file.name}' (${ch} chunks).`, 'success');
      fetchDocuments();
    } catch(err: unknown) {
      const m = err instanceof Error ? err.message : 'Error';
      setUploadQueue(p => p.map((q,i) => i===idx ? {...q,status:'error',progress:0,error:m} : q));
      addLog(`POST /upload Error: ${m}`, 'error');
    }
  }, [baseUrl, mockMode, addLog, fetchDocuments]);

  const handleUploadAll = async () => {
    const pending = uploadQueue.map((item,i) => ({item,i})).filter(({item}) => item.status==='pending');
    for (const {item,i} of pending) await uploadSingleFile(item, i);
  };

  // Delete single document from ChromaDB
  const handleDeleteDocument = async (filename: string) => {
    setDeletingFile(filename);
    addLog(`DELETE /documents/${filename}`, 'info');
    if (mockMode) {
      await new Promise(r => setTimeout(r, 700));
      setKbDocs(p => p.filter(d => d.filename !== filename));
      setDeletingFile(null); setDeleteConfirm(null);
      addLog(`DELETE - OK (Mock): '${filename}'.`, 'success'); return;
    }
    try {
      const r = await fetch(`${baseUrl}/documents/${encodeURIComponent(filename)}`, {method:'DELETE'});
      if (!r.ok) throw new Error((await r.json().catch(()=>({}))).detail || 'Gagal');
      const d = await r.json();
      setKbDocs(p => p.filter(x => x.filename !== filename));
      addLog(`DELETE - OK: '${filename}' (${d.deleted_chunks} chunks dihapus).`, 'success');
    } catch(err: unknown) {
      addLog(`DELETE Error: ${err instanceof Error?err.message:'Error'}`, 'error');
    } finally { setDeletingFile(null); setDeleteConfirm(null); }
  };


  const D = theme === 'dark';
  const card = D ? 'bg-slate-900/60 border-slate-800/80 hover:border-slate-700' : 'bg-white border-slate-200 shadow-sm hover:border-slate-300';
  const surf = D ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200';
  const mut = D ? 'text-slate-400' : 'text-slate-500';
  const inp = D ? 'bg-slate-950 border-slate-700 text-slate-100 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500' : 'bg-white border-slate-300 text-slate-800 focus:border-indigo-500';
  const pend = uploadQueue.filter(q => q.status==='pending').length;
  const upling = uploadQueue.filter(q => q.status==='uploading').length;

  return (
    <div className={`min-h-screen flex flex-col font-sans transition-colors duration-200 ${D?'bg-slate-950 text-slate-100':'bg-slate-50 text-slate-800'}`}>

      {/* HEADER */}
      <header className={`sticky top-0 z-30 border-b backdrop-blur-md px-4 lg:px-8 py-3 flex items-center justify-between ${D?'bg-slate-900/80 border-slate-800':'bg-white/80 border-slate-200 shadow-sm'}`}>
        <div className="flex items-center space-x-3">
          <div className="bg-gradient-to-tr from-indigo-600 to-violet-500 p-2.5 rounded-xl text-white shadow-lg shadow-indigo-500/20">
            <Database className="w-6 h-6"/>
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-lg font-bold tracking-tight">RAG Knowledge Base</h1>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">FastAPI + Groq</span>
            </div>
            <p className={`text-xs hidden sm:block ${mut}`}>Engineered for Fast AI Context Retrieval &amp; Vector Search</p>
          </div>
        </div>
        <div className="flex items-center space-x-3">
          <div className={`flex items-center space-x-2 text-xs px-3 py-1.5 rounded-full border transition-all ${apiConnected?'bg-emerald-500/10 text-emerald-400 border-emerald-500/30':'bg-amber-500/10 text-amber-400 border-amber-500/30'}`}>
            <span className={`w-2 h-2 rounded-full ${apiConnected?'bg-emerald-400 animate-pulse':'bg-amber-400'}`}/>
            <span className="font-medium hidden md:inline">{mockMode?'Mock Engine Active':apiConnected?'Backend Connected':'Backend Offline'}</span>
          </div>
          <button onClick={() => setTheme(D?'light':'dark')} className={`p-2 rounded-xl border transition-colors ${D?'bg-slate-800 border-slate-700 hover:bg-slate-700 text-slate-300':'bg-slate-100 border-slate-200 hover:bg-slate-200 text-slate-700'}`} title="Tema">
            {D?<Sun className="w-4 h-4"/>:<Moon className="w-4 h-4"/>}
          </button>
          <button onClick={() => setIsSettingsOpen(true)} className={`p-2 rounded-xl border transition-colors ${D?'bg-slate-800 border-slate-700 hover:bg-slate-700 text-slate-300':'bg-slate-100 border-slate-200 hover:bg-slate-200 text-slate-700'}`} title="Pengaturan">
            <Settings className="w-4 h-4"/>
          </button>
        </div>
      </header>

      {/* STATS */}
      <section className="px-4 lg:px-8 py-5 grid grid-cols-2 md:grid-cols-4 gap-4 max-w-7xl mx-auto w-full">
        <div className={`p-4 rounded-2xl border transition-all ${card}`}>
          <div className={`flex items-center justify-between text-xs mb-2 ${mut}`}><span>Total Dokumen</span><FileText className="w-4 h-4 text-indigo-400"/></div>
          <div className="text-2xl font-bold">{kbDocs.length}</div>
          <span className={`text-[11px] ${mut}`}>PDF, DOCX, CSV, TXT</span>
        </div>
        <div className={`p-4 rounded-2xl border transition-all ${card}`}>
          <div className={`flex items-center justify-between text-xs mb-2 ${mut}`}><span>Total Chunks Vektor</span><Layers className="w-4 h-4 text-violet-400"/></div>
          <div className="text-2xl font-bold">{totalChunks}</div>
          <span className={`text-[11px] ${mut}`}>chunk_size=800, overlap=100</span>
        </div>
        <div className={`p-4 rounded-2xl border transition-all ${card}`}>
          <div className={`flex items-center justify-between text-xs mb-2 ${mut}`}><span>Vector Store</span><HardDrive className="w-4 h-4 text-emerald-400"/></div>
          <div className="text-lg font-bold text-emerald-400 flex items-center space-x-1.5"><CheckCircle className="w-4 h-4"/><span>ChromaDB</span></div>
          <span className={`text-[11px] ${mut}`}>all-MiniLM-L6-v2 (FastEmbed)</span>
        </div>
        <div className={`p-4 rounded-2xl border transition-all ${card}`}>
          <div className={`flex items-center justify-between text-xs mb-2 ${mut}`}><span>LLM Provider</span><Cpu className="w-4 h-4 text-sky-400"/></div>
          <div className="text-sm font-bold text-sky-400 truncate">Groq qwen/qwen3.8-27b</div>
          <span className={`text-[11px] ${mut}`}>Ultra-fast Inference</span>
        </div>
      </section>

      {/* TABS */}
      <div className="px-4 lg:px-8 max-w-7xl mx-auto w-full mb-4">
        <div className={`flex space-x-1 p-1 rounded-xl border ${D?'bg-slate-900 border-slate-800':'bg-slate-200/60 border-slate-300'}`}>
          {([
            ['chat','AI Chat & Search',MessageSquare],
            ['documents',`Kelola Dokumen (${kbDocs.length})`,Upload],
            ['logs','Logs & System',Activity],
          ] as const).map(([tab, label, Icon]) => (
            <button key={tab} onClick={() => setActiveTab(tab as 'chat'|'documents'|'logs')}
              className={`flex-1 flex items-center justify-center space-x-2 py-2.5 rounded-lg text-xs font-semibold transition-all ${activeTab===tab?(D?'bg-indigo-600 text-white shadow-md':'bg-white text-indigo-600 shadow'):`${mut} hover:text-slate-200`}`}>
              <Icon className="w-4 h-4"/><span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* MAIN */}
      <main className="flex-1 px-4 lg:px-8 pb-8 max-w-7xl mx-auto w-full flex flex-col min-h-0">

        {/* TAB: CHAT */}
        {activeTab === 'chat' && (
          <div className={`flex-1 flex flex-col rounded-2xl border overflow-hidden shadow-xl ${D?'bg-slate-900/70 border-slate-800':'bg-white border-slate-200'}`}>
            <div className="flex-1 p-4 lg:p-6 overflow-y-auto space-y-5 min-h-[420px] max-h-[560px]">
              {messages.map(msg => <ChatBubble key={msg.id} message={msg} isDark={D}/>)}
              {isGenerating && (
                <div className="flex items-start space-x-3">
                  <div className="p-2 rounded-xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 animate-pulse">
                    <Sparkles className="w-5 h-5 animate-spin"/>
                  </div>
                  <div className={`p-4 rounded-2xl border text-xs flex items-center space-x-3 ${D?'bg-slate-800/50 border-slate-700/80 text-slate-300':'bg-slate-100 border-slate-200 text-slate-600'}`}>
                    <span className="w-2 h-2 rounded-full bg-indigo-400 animate-ping inline-block"/>
                    <span>Mencari vektor di ChromaDB &amp; menulis jawaban via Groq LLM...</span>
                  </div>
                </div>
              )}
              <div ref={chatBottomRef}/>
            </div>
            <div className={`p-3 lg:p-4 border-t ${D?'bg-slate-900 border-slate-800':'bg-slate-50 border-slate-200'}`}>
              <form onSubmit={handleSendQuery} className="flex items-center space-x-2">
                <input type="text" value={inputQuery} onChange={e=>setInputQuery(e.target.value)}
                  placeholder="Ketik pertanyaan seputar isi dokumen kamu..." disabled={isGenerating}
                  className={`flex-1 px-4 py-3 text-sm rounded-xl border outline-none transition-all ${inp}`}/>
                <button type="submit" disabled={!inputQuery.trim()||isGenerating}
                  className="px-5 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-medium text-sm hover:from-indigo-500 hover:to-violet-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2 shadow-lg shadow-indigo-500/25 transition-all">
                  <span>Kirim</span><Send className="w-4 h-4"/>
                </button>
              </form>
            </div>
          </div>
        )}

        {/* TAB: DOCUMENTS */}
        {activeTab === 'documents' && (
          <div className="space-y-6">
            {/* Drag & Drop Zone - supports multiple files */}
            <div
              onDragOver={e=>{e.preventDefault();setIsDragging(true);}}
              onDragLeave={()=>setIsDragging(false)}
              onDrop={e=>{e.preventDefault();setIsDragging(false);e.dataTransfer.files?.length&&addFilesToQueue(e.dataTransfer.files);}}
              onClick={()=>fileInputRef.current?.click()}
              className={`p-8 rounded-2xl border-2 border-dashed transition-all flex flex-col items-center justify-center text-center cursor-pointer ${isDragging?'border-indigo-500 bg-indigo-500/10 scale-[0.99]':D?'border-slate-700 bg-slate-900/40 hover:border-slate-600':'border-slate-300 bg-white hover:border-slate-400'}`}>
              <div className="p-3 rounded-2xl bg-indigo-500/10 text-indigo-400 mb-3 border border-indigo-500/20"><FilePlus2 className="w-8 h-8"/></div>
              <h3 className="text-base font-semibold mb-1">Unggah Banyak Dokumen Sekaligus</h3>
              <p className={`text-xs mb-3 max-w-md ${mut}`}>Tarik dan lepaskan berkas di sini, atau klik area ini. Mendukung <strong>.PDF, .DOCX, .CSV, .TXT</strong>.</p>
              <input ref={fileInputRef} type="file" multiple accept=".pdf,.docx,.doc,.csv,.txt" className="hidden"
                onChange={e=>e.target.files&&addFilesToQueue(e.target.files)}/>
              <span className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold pointer-events-none">Pilih Berkas</span>
            </div>

            {/* Upload Queue */}
            {uploadQueue.length > 0 && (
              <div className={`rounded-2xl border overflow-hidden ${surf}`}>
                <div className={`p-4 border-b ${D?'border-slate-800':'border-slate-200'} flex items-center justify-between`}>
                  <h2 className="text-sm font-bold flex items-center space-x-2">
                    <Upload className="w-4 h-4 text-indigo-400"/><span>Antrian Upload ({uploadQueue.length} file)</span>
                  </h2>
                  <div className="flex items-center space-x-2">
                    {pend > 0 && upling === 0 && (
                      <button onClick={handleUploadAll} className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-500 transition-colors">
                        <Zap className="w-3.5 h-3.5"/><span>Upload Semua ({pend})</span>
                      </button>
                    )}
                    {upling > 0 && <span className="text-xs text-indigo-400 flex items-center space-x-1"><Loader2 className="w-3.5 h-3.5 animate-spin"/><span>Mengupload {upling} file...</span></span>}
                    <button onClick={()=>setUploadQueue([])} className={`text-xs ${mut} hover:text-red-400 transition-colors`}>Bersihkan</button>
                  </div>
                </div>
                <div className="divide-y divide-slate-800/30">
                  {uploadQueue.map((item, i) => (
                    <div key={i} className={`flex items-center space-x-3 p-3 ${D?'hover:bg-slate-800/20':'hover:bg-slate-50'}`}>
                      <div className={`p-2 rounded-lg flex-shrink-0 ${D?'bg-slate-800':'bg-slate-100'}`}>
                        <File className={`w-4 h-4 ${item.status==='done'?'text-emerald-400':item.status==='error'?'text-red-400':'text-indigo-400'}`}/>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium truncate max-w-xs">{item.file.name}</span>
                          <span className={`text-[10px] ${mut}`}>{formatBytes(item.file.size)}</span>
                        </div>
                        {item.status==='uploading' && <div className={`w-full h-1 rounded-full overflow-hidden ${D?'bg-slate-700':'bg-slate-200'}`}><div className="h-full bg-indigo-500 animate-pulse" style={{width:`${item.progress}%`}}/></div>}
                        {item.status==='done' && <span className="text-[10px] text-emerald-400 font-medium">Berhasil - {item.chunks} chunks</span>}
                        {item.status==='error' && <span className="text-[10px] text-red-400">{item.error}</span>}
                        {item.status==='pending' && <span className={`text-[10px] ${mut}`}>Menunggu upload...</span>}
                      </div>
                      <div className="flex items-center space-x-1 flex-shrink-0">
                        {item.status==='pending' && <button onClick={()=>uploadSingleFile(item,i)} className="p-1.5 rounded-lg text-indigo-400 hover:bg-indigo-500/10 transition-colors" title="Upload"><Upload className="w-3.5 h-3.5"/></button>}
                        <button onClick={()=>setUploadQueue(p=>p.filter((_,j)=>j!==i))} className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 transition-colors" title="Hapus"><X className="w-3.5 h-3.5"/></button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Knowledge Base Documents Table */}
            <div className={`rounded-2xl border overflow-hidden ${surf}`}>
              <div className={`p-4 border-b ${D?'border-slate-800':'border-slate-200'} flex items-center justify-between`}>
                <h2 className="text-sm font-bold flex items-center space-x-2">
                  <FileText className="w-4 h-4 text-indigo-400"/><span>Daftar Dokumen dalam Knowledge Base</span>
                </h2>
                <div className="flex items-center space-x-3">
                  <span className={`text-xs ${mut}`}>{kbDocs.length} File Terdaftar</span>
                  <button onClick={fetchDocuments} disabled={statsLoading} className={`p-1.5 rounded-lg ${mut} hover:text-indigo-400 transition-colors`} title="Refresh">
                    <RefreshCw className={`w-3.5 h-3.5 ${statsLoading?'animate-spin':''}`}/>
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className={`border-b uppercase font-semibold text-[10px] tracking-wider ${D?'bg-slate-950/50 border-slate-800 text-slate-400':'bg-slate-50 border-slate-200 text-slate-500'}`}>
                    <tr>
                      <th className="p-3.5">Nama Dokumen</th>
                      <th className="p-3.5">Tipe</th>
                      <th className="p-3.5">Chunks</th>
                      <th className="p-3.5">Status</th>
                      <th className="p-3.5 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${D?'divide-slate-800/40':'divide-slate-100'}`}>
                    {kbDocs.length === 0 ? (
                      <tr><td colSpan={5} className={`p-8 text-center ${mut}`}>
                        {statsLoading
                          ? <span className="flex items-center justify-center space-x-2"><Loader2 className="w-4 h-4 animate-spin"/><span>Memuat dokumen...</span></span>
                          : 'Belum ada dokumen di database. Upload file untuk memulai.'}
                      </td></tr>
                    ) : kbDocs.map(doc => {
                      const ext = doc.filename.split('.').pop()?.toUpperCase() || 'FILE';
                      const isDeleting = deletingFile === doc.filename;
                      return (
                        <tr key={doc.filename} className={D?'hover:bg-slate-800/30':'hover:bg-slate-50'}>
                          <td className="p-3.5"><div className="flex items-center space-x-2"><File className="w-4 h-4 text-indigo-400 shrink-0"/><span className="truncate max-w-xs font-medium">{doc.filename}</span></div></td>
                          <td className="p-3.5"><span className={`px-2 py-0.5 rounded text-[10px] font-mono ${D?'bg-slate-800 border border-slate-700':'bg-slate-100 border border-slate-200'}`}>{ext}</span></td>
                          <td className="p-3.5 font-mono text-indigo-400">{doc.chunks} chunks</td>
                          <td className="p-3.5"><span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"><Check className="w-3 h-3"/><span>Ingested</span></span></td>
                          <td className="p-3.5 text-right">
                            {deleteConfirm === doc.filename ? (
                              <div className="flex items-center justify-end space-x-2">
                                <span className="text-[10px] text-red-400">Hapus?</span>
                                <button onClick={()=>handleDeleteDocument(doc.filename)} disabled={isDeleting} className="px-2 py-1 rounded-lg bg-red-600 text-white text-[10px] font-semibold hover:bg-red-500 disabled:opacity-50">
                                  {isDeleting?<Loader2 className="w-3 h-3 animate-spin"/>:'Ya'}
                                </button>
                                <button onClick={()=>setDeleteConfirm(null)} className={`px-2 py-1 rounded-lg text-[10px] border ${D?'border-slate-700 hover:bg-slate-700':'border-slate-300 hover:bg-slate-100'}`}>Batal</button>
                              </div>
                            ) : (
                              <button onClick={()=>setDeleteConfirm(doc.filename)} className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors" title={`Hapus ${doc.filename}`}>
                                <Trash2 className="w-3.5 h-3.5"/>
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}

        {/* TAB: LOGS */}
        {activeTab === 'logs' && (
          <div className={`p-4 rounded-2xl border font-mono text-xs flex flex-col h-[500px] ${D?'bg-slate-950 border-slate-800 text-slate-300':'bg-slate-900 border-slate-800 text-slate-200'}`}>
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
              <div className="flex items-center space-x-2"><Terminal className="w-4 h-4 text-indigo-400"/><span className="font-bold text-slate-200">System &amp; API Event Log</span></div>
              <button onClick={()=>setLogs([])} className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors">Clear Logs</button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-2 pr-2">
              {logs.map(log => (
                <div key={log.id} className="flex items-start space-x-2 leading-relaxed">
                  <span className="text-slate-500 select-none">[{log.time}]</span>
                  <span className={`px-1.5 rounded text-[10px] uppercase font-bold ${log.type==='success'?'bg-emerald-500/20 text-emerald-400':log.type==='error'?'bg-red-500/20 text-red-400':log.type==='warn'?'bg-amber-500/20 text-amber-400':'bg-sky-500/20 text-sky-400'}`}>{log.type}</span>
                  <span className="flex-1">{log.msg}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>


      {/* SETTINGS MODAL */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className={`max-w-md w-full p-6 rounded-2xl border shadow-2xl relative ${D?'bg-slate-900 border-slate-800 text-slate-100':'bg-white border-slate-200 text-slate-800'}`}>
            <button onClick={()=>setIsSettingsOpen(false)} className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-400 hover:text-white"><X className="w-4 h-4"/></button>
            <h3 className="text-base font-bold mb-4 flex items-center space-x-2"><Settings className="w-5 h-5 text-indigo-400"/><span>Pengaturan Koneksi Backend</span></h3>
            <div className="space-y-4 text-xs">
              <div>
                <label className={`block mb-1 font-medium ${mut}`}>FastAPI Base URL</label>
                <div className="flex items-center space-x-2">
                  <div className={`p-2.5 rounded-xl border ${D?'bg-slate-800 border-slate-700 text-slate-400':'bg-slate-100 border-slate-200 text-slate-500'}`}><Link2 className="w-4 h-4"/></div>
                  <input type="text" value={baseUrl} onChange={e=>setBaseUrl(e.target.value)} className={`flex-1 p-2.5 rounded-xl border outline-none ${inp}`} placeholder="http://localhost:8000"/>
                </div>
              </div>
              <div className={`p-3 rounded-xl border flex items-center justify-between ${D?'border-slate-800 bg-slate-950/50':'border-slate-200 bg-slate-50'}`}>
                <div>
                  <div className={`font-semibold ${D?'text-slate-200':'text-slate-700'}`}>Mock API Mode</div>
                  <div className={`text-[11px] ${mut}`}>Simulasi respon lokal saat FastAPI offline</div>
                </div>
                <input type="checkbox" checked={mockMode} onChange={e=>{setMockMode(e.target.checked);addLog(`Mock Mode: ${e.target.checked}`,'info');}} className="w-4 h-4 accent-indigo-600 cursor-pointer"/>
              </div>
              <div className={`p-3 rounded-xl border text-[11px] ${D?'border-slate-800 bg-slate-950/30 text-slate-500':'border-slate-200 bg-slate-50 text-slate-400'}`}>
                <div className="flex items-center space-x-1.5 font-semibold mb-1 text-slate-400"><Server className="w-3.5 h-3.5"/><span>API Endpoints</span></div>
                <ul className="space-y-0.5 font-mono">
                  <li>GET /documents</li><li>POST /upload</li><li>POST /query</li>
                  <li>DELETE /documents/:filename</li><li>DELETE /reset-knowledge-base</li>
                </ul>
              </div>
            </div>
            <button onClick={()=>setIsSettingsOpen(false)} className="w-full mt-6 py-2.5 rounded-xl bg-indigo-600 text-white font-semibold text-xs hover:bg-indigo-500 transition-colors">Simpan Pengaturan</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Chat bubble component
function ChatBubble({message, isDark}: {message: ChatMessage; isDark: boolean}) {
  const u = message.sender === 'user';

  const htmlContent = useMemo(() => {
    if (u) return null;
    const rawHtml = marked.parse(message.text) as string;
    return DOMPurify.sanitize(rawHtml);
  }, [message.text, u]);

  return (
    <div className={`flex items-start space-x-3 ${u?'flex-row-reverse space-x-reverse':''}`}>
      <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 text-white shadow-md ${u?'bg-indigo-600':'bg-gradient-to-tr from-violet-600 to-indigo-600'}`}>
        {u ? <MessageSquare className="w-4 h-4"/> : <Sparkles className="w-4 h-4"/>}
      </div>
      <div className={`max-w-[85%] rounded-2xl p-4 border text-xs leading-relaxed space-y-3 ${u?'bg-indigo-600 text-white border-indigo-500':isDark?'bg-slate-800/60 border-slate-700/80 text-slate-200':'bg-slate-100 border-slate-200 text-slate-800'}`}>
        {u ? (
          <div className="whitespace-pre-wrap font-sans">{message.text}</div>
        ) : (
          <div
            className="markdown-content font-sans text-xs"
            dangerouslySetInnerHTML={{ __html: htmlContent || '' }}
          />
        )}
        {!u && message.sources && message.sources.length > 0 && (
          <div className="pt-2 border-t border-slate-700/50">
            <div className="text-[11px] font-bold text-indigo-400 mb-2 flex items-center space-x-1.5">
              <FileText className="w-3.5 h-3.5"/><span>Sumber Rujukan ({message.sources.length}):</span>
            </div>
            <div className="space-y-2">
              {message.sources.map((s,i) => <SourceCard key={i} source={s} index={i+1}/>)}
            </div>
          </div>
        )}
        <div className="text-[10px] opacity-60 text-right">{message.timestamp}</div>
      </div>
    </div>
  );
}

// Source accordion component
function SourceCard({source, index}: {source: Source; index: number}) {
  const [open, setOpen] = useState(false);
  const name = source.source.split(/[/\\]/).pop() || source.source;
  return (
    <div className="rounded-xl border border-slate-700/60 bg-slate-900/60 overflow-hidden text-[11px]">
      <button onClick={()=>setOpen(!open)} className="w-full px-3 py-2 flex items-center justify-between text-slate-300 hover:bg-slate-800/50 transition-colors text-left">
        <span className="font-semibold truncate max-w-[240px]">#{index}. {name}{source.page != null && ` (Hal: ${source.page+1})`}</span>
        {open ? <ChevronDown className="w-3.5 h-3.5"/> : <ChevronRight className="w-3.5 h-3.5"/>}
      </button>
      {open && <div className="p-3 border-t border-slate-800 text-slate-400 font-mono text-[10px] bg-slate-950/80 leading-relaxed">{source.content_preview}</div>}
    </div>
  );
}
