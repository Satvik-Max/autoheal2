import React, { useCallback, useEffect, useRef, useState } from 'react';
import { embedText } from '../rag/embedClient';

// Minimal, client-only RAG chat with:
// - Browser Embeddings: Xenova/all-MiniLM-L6-v2 (WebAssembly, no API needed)
// - Local vector store in localStorage
// - Cosine similarity retrieval
// - Groq LLM: llama-3.1-8b-instant (optional, requires API key)
// Embeddings run entirely in the browser - no backend or API keys needed!

const LS_KEY = 'rag_store_v1';
// Local storage key for Groq chat API key (client-only demo)
const LS_CHAT_KEY = 'rag_groq_api_key';
const CHAT_MODEL = 'llama-3.1-8b-instant';

const RagChat = ({ open, onClose }) => {
  const [messages, setMessages] = useState([
    { role: 'assistant', text: 'Hi! Add some knowledge, then ask a question.' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [manageOpen, setManageOpen] = useState(false);
  const [docTitle, setDocTitle] = useState('');
  const [docText, setDocText] = useState('');
  const bodyRef = useRef(null);

  const [, setStoreVersion] = useState(0);

  useEffect(() => {
    const k = window.localStorage.getItem(LS_CHAT_KEY) || '';
    setApiKey(k);
  }, []);

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
    const k = (apiKey || '').trim();
    if (!k) throw new Error('Groq API key not set. Add it in Settings.');
    return k;
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

  const askLLM = useCallback(async (question, context) => {
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
  }, [apiKey]);

  const send = useCallback(async () => {
    const q = input.trim();
    if (!q) return;
    setMessages(m => [...m, { role: 'user', text: q, ts: Date.now() }]);
    setInput('');
    setLoading(true);
    try {
      const top = await search(q, 4);
      const context = top.map((d, i) => `#${i + 1} ${d.title}\n${d.text}`).join('\n\n');
      
      // If Groq key available, use LLM; otherwise return search results
      if (apiKey && apiKey.trim()) {
        const answer = await askLLM(q, context);
        setMessages(m => [...m, { role: 'assistant', text: answer, sources: top.map(t => t.title), ts: Date.now() }]);
      } else {
        // Search-only mode without LLM
        const results = top.length > 0
          ? `Found ${top.length} relevant chunks:\n\n${context}\n\n💡 Add a Groq API key in Settings for AI-generated answers.`
          : 'No relevant knowledge found. Try indexing some documents first.';
        setMessages(m => [...m, { role: 'assistant', text: results, sources: top.map(t => t.title), ts: Date.now() }]);
      }
    } catch (err) {
      setMessages(m => [...m, { role: 'assistant', text: `Error: ${err.message}`, ts: Date.now() }]);
    } finally {
      setLoading(false);
    }
  }, [input, search, askLLM, apiKey, ensureKey]);

  const onSaveApiKey = () => {
    window.localStorage.setItem(LS_CHAT_KEY, apiKey.trim());
  };

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

  return (
    <div style={panel}>
      <div style={header}>
        <strong>RAG Chat</strong>
        <div>
          <button onClick={() => setManageOpen(v => !v)} style={btn}>{manageOpen ? 'Close Settings' : 'Settings'}</button>
          <button onClick={() => setMessages([{ role: 'assistant', text: 'Hi! Add some knowledge, then ask a question.' }])} style={btn}>Clear Chat</button>
          <button onClick={onClose} style={btn}>Close</button>
        </div>
      </div>

      {manageOpen && (
        <div style={manageBox}>
          <div style={{ fontSize: 12, color: '#059669', marginBottom: 12, padding: '8px', backgroundColor: '#f0fdf4', borderRadius: '6px', border: '1px solid #bbf7d0' }}>
            ✅ Embeddings run in your browser (TensorFlow.js + Universal Sentence Encoder) - no API key needed!
          </div>
          <div style={manageRow}>
            <label style={label}>Groq API Key</label>
            <input value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="paste groq key (optional)" style={inputStyle} />
            <button onClick={onSaveApiKey} style={btn}>Save</button>
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
            Optional: For LLM answers. Without it, you can still index and search.
          </div>
          <div style={manageRowCol}>
            <label style={label}>Add Knowledge</label>
            <input value={docTitle} onChange={e => setDocTitle(e.target.value)} placeholder="Title (optional)" style={inputStyle} />
            <textarea value={docText} onChange={e => setDocText(e.target.value)} placeholder="Paste text to index..." style={textArea} rows={5} />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button onClick={onAddDoc} style={sendBtn} disabled={loading}>Index</button>
              <button onClick={onClearStore} style={btn}>Clear Knowledge</button>
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
        <button onClick={send} style={sendBtn} disabled={loading}>Send</button>
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
const sendBtn = { padding: '10px 14px', borderRadius: 8, backgroundColor: '#8b5cf6', color: 'white', border: 'none', cursor: 'pointer' };
const bubbleUser = { alignSelf: 'flex-end', backgroundColor: '#eef2ff', padding: 10, borderRadius: 12, maxWidth: '85%' };
const bubbleAssistant = { alignSelf: 'flex-start', backgroundColor: '#f8fafc', padding: 10, borderRadius: 12, maxWidth: '85%', border: '1px solid #e6edf3' };
const manageBox = { padding: 12, borderBottom: '1px solid #f1f5f9', display: 'flex', flexDirection: 'column', gap: 10 };
const manageRow = { display: 'flex', gap: 8, alignItems: 'center' };
const manageRowCol = { display: 'flex', gap: 8, alignItems: 'stretch', flexDirection: 'column' };
const label = { fontSize: 12, color: '#475569', minWidth: 100 };
