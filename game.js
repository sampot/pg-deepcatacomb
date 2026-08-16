function clone(v){return structuredClone(v)}
function rand(n){let t=(n+0x6d2b79f5)|0;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296}
export function createGame({seed=1,chapter=1}={}){return {seed:Number(seed)||1,turn:0,score:0,outcome:"playing",message:"準備就緒",chapter,x:4,y:3,hp:18,hunger:24,depth:1,stairs:{x:7,y:5},seen:[],map:["#########","#.......#","#.##....#","#.......#","#....##.#","#.......#","#########"]}}
export function getLegalActions(s){return s.outcome==="playing"?["north", "east", "south", "west", "wait"]:[]}
export function applyAction(state,action){const s=clone(state);if(!getLegalActions(s).includes(action))return s;s.message={"north": "↑", "east": "→", "south": "↓", "west": "←", "wait": "等待"}[action];const d={north:[0,-1],east:[1,0],south:[0,1],west:[-1,0],wait:[0,0]}[action],nx=s.x+d[0],ny=s.y+d[1];if(s.map[ny][nx]!=="#"){s.x=nx;s.y=ny}s.hunger--;if((s.turn+s.seed)%5===0)s.hp-=2;if(s.x===s.stairs.x&&s.y===s.stairs.y){s.depth++;s.x=1;s.y=1;s.score+=25}for(let y=s.y-2;y<=s.y+2;y++)for(let x=s.x-2;x<=s.x+2;x++)s.seen.push(x+","+y);s.seen=[...new Set(s.seen)];s.turn++;if(s.depth>=4)s.outcome="won";if(s.hp<=0||s.hunger<=0)s.outcome="lost";return s}
export function summarize(s){return {turn:s.turn,score:s.score,outcome:s.outcome,message:s.message}}
export function getOutcome(s){return s.outcome}
