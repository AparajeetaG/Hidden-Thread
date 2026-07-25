import { PUZZLES } from "./puzzles.js";

const GRID_COLUMNS = 6;
const GRID_ROWS = 8;
const GRID_SIZE = GRID_COLUMNS * GRID_ROWS;
const DAY_MS = 86_400_000;
const LAUNCH_UTC = Date.UTC(2026, 6, 24);
const STORAGE_PREFIX = "hidden-thread-v1";

const els = {
  grid: document.querySelector("#letter-grid"),
  threadLayer: document.querySelector("#thread-layer"),
  title: document.querySelector("#theme-title"),
  clue: document.querySelector("#theme-clue"),
  difficulty: document.querySelector("#difficulty-badge"),
  dayLabel: document.querySelector("#day-label"),
  progressCopy: document.querySelector("#progress-copy"),
  progressFill: document.querySelector("#progress-fill"),
  currentWord: document.querySelector("#current-word"),
  clearButton: document.querySelector("#clear-button"),
  checkButton: document.querySelector("#check-button"),
  hintButton: document.querySelector("#hint-button"),
  hintCount: document.querySelector("#hint-count"),
  foundList: document.querySelector("#found-list"),
  seasonLine: document.querySelector("#season-line"),
  seasonProgress: document.querySelector("#season-progress"),
  countdown: document.querySelector("#countdown"),
  toast: document.querySelector("#toast"),
  confetti: document.querySelector("#confetti"),
  contrastButton: document.querySelector("#contrast-button"),
  howButton: document.querySelector("#how-to-button"),
  statsButton: document.querySelector("#stats-button"),
  howModal: document.querySelector("#how-to-modal"),
  statsModal: document.querySelector("#stats-modal"),
  completionModal: document.querySelector("#completion-modal"),
  completionCopy: document.querySelector("#completion-copy"),
  resultSummary: document.querySelector("#result-summary"),
  shareButton: document.querySelector("#share-button"),
};

const dateInfo = getDateInfo();
const puzzle = pickPuzzle(dateInfo.dayNumber);
const puzzleKey = `${STORAGE_PREFIX}:progress:${dateInfo.dateKey}`;
const answers = makeAnswers(puzzle);
const layout = buildPuzzleLayout(puzzle, answers);
const savedProgress = readJson(puzzleKey, {});

const state = {
  selection: [],
  found: new Set(
    Array.isArray(savedProgress.found)
      ? savedProgress.found.filter((answerId) => answers.some((answer) => answer.id === answerId))
      : [],
  ),
  hintsLeft: Number.isInteger(savedProgress.hintsLeft)
    ? clamp(savedProgress.hintsLeft, 0, 3)
    : 3,
  completed: Boolean(savedProgress.completed),
  startedAt: savedProgress.startedAt || null,
  completedAt: savedProgress.completedAt || null,
  hintedCells: new Set(),
  pointer: {
    active: false,
    moved: false,
    startIndex: null,
  },
};

let toastTimer = null;
let hintTimer = null;

initialize();

function initialize() {
  document.querySelector("#copyright-year").textContent = String(new Date().getFullYear());
  els.title.textContent = puzzle.title;
  els.clue.textContent = puzzle.clue;
  els.difficulty.textContent = titleCase(puzzle.difficulty);
  els.difficulty.dataset.level = puzzle.difficulty;
  els.dayLabel.textContent = `Day ${dateInfo.seasonDay} of ${PUZZLES.length}`;
  els.seasonProgress.textContent = `${dateInfo.seasonDay} / ${PUZZLES.length}`;

  renderGrid();
  renderAll();
  renderSeason();
  bindEvents();
  setContrast(readJson(`${STORAGE_PREFIX}:settings`, {}).contrast === true);
  updateCountdown();
  window.setInterval(updateCountdown, 1_000);

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {
        // Offline support is helpful but never blocks the game.
      });
    });
  }

  if (!localStorage.getItem(`${STORAGE_PREFIX}:welcomed`)) {
    window.setTimeout(() => {
      openDialog(els.howModal);
      localStorage.setItem(`${STORAGE_PREFIX}:welcomed`, "true");
    }, 450);
  }
}

function makeAnswers(currentPuzzle) {
  const themed = currentPuzzle.words.map((word, index) => ({
    id: `theme-${index}-${normalize(word)}`,
    display: displayAnswer(word),
    normalized: normalize(word),
    type: "theme",
  }));

  themed.push({
    id: `master-${normalize(currentPuzzle.masterThread)}`,
    display: displayAnswer(currentPuzzle.masterThread),
    normalized: normalize(currentPuzzle.masterThread),
    type: "master",
  });

  return themed;
}

function buildPuzzleLayout(currentPuzzle, answerList) {
  const seed = hashString(`${currentPuzzle.id}:${currentPuzzle.title}`);
  const orderedAnswers = seededShuffle(answerList, seed ^ 0x9e3779b9);
  const path = generateHamiltonianPath(seed);
  const cells = Array(GRID_SIZE).fill("");
  const placements = new Map();
  let cursor = 0;

  orderedAnswers.forEach((answer) => {
    const answerPath = path.slice(cursor, cursor + answer.normalized.length);
    placements.set(answer.id, answerPath);
    answerPath.forEach((cellIndex, letterIndex) => {
      cells[cellIndex] = answer.normalized[letterIndex];
    });
    cursor += answer.normalized.length;
  });

  if (cursor !== GRID_SIZE || cells.some((letter) => !letter)) {
    throw new Error(`Puzzle ${currentPuzzle.id} does not fill its 6×8 grid.`);
  }

  return { cells, placements, path };
}

function generateHamiltonianPath(seed) {
  const neighbors = Array.from({ length: GRID_SIZE }, (_, index) => getNeighbors(index));

  for (let attempt = 0; attempt < 18; attempt += 1) {
    const random = mulberry32((seed + attempt * 0x6d2b79f5) >>> 0);
    const visited = new Uint8Array(GRID_SIZE);
    const path = [];
    let budget = 180_000;
    const start = Math.floor(random() * GRID_SIZE);

    function visit(cellIndex) {
      budget -= 1;
      if (budget <= 0) return false;

      visited[cellIndex] = 1;
      path.push(cellIndex);
      if (path.length === GRID_SIZE) return true;

      const candidates = neighbors[cellIndex]
        .filter((candidate) => !visited[candidate])
        .map((candidate) => {
          const onward = neighbors[candidate].reduce(
            (sum, next) => sum + (visited[next] ? 0 : 1),
            0,
          );
          const edgeBias = isEdgeCell(candidate) ? -0.12 : 0;
          return { candidate, score: onward + edgeBias + random() * 0.35 };
        })
        .sort((a, b) => a.score - b.score);

      for (const { candidate } of candidates) {
        if (visit(candidate)) return true;
      }

      path.pop();
      visited[cellIndex] = 0;
      return false;
    }

    if (visit(start)) return path;
  }

  return serpentinePath(seed);
}

function serpentinePath(seed) {
  const path = [];
  const vertical = seed % 2 === 0;

  if (vertical) {
    for (let column = 0; column < GRID_COLUMNS; column += 1) {
      const rows = Array.from({ length: GRID_ROWS }, (_, index) => index);
      if (column % 2) rows.reverse();
      rows.forEach((row) => path.push(row * GRID_COLUMNS + column));
    }
  } else {
    for (let row = 0; row < GRID_ROWS; row += 1) {
      const columns = Array.from({ length: GRID_COLUMNS }, (_, index) => index);
      if (row % 2) columns.reverse();
      columns.forEach((column) => path.push(row * GRID_COLUMNS + column));
    }
  }

  if (seed % 3 === 0) path.reverse();
  return path;
}

function renderGrid() {
  const fragment = document.createDocumentFragment();

  layout.cells.forEach((letter, index) => {
    const button = document.createElement("button");
    const row = Math.floor(index / GRID_COLUMNS);
    const column = index % GRID_COLUMNS;
    button.className = "grid-cell";
    button.type = "button";
    button.dataset.cellIndex = String(index);
    button.setAttribute("role", "gridcell");
    button.setAttribute("aria-label", `${letter}, row ${row + 1}, column ${column + 1}`);
    button.textContent = letter;
    fragment.appendChild(button);
  });

  els.grid.appendChild(fragment);
}

function renderAll() {
  renderCells();
  renderThreads();
  renderSelection();
  renderFoundWords();
  renderProgress();
  renderStats();
}

function renderCells() {
  els.grid.querySelectorAll(".grid-cell").forEach((cell, index) => {
    const foundAnswer = answers.find(
      (answer) =>
        state.found.has(answer.id) &&
        layout.placements.get(answer.id).includes(index),
    );

    cell.classList.toggle("is-selected", state.selection.includes(index));
    cell.classList.toggle("is-found", Boolean(foundAnswer));
    cell.classList.toggle("is-master", foundAnswer?.type === "master");
    cell.classList.toggle("is-hinted", state.hintedCells.has(index));

    if (foundAnswer) {
      cell.setAttribute(
        "aria-label",
        `${cell.textContent}, part of found ${foundAnswer.type === "master" ? "Master Thread" : "theme word"} ${foundAnswer.display}`,
      );
    }
  });
}

function renderThreads() {
  els.threadLayer.replaceChildren();

  answers.forEach((answer) => {
    if (!state.found.has(answer.id)) return;
    const path = layout.placements.get(answer.id);
    drawPath(path, answer.type === "master" ? "#d9a73d" : "#2c7a78", 10, 0.72);
  });

  if (state.selection.length > 1) {
    drawPath(state.selection, "#df6c58", 8, 0.9);
  }
}

function drawPath(path, color, width, opacity) {
  for (let index = 0; index < path.length - 1; index += 1) {
    const start = cellCenter(path[index]);
    const end = cellCenter(path[index + 1]);
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", String(start.x));
    line.setAttribute("y1", String(start.y));
    line.setAttribute("x2", String(end.x));
    line.setAttribute("y2", String(end.y));
    line.setAttribute("stroke", color);
    line.setAttribute("stroke-width", String(width));
    line.setAttribute("opacity", String(opacity));
    els.threadLayer.appendChild(line);
  }
}

function renderSelection() {
  const word = selectedWord();
  els.currentWord.textContent = state.completed
    ? "Completed for today ✓"
    : word || "Start tracing…";
  els.checkButton.textContent = state.completed ? "Share result" : "Check word";
  els.checkButton.disabled = !state.completed && state.selection.length < 4;
  els.clearButton.disabled = state.selection.length === 0;
}

function renderFoundWords() {
  const foundAnswers = answers.filter((answer) => state.found.has(answer.id));
  els.foundList.replaceChildren();

  if (!foundAnswers.length) {
    const empty = document.createElement("p");
    empty.className = "empty-copy";
    empty.textContent = "Your words will appear here as you find them.";
    els.foundList.appendChild(empty);
    return;
  }

  foundAnswers
    .sort((a, b) => (a.type === "master" ? 1 : b.type === "master" ? -1 : 0))
    .forEach((answer) => {
      const chip = document.createElement("span");
      chip.className = `word-chip${answer.type === "master" ? " master-chip" : ""}`;
      chip.textContent =
        answer.type === "master" ? `★ ${answer.display}` : answer.display;
      els.foundList.appendChild(chip);
    });
}

function renderProgress() {
  const total = answers.length;
  const found = state.found.size;
  els.progressCopy.textContent = `${found} of ${total} words`;
  els.progressFill.style.width = `${(found / total) * 100}%`;
  els.hintCount.textContent = String(state.hintsLeft);
  els.hintButton.disabled = state.hintsLeft <= 0 || state.completed;
}

function renderSeason() {
  els.seasonLine.replaceChildren();
  for (let day = 1; day <= PUZZLES.length; day += 1) {
    const dot = document.createElement("span");
    dot.className = "season-dot";
    if (day < dateInfo.seasonDay) dot.classList.add("is-past");
    if (day === dateInfo.seasonDay) dot.classList.add("is-today");
    dot.title =
      day < dateInfo.seasonDay
        ? `Day ${day} released`
        : day === dateInfo.seasonDay
          ? `Day ${day}: today`
          : `Day ${day}: locked`;
    els.seasonLine.appendChild(dot);
  }
}

function bindEvents() {
  els.grid.addEventListener("pointerdown", onPointerDown);
  els.grid.addEventListener("pointermove", onPointerMove);
  els.grid.addEventListener("pointerup", onPointerUp);
  els.grid.addEventListener("pointercancel", resetPointer);
  els.grid.addEventListener("keydown", onGridKeyDown);

  els.clearButton.addEventListener("click", clearSelection);
  els.checkButton.addEventListener("click", () => {
    if (state.completed) {
      shareResult();
    } else {
      submitSelection();
    }
  });
  els.hintButton.addEventListener("click", useHint);
  els.howButton.addEventListener("click", () => openDialog(els.howModal));
  els.statsButton.addEventListener("click", () => {
    renderStats();
    openDialog(els.statsModal);
  });
  els.contrastButton.addEventListener("click", () => {
    setContrast(document.documentElement.dataset.contrast !== "true");
  });
  els.shareButton.addEventListener("click", shareResult);

  document.querySelectorAll("[data-modal-target]").forEach((button) => {
    button.addEventListener("click", () => {
      openDialog(document.querySelector(`#${button.dataset.modalTarget}`));
    });
  });

  document.querySelectorAll(".game-dialog").forEach((dialog) => {
    dialog.querySelectorAll(".dialog-close, .dialog-close-action").forEach((button) => {
      button.addEventListener("click", () => dialog.close());
    });

    dialog.addEventListener("click", (event) => {
      const bounds = dialog.getBoundingClientRect();
      const inside =
        event.clientX >= bounds.left &&
        event.clientX <= bounds.right &&
        event.clientY >= bounds.top &&
        event.clientY <= bounds.bottom;
      if (!inside) dialog.close();
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !document.querySelector("dialog[open]")) {
      clearSelection();
    }
  });
}

function onPointerDown(event) {
  if (state.completed) return;
  const cell = event.target.closest("[data-cell-index]");
  if (!cell) return;

  event.preventDefault();
  state.pointer.active = true;
  state.pointer.moved = false;
  state.pointer.startIndex = Number(cell.dataset.cellIndex);
  els.grid.setPointerCapture?.(event.pointerId);
}

function onPointerMove(event) {
  if (!state.pointer.active) return;
  const cell = document.elementFromPoint(event.clientX, event.clientY)?.closest?.("[data-cell-index]");
  if (!cell || !els.grid.contains(cell)) return;

  const cellIndex = Number(cell.dataset.cellIndex);
  if (!state.pointer.moved && cellIndex !== state.pointer.startIndex) {
    state.pointer.moved = true;
    state.selection = [state.pointer.startIndex];
    markStarted();
  }

  if (state.pointer.moved) extendSelection(cellIndex);
}

function onPointerUp(event) {
  if (!state.pointer.active) return;
  const wasDragged = state.pointer.moved;
  const startIndex = state.pointer.startIndex;
  resetPointer();
  els.grid.releasePointerCapture?.(event.pointerId);

  if (wasDragged) {
    submitSelection();
  } else {
    handleTap(startIndex);
  }
}

function resetPointer() {
  state.pointer.active = false;
  state.pointer.moved = false;
  state.pointer.startIndex = null;
}

function handleTap(cellIndex) {
  if (state.completed || !Number.isInteger(cellIndex)) return;
  markStarted();

  if (!state.selection.length) {
    state.selection = [cellIndex];
  } else if (state.selection.at(-1) === cellIndex) {
    if (state.selection.length >= 4) submitSelection();
    return;
  } else {
    extendSelection(cellIndex);
  }

  renderCells();
  renderThreads();
  renderSelection();
}

function extendSelection(cellIndex) {
  const last = state.selection.at(-1);
  if (last === undefined) {
    state.selection = [cellIndex];
  } else if (state.selection.length > 1 && state.selection.at(-2) === cellIndex) {
    state.selection.pop();
  } else if (state.selection.includes(cellIndex)) {
    return;
  } else if (areAdjacent(last, cellIndex)) {
    state.selection.push(cellIndex);
  } else {
    state.selection = [cellIndex];
  }

  renderCells();
  renderThreads();
  renderSelection();
}

function submitSelection() {
  if (state.completed) return;
  const word = selectedWord();
  if (word.length < 4) {
    showToast("Keep tracing — answers have at least four letters.");
    return;
  }

  markStarted();
  const match = answers.find((answer) => answer.normalized === word);
  if (!match) {
    showToast("That word is not part of today’s weave.");
    shakeCurrentWord();
    window.setTimeout(clearSelection, 320);
    return;
  }

  if (state.found.has(match.id)) {
    showToast("You already found that thread.");
    clearSelection();
    return;
  }

  state.found.add(match.id);
  state.selection = [];
  saveProgress();
  showToast(
    match.type === "master"
      ? "Master Thread revealed!"
      : `${match.display} joins the weave.`,
  );
  renderAll();

  if (state.found.size === answers.length) completePuzzle();
}

function useHint() {
  if (state.hintsLeft <= 0 || state.completed) return;
  markStarted();

  const unsolved = answers.filter((answer) => !state.found.has(answer.id));
  const themed = unsolved.filter((answer) => answer.type === "theme");
  const target = (themed.length ? themed : unsolved)[0];
  if (!target) return;

  state.hintsLeft -= 1;
  state.hintedCells = new Set(layout.placements.get(target.id));
  saveProgress();
  renderAll();
  showToast(
    `${target.type === "master" ? "Master Thread" : "Theme word"}: ${target.normalized[0]}… · ${target.normalized.length} letters`,
    3_300,
  );

  window.clearTimeout(hintTimer);
  hintTimer = window.setTimeout(() => {
    state.hintedCells.clear();
    renderCells();
  }, 2_500);
}

function completePuzzle() {
  if (state.completed) return;
  state.completed = true;
  state.completedAt = Date.now();
  updateStatsForCompletion();
  saveProgress();
  renderAll();

  const master = answers.find((answer) => answer.type === "master");
  els.completionCopy.textContent = `The Master Thread was ${master.display}. Come back tomorrow for a new ${nextDifficulty()} weave.`;
  els.resultSummary.textContent = resultGrid();
  launchConfetti();
  window.setTimeout(() => openDialog(els.completionModal), 420);
}

function clearSelection() {
  state.selection = [];
  renderCells();
  renderThreads();
  renderSelection();
}

function selectedWord() {
  return state.selection.map((cellIndex) => layout.cells[cellIndex]).join("");
}

function saveProgress() {
  writeJson(puzzleKey, {
    puzzleId: puzzle.id,
    found: [...state.found],
    hintsLeft: state.hintsLeft,
    completed: state.completed,
    startedAt: state.startedAt,
    completedAt: state.completedAt,
  });
}

function markStarted() {
  if (state.startedAt) return;
  state.startedAt = Date.now();
  saveProgress();

  const stats = getStats();
  if (!stats.playedDates.includes(dateInfo.dateKey)) {
    stats.playedDates.push(dateInfo.dateKey);
    stats.played = stats.playedDates.length;
    saveStats(stats);
    renderStats();
  }
}

function updateStatsForCompletion() {
  const stats = getStats();
  if (stats.completedDates.includes(dateInfo.dateKey)) return;

  stats.completedDates.push(dateInfo.dateKey);
  stats.wins = stats.completedDates.length;
  stats.byDifficulty[puzzle.difficulty] =
    (stats.byDifficulty[puzzle.difficulty] || 0) + 1;

  const previousDate = localDateOffset(dateInfo.localDate, -1);
  if (stats.lastCompletedDate === previousDate) {
    stats.streak += 1;
  } else {
    stats.streak = 1;
  }

  stats.best = Math.max(stats.best, stats.streak);
  stats.lastCompletedDate = dateInfo.dateKey;
  saveStats(stats);
}

function getStats() {
  const saved = readJson(`${STORAGE_PREFIX}:stats`, {});
  return {
    played: Number(saved.played) || 0,
    wins: Number(saved.wins) || 0,
    streak: Number(saved.streak) || 0,
    best: Number(saved.best) || 0,
    playedDates: Array.isArray(saved.playedDates) ? saved.playedDates : [],
    completedDates: Array.isArray(saved.completedDates) ? saved.completedDates : [],
    lastCompletedDate: saved.lastCompletedDate || null,
    byDifficulty: {
      easy: Number(saved.byDifficulty?.easy) || 0,
      moderate: Number(saved.byDifficulty?.moderate) || 0,
      hard: Number(saved.byDifficulty?.hard) || 0,
    },
  };
}

function saveStats(stats) {
  writeJson(`${STORAGE_PREFIX}:stats`, stats);
}

function renderStats() {
  const stats = getStats();
  document.querySelector("#stat-played").textContent = String(stats.played);
  document.querySelector("#stat-wins").textContent = String(stats.wins);
  document.querySelector("#stat-streak").textContent = String(stats.streak);
  document.querySelector("#stat-best").textContent = String(stats.best);
  document.querySelector("#stat-easy").textContent = String(stats.byDifficulty.easy);
  document.querySelector("#stat-moderate").textContent = String(stats.byDifficulty.moderate);
  document.querySelector("#stat-hard").textContent = String(stats.byDifficulty.hard);
}

function resultGrid() {
  const levelIcon = {
    easy: "🟢",
    moderate: "🟠",
    hard: "🔴",
  }[puzzle.difficulty];
  const hintsUsed = 3 - state.hintsLeft;
  const elapsed = state.startedAt && state.completedAt
    ? Math.max(1, Math.round((state.completedAt - state.startedAt) / 60_000))
    : 1;

  return `${levelIcon} ${titleCase(puzzle.difficulty)} · 🧵 ${answers.length}/${answers.length}\n💡 ${hintsUsed} hint${hintsUsed === 1 ? "" : "s"} · ⏱ ${elapsed} min`;
}

async function shareResult() {
  const shareText = [
    `Hidden Thread — Day ${dateInfo.seasonDay}/${PUZZLES.length}`,
    resultGrid(),
    "I found today’s Master Thread. Can you?",
    window.location.href.split("#")[0],
  ].join("\n");

  try {
    if (navigator.share) {
      await navigator.share({
        title: "Hidden Thread",
        text: shareText,
      });
      return;
    }
    await navigator.clipboard.writeText(shareText);
    showToast("Spoiler-free result copied!");
  } catch (error) {
    if (error?.name !== "AbortError") showToast("Could not share just now.");
  }
}

function updateCountdown() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const remaining = Math.max(0, next.getTime() - now.getTime());
  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1_000);
  els.countdown.textContent = [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

function onGridKeyDown(event) {
  const current = event.target.closest("[data-cell-index]");
  if (!current) return;
  const index = Number(current.dataset.cellIndex);
  const row = Math.floor(index / GRID_COLUMNS);
  const column = index % GRID_COLUMNS;
  let nextIndex = null;

  if (event.key === "ArrowLeft" && column > 0) nextIndex = index - 1;
  if (event.key === "ArrowRight" && column < GRID_COLUMNS - 1) nextIndex = index + 1;
  if (event.key === "ArrowUp" && row > 0) nextIndex = index - GRID_COLUMNS;
  if (event.key === "ArrowDown" && row < GRID_ROWS - 1) nextIndex = index + GRID_COLUMNS;
  if (event.key === "Backspace") {
    event.preventDefault();
    state.selection.pop();
    renderAll();
    return;
  }

  if (nextIndex !== null) {
    event.preventDefault();
    els.grid.querySelector(`[data-cell-index="${nextIndex}"]`)?.focus();
  }
}

function setContrast(enabled) {
  document.documentElement.dataset.contrast = String(enabled);
  els.contrastButton.setAttribute("aria-pressed", String(enabled));
  els.contrastButton.setAttribute(
    "aria-label",
    `Turn high contrast mode ${enabled ? "off" : "on"}`,
  );
  writeJson(`${STORAGE_PREFIX}:settings`, { contrast: enabled });
}

function openDialog(dialog) {
  if (dialog && !dialog.open) dialog.showModal();
}

function showToast(message, duration = 2_200) {
  els.toast.textContent = message;
  els.toast.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    els.toast.classList.remove("is-visible");
  }, duration);
}

function shakeCurrentWord() {
  els.currentWord.animate(
    [
      { transform: "translateX(0)" },
      { transform: "translateX(-6px)" },
      { transform: "translateX(6px)" },
      { transform: "translateX(-4px)" },
      { transform: "translateX(0)" },
    ],
    { duration: 280, easing: "ease-out" },
  );
}

function launchConfetti() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  els.confetti.replaceChildren();
  const colors = ["#df6c58", "#2c7a78", "#d9a73d", "#7f9c67", "#e9a7a0"];

  for (let index = 0; index < 42; index += 1) {
    const piece = document.createElement("span");
    piece.className = "confetti-piece";
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = colors[index % colors.length];
    piece.style.animationDelay = `${Math.random() * 0.45}s`;
    piece.style.setProperty("--drift", `${Math.round(Math.random() * 160 - 80)}px`);
    els.confetti.appendChild(piece);
  }

  window.setTimeout(() => els.confetti.replaceChildren(), 2_800);
}

function pickPuzzle(dayNumber) {
  const levels = ["easy", "moderate", "hard"];
  const difficulty = levels[positiveMod(dayNumber, levels.length)];
  const group = PUZZLES.filter((item) => item.difficulty === difficulty);
  const round = Math.floor(positiveMod(dayNumber, PUZZLES.length) / levels.length);
  return group[round % group.length];
}

function getDateInfo() {
  const localDate = new Date();
  const localUtcDay = Date.UTC(
    localDate.getFullYear(),
    localDate.getMonth(),
    localDate.getDate(),
  );
  const dayNumber = Math.max(0, Math.floor((localUtcDay - LAUNCH_UTC) / DAY_MS));
  return {
    localDate,
    dayNumber,
    seasonDay: positiveMod(dayNumber, PUZZLES.length) + 1,
    dateKey: formatLocalDate(localDate),
  };
}

function nextDifficulty() {
  return titleCase(["easy", "moderate", "hard"][(dateInfo.dayNumber + 1) % 3]);
}

function getNeighbors(index) {
  const row = Math.floor(index / GRID_COLUMNS);
  const column = index % GRID_COLUMNS;
  const result = [];

  for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
    for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
      if (rowOffset === 0 && columnOffset === 0) continue;
      const nextRow = row + rowOffset;
      const nextColumn = column + columnOffset;
      if (
        nextRow >= 0 &&
        nextRow < GRID_ROWS &&
        nextColumn >= 0 &&
        nextColumn < GRID_COLUMNS
      ) {
        result.push(nextRow * GRID_COLUMNS + nextColumn);
      }
    }
  }

  return result;
}

function areAdjacent(first, second) {
  const firstRow = Math.floor(first / GRID_COLUMNS);
  const firstColumn = first % GRID_COLUMNS;
  const secondRow = Math.floor(second / GRID_COLUMNS);
  const secondColumn = second % GRID_COLUMNS;
  return (
    Math.abs(firstRow - secondRow) <= 1 &&
    Math.abs(firstColumn - secondColumn) <= 1 &&
    first !== second
  );
}

function isEdgeCell(index) {
  const row = Math.floor(index / GRID_COLUMNS);
  const column = index % GRID_COLUMNS;
  return (
    row === 0 ||
    row === GRID_ROWS - 1 ||
    column === 0 ||
    column === GRID_COLUMNS - 1
  );
}

function cellCenter(index) {
  return {
    x: (index % GRID_COLUMNS) * 100 + 50,
    y: Math.floor(index / GRID_COLUMNS) * 100 + 50,
  };
}

function seededShuffle(items, seed) {
  const shuffled = [...items];
  const random = mulberry32(seed >>> 0);
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return function random() {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalize(value) {
  return String(value).toUpperCase().replace(/[^A-Z]/g, "");
}

function displayAnswer(value) {
  return String(value)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toUpperCase();
}

function titleCase(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function positiveMod(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function formatLocalDate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function localDateOffset(date, offset) {
  return formatLocalDate(new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset));
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // The game remains playable if private browsing blocks storage.
  }
}
