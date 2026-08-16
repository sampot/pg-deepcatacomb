/** pg-deepcatacomb — 深窟探險 (傳統 Roguelike) */

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function mulberry32(a) {
  return function() {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function deep(o) { return JSON.parse(JSON.stringify(o)); }


export function createGame({ seed = 1 } = {}) {
  return { seed, turn: 0, score: 0, level: 1, meter: 0, resources: 10, flags: {}, log: ["深窟探險：移動／攻擊／拾取"], outcome: "playing", msg: "深窟探險：移動／攻擊／拾取" };
}
export function getLegalActions(s) {
  if (s.outcome !== "playing") return [];
  return ["north","east","south","west","wait"];
}
export function applyAction(state, action) {
  const s = deep(state);
  if (s.outcome !== "playing") return s;
  const rnd = mulberry32(s.seed + s.turn * 19);
  s.turn++;
  
  s.flags.hunger = (s.flags.hunger ?? 20) - 1;
  s.flags.hp = s.flags.hp ?? 20;
  s.flags.light = s.flags.light ?? 5;
  if (action !== "wait") { s.meter += 5; s.score += 2; s.msg = "探索 "+action; if (rnd()<0.25) { s.flags.hp -= 3; s.msg += " 遭遇怪物"; } if (rnd()<0.2) { s.resources++; s.msg += " 拾取"; } }
  else { s.flags.hunger += 2; s.msg = "原地休息"; }
  s.flags.light = clamp(s.flags.light - (rnd()<0.3?1:0), 0, 8);
  if (s.flags.hunger <= 0 || s.flags.hp <= 0) { s.outcome = "lost"; s.msg = "飢餓或戰死"; }
  if (s.meter >= 100) { s.level = 5; s.msg = "找到出口"; }

  if (s.resources < 0) s.resources = 0;
  if (s.outcome === "playing" && s.level >= 5 && s.meter >= 100) {
    s.outcome = "won";
    s.msg = "目標達成！";
  }
  if (s.outcome === "playing" && (s.resources <= 0 && s.meter < 20 && s.turn > 8)) {
    s.outcome = "lost";
    s.msg = "資源崩盤";
  }
  return s;
}
export function summarize(s) {
  return { turn: s.turn, level: s.level, meter: s.meter, score: s.score, resources: s.resources, msg: s.msg, outcome: s.outcome, flags: s.flags };
}
export function getOutcome(s) { return s.outcome; }

