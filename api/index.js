const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

/**
 * Splits text into chunks of maxLength without breaking sentences.
 */
function splitText(text, maxLength = 200) {
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+/g) || [text];
  const chunks = [];
  let currentChunk = "";

  for (let sentence of sentences) {
    sentence = sentence.trim() + " ";

    if ((currentChunk + sentence).length <= maxLength) {
      currentChunk += sentence;
    } else {
      if (currentChunk) chunks.push(currentChunk.trim());
      
      if (sentence.length > maxLength) {
        const words = sentence.split(/\s+/);
        for (const word of words) {
          if ((currentChunk + word).length > maxLength) {
            chunks.push(currentChunk.trim());
            currentChunk = word + " ";
          } else {
            currentChunk += word + " ";
          }
        }
      } else {
        currentChunk = sentence;
      }
    }
  }

  if (currentChunk.trim()) chunks.push(currentChunk.trim());
  return chunks;
}

/**
 * Main TTS Endpoint
 * High-speed version: Parallel downloads + Buffer concatenation
 */
app.post("/api/tts", async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "No text provided" });

    const chunks = splitText(text, 200);

    // 1. Parallel Fetching: Fire all requests at once
    const chunkPromises = chunks.map(async (chunk) => {
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=en&client=tw-ob&q=${encodeURIComponent(chunk)}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Google TTS failed for chunk: ${chunk.substring(0, 20)}...`);
      }
      
      // Return the raw buffer of the MP3 chunk
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    });

    // Wait for all chunks to download simultaneously
    const buffers = await Promise.all(chunkPromises);

    // 2. Direct Concatenation
    // MP3s are stream-able; you can join them without FFmpeg re-encoding.
    const finalBuffer = Buffer.concat(buffers);

    // 3. Optimized Response Headers
    res.set({
      "Content-Type": "audio/mpeg",
      "Content-Disposition": 'attachment; filename="tts_audio.mp3"',
      "Content-Length": finalBuffer.length,
      "Cache-Control": "no-cache"
    });

    // Send the final audio directly to the client
    res.send(finalBuffer);

  } catch (err) {
    console.error("TTS Error:", err);
    res.status(500).json({ error: "Processing failed", details: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`TTS Server running on port ${PORT}`);
});

module.exports = app;