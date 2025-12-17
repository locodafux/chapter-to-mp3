let book;
let allChapters = [];
let currentChapterTitle = "audiobook_chapter";

const epubInput = document.getElementById("epubFile");
const chapterListDiv = document.getElementById("chapterList");
const searchInput = document.getElementById("chapterSearch");
const textArea = document.getElementById("text");
const genBtn = document.getElementById("genBtn");
const player = document.getElementById("player");
const downloadBtn = document.getElementById("download");

epubInput.addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const arrayBuffer = await file.arrayBuffer();
    book = ePub(arrayBuffer);

    await book.ready;
    const navigation = await book.loaded.navigation;
    allChapters = flattenTOC(navigation.toc);

    renderChapters(allChapters);
});

// 1. Updated Search Logic: Scroll instead of Hide
searchInput.addEventListener("input", (e) => {
    const searchTerm = e.target.value.toLowerCase().trim();
    if (!searchTerm) return;

    // Find the first chapter that matches
    const items = chapterListDiv.querySelectorAll(".chapter-item");
    let found = false;

    items.forEach((item) => {
        const text = item.querySelector(".chapter-label").textContent.toLowerCase();
        
        if (!found && text.includes(searchTerm)) {
            // Highlight and Scroll
            item.style.backgroundColor = "#e3f2fd"; // Light blue highlight
            item.scrollIntoView({ behavior: "smooth", block: "center" });
            found = true; // Only scroll to the first match
        } else {
            item.style.backgroundColor = ""; // Reset others
        }
    });
});

// 2. Render all chapters once
function renderChapters(chaptersToDisplay) {
    chapterListDiv.innerHTML = "";
    chaptersToDisplay.forEach((chapter, index) => {
        const div = document.createElement("div");
        div.className = "chapter-item";
        div.dataset.index = index; // Store index for reference
        
        const label = document.createElement("span");
        label.className = "chapter-label";
        label.textContent = chapter.label.trim();
        
        const playBtn = document.createElement("button");
        playBtn.className = "play-btn-mini";
        playBtn.innerHTML = "▶";

        div.onclick = () => {
            // Reset highlights when a chapter is selected
            chapterListDiv.querySelectorAll(".chapter-item").forEach(i => i.style.backgroundColor = "");
            div.style.backgroundColor = "#f0f0f0"; 
            loadChapter(chapter.href, chapter.label.trim());
        };

        playBtn.onclick = async (e) => {
            e.stopPropagation();
            await loadChapter(chapter.href, chapter.label.trim());
            generate();
        };

        div.appendChild(label);
        div.appendChild(playBtn);
        chapterListDiv.appendChild(div);
    });
}

function flattenTOC(toc) {
    let result = [];
    toc.forEach(item => {
        result.push(item);
        if (item.subitems?.length > 0) result = result.concat(flattenTOC(item.subitems));
    });
    return result;
}

async function loadChapter(href, title) {
    try {
        textArea.value = "Loading text...";
        currentChapterTitle = title.replace(/[^a-z0-9]/gi, '_');
        
        const section = book.spine.get(href);
        if (section) {
            const contents = await section.load(book.load.bind(book));
            const body = contents.querySelector("body");
            const extras = body.querySelectorAll("script, style");
            extras.forEach(e => e.remove());

            const text = body.innerText || body.textContent;
            textArea.value = text.trim();
            section.unload();
        }
    } catch (err) {
        console.error(err);
        textArea.value = "Error loading chapter text.";
    }
}

async function generate() {
    const text = textArea.value.trim();
    if (!text || text === "Loading text...") {
        alert("Please select a chapter first.");
        return;
    }

    genBtn.disabled = true;
    genBtn.textContent = "Generating AI Voice...";
    downloadBtn.style.display = "none";

    try {
        const response = await fetch("/api/tts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text })
        });

        if (!response.ok) throw new Error("Server error");

        const blob = await response.blob();
        const audioUrl = URL.createObjectURL(blob);

        player.src = audioUrl;
        downloadBtn.href = audioUrl;
        downloadBtn.download = `${currentChapterTitle}.mp3`;
        downloadBtn.style.display = "inline-block";
        player.play();

    } catch (err) {
        console.error(err);
        alert("Failed to generate audio.");
    } finally {
        genBtn.disabled = false;
        genBtn.textContent = "Generate Audiobook";
    }
}