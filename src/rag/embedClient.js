// Browser-based embedding client using TensorFlow.js Universal Sentence Encoder
// More reliable than transformers.js for browser environments
// Runs entirely in the browser using WebGL/WebAssembly - no API keys or backend needed

import * as tf from '@tensorflow/tfjs';
import * as use from '@tensorflow-models/universal-sentence-encoder';

let model = null;
let isLoading = false;
let loadError = null;

/**
 * Initialize TensorFlow.js for browser
 */
async function initTensorFlow() {
  // Set backend to WebGL for better performance, fallback to WASM
  try {
    await tf.setBackend('webgl');
    await tf.ready();
    console.log('✅ TensorFlow.js initialized with WebGL backend');
  } catch (error) {
    console.warn('⚠️ WebGL backend failed, trying WASM...');
    try {
      await tf.setBackend('wasm');
      await tf.ready();
      console.log('✅ TensorFlow.js initialized with WASM backend');
    } catch (wasmError) {
      console.warn('⚠️ WASM backend failed, using CPU...');
      await tf.setBackend('cpu');
      await tf.ready();
      console.log('✅ TensorFlow.js initialized with CPU backend');
    }
  }
}

/**
 * Embed text using Universal Sentence Encoder
 * @param {string} text - Text to embed
 * @returns {Promise<number[]>} - Embedding vector (512 dimensions)
 */
export async function embedText(text) {
  // If there was a previous load error, throw it immediately
  if (loadError) {
    throw new Error(`Model loading failed previously: ${loadError.message}. Please refresh the page.`);
  }

  // Wait if model is currently loading
  if (isLoading) {
    await new Promise(resolve => {
      const checkInterval = setInterval(() => {
        if (!isLoading) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
    });
  }

  // Initialize TensorFlow if not done
  if (!tf.engine().backend) {
    await initTensorFlow();
  }

  // Load model if not already loaded
  if (!model) {
    isLoading = true;
    try {
      console.log('⏳ Loading Universal Sentence Encoder model...');
      console.log('📦 This model is optimized for browsers and should load reliably...');

      model = await use.load();
      console.log('✅ Universal Sentence Encoder model loaded successfully');
      isLoading = false;
    } catch (error) {
      isLoading = false;
      loadError = error;
      console.error('❌ Failed to load USE model:', error);

      const troubleshooting = `
            Troubleshooting steps:
            1. Check your internet connection
            2. Try refreshing the page (Ctrl+F5)
            3. Try Chrome or Firefox (Safari has limitations)
            4. Ensure WebGL is enabled in your browser
            5. Check if you're behind a corporate firewall
            6. Try disabling browser extensions temporarily

            If the problem persists, try a different browser or network.
      `.trim();

      throw new Error(`Failed to load embedding model: ${error.message}\n\n${troubleshooting}`);
    }
  }

  try {
    console.log('🔍 Generating embedding for text:', text.substring(0, 50) + '...');

    // Generate embedding
    const embeddings = await model.embed([text]);

    // Convert tensor to array
    const embedding = await embeddings.array();

    console.log('✅ Generated embedding:', embedding[0].length, 'dimensions');
    return embedding[0]; // Return first (and only) embedding
  } catch (error) {
    console.error('❌ Embedding generation failed:', error);
    throw new Error(`Embedding failed: ${error.message}`);
  }
}

/**
 * Check if embeddings are available (always true for browser-based)
 * @returns {boolean}
 */
export function hasEmbeddings() {
  return true;
}
