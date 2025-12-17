const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
const ffprobeInstaller = require("@ffprobe-installer/ffprobe");

// Set paths explicitly for the serverless environment
ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" })); // Increased limit for larger text

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

    // 1. Generate and save each chunk to /tmp
    for (let i = 0; i < chunks.length; i++) {
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=en&client=tw-ob&q=${encodeURIComponent(chunks[i])}`;
      
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Google TTS failed for chunk ${i}`);

      const buffer = Buffer.from(await response.arrayBuffer());
      const chunkPath = path.join("/tmp", `chunk_${Date.now()}_${i}.mp3`);
      
      fs.writeFileSync(chunkPath, buffer);
      tempFiles.push(chunkPath);
    }

    // 2. Merge chunks using FFmpeg
    await new Promise((resolve, reject) => {
      const command = ffmpeg();
      tempFiles.forEach(file => command.input(file));
      
      command
        .on("error", (err) => {
          console.error("FFmpeg Error:", err);
          reject(err);
        })
        .on("end", resolve)
        .mergeToFile(outputFile, "/tmp");
    });

    // 3. Send file and cleanup
    res.download(outputFile, "chapter.mp3", (err) => {
      // Cleanup all temp files after download
      [...tempFiles, outputFile].forEach(file => {
        if (fs.existsSync(file)) fs.unlinkSync(file);
      });
    });

  } catch (err) {
    console.error("Runtime Error:", err);
    // Cleanup on failure
    [...tempFiles, outputFile].forEach(file => {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    });
    res.status(500).send("TTS generation failed");
  }
});

module.exports = app;