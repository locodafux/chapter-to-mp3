let currentBook;
let chapters = [];
let currentChapHref = ""; // Track current location
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

// --- PROGRESS TRACKING ---
player.addEventListener('timeupdate', () => {
    const bookId = localStorage.getItem("currentBookId");
    if (bookId && currentChapHref && player.currentTime > 0) {
        localStorage.setItem(`seconds_${bookId}_${currentChapHref}`, player.currentTime);
    }
});

// --- LIBRARY ---
async function saveBook(fileOrBlob, fileName) {
    try {
        const buffer = await (fileOrBlob.arrayBuffer ? fileOrBlob.arrayBuffer() : new Response(fileOrBlob).arrayBuffer());
        const tempBook = ePub(buffer);
        await tempBook.ready;
        const meta = await tempBook.loaded.metadata;

        const db = await initDB();
        const tx = db.transaction(storeName, "readwrite");
        const store = tx.objectStore(storeName);

        const title = meta.title || fileName;
        store.add({ title, fileName, author: meta.creator || "Unknown", data: buffer });
        tx.oncomplete = () => loadLibrary();
    } catch (err) { console.error("Save Error:", err); }
}

async function loadLibrary() {
    const db = await initDB();
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const request = store.getAll();

    request.onsuccess = () => {
        const grid = document.getElementById("bookGrid");
        if (!grid) return;
        grid.innerHTML = "";
        request.result.forEach(b => {
            const card = document.createElement("div");
            card.className = "book-card";
            card.innerHTML = `<button class="delete-btn" onclick="deleteBook(event, ${b.id})">✕</button>
                              <span class="icon">📖</span><strong>${b.title}</strong>
                              <div style="font-size:10px; color:#999; margin-top:5px;">${b.author}</div>`;
            card.onclick = () => openBook(b.id, b.data, b.title);
            grid.appendChild(card);
        });

        const savedId = localStorage.getItem("currentBookId");
        if (savedId) {
            const lastBook = request.result.find(b => b.id == savedId);
            if (lastBook) openBook(lastBook.id, lastBook.data, lastBook.title);
        }
    };
}

async function deleteBook(e, id) {
    e.stopPropagation();
    if (localStorage.getItem("currentBookId") == id) localStorage.removeItem("currentBookId");
    const db = await initDB();
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).delete(id);
    tx.oncomplete = () => loadLibrary();
}

// --- READER LOGIC ---
async function openBook(id, data, title) {
    localStorage.setItem("currentBookId", id);
    document.getElementById("libraryContainer").style.display = "none";
    document.getElementById("readerContainer").style.display = "flex";
    document.getElementById("bookTitleDisplay").innerText = title;

    currentBook = ePub(data);
    const nav = await currentBook.loaded.navigation;
    
    // Flatten TOC and capture actual labels
    chapters = (function flatten(toc) {
        return toc.reduce((acc, val) => {
            return acc.concat({ 
                label: val.label ? val.label.trim() : null, 
                href: val.href 
            }, val.subitems ? flatten(val.subitems) : []);
        }, []);
    })(nav.toc);

    const list = document.getElementById("chapterList");
    list.innerHTML = "";
    chapters.forEach((ch, index) => {
        const div = document.createElement("div");
        div.className = "chapter-item";
        const chapterTitle = ch.label || `Section ${index + 1}`;
        div.innerHTML = `<span>${chapterTitle}</span>`;
        div.dataset.href = ch.href;
        div.onclick = () => { 
            loadChapter(ch.href, chapterTitle, true); 
            if(window.innerWidth < 800) toggleMenu(); 
        };
        list.appendChild(div);
    });

    const lastHref = localStorage.getItem(`lastChapterHref_${id}`);
    const lastLabel = localStorage.getItem(`lastChapterNum_${id}`);
    const initialLabel = lastLabel || (chapters[0]?.label || "Chapter 1");
    
    loadChapter(lastHref || chapters[0].href, initialLabel, !!lastHref);
}

async function loadChapter(href, title, autoPlay = true) {
    if (!displayText) return;
    currentChapHref = href;
    displayText.innerText = "Loading text...";
    if (textContainer) textContainer.scrollTop = 0;
    
    const section = currentBook.spine.get(href);
    if (section) {
        const bookId = localStorage.getItem("currentBookId");
        localStorage.setItem(`lastChapterHref_${bookId}`, href);
        localStorage.setItem(`lastChapterNum_${bookId}`, title);
        document.getElementById("chapterNumberDisplay").innerText = title;

        const contents = await section.load(currentBook.load.bind(currentBook));
        const text = (contents.querySelector("body").innerText || contents.textContent).trim();
        displayText.innerText = text;
        
        // Highlight active chapter
        document.querySelectorAll(".chapter-item").forEach(i => i.classList.remove("active-chap"));
        const active = Array.from(document.querySelectorAll(".chapter-item")).find(i => i.dataset.href === href);
        if (active) active.classList.add("active-chap");

        section.unload();
        if (autoPlay) await generateTTS(href);
    }
}

// --- NAVIGATION ---
function nextChapter() {
    const currentIndex = chapters.findIndex(c => c.href === currentChapHref);
    if (currentIndex >= 0 && currentIndex < chapters.length - 1) {
        const next = chapters[currentIndex + 1];
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

// --- TTS ---
async function generateTTS(href) {
    const btn = document.getElementById("genBtn");
    if (!displayText || !btn || displayText.innerText.length < 5) return;
    
    btn.disabled = true;
    btn.innerText = "Generating...";

    try {
        const res = await fetch("/api/tts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: displayText.innerText.substring(0, 5000) })
        });
        const blob = await res.blob();
        const bookId = localStorage.getItem("currentBookId");
        
        player.src = URL.createObjectURL(blob);
        player.playbackRate = parseFloat(document.getElementById("speedSelect").value || 1.0);
        
        const saved = localStorage.getItem(`seconds_${bookId}_${href}`);
        if (saved) player.currentTime = parseFloat(saved);
        
        player.play().catch(() => console.log("User interaction required."));
    } catch (e) { console.error("TTS Failed:", e); }
    finally { btn.disabled = false; btn.innerText = "Read Aloud"; }
}

function closeBook() {
    localStorage.removeItem("currentBookId");
    document.getElementById("libraryContainer").style.display = "block";
    document.getElementById("readerContainer").style.display = "none";
    player.pause();
}

// --- SEARCH & CONTROLS ---
document.getElementById("speedSelect").addEventListener("change", (e) => {
    player.playbackRate = parseFloat(e.target.value);
});

document.getElementById("chapSearch").addEventListener("input", (e) => {
    const query = e.target.value.toLowerCase();
    document.querySelectorAll(".chapter-item").forEach(item => {
        const text = item.innerText.toLowerCase();
        item.style.display = text.includes(query) ? "block" : "none";
    });
});

window.addEventListener("DOMContentLoaded", () => loadLibrary());
document.getElementById("fileInput").addEventListener("change", e => {
    if (e.target.files[0]) saveBook(e.target.files[0], e.target.files[0].name);
});