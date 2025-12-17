let book;
let allChapters = [];
let currentChapterTitle = localStorage.getItem("lastTitle") || "audiobook_chapter";

// CONSTANTS
const DEFAULT_BOOK_PATH = "/book.epub"; // Ensure this file is in your /public folder

const epubInput = document.getElementById("epubFile");
const chapterListDiv = document.getElementById("chapterList");
const searchInput = document.getElementById("chapterSearch");
const textArea = document.getElementById("text");
const genBtn = document.getElementById("genBtn");
const player = document.getElementById("player");
const downloadBtn = document.getElementById("download");

// --- ON PAGE LOAD ---
window.addEventListener("DOMContentLoaded", async () => {
    // 1. Restore last text immediately
    const savedText = localStorage.getItem("lastText");
    if (savedText) textArea.value = savedText;

    // 2. Load the default book from the server
    try {
        const response = await fetch(DEFAULT_BOOK_PATH);
        if (response.ok) {
            const arrayBuffer = await response.arrayBuffer();
            loadEpubData(arrayBuffer);
        } else {
            chapterListDiv.innerHTML = "<p style='padding:10px;'>No default book found. Please upload one.</p>";
        }
    } catch (err) {
        console.error("Default book load failed:", err);
    }
});

// Handle manual upload
epubInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (file) loadEpubData(await file.arrayBuffer());
});

async function loadEpubData(data) {
    book = ePub(data);
    await book.ready;
    const navigation = await book.loaded.navigation;
    allChapters = flattenTOC(navigation.toc);
    renderChapters(allChapters);

    // If we had a chapter selected before refresh, find it and highlight it
    const lastHref = localStorage.getItem("lastHref");
    if (lastHref) {
        const target = Array.from(chapterListDiv.children).find(el => el.dataset.href === lastHref);
        if (target) {
            target.style.backgroundColor = "#f0f0f0";
            target.scrollIntoView({ block: "center" });
        }
    }
}

function renderChapters(chapters) {
    chapterListDiv.innerHTML = "";
    chapters.forEach(chapter => {
        const div = document.createElement("div");
        div.className = "chapter-item";
        div.dataset.href = chapter.href;

        const label = document.createElement("span");
        label.className = "chapter-label";
        label.textContent = chapter.label.trim();

        const playBtn = document.createElement("button");
        playBtn.className = "play-btn-mini";
        playBtn.innerHTML = "▶";

        div.onclick = () => {
            selectChapter(div, chapter.href);
            loadChapter(chapter.href, chapter.label.trim());
        };

        playBtn.onclick = async (e) => {
            e.stopPropagation();
            selectChapter(div, chapter.href);
            await loadChapter(chapter.href, chapter.label.trim());
            generate();
        };

        div.appendChild(label);
        div.appendChild(playBtn);
        chapterListDiv.appendChild(div);
    });
}

function selectChapter(element, href) {
    chapterListDiv.querySelectorAll(".chapter-item").forEach(i => i.style.backgroundColor = "");
    element.style.backgroundColor = "#f0f0f0";
    localStorage.setItem("lastHref", href);
}

// Search Logic: Scroll to next item
searchInput.addEventListener("input", (e) => {
    const term = e.target.value.toLowerCase().trim();
    if (!term) return;

    const items = chapterListDiv.querySelectorAll(".chapter-item");
    for (let item of items) {
        if (item.textContent.toLowerCase().includes(term)) {
            item.scrollIntoView({ behavior: "smooth", block: "center" });
            item.style.borderLeft = "4px solid var(--primary)";
            setTimeout(() => item.style.borderLeft = "none", 2000);
            break; 
        }
    }
});

async function loadChapter(href, title) {
    textArea.value = "Loading text...";
    currentChapterTitle = title.replace(/[^a-z0-9]/gi, '_');
    const section = book.spine.get(href);
    if (section) {
        const contents = await section.load(book.load.bind(book));
        const text = (contents.querySelector("body").innerText || contents.textContent).trim();
        textArea.value = text;
        localStorage.setItem("lastText", text);
        localStorage.setItem("lastTitle", currentChapterTitle);
        section.unload();
    }
}

async function generate() {
    const text = textArea.value.trim();
    if (!text || text === "Loading text...") return;

    genBtn.disabled = true;
    genBtn.textContent = "Generating...";
    
    try {
        const res = await fetch("/api/tts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text })
        });
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        player.src = url;
        downloadBtn.href = url;
        downloadBtn.download = `${currentChapterTitle}.mp3`;
        downloadBtn.style.display = "block";
        player.play();
    } catch (err) {
        alert("Error generating audio.");
    } finally {
        genBtn.disabled = false;
        genBtn.textContent = "Generate Audiobook";
    }
}

function flattenTOC(toc) {
    let res = [];
    toc.forEach(i => {
        res.push(i);
        if (i.subitems?.length > 0) res = res.concat(flattenTOC(i.subitems));
    });
    return res;
}