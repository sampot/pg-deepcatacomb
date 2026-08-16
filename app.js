import { createGame, applyAction, getLegalActions, summarize, getOutcome } from "./game.js";
import { GameAudio } from "./audio.js";
import { loadProgress, saveProgress } from "./persist.js";

const audio = new GameAudio();
let state = createGame({ seed: Date.now() % 9999 });
let progress = {};

const $ = (sel) => document.querySelector(sel);

function label(action) {
  const map = {
    punch: "拳", kick: "踢", block: "防", special: "大招",
    move: "前進", attack: "攻擊", accel: "加速", drift: "漂移", nitro: "氮氣",
    pass: "傳球", shoot: "射門", tackle: "搶斷", press: "高壓",
    powerUp: "力度+", powerDown: "力度-", throw: "投球",
    ollie: "跳躍", grind: "磨桿", manual: "手動",
    bank: "側滾", fire: "開火", flare: "熱焰彈",
    slash: "斬擊", skill: "技能", potion: "符水",
    wait: "待機", nextUnit: "換單位",
    N: "↑", E: "→", S: "↓", W: "←",
  };
  return map[action] || action;
}

function render() {
  const view = summarize(state);
  const outcome = getOutcome(state);
  $("#msg").textContent = view.msg || "";
  $("#hud").textContent = Object.entries(view)
    .filter(([k]) => !["msg", "outcome", "log", "flags", "you", "foe", "guesses", "loot", "enemies", "upgrades"].includes(k))
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`)
    .join(" · ");
  const extras = [];
  if (view.log) extras.push(view.log.join(" / "));
  if (view.you) extras.push("我軍 "+view.you.join(", "));
  if (view.foe) extras.push("敵軍 "+view.foe.join(", "));
  if (view.guesses) extras.push(view.guesses.join(" | "));
  if (view.loot) extras.push("loot "+view.loot.join(","));
  $("#extra").textContent = extras.join("\n");
  const board = $("#board");
  board.innerHTML = "";
  const hero = document.createElement("img");
  hero.src = "./assets/images/hero.png";
  hero.alt = "";
  hero.className = "sprite hero";
  board.appendChild(hero);
  const rival = document.createElement("img");
  rival.src = "./assets/images/rival.png";
  rival.onerror = () => { rival.src = "./assets/images/enemy.png"; rival.onerror = () => { rival.remove(); }; };
  rival.alt = "";
  rival.className = "sprite rival";
  board.appendChild(rival);
  const meter = document.createElement("div");
  meter.className = "meter";
  const fill = document.createElement("i");
  fill.style.width = `${clampMeter(view)}%`;
  meter.appendChild(fill);
  board.appendChild(meter);

  const actions = $("#actions");
  actions.innerHTML = "";
  for (const a of getLegalActions(state)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label(a);
    btn.addEventListener("click", () => {
      audio.play(a === "special" || a === "fire" || a === "fight" ? "hit" : "click");
      state = applyAction(state, a);
      render();
      void persist();
    });
    actions.appendChild(btn);
  }
  if (outcome !== "playing") {
    const again = document.createElement("button");
    again.type = "button";
    again.className = "primary";
    again.textContent = outcome === "won" ? "再來一局（勝）" : "再試一次";
    again.addEventListener("click", () => {
      audio.play("ok");
      state = createGame({ seed: Date.now() % 9999 });
      render();
    });
    actions.appendChild(again);
  }
  $("#badge").textContent = outcome === "playing" ? "進行中" : outcome === "won" ? "勝利" : "結束";
}

function clampMeter(view) {
  if (typeof view.meter === "number") return Math.max(0, Math.min(100, view.meter));
  if (typeof view.progress === "number") return view.progress;
  if (typeof view.score === "number") return Math.min(100, view.score);
  return 10;
}

async function persist() {
  const outcome = getOutcome(state);
  const view = summarize(state);
  progress = {
    ...progress,
    bestScore: Math.max(progress.bestScore || 0, view.score || 0),
    wins: (progress.wins || 0) + (outcome === "won" ? 1 : 0),
    last: view,
  };
  $("#best").textContent = String(progress.bestScore || 0);
  if (outcome === "won" || outcome === "lost") await saveProgress(progress);
}

async function boot() {
  progress = await loadProgress();
  $("#best").textContent = String(progress.bestScore || 0);
  $("#title").textContent = "深窟探險";
  $("#blurb").textContent = "程序地城、飢餓／光照、死即重來。";
  $("#genre").textContent = "傳統 Roguelike";
  $("#sound").addEventListener("click", async () => {
    const on = $("#sound").getAttribute("aria-pressed") !== "true";
    $("#sound").setAttribute("aria-pressed", String(on));
    $("#sound").textContent = on ? "♪ 音樂開" : "♪ 靜音";
    audio.setEnabled(on);
    if (on) await audio.start();
  });
  $("#start").addEventListener("click", async () => {
    await audio.start();
    audio.play("ok");
    $("#lobby").hidden = true;
    $("#game").hidden = false;
    render();
  });
}

boot();
