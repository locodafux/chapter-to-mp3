/* --- STATE MANAGEMENT --- */
let book;
let allChapters = [];
let isGeneratingNext = false;
let nextAudioUrl = null;
let nextChapterData = null;

// Selectors
const chapterListDiv = document.getElementById("chapterList");
const chapterSearch = document.getElementById("chapterSearch");
const displayText = document.getElementById("displayText");
const genBtn = document.getElementById("genBtn");
const player = document.getElementById("player");
const statusInfo = document.getElementById("statusInfo");
const speedSelect = document.getElementById("speedSelect");
const epubFileInput = document.getElementById("epubFile");

/* --- INITIALIZATION --- */
window.addEventListener("DOMContentLoaded", () => {
    // Restore text from last session
    const savedText = localStorage.getItem("lastText");
    if (savedText) displayText.innerText = savedText;
    
    // Restore user speed preference
    const savedSpeed = localStorage.getItem("preferredSpeed");
    if (savedSpeed) {
        speedSelect.value = savedSpeed;
        player.playbackRate = parseFloat(savedSpeed);
    }

    chapterSearch.addEventListener("input", filterChapters);
    
    speedSelect.addEventListener("change", () => {
        const speed = parseFloat(speedSelect.value);
        player.playbackRate = speed;
        localStorage.setItem("preferredSpeed", speed);
    });
});

/* --- EPUB HANDLING --- */
epubFileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (event) => loadEpubData(event.target.result);
        reader.readAsArrayBuffer(file);
    }
});

async function loadEpubData(data) {
    statusInfo.innerText = "Processing EPUB...";
    book = ePub(data);
    await book.ready;
    const navigation = await book.loaded.navigation;
    allChapters = flattenTOC(navigation.toc);
    renderChapters(allChapters);
    statusInfo.innerText = "Book Loaded";
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
        div.innerHTML = `<span>${chapter.label}</span><span style="color:var(--accent)">▶</span>`;
        
        div.onclick = async () => {
            if(window.innerWidth < 1024) toggleDrawer();
            // Force restart when clicking a new chapter from list
            await loadChapter(chapter.href, chapter.label, true); 
        };
        chapterListDiv.appendChild(div);
    });
}

/* --- NAVIGATION LOGIC --- */
async function loadChapter(href, title, shouldRestart = true) {
    displayText.innerText = "Loading text...";
    
    if (shouldRestart) {
        localStorage.setItem("lastAudioTime", 0);
        player.currentTime = 0;
    }

    const section = book.spine.get(href);
    if (section) {
        const contents = await section.load(book.load.bind(book));
        const text = (contents.querySelector("body").innerText || contents.textContent).trim();
        
        displayText.innerText = text;
        localStorage.setItem("lastText", text);
        localStorage.setItem("lastHref", href);
        
        section.unload();
        generate(shouldRestart);
    }
}

async function changeChapter(dir) {
    const lastHref = localStorage.getItem("lastHref");
    const currentIndex = allChapters.findIndex(c => c.href === lastHref);
    const newIndex = currentIndex + dir;
    
    if (newIndex >= 0 && newIndex < allChapters.length) {
        // Force restart when hitting Next/Prev buttons
        await loadChapter(allChapters[newIndex].href, allChapters[newIndex].label, true);
    }
}

/* --- AUDIO & TTS LOGIC --- */
async function generate(shouldRestart = true) {
    const text = displayText.innerText;
    if (!text || text.startsWith("Loading")) return;
    
    genBtn.disabled = true;
    genBtn.textContent = "Generating...";
    nextAudioUrl = null; // Clear any pre-loaded data

    try {
        const res = await fetch("/api/tts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text })
        });
        
        if (!res.ok) throw new Error("TTS Request Failed");
        
        const blob = await res.blob();
        player.src = URL.createObjectURL(blob);
        
        // Ensure restart happens once the audio data is actually loaded
        player.onloadedmetadata = () => {
            if (shouldRestart) {
                player.currentTime = 0;
            } else {
                const saved = localStorage.getItem("lastAudioTime");
                player.currentTime = saved ? parseFloat(saved) : 0;
            }
            player.playbackRate = parseFloat(speedSelect.value);
            player.play();
        };

    } catch (err) {
        statusInfo.innerText = "Generation failed.";
        console.error(err);
    } finally {
        genBtn.disabled = false;
        genBtn.textContent = "Generate Audio";
    }
}

player.ontimeupdate = () => {
    if (!player.duration) return;
    localStorage.setItem("lastAudioTime", player.currentTime);
    
    // Predective pre-load: Generate next chapter audio when 85% finished
    if (!isGeneratingNext && !nextAudioUrl && (player.currentTime / player.duration) > 0.85) {
        prepareNextChapter();
    }
};

player.onended = () => {
    if (nextAudioUrl) {
        // Auto-advance to pre-loaded audio
        player.src = nextAudioUrl;
        displayText.innerText = nextChapterData.text;
        
        localStorage.setItem("lastText", nextChapterData.text);
        localStorage.setItem("lastHref", nextChapterData.href);
        localStorage.setItem("lastAudioTime", 0);
        
        player.currentTime = 0;
        player.play();
        
        nextAudioUrl = null;
        isGeneratingNext = false;
    } else {
        statusInfo.innerText = "Chapter Finished";
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
    
    try {
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
    } catch (e) {
        isGeneratingNext = false;
    }
}

/* --- UI UTILITIES --- */
function filterChapters() {
    const query = chapterSearch.value.toLowerCase();
    const items = chapterListDiv.querySelectorAll(".chapter-item");
    items.forEach(item => {
        const match = item.innerText.toLowerCase().includes(query);
        item.style.display = match ? "flex" : "none";
    });
}

function toggleDrawer() {
    const drawer = document.getElementById('chapterDrawer');
    if (drawer) drawer.classList.toggle('active');
}