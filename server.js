const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
const ffprobeInstaller = require("@ffprobe-installer/ffprobe"); // Added

// Set paths for ffmpeg and ffprobe
ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

// Split text into chunks <= 200 characters
function splitText(text, maxLength = 200) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    chunks.push(text.slice(start, start + maxLength));
    start += maxLength;
  }
  return chunks;
}

app.post("/tts", async (req, res) => {
  try {
    const text = req.body.text;
    if (!text) return res.status(400).send("No text provided");

    const chunks = splitText(text, 200);
    const mp3Files = [];

    // Generate TTS for each chunk
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=en&client=tw-ob&q=${encodeURIComponent(chunk)}`;

      const response = await fetch(url); // Node 20 built-in fetch
      if (!response.ok) throw new Error("Failed to fetch TTS chunk");

      const buffer = await response.arrayBuffer();
      const filename = path.join(__dirname, `chunk_${i}.mp3`);
      fs.writeFileSync(filename, Buffer.from(buffer));
      mp3Files.push(filename);
    }

    const outputFile = path.join(__dirname, "chapter.mp3");

    // Merge all chunks into one MP3
    await new Promise((resolve, reject) => {
      const command = ffmpeg();
      mp3Files.forEach(f => command.input(f));
      command
        .on("error", reject)
        .on("end", resolve)
        .mergeToFile(outputFile, __dirname);
    });

    // Clean up chunk files
    mp3Files.forEach(f => fs.unlinkSync(f));

    // Send merged MP3 to frontend
    res.download(outputFile, "chapter.mp3", err => {
      if (!err) fs.unlinkSync(outputFile);
    });

  } catch (err) {
    console.error(err);
    res.status(500).send("TTS generation failed");
  }
});

app.listen(3001, () => {
  console.log("✅ TTS server running at http://localhost:3001");
});
