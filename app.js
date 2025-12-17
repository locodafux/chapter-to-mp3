let book;
let allChapters = [];
let isGeneratingNext = false;
let nextAudioUrl = null;
let nextChapterData = null;

const DEFAULT_BOOK_PATH = "/book.epub"; 

const chapterListDiv = document.getElementById("chapterList");
const displayText = document.getElementById("displayText");
const textContainer = document.getElementById("textDisplay");
const genBtn = document.getElementById("genBtn");
const player = document.getElementById("player");
const statusInfo = document.getElementById("statusInfo");

// --- INITIALIZE ---
window.addEventListener("DOMContentLoaded", async () => {
    const savedText = localStorage.getItem("lastText");
    if (savedText) displayText.innerText = savedText;
    
    const savedTime = localStorage.getItem("lastAudioTime");
    if (savedTime && savedTime > 0) {
        statusInfo.innerText = `Last saved position: ${Math.floor(savedTime / 60)}m ${Math.floor(savedTime % 60)}s`;
    }

    try {
        const response = await fetch(DEFAULT_BOOK_PATH);
        if (response.ok) loadEpubData(await response.arrayBuffer());
    } catch (err) { console.error("Load failed."); }
});

async function loadEpubData(data) {
    book = ePub(data);
    await book.ready;
    const navigation = await book.loaded.navigation;
    allChapters = flattenTOC(navigation.toc);
    renderChapters(allChapters);
    restoreLastPosition();
}

function restoreLastPosition() {
    const lastHref = localStorage.getItem("lastHref");
    if (lastHref) {
        const target = Array.from(chapterListDiv.children).find(el => el.dataset.href === lastHref);
        if (target) {
            target.style.backgroundColor = "#f0f0f0";
            target.scrollIntoView({ block: "center" });
        }
    }
}

// --- NAVIGATION ---
async function changeChapter(dir) {
    const lastHref = localStorage.getItem("lastHref");
    const currentIndex = allChapters.findIndex(c => c.href === lastHref);
    const newIndex = currentIndex + dir;
    if (newIndex >= 0 && newIndex < allChapters.length) {
        // RESET TIME for new chapter
        localStorage.setItem("lastAudioTime", 0);
        statusInfo.innerText = "";
        
        const chap = allChapters[newIndex];
        await loadChapter(chap.href, chap.label);
        generate();
    }
}

async function loadChapter(href, title) {
    displayText.innerText = "Loading text...";
    textContainer.scrollTop = 0;
    const section = book.spine.get(href);
    if (section) {
        const contents = await section.load(book.load.bind(book));
        const text = (contents.querySelector("body").innerText || contents.textContent).trim();
        displayText.innerText = text;
        localStorage.setItem("lastText", text);
        localStorage.setItem("lastHref", href);
        section.unload();
        
        // Highlight in list
        chapterListDiv.querySelectorAll(".chapter-item").forEach(i => i.style.backgroundColor = "");
        const target = Array.from(chapterListDiv.children).find(el => el.dataset.href === href);
        if (target) target.style.backgroundColor = "#f0f0f0";
    }
}

// --- AUDIO LOGIC ---
player.ontimeupdate = () => {
    if (!player.duration) return;
    
    // 1. Save progress
    localStorage.setItem("lastAudioTime", player.currentTime);
    
    // 2. Pre-generate next at 80%
    if (!isGeneratingNext && !nextAudioUrl && (player.currentTime / player.duration) > 0.8) {
        prepareNextChapter();
    }
};

// This is the "Magic" - it jumps to the saved time once the audio file loads
player.onloadedmetadata = () => {
    const savedTime = localStorage.getItem("lastAudioTime");
    if (savedTime && savedTime > 0) {
        player.currentTime = parseFloat(savedTime);
        statusInfo.innerText = "Resumed from last position";
    }
};

player.onended = () => {
    if (nextAudioUrl) {
        player.src = nextAudioUrl;
        displayText.innerText = nextChapterData.text;
        localStorage.setItem("lastText", nextChapterData.text);
        localStorage.setItem("lastHref", nextChapterData.href);
        localStorage.setItem("lastAudioTime", 0); // Reset for new chapter
        player.play();
        nextAudioUrl = null;
        isGeneratingNext = false;
    }
};

async function generate() {
    const text = displayText.innerText;
    if (!text || text.startsWith("Loading")) return;
    
    genBtn.disabled = true;
    genBtn.textContent = "Generating...";
    
    try {
        const res = await fetch("/api/tts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text })
        });
        const blob = await res.blob();
        player.src = URL.createObjectURL(blob);
        player.play();
    } catch (err) { alert("Generation failed."); }
    finally {
        genBtn.disabled = false;
        genBtn.textContent = "Generate Audio";
    }
}

// Background Prep
async function prepareNextChapter() {
    isGeneratingNext = true;
    const lastHref = localStorage.getItem("lastHref");
    const currentIndex = allChapters.findIndex(c => c.href === lastHref);
    const nextChapter = allChapters[currentIndex + 1];
    if (!nextChapter) return;

    const section = book.spine.get(nextChapter.href);
    const contents = await section.load(book.load.bind(book));
    const text = (contents.querySelector("body").innerText || contents.textContent).trim();
    
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

// Helpers
function flattenTOC(toc) {
    let res = [];
    toc.forEach(i => {
        res.push(i);
        if (i.subitems?.length > 0) res = res.concat(flattenTOC(i.subitems));
    });
    return res;
}

function renderChapters(chapters) {
    chapterListDiv.innerHTML = "";
    chapters.forEach(chapter => {
        const div = document.createElement("div");
        div.className = "chapter-item";
        div.dataset.href = chapter.href;
        div.innerHTML = `<span class="chapter-label">${chapter.label}</span><span>▶</span>`;
        div.onclick = () => loadChapter(chapter.href, chapter.label);
        chapterListDiv.appendChild(div);
    });
}