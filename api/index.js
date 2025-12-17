const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");

// Only set FFmpeg. FFprobe is not needed for merging.
ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// ... keep your splitText function here ...

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

    // Merging chunks
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

    res.download(outputFile, "chapter.mp3", () => {
      // Cleanup /tmp folder
      [...tempFiles, outputFile].forEach(file => {
        if (fs.existsSync(file)) fs.unlinkSync(file);
      });
    });

  } catch (err) {
    console.error("Runtime Error:", err);
    res.status(500).send("TTS generation failed");
  }
});

module.exports = app;