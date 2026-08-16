// 深窟探險 — 純邏輯層（無 DOM）。
// 座標一律 {x, y}；x 向右、y 向下。地圖是 tiles[y][x] 的數字格。
// 所有隨機都走 state.rng（確定性），同一 seed 必得同一局。

export const WALL = 0;
export const FLOOR = 1;
export const STAIRS = 2;

export const MAP_W = 31;
export const MAP_H = 23;
export const MAX_DEPTH = 6;
export const LIGHT_RADIUS = 7;

export const HUNGER_START = 420;
export const HUNGER_MAX = 640;
export const HUNGER_FAINT = 60;
export const RATION_FEED = 180;
export const POTION_HEAL = 16;
export const REGEN_EVERY = 12;
export const LOG_LIMIT = 40;

/** 怪物圖塊索引：sheet "creatures" 走 10 欄，"dungeon" 走 12 欄。 */
export const MONSTERS = {
  rat: { name: "窟鼠", sheet: "creatures", tile: 143, hp: 6, atk: 3, def: 0, exp: 4, depths: [1, 2] },
  bat: { name: "洞蝠", sheet: "creatures", tile: 132, hp: 5, atk: 3, def: 0, exp: 6, erratic: true, depths: [1, 3] },
  goblin: { name: "哥布林", sheet: "creatures", tile: 10, hp: 11, atk: 5, def: 1, exp: 10, depths: [2, 4] },
  skeleton: { name: "骷髏兵", sheet: "creatures", tile: 1, hp: 14, atk: 6, def: 2, exp: 14, depths: [2, 5] },
  zombie: { name: "腐屍", sheet: "creatures", tile: 0, hp: 20, atk: 8, def: 2, exp: 18, slow: true, depths: [3, 5] },
  scorpion: { name: "毒蠍", sheet: "creatures", tile: 145, hp: 12, atk: 8, def: 1, exp: 16, depths: [3, 5] },
  orc: { name: "獸人", sheet: "creatures", tile: 11, hp: 24, atk: 10, def: 3, exp: 24, depths: [4, 6] },
  wraith: { name: "幽魂", sheet: "creatures", tile: 4, hp: 22, atk: 12, def: 2, exp: 30, depths: [5, 6] },
  golem: { name: "石魔", sheet: "creatures", tile: 47, hp: 34, atk: 11, def: 5, exp: 36, slow: true, depths: [5, 6] },
  boneking: { name: "骸骨王", sheet: "creatures", tile: 96, hp: 72, atk: 15, def: 5, exp: 150, boss: true, depths: [MAX_DEPTH, MAX_DEPTH] },
};

export const WEAPONS = {
  fist: { name: "赤手", atk: 0, tier: 0, tile: null },
  dagger: { name: "匕首", atk: 2, tier: 1, tile: 103 },
  shortsword: { name: "短劍", atk: 4, tier: 2, tile: 105 },
  axe: { name: "戰斧", atk: 6, tier: 3, tile: 118 },
  longsword: { name: "長劍", atk: 8, tier: 4, tile: 104 },
  greatsword: { name: "巨劍", atk: 11, tier: 5, tile: 107 },
};

export const ARMORS = {
  rags: { name: "布衣", def: 0, tier: 0, tile: null },
  leather: { name: "皮甲", def: 1, tier: 1, tile: 101 },
  chain: { name: "鎖子甲", def: 3, tier: 2, tile: 102 },
  plate: { name: "板甲", def: 5, tier: 3, tile: 56 },
};

const WEAPON_BY_DEPTH = [
  ["dagger", "dagger", "shortsword"],
  ["dagger", "shortsword", "shortsword"],
  ["shortsword", "shortsword", "axe"],
  ["shortsword", "axe", "longsword"],
  ["axe", "longsword", "longsword"],
  ["longsword", "longsword", "greatsword"],
];

const ARMOR_BY_DEPTH = [
  ["leather", "leather", "leather"],
  ["leather", "leather", "chain"],
  ["leather", "chain", "chain"],
  ["chain", "chain", "plate"],
  ["chain", "plate", "plate"],
  ["plate", "plate", "plate"],
];

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// ---------------------------------------------------------------- 亂數

function makeRng(seed) {
  return { v: (Math.abs(Math.trunc(seed)) % 4294967291) + 1 };
}

function rnd(r) {
  r.v = (r.v + 0x6d2b79f5) >>> 0;
  let t = r.v;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function ri(r, n) {
  return Math.floor(rnd(r) * n);
}

function pick(r, list) {
  return list[ri(r, list.length)];
}

/** 從 state 抽一次亂數並前進 state.rng，讓戰鬥結果可重播。 */
function roll(state, n) {
  const r = { v: state.rng };
  const out = ri(r, n);
  state.rng = r.v;
  return out;
}

// ---------------------------------------------------------------- 地圖生成

function blank(value) {
  return Array.from({ length: MAP_H }, () => new Array(MAP_W).fill(value));
}

export function inBounds(x, y) {
  return x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;
}

function roomsOverlap(a, b, gap = 1) {
  return (
    a.x - gap < b.x + b.w &&
    a.x + a.w + gap > b.x &&
    a.y - gap < b.y + b.h &&
    a.y + a.h + gap > b.y
  );
}

function carveRoom(tiles, room) {
  for (let y = room.y; y < room.y + room.h; y += 1) {
    for (let x = room.x; x < room.x + room.w; x += 1) tiles[y][x] = FLOOR;
  }
}

function carveCorridor(tiles, a, b, horizontalFirst) {
  const cx = (x, y) => {
    if (inBounds(x, y)) tiles[y][x] = FLOOR;
  };
  if (horizontalFirst) {
    for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x += 1) cx(x, a.y);
    for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y += 1) cx(b.x, y);
  } else {
    for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y += 1) cx(a.x, y);
    for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x += 1) cx(x, b.y);
  }
}

function center(room) {
  return { x: room.x + (room.w >> 1), y: room.y + (room.h >> 1) };
}

/** 最底層是王座大廳：一個大房間、四根石柱，沒有往下的樓梯。 */
function throneHall() {
  const tiles = blank(WALL);
  const room = { x: 6, y: 5, w: 19, h: 13 };
  carveRoom(tiles, room);
  for (const [px, py] of [[10, 8], [20, 8], [10, 14], [20, 14]]) tiles[py][px] = WALL;
  const anteroom = { x: 13, y: 19, w: 5, h: 3 };
  carveRoom(tiles, anteroom);
  carveCorridor(tiles, center(anteroom), center(room), false);
  return { tiles, rooms: [anteroom, room] };
}

function generateRooms(r) {
  const tiles = blank(WALL);
  const rooms = [];
  const target = 7 + ri(r, 3);
  for (let tries = 0; tries < 200 && rooms.length < target; tries += 1) {
    const w = 4 + ri(r, 6);
    const h = 3 + ri(r, 4);
    const room = { x: 1 + ri(r, MAP_W - w - 2), y: 1 + ri(r, MAP_H - h - 2), w, h };
    if (rooms.some((other) => roomsOverlap(room, other))) continue;
    rooms.push(room);
  }
  rooms.forEach((room) => carveRoom(tiles, room));
  for (let i = 1; i < rooms.length; i += 1) {
    carveCorridor(tiles, center(rooms[i - 1]), center(rooms[i]), rnd(r) < 0.5);
  }
  if (rooms.length > 3) {
    carveCorridor(tiles, center(rooms[0]), center(rooms[rooms.length - 1]), rnd(r) < 0.5);
  }
  return { tiles, rooms };
}

function freeCells(tiles, rooms, taken, fromRoom = 0) {
  const cells = [];
  for (let i = fromRoom; i < rooms.length; i += 1) {
    const room = rooms[i];
    for (let y = room.y; y < room.y + room.h; y += 1) {
      for (let x = room.x; x < room.x + room.w; x += 1) {
        if (tiles[y][x] !== FLOOR) continue;
        if (taken.has(`${x},${y}`)) continue;
        cells.push({ x, y });
      }
    }
  }
  return cells;
}

function monsterPoolFor(depth) {
  return Object.entries(MONSTERS)
    .filter(([, def]) => !def.boss && depth >= def.depths[0] && depth <= def.depths[1])
    .map(([kind]) => kind);
}

/** 產生一層地城：地形、樓梯、怪物、掉落物。 */
export function generateLevel(seed, depth) {
  const r = makeRng(seed * 7919 + depth * 104729 + 17);
  const boss = depth >= MAX_DEPTH;
  const { tiles, rooms } = boss ? throneHall() : generateRooms(r);
  const start = center(rooms[0]);
  const taken = new Set([`${start.x},${start.y}`]);

  let stairs = null;
  if (!boss) {
    stairs = center(rooms[rooms.length - 1]);
    if (stairs.x === start.x && stairs.y === start.y) {
      const spot = pick(r, freeCells(tiles, rooms, taken, 1));
      stairs = spot ?? stairs;
    }
    tiles[stairs.y][stairs.x] = STAIRS;
    taken.add(`${stairs.x},${stairs.y}`);
  }

  const monsters = [];
  if (boss) {
    const hall = rooms[1];
    const throne = { x: center(hall).x, y: hall.y + 1 };
    monsters.push(makeMonster("boneking", throne.x, throne.y, 0));
    taken.add(`${throne.x},${throne.y}`);
    const guards = ["skeleton", "orc", "wraith", "golem"];
    const spots = freeCells(tiles, [hall], taken).filter((c) => Math.abs(c.y - throne.y) > 2);
    guards.forEach((kind, i) => {
      const spot = spots[Math.floor(((i + 1) * spots.length) / (guards.length + 1))];
      if (!spot || taken.has(`${spot.x},${spot.y}`)) return;
      taken.add(`${spot.x},${spot.y}`);
      monsters.push(makeMonster(kind, spot.x, spot.y, i + 1));
    });
  } else {
    const pool = monsterPoolFor(depth);
    const count = 4 + depth + Math.floor(depth / 2);
    const spots = freeCells(tiles, rooms, taken, 1);
    for (let i = 0; i < count && spots.length; i += 1) {
      const spot = spots.splice(ri(r, spots.length), 1)[0];
      taken.add(`${spot.x},${spot.y}`);
      monsters.push(makeMonster(pick(r, pool), spot.x, spot.y, i));
    }
  }

  const items = [];
  const lootCount = boss ? 3 : 5 + ri(r, 3);
  const lootSpots = freeCells(tiles, rooms, taken, boss ? 0 : 1);
  for (let i = 0; i < lootCount && lootSpots.length; i += 1) {
    const spot = lootSpots.splice(ri(r, lootSpots.length), 1)[0];
    taken.add(`${spot.x},${spot.y}`);
    items.push({ ...rollLoot(r, depth), id: `i${depth}-${i}`, x: spot.x, y: spot.y });
  }

  return { tiles, rooms, start, stairs, monsters, items };
}

function rollLoot(r, depth) {
  const n = rnd(r);
  const tierIndex = Math.min(WEAPON_BY_DEPTH.length - 1, depth - 1);
  if (n < 0.24) return { kind: "ration" };
  if (n < 0.62) return { kind: "potion" };
  if (n < 0.81) return { kind: "weapon", key: pick(r, WEAPON_BY_DEPTH[tierIndex]) };
  return { kind: "armor", key: pick(r, ARMOR_BY_DEPTH[tierIndex]) };
}

function makeMonster(kind, x, y, index) {
  const def = MONSTERS[kind];
  return { id: `${kind}-${index}`, kind, x, y, hp: def.hp, maxHp: def.hp, awake: false, ticks: 0 };
}

// ---------------------------------------------------------------- 視野

function lineOfSight(tiles, x0, y0, x1, y1) {
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  for (let guard = 0; guard < MAP_W + MAP_H; guard += 1) {
    if (x === x1 && y === y1) return true;
    if (!(x === x0 && y === y0) && tiles[y][x] === WALL) return false;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
  return false;
}

/** 目前視野：以玩家為中心的圓形視線；牆貼著可見地板時一併點亮，避免轉角破洞。 */
export function computeVisible(tiles, from, radius = LIGHT_RADIUS) {
  const vis = blank(false);
  const r2 = radius * radius + radius;
  for (let y = from.y - radius; y <= from.y + radius; y += 1) {
    for (let x = from.x - radius; x <= from.x + radius; x += 1) {
      if (!inBounds(x, y)) continue;
      const dx = x - from.x;
      const dy = y - from.y;
      if (dx * dx + dy * dy > r2) continue;
      if (lineOfSight(tiles, from.x, from.y, x, y)) vis[y][x] = true;
    }
  }
  vis[from.y][from.x] = true;
  for (let y = from.y - radius; y <= from.y + radius; y += 1) {
    for (let x = from.x - radius; x <= from.x + radius; x += 1) {
      if (!inBounds(x, y) || vis[y][x] || tiles[y][x] !== WALL) continue;
      const dx = x - from.x;
      const dy = y - from.y;
      if (dx * dx + dy * dy > r2) continue;
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          const nx = x + ox;
          const ny = y + oy;
          if (!inBounds(nx, ny) || !vis[ny][nx] || tiles[ny][nx] === WALL) continue;
          if (Math.abs(nx - from.x) > Math.abs(dx) || Math.abs(ny - from.y) > Math.abs(dy)) continue;
          vis[y][x] = true;
        }
      }
    }
  }
  return vis;
}

function refreshSight(s) {
  s.visible = computeVisible(s.tiles, s.player, s.light);
  for (let y = 0; y < MAP_H; y += 1) {
    for (let x = 0; x < MAP_W; x += 1) if (s.visible[y][x]) s.explored[y][x] = true;
  }
}

// ---------------------------------------------------------------- 建立與存取

function logTo(s, text) {
  s.log.unshift(text);
  if (s.log.length > LOG_LIMIT) s.log.length = LOG_LIMIT;
}

function loadLevel(s, depth) {
  const level = generateLevel(s.seed, depth);
  s.depth = depth;
  s.tiles = level.tiles;
  s.stairs = level.stairs;
  s.monsters = level.monsters;
  s.items = level.items;
  s.player.x = level.start.x;
  s.player.y = level.start.y;
  s.explored = blank(false);
  refreshSight(s);
  return s;
}

export function createGame({ seed = 1 } = {}) {
  const s = {
    seed: Math.abs(Math.trunc(Number(seed))) || 1,
    rng: (Math.abs(Math.trunc(Number(seed))) || 1) >>> 0,
    depth: 1,
    turn: 0,
    steps: 0,
    kills: 0,
    score: 0,
    light: LIGHT_RADIUS,
    outcome: "playing",
    cause: null,
    events: [],
    message: "你舉著火把走進深窟第一層。",
    player: {
      x: 0,
      y: 0,
      hp: 26,
      maxHp: 26,
      atk: 4,
      def: 0,
      lvl: 1,
      exp: 0,
      hunger: HUNGER_START,
      weapon: "dagger",
      armor: "rags",
      potions: 2,
      rations: 2,
    },
    tiles: blank(WALL),
    visible: blank(false),
    explored: blank(false),
    monsters: [],
    items: [],
    stairs: null,
    log: ["深窟探險：活著下到第六層，斬下骸骨王。"],
  };
  return loadLevel(s, 1);
}

export function playerAttackPower(state) {
  return state.player.atk + WEAPONS[state.player.weapon].atk;
}

export function playerDefense(state) {
  return state.player.def + ARMORS[state.player.armor].def;
}

export function monsterAt(state, x, y) {
  return state.monsters.find((m) => m.hp > 0 && m.x === x && m.y === y) ?? null;
}

export function itemAt(state, x, y) {
  return state.items.find((i) => i.x === x && i.y === y) ?? null;
}

export function tileAt(state, x, y) {
  return inBounds(x, y) ? state.tiles[y][x] : WALL;
}

export function isWalkable(state, x, y) {
  return tileAt(state, x, y) !== WALL;
}

export function onStairs(state) {
  return tileAt(state, state.player.x, state.player.y) === STAIRS;
}

export function expToLevel(lvl) {
  return 20 + (lvl - 1) * 26;
}

export function getOutcome(state) {
  return state.outcome;
}

// ---------------------------------------------------------------- 戰鬥與成長

function grantExp(s, amount) {
  s.player.exp += amount;
  while (s.player.exp >= expToLevel(s.player.lvl)) {
    s.player.exp -= expToLevel(s.player.lvl);
    s.player.lvl += 1;
    s.player.maxHp += 5;
    s.player.hp = Math.min(s.player.maxHp, s.player.hp + 5);
    s.player.atk += 1;
    if (s.player.lvl % 2 === 0) s.player.def += 1;
    s.events.push({ type: "level" });
    logTo(s, `你升到 ${s.player.lvl} 級。`);
  }
}

function killMonster(s, m) {
  const def = MONSTERS[m.kind];
  m.hp = 0;
  s.kills += 1;
  s.score += def.exp;
  s.events.push({ type: "kill", x: m.x, y: m.y, boss: Boolean(def.boss) });
  logTo(s, `${def.name}倒下了。`);
  grantExp(s, def.exp);
  if (def.boss) {
    s.outcome = "won";
    s.cause = "boss";
    s.score += 600 + s.player.hp * 5;
    s.message = "骸骨王碎成一地白骨。你帶著它的王冠爬回地面。";
    logTo(s, "骸骨王被擊倒——深窟安靜了。");
  }
}

function attackMonster(s, m) {
  const def = MONSTERS[m.kind];
  const damage = Math.max(1, playerAttackPower(s) + roll(s, 3) - def.def);
  m.hp -= damage;
  m.awake = true;
  s.events.push({ type: "hit", x: m.x, y: m.y, amount: damage, target: "monster" });
  if (m.hp <= 0) killMonster(s, m);
  else {
    logTo(s, `你砍中${def.name} ${damage} 點。`);
    s.message = `你砍中${def.name}（${m.hp}/${m.maxHp}）。`;
  }
}

function monsterAttack(s, m) {
  const def = MONSTERS[m.kind];
  const damage = Math.max(1, def.atk + roll(s, 3) - playerDefense(s));
  s.player.hp -= damage;
  s.events.push({ type: "hit", x: s.player.x, y: s.player.y, amount: damage, target: "player" });
  logTo(s, `${def.name}擊中你 ${damage} 點。`);
  if (s.player.hp <= 0) {
    s.player.hp = 0;
    s.outcome = "lost";
    s.cause = "slain";
    s.message = `你被${def.name}放倒在第 ${s.depth} 層。`;
    logTo(s, s.message);
  }
}

// ---------------------------------------------------------------- 怪物回合

function monsterCanEnter(s, m, x, y) {
  if (!isWalkable(s, x, y)) return false;
  if (s.player.x === x && s.player.y === y) return false;
  return !s.monsters.some((o) => o !== m && o.hp > 0 && o.x === x && o.y === y);
}

function manhattan(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function stepMonster(s, m) {
  const def = MONSTERS[m.kind];
  const options = DIRS.filter(([dx, dy]) => monsterCanEnter(s, m, m.x + dx, m.y + dy)).map(([dx, dy]) => ({
    dx,
    dy,
    dist: manhattan({ x: m.x + dx, y: m.y + dy }, s.player),
    noise: def.erratic ? roll(s, 100) : 0,
  }));
  if (!options.length) return;
  options.sort((a, b) => a.dist - b.dist || a.noise - b.noise);
  const chosen = def.erratic && roll(s, 100) < 35 ? options[roll(s, options.length)] : options[0];
  m.x += chosen.dx;
  m.y += chosen.dy;
}

function monstersAct(s) {
  for (const m of s.monsters) {
    if (m.hp <= 0 || s.outcome !== "playing") continue;
    const def = MONSTERS[m.kind];
    const dist = manhattan(m, s.player);
    if (!m.awake) {
      if (dist <= s.light && s.visible[m.y][m.x]) {
        m.awake = true;
        if (def.boss) logTo(s, "骸骨王從王座上站了起來。");
      } else continue;
    }
    if (def.slow) {
      m.ticks += 1;
      if (m.ticks % 2 === 0) continue;
    }
    if (dist === 1) monsterAttack(s, m);
    else stepMonster(s, m);
  }
  s.monsters = s.monsters.filter((m) => m.hp > 0);
}

// ---------------------------------------------------------------- 回合結算

function hungerTick(s) {
  const before = s.player.hunger;
  s.player.hunger -= 1;
  if (s.player.hunger <= 0) {
    s.player.hunger = 0;
    s.outcome = "lost";
    s.cause = "starve";
    s.message = `你在第 ${s.depth} 層餓死了。`;
    logTo(s, s.message);
    return;
  }
  if (before > HUNGER_FAINT && s.player.hunger <= HUNGER_FAINT) logTo(s, "你餓得發昏，得盡快吃點東西。");
  else if (before > 160 && s.player.hunger <= 160) logTo(s, "你開始感到飢餓。");
}

function endTurn(s) {
  if (s.outcome !== "playing") return s;
  monstersAct(s);
  if (s.outcome === "playing") hungerTick(s);
  s.turn += 1;
  if (s.outcome === "playing" && s.player.hunger > HUNGER_FAINT && s.turn % REGEN_EVERY === 0) {
    s.player.hp = Math.min(s.player.maxHp, s.player.hp + 1);
  }
  refreshSight(s);
  return s;
}

function begin(state) {
  const s = structuredClone(state);
  s.events = [];
  return s;
}

// ---------------------------------------------------------------- 玩家動作

function pickUp(s) {
  const item = itemAt(s, s.player.x, s.player.y);
  if (!item) return;
  s.items = s.items.filter((i) => i !== item);
  s.events.push({ type: "pickup", kind: item.kind });
  if (item.kind === "ration") {
    s.player.rations += 1;
    logTo(s, "你撿起一份乾糧。");
    s.message = "撿到乾糧。";
  } else if (item.kind === "potion") {
    s.player.potions += 1;
    logTo(s, "你撿起一瓶治療藥水。");
    s.message = "撿到治療藥水。";
  } else if (item.kind === "weapon") {
    const found = WEAPONS[item.key];
    const held = WEAPONS[s.player.weapon];
    if (found.tier > held.tier) {
      s.player.weapon = item.key;
      s.score += 10;
      s.events.push({ type: "equip" });
      logTo(s, `你換上${found.name}（攻擊 +${found.atk}）。`);
      s.message = `裝備${found.name}。`;
    } else if (found.tier === held.tier) {
      s.score += 5;
      logTo(s, `你已經有一把${held.name}了，把這把留在原地。`);
      s.message = `你已經有${held.name}了。`;
    } else {
      s.score += 5;
      logTo(s, `${found.name}比不上手上的${held.name}，你把它留在原地。`);
      s.message = `${found.name}不如${held.name}。`;
    }
  } else if (item.kind === "armor") {
    const found = ARMORS[item.key];
    const worn = ARMORS[s.player.armor];
    if (found.tier > worn.tier) {
      s.player.armor = item.key;
      s.score += 10;
      s.events.push({ type: "equip" });
      logTo(s, `你穿上${found.name}（防禦 +${found.def}）。`);
      s.message = `穿上${found.name}。`;
    } else if (found.tier === worn.tier) {
      s.score += 5;
      logTo(s, `你身上這件${worn.name}還好好的，把它留在原地。`);
      s.message = `你已經穿著${worn.name}了。`;
    } else {
      s.score += 5;
      logTo(s, `${found.name}比不上身上的${worn.name}，你把它留在原地。`);
      s.message = `${found.name}不如${worn.name}。`;
    }
  }
}

/** 走一步：牆＝不消耗回合；有怪＝攻擊；空地＝移動並自動撿拾。 */
export function step(state, dx, dy) {
  if (state.outcome !== "playing") return state;
  if ((dx === 0 && dy === 0) || (dx !== 0 && dy !== 0)) return state;
  const nx = state.player.x + dx;
  const ny = state.player.y + dy;
  const s = begin(state);
  const target = monsterAt(s, nx, ny);
  if (target) {
    attackMonster(s, target);
    s.monsters = s.monsters.filter((m) => m.hp > 0);
    return endTurn(s);
  }
  if (!isWalkable(s, nx, ny)) {
    s.message = "石壁擋住了去路。";
    s.events.push({ type: "bump" });
    return s;
  }
  s.player.x = nx;
  s.player.y = ny;
  s.steps += 1;
  s.events.push({ type: "step" });
  s.message = tileAt(s, nx, ny) === STAIRS ? "向下的階梯就在腳邊。" : "";
  pickUp(s);
  return endTurn(s);
}

/** 原地等待一回合（療傷或讓怪物靠近）。 */
export function wait(state) {
  if (state.outcome !== "playing") return state;
  const s = begin(state);
  s.message = "你屏息等待。";
  return endTurn(s);
}

/** 下樓：必須站在階梯上。 */
export function descend(state) {
  if (state.outcome !== "playing") return state;
  if (!onStairs(state)) return state;
  const s = begin(state);
  const next = s.depth + 1;
  s.score += next * 50;
  loadLevel(s, next);
  s.events.push({ type: "descend", depth: next });
  s.message = next >= MAX_DEPTH ? "第六層。王座大廳的空氣沉得發冷。" : `你下到第 ${next} 層。`;
  logTo(s, s.message);
  return endTurn(s);
}

/** 喝治療藥水。 */
export function quaff(state) {
  if (state.outcome !== "playing" || state.player.potions <= 0) return state;
  const s = begin(state);
  s.player.potions -= 1;
  const healed = Math.min(POTION_HEAL, s.player.maxHp - s.player.hp);
  s.player.hp += healed;
  s.events.push({ type: "quaff", amount: healed });
  s.message = healed > 0 ? `藥水回復了 ${healed} 點體力。` : "藥水沒能讓你更好。";
  logTo(s, s.message);
  return endTurn(s);
}

/** 吃乾糧補飢餓。 */
export function eat(state) {
  if (state.outcome !== "playing" || state.player.rations <= 0) return state;
  const s = begin(state);
  s.player.rations -= 1;
  s.player.hunger = Math.min(HUNGER_MAX, s.player.hunger + RATION_FEED);
  s.events.push({ type: "eat" });
  s.message = "你嚼完一份乾糧。";
  logTo(s, s.message);
  return endTurn(s);
}

// ---------------------------------------------------------------- 摘要

export function summarize(state) {
  return {
    depth: state.depth,
    maxDepth: MAX_DEPTH,
    turn: state.turn,
    score: state.score,
    kills: state.kills,
    outcome: state.outcome,
    cause: state.cause,
    hp: state.player.hp,
    maxHp: state.player.maxHp,
    hunger: state.player.hunger,
    lvl: state.player.lvl,
    weapon: WEAPONS[state.player.weapon].name,
    armor: ARMORS[state.player.armor].name,
    message: state.message,
    log: state.log.slice(0, 4),
  };
}
