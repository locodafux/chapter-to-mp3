const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
const ffprobeInstaller = require("@ffprobe-installer/ffprobe");

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

function splitText(text, maxLength = 200) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    chunks.push(text.slice(start, start + maxLength));
    start += maxLength;
  }
  return chunks;
}

app.post("/api/tts", async (req, res) => { // Updated route to match vercel.json
  try {
    const text = req.body.text;
    if (!text) return res.status(400).send("No text provided");

    const chunks = splitText(text, 200);
    const mp3Files = [];

    // USE THE /tmp DIRECTORY FOR VERCEL
    const tempDir = "/tmp";

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=en&client=tw-ob&q=${encodeURIComponent(chunk)}`;

      const response = await fetch(url);
      if (!response.ok) throw new Error("Failed to fetch TTS chunk");

      const buffer = await response.arrayBuffer();
      const filename = path.join(tempDir, `chunk_${Date.now()}_${i}.mp3`);
      fs.writeFileSync(filename, Buffer.from(buffer));
      mp3Files.push(filename);
    }

    const outputFile = path.join(tempDir, `chapter_${Date.now()}.mp3`);

    await new Promise((resolve, reject) => {
      const command = ffmpeg();
      mp3Files.forEach(f => command.input(f));
      command
        .on("error", reject)
        .on("end", resolve)
        .mergeToFile(outputFile, tempDir);
    });

    // Clean up chunks
    mp3Files.forEach(f => { if(fs.existsSync(f)) fs.unlinkSync(f); });

    res.download(outputFile, "chapter.mp3", err => {
      if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);
    });

  } catch (err) {
    console.error(err);
    res.status(500).send("TTS generation failed");
  }
});

// IMPORTANT: DO NOT USE app.listen() for Vercel
module.exports = app;