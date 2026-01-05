let currentBook;
let chapters = [];
let currentChapHref = ""; 
let nextChapterBlob = null; // Buffer for the 80% pre-gen
let isPreGenerating = false;

const dbName = "EpubLibraryDB";
const storeName = "books";
const player = document.getElementById("player");
const displayText = document.getElementById("textDisplay");
const textContainer = document.getElementById("contentArea");

// --- UTILS ---
function toggleMenu() {
    document.getElementById('sidebar').classList.toggle('active');
    document.getElementById('overlay').classList.toggle('active');
}

// --- DATABASE ---
function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onupgradeneeded = e => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(storeName)) {
                db.createObjectStore(storeName, { keyPath: "id", autoIncrement: true });
            }
        };
        request.onsuccess = e => resolve(e.target.result);
        request.onerror = e => reject(e.target.error);
    });
}

// --- PLAYER LOGIC (PROGRESS & AUTO-NEXT) ---
player.addEventListener('timeupdate', () => {
    const bookId = localStorage.getItem("currentBookId");
    if (!bookId || !currentChapHref || player.duration === 0) return;

    // 1. Save Progress
    localStorage.setItem(`seconds_${bookId}_${currentChapHref}`, player.currentTime);

    // 2. 80% Threshold Check for Pre-generation
    const progress = player.currentTime / player.duration;
    if (progress > 0.8 && !nextChapterBlob && !isPreGenerating) {
        preGenerateNext();
    }
});

// Auto-advance when audio finishes
player.addEventListener('ended', () => {
    if (nextChapterBlob) {
        // If we already have the blob from the 80% mark, use it
        usePreGeneratedNext();
    } else {
        // Otherwise, just trigger normal next
        nextChapter();
    }
});

// --- TTS CORE ---
async function fetchTTSBlob(text) {
    const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.substring(0, 5000) })
    });
    if (!res.ok) throw new Error("TTS Failed");
    return await res.blob();
}

// --- PRE-GENERATION LOGIC (80% MARK) ---
async function preGenerateNext() {
    const currentIndex = chapters.findIndex(c => c.href === currentChapHref);
    if (currentIndex < 0 || currentIndex >= chapters.length - 1) return;

    isPreGenerating = true;
    const nextChap = chapters[currentIndex + 1];

    try {
        const section = currentBook.spine.get(nextChap.href);
        const contents = await section.load(currentBook.load.bind(currentBook));
        const text = (contents.querySelector("body").innerText || contents.textContent).trim();
        
        console.log("80% reached: Pre-generating next chapter...");
        nextChapterBlob = await fetchTTSBlob(text);
        section.unload();
    } catch (e) {
        console.error("Pre-gen failed", e);
    } finally {
        isPreGenerating = false;
    }
}

async function usePreGeneratedNext() {
    const currentIndex = chapters.findIndex(c => c.href === currentChapHref);
    const next = chapters[currentIndex + 1];
    const blob = nextChapterBlob;
    nextChapterBlob = null; // Clear buffer

    // Update UI and load the next chapter metadata
    await loadChapter(next.href, next.label || `Section ${currentIndex + 2}`, false);
    
    // Play the pre-fetched blob immediately
    if (player.src) URL.revokeObjectURL(player.src);
    player.src = URL.createObjectURL(blob);
    player.play();
}

// --- READER LOGIC ---
async function openBook(id, data, title) {
    localStorage.setItem("currentBookId", id);
    document.getElementById("libraryContainer").style.display = "none";
    document.getElementById("readerContainer").style.display = "flex";
    document.getElementById("bookTitleDisplay").innerText = title;

    currentBook = ePub(data);
    const nav = await currentBook.loaded.navigation;
    
    chapters = (function flatten(toc) {
        return toc.reduce((acc, val) => acc.concat({ 
            label: val.label ? val.label.trim() : null, 
            href: val.href 
        }, val.subitems ? flatten(val.subitems) : []), []);
    })(nav.toc);

    const list = document.getElementById("chapterList");
    list.innerHTML = "";
    chapters.forEach((ch, index) => {
        const div = document.createElement("div");
        div.className = "chapter-item";
        const chapterTitle = ch.label || `Section ${index + 1}`;
        div.innerHTML = `<span>${chapterTitle}</span>`;
        div.dataset.href = ch.href;
        div.onclick = () => loadChapter(ch.href, chapterTitle, true);
        list.appendChild(div);
    });

    const lastHref = localStorage.getItem(`lastChapterHref_${id}`);
    const lastLabel = localStorage.getItem(`lastChapterNum_${id}`);
    
    // Initial Load: Respects saved seconds
    await loadChapter(lastHref || chapters[0].href, lastLabel || chapters[0].label, true);
}

async function loadChapter(href, title, autoPlay = true) {
    nextChapterBlob = null; // Reset pre-gen buffer on manual change
    currentChapHref = href;
    displayText.innerText = "Loading...";
    
    const section = currentBook.spine.get(href);
    if (section) {
        const bookId = localStorage.getItem("currentBookId");
        localStorage.setItem(`lastChapterHref_${bookId}`, href);
        localStorage.setItem(`lastChapterNum_${bookId}`, title);
        document.getElementById("chapterNumberDisplay").innerText = title;

        const contents = await section.load(currentBook.load.bind(currentBook));
        const text = (contents.querySelector("body").innerText || contents.textContent).trim();
        displayText.innerText = text;
        
        document.querySelectorAll(".chapter-item").forEach(i => i.classList.remove("active-chap"));
        const active = Array.from(document.querySelectorAll(".chapter-item")).find(i => i.dataset.href === href);
        if (active) active.classList.add("active-chap");

        section.unload();

        if (autoPlay) {
            await generateTTS(href);
        }
    }
}

// --- TTS GENERATION ---
async function generateTTS(href) {
    const btn = document.getElementById("genBtn");
    btn.disabled = true;
    btn.innerText = "Generating...";

    try {
        const blob = await fetchTTSBlob(displayText.innerText);
        const bookId = localStorage.getItem("currentBookId");
        
        if (player.src) URL.revokeObjectURL(player.src);
        player.src = URL.createObjectURL(blob);
        player.playbackRate = parseFloat(document.getElementById("speedSelect").value || 1.0);
        
        // GET SAVED SECONDS
        const saved = localStorage.getItem(`seconds_${bookId}_${href}`);
        if (saved) {
            player.currentTime = parseFloat(saved);
        } else {
            player.currentTime = 0; // RESTART audio on new chapter
        }
        
        player.play().catch(e => console.warn("Autoplay blocked", e));
    } catch (e) {
        console.error(e);
    } finally {
        btn.disabled = false;
        btn.innerText = "Read Aloud";
    }
}

// --- NAVIGATION ---
function nextChapter() {
    const currentIndex = chapters.findIndex(c => c.href === currentChapHref);
    if (currentIndex < chapters.length - 1) {
        const next = chapters[currentIndex + 1];
        // Ensure progress is reset for the new chapter unless we have saved data
        loadChapter(next.href, next.label || `Section ${currentIndex + 2}`, true);
    }
}

function prevChapter() {
    const currentIndex = chapters.findIndex(c => c.href === currentChapHref);
    if (currentIndex > 0) {
        const prev = chapters[currentIndex - 1];
        loadChapter(prev.href, prev.label || `Section ${currentIndex}`, true);
    }
}

function closeBook() {
    localStorage.removeItem("currentBookId");
    document.getElementById("libraryContainer").style.display = "block";
    document.getElementById("readerContainer").style.display = "none";
    player.pause();
}

document.getElementById("speedSelect").addEventListener("change", (e) => {
    player.playbackRate = parseFloat(e.target.value);
});

document.getElementById("chapSearch").addEventListener("input", (e) => {
    const query = e.target.value.toLowerCase();
    document.querySelectorAll(".chapter-item").forEach(item => {
        item.style.display = item.innerText.toLowerCase().includes(query) ? "block" : "none";
    });
});

window.addEventListener("DOMContentLoaded", () => loadLibrary());
document.getElementById("fileInput").addEventListener("change", e => {
    if (e.target.files[0]) saveBook(e.target.files[0], e.target.files[0].name);
});