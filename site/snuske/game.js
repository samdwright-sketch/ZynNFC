/* Snuske: a touch-joystick "snake" where a dude eats pouches and gets longer.
   All game logic runs in "cell" units; rendering scales cells to pixels. */
(() => {
  'use strict';

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  const el = {
    hud: $('hud'), score: $('score'), best: $('best'),
    menu: $('menu'), paused: $('paused'), over: $('over'),
    menuBest: $('menuBest'), finalScore: $('finalScore'), finalBest: $('finalBest'),
    newBest: $('newBest'), overTitle: $('overTitle'), overSub: $('overSub'),
    muteBtn: $('muteBtn'), toast: $('toast'), safe: $('safe'),
  };

  // ---------- Tunables ----------
  const NOMINAL_COLS = 15;
  const BASE_SPEED = 4.2;      // cells per second
  const SPEED_PER_POUCH = 0.07;
  const MAX_SPEED = 7.6;
  const TURN_RATE = 7.5;       // radians per second
  const START_LEN = 3;
  const GROW_PER_POUCH = 0.75;
  const GROW_PER_GOLD = 1.6;
  const HEAD_R = 0.58;
  const BODY_R = 0.42;
  const GOLD_EVERY = 7;
  const GOLD_LIFE = 6.5;       // seconds

  const COLORS = {
    bg: '#0d1726', arena: '#13233a', arenaEdge: '#1f3654', dot: 'rgba(143,163,189,.13)',
    outline: '#1b1210', skin: '#f3c29b', skinShade: '#dfa67c',
    shirtA: '#e04f5f', shirtB: '#f4efe6', pants: '#3b5b92', shoe: '#23201f',
    beanie: '#5fd3b0', beanieCuff: '#2f9c7e', pom: '#f4efe6',
    pouch: '#f7f3eb', pouchEdge: '#cfc5b3', pouchSeam: '#e2d9c8',
    gold: '#ffcc4d', goldEdge: '#c48d12', lip: '#d98a7a',
  };

  // ---------- Storage (guarded: private mode can throw) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  };

  // ---------- Audio ----------
  let actx = null;
  let muted = store.get('snuske.muted', '0') === '1';
  function audio() {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      actx = new AC();
    }
    if (actx.state === 'suspended') actx.resume();
    return actx;
  }
  function tone(freq, dur, { type = 'sine', vol = 0.18, to = null, delay = 0 } = {}) {
    if (muted) return;
    const a = audio(); if (!a) return;
    const t0 = a.currentTime + delay;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(a.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  const sfx = {
    eat() { tone(520, 0.08, { type: 'triangle', to: 780 }); tone(980, 0.07, { type: 'sine', vol: 0.1, delay: 0.05 }); },
    gold() { [660, 880, 1100, 1320].forEach((f, i) => tone(f, 0.09, { type: 'triangle', vol: 0.14, delay: i * 0.06 })); },
    die() { tone(320, 0.5, { type: 'sawtooth', vol: 0.12, to: 60 }); tone(160, 0.35, { type: 'square', vol: 0.06, to: 50, delay: 0.05 }); },
    start() { tone(440, 0.07, { type: 'triangle' }); tone(660, 0.1, { type: 'triangle', delay: 0.07 }); },
    click() { tone(700, 0.04, { type: 'triangle', vol: 0.08 }); },
  };
  const buzz = (p) => { try { if (navigator.vibrate) navigator.vibrate(p); } catch { /* ignore */ } };

  function renderMute() {
    el.muteBtn.innerHTML = muted
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor"/><path d="m16 9 5 6M21 9l-5 6"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
  }

  // ---------- Layout ----------
  let W = 0, H = 0, DPR = 1;
  let cols = NOMINAL_COLS, rows = 22, cell = 20;
  const arena = { x: 0, y: 0, w: 0, h: 0 };
  const pad = { cx: 0, cy: 0, show: false };
  let safe = { t: 0, r: 0, b: 0, l: 0 };

  function readSafe() {
    const cs = getComputedStyle(el.safe);
    safe = { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 };
  }

  function layout(lockGrid) {
    readSafe();
    DPR = Math.min(window.devicePixelRatio || 1, 3);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';

    const portrait = H > W * 1.15;
    const top = safe.t + 64;
    const side = 10 + Math.max(safe.l, safe.r);
    const padH = portrait ? Math.min(Math.max(H * 0.25, 150), 240) + safe.b : 0;
    const availX = side, availW = W - side * 2;
    const availY = top, availH = H - top - padH - (portrait ? 4 : 10 + safe.b);

    if (!lockGrid) {
      cell = Math.min(availW / NOMINAL_COLS, availH / 11);
      cols = Math.max(10, Math.floor(availW / cell));
      rows = Math.max(10, Math.floor(availH / cell));
    }
    cell = Math.min(availW / cols, availH / rows);
    arena.w = cols * cell; arena.h = rows * cell;
    arena.x = availX + (availW - arena.w) / 2;
    arena.y = availY + (availH - arena.h) / 2;

    pad.show = portrait;
    pad.cx = W / 2;
    pad.cy = H - safe.b - (padH - safe.b) / 2;
  }

  // ---------- Game state ----------
  const S = {
    mode: 'menu',          // menu | play | paused | dying | over
    demo: true,
    x: 0, y: 0, ang: -Math.PI / 2, target: -Math.PI / 2,
    path: [],              // oldest first; head is S.x,S.y
    len: START_LEN, targetLen: START_LEN,
    speed: BASE_SPEED,
    score: 0, eaten: 0,
    best: parseInt(store.get('snuske.best', '0'), 10) || 0,
    food: null, gold: null,
    particles: [], popups: [],
    bulge: 0, mouth: 0, shake: 0, dieT: 0, deathBy: '',
    time: 0,
  };

  function reset(demo) {
    S.demo = demo;
    S.x = cols / 2; S.y = rows * 0.62;
    S.ang = S.target = -Math.PI / 2;
    S.path = [];
    for (let i = 30; i > 0; i--) S.path.push({ x: S.x, y: S.y + i * 0.12 });
    S.len = S.targetLen = START_LEN;
    S.speed = BASE_SPEED;
    S.score = 0; S.eaten = 0;
    S.gold = null; S.particles = []; S.popups = [];
    S.bulge = 0; S.mouth = 0; S.shake = 0; S.dieT = 0;
    S.food = spawnPouch(false);
    el.score.textContent = '0';
  }

  // Walk along the body from the head back, calling cb at fixed spacing.
  function walk(spacing, start, maxLen, cb) {
    const p = S.path;
    let px = S.x, py = S.y, d = 0, next = start;
    for (let k = p.length - 1; k >= 0; k--) {
      const qx = p[k].x, qy = p[k].y;
      const seg = Math.hypot(qx - px, qy - py);
      if (seg > 0) {
        while (next <= d + seg && next <= maxLen) {
          const t = (next - d) / seg;
          if (cb(px + (qx - px) * t, py + (qy - py) * t, next, Math.atan2(py - qy, px - qx)) === false) return;
          next += spacing;
        }
      }
      d += seg; px = qx; py = qy;
      if (next > maxLen) return;
    }
  }

  function trimPath() {
    const p = S.path, keep = S.len + 1;
    let px = S.x, py = S.y, d = 0;
    for (let k = p.length - 1; k >= 0; k--) {
      d += Math.hypot(p[k].x - px, p[k].y - py);
      px = p[k].x; py = p[k].y;
      if (d > keep) { if (k > 0) p.splice(0, k); return; }
    }
  }

  function spawnPouch(gold) {
    const m = 0.9;
    for (let tries = 0; tries < 80; tries++) {
      const x = m + Math.random() * (cols - 2 * m);
      const y = m + Math.random() * (rows - 2 * m);
      if (Math.hypot(x - S.x, y - S.y) < 3) continue;
      if (S.food && Math.hypot(x - S.food.x, y - S.food.y) < 2) continue;
      let clear = true;
      walk(0.5, 0, S.len, (bx, by) => { if (Math.hypot(bx - x, by - y) < 1.3) { clear = false; return false; } });
      if (clear) return { x, y, rot: (Math.random() - 0.5) * 1.2, born: S.time, gold, life: gold ? GOLD_LIFE : Infinity };
    }
    return { x: cols / 2, y: rows / 3, rot: 0, born: S.time, gold, life: gold ? GOLD_LIFE : Infinity };
  }

  // ---------- Input ----------
  const stick = { id: null, ox: 0, oy: 0, x: 0, y: 0, active: false };
  const STICK_R = 56, DEADZONE = 8;
  const keys = new Set();

  function onDown(e) {
    if (S.mode !== 'play' || stick.id !== null) return;
    stick.id = e.pointerId; stick.active = true;
    stick.ox = stick.x = e.clientX; stick.oy = stick.y = e.clientY;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    audio();
  }
  function onMove(e) {
    if (e.pointerId !== stick.id) return;
    stick.x = e.clientX; stick.y = e.clientY;
    let dx = stick.x - stick.ox, dy = stick.y - stick.oy;
    const m = Math.hypot(dx, dy);
    if (m > STICK_R) { // drag the base along so reversing is quick
      stick.ox = stick.x - dx / m * STICK_R; stick.oy = stick.y - dy / m * STICK_R;
      dx = stick.x - stick.ox; dy = stick.y - stick.oy;
    }
    if (m > DEADZONE) S.target = Math.atan2(dy, dx);
  }
  function onUp(e) {
    if (e.pointerId !== stick.id) return;
    stick.id = null; stick.active = false;
  }
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  window.addEventListener('contextmenu', (e) => e.preventDefault());

  const KEYMAP = { ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1], ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0] };
  function keyDir() {
    let dx = 0, dy = 0;
    keys.forEach((k) => { dx += KEYMAP[k][0]; dy += KEYMAP[k][1]; });
    if (dx || dy) S.target = Math.atan2(dy, dx);
  }
  window.addEventListener('keydown', (e) => {
    if (KEYMAP[e.code]) { keys.add(e.code); keyDir(); e.preventDefault(); }
    else if (e.code === 'Space' || e.code === 'Enter') {
      if (S.mode === 'menu' || S.mode === 'over') startGame();
      else if (S.mode === 'paused') resume();
      e.preventDefault();
    } else if (e.code === 'Escape' || e.code === 'KeyP') {
      if (S.mode === 'play') pause(); else if (S.mode === 'paused') resume();
    }
  });
  window.addEventListener('keyup', (e) => { if (keys.delete(e.code)) keyDir(); });

  // ---------- Flow ----------
  const show = (node, on) => node.classList.toggle('hidden', !on);

  function startGame() {
    audio(); sfx.start();
    layout(false);
    reset(false);
    S.mode = 'play';
    show(el.menu, false); show(el.over, false); show(el.paused, false); show(el.hud, true);
    el.best.textContent = S.best;
  }
  function pause() {
    if (S.mode !== 'play') return;
    S.mode = 'paused'; stick.id = null; stick.active = false;
    show(el.paused, true);
  }
  function resume() {
    if (S.mode !== 'paused') return;
    sfx.click();
    S.mode = 'play'; show(el.paused, false);
  }
  function toMenu() {
    S.mode = 'menu';
    show(el.paused, false); show(el.over, false); show(el.hud, false); show(el.menu, true);
    el.menuBest.textContent = S.best;
    layout(false); reset(true);
    loadBoard($('menuBoard'), 5);
  }

  const WALL_LINES = [['Faceplant!', 'You ran into the wall.'], ['Bonk!', 'Walls don\'t taste like pouches.'], ['Splat!', 'That wall came out of nowhere.']];
  const SELF_LINES = [['Ouch!', 'You bit yourself.'], ['Nom... wait.', 'That was your own leg.'], ['Tangled!', 'You tied yourself in a knot.']];

  function die(by) {
    S.mode = 'dying'; S.dieT = 0; S.shake = 1; S.deathBy = by;
    stick.id = null; stick.active = false;
    sfx.die(); buzz([50, 40, 90]);
    burst(S.x, S.y, 18, ['#f4efe6', COLORS.shirtA, COLORS.skin]);
  }
  function gameOver() {
    S.mode = 'over';
    const isBest = S.score > S.best;
    if (isBest) { S.best = S.score; store.set('snuske.best', String(S.best)); }
    const lines = S.deathBy === 'wall' ? WALL_LINES : SELF_LINES;
    const [title, sub] = lines[Math.floor(Math.random() * lines.length)];
    el.overTitle.textContent = title; el.overSub.textContent = sub;
    el.finalScore.textContent = S.score; el.finalBest.textContent = S.best;
    show(el.newBest, isBest && S.score > 0);
    show(el.hud, false); show(el.over, true);
    submitScore(S.score);
  }

  $('playBtn').addEventListener('click', startGame);
  $('againBtn').addEventListener('click', startGame);
  $('resumeBtn').addEventListener('click', resume);
  $('quitBtn').addEventListener('click', () => { sfx.click(); toMenu(); });
  $('pauseBtn').addEventListener('click', () => { sfx.click(); pause(); });
  el.muteBtn.addEventListener('click', () => {
    muted = !muted; store.set('snuske.muted', muted ? '1' : '0'); renderMute();
    if (!muted) sfx.click();
  });
  $('shareBtn').addEventListener('click', async () => {
    const url = location.origin + location.pathname; // never includes the tag
    const text = `I ate ${S.score} pouch${S.score === 1 ? '' : 'es'} in Snuske. Beat that.`;
    try {
      if (navigator.share) { await navigator.share({ title: 'Snuske', text, url }); return; }
      await navigator.clipboard.writeText(`${text} ${url}`);
      toast('Copied to clipboard');
    } catch { /* user cancelled */ }
  });
  let toastT = 0;
  function toast(msg) {
    el.toast.textContent = msg; el.toast.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => el.toast.classList.remove('show'), 1600);
  }

  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('blur', pause);
  window.addEventListener('resize', () => layout(S.mode !== 'menu'));

  // ---------- Effects ----------
  function burst(x, y, n, palette) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = 1.5 + Math.random() * 4;
      S.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5 + Math.random() * 0.4, t: 0, r: 0.08 + Math.random() * 0.12, c: palette[i % palette.length] });
    }
  }
  function popup(x, y, text, color) { S.popups.push({ x, y, text, color, t: 0 }); }

  // ---------- Update ----------
  const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

  function autopilot() {
    const f = S.food;
    let t = Math.atan2(f.y - S.y, f.x - S.x);
    const look = 2.2, nx = S.x + Math.cos(S.ang) * look, ny = S.y + Math.sin(S.ang) * look;
    if (nx < 1 || nx > cols - 1 || ny < 1 || ny > rows - 1) t = Math.atan2(rows / 2 - S.y, cols / 2 - S.x);
    S.target = t + Math.sin(S.time * 1.7) * 0.35;
  }

  function update(dt) {
    S.time += dt;
    const live = S.mode === 'play' || (S.mode === 'menu' && S.demo);

    if (live) {
      if (S.demo) autopilot();
      const diff = wrap(S.target - S.ang), maxTurn = TURN_RATE * dt;
      S.ang = wrap(S.ang + Math.max(-maxTurn, Math.min(maxTurn, diff)));
      S.x += Math.cos(S.ang) * S.speed * dt;
      S.y += Math.sin(S.ang) * S.speed * dt;

      const last = S.path[S.path.length - 1];
      if (!last || Math.hypot(S.x - last.x, S.y - last.y) >= 0.08) S.path.push({ x: S.x, y: S.y });
      S.len += (S.targetLen - S.len) * Math.min(1, dt * 4);
      trimPath();

      // Food
      const tryEat = (f) => f && Math.hypot(f.x - S.x, f.y - S.y) < 0.85;
      if (tryEat(S.food)) eat(S.food);
      if (tryEat(S.gold)) eat(S.gold);
      if (S.gold && S.time - S.gold.born > S.gold.life) {
        burst(S.gold.x, S.gold.y, 6, [COLORS.gold]);
        S.gold = null;
      }
      const near = [S.food, S.gold].some((f) => f && Math.hypot(f.x - S.x, f.y - S.y) < 2.3);
      S.mouth += ((near ? 1 : 0) - S.mouth) * Math.min(1, dt * 10);

      // Collisions
      if (S.demo) {
        S.x = Math.max(0.5, Math.min(cols - 0.5, S.x));
        S.y = Math.max(0.5, Math.min(rows - 0.5, S.y));
      } else {
        const r = HEAD_R * 0.75;
        if (S.x < r || S.y < r || S.x > cols - r || S.y > rows - r) {
          S.x = Math.max(r, Math.min(cols - r, S.x)); S.y = Math.max(r, Math.min(rows - r, S.y));
          die('wall');
        } else {
          let hit = false;
          walk(0.25, 1.0, S.len, (bx, by) => { if (Math.hypot(bx - S.x, by - S.y) < 0.62) { hit = true; return false; } });
          if (hit) die('self');
        }
      }
    }

    if (S.mode === 'dying') {
      S.dieT += dt;
      if (S.dieT > 1.0) gameOver();
    }

    S.bulge = Math.max(0, S.bulge - dt * 2.2);
    S.shake = Math.max(0, S.shake - dt * 2.5);
    for (const p of S.particles) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.9; p.vy *= 0.9; }
    S.particles = S.particles.filter((p) => p.t < p.life);
    for (const p of S.popups) { p.t += dt; p.y -= dt * 1.4; }
    S.popups = S.popups.filter((p) => p.t < 0.9);
  }

  function eat(f) {
    const pts = f.gold ? 5 : 1;
    S.bulge = 1;
    S.targetLen += f.gold ? GROW_PER_GOLD : GROW_PER_POUCH;
    burst(f.x, f.y, f.gold ? 16 : 9, f.gold ? [COLORS.gold, '#fff3c4'] : [COLORS.pouch, COLORS.beanie]);
    if (f.gold) S.gold = null; else S.food = null;

    if (!S.demo) {
      S.score += pts; S.eaten++;
      S.speed = Math.min(MAX_SPEED, BASE_SPEED + S.eaten * SPEED_PER_POUCH);
      el.score.textContent = S.score;
      if (S.score > S.best) el.best.textContent = S.score;
      popup(f.x, f.y - 0.4, '+' + pts, f.gold ? COLORS.gold : COLORS.shirtB);
      if (f.gold) { sfx.gold(); buzz([20, 30, 20]); } else { sfx.eat(); buzz(15); }
      if (!f.gold && S.eaten % GOLD_EVERY === 0 && !S.gold) S.gold = spawnPouch(true);
    }
    if (!S.food) S.food = spawnPouch(false);
  }

  // ---------- Render ----------
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function circle(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); }

  function drawArena() {
    ctx.fillStyle = COLORS.arena;
    roundRect(arena.x - 4, arena.y - 4, arena.w + 8, arena.h + 8, 14); ctx.fill();
    ctx.strokeStyle = COLORS.arenaEdge; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = COLORS.dot;
    const s = Math.max(1.5, cell * 0.08);
    for (let i = 1; i < cols; i++) for (let j = 1; j < rows; j++) ctx.fillRect(arena.x + i * cell - s / 2, arena.y + j * cell - s / 2, s, s);
  }

  function drawPouch(f) {
    const age = S.time - f.born;
    const appear = Math.min(1, age * 5);
    const bob = 1 + Math.sin(S.time * 4 + f.x) * 0.04;
    let alpha = 1;
    if (f.gold) {
      const left = f.life - age;
      if (left < 2) alpha = 0.45 + 0.55 * Math.abs(Math.sin(left * 9));
    }
    ctx.save();
    ctx.translate(f.x, f.y); ctx.rotate(f.rot); ctx.scale(appear * bob, appear * bob);
    ctx.globalAlpha = alpha;
    if (f.gold) {
      const g = ctx.createRadialGradient(0, 0, 0.1, 0, 0, 1.3);
      g.addColorStop(0, 'rgba(255,204,77,.55)'); g.addColorStop(1, 'rgba(255,204,77,0)');
      ctx.fillStyle = g; circle(0, 0, 1.3); ctx.fill();
    }
    ctx.fillStyle = 'rgba(0,0,0,.25)'; roundRect(-0.46, -0.27 + 0.1, 0.92, 0.56, 0.22); ctx.fill();
    ctx.fillStyle = f.gold ? COLORS.gold : COLORS.pouch;
    ctx.strokeStyle = f.gold ? COLORS.goldEdge : COLORS.pouchEdge; ctx.lineWidth = 0.06;
    roundRect(-0.46, -0.3, 0.92, 0.56, 0.22); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = f.gold ? 'rgba(196,141,18,.5)' : COLORS.pouchSeam; ctx.lineWidth = 0.05;
    ctx.setLineDash([0.06, 0.08]);
    ctx.beginPath(); ctx.moveTo(-0.32, -0.02); ctx.lineTo(0.32, -0.02); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,.6)'; roundRect(-0.34, -0.22, 0.3, 0.08, 0.04); ctx.fill();
    ctx.restore();

    if (f.gold) { // countdown ring
      const left = Math.max(0, 1 - age / f.life);
      ctx.strokeStyle = 'rgba(255,204,77,.8)'; ctx.lineWidth = 0.07;
      ctx.beginPath(); ctx.arc(f.x, f.y, 0.78, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left); ctx.stroke();
    }
  }

  function drawDude() {
    const dead = S.mode === 'dying' || S.mode === 'over';
    // Sample body points from head back to tail.
    const pts = [];
    walk(0.22, 0.3, S.len, (x, y, d, a) => { pts.push({ x, y, d, a }); });
    if (!pts.length) return;
    const tail = pts[pts.length - 1];
    const pantsFrom = Math.max(0.9, S.len - 1.25);

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,.22)';
    for (let i = pts.length - 1; i >= 0; i--) { circle(pts[i].x + 0.08, pts[i].y + 0.12, BODY_R); ctx.fill(); }
    circle(S.x + 0.08, S.y + 0.12, HEAD_R); ctx.fill();

    // Shoes (behind the body)
    drawShoes(tail);

    // Outline pass, then fill pass gives one clean tube
    ctx.fillStyle = COLORS.outline;
    for (let i = pts.length - 1; i >= 0; i--) { circle(pts[i].x, pts[i].y, BODY_R + 0.06); ctx.fill(); }
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      ctx.fillStyle = p.d >= pantsFrom ? COLORS.pants : (Math.floor(p.d / 0.66) % 2 ? COLORS.shirtB : COLORS.shirtA);
      circle(p.x, p.y, BODY_R); ctx.fill();
    }
    // Belt line
    walk(1, pantsFrom, pantsFrom, (x, y, d, a) => {
      ctx.strokeStyle = COLORS.outline; ctx.lineWidth = 0.08;
      const nx = Math.cos(a + Math.PI / 2) * BODY_R, ny = Math.sin(a + Math.PI / 2) * BODY_R;
      ctx.beginPath(); ctx.moveTo(x - nx, y - ny); ctx.lineTo(x + nx, y + ny); ctx.stroke();
    });

    // Hands near the shoulders, swinging as he moves
    walk(1, 0.75, 0.75, (x, y, d, a) => {
      const swing = dead ? 0 : Math.sin(S.time * 10) * 0.18;
      for (const side of [-1, 1]) {
        const ang = a + side * (Math.PI / 2 + 0.35 + side * swing);
        const hx = x + Math.cos(ang) * 0.55, hy = y + Math.sin(ang) * 0.55;
        ctx.fillStyle = COLORS.outline; circle(hx, hy, 0.17); ctx.fill();
        ctx.fillStyle = COLORS.skin; circle(hx, hy, 0.12); ctx.fill();
      }
    });

    drawHead(dead);
  }

  function drawShoes(tail) {
    const a = tail.a, back = a + Math.PI;
    for (const side of [-1, 1]) {
      const step = S.mode === 'play' || S.demo ? Math.sin(S.time * 10 + (side > 0 ? 0 : Math.PI)) * 0.1 : 0;
      const sx = tail.x + Math.cos(back) * (0.42 + step) + Math.cos(a + Math.PI / 2) * side * 0.22;
      const sy = tail.y + Math.sin(back) * (0.42 + step) + Math.sin(a + Math.PI / 2) * side * 0.22;
      ctx.save(); ctx.translate(sx, sy); ctx.rotate(back);
      ctx.fillStyle = COLORS.outline; roundRect(-0.16, -0.17, 0.46, 0.34, 0.16); ctx.fill();
      ctx.fillStyle = COLORS.shoe; roundRect(-0.12, -0.13, 0.38, 0.26, 0.12); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.fillRect(-0.09, -0.13, 0.06, 0.26);
      ctx.restore();
    }
  }

  function drawHead(dead) {
    const wob = 1 + S.bulge * 0.12;
    ctx.save();
    ctx.translate(S.x, S.y); ctx.rotate(S.ang); ctx.scale(wob, 1 / wob * 1.06);

    // Face
    ctx.fillStyle = COLORS.outline; circle(0, 0, HEAD_R + 0.07); ctx.fill();
    ctx.fillStyle = COLORS.skin; circle(0, 0, HEAD_R); ctx.fill();

    // Beanie over the back half
    ctx.fillStyle = COLORS.beanie;
    ctx.beginPath(); ctx.arc(0, 0, HEAD_R + 0.02, Math.PI / 2 + 0.12, Math.PI * 1.5 - 0.12); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = COLORS.beanieCuff; ctx.lineWidth = 0.15;
    ctx.beginPath(); ctx.moveTo(-0.08, -HEAD_R + 0.04); ctx.quadraticCurveTo(0.06, 0, -0.08, HEAD_R - 0.04); ctx.stroke();
    ctx.fillStyle = COLORS.outline; circle(-HEAD_R - 0.05, 0, 0.2); ctx.fill();
    ctx.fillStyle = COLORS.pom; circle(-HEAD_R - 0.05, 0, 0.15); ctx.fill();

    // Eyes
    const look = Math.max(-0.05, Math.min(0.05, wrap(S.target - S.ang) * 0.08));
    for (const side of [-1, 1]) {
      const ex = 0.2, ey = side * 0.21;
      if (dead) {
        ctx.strokeStyle = COLORS.outline; ctx.lineWidth = 0.07; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(ex - 0.08, ey - 0.08); ctx.lineTo(ex + 0.08, ey + 0.08);
        ctx.moveTo(ex + 0.08, ey - 0.08); ctx.lineTo(ex - 0.08, ey + 0.08); ctx.stroke();
      } else {
        ctx.fillStyle = '#fff'; circle(ex, ey, 0.13); ctx.fill();
        ctx.fillStyle = COLORS.outline; circle(ex + 0.05, ey + look, 0.07); ctx.fill();
      }
    }

    // Snus bulge under the upper lip
    const lump = 0.07 + S.bulge * 0.07;
    ctx.fillStyle = COLORS.skinShade; circle(0.43, -0.1, lump + 0.02); ctx.fill();
    ctx.fillStyle = COLORS.skin; circle(0.42, -0.1, lump); ctx.fill();

    // Mouth: opens as a pouch gets close, chomps when eating
    const open = dead ? 0.2 : Math.max(S.mouth * 0.9, S.bulge > 0.6 ? 1 - S.bulge : 0);
    ctx.fillStyle = COLORS.outline;
    ctx.beginPath(); ctx.ellipse(0.42, 0.05, 0.06 + open * 0.08, 0.1 + open * 0.08, 0, 0, Math.PI * 2); ctx.fill();
    if (open > 0.3) { ctx.fillStyle = COLORS.lip; circle(0.44, 0.08, 0.05 * open); ctx.fill(); }

    ctx.restore();
  }

  function drawStick() {
    if (stick.active) {
      const dx = stick.x - stick.ox, dy = stick.y - stick.oy, m = Math.hypot(dx, dy) || 1;
      const k = Math.min(m, STICK_R) / m;
      ctx.fillStyle = 'rgba(244,239,230,.07)'; ctx.strokeStyle = 'rgba(244,239,230,.22)'; ctx.lineWidth = 2;
      circle(stick.ox, stick.oy, STICK_R + 6); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(95,211,176,.85)'; circle(stick.ox + dx * k, stick.oy + dy * k, 26); ctx.fill();
    } else if (pad.show && S.mode === 'play') {
      ctx.strokeStyle = 'rgba(244,239,230,.12)'; ctx.lineWidth = 2;
      circle(pad.cx, pad.cy, STICK_R + 6); ctx.stroke();
      ctx.fillStyle = 'rgba(244,239,230,.1)'; circle(pad.cx, pad.cy, 26); ctx.fill();
      if (S.score === 0) {
        ctx.fillStyle = 'rgba(143,163,189,.75)'; ctx.font = '700 13px system-ui, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('DRAG ANYWHERE TO STEER', pad.cx, pad.cy + STICK_R + 30);
      }
    }
  }

  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = COLORS.bg; ctx.fillRect(0, 0, W, H);

    const sh = S.shake * 8;
    ctx.save();
    if (sh) ctx.translate((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh);
    drawArena();

    ctx.save();
    ctx.translate(arena.x, arena.y); ctx.scale(cell, cell);
    ctx.beginPath(); ctx.rect(-0.1, -0.1, cols + 0.2, rows + 0.2); ctx.clip();
    if (S.food) drawPouch(S.food);
    if (S.gold) drawPouch(S.gold);
    drawDude();
    for (const p of S.particles) {
      ctx.globalAlpha = 1 - p.t / p.life; ctx.fillStyle = p.c;
      circle(p.x, p.y, p.r); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    ctx.textAlign = 'center';
    ctx.font = `900 ${Math.round(cell * 0.8)}px system-ui, sans-serif`;
    for (const p of S.popups) {
      ctx.globalAlpha = 1 - p.t / 0.9; ctx.fillStyle = p.color;
      ctx.fillText(p.text, arena.x + p.x * cell, arena.y + p.y * cell);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    drawStick();
  }

  // ---------- Loop ----------
  let lastT = performance.now();
  function frame(now) {
    const dt = Math.min(1 / 30, (now - lastT) / 1000);
    lastT = now;
    if (S.mode !== 'paused') update(dt);
    render();
    requestAnimationFrame(frame);
  }

  // ---------- Online leaderboard (optional; the game works without it) ----------
  const LB = window.Samdw || null;
  const GAME_ID = 'snuske';
  let playerName = null;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function renderBoard(box, rows) {
    const ol = box.querySelector('ol');
    ol.innerHTML = rows && rows.length
      ? rows.map((r) => `<li class="${r.me ? 'me' : ''}"><span class="r">${r.rank}</span><span class="n">${esc(r.name)}</span><span class="s">${r.best}</span></li>`).join('')
      : '<li class="empty">No scores yet. Be the first!</li>';
    show(box, true);
  }
  async function loadBoard(box, limit) {
    if (!LB || !(await LB.online)) return;
    try { renderBoard(box, await LB.rpc('leaderboard', { p_game: GAME_ID, p_limit: limit, p_tag: LB.tag })); } catch { /* offline */ }
  }
  function renderWho() {
    const who = $('menuWho');
    if (LB.tag && playerName) {
      who.innerHTML = `Playing as <b>${esc(playerName)}</b><button type="button" id="notMe">not you?</button>`;
      $('notMe').addEventListener('click', () => { LB.forgetTag(); playerName = null; renderWho(); loadBoard($('menuBoard'), 5); });
    } else {
      who.textContent = 'Tap a sticker to join the leaderboard';
    }
  }
  async function initOnline() {
    if (!LB || !(await LB.online)) return;
    if (LB.tag) {
      try {
        const p = await LB.rpc('player', { p_tag: LB.tag, p_game: GAME_ID });
        if (p && p.name) {
          playerName = p.name;
          if (p.best > S.best) { S.best = p.best; store.set('snuske.best', String(S.best)); el.menuBest.textContent = S.best; }
        } else {
          LB.forgetTag(); // tag was deleted or never existed
        }
      } catch { /* offline: keep the tag, try again next load */ }
    }
    renderWho();
    loadBoard($('menuBoard'), 5);
  }
  async function submitScore(score) {
    const line = $('rankLine'), board = $('overBoard');
    line.textContent = ''; line.style.color = '';
    show(board, false);
    if (!LB || !(await LB.online)) return;
    if (!LB.tag || !playerName) {
      line.textContent = 'Tap a sticker to get on the leaderboard'; line.style.color = 'var(--muted)';
    } else if (score > 0) {
      line.textContent = 'Saving...';
      try {
        const r = await LB.rpc('submit_score', { p_tag: LB.tag, p_score: score, p_game: GAME_ID });
        line.textContent = r.error ? '' : (r.new_best ? `New personal best! #${r.rank} of ${r.total}` : `You're #${r.rank} of ${r.total}`);
      } catch {
        line.textContent = 'Offline: score not saved'; line.style.color = 'var(--muted)';
      }
    }
    loadBoard(board, 5);
  }

  // ---------- Boot ----------
  renderMute();
  el.menuBest.textContent = S.best;
  layout(false);
  reset(true);
  requestAnimationFrame(frame);
  initOnline();
})();
