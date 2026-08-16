import { describe, expect, it } from "vitest";
import {
  ARMORS,
  FLOOR,
  HUNGER_FAINT,
  HUNGER_MAX,
  MAP_H,
  MAP_W,
  MAX_DEPTH,
  MONSTERS,
  POTION_HEAL,
  RATION_FEED,
  STAIRS,
  WALL,
  WEAPONS,
  computeVisible,
  createGame,
  descend,
  eat,
  expToLevel,
  generateLevel,
  getOutcome,
  isWalkable,
  itemAt,
  monsterAt,
  onStairs,
  playerAttackPower,
  playerDefense,
  quaff,
  step,
  summarize,
  tileAt,
  wait,
} from "./game.js";

/** 把玩家搬到指定格並清空周圍怪物，方便針對單一規則做斷言。 */
function place(state, x, y) {
  const s = structuredClone(state);
  s.player.x = x;
  s.player.y = y;
  s.monsters = [];
  s.items = [];
  return s;
}

function findFloor(state, { away = null, minDist = 0 } = {}) {
  for (let y = 1; y < MAP_H - 1; y += 1) {
    for (let x = 1; x < MAP_W - 1; x += 1) {
      if (state.tiles[y][x] !== FLOOR) continue;
      if (state.tiles[y][x + 1] !== FLOOR) continue;
      if (away && Math.abs(away.x - x) + Math.abs(away.y - y) < minDist) continue;
      return { x, y };
    }
  }
  throw new Error("no floor pair found");
}

function spawn(state, kind, x, y) {
  const def = MONSTERS[kind];
  const s = structuredClone(state);
  s.monsters = [{ id: `${kind}-t`, kind, x, y, hp: def.hp, maxHp: def.hp, awake: true, ticks: 0 }];
  return s;
}

/** 從起點以四方向 BFS，確認能走到目標格。 */
function reachable(tiles, from, to) {
  const seen = new Set([`${from.x},${from.y}`]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    if (cur.x === to.x && cur.y === to.y) return true;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
      if (tiles[ny][nx] === WALL || seen.has(`${nx},${ny}`)) continue;
      seen.add(`${nx},${ny}`);
      queue.push({ x: nx, y: ny });
    }
  }
  return false;
}

describe("地城生成", () => {
  it("玩家開局站在可走的地板上", () => {
    for (const seed of [1, 7, 42, 1234, 90210]) {
      const s = createGame({ seed });
      expect(isWalkable(s, s.player.x, s.player.y)).toBe(true);
      expect(s.outcome).toBe("playing");
    }
  });

  it("同一 seed 產生同一張地圖", () => {
    expect(createGame({ seed: 99 }).tiles).toEqual(createGame({ seed: 99 }).tiles);
  });

  it("不同 seed 產生不同地圖", () => {
    expect(createGame({ seed: 3 }).tiles).not.toEqual(createGame({ seed: 4 }).tiles);
  });

  it("每一層的樓梯都走得到", () => {
    for (const depth of [1, 2, 3, 4, 5]) {
      const level = generateLevel(31, depth);
      expect(level.stairs).not.toBeNull();
      expect(reachable(level.tiles, level.start, level.stairs)).toBe(true);
    }
  });

  it("怪物與掉落物都放在地板上，且不與玩家起點重疊", () => {
    const level = generateLevel(8, 3);
    for (const m of level.monsters) {
      expect(level.tiles[m.y][m.x]).not.toBe(WALL);
      expect(`${m.x},${m.y}`).not.toBe(`${level.start.x},${level.start.y}`);
    }
    for (const i of level.items) expect(level.tiles[i.y][i.x]).not.toBe(WALL);
  });

  it("深度越深怪物越多，且只出現該深度的種類", () => {
    const shallow = generateLevel(5, 1);
    const deep = generateLevel(5, 5);
    expect(deep.monsters.length).toBeGreaterThan(shallow.monsters.length);
    for (const m of shallow.monsters) {
      expect(MONSTERS[m.kind].depths[0]).toBeLessThanOrEqual(1);
      expect(MONSTERS[m.kind].depths[1]).toBeGreaterThanOrEqual(1);
    }
  });

  it("最底層是王座大廳：有骸骨王、沒有往下的樓梯", () => {
    const level = generateLevel(5, MAX_DEPTH);
    expect(level.stairs).toBeNull();
    expect(level.monsters.some((m) => m.kind === "boneking")).toBe(true);
    expect(level.tiles.flat()).not.toContain(STAIRS);
  });
});

describe("移動", () => {
  it("走向空地會更新座標並累計步數", () => {
    const base = createGame({ seed: 11 });
    const spot = findFloor(base);
    const s = place(base, spot.x, spot.y);
    const next = step(s, 1, 0);
    expect(next.player.x).toBe(spot.x + 1);
    expect(next.player.y).toBe(spot.y);
    expect(next.steps).toBe(s.steps + 1);
  });

  it("撞牆不會移動，也不消耗回合", () => {
    const base = createGame({ seed: 12 });
    let wall = null;
    outer: for (let y = 1; y < MAP_H - 1; y += 1) {
      for (let x = 1; x < MAP_W - 1; x += 1) {
        if (base.tiles[y][x] === FLOOR && base.tiles[y][x - 1] === WALL) {
          wall = { x, y };
          break outer;
        }
      }
    }
    const s = place(base, wall.x, wall.y);
    const next = step(s, -1, 0);
    expect(next.player.x).toBe(wall.x);
    expect(next.turn).toBe(s.turn);
    expect(next.player.hunger).toBe(s.player.hunger);
    expect(next.message).toContain("石壁");
  });

  it("地圖外緣是牆，走不出去", () => {
    const s = createGame({ seed: 13 });
    expect(isWalkable(s, -1, 5)).toBe(false);
    expect(isWalkable(s, MAP_W, 5)).toBe(false);
    expect(tileAt(s, 5, MAP_H)).toBe(WALL);
  });

  it("斜走與原地走都被拒絕", () => {
    const s = createGame({ seed: 14 });
    expect(step(s, 1, 1)).toBe(s);
    expect(step(s, 0, 0)).toBe(s);
  });

  it("原本的 state 不會被就地修改", () => {
    const base = createGame({ seed: 15 });
    const spot = findFloor(base);
    const s = place(base, spot.x, spot.y);
    const snapshot = structuredClone(s);
    step(s, 1, 0);
    expect(s).toEqual(snapshot);
  });

  it("等待會過一回合但不移動", () => {
    const base = createGame({ seed: 16 });
    const s = place(base, base.player.x, base.player.y);
    const next = wait(s);
    expect(next.player.x).toBe(s.player.x);
    expect(next.turn).toBe(s.turn + 1);
  });
});

describe("戰鬥", () => {
  it("走向怪物＝攻擊，怪物扣血且玩家不移動", () => {
    const base = createGame({ seed: 21 });
    const spot = findFloor(base);
    const s = spawn(place(base, spot.x, spot.y), "golem", spot.x + 1, spot.y);
    const next = step(s, 1, 0);
    expect(next.player.x).toBe(spot.x);
    expect(next.monsters[0].hp).toBeLessThan(MONSTERS.golem.hp);
    expect(next.turn).toBe(s.turn + 1);
  });

  it("擊殺會移除怪物、給經驗與分數", () => {
    const base = createGame({ seed: 22 });
    const spot = findFloor(base);
    let s = spawn(place(base, spot.x, spot.y), "rat", spot.x + 1, spot.y);
    s.monsters[0].hp = 1;
    const before = s.score;
    s = step(s, 1, 0);
    expect(s.monsters).toHaveLength(0);
    expect(s.kills).toBe(1);
    expect(s.score).toBe(before + MONSTERS.rat.exp);
  });

  it("已醒著的相鄰怪物會在玩家行動後反擊", () => {
    const base = createGame({ seed: 23 });
    const spot = findFloor(base);
    const s = spawn(place(base, spot.x, spot.y), "orc", spot.x + 1, spot.y);
    const next = wait(s);
    expect(next.player.hp).toBeLessThan(s.player.hp);
  });

  it("怪物會追擊玩家", () => {
    const base = createGame({ seed: 24 });
    const spot = findFloor(base);
    const s = spawn(place(base, spot.x, spot.y), "skeleton", spot.x + 4, spot.y);
    const next = wait(s);
    expect(Math.abs(next.monsters[0].x - spot.x)).toBeLessThan(4);
  });

  it("護甲會降低受到的傷害", () => {
    const base = createGame({ seed: 25 });
    const spot = findFloor(base);
    const bare = spawn(place(base, spot.x, spot.y), "orc", spot.x + 1, spot.y);
    const armored = structuredClone(bare);
    armored.player.armor = "plate";
    expect(playerDefense(armored)).toBe(playerDefense(bare) + ARMORS.plate.def);
    const bareLoss = bare.player.hp - wait(bare).player.hp;
    const armoredLoss = armored.player.hp - wait(armored).player.hp;
    expect(armoredLoss).toBeLessThan(bareLoss);
  });

  it("HP 歸零＝落敗，且動作全部停擺", () => {
    const base = createGame({ seed: 26 });
    const spot = findFloor(base);
    const s = spawn(place(base, spot.x, spot.y), "boneking", spot.x + 1, spot.y);
    s.player.hp = 1;
    const dead = wait(s);
    expect(dead.player.hp).toBe(0);
    expect(getOutcome(dead)).toBe("lost");
    expect(dead.cause).toBe("slain");
    expect(step(dead, 1, 0)).toBe(dead);
    expect(wait(dead)).toBe(dead);
    expect(quaff(dead)).toBe(dead);
  });

  it("在最底層斬殺骸骨王＝勝利", () => {
    const base = createGame({ seed: 27 });
    const spot = findFloor(base);
    let s = spawn(place(base, spot.x, spot.y), "boneking", spot.x + 1, spot.y);
    s.depth = MAX_DEPTH;
    s.monsters[0].hp = 1;
    s = step(s, 1, 0);
    expect(getOutcome(s)).toBe("won");
    expect(s.cause).toBe("boss");
    expect(s.score).toBeGreaterThan(600);
  });

  it("累積經驗會升級並提高攻擊與血量上限", () => {
    const base = createGame({ seed: 28 });
    const spot = findFloor(base);
    let s = spawn(place(base, spot.x, spot.y), "rat", spot.x + 1, spot.y);
    s.player.exp = expToLevel(1) - MONSTERS.rat.exp;
    s.monsters[0].hp = 1;
    const beforeAtk = playerAttackPower(s);
    const beforeMax = s.player.maxHp;
    s = step(s, 1, 0);
    expect(s.player.lvl).toBe(2);
    expect(playerAttackPower(s)).toBe(beforeAtk + 1);
    expect(s.player.maxHp).toBe(beforeMax + 5);
  });
});

describe("道具", () => {
  it("踩過道具會自動撿起並從地圖移除", () => {
    const base = createGame({ seed: 31 });
    const spot = findFloor(base);
    const s = place(base, spot.x, spot.y);
    s.items = [{ id: "t1", kind: "ration", x: spot.x + 1, y: spot.y }];
    const next = step(s, 1, 0);
    expect(next.player.rations).toBe(s.player.rations + 1);
    expect(itemAt(next, spot.x + 1, spot.y)).toBeNull();
  });

  it("撿到更好的武器會自動換裝", () => {
    const base = createGame({ seed: 32 });
    const spot = findFloor(base);
    const s = place(base, spot.x, spot.y);
    s.items = [{ id: "t2", kind: "weapon", key: "greatsword", x: spot.x + 1, y: spot.y }];
    const next = step(s, 1, 0);
    expect(next.player.weapon).toBe("greatsword");
    expect(playerAttackPower(next)).toBe(next.player.atk + WEAPONS.greatsword.atk);
  });

  it("撿到較差的武器不會降級", () => {
    const base = createGame({ seed: 33 });
    const spot = findFloor(base);
    const s = place(base, spot.x, spot.y);
    s.player.weapon = "longsword";
    s.items = [{ id: "t3", kind: "weapon", key: "dagger", x: spot.x + 1, y: spot.y }];
    const next = step(s, 1, 0);
    expect(next.player.weapon).toBe("longsword");
  });

  it("撿到護甲會提高防禦", () => {
    const base = createGame({ seed: 34 });
    const spot = findFloor(base);
    const s = place(base, spot.x, spot.y);
    s.items = [{ id: "t4", kind: "armor", key: "chain", x: spot.x + 1, y: spot.y }];
    const next = step(s, 1, 0);
    expect(next.player.armor).toBe("chain");
    expect(playerDefense(next)).toBe(playerDefense(s) + ARMORS.chain.def);
  });

  it("喝藥水會回血、扣一瓶，且不超過血量上限", () => {
    const base = createGame({ seed: 35 });
    const s = place(base, base.player.x, base.player.y);
    s.player.hp = 5;
    const healed = quaff(s);
    expect(healed.player.potions).toBe(s.player.potions - 1);
    expect(healed.player.hp).toBe(5 + POTION_HEAL);

    const full = place(base, base.player.x, base.player.y);
    expect(quaff(full).player.hp).toBe(full.player.maxHp);
  });

  it("沒有藥水或乾糧時不消耗回合", () => {
    const base = createGame({ seed: 36 });
    const s = place(base, base.player.x, base.player.y);
    s.player.potions = 0;
    s.player.rations = 0;
    expect(quaff(s)).toBe(s);
    expect(eat(s)).toBe(s);
  });
});

describe("飢餓", () => {
  it("每過一回合飢餓值下降", () => {
    const base = createGame({ seed: 41 });
    const s = place(base, base.player.x, base.player.y);
    expect(wait(s).player.hunger).toBe(s.player.hunger - 1);
  });

  it("飢餓歸零＝餓死", () => {
    const base = createGame({ seed: 42 });
    const s = place(base, base.player.x, base.player.y);
    s.player.hunger = 1;
    const dead = wait(s);
    expect(dead.player.hunger).toBe(0);
    expect(getOutcome(dead)).toBe("lost");
    expect(dead.cause).toBe("starve");
  });

  it("吃乾糧會補回飢餓值並封頂", () => {
    const base = createGame({ seed: 43 });
    const s = place(base, base.player.x, base.player.y);
    s.player.hunger = HUNGER_FAINT;
    const fed = eat(s);
    expect(fed.player.rations).toBe(s.player.rations - 1);
    expect(fed.player.hunger).toBe(HUNGER_FAINT + RATION_FEED - 1);

    const stuffed = place(base, base.player.x, base.player.y);
    stuffed.player.hunger = HUNGER_MAX;
    expect(eat(stuffed).player.hunger).toBe(HUNGER_MAX - 1);
  });
});

describe("視野", () => {
  it("視線內明亮、牆後看不到", () => {
    const tiles = Array.from({ length: MAP_H }, () => new Array(MAP_W).fill(FLOOR));
    for (let y = 0; y < MAP_H; y += 1) tiles[y][10] = WALL;
    tiles[5][10] = FLOOR;
    const vis = computeVisible(tiles, { x: 5, y: 12 }, 7);
    expect(vis[12][6]).toBe(true);
    expect(vis[12][11]).toBe(false);
    expect(vis[12][4]).toBe(true);
  });

  it("超過光照半徑的格子看不到", () => {
    const tiles = Array.from({ length: MAP_H }, () => new Array(MAP_W).fill(FLOOR));
    const vis = computeVisible(tiles, { x: 15, y: 11 }, 4);
    expect(vis[11][18]).toBe(true);
    expect(vis[11][21]).toBe(false);
  });

  it("走過的地方會留在 explored，但離開後不再 visible", () => {
    const base = createGame({ seed: 51 });
    const spot = findFloor(base);
    let s = place(base, spot.x, spot.y);
    s.explored = s.explored.map((row) => row.map(() => false));
    s = wait(s);
    const lit = [];
    for (let y = 0; y < MAP_H; y += 1) {
      for (let x = 0; x < MAP_W; x += 1) if (s.visible[y][x]) lit.push({ x, y });
    }
    expect(lit.length).toBeGreaterThan(5);
    for (let i = 0; i < 12; i += 1) s = step(s, 1, 0);
    const stillExplored = lit.every((c) => s.explored[c.y][c.x]);
    expect(stillExplored).toBe(true);
    expect(s.visible.flat().filter(Boolean).length).toBeLessThan(s.explored.flat().filter(Boolean).length);
  });
});

describe("下樓", () => {
  it("不站在樓梯上時下樓無效", () => {
    const base = createGame({ seed: 61 });
    const spot = findFloor(base);
    const s = place(base, spot.x, spot.y);
    expect(onStairs(s)).toBe(false);
    expect(descend(s)).toBe(s);
  });

  it("站上樓梯下樓：深度 +1、換新地圖、保留身上狀態", () => {
    const base = createGame({ seed: 62 });
    const s = place(base, base.stairs.x, base.stairs.y);
    s.player.weapon = "axe";
    s.player.hp = 9;
    expect(onStairs(s)).toBe(true);
    const next = descend(s);
    expect(next.depth).toBe(2);
    expect(next.player.weapon).toBe("axe");
    expect(next.player.hp).toBeLessThanOrEqual(9);
    expect(next.tiles).not.toEqual(s.tiles);
    expect(next.score).toBeGreaterThan(s.score);
    expect(isWalkable(next, next.player.x, next.player.y)).toBe(true);
  });

  it("一路下到最底層會遇到骸骨王", () => {
    let s = createGame({ seed: 63 });
    for (let depth = 1; depth < MAX_DEPTH; depth += 1) {
      s = place(s, s.stairs.x, s.stairs.y);
      s = descend(s);
    }
    expect(s.depth).toBe(MAX_DEPTH);
    expect(s.stairs).toBeNull();
    expect(s.monsters.some((m) => MONSTERS[m.kind].boss)).toBe(true);
    expect(descend(s)).toBe(s);
  });
});

describe("摘要", () => {
  it("summarize 回報宿主需要的欄位", () => {
    const s = createGame({ seed: 71 });
    const out = summarize(s);
    expect(out).toMatchObject({ depth: 1, maxDepth: MAX_DEPTH, outcome: "playing", turn: 0 });
    expect(out.weapon).toBe(WEAPONS.dagger.name);
    expect(out.armor).toBe(ARMORS.rags.name);
    expect(out.log.length).toBeGreaterThan(0);
  });

  it("monsterAt 只回報活著的怪物", () => {
    const base = createGame({ seed: 72 });
    const spot = findFloor(base);
    const s = spawn(place(base, spot.x, spot.y), "rat", spot.x + 1, spot.y);
    expect(monsterAt(s, spot.x + 1, spot.y)).not.toBeNull();
    s.monsters[0].hp = 0;
    expect(monsterAt(s, spot.x + 1, spot.y)).toBeNull();
  });
});
