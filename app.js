async function generate() {
    const text = document.getElementById("text").value.trim();
    if (!text) {
      alert("Paste text first");
      return;
    }
  
    try {
        const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text })
      });
  
      if (!response.ok) throw new Error("Server error");
  
      const blob = await response.blob();
      const audioUrl = URL.createObjectURL(blob);
  
      document.getElementById("player").src = audioUrl;
      document.getElementById("download").href = audioUrl;
  
    } catch (err) {
      console.error(err);
      alert("Failed to generate audio. Is the server running?");
    }
  }
  