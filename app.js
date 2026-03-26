import { initializeApp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";
import {
  addDoc,
  collection,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";

// 2048 with undo, board sizes, autosave, and a Firebase leaderboard.

// ---------- Firebase ----------
const LEADERBOARD_TABLE = "leaderboard";
const MOCHI_TILE_IMAGE = "2048-mochi.png";

const firebaseConfig = {
  apiKey: "AIzaSyDWXulkJ56vtCbJQt7ktct75Q4x00nC7YI",
  authDomain: "mochi-2048.firebaseapp.com",
  projectId: "mochi-2048",
  storageBucket: "mochi-2048.firebasestorage.app",
  messagingSenderId: "10887217516",
  appId: "1:10887217516:web:9e780ca16158d0eb343349",
  measurementId: "G-1YB5EH66WZ"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

// ---------- Storage ----------
const SAVE_KEY = "mochi_2048_save";
const BEST_KEY = "mochi_2048_best";
const PREF_KEY = "mochi_2048_prefs";
const NAME_KEY = "mochi_2048_name";

// ---------- UI ----------
const boardEl = document.getElementById("board");
const bgEl = document.getElementById("bg");
const tilesEl = document.getElementById("tiles");

const scoreEl = document.getElementById("score");
const bestEl = document.getElementById("best");

const newGameBtn = document.getElementById("newGameBtn");
const undoBtn = document.getElementById("undoBtn");
const sizeSelect = document.getElementById("sizeSelect");

const overlayEl = document.getElementById("overlay");
const overlayTitleEl = document.getElementById("overlayTitle");
const overlayTextEl = document.getElementById("overlayText");
const tryAgainBtn = document.getElementById("tryAgainBtn");
const keepPlayingBtn = document.getElementById("keepPlayingBtn");

const nameInput = document.getElementById("nameInput");
const submitScoreBtn = document.getElementById("submitScoreBtn");
const lbStatus = document.getElementById("lbStatus");
const leaderboardEl = document.getElementById("leaderboard");
const lbMeta = document.getElementById("lbMeta");

// ---------- State ----------
let SIZE = 4;
let history = [];
let nextTileId = 1;

let state = freshState(SIZE);
const tileEls = new Map();

function normalizeSize(value) {
  return [4, 5, 6].includes(value) ? value : 4;
}

function freshState(n) {
  nextTileId = 1;
  return {
    size: n,
    score: 0,
    won: false,
    over: false,
    keepPlaying: false,
    grid: makeEmptyGrid(n)
  };
}

function makeEmptyGrid(n) {
  return Array.from({ length: n }, () => Array(n).fill(null));
}

function deepCloneState(current) {
  const grid = makeEmptyGrid(current.size);

  for (let r = 0; r < current.size; r += 1) {
    for (let c = 0; c < current.size; c += 1) {
      const tile = current.grid[r][c];
      grid[r][c] = tile ? { ...tile } : null;
    }
  }

  return { ...current, grid };
}

function createHistorySnapshot() {
  return {
    state: deepCloneState(state),
    nextTileId
  };
}

function restoreHistorySnapshot(snapshot) {
  if (!snapshot?.state?.grid) return;

  const restoredSize = normalizeSize(Number(snapshot.state.size || SIZE));
  SIZE = restoredSize;
  state = deepCloneState({
    ...snapshot.state,
    size: restoredSize
  });
  nextTileId = Number(snapshot.nextTileId || 1);
}

function sanitizeHistory(rawHistory) {
  if (!Array.isArray(rawHistory)) return [];

  return rawHistory
    .filter((entry) => entry?.state?.grid)
    .map((entry) => ({
      state: deepCloneState({
        ...entry.state,
        size: normalizeSize(Number(entry.state.size || SIZE))
      }),
      nextTileId: Number(entry.nextTileId || 1)
    }));
}

function shouldShowMochiImage(tile) {
  return tile.v === 2048;
}

function randInt(max) {
  return Math.floor(Math.random() * max);
}

function getBest() {
  return Number(localStorage.getItem(BEST_KEY) || 0);
}

function setBest(value) {
  localStorage.setItem(BEST_KEY, String(value));
}

function savePrefs() {
  localStorage.setItem(PREF_KEY, JSON.stringify({ size: SIZE }));
}

function loadPrefs() {
  const raw = localStorage.getItem(PREF_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveName() {
  const value = (nameInput.value || "").trim();
  if (value) {
    localStorage.setItem(NAME_KEY, value);
  }
}

function loadName() {
  return localStorage.getItem(NAME_KEY) || "";
}

function saveGame() {
  localStorage.setItem(
    SAVE_KEY,
    JSON.stringify({
      SIZE,
      nextTileId,
      state,
      history
    })
  );
}

function getLeaderboardCollectionName() {
  return `${LEADERBOARD_TABLE}_${SIZE}x${SIZE}`;
}

function getLeaderboardCollection() {
  return collection(db, getLeaderboardCollectionName());
}

function loadGame() {
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) return false;

  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.state?.grid || !parsed?.SIZE) return false;

    SIZE = normalizeSize(Number(parsed.SIZE));
    nextTileId = Number(parsed.nextTileId || 1);
    state = deepCloneState({
      ...parsed.state,
      size: SIZE
    });
    history = sanitizeHistory(parsed.history);
    return true;
  } catch {
    return false;
  }
}

function setBoardVars() {
  boardEl.style.setProperty("--n", String(SIZE));

  const boardSize = boardEl.clientWidth;
  const pad = 12;
  const gap = 12;
  const inner = boardSize - pad * 2;
  const cell = (inner - gap * (SIZE - 1)) / SIZE;

  boardEl.style.setProperty("--cell", `${cell}px`);
  boardEl.style.setProperty("--gap", `${gap}px`);
  boardEl.style.setProperty("--pad", `${pad}px`);
}

function tx(col) {
  const cell = parseFloat(getComputedStyle(boardEl).getPropertyValue("--cell"));
  const gap = parseFloat(getComputedStyle(boardEl).getPropertyValue("--gap"));
  return (cell + gap) * col;
}

function ty(row) {
  const cell = parseFloat(getComputedStyle(boardEl).getPropertyValue("--cell"));
  const gap = parseFloat(getComputedStyle(boardEl).getPropertyValue("--gap"));
  return (cell + gap) * row;
}

function renderBackground() {
  bgEl.innerHTML = "";
  bgEl.style.setProperty("grid-template-columns", `repeat(${SIZE}, 1fr)`);

  for (let i = 0; i < SIZE * SIZE; i += 1) {
    const cell = document.createElement("div");
    cell.className = "bgCell";
    bgEl.appendChild(cell);
  }
}

function tileClass(value) {
  return `tile t${value}`;
}

function formatTileLabel(value) {
  if (value === 2048) return "MOCHI";
  return String(value);
}

function updateTileEl(tile, { isNew = false, isMerged = false } = {}) {
  let element = tileEls.get(tile.id);

  if (!element) {
    element = document.createElement("div");
    element.className = "tile";
    element.dataset.id = String(tile.id);
    tilesEl.appendChild(element);
    tileEls.set(tile.id, element);
  }

  element.className = tileClass(tile.v);
  if (tile.v >= 1024) {
    element.classList.add("small");
  }
  element.replaceChildren();

  if (shouldShowMochiImage(tile)) {
    element.classList.add("has-image");

    const image = document.createElement("img");
    image.className = "tile-image";
    image.src = MOCHI_TILE_IMAGE;
    image.alt = "Mochi 2048 tile";
    image.draggable = false;
    image.addEventListener("error", () => {
      element.classList.remove("has-image");
      element.textContent = "2048";
    }, { once: true });
    element.appendChild(image);
  } else {
    element.textContent = formatTileLabel(tile.v);
  }

  const x = tx(tile.c);
  const y = ty(tile.r);
  element.style.setProperty("--tx", `${x}px`);
  element.style.setProperty("--ty", `${y}px`);
  element.style.transform = `translate(${x}px, ${y}px)`;

  element.classList.remove("new", "merged");
  void element.offsetWidth;
  if (isNew) element.classList.add("new");
  if (isMerged) element.classList.add("merged");
}

function removeMissingTiles(liveIds) {
  for (const [id, element] of tileEls.entries()) {
    if (!liveIds.has(id)) {
      element.remove();
      tileEls.delete(id);
    }
  }
}

function renderHUD() {
  scoreEl.textContent = String(state.score);
  bestEl.textContent = String(getBest());
  undoBtn.disabled = history.length === 0;

  if (state.over) {
    overlayEl.hidden = false;
    overlayTitleEl.textContent = "Board Full";
    overlayTextEl.textContent = "There are no moves left.";
    keepPlayingBtn.hidden = true;
  } else if (state.won && !state.keepPlaying) {
    overlayEl.hidden = false;
    overlayTitleEl.textContent = "Sweet Victory";
    overlayTextEl.textContent = "You made the MOCHI tile.";
    keepPlayingBtn.hidden = false;
  } else {
    overlayEl.hidden = true;
  }
}

function renderAll({ newTileIds = new Set(), mergedTileIds = new Set() } = {}) {
  setBoardVars();

  const liveIds = new Set();
  for (let r = 0; r < SIZE; r += 1) {
    for (let c = 0; c < SIZE; c += 1) {
      const tile = state.grid[r][c];
      if (!tile) continue;

      liveIds.add(tile.id);
      updateTileEl(tile, {
        isNew: newTileIds.has(tile.id),
        isMerged: mergedTileIds.has(tile.id)
      });
    }
  }

  removeMissingTiles(liveIds);
  renderHUD();
}

function emptyCells() {
  const cells = [];

  for (let r = 0; r < SIZE; r += 1) {
    for (let c = 0; c < SIZE; c += 1) {
      if (!state.grid[r][c]) cells.push([r, c]);
    }
  }

  return cells;
}

function addRandomTile() {
  const empties = emptyCells();
  if (empties.length === 0) return null;

  const [row, col] = empties[randInt(empties.length)];
  const value = Math.random() < 0.9 ? 2 : 4;
  const tile = { id: nextTileId++, v: value, r: row, c: col };
  state.grid[row][col] = tile;
  return tile.id;
}

function hasValue(target) {
  for (let r = 0; r < SIZE; r += 1) {
    for (let c = 0; c < SIZE; c += 1) {
      const tile = state.grid[r][c];
      if (tile && tile.v === target) return true;
    }
  }

  return false;
}

function hasMoves() {
  if (emptyCells().length > 0) return true;

  for (let r = 0; r < SIZE; r += 1) {
    for (let c = 0; c < SIZE; c += 1) {
      const tile = state.grid[r][c];
      if (!tile) continue;

      if (r < SIZE - 1 && state.grid[r + 1][c]?.v === tile.v) return true;
      if (c < SIZE - 1 && state.grid[r][c + 1]?.v === tile.v) return true;
    }
  }

  return false;
}

function undo() {
  if (history.length === 0) return;
  const previousSnapshot = history.pop();
  restoreHistorySnapshot(previousSnapshot);
  sizeSelect.value = String(SIZE);
  renderBackground();
  saveGame();
  renderAll();
  refreshLeaderboard();
}

function getLineTiles(row, col, direction) {
  const line = [];

  for (let i = 0; i < SIZE; i += 1) {
    let r = row;
    let c = col;

    if (direction === "left") c = i;
    if (direction === "right") c = SIZE - 1 - i;
    if (direction === "up") r = i;
    if (direction === "down") r = SIZE - 1 - i;

    line.push(state.grid[r][c]);
  }

  return line;
}

function setLineTiles(row, col, direction, tiles) {
  for (let i = 0; i < SIZE; i += 1) {
    let r = row;
    let c = col;

    if (direction === "left") c = i;
    if (direction === "right") c = SIZE - 1 - i;
    if (direction === "up") r = i;
    if (direction === "down") r = SIZE - 1 - i;

    const tile = tiles[i] || null;
    state.grid[r][c] = tile;
    if (tile) {
      tile.r = r;
      tile.c = c;
    }
  }
}

function gridSignature(grid) {
  return JSON.stringify(grid.map((row) => row.map((tile) => tile?.v || 0)));
}

function move(direction) {
  if (state.over) return;
  if (state.won && !state.keepPlaying) return;

  const before = createHistorySnapshot();
  const beforeSignature = gridSignature(before.state.grid);
  let gained = 0;
  const mergedTileIds = new Set();

  for (let index = 0; index < SIZE; index += 1) {
    const startRow = direction === "left" || direction === "right" ? index : 0;
    const startCol = direction === "up" || direction === "down" ? index : 0;

    const line = getLineTiles(startRow, startCol, direction);
    const nonNull = line.filter(Boolean);

    const output = [];
    for (let i = 0; i < nonNull.length; i += 1) {
      const current = nonNull[i];
      const next = nonNull[i + 1];

      if (next && current.v === next.v) {
        const merged = { id: nextTileId++, v: current.v * 2, r: 0, c: 0 };
        output.push(merged);
        mergedTileIds.add(merged.id);
        gained += merged.v;
        i += 1;
      } else {
        output.push({ ...current });
      }
    }

    while (output.length < SIZE) output.push(null);
    setLineTiles(startRow, startCol, direction, output);
  }

  if (beforeSignature === gridSignature(state.grid)) {
    restoreHistorySnapshot(before);
    return;
  }

  history.push(before);
  if (history.length > 30) history.shift();

  state.score += gained;
  if (state.score > getBest()) {
    setBest(state.score);
  }

  const newTileIds = new Set();
  const newTileId = addRandomTile();
  if (newTileId) newTileIds.add(newTileId);

  if (!state.won && hasValue(2048)) {
    state.won = true;
  }

  state.over = !hasMoves();

  saveGame();
  renderAll({ newTileIds, mergedTileIds });

  if (state.over || (state.won && !state.keepPlaying)) {
    refreshLeaderboard();
  }
}

function newGame() {
  history = [];
  state = freshState(SIZE);
  renderBackground();

  const newTileIds = new Set([addRandomTile(), addRandomTile()].filter(Boolean));
  saveGame();
  renderAll({ newTileIds });
  refreshLeaderboard();
}

async function refreshLeaderboard() {
  leaderboardEl.innerHTML = "";
  lbStatus.textContent = "";
  lbMeta.textContent = `Top 10 | ${SIZE}x${SIZE}`;

  try {
    const leaderboardQuery = query(
      getLeaderboardCollection(),
      orderBy("score", "desc"),
      limit(10)
    );

    const snapshot = await getDocs(leaderboardQuery);

    if (snapshot.empty) {
      leaderboardEl.innerHTML = "<li class=\"muted\">No scores yet.</li>";
      return;
    }

    snapshot.forEach((docSnapshot) => {
      const row = docSnapshot.data();
      const item = document.createElement("li");
      item.innerHTML = `<span>${escapeHtml(row.name)}</span><span><strong>${row.score}</strong></span>`;
      leaderboardEl.appendChild(item);
    });
  } catch {
    lbStatus.textContent = "Leaderboard unavailable. Check Firestore setup and rules.";
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>\"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  }[char]));
}

async function submitScore() {
  const name = (nameInput.value || "").trim();
  if (!name) {
    lbStatus.textContent = "Enter a name first.";
    return;
  }

  saveName();
  submitScoreBtn.disabled = true;
  lbStatus.textContent = "Submitting...";

  try {
    await addDoc(getLeaderboardCollection(), {
      name,
      score: state.score,
      size: SIZE,
      createdAt: serverTimestamp()
    });

    lbStatus.textContent = "Submitted.";
    await refreshLeaderboard();
  } catch {
    lbStatus.textContent = "Submit failed. Check Firestore rules.";
  } finally {
    submitScoreBtn.disabled = false;
  }
}

document.addEventListener("keydown", (event) => {
  const activeElement = document.activeElement;
  const tagName = activeElement?.tagName?.toLowerCase() || "";
  const isTyping =
    activeElement?.isContentEditable ||
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select";

  if (isTyping) return;
  if (!overlayEl.hidden) return;

  const key = event.key.toLowerCase();
  const map = {
    arrowleft: "left",
    a: "left",
    arrowright: "right",
    d: "right",
    arrowup: "up",
    w: "up",
    arrowdown: "down",
    s: "down"
  };

  const direction = map[key];
  if (!direction) return;

  event.preventDefault();
  move(direction);
});

let touchStartX = 0;
let touchStartY = 0;

boardEl.addEventListener("touchstart", (event) => {
  if (event.touches.length !== 1) return;

  const touch = event.touches[0];
  touchStartX = touch.clientX;
  touchStartY = touch.clientY;
}, { passive: false });

boardEl.addEventListener("touchmove", (event) => {
  event.preventDefault();
}, { passive: false });

boardEl.addEventListener("touchend", (event) => {
  const touch = event.changedTouches[0];
  const dx = touch.clientX - touchStartX;
  const dy = touch.clientY - touchStartY;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);

  if (Math.max(absX, absY) < 24) return;

  if (absX > absY) {
    move(dx > 0 ? "right" : "left");
  } else {
    move(dy > 0 ? "down" : "up");
  }
}, { passive: false });

newGameBtn.addEventListener("click", newGame);
undoBtn.addEventListener("click", undo);

tryAgainBtn.addEventListener("click", () => {
  localStorage.removeItem(SAVE_KEY);
  newGame();
});

keepPlayingBtn.addEventListener("click", () => {
  state.keepPlaying = true;
  saveGame();
  renderAll();
});

submitScoreBtn.addEventListener("click", submitScore);
nameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    submitScore();
  }
});
nameInput.addEventListener("blur", saveName);

sizeSelect.addEventListener("change", () => {
  SIZE = normalizeSize(Number(sizeSelect.value));
  savePrefs();
  newGame();
});

window.addEventListener("resize", () => {
  setBoardVars();
  renderAll();
});

(function init() {
  const prefs = loadPrefs();
  if (prefs?.size) {
    SIZE = normalizeSize(Number(prefs.size));
  }

  nameInput.value = loadName();

  const loaded = loadGame();
  sizeSelect.value = String(SIZE);
  renderBackground();

  if (!loaded) {
    newGame();
  } else {
    setBoardVars();
    renderAll();
    refreshLeaderboard();
  }
})();
