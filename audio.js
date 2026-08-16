export class GameAudio {
  constructor(){this.enabled=true;this.started=false;this.ctx=null;this.timer=null}
  tone(freq,duration=.08,type="square",gain=.035){if(!this.enabled||!this.ctx)return;const o=this.ctx.createOscillator(),g=this.ctx.createGain();o.type=type;o.frequency.value=freq;g.gain.setValueAtTime(gain,this.ctx.currentTime);g.gain.exponentialRampToValueAtTime(.001,this.ctx.currentTime+duration);o.connect(g).connect(this.ctx.destination);o.start();o.stop(this.ctx.currentTime+duration)}
  async start(){this.started=true;this.ctx??=new AudioContext();await this.ctx.resume();if(!this.timer){let i=0;this.timer=setInterval(()=>{if(this.enabled)this.tone([110,147,165,220][i++%4],.35,"sine",.018)},520)}}
  setEnabled(on){this.enabled=on;if(on&&this.started)this.start()}
  play(name){this.tone({click:280,ok:520,hit:90,coin:740,soft:190}[name]||320,name==="hit"?.18:.08,name==="hit"?"sawtooth":"square",.045)}
}