import React, { useCallback, useEffect, useRef, useState } from 'react';
import { embedText } from '../rag/embedClient';

const LS_KEY = 'rag_store_v1';
const CHAT_MODEL = 'llama-3.1-8b-instant';
const GROQ_API_KEY = process.env.REACT_APP_GROQ_API_KEY;

const RagChat = ({ open, onClose }) => {
  const [messages, setMessages] = useState([
    { role: 'assistant', text: '👋 Welcome! I\'m your AI assistant powered by RAG (Retrieval-Augmented Generation).\n\nAdd some knowledge documents, then ask me questions about them. I\'ll provide accurate answers based on your indexed content.' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [docTitle, setDocTitle] = useState('');
  const [docText, setDocText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(!!GROQ_API_KEY);
  const [isMinimized, setIsMinimized] = useState(false);
  const bodyRef = useRef(null);

  const [, setStoreVersion] = useState(0);

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const chunkText = (text, size = 800) => {
    const parts = [];
    let i = 0;
    while (i < text.length) {
      parts.push(text.slice(i, i + size));
      i += size;
    }
    return parts.filter(Boolean);
  };

  const cosineSim = (a, b) => {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length && i < b.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    const denom = Math.sqrt(na) * Math.sqrt(nb) || 1e-9;
    return dot / denom;
  };

  const ensureKey = () => {
    if (!GROQ_API_KEY) throw new Error('Groq API key not configured. Please set REACT_APP_GROQ_API_KEY in your environment variables.');
    return GROQ_API_KEY;
  };

  // Use Hugging Face embedding client (env REACT_APP_HF_API_KEY)
  const embed = useCallback(async (text) => {
    return await embedText(text);
  }, []);

  const addDocument = useCallback(async (title, text) => {
    const cleanedTitle = (title || 'Untitled').trim();
    const chunks = chunkText((text || '').trim());
    if (!chunks.length) throw new Error('Document is empty');
    const now = Date.now();
    const newItems = [];
    for (let idx = 0; idx < chunks.length; idx++) {
      const c = chunks[idx];
      const e = await embed(c);
      newItems.push({ id: `${now}-${idx}`, title: cleanedTitle, text: c, embedding: e, ts: now });
    }
    const s = loadStore();
    s.items = [...s.items, ...newItems];
    saveStore(s);
    setStoreVersion(v => v + 1);
    return newItems.length;
  }, [embed]);

  const search = useCallback(async (query, topK = 4) => {
    const qv = await embed(query);
    const s = loadStore();
    const scored = s.items.map(it => ({ it, score: cosineSim(qv, it.embedding) }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map(x => ({ title: x.it.title, text: x.it.text, score: x.score }));
  }, [embed]);

  async function askLLM(question, context) {
    const key = ensureKey();
    const sys = 'You are a concise assistant. Use the provided context. If unsure, say you do not know.';
    const messages = [
      { role: 'system', content: sys },
      { role: 'user', content: `Context:\n${context}\n\nQuestion: ${question}` }
    ];
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify({
        model: CHAT_MODEL,
        messages,
        temperature: 0.2,
        max_tokens: 600
      })
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(t || 'Chat failed');
    }
    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content || '';
    return content.trim();
  }

  async function send() {
    const q = input.trim();
    if (!q) return;
    setMessages(m => [...m, { role: 'user', text: q, ts: Date.now() }]);
    setInput('');
    setLoading(true);
    setIsTyping(true);
    try {
      const top = await search(q, 4);
      const context = top.map((d, i) => `#${i + 1} ${d.title}\n${d.text}`).join('\n\n');

      // If AI enabled and Groq key is present, use LLM; otherwise return search results
      if (aiEnabled && GROQ_API_KEY) {
        const answer = await askLLM(q, context);
        setMessages(m => [...m, { role: 'assistant', text: answer, sources: top.map(t => t.title), ts: Date.now() }]);
      } else {
        // Search-only mode without LLM
        const results = top.length > 0
          ? `Found ${top.length} relevant chunks:\n\n${context}${GROQ_API_KEY ? '\n\n(LLM is toggled off in Settings)' : '\n\n(LLM not configured)'} `
          : 'No relevant knowledge found. Try indexing some documents first.';
        setMessages(m => [...m, { role: 'assistant', text: results, sources: top.map(t => t.title), ts: Date.now() }]);
      }
    } catch (err) {
      setMessages(m => [...m, { role: 'assistant', text: `Error: ${err.message}`, ts: Date.now() }]);
    } finally {
      setLoading(false);
      setIsTyping(false);
    }
  }

  // API key is managed via environment variable in production; no manual save required.

  const onAddDoc = async () => {
    try {
      setLoading(true);
      const n = await addDocument(docTitle, docText);
      setMessages(m => [...m, { role: 'assistant', text: `Indexed ${n} chunk(s) under "${docTitle || 'Untitled'}".`, ts: Date.now() }]);
      setDocTitle('');
      setDocText('');
    } catch (e) {
      setMessages(m => [...m, { role: 'assistant', text: `Add doc failed: ${e.message}`, ts: Date.now() }]);
    } finally {
      setLoading(false);
    }
  };

  const onClearStore = () => {
    saveStore({ items: [] });
    setStoreVersion(v => v + 1);
  };

  if (!open) return null;

  const count = (loadStore().items || []).length;
  if (isMinimized) {
    return (
      <div style={{ position: 'fixed', right: 20, bottom: 20, zIndex: 1300 }}>
        <button onClick={() => setIsMinimized(false)} style={{ padding: '8px 12px', borderRadius: 8, background: '#111827', color: 'white', border: 'none', cursor: 'pointer' }}>
          RAG Chat • {count} chunks • Open
        </button>
      </div>
    );
  }

  return (
    <div style={panel}>
      <div style={header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <strong>RAG Chat</strong>
          <span style={{ fontSize: 12, color: '#64748b' }}>Chunks: {count}</span>
        </div>
        <div>
          <button onClick={() => setIsMinimized(true)} title="Minimize" style={iconBtn} aria-label="Minimize chat">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 12h14" stroke="#111827" strokeWidth="1.6" strokeLinecap="round"/></svg>
          </button>
          <button onClick={() => setManageOpen(v => !v)} title="Settings" style={iconBtn} aria-label="Open settings">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" stroke="#111827" strokeWidth="1.2"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V20a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H4a2 2 0 0 1 0-4h.09c.7 0 1.27-.4 1.51-1a1.65 1.65 0 0 0-.33-1.82l-.06-.06A2 2 0 0 1 7.86 2.1l.06.06c.45.45 1.08.7 1.82.33.52-.25 1.08-.4 1.67-.4H12c.59 0 1.15.15 1.67.4.74.37 1.37.12 1.82-.33l.06-.06A2 2 0 0 1 20.7 6.14l-.06.06c-.25.7-.4 1.27-.4 1.51V8a1.65 1.65 0 0 0 1 1.51z" stroke="#111827" strokeWidth="0.6" fill="none"/></svg>
          </button>
          <button onClick={() => setMessages([{ role: 'assistant', text: 'Hi! Add some knowledge, then ask a question.' }])} title="Clear chat" style={iconBtn} aria-label="Clear chat">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 6h18" stroke="#111827" strokeWidth="1.4"/><path d="M8 6v12a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V6" stroke="#111827" strokeWidth="1.4" fill="none"/><path d="M10 11v6" stroke="#111827" strokeWidth="1.4"/><path d="M14 11v6" stroke="#111827" strokeWidth="1.4"/></svg>
          </button>
          <button onClick={onClose} title="Close" style={iconBtn} aria-label="Close chat">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 6l12 12M18 6L6 18" stroke="#111827" strokeWidth="1.6" strokeLinecap="round"/></svg>
          </button>
        </div>
      </div>

      {manageOpen && (
        <div style={manageBox}>
          <div style={manageRow}>
            <label style={label}>Groq LLM</label>
            <div style={{ fontSize: 13, color: GROQ_API_KEY ? '#065f46' : '#b91c1c', marginRight: 8 }}>
              {GROQ_API_KEY ? 'Configured (REACT_APP_GROQ_API_KEY)' : 'Not configured — LLM disabled'}
            </div>
            <button onClick={() => setAiEnabled(v => !v)} title={aiEnabled ? 'Turn AI off' : 'Turn AI on'} aria-pressed={aiEnabled} style={{ ...iconBtn, background: aiEnabled ? '#dcfce7' : 'transparent' }}>
              {/* simple toggle icon */}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="9" stroke="#065f46" strokeWidth="1.2" fill={aiEnabled ? '#065f46' : 'none'} /></svg>
            </button>
            <button onClick={() => { if (GROQ_API_KEY && navigator.clipboard) navigator.clipboard.writeText(GROQ_API_KEY); }} title="Copy configured key" style={iconBtn} disabled={!GROQ_API_KEY}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="9" y="9" width="8" height="8" stroke="#111827" strokeWidth="1.2"/><path d="M15 7H7a2 2 0 0 0-2 2v8" stroke="#111827" strokeWidth="1.2" fill="none"/></svg>
            </button>
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
            Embeddings work in the browser; LLM calls use the configured environment key in production.
          </div>
          <div style={manageRowCol}>
            <label style={label}>Add Knowledge</label>
            <input value={docTitle} onChange={e => setDocTitle(e.target.value)} placeholder="Title (optional)" style={inputStyle} />
            <textarea value={docText} onChange={e => setDocText(e.target.value)} placeholder="Paste text to index..." style={textArea} rows={5} />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button onClick={onAddDoc} title="Index document" style={{ ...iconBtn, background: '#ecfdf5' }} disabled={loading}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 5v14" stroke="#065f46" strokeWidth="1.6"/><path d="M19 12H5" stroke="#065f46" strokeWidth="1.6"/></svg>
              </button>
              <button onClick={onClearStore} title="Clear knowledge" style={iconBtn}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 6h18" stroke="#b91c1c" strokeWidth="1.4"/><path d="M8 6v12a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V6" stroke="#b91c1c" strokeWidth="1.4" fill="none"/><path d="M10 11v6" stroke="#b91c1c" strokeWidth="1.4"/><path d="M14 11v6" stroke="#b91c1c" strokeWidth="1.4"/></svg>
              </button>
              <span style={{ fontSize: 12, color: '#64748b' }}>Chunks: {count}</span>
            </div>
          </div>
        </div>
      )}

      <div style={body} ref={bodyRef}>
        {messages.map((m, i) => (
          <div key={i} style={m.role === 'user' ? bubbleUser : bubbleAssistant}>
            <div style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{m.text}</div>
            {m.sources && m.sources.length > 0 && (
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>Sources: {m.sources.join(', ')}</div>
            )}
          </div>
        ))}
        {loading && <div style={{ color: '#64748b' }}>Thinking…</div>}
      </div>

      <div style={footer}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') send(); }}
          placeholder="Ask using your indexed knowledge..."
          style={inputStyle}
          disabled={loading}
        />
        <button onClick={send} title="Send" style={sendBtn} disabled={loading} aria-label="Send message">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M22 2L11 13" stroke="white" strokeWidth="1.6" strokeLinecap="round"/><path d="M22 2l-7 20-4-9-9-4 20-7z" stroke="white" strokeWidth="1.2" fill="none"/></svg>
        </button>
      </div>
    </div>
  );
};

export default RagChat;

// Local store helpers
function loadStore() {
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return { items: [] };
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.items)) return { items: [] };
    return parsed;
  } catch {
    return { items: [] };
  }
}

function saveStore(s) {
  window.localStorage.setItem(LS_KEY, JSON.stringify(s));
}

// Styles
const panel = {
  position: 'fixed',
  right: 20,
  bottom: 20,
  width: 400,
  maxHeight: '76vh',
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: 'white',
  borderRadius: 12,
  border: '1px solid #e2e8f0',
  boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
  zIndex: 1200,
  overflow: 'hidden'
};
const header = { padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f1f5f9', backgroundColor: '#f8fafc' };
const btn = { marginLeft: 8, background: 'none', border: '1px solid #e2e8f0', padding: '6px 8px', borderRadius: 8, cursor: 'pointer' };
const body = { padding: 12, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 420 };
const footer = { display: 'flex', gap: 8, padding: 10, borderTop: '1px solid #f1f5f9' };
const inputStyle = { flex: 1, padding: '10px 12px', borderRadius: 8, border: '1px solid #e2e8f0' };
const textArea = { padding: '10px 12px', borderRadius: 8, border: '1px solid #e2e8f0', resize: 'vertical', width: '100%' };
const iconBtn = { marginLeft: 8, background: 'transparent', border: '1px solid #e6edf3', padding: '8px', borderRadius: 8, cursor: 'pointer' };
const sendBtn = { padding: '10px 14px', borderRadius: 8, backgroundColor: '#8b5cf6', color: 'white', border: 'none', cursor: 'pointer' };
const bubbleUser = { alignSelf: 'flex-end', backgroundColor: '#eef2ff', padding: 10, borderRadius: 12, maxWidth: '85%' };
const bubbleAssistant = { alignSelf: 'flex-start', backgroundColor: '#f8fafc', padding: 10, borderRadius: 12, maxWidth: '85%', border: '1px solid #e6edf3' };
const manageBox = { padding: 12, borderBottom: '1px solid #f1f5f9', display: 'flex', flexDirection: 'column', gap: 10 };
const manageRow = { display: 'flex', gap: 8, alignItems: 'center' };
const manageRowCol = { display: 'flex', gap: 8, alignItems: 'stretch', flexDirection: 'column' };
const label = { fontSize: 12, color: '#475569', minWidth: 100 };
