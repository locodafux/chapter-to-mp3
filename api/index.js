const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");

// ✅ THE FIX: Tell fluent-ffmpeg to use the ffmpeg binary for both
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffmpegPath); 

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
  const outputFile = path.join("/tmp", `output_${Date.now()}.mp3`);

  try {
    const { text } = req.body;
    if (!text) return res.status(400).send("No text provided");

    const chunks = splitText(text, 200);

    for (let i = 0; i < chunks.length; i++) {
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=en&client=tw-ob&q=${encodeURIComponent(chunks[i])}`;
      const response = await fetch(url);
      
      if (!response.ok) throw new Error("Google TTS failed");

      const buffer = Buffer.from(await response.arrayBuffer());
      const chunkPath = path.join("/tmp", `chunk_${Date.now()}_${i}.mp3`);
      fs.writeFileSync(chunkPath, buffer);
      tempFiles.push(chunkPath);
    }

    // Merge logic
    await new Promise((resolve, reject) => {
      const command = ffmpeg();
      tempFiles.forEach(f => command.input(f));
      command
        .on("error", (err) => {
          console.error("FFmpeg Merge Error:", err);
          reject(err);
        })
        .on("end", resolve)
        // ✅ Using .mergeToFile without extra validation options
        .mergeToFile(outputFile, "/tmp");
    });

    res.download(outputFile, "chapter.mp3", () => {
      [...tempFiles, outputFile].forEach(f => {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      });
    });

  } catch (err) {
    console.error("Runtime Error:", err);
    [...tempFiles, outputFile].forEach(f => {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    });
    res.status(500).send(`Server Error: ${err.message}`);
  }
});

module.exports = app;