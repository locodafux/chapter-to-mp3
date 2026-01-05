let currentBook;
let chapters = [];
const dbName = "EpubLibraryDB";
const storeName = "books";
const player = document.getElementById("player");

// --- DB INITIALIZATION ---
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
        const alreadyExists = existing.some(b => b.title === title && b.fileName === fileName);

        if (!alreadyExists) {
            store.add({ title, fileName, author: meta.creator || "Unknown", data: buffer });
        }
        tx.oncomplete = () => loadLibrary();
    } catch (err) {
        console.error("Error processing:", fileName, err);
    }
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
            card.innerHTML = `
                <button class="delete-btn" onclick="deleteBook(event, ${b.id})">✕</button>
                <span class="icon">📖</span>
                <strong>${b.title}</strong>
                <div style="font-size: 11px; color: #888;">${b.fileName}</div>
            `;
            card.onclick = () => openBook(b.id, b.data, b.title);
            grid.appendChild(card);
        });

        const savedBookId = localStorage.getItem("currentBookId");
        if (savedBookId) {
            const lastBook = books.find(b => b.id == savedBookId);
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
            if (res.ok) {
                const blob = await res.blob();
                await saveBook(blob, name);
            }
        } catch (e) { console.error("Sync error:", name, e); }
    }
}

// --- READER & PERSISTENCE ---
async function openBook(id, data, title) {
    localStorage.setItem("currentBookId", id);
    const lib = document.getElementById("libraryContainer");
    const reader = document.getElementById("readerContainer");
    
    if (lib) lib.style.display = "none";
    if (reader) reader.style.display = "flex";
    document.getElementById("bookTitleDisplay").innerText = title;

    currentBook = ePub(data);
    const nav = await currentBook.loaded.navigation;
    
    chapters = (function flatten(toc) {
        return toc.reduce((acc, val) => acc.concat(val, val.subitems ? flatten(val.subitems) : []), []);
    })(nav.toc);

    const list = document.getElementById("chapterList");
    if (!list) return;
    list.innerHTML = "";
    chapters.forEach((ch, index) => {
        const div = document.createElement("div");
        div.className = "chapter-item";
        div.innerHTML = `<span>${index + 1}</span> ${ch.label}`;
        div.dataset.href = ch.href;
        div.onclick = () => loadChapter(ch.href, index + 1, true);
        list.appendChild(div);
    });

    const lastHref = localStorage.getItem(`lastChapterHref_${id}`);
    const lastNum = localStorage.getItem(`lastChapterNum_${id}`);
    if (lastHref) {
        loadChapter(lastHref, lastNum || 1, true);
    }
}

async function loadChapter(href, num, autoPlay = true) {
    if (!currentBook) return;
    const section = currentBook.spine.get(href);
    
    if (section) {
        const bookId = localStorage.getItem("currentBookId");
        localStorage.setItem(`lastChapterHref_${bookId}`, href);
        localStorage.setItem(`lastChapterNum_${bookId}`, num);

        const chapDisp = document.getElementById("chapterNumberDisplay");
        if (chapDisp) chapDisp.innerText = `| Chapter ${num}`;

        try {
            // Wait for the section to load the document content
            const doc = await section.load(currentBook.load.bind(currentBook));
            const textDisp = document.getElementById("textDisplay");
            
            if (textDisp && doc) {
                // SAFETY CHECK: Ensure doc and doc.body exist
                const bodyText = doc.body ? (doc.body.innerText || doc.body.textContent) : doc.textContent;
                textDisp.innerText = (bodyText || "").trim();
            }
            
            // UI Updates
            document.querySelectorAll(".chapter-item").forEach(i => i.classList.remove("active-chap"));
            const active = Array.from(document.querySelectorAll(".chapter-item")).find(i => i.dataset.href === href);
            if (active) {
                active.classList.add("active-chap");
                active.scrollIntoView({ behavior: "smooth", block: "center" });
            }
            
            const contentArea = document.querySelector(".content-area");
            if (contentArea) contentArea.scrollTop = 0;

            // Unload to free memory
            section.unload();

            // Only trigger TTS if we successfully found text
            if (autoPlay && textDisp && textDisp.innerText.length > 0) {
                await generateTTS(href);
            }
        } catch (err) {
            console.error("Error loading chapter content:", err);
        }
    }
}

async function generateTTS(href) {
    const display = document.getElementById("textDisplay");
    const btn = document.getElementById("genBtn");

    // ERROR FIX: Check if elements exist before reading innerText
    if (!display || !btn) return;

    const text = display.innerText;
    if (text.length < 10) return;
    
    btn.disabled = true;
    btn.innerText = "Generating...";

    try {
        const res = await fetch("/api/tts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: text.substring(0, 5000) })
        });
        
        const blob = await res.blob();
        const bookId = localStorage.getItem("currentBookId");
        const activeHref = href || localStorage.getItem(`lastChapterHref_${bookId}`);
        
        player.src = URL.createObjectURL(blob);
        player.playbackRate = parseFloat(document.getElementById("speedSelect")?.value || 1.0);
        
        const savedSecs = localStorage.getItem(`seconds_${bookId}_${activeHref}`);
        if (savedSecs) player.currentTime = parseFloat(savedSecs);

        player.play().catch(e => console.log("User must interact to play audio."));
    } catch (e) { 
        console.error("TTS Error:", e);
    } finally {
        btn.disabled = false;
        btn.innerText = "Generate Audio";
    }
}

function closeBook() {
    localStorage.removeItem("currentBookId");
    document.getElementById("libraryContainer").style.display = "block";
    document.getElementById("readerContainer").style.display = "none";
    player.pause();
}

// --- INIT ---
window.addEventListener("DOMContentLoaded", async () => {
    await loadLibrary();
    await syncFolderBooks();
});

document.getElementById("fileInput").addEventListener("change", e => {
    if (e.target.files[0]) saveBook(e.target.files[0], e.target.files[0].name);
});

document.getElementById("chapSearch")?.addEventListener("input", e => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll(".chapter-item").forEach(el => {
        el.style.display = el.innerText.toLowerCase().includes(q) ? "flex" : "none";
    });
});