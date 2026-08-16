import {
  ARMORS,
  HUNGER_MAX,
  MAP_H,
  MAP_W,
  MAX_DEPTH,
  MONSTERS,
  STAIRS,
  WALL,
  WEAPONS,
  createGame,
  descend,
  eat,
  expToLevel,
  onStairs,
  quaff,
  step,
  tileAt,
  wait,
} from "./game.js";
import { GameAudio } from "./audio.js";
import { loadProgress, saveProgress } from "./persist.js";

const SHEETS = {
  dungeon: { src: "./assets/images/dungeon.png", cols: 12, size: 16, gap: 1, image: null },
  creatures: { src: "./assets/images/creatures.png", cols: 10, size: 16, gap: 1, image: null },
};

const PLAYER_TILE = 96;
const VIEW_W = 15;
const VIEW_H = 11;
const MOVE_MS = 95;
const FLOAT_MS = 720;

const $ = (q) => document.querySelector(q);
const canvas = $("#board");
const ctx = canvas.getContext("2d");
const audio = new GameAudio();

let state = null;
let progress = { bestDepth: 1, bestScore: 0, wins: 0, runs: 0, run: null };
let tile = 22;
let camera = { x: 0, y: 0 };
let motions = new Map();
let floats = [];
let hurtFlash = 0;
let saveTimer = 0;
let padTimers = { delay: 0, repeat: 0 };

// ---------------------------------------------------------------- 圖塊

async function loadSheets() {
  await Promise.all(
    Object.values(SHEETS).map(
      (sheet) =>
        new Promise((resolve) => {
          const image = new Image();
          image.onload = () => {
            sheet.image = image;
            resolve();
          };
          image.onerror = () => resolve();
          image.src = sheet.src;
        }),
    ),
  );
}

function drawTile(sheetName, index, dx, dy, size = tile) {
  const sheet = SHEETS[sheetName];
  if (!sheet.image || index == null) return;
  const sx = (index % sheet.cols) * (sheet.size + sheet.gap);
  const sy = Math.floor(index / sheet.cols) * (sheet.size + sheet.gap);
  ctx.drawImage(sheet.image, sx, sy, sheet.size, sheet.size, Math.round(dx), Math.round(dy), size, size);
}

/** 地形樣式的確定性雜湊：同一 seed／深度／座標永遠長一樣，不必存進 state。 */
function variantAt(x, y) {
  let h = (state.seed * 374761393 + state.depth * 668265263 + x * 2246822519 + y * 3266489917) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

function terrainTile(x, y) {
  const kind = tileAt(state, x, y);
  const v = variantAt(x, y);
  if (kind === STAIRS) return 37;
  if (kind === WALL) {
    if (tileAt(state, x, y + 1) !== WALL && v % 9 === 0) return 29;
    return 40;
  }
  if (v % 7 === 0) return 49;
  if (v % 11 === 0) return 51;
  return 48;
}

function itemTile(item) {
  if (item.kind === "ration") return 66;
  if (item.kind === "potion") return 115;
  if (item.kind === "weapon") return WEAPONS[item.key].tile;
  return ARMORS[item.key].tile;
}

// ---------------------------------------------------------------- 版面

function layout() {
  const wrap = canvas.parentElement;
  const available = wrap.clientWidth || 320;
  tile = Math.max(16, Math.min(40, Math.floor(available / VIEW_W)));
  canvas.width = tile * VIEW_W;
  canvas.height = tile * VIEW_H;
  canvas.style.width = `${canvas.width}px`;
  canvas.style.height = `${canvas.height}px`;
  ctx.imageSmoothingEnabled = false;
}

function updateCamera() {
  camera.x = Math.max(0, Math.min(MAP_W - VIEW_W, state.player.x - (VIEW_W >> 1)));
  camera.y = Math.max(0, Math.min(MAP_H - VIEW_H, state.player.y - (VIEW_H >> 1)));
}

// ---------------------------------------------------------------- 動畫

function easeOut(t) {
  return 1 - (1 - t) * (1 - t);
}

function motionOf(key, x, y, now) {
  const m = motions.get(key);
  if (!m) return { x, y };
  const t = (now - m.t0) / MOVE_MS;
  if (t >= 1) {
    motions.delete(key);
    return { x, y };
  }
  const k = easeOut(t);
  return { x: m.x + (x - m.x) * k, y: m.y + (y - m.y) * k };
}

function rememberPositions(prev) {
  const now = performance.now();
  const seen = new Map([["player", { x: prev.player.x, y: prev.player.y }]]);
  for (const m of prev.monsters) seen.set(m.id, { x: m.x, y: m.y });
  const next = new Map([["player", { x: state.player.x, y: state.player.y }]]);
  for (const m of state.monsters) next.set(m.id, { x: m.x, y: m.y });
  for (const [key, from] of seen) {
    const to = next.get(key);
    if (!to || (to.x === from.x && to.y === from.y)) continue;
    motions.set(key, { x: from.x, y: from.y, t0: now });
  }
}

function addFloat(x, y, text, color) {
  floats.push({ x, y, text, color, t0: performance.now() });
}

// ---------------------------------------------------------------- 繪製

function render() {
  requestAnimationFrame(render);
  if (!state || $("#game").hidden) return;
  const now = performance.now();
  const flicker = 0.03 * Math.sin(now / 260) + 0.02 * Math.sin(now / 91);
  updateCamera();

  ctx.fillStyle = "#05060a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let vy = 0; vy < VIEW_H; vy += 1) {
    for (let vx = 0; vx < VIEW_W; vx += 1) {
      const x = camera.x + vx;
      const y = camera.y + vy;
      if (x >= MAP_W || y >= MAP_H) continue;
      const visible = state.visible[y][x];
      const explored = state.explored[y][x];
      if (!explored) continue;
      const dx = vx * tile;
      const dy = vy * tile;
      drawTile("dungeon", terrainTile(x, y), dx, dy);

      if (tileAt(state, x, y) === STAIRS) {
        const pulse = 0.35 + 0.25 * Math.sin(now / 320);
        ctx.strokeStyle = `rgba(255, 190, 90, ${pulse.toFixed(3)})`;
        ctx.lineWidth = 2;
        ctx.strokeRect(dx + 2, dy + 2, tile - 4, tile - 4);
      }

      const item = state.items.find((i) => i.x === x && i.y === y);
      if (item) drawTile("dungeon", itemTile(item), dx, dy);

      if (!visible) {
        ctx.fillStyle = "rgba(6, 7, 16, 0.68)";
        ctx.fillRect(dx, dy, tile, tile);
      } else {
        const dist = Math.hypot(x - state.player.x, y - state.player.y) / state.light;
        const shade = Math.max(0, Math.min(0.6, dist * dist * 0.62 - 0.04 + flicker));
        if (shade > 0.01) {
          ctx.fillStyle = `rgba(6, 7, 16, ${shade.toFixed(3)})`;
          ctx.fillRect(dx, dy, tile, tile);
        }
      }
    }
  }

  for (const m of state.monsters) {
    if (!state.visible[m.y][m.x]) continue;
    const pos = motionOf(m.id, m.x, m.y, now);
    const dx = (pos.x - camera.x) * tile;
    const dy = (pos.y - camera.y) * tile;
    if (dx < -tile || dy < -tile || dx > canvas.width || dy > canvas.height) continue;
    const def = MONSTERS[m.kind];
    if (def.boss) {
      ctx.fillStyle = "rgba(226, 86, 77, 0.18)";
      ctx.beginPath();
      ctx.arc(dx + tile / 2, dy + tile / 2, tile * 0.62, 0, Math.PI * 2);
      ctx.fill();
    }
    drawTile(def.sheet, def.tile, dx, dy);
    if (m.hp < m.maxHp) {
      const w = Math.max(2, Math.round((tile - 4) * (m.hp / m.maxHp)));
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(dx + 2, dy + tile - 4, tile - 4, 3);
      ctx.fillStyle = "#e2564d";
      ctx.fillRect(dx + 2, dy + tile - 4, w, 3);
    }
  }

  const ppos = motionOf("player", state.player.x, state.player.y, now);
  const px = (ppos.x - camera.x) * tile;
  const py = (ppos.y - camera.y) * tile;
  const glow = ctx.createRadialGradient(px + tile / 2, py + tile / 2, 0, px + tile / 2, py + tile / 2, tile * 0.85);
  glow.addColorStop(0, "rgba(255, 190, 110, 0.22)");
  glow.addColorStop(1, "rgba(255, 190, 110, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(px - tile, py - tile, tile * 3, tile * 3);
  drawTile("dungeon", PLAYER_TILE, px, py);

  floats = floats.filter((f) => now - f.t0 < FLOAT_MS);
  ctx.textAlign = "center";
  ctx.font = `bold ${Math.max(11, Math.round(tile * 0.52))}px system-ui, sans-serif`;
  for (const f of floats) {
    const t = (now - f.t0) / FLOAT_MS;
    const fx = (f.x - camera.x) * tile + tile / 2;
    const fy = (f.y - camera.y) * tile + tile * 0.5 - t * tile * 0.9;
    ctx.globalAlpha = 1 - t;
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(4, 4, 10, 0.85)";
    ctx.strokeText(f.text, fx, fy);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, fx, fy);
    ctx.globalAlpha = 1;
  }

  if (hurtFlash > 0) {
    hurtFlash = Math.max(0, hurtFlash - 0.045);
    ctx.fillStyle = `rgba(190, 40, 40, ${(hurtFlash * 0.4).toFixed(3)})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

// ---------------------------------------------------------------- HUD

function renderHud() {
  const p = state.player;
  const depthBadge = $("#depth-badge");
  depthBadge.textContent = state.depth >= MAX_DEPTH ? "王座大廳" : `第 ${state.depth} 層`;
  depthBadge.classList.toggle("throne", state.depth >= MAX_DEPTH);
  $("#level-badge").textContent = `Lv ${p.lvl}`;
  $("#score-badge").textContent = `${state.score} 分`;

  const hpRatio = p.hp / p.maxHp;
  const hpFill = $("#hp-fill");
  hpFill.style.width = `${Math.max(0, hpRatio * 100)}%`;
  hpFill.classList.toggle("low", hpRatio <= 0.34);
  $("#hp-num").textContent = `${p.hp}/${p.maxHp}`;

  const hungerFill = $("#hunger-fill");
  hungerFill.style.width = `${Math.max(0, (p.hunger / HUNGER_MAX) * 100)}%`;
  hungerFill.classList.toggle("low", p.hunger <= 60);
  $("#hunger-num").textContent = `${p.hunger}`;

  $("#weapon-chip").textContent = `${WEAPONS[p.weapon].name} +${WEAPONS[p.weapon].atk}`;
  $("#armor-chip").textContent = `${ARMORS[p.armor].name} +${ARMORS[p.armor].def}`;
  $("#exp-chip").textContent = `經驗 ${p.exp}/${expToLevel(p.lvl)}`;
  $("#potion-count").textContent = p.potions;
  $("#ration-count").textContent = p.rations;
  $("#act-quaff").disabled = p.potions <= 0 || state.outcome !== "playing";
  $("#act-eat").disabled = p.rations <= 0 || state.outcome !== "playing";
  $("#act-descend").disabled = !onStairs(state) || state.outcome !== "playing";
  $("#msg").textContent = state.message || (onStairs(state) ? "向下的階梯就在腳邊。" : "");

  const log = $("#log");
  log.replaceChildren(
    ...state.log.slice(0, 24).map((line) => {
      const li = document.createElement("li");
      li.textContent = line;
      return li;
    }),
  );
}

// ---------------------------------------------------------------- 事件反應

function reactTo(prev) {
  let shake = false;
  for (const event of state.events ?? []) {
    if (event.type === "step") audio.play("step", { volume: 0.3, rate: 0.94 + Math.random() * 0.14 });
    if (event.type === "bump") audio.play("click", { volume: 0.22, rate: 0.8 });
    if (event.type === "hit") {
      const toPlayer = event.target === "player";
      audio.play(toPlayer ? "hurt" : "hit", { volume: toPlayer ? 0.5 : 0.4 });
      addFloat(event.x, event.y, `${event.amount}`, toPlayer ? "#ff8f8f" : "#ffe9a8");
      if (toPlayer) {
        hurtFlash = 1;
        shake = true;
      }
    }
    if (event.type === "kill") {
      audio.play("kill", { volume: event.boss ? 0.7 : 0.45, rate: event.boss ? 0.75 : 1 });
      addFloat(event.x, event.y, "✕", "#ffd0a0");
    }
    if (event.type === "pickup") audio.play("pickup", { volume: 0.4 });
    if (event.type === "equip") audio.play("equip", { volume: 0.5 });
    if (event.type === "quaff") {
      audio.play("quaff", { volume: 0.55 });
      if (event.amount > 0) addFloat(state.player.x, state.player.y, `+${event.amount}`, "#8ff0a8");
    }
    if (event.type === "eat") audio.play("eat", { volume: 0.5 });
    if (event.type === "level") {
      audio.play("level", { volume: 0.4 });
      addFloat(state.player.x, state.player.y, "升級", "#ffd35c");
    }
    if (event.type === "descend") {
      audio.play("stairs", { volume: 0.5 });
      void audio.playMusic(event.depth >= MAX_DEPTH ? "throne" : "delve");
    }
  }
  if (shake && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    canvas.classList.remove("shake");
    void canvas.offsetWidth;
    canvas.classList.add("shake");
  }
  if (prev.outcome === "playing" && state.outcome !== "playing") finishRun();
}

function commit(next) {
  if (next === state) {
    audio.play("click", { volume: 0.18, rate: 0.8 });
    return;
  }
  const prev = state;
  state = next;
  rememberPositions(prev);
  reactTo(prev);
  renderHud();
  scheduleSave();
}

// ---------------------------------------------------------------- 存檔

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    progress.run = state && state.outcome === "playing" ? state : null;
    progress.bestDepth = Math.max(progress.bestDepth ?? 1, state?.depth ?? 1);
    void saveProgress(progress);
  }, 700);
}

function finishRun() {
  const won = state.outcome === "won";
  audio.play(won ? "win" : "lose", { volume: 0.6 });
  progress.runs = (progress.runs ?? 0) + 1;
  progress.wins = (progress.wins ?? 0) + (won ? 1 : 0);
  progress.bestDepth = Math.max(progress.bestDepth ?? 1, state.depth);
  progress.bestScore = Math.max(progress.bestScore ?? 0, state.score);
  progress.run = null;
  clearTimeout(saveTimer);
  void saveProgress(progress);
  renderRecord();
  showOutcome();
}

function renderRecord() {
  $("#best-depth").textContent = progress.bestDepth ?? 1;
  $("#best-score").textContent = progress.bestScore ?? 0;
  $("#best-wins").textContent = progress.wins ?? 0;
}

// ---------------------------------------------------------------- 覆蓋層

function showOutcome() {
  const won = state.outcome === "won";
  $("#overlay-title").textContent = won ? "骸骨王已伏誅" : state.cause === "starve" ? "你餓死在深窟裡" : "你倒在深窟裡";
  $("#overlay-body").textContent = won
    ? "你踩著碎骨走出王座大廳，第一次有人從第六層活著回來。"
    : state.cause === "starve"
      ? "火把還亮著，但你連舉起它的力氣都沒了。"
      : `第 ${state.depth} 層的黑暗吞掉了你。深窟不記得任何人。`;
  $("#overlay-stats").innerHTML = [
    ["抵達深度", `${state.depth} 層`],
    ["總分", state.score],
    ["擊殺", `${state.kills} 隻`],
    ["回合", state.turn],
    ["等級", `Lv ${state.player.lvl}`],
    ["裝備", WEAPONS[state.player.weapon].name],
  ]
    .map(([label, value]) => `<li>${label}<b>${value}</b></li>`)
    .join("");
  $("#overlay").hidden = false;
  $("#overlay-again").focus();
}

function askQuit() {
  $("#confirm-overlay").hidden = false;
  $("#cancel-quit").focus();
}

function overlayOpen() {
  return !$("#overlay").hidden || !$("#confirm-overlay").hidden;
}

// ---------------------------------------------------------------- 操作

function act(kind, dx = 0, dy = 0) {
  if (!state || state.outcome !== "playing" || overlayOpen()) return;
  if (kind === "move") commit(dx === 0 && dy === 0 ? wait(state) : step(state, dx, dy));
  if (kind === "descend") commit(descend(state));
  if (kind === "quaff") commit(quaff(state));
  if (kind === "eat") commit(eat(state));
}

const KEYS = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  w: [0, -1],
  s: [0, 1],
  a: [-1, 0],
  d: [1, 0],
  k: [0, -1],
  j: [0, 1],
  h: [-1, 0],
  l: [1, 0],
};

function onKey(event) {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (!$("#confirm-overlay").hidden && event.key === "Escape") {
    $("#confirm-overlay").hidden = true;
    return;
  }
  if ($("#game").hidden || overlayOpen()) return;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const dir = KEYS[key];
  if (dir) {
    event.preventDefault();
    act("move", dir[0], dir[1]);
    return;
  }
  if (key === " " || key === "." || key === "5") {
    event.preventDefault();
    act("move", 0, 0);
  } else if (key === ">" || key === "Enter") {
    event.preventDefault();
    act("descend");
  } else if (key === "q") {
    act("quaff");
  } else if (key === "e") {
    act("eat");
  }
}

function tileFromPointer(event) {
  const rect = canvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
  const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
  return { x: camera.x + Math.floor(x / tile), y: camera.y + Math.floor(y / tile) };
}

function bindBoard() {
  let down = null;
  canvas.addEventListener("pointerdown", (event) => {
    down = { x: event.clientX, y: event.clientY };
  });
  canvas.addEventListener("pointerup", (event) => {
    if (!down || !state) return;
    const dx = event.clientX - down.x;
    const dy = event.clientY - down.y;
    down = null;
    if (Math.abs(dx) > 24 || Math.abs(dy) > 24) {
      if (Math.abs(dx) > Math.abs(dy)) act("move", Math.sign(dx), 0);
      else act("move", 0, Math.sign(dy));
      return;
    }
    const cell = tileFromPointer(event);
    const distance = Math.abs(cell.x - state.player.x) + Math.abs(cell.y - state.player.y);
    if (distance === 0) act("move", 0, 0);
    else if (distance === 1) act("move", cell.x - state.player.x, cell.y - state.player.y);
    else $("#msg").textContent = "一次只能走一格：點自己旁邊的格子。";
  });
  canvas.addEventListener("pointercancel", () => {
    down = null;
  });
}

function bindPad() {
  const stop = () => {
    clearTimeout(padTimers.delay);
    clearInterval(padTimers.repeat);
  };
  for (const button of document.querySelectorAll(".pad-btn")) {
    const [dx, dy] = button.dataset.move.split(",").map(Number);
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      act("move", dx, dy);
      stop();
      padTimers.delay = setTimeout(() => {
        padTimers.repeat = setInterval(() => act("move", dx, dy), 130);
      }, 340);
    });
    for (const name of ["pointerup", "pointerleave", "pointercancel"]) button.addEventListener(name, stop);
  }
}

// ---------------------------------------------------------------- 開場與結束

async function enterGame(next) {
  state = next;
  motions = new Map();
  floats = [];
  hurtFlash = 0;
  $("#lobby").hidden = true;
  $("#game").hidden = false;
  $("#overlay").hidden = true;
  layout();
  renderHud();
  await audio.start();
  void audio.playMusic(state.depth >= MAX_DEPTH ? "throne" : "delve");
  scheduleSave();
}

function toLobby() {
  $("#overlay").hidden = true;
  $("#confirm-overlay").hidden = true;
  $("#game").hidden = true;
  $("#lobby").hidden = false;
  audio.stopMusic();
  renderRecord();
  refreshResume();
}

function refreshResume() {
  const run = progress.run;
  const valid = run && run.outcome === "playing" && Array.isArray(run.tiles) && run.player;
  $("#resume").hidden = !valid;
  if (valid) $("#resume-depth").textContent = run.depth;
}

function newRun() {
  return createGame({ seed: Date.now() % 1000000007 });
}

// ---------------------------------------------------------------- 啟動

await loadSheets();
progress = { bestDepth: 1, bestScore: 0, wins: 0, runs: 0, run: null, ...(await loadProgress()) };
renderRecord();
refreshResume();
layout();
requestAnimationFrame(render);

window.addEventListener("resize", () => {
  layout();
});
window.addEventListener("keydown", onKey);
bindBoard();
bindPad();

$("#start").addEventListener("click", () => void enterGame(newRun()));
$("#resume").addEventListener("click", () => void enterGame(progress.run));
$("#act-descend").addEventListener("click", () => act("descend"));
$("#act-quaff").addEventListener("click", () => act("quaff"));
$("#act-eat").addEventListener("click", () => act("eat"));
$("#give-up").addEventListener("click", askQuit);
$("#cancel-quit").addEventListener("click", () => {
  $("#confirm-overlay").hidden = true;
});
$("#confirm-quit").addEventListener("click", () => {
  $("#confirm-overlay").hidden = true;
  progress.run = null;
  clearTimeout(saveTimer);
  void saveProgress(progress);
  toLobby();
});
$("#overlay-again").addEventListener("click", () => void enterGame(newRun()));
$("#overlay-lobby").addEventListener("click", toLobby);
$("#sound").addEventListener("click", async (event) => {
  const on = event.currentTarget.getAttribute("aria-pressed") !== "true";
  event.currentTarget.setAttribute("aria-pressed", String(on));
  event.currentTarget.textContent = on ? "♫ 音效" : "♫ 靜音";
  audio.setEnabled(on);
  if (on) {
    await audio.start();
    if (!$("#game").hidden) void audio.playMusic(state.depth >= MAX_DEPTH ? "throne" : "delve");
  }
});
