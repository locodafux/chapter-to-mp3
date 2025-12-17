let book;
let allChapters = [];
let currentChapterTitle = localStorage.getItem("lastTitle") || "audiobook_chapter";
let isGeneratingNext = false;
let nextAudioUrl = null;
let nextChapterData = null;

const DEFAULT_BOOK_PATH = "/book.epub"; // Place book.epub in the root folder

const epubInput = document.getElementById("epubFile");
const chapterListDiv = document.getElementById("chapterList");
const searchInput = document.getElementById("chapterSearch");
const textArea = document.getElementById("text");
const genBtn = document.getElementById("genBtn");
const player = document.getElementById("player");
const downloadBtn = document.getElementById("download");

// --- INITIALIZATION ---
window.addEventListener("DOMContentLoaded", async () => {
    const savedText = localStorage.getItem("lastText");
    if (savedText) textArea.value = savedText;

    try {
        const response = await fetch(DEFAULT_BOOK_PATH);
        if (response.ok) {
            const arrayBuffer = await response.arrayBuffer();
            loadEpubData(arrayBuffer);
        } else {
            chapterListDiv.innerHTML = "<p style='padding:10px;'>Upload a book to start.</p>";
        }
    } catch (err) { console.error("Load failed:", err); }
});

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

    const lastHref = localStorage.getItem("lastHref");
    if (lastHref) {
        const target = Array.from(chapterListDiv.children).find(el => el.dataset.href === lastHref);
        if (target) {
            target.style.backgroundColor = "#f0f0f0";
            target.scrollIntoView({ block: "center" });
        }
    }
}

// --- RENDER & SELECTION ---
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

// --- AUTOPLAY & PRE-GENERATION ---
player.ontimeupdate = async () => {
    if (player.duration && !isGeneratingNext && !nextAudioUrl) {
        const progress = player.currentTime / player.duration;
        if (progress > 0.8) { 
            prepareNextChapter();
        }
    }
};

player.onended = () => {
    if (nextAudioUrl) {
        player.src = nextAudioUrl;
        if (nextChapterData) {
            currentChapterTitle = nextChapterData.title;
            textArea.value = nextChapterData.text;
            localStorage.setItem("lastText", nextChapterData.text);
            localStorage.setItem("lastTitle", nextChapterData.title);
            localStorage.setItem("lastHref", nextChapterData.href);
            
            const target = Array.from(chapterListDiv.children).find(el => el.dataset.href === nextChapterData.href);
            if (target) {
                chapterListDiv.querySelectorAll(".chapter-item").forEach(i => i.style.backgroundColor = "");
                target.style.backgroundColor = "#f0f0f0";
                target.scrollIntoView({ behavior: "smooth", block: "center" });
            }
        }
        player.play();
        nextAudioUrl = null;
        isGeneratingNext = false;
    }
};

async function prepareNextChapter() {
    isGeneratingNext = true;
    const lastHref = localStorage.getItem("lastHref");
    const currentIndex = allChapters.findIndex(c => c.href === lastHref);
    const nextChapter = allChapters[currentIndex + 1];

    if (!nextChapter) return;

    try {
        const section = book.spine.get(nextChapter.href);
        const contents = await section.load(book.load.bind(book));
        const text = (contents.querySelector("body").innerText || contents.textContent).trim();
        section.unload();

        const res = await fetch("/api/tts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text })
        });

        if (res.ok) {
            const blob = await res.blob();
            nextAudioUrl = URL.createObjectURL(blob);
            nextChapterData = { title: nextChapter.label.replace(/[^a-z0-9]/gi, '_'), text, href: nextChapter.href };
        }
    } catch (err) { isGeneratingNext = false; }
}

async function generate() {
    const text = textArea.value.trim();
    if (!text || text === "Loading text...") return;
    genBtn.disabled = true;
    genBtn.textContent = "Generating...";
    nextAudioUrl = null;
    isGeneratingNext = false;

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
    } catch (err) { alert("Generation failed."); }
    finally {
        genBtn.disabled = false;
        genBtn.textContent = "Generate Audiobook";
    }
}

// Utility functions
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

function flattenTOC(toc) {
    let res = [];
    toc.forEach(i => {
        res.push(i);
        if (i.subitems?.length > 0) res = res.concat(flattenTOC(i.subitems));
    });
    return res;
}

searchInput.addEventListener("input", (e) => {
    const term = e.target.value.toLowerCase().trim();
    if (!term) return;
    const items = chapterListDiv.querySelectorAll(".chapter-item");
    for (let item of items) {
        if (item.textContent.toLowerCase().includes(term)) {
            item.scrollIntoView({ behavior: "smooth", block: "center" });
            break; 
        }
    }
});