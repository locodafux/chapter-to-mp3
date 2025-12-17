const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const ffmpegPath = require("ffmpeg-static");

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

function splitText(text, maxLength = 200) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    chunks.push(text.slice(start, start + maxLength));
    start += maxLength;
  }
  return chunks;
}

app.post("/api/tts", async (req, res) => {
  const tempFiles = [];
  const listFilePath = path.join("/tmp", `list_${Date.now()}.txt`);
  const outputFile = path.join("/tmp", `output_${Date.now()}.mp3`);

  try {
    const { text } = req.body;
    if (!text) return res.status(400).send("No text provided");

    const chunks = splitText(text, 200);

    // 1. Download chunks
    for (let i = 0; i < chunks.length; i++) {
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=en&client=tw-ob&q=${encodeURIComponent(chunks[i])}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error("Google TTS failed");

      const buffer = Buffer.from(await response.arrayBuffer());
      const chunkPath = path.join("/tmp", `chunk_${Date.now()}_${i}.mp3`);
      fs.writeFileSync(chunkPath, buffer);
      tempFiles.push(chunkPath);
    }

    // 2. Create a "list file" for FFmpeg concat demuxer
    // Format must be: file '/tmp/chunk_1.mp3'
    const listContent = tempFiles.map(f => `file '${f}'`).join('\n');
    fs.writeFileSync(listFilePath, listContent);

    // 3. Run RAW FFmpeg command (Bypasses fluent-ffmpeg metadata checks)
    await new Promise((resolve, reject) => {
      const ffmpeg = spawn(ffmpegPath, [
        '-f', 'concat',
        '-safe', '0',
        '-i', listFilePath,
        '-c', 'copy', // 'copy' is fast and doesn't re-encode
        outputFile
      ]);

      ffmpeg.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`FFmpeg exited with code ${code}`));
      });

      ffmpeg.on('error', reject);
    });

    // 4. Send and Cleanup
    res.download(outputFile, "chapter.mp3", () => {
      [...tempFiles, listFilePath, outputFile].forEach(f => {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      });
    });

  } catch (err) {
    console.error("Runtime Error:", err);
    [...tempFiles, listFilePath, outputFile].forEach(f => {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    });
    res.status(500).send(`Server Error: ${err.message}`);
  }
});

module.exports = app;