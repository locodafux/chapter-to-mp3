let currentBook;
let chapters = [];
const dbName = "EpubLibraryDB";
const storeName = "books";
const player = document.getElementById("player");

// NEW: Define these so loadChapter can find them
const displayText = document.getElementById("textDisplay");
const textContainer = document.getElementById("contentArea");

// --- MOBILE DRAWER LOGIC ---
function toggleMenu() {
    document.getElementById('sidebar').classList.toggle('active');
    document.getElementById('overlay').classList.toggle('active');
}

// --- DATABASE SETUP ---
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

// --- PROGRESS TRACKING (SECONDS) ---
player.addEventListener('timeupdate', () => {
    const bookId = localStorage.getItem("currentBookId");
    const chapHref = localStorage.getItem(`lastChapterHref_${bookId}`);
    if (bookId && chapHref && player.currentTime > 0) {
        localStorage.setItem(`seconds_${bookId}_${chapHref}`, player.currentTime);
    }
});

// --- LIBRARY LOGIC ---
async function saveBook(fileOrBlob, fileName) {
    try {
        const buffer = await (fileOrBlob.arrayBuffer ? fileOrBlob.arrayBuffer() : new Response(fileOrBlob).arrayBuffer());
        const tempBook = ePub(buffer);
        await tempBook.ready;
        const meta = await tempBook.loaded.metadata;

        const db = await initDB();
        const tx = db.transaction(storeName, "readwrite");
        const store = tx.objectStore(storeName);

        const existing = await new Promise(r => {
            const req = store.getAll();
            req.onsuccess = () => r(req.result);
        });

        const title = meta.title || fileName;
        if (!existing.some(b => b.title === title && b.fileName === fileName)) {
            store.add({ title, fileName, author: meta.creator || "Unknown", data: buffer });
        }
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
        const books = request.result;
        
        books.forEach(b => {
            const card = document.createElement("div");
            card.className = "book-card";
            card.innerHTML = `<button class="delete-btn" onclick="deleteBook(event, ${b.id})">✕</button>
                              <span class="icon">📖</span><strong>${b.title}</strong>
                              <div style="font-size:10px; color:#999; margin-top:5px;">${b.fileName}</div>`;
            card.onclick = () => openBook(b.id, b.data, b.title);
            grid.appendChild(card);
        });

        const savedId = localStorage.getItem("currentBookId");
        if (savedId) {
            const lastBook = books.find(b => b.id == savedId);
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

async function syncFolderBooks() {
    const files = ["book.epub", "book1.epub"];
    for (const name of files) {
        try {
            const res = await fetch(`./${name}`);
            if (res.ok) await saveBook(await res.blob(), name);
        } catch (e) { console.warn("Auto-sync failed for:", name); }
    }
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
        return toc.reduce((acc, val) => acc.concat(val, val.subitems ? flatten(val.subitems) : []), []);
    })(nav.toc);

    const list = document.getElementById("chapterList");
    list.innerHTML = "";
    chapters.forEach((ch, index) => {
        const div = document.createElement("div");
        div.className = "chapter-item";
        div.innerHTML = `<span>Chapter ${index + 1}</span>`;
        div.dataset.href = ch.href;
        div.onclick = () => { 
            loadChapter(ch.href, index + 1, true); 
            if(window.innerWidth < 800) toggleMenu(); 
        };
        list.appendChild(div);
    });

    const lastHref = localStorage.getItem(`lastChapterHref_${id}`);
    const lastNum = localStorage.getItem(`lastChapterNum_${id}`);
    loadChapter(lastHref || chapters[0].href, lastNum || 1, !!lastHref);
}

async function loadChapter(href, num, autoPlay = true) {
    if (!displayText) return;
    displayText.innerText = "Loading text...";
    if (textContainer) textContainer.scrollTop = 0;
    
    const section = currentBook.spine.get(href);
    if (section) {
        const bookId = localStorage.getItem("currentBookId");
        localStorage.setItem(`lastChapterHref_${bookId}`, href);
        localStorage.setItem(`lastChapterNum_${bookId}`, num);
        document.getElementById("chapterNumberDisplay").innerText = `Chapter ${num}`;

        const contents = await section.load(currentBook.load.bind(currentBook));
        
        const bodyNode = contents.querySelector("body") || contents;
        let rawText = (bodyNode.innerText || bodyNode.textContent).trim();
        
        let lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        while (lines.length > 1) {
            const firstLine = lines[0].toLowerCase();
            const secondLine = lines[1].toLowerCase();
            if (firstLine === secondLine || firstLine.includes("chapter")) {
                lines.shift(); 
            } else {
                break; 
            }
        }

        const cleanedText = lines.join('\n\n');
        displayText.innerText = cleanedText;
        
        document.querySelectorAll(".chapter-item").forEach(i => i.classList.remove("active-chap"));
        const active = Array.from(document.querySelectorAll(".chapter-item")).find(i => i.dataset.href === href);
        if (active) active.classList.add("active-chap");

        section.unload();

        if (autoPlay) await generateTTS(href);
    }
}

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
        
        player.play().catch(() => console.log("User must tap to enable audio."));
    } catch (e) { console.error("TTS Failed:", e); }
    finally { btn.disabled = false; btn.innerText = "Read Aloud"; }
}

function closeBook() {
    localStorage.removeItem("currentBookId");
    document.getElementById("libraryContainer").style.display = "block";
    document.getElementById("readerContainer").style.display = "none";
    player.pause();
}

// --- SPEED CONTROL FIX ---
document.getElementById("speedSelect").addEventListener("change", (e) => {
    player.playbackRate = parseFloat(e.target.value);
});

// --- SEARCH LOGIC ---
document.getElementById("chapSearch").addEventListener("input", (e) => {
    const query = e.target.value.toLowerCase();
    const items = Array.from(document.querySelectorAll(".chapter-item"));
    items.forEach(i => { i.style.display = "flex"; i.style.opacity = "1"; i.style.background = "transparent"; });

    if (query.length === 0) return;

    const matchIndex = items.findIndex(item => item.innerText.toLowerCase().includes(query));
    if (matchIndex !== -1) {
        items.forEach((item, index) => {
            if (index < matchIndex) item.style.display = "none";
            else if (index === matchIndex) {
                item.style.background = "#fff9c4"; 
                item.scrollIntoView({ behavior: "smooth", block: "start" });
            } else item.style.opacity = "0.7";
        });
    }
});

window.addEventListener("DOMContentLoaded", async () => {
    await loadLibrary();
    await syncFolderBooks();
});

document.getElementById("fileInput").addEventListener("change", e => {
    if (e.target.files[0]) saveBook(e.target.files[0], e.target.files[0].name);
});