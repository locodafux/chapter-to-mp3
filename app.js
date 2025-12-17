let book;
let allChapters = [];
let currentChapterTitle = localStorage.getItem("lastTitle") || "audiobook_chapter";
let isGeneratingNext = false;
let nextAudioUrl = null;
let nextChapterData = null;

const DEFAULT_BOOK_PATH = "/book.epub"; 

const chapterListDiv = document.getElementById("chapterList");
const displayText = document.getElementById("displayText");
const textContainer = document.getElementById("textDisplay");
const genBtn = document.getElementById("genBtn");
const player = document.getElementById("player");
const downloadBtn = document.getElementById("download");

// --- INITIALIZE ---
window.addEventListener("DOMContentLoaded", async () => {
    const savedText = localStorage.getItem("lastText");
    if (savedText) displayText.innerText = savedText;

    try {
        const response = await fetch(DEFAULT_BOOK_PATH);
        if (response.ok) {
            const arrayBuffer = await response.arrayBuffer();
            loadEpubData(arrayBuffer);
        }
    } catch (err) { console.error("Default book load failed."); }
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

// --- CHAPTER NAVIGATION ---
async function changeChapter(direction) {
    const lastHref = localStorage.getItem("lastHref");
    const currentIndex = allChapters.findIndex(c => c.href === lastHref);
    const newIndex = currentIndex + direction;

    if (newIndex >= 0 && newIndex < allChapters.length) {
        const chap = allChapters[newIndex];
        const target = Array.from(chapterListDiv.children).find(el => el.dataset.href === chap.href);
        if (target) {
            chapterListDiv.querySelectorAll(".chapter-item").forEach(i => i.style.backgroundColor = "");
            target.style.backgroundColor = "#f0f0f0";
            target.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        await loadChapter(chap.href, chap.label.trim());
        generate();
    }
}

async function loadChapter(href, title) {
    displayText.innerText = "Loading text...";
    textContainer.scrollTop = 0;
    currentChapterTitle = title.replace(/[^a-z0-9]/gi, '_');
    
    const section = book.spine.get(href);
    if (section) {
        const contents = await section.load(book.load.bind(book));
        const text = (contents.querySelector("body").innerText || contents.textContent).trim();
        displayText.innerText = text;
        localStorage.setItem("lastText", text);
        localStorage.setItem("lastTitle", currentChapterTitle);
        localStorage.setItem("lastHref", href);
        section.unload();
    }
}

// --- AUDIO GENERATION & AUTOPLAY ---
player.ontimeupdate = async () => {
    if (player.duration && !isGeneratingNext && !nextAudioUrl) {
        if ((player.currentTime / player.duration) > 0.8) prepareNextChapter();
    }
};

player.onended = () => {
    if (nextAudioUrl) {
        player.src = nextAudioUrl;
        displayText.innerText = nextChapterData.text;
        textContainer.scrollTop = 0;
        localStorage.setItem("lastText", nextChapterData.text);
        localStorage.setItem("lastHref", nextChapterData.href);
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
        nextChapterData = { text, href: nextChapter.href };
    }
}

async function generate() {
    const text = displayText.innerText;
    if (!text || text.startsWith("Loading")) return;
    genBtn.disabled = true;
    genBtn.textContent = "Generating...";
    nextAudioUrl = null;

    try {
        const res = await fetch("/api/tts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text })
        });
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        player.src = url;
        player.play();
        downloadBtn.href = url;
        downloadBtn.style.display = "block";
    } catch (err) { alert("Failed."); }
    finally {
        genBtn.disabled = false;
        genBtn.textContent = "Generate Audio";
    }
}

// Helper: Flatten EPUB TOC
function flattenTOC(toc) {
    let res = [];
    toc.forEach(i => {
        res.push(i);
        if (i.subitems?.length > 0) res = res.concat(flattenTOC(i.subitems));
    });
    return res;
}

// Sidebar Render
function renderChapters(chapters) {
    chapterListDiv.innerHTML = "";
    chapters.forEach(chapter => {
        const div = document.createElement("div");
        div.className = "chapter-item";
        div.dataset.href = chapter.href;
        div.innerHTML = `<span class="chapter-label">${chapter.label}</span><button class="play-btn-mini">▶</button>`;
        div.onclick = () => {
            chapterListDiv.querySelectorAll(".chapter-item").forEach(i => i.style.backgroundColor = "");
            div.style.backgroundColor = "#f0f0f0";
            loadChapter(chapter.href, chapter.label);
        };
        chapterListDiv.appendChild(div);
    });
}