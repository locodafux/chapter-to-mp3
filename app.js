let book;
let allChapters = [];
let isGeneratingNext = false;
let nextAudioUrl = null;
let nextChapterData = null;

const DEFAULT_BOOK_PATH = "/mvs-1401-2100.epub";

const chapterListDiv = document.getElementById("chapterList");
const chapterSearch = document.getElementById("chapterSearch");
const displayText = document.getElementById("displayText");
const textContainer = document.getElementById("textDisplay");
const genBtn = document.getElementById("genBtn");
const player = document.getElementById("player");
const statusInfo = document.getElementById("statusInfo");
const speedSelect = document.getElementById("speedSelect");
const epubFileInput = document.getElementById("epubFile");

window.addEventListener("DOMContentLoaded", async () => {
    const savedText = localStorage.getItem("lastText");
    if (savedText) displayText.innerText = savedText;

    const savedSpeed = localStorage.getItem("preferredSpeed");
    if (savedSpeed) speedSelect.value = savedSpeed;

    const savedTime = localStorage.getItem("lastAudioTime");
    if (savedTime > 0) {
        statusInfo.innerText = `Saved spot: ${Math.floor(savedTime/60)}m ${Math.floor(savedTime%60)}s`;
    }

    chapterSearch.addEventListener("input", filterChapters);
    speedSelect.addEventListener("change", updateSpeed);

    epubFileInput.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => loadEpubData(event.target.result);
            reader.readAsArrayBuffer(file);
        }
    });

    try {
        const response = await fetch(DEFAULT_BOOK_PATH);
        if (response.ok) {
            const arrayBuffer = await response.arrayBuffer();
            loadEpubData(arrayBuffer);
        }
    } catch (err) {
        console.error("Auto-load failed.");
    }
});

/* ---------------- FILTER ---------------- */

function filterChapters() {
    const query = chapterSearch.value.toLowerCase();
    const items = chapterListDiv.querySelectorAll(".chapter-item");

    if (!query) return;

    const match = Array.from(items).find(item =>
        item.innerText.toLowerCase().includes(query)
    );

    if (match) {
        match.scrollIntoView({ block: "start", behavior: "smooth" });
        items.forEach(i => i.style.borderLeft = "none");
        match.style.borderLeft = "4px solid var(--primary)";
    }
}

/* ---------------- RENDER ---------------- */

function renderChapters(chapters) {
    chapterListDiv.innerHTML = "";

    chapters.forEach(chapter => {
        const div = document.createElement("div");
        div.className = "chapter-item";
        div.dataset.href = chapter.href;
        div.style.display = "flex";

        div.innerHTML = `
            <span>${chapter.label}</span>
            <button class="play-btn-mini">▶</button>
        `;

        div.onclick = async () => {
            localStorage.setItem("lastAudioTime", 0);
            statusInfo.innerText = "";
            await loadChapter(chapter.href);
            generate();
        };

        chapterListDiv.appendChild(div);
    });
}

function highlightAndScrollTo(href) {
    const items = chapterListDiv.querySelectorAll(".chapter-item");

    items.forEach(i => {
        i.style.backgroundColor = "";
        i.style.borderLeft = "none";
    });

    const target = Array.from(items).find(el => el.dataset.href === href);

    if (target) {
        target.style.backgroundColor = "#e1f5fe";
        target.scrollIntoView({ block: "center", behavior: "smooth" });
    }
}

/* ---------------- EPUB LOADING ---------------- */

async function loadEpubData(data) {
    book = ePub(data);
    await book.ready;

    const navigation = await book.loaded.navigation;
    allChapters = flattenTOC(navigation.toc);

    renderChapters(allChapters);

    const lastHref = localStorage.getItem("lastHref");
    if (lastHref) highlightAndScrollTo(lastHref);
}

async function loadChapter(href) {
    displayText.innerText = "Loading text...";
    textContainer.scrollTop = 0;

    const section = book.spine.get(href);
    if (!section) return;

    const contents = await section.load(book.load.bind(book));
    const text = (contents.querySelector("body").innerText || contents.textContent).trim();

    displayText.innerText = text;

    localStorage.setItem("lastText", text);
    localStorage.setItem("lastHref", href);

    highlightAndScrollTo(href);

    section.unload();
}

/* ---------------- SPEED CONTROL ---------------- */

function updateSpeed() {
    const speed = parseFloat(speedSelect.value);
    player.playbackRate = speed;
    localStorage.setItem("preferredSpeed", speed);
}

player.onplay = () => updateSpeed();

/* ---------------- NAVIGATION ---------------- */

async function changeChapter(dir) {
    const lastHref = localStorage.getItem("lastHref");
    const currentIndex = allChapters.findIndex(c => c.href === lastHref);
    const newIndex = currentIndex + dir;

    if (newIndex >= 0 && newIndex < allChapters.length) {
        const chap = allChapters[newIndex];

        localStorage.setItem("lastAudioTime", 0);
        statusInfo.innerText = "";

        await loadChapter(chap.href);
        generate();
    }
}

/* ---------------- AUDIO LOGIC ---------------- */

player.ontimeupdate = () => {
    if (!player.duration) return;

    localStorage.setItem("lastAudioTime", player.currentTime);

    // ✅ AUTO NEXT TRIGGER AT 70%
    if (!isGeneratingNext && !nextAudioUrl &&
        (player.currentTime / player.duration) > 0.7) {

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
    } catch (err) {
        alert("TTS Generation failed.");
    } finally {
        genBtn.disabled = false;
        genBtn.textContent = "Generate Audio";
    }
}

async function prepareNextChapter() {
    isGeneratingNext = true;

    const lastHref = localStorage.getItem("lastHref");
    const currentIndex = allChapters.findIndex(c => c.href === lastHref);
    const nextChapter = allChapters[currentIndex + 1];

    if (!nextChapter) {
        isGeneratingNext = false;
        return;
    }

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

    section.unload();
}

/* ---------------- UTIL ---------------- */

function flattenTOC(toc) {
    let res = [];

    toc.forEach(i => {
        res.push(i);
        if (i.subitems?.length > 0) {
            res = res.concat(flattenTOC(i.subitems));
        }
    });

    return res;
}

function copyTextToClipboard() {
    const text = displayText.innerText;

    if (!text || text.startsWith("Loading") || text.startsWith("Select")) return;

    navigator.clipboard.writeText(text).catch(() => {
        console.log("Failed to copy text.");
    });
}