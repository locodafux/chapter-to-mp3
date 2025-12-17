let book;
let allChapters = [];
let currentChapterTitle = "audiobook_chapter"; // Default filename

const epubInput = document.getElementById("epubFile");
const chapterListDiv = document.getElementById("chapterList");
const searchInput = document.getElementById("chapterSearch");
const textArea = document.getElementById("text");
const genBtn = document.getElementById("genBtn");
const player = document.getElementById("player");
const downloadBtn = document.getElementById("download");

// 1. Handle EPUB Upload
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

// 2. Render Chapters with Search support
function renderChapters(chaptersToDisplay) {
    chapterListDiv.innerHTML = "";
    chaptersToDisplay.forEach((chapter) => {
        const div = document.createElement("div");
        div.className = "chapter-item";
        div.textContent = chapter.label.trim();
        // Pass both href and label to the loader
        div.onclick = () => loadChapter(chapter.href, chapter.label.trim());
        chapterListDiv.appendChild(div);
    });
}

// 3. Search Filter Logic
searchInput.addEventListener("input", (e) => {
    const searchTerm = e.target.value.toLowerCase();
    const filtered = allChapters.filter(chapter => 
        chapter.label.toLowerCase().includes(searchTerm)
    );
    renderChapters(filtered);
});

function flattenTOC(toc) {
    let result = [];
    toc.forEach(item => {
        result.push(item);
        if (item.subitems?.length > 0) result = result.concat(flattenTOC(item.subitems));
    });
    return result;
}

// 4. Load Chapter Text & Update Filename
async function loadChapter(href, title) {
    try {
        textArea.value = "Loading text...";
        currentChapterTitle = title.replace(/[^a-z0-9]/gi, '_'); // Sanitize filename
        
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

// 5. Generate Audio
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
        
        // Update the download link with the chapter name
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