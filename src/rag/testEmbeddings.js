// Test script for TensorFlow.js Universal Sentence Encoder
import { embedText } from './embedClient.js';

async function testEmbeddings() {
  try {
    console.log('🧪 Testing TensorFlow.js Universal Sentence Encoder...');

    // Test with a simple text
    const testText = "Hello world, this is a test.";
    console.log('📝 Test text:', testText);

    const embedding = await embedText(testText);
    console.log('✅ Embedding generated successfully!');
    console.log('📊 Embedding dimensions:', embedding.length);
    console.log('🔢 First 5 values:', embedding.slice(0, 5));

    // Test with another text for similarity
    const testText2 = "Hello universe, this is another test.";
    const embedding2 = await embedText(testText2);
    console.log('✅ Second embedding generated!');

    // Calculate cosine similarity
    const dotProduct = embedding.reduce((sum, val, i) => sum + val * embedding2[i], 0);
    const magnitude1 = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    const magnitude2 = Math.sqrt(embedding2.reduce((sum, val) => sum + val * val, 0));
    const similarity = dotProduct / (magnitude1 * magnitude2);

    console.log('📈 Cosine similarity between texts:', similarity.toFixed(4));

    // Test with different texts to verify semantic similarity
    const similarText = "Hi there, this is a simple test message.";
    const embedding3 = await embedText(similarText);
    const similarity2 = cosineSimilarity(embedding, embedding3);
    console.log('📈 Similarity with similar text:', similarity2.toFixed(4));

    const differentText = "The weather today is sunny and warm.";
    const embedding4 = await embedText(differentText);
    const similarity3 = cosineSimilarity(embedding, embedding4);
    console.log('📈 Similarity with different text:', similarity3.toFixed(4));

  } catch (error) {
    console.error('❌ Embedding test failed:', error.message);
  }
}

function cosineSimilarity(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length && i < b.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb) || 1e-9;
  return dot / denom;
}

// Run the test
testEmbeddings();