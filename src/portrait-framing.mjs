// Dedicated 1024 × 1536 shoulder portraits keep the full source width.
// The former full-body crops enlarged a 307 px strip; these preserve 1024 px.
// A shared camera avoids recentering/zooming during the twelve-frame head turn.
const states=['idle','thinking','working','reading','writing','searching','executing','delegating','answering','parallel','compacting','retrying','waiting','complete','error','queued','connecting','disconnected','stopped','paused','blocked'];
const intro=['away','attention-eyes','noticing','turn-early','turning','turn-late','front-neutral','front-blink','front-open','soft-smile','front-smile','smile-settle'];
const camera=Object.freeze({cropWidth:1,cx:.5,cy:.46});
export const PORTRAIT_FRAMING=Object.freeze(Object.fromEntries(['serene','maid','maid_chibi'].map(id=>[id,Object.freeze({
  states:Object.freeze(Object.fromEntries(states.map(state=>[state,Object.freeze({fit:'contain'})]))),
  intro:Object.freeze(Object.fromEntries(intro.map(frame=>[frame,camera]))),
})])));
