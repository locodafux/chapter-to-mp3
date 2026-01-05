let book;
let allChapters = [];
let isGeneratingNext = false;
let nextAudioUrl = null;
let nextChapterData = null;

const DEFAULT_BOOK_PATH = "/book.epub"; 

const chapterListDiv = document.getElementById("chapterList");
const chapterSearch = document.getElementById("chapterSearch");
const displayText = document.getElementById("displayText");
const textContainer = document.getElementById("textDisplay");
const genBtn = document.getElementById("genBtn");
const player = document.getElementById("player");
const statusInfo = document.getElementById("statusInfo");
const speedSelect = document.getElementById("speedSelect");
const epubFileInput = document.getElementById("epubFile");

// --- INITIALIZE ---
window.addEventListener("DOMContentLoaded", async () => {
    const savedText = localStorage.getItem("lastText");
    if (savedText) displayText.innerText = savedText;
    
    const savedSpeed = localStorage.getItem("preferredSpeed");
    if (savedSpeed) speedSelect.value = savedSpeed;

    const savedTime = localStorage.getItem("lastAudioTime");
    if (savedTime > 0) {
        statusInfo.innerText = `Saved spot: ${Math.floor(savedTime/60)}m ${Math.floor(savedTime%60)}s`;
    }

    // Filter Logic
    chapterSearch.addEventListener("input", filterChapters);

    // Speed Control Logic
    speedSelect.addEventListener("change", updateSpeed);

    // Manual File Upload
    epubFileInput.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => loadEpubData(event.target.result);
            reader.readAsArrayBuffer(file);
        }
    });

    // Auto-load default
    try {
        const response = await fetch(DEFAULT_BOOK_PATH);
        if (response.ok) {
            const arrayBuffer = await response.arrayBuffer();
            loadEpubData(arrayBuffer);
        }
    } catch (err) { console.error("Auto-load failed."); }
});

// --- FILTERING ---
// --- SCROLL-TO-MATCH LOGIC ---
function filterChapters() {
    const query = chapterSearch.value.toLowerCase();
    const items = chapterListDiv.querySelectorAll(".chapter-item");
    
    if (!query) return; // Don't scroll if search is empty

    // Find the first chapter that matches the search text
    const match = Array.from(items).find(item => 
        item.innerText.toLowerCase().includes(query)
    );

    if (match) {
        // This scrolls the matched chapter to the top of the list 
        // without hiding any other chapters.
        match.scrollIntoView({ block: "start", behavior: "smooth" });
        
        // Optional: briefly highlight it so the user sees which one matched
        items.forEach(i => i.style.borderLeft = "none");
        match.style.borderLeft = "4px solid var(--primary)";
    }
}

// --- UPDATED RENDER FUNCTION ---
function renderChapters(chapters) {
    chapterListDiv.innerHTML = "";
    chapters.forEach(chapter => {
        const div = document.createElement("div");
        div.className = "chapter-item";
        div.dataset.href = chapter.href;
        // Ensure items stay visible (flex) even when searching
        div.style.display = "flex"; 
        
        div.innerHTML = `<span>${chapter.label}</span><button class="play-btn-mini">▶</button>`;
        
        div.onclick = async () => {
            localStorage.setItem("lastAudioTime", 0);
            statusInfo.innerText = "";
            await loadChapter(chapter.href, chapter.label);
            generate();
        };
        chapterListDiv.appendChild(div);
    });
}

// --- SYNC SIDEBAR ON CHAPTER CHANGE ---
function highlightAndScrollTo(href) {
    const items = chapterListDiv.querySelectorAll(".chapter-item");
    items.forEach(i => {
        i.style.backgroundColor = "";
        i.style.borderLeft = "none";
    });

    const target = Array.from(items).find(el => el.dataset.href === href);
    if (target) {
        target.style.backgroundColor = "#e1f5fe";
        // When a chapter plays, center it so you see what's before and after
        target.scrollIntoView({ block: "center", behavior: "smooth" });
    }
}

// --- EPUB LOADING ---
async function loadEpubData(data) {
    book = ePub(data);
    await book.ready;
    const navigation = await book.loaded.navigation;
    allChapters = flattenTOC(navigation.toc);
    renderChapters(allChapters);
    
    const lastHref = localStorage.getItem("lastHref");
    if (lastHref) highlightAndScrollTo(lastHref);
}

function highlightAndScrollTo(href) {
    const items = chapterListDiv.querySelectorAll(".chapter-item");
    items.forEach(i => i.style.backgroundColor = "");
    const target = Array.from(items).find(el => el.dataset.href === href);
    if (target) {
        target.style.backgroundColor = "#e1f5fe";
        target.scrollIntoView({ block: "center", behavior: "smooth" });
    }
}

function updateSpeed() {
    const speed = parseFloat(speedSelect.value);
    player.playbackRate = speed;
    localStorage.setItem("preferredSpeed", speed);
}

player.onplay = () => updateSpeed();

// --- NAVIGATION ---
async function changeChapter(dir) {
    const lastHref = localStorage.getItem("lastHref");
    const currentIndex = allChapters.findIndex(c => c.href === lastHref);
    const newIndex = currentIndex + dir;
    if (newIndex >= 0 && newIndex < allChapters.length) {
        const chap = allChapters[newIndex];
        localStorage.setItem("lastAudioTime", 0);
        statusInfo.innerText = "";
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
        
        highlightAndScrollTo(href);
        section.unload();
    }
}

// --- AUDIO LOGIC ---
player.ontimeupdate = () => {
    if (!player.duration) return;
    localStorage.setItem("lastAudioTime", player.currentTime);
    if (!isGeneratingNext && !nextAudioUrl && (player.currentTime / player.duration) > 0.8) {
        prepareNextChapter();
    }
};

player.onloadedmetadata = () => {
    const savedTime = localStorage.getItem("lastAudioTime");
    if (savedTime > 0) {
        player.currentTime = parseFloat(savedTime);
    }
    updateSpeed();
};

player.onended = () => {
    if (nextAudioUrl) {
        player.src = nextAudioUrl;
        displayText.innerText = nextChapterData.text;
        localStorage.setItem("lastText", nextChapterData.text);
        localStorage.setItem("lastHref", nextChapterData.href);
        localStorage.setItem("lastAudioTime", 0);
        highlightAndScrollTo(nextChapterData.href);
        player.play();
        nextAudioUrl = null;
        isGeneratingNext = false;
    }
};

async function generate() {
    const text = displayText.innerText;
    if (!text || text.startsWith("Loading") || text.startsWith("Select")) return;
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
        player.src = URL.createObjectURL(blob);
        player.play();
    } catch (err) { alert("TTS Generation failed."); }
    finally {
        genBtn.disabled = false;
        genBtn.textContent = "Generate Audio";
    }
}

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
        div.innerHTML = `<span>${chapter.label}</span><button class="play-btn-mini">▶</button>`;
        
        div.onclick = async () => {
            localStorage.setItem("lastAudioTime", 0);
            statusInfo.innerText = "";
            await loadChapter(chapter.href, chapter.label);
            generate();
        };
        chapterListDiv.appendChild(div);
    });
}