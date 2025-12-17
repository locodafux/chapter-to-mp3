let book;
let allChapters = []; // Store chapters globally for filtering

const epubInput = document.getElementById("epubFile");
const chapterListDiv = document.getElementById("chapterList");
const searchInput = document.getElementById("chapterSearch"); // The new search bar
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
    allChapters = flattenTOC(navigation.toc); // Save to the global array

    renderChapters(allChapters); // Initial render
});

// 2. Render Chapters (Used for both initial load and filtering)
function renderChapters(chaptersToDisplay) {
    chapterListDiv.innerHTML = "";
    chaptersToDisplay.forEach((chapter, index) => {
        const div = document.createElement("div");
        div.className = "chapter-item";
        div.textContent = chapter.label.trim();
        div.onclick = () => loadChapter(chapter.href);
        chapterListDiv.appendChild(div);
    });
}

// 3. Search Filter Logic
searchInput.addEventListener("input", (e) => {
    const searchTerm = e.target.value.toLowerCase();
    
    // Filter the original full list of chapters
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

// 4. Load Chapter Text into Textarea
async function loadChapter(href) {
    try {
        textArea.value = "Loading text...";
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

// 5. Generate Audio via API
async function generate() {
    const text = textArea.value.trim();
    if (!text || text === "Loading text...") {
        alert("Please select a chapter with content first.");
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