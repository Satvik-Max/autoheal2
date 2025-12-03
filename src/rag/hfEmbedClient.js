// Lightweight Hugging Face embedding client using Inference API
// Model: sentence-transformers/all-MiniLM-L6-v2
// Uses env var REACT_APP_HF_API_KEY for browser calls.

const HF_MODEL = 'sentence-transformers/all-MiniLM-L6-v2';
const HF_API_URL = `https://api-inference.huggingface.co/models/${HF_MODEL}`;
const LS_HF_KEY = 'rag_hf_api_key';

function getApiKey() {
  try {
    const fromStorage = window.localStorage.getItem(LS_HF_KEY);
    if (fromStorage && fromStorage.trim()) return fromStorage.trim();
  } catch (e) {
    // ignore
  }
  return process.env.REACT_APP_HF_API_KEY || '';
}

export async function embedText(text) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('Hugging Face API key is not set. Add it in RagChat settings or set REACT_APP_HF_API_KEY.');

  const res = await fetch(HF_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ inputs: text })
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || 'HF embedding failed');
  }

  const data = await res.json();

  // HF may return nested arrays. Flatten until we reach a numeric array.
  let vectors = data;
  while (Array.isArray(vectors) && Array.isArray(vectors[0])) {
    vectors = vectors[0];
  }

  if (!Array.isArray(vectors)) throw new Error('Invalid HF embedding response');
  return vectors.map(Number);
}

export function hasHfKey() {
  try {
    const fromStorage = window.localStorage.getItem(LS_HF_KEY);
    if (fromStorage && fromStorage.trim()) return true;
  } catch (e) {}
  return Boolean(process.env.REACT_APP_HF_API_KEY);
}
