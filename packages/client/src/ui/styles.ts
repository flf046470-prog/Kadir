/**
 * One stylesheet for PC and Mobile. Touch targets are sized for thumbs everywhere (44 px
 * minimum), and layout uses safe-area insets so notches and home indicators never cover a
 * control.
 */
export const UI_CSS = `
.kc-root { position: fixed; inset: 0; pointer-events: none; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.kc-root * { pointer-events: auto; }
.kc-hidden { display: none !important; }

.kc-btn {
  font: 600 15px/1.2 system-ui, sans-serif; color: #f2f7f0; background: rgba(28,48,32,0.82);
  border: 1px solid rgba(255,255,255,0.16); border-radius: 12px; padding: 12px 18px; min-height: 44px;
  cursor: pointer; transition: transform .08s ease, background .15s ease; backdrop-filter: blur(8px);
}
.kc-btn:hover { background: rgba(45,74,50,0.9); }
.kc-btn:active { transform: scale(0.97); }
.kc-btn--primary { background: linear-gradient(180deg,#4caf50,#2f7d36); border-color: rgba(255,255,255,0.28); }
.kc-btn--primary:hover { background: linear-gradient(180deg,#5cc460,#37913f); }
.kc-btn--danger { background: rgba(140,40,40,0.85); }
.kc-btn:disabled { opacity: .45; cursor: not-allowed; }

.kc-screen {
  position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 18px; background: radial-gradient(120% 80% at 50% 0%, rgba(24,48,28,.86), rgba(8,14,10,.95));
  padding: max(24px, env(safe-area-inset-top)) 24px max(24px, env(safe-area-inset-bottom));
  overflow-y: auto;
}
.kc-title { font-size: clamp(30px, 7vw, 58px); font-weight: 800; letter-spacing: -0.02em; margin: 0; text-align: center;
  background: linear-gradient(180deg,#ffd166,#e0a45e); -webkit-background-clip: text; background-clip: text; color: transparent; }
.kc-subtitle { margin: 0 0 8px; opacity: .75; font-size: 15px; text-align: center; max-width: 46ch; }
.kc-menu { display: flex; flex-direction: column; gap: 10px; width: min(420px, 92vw); }
.kc-row { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
.kc-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; width: min(860px, 94vw); }
.kc-card { background: rgba(18,30,20,.85); border: 1px solid rgba(255,255,255,.12); border-radius: 14px; padding: 14px; display: flex; flex-direction: column; gap: 8px; }
.kc-card h3 { margin: 0; font-size: 16px; }
.kc-card p { margin: 0; font-size: 13px; opacity: .72; line-height: 1.4; }
.kc-card--selected { outline: 2px solid #ffd166; }
.kc-swatch { height: 54px; border-radius: 10px; }
.kc-tag { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; opacity: .8; }
.kc-panel { background: rgba(12,22,15,.9); border: 1px solid rgba(255,255,255,.12); border-radius: 16px; padding: 18px; width: min(620px, 94vw); display: flex; flex-direction: column; gap: 12px; max-height: 76vh; overflow-y: auto; }
.kc-field { display: flex; align-items: center; justify-content: space-between; gap: 14px; font-size: 14px; }
.kc-field input[type=range] { flex: 1; accent-color: #4caf50; }
.kc-field input[type=text] { background: rgba(0,0,0,.4); border: 1px solid rgba(255,255,255,.2); color: inherit; border-radius: 8px; padding: 10px; font: inherit; min-width: 0; }
.kc-note { font-size: 12px; opacity: .6; line-height: 1.5; }
.kc-credit { border-bottom: 1px solid rgba(255,255,255,.07); padding-bottom: 8px; font-size: 13px; line-height: 1.5; }
.kc-credit:last-child { border-bottom: 0; }
.kc-credit .kc-note { word-break: break-word; }

.kc-hud { position: absolute; inset: 0; pointer-events: none; }
.kc-hud > * { pointer-events: none; }
.kc-hud-top { position: absolute; top: max(12px, env(safe-area-inset-top)); left: 50%; transform: translateX(-50%); text-align: center; }
.kc-headline { font-size: clamp(18px, 4vw, 28px); font-weight: 800; text-shadow: 0 2px 10px rgba(0,0,0,.7); }
.kc-timer { font-size: 15px; opacity: .85; font-variant-numeric: tabular-nums; }
.kc-role { display: inline-block; margin-top: 6px; padding: 4px 12px; border-radius: 999px; font-size: 13px; font-weight: 700; }
.kc-role--chaser { background: #d33; } .kc-role--runner { background: #2b7fd4; } .kc-role--other { background: #555; }
.kc-scores { position: absolute; top: max(12px, env(safe-area-inset-top)); right: max(12px, env(safe-area-inset-right)); font-size: 13px; text-align: right; background: rgba(0,0,0,.35); padding: 8px 12px; border-radius: 10px; min-width: 130px; }
.kc-scores div { display: flex; justify-content: space-between; gap: 12px; }
.kc-status { position: absolute; bottom: max(10px, env(safe-area-inset-bottom)); left: max(10px, env(safe-area-inset-left)); font-size: 11px; opacity: .6; font-variant-numeric: tabular-nums; }
.kc-chat { position: absolute; bottom: 70px; left: max(12px, env(safe-area-inset-left)); width: min(420px, 46vw); font-size: 13px; display: flex; flex-direction: column; gap: 4px; pointer-events: none; }
.kc-chat-log { display: flex; flex-direction: column; gap: 3px; max-height: 30vh; overflow-y: auto; scrollbar-width: none; }
.kc-chat-log::-webkit-scrollbar { display: none; }
.kc-chat-line { transition: opacity .4s linear; align-self: flex-start; background: rgba(0,0,0,.45); padding: 4px 8px; border-radius: 8px; max-width: 100%; word-break: break-word; }
.kc-chat-line b { color: #a5b4fc; font-weight: 600; }
.kc-chat-line--team b { color: #6ee7b7; }
.kc-chat-line--own b { color: #fcd34d; }
.kc-chat-line--system { background: rgba(120,20,20,.55); font-style: italic; }
/* The composer only exists while it is open: an invisible-but-present input steals taps on
   touch and tab-focus on desktop, both of which look like the game freezing. */
.kc-chat-form { display: none; gap: 6px; pointer-events: auto; }
.kc-chat[data-open='true'] .kc-chat-form { display: flex; }
.kc-chat[data-open='true'] .kc-chat-log { background: rgba(0,0,0,.25); border-radius: 8px; }
.kc-chat-input { flex: 1; min-width: 0; background: rgba(0,0,0,.72); color: #f8fafc; border: 1px solid rgba(255,255,255,.25); border-radius: 8px; padding: 7px 10px; font: inherit; }
.kc-chat-input:focus { outline: 2px solid #818cf8; outline-offset: 1px; }
.kc-chat-channel { background: rgba(99,102,241,.85); color: #fff; border: 0; border-radius: 8px; padding: 0 10px; font: inherit; font-weight: 700; cursor: pointer; }
.kc-toast { position: absolute; top: 22%; left: 50%; transform: translateX(-50%); background: rgba(0,0,0,.6); padding: 10px 18px; border-radius: 12px; font-weight: 600; }
.kc-charge { position: absolute; bottom: max(16px, env(safe-area-inset-bottom)); left: 50%; transform: translateX(-50%); width: min(240px, 46vw); height: 8px; background: rgba(0,0,0,.45); border-radius: 999px; overflow: hidden; }
.kc-charge i { display: block; height: 100%; width: 0; background: linear-gradient(90deg,#ffd166,#ef476f); }

/* Gadget strip: sits just above the hop-charge bar, out of the middle of the screen. */
.kc-gadgets { position: absolute; bottom: calc(max(16px, env(safe-area-inset-bottom)) + 18px); left: 50%; transform: translateX(-50%); display: flex; gap: 8px; align-items: center; pointer-events: none; max-width: 96vw; flex-wrap: wrap; justify-content: center; }
.kc-slot { display: flex; align-items: baseline; gap: 6px; background: rgba(0,0,0,.42); border-radius: 999px; padding: 7px 13px; font-size: 13px; border: 1px solid transparent; }
.kc-slot b { font-weight: 600; }
.kc-slot i { font-style: normal; opacity: .75; font-variant-numeric: tabular-nums; }
/* The selected slot is the one the fire button uses, so it is the one that must be unmistakable. */
.kc-slot--on { border-color: #ffd166; background: rgba(255,209,102,.18); }
.kc-slot--cooling { opacity: .55; }
.kc-pill--warn { background: rgba(239,71,111,.85); }

/* In-round shop. Anchored right so it never covers the headline or the player. */
.kc-shop { position: absolute; right: max(12px, env(safe-area-inset-right)); top: 50%; transform: translateY(-50%); width: min(260px, 62vw); background: rgba(12,20,15,.92); border-radius: 14px; padding: 10px; display: flex; flex-direction: column; gap: 6px; pointer-events: auto; }
.kc-shop-head { display: flex; justify-content: space-between; font-weight: 700; padding: 2px 6px 6px; border-bottom: 1px solid rgba(255,255,255,.12); }
.kc-shop-row { display: flex; justify-content: space-between; align-items: center; gap: 10px; min-height: 44px; padding: 8px 12px; border: 0; border-radius: 10px; background: rgba(255,255,255,.08); color: inherit; font: inherit; cursor: pointer; }
.kc-shop-row:hover:not(:disabled) { background: rgba(255,209,102,.22); }
.kc-shop-row:focus-visible { outline: 2px solid #ffd166; outline-offset: 2px; }
.kc-shop-row--poor { opacity: .45; cursor: not-allowed; }

.kc-touch { position: absolute; inset: 0; }
.kc-stick { position: absolute; width: 110px; height: 110px; margin: -55px 0 0 -55px; border-radius: 50%; border: 2px solid rgba(255,255,255,.28); background: rgba(0,0,0,.22); opacity: 0; transition: opacity .12s; }
.kc-stick i { position: absolute; left: 50%; top: 50%; width: 46px; height: 46px; margin: -23px 0 0 -23px; border-radius: 50%; background: rgba(255,255,255,.4); }
.kc-touchbtns { position: absolute; right: max(16px, env(safe-area-inset-right)); bottom: max(20px, env(safe-area-inset-bottom)); display: grid; grid-template-columns: repeat(2, 76px); gap: 12px; }
/* Gear cluster: top-right, away from the movement pad so a thumb reaching for HOP mid-chase
   cannot fire a freeze gun by accident. Smaller, because it is used deliberately, not in a panic. */
.kc-touchbtns--gear { top: max(64px, env(safe-area-inset-top)); bottom: auto; grid-template-columns: repeat(2, 62px); gap: 10px; }
.kc-touchbtn { width: 76px; height: 76px; border-radius: 50%; border: 1px solid rgba(255,255,255,.2); background: rgba(20,40,24,.72); color: #fff; font: 700 13px system-ui; display: flex; align-items: center; justify-content: center; user-select: none; }
.kc-touchbtn--big { width: 92px; height: 92px; grid-column: 2; background: rgba(46,110,52,.8); }
.kc-touchbtn:active, .kc-touchbtn[data-active="true"] { background: rgba(90,180,96,.9); transform: scale(.96); }

.kc-topbar { position: absolute; top: max(10px, env(safe-area-inset-top)); left: max(10px, env(safe-area-inset-left)); display: flex; gap: 8px; }
.kc-pill { background: rgba(0,0,0,.42); border-radius: 999px; padding: 8px 14px; font-size: 13px; font-weight: 600; }
.kc-currency { display: flex; align-items: center; gap: 6px; }
.kc-daily { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; }
.kc-daily div { background: rgba(255,255,255,.08); border-radius: 8px; padding: 8px 4px; text-align: center; font-size: 11px; }
.kc-daily div.claimable { background: rgba(76,175,80,.5); outline: 1px solid #ffd166; }
.kc-results { width: min(560px, 94vw); }
.kc-results table { width: 100%; border-collapse: collapse; font-size: 14px; }
.kc-results td, .kc-results th { padding: 6px 8px; text-align: left; border-bottom: 1px solid rgba(255,255,255,.08); }
.kc-results tr.me { background: rgba(255,209,102,.16); }
@media (max-width: 520px) { .kc-touchbtn { width: 66px; height: 66px; } .kc-touchbtn--big { width: 82px; height: 82px; } }

/* Landscape phones are short: shrink the control cluster and the scoreboard so they never
   overlap. A control the player cannot reach is worse than a control they cannot read. */
@media (max-height: 480px) {
  .kc-touchbtns { grid-template-columns: repeat(3, 60px); gap: 8px; }
  .kc-touchbtns--gear { grid-template-columns: repeat(2, 52px); gap: 6px; }
  .kc-touchbtn { width: 60px; height: 60px; font-size: 11px; }
  .kc-touchbtn--big { width: 72px; height: 72px; grid-column: 3; grid-row: 1 / span 2; align-self: end; }
  .kc-scores { font-size: 11px; padding: 6px 9px; min-width: 108px; max-height: 34vh; overflow: hidden; }
  .kc-headline { font-size: 20px; }
  .kc-chat { bottom: 96px; font-size: 11px; width: 62vw; }
}
`;

export function injectStyles(): void {
  if (document.getElementById('kc-styles')) return;
  const style = document.createElement('style');
  style.id = 'kc-styles';
  style.textContent = UI_CSS;
  document.head.append(style);
}
