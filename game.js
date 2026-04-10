/* ============================================================
   Big Back Crossing — Game Engine
   Pure HTML5 Canvas + Vanilla JS. Zero external dependencies.
   ============================================================ */

// ── Polyfill: roundRect (Chrome 99+, FF 112+, Safari 15.4+; add safety shim) ──
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h, r = 0) {
    const rr = Math.min(r, w / 2, h / 2);
    this.beginPath();
    this.moveTo(x + rr, y);
    this.arcTo(x + w, y, x + w, y + h, rr);
    this.arcTo(x + w, y + h, x, y + h, rr);
    this.arcTo(x, y + h, x, y, rr);
    this.arcTo(x, y, x + w, y, rr);
    this.closePath();
  };
}

// ============================================================
// BRANDING — Edit these to customize / rebrand the game
// ============================================================
const BRAND = {
  GAME_TITLE:     'Big Back Crossing',
  CHARACTER_NAME: 'BigBack Benny',
  SHARE_URL:      'bigbackcat.fun',
  SHARE_MESSAGE:  (score) => `I scored ${score} points on Big Back Crossing! 🐱🍔 Play at bigbackcat.fun`,
  BG_COLOR:       '#2d5a1b',   // grass color
  ROAD_COLOR:     '#4a4a4a',   // road color
};

// ============================================================
// GAME CONFIGURATION
// ============================================================
const CFG = {
  TILE:           64,      // logical tile size in pixels
  COLS:           9,       // visible columns
  CAM_ROW_OFFSET: 4,       // rows below player kept visible
  LANE_GROUPS:    [        // lane group patterns (road count, grass count)
    { road: 1, grass: 2 },
    { road: 2, grass: 2 },
    { road: 2, grass: 1 },
    { road: 3, grass: 2 },
    { road: 3, grass: 1 },
  ],

  // Player
  PLAYER_BASE_SPEED:   160,  // px/sec base move animation speed
  PLAYER_BASE_SIZE:    0.42, // fraction of tile
  CHONK_SIZE_GAIN:     0.06, // size increase per chonk level
  CHONK_SPEED_PENALTY: 0.10, // animation speed multiplier penalty per level
  MAX_CHONK:           10,
  MOVE_COOLDOWN:       180,  // ms minimum between moves at chonk 0 (keyboard)
  MOVE_COOLDOWN_TOUCH: 250,  // ms minimum between moves on touch devices

  // Dash
  DASH_DURATION:    1000, // ms
  DASH_COOLDOWN:    200,  // ms extra gap after dash

  // Collectible score values
  BURGER_SCORE:   5,
  TACO_SCORE:     8,
  PIZZA_SCORE:    10,
  SPECIAL_SCORE:  15,

  // Progressive difficulty: obstacle speed multiplier = 1 + score/DIFF_RATE
  DIFF_RATE:      120,

  // World generation seed helpers
  MIN_OBS_PER_LANE:       2,
  MAX_OBS_PER_LANE:       5,
  MOBILE_MAX_OBS_PER_LANE: 3,   // cap on narrow screens (<600px wide)
  MOBILE_WIDTH_THRESHOLD: 600,  // px — screen width below which mobile caps apply

  // Touch / swipe input guards
  DPAD_SWIPE_DEBOUNCE_MS: 400,  // ms — ignore swipe if D-pad was tapped recently
  MIN_SWIPE_DISTANCE:     40,   // px — minimum travel to register as a swipe

  // During a dash, skip the move cooldown by this multiplier
  // (set high so Benny can move without waiting for chonk cooldown)
  DASH_COOLDOWN_SKIP: 4,
};

// ============================================================
// CHONK MILESTONES — popup callouts at key chonk levels
// ============================================================
const CHONK_MILESTONES = {
  3:  'Oh, you hungry! 🍔',
  5:  'You tryna be big back! 💪',
  7:  'Keep eating, you got this! 🔥',
  10: 'BIG BACK IS IN THE HOUSE! 👑🐱',
};

// ============================================================
// UTILITY HELPERS
// ============================================================
function rand(min, max) { return min + Math.random() * (max - min); }
function randInt(min, max) { return Math.floor(rand(min, max + 1)); }
function randChoice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

// ============================================================
// AUDIO ENGINE (Web Audio API — synthesized, no files)
// ============================================================
class AudioEngine {
  constructor() {
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      this.ctx = null;
    }
    this.buffers = {};  // cache for decoded AudioBuffer objects
  }

  // Load a sound file and store it in the buffer cache under `name`.
  async loadSound(name, url) {
    if (!this.ctx) return;
    const res  = await fetch(url);
    const data = await res.arrayBuffer();
    this.buffers[name] = await this.ctx.decodeAudioData(data);
  }

  // Play a cached buffer by name.
  _playBuffer(name, vol = 0.5) {
    if (!this.ctx || !this.buffers[name]) return;
    try {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      const source = this.ctx.createBufferSource();
      const gain   = this.ctx.createGain();
      source.buffer = this.buffers[name];
      gain.gain.value = vol;
      source.connect(gain);
      gain.connect(this.ctx.destination);
      source.start(0);
    } catch (e) { /* silent fail */ }
  }

  // Attempt to load all custom sound files from ./sounds/.
  // Each load is wrapped in try/catch so missing files are silently ignored.
  async loadAllSounds() {
    const sounds = [
      ['hop',           './sounds/hop.mp3'],
      ['chomp',         './sounds/chomp.mp3'],
      ['special-chomp', './sounds/special-chomp.mp3'],
      ['sad-trombone',  './sounds/sad-trombone.mp3'],
      ['collect',       './sounds/collect.mp3'],
      ['special',       './sounds/special.mp3'],
      ['squish',        './sounds/squish.mp3'],
      ['dash',          './sounds/dash.mp3'],
    ];
    for (const [name, url] of sounds) {
      try { await this.loadSound(name, url); } catch (e) { /* file not present — use synth fallback */ }
    }
  }

  _beep(freq, type, duration, vol, delay = 0) {
    if (!this.ctx) return;
    try {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      const osc  = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.type      = type;
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime + delay);
      gain.gain.setValueAtTime(vol, this.ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + delay + duration);
      osc.start(this.ctx.currentTime + delay);
      osc.stop(this.ctx.currentTime + delay + duration);
    } catch (e) { /* silent fail */ }
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  hop()       {
    if (this.buffers['hop']) { this._playBuffer('hop', 0.5); return; }
    this._beep(200, 'square', 0.08, 0.15);
  }
  chomp()     {
    if (this.buffers['chomp']) { this._playBuffer('chomp', 0.5); return; }
    // Big exaggerated cartoon "NOM" — layered low-frequency descending tones
    this._beep(180, 'sine',     0.06, 0.35);
    this._beep(120, 'sawtooth', 0.12, 0.40, 0.04);
    this._beep(70,  'sine',     0.25, 0.45, 0.10);
  }
  specialChomp() {
    if (this.buffers['special-chomp']) { this._playBuffer('special-chomp', 0.5); return; }
    // Over-the-top dramatic prize fanfare — ascending jingle
    [330, 415, 494, 659, 880, 1047].forEach((f, i) =>
      this._beep(f, 'sine', 0.13, 0.28, i * 0.07));
  }
  sadTrombone() {
    if (this.buffers['sad-trombone']) { this._playBuffer('sad-trombone', 0.5); return; }
    // "Wah wah waaah" sad trombone — three descending "womp" notes
    this._beep(311, 'sawtooth', 0.18, 0.35, 0.00);
    this._beep(233, 'sawtooth', 0.22, 0.35, 0.20);
    this._beep(155, 'sawtooth', 0.50, 0.35, 0.42);
  }
  collect()   {
    if (this.buffers['collect']) { this._playBuffer('collect', 0.5); return; }
    this._beep(440, 'sine', 0.1, 0.2);
    this._beep(660, 'sine', 0.1, 0.2, 0.08);
    this._beep(880, 'sine', 0.15, 0.2, 0.16);
  }
  special()   {
    if (this.buffers['special']) { this._playBuffer('special', 0.5); return; }
    [440, 550, 660, 880, 1100].forEach((f, i) =>
      this._beep(f, 'sine', 0.12, 0.25, i * 0.07));
  }
  squish()    {
    if (this.buffers['squish']) { this._playBuffer('squish', 0.5); return; }
    this._beep(300, 'sawtooth', 0.05, 0.3);
    this._beep(150, 'sawtooth', 0.15, 0.3, 0.05);
    this._beep(80,  'sawtooth', 0.4,  0.3, 0.10);
  }
  dash()      {
    if (this.buffers['dash']) { this._playBuffer('dash', 0.5); return; }
    [880, 1100, 1320].forEach((f, i) =>
      this._beep(f, 'square', 0.08, 0.15, i * 0.04));
  }
}

// ============================================================
// DRAWING — BigBack Benny (fat orange cat)
// ============================================================
function drawBenny(ctx, cx, cy, size, chonkLevel, state, animT) {
  ctx.save();

  const chonkFactor = 1 + chonkLevel * 0.07;
  const bw = size * chonkFactor;  // body width
  const bh = size * (0.75 + chonkLevel * 0.04); // body height
  const bounce = (state === 'walking') ? Math.sin(animT * 12) * 1.5 : 0;
  const squishX = (state === 'dead') ? 1 + animT * 1.5 : 1;
  const squishY = (state === 'dead') ? Math.max(0.08, 1 - animT * 0.92) : 1;

  ctx.translate(cx, cy + bh * 0.15 + bounce);
  ctx.scale(squishX, squishY);

  // ── Shadow ──
  ctx.save();
  ctx.scale(1, 0.3);
  ctx.beginPath();
  ctx.ellipse(0, bh * 0.55, bw * 0.65, bw * 0.25, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fill();
  ctx.restore();

  // ── Tail ──
  ctx.save();
  const tailWag = (state === 'walking') ? Math.sin(animT * 8) * 0.4 : 0;
  ctx.beginPath();
  ctx.moveTo(bw * 0.45, -bh * 0.1);
  ctx.bezierCurveTo(
    bw * 0.85, -bh * 0.35 + tailWag * 20,
    bw * 0.9,  -bh * 0.6  + tailWag * 15,
    bw * 0.65, -bh * 0.7  + tailWag * 10
  );
  ctx.strokeStyle = '#cc5500';
  ctx.lineWidth   = size * 0.1;
  ctx.lineCap     = 'round';
  ctx.stroke();
  ctx.restore();

  // ── Body (big orange ellipse) ──
  ctx.beginPath();
  ctx.ellipse(0, 0, bw * 0.55, bh * 0.5, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#ff8c00';
  ctx.fill();
  ctx.strokeStyle = '#cc5500';
  ctx.lineWidth   = 2;
  ctx.stroke();

  // ── Belly ──
  ctx.beginPath();
  ctx.ellipse(0, bh * 0.12, bw * 0.32, bh * 0.27, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#ffcc88';
  ctx.fill();

  // ── Chonk stripes ──
  if (chonkLevel >= 3) {
    ctx.beginPath();
    ctx.moveTo(-bw * 0.4, -bh * 0.15);
    ctx.bezierCurveTo(-bw * 0.35, bh * 0.05, -bw * 0.35, bh * 0.05, -bw * 0.4, bh * 0.2);
    ctx.strokeStyle = 'rgba(180,60,0,0.4)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(bw * 0.4, -bh * 0.15);
    ctx.bezierCurveTo(bw * 0.35, bh * 0.05, bw * 0.35, bh * 0.05, bw * 0.4, bh * 0.2);
    ctx.stroke();
  }

  // ── Head ──
  const headR = size * (0.26 + chonkLevel * 0.01);
  const headY = -(bh * 0.48 + headR * 0.55);
  ctx.beginPath();
  ctx.arc(0, headY, headR, 0, Math.PI * 2);
  ctx.fillStyle = '#ff8c00';
  ctx.fill();
  ctx.strokeStyle = '#cc5500';
  ctx.lineWidth   = 1.5;
  ctx.stroke();

  // ── Ears ──
  [[-1, -0.7], [1, -0.7]].forEach(([ex, ey]) => {
    ctx.beginPath();
    ctx.moveTo(ex * headR * 0.5, headY + ey * headR * 0.5);
    ctx.lineTo(ex * headR * 1.1, headY + ey * headR * 1.15);
    ctx.lineTo(ex * headR * 1.2, headY + ey * headR * 0.45);
    ctx.fillStyle = '#ff8c00';
    ctx.fill();
    ctx.strokeStyle = '#cc5500';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // inner ear
    ctx.beginPath();
    ctx.moveTo(ex * headR * 0.55, headY + ey * headR * 0.55);
    ctx.lineTo(ex * headR * 1.0,  headY + ey * headR * 1.0);
    ctx.lineTo(ex * headR * 1.05, headY + ey * headR * 0.55);
    ctx.fillStyle = '#ff6688';
    ctx.fill();
  });

  // ── Eyes ──
  const eyeState = (state === 'dead') ? 'x' : 'normal';
  const eyeScale = Math.min(1, 0.85 + chonkLevel * 0.015); // caps eye growth at high chonk
  const eyeWhiteR = headR * 0.22 * eyeScale;
  const eyePupilR = headR * 0.12 * eyeScale;
  const eyeShineR = headR * 0.045 * eyeScale;
  [[-headR * 0.4, 0], [headR * 0.4, 0]].forEach(([ex, ey]) => {
    ctx.beginPath();
    ctx.arc(ex, headY + ey, eyeWhiteR, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    if (eyeState === 'x') {
      ctx.save();
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ex - headR * 0.12, headY - headR * 0.12);
      ctx.lineTo(ex + headR * 0.12, headY + headR * 0.12);
      ctx.moveTo(ex + headR * 0.12, headY - headR * 0.12);
      ctx.lineTo(ex - headR * 0.12, headY + headR * 0.12);
      ctx.stroke();
      ctx.restore();
    } else {
      // Pupil - keep centered with minimal offset
      ctx.beginPath();
      ctx.arc(ex + headR * 0.02, headY - headR * 0.01, eyePupilR, 0, Math.PI * 2);
      ctx.fillStyle = '#222';
      ctx.fill();
      // shine - stay relative to pupil
      ctx.beginPath();
      ctx.arc(ex + headR * 0.04, headY - headR * 0.04, eyeShineR, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
    }
  });

  // ── Nose ──
  ctx.beginPath();
  ctx.moveTo(-headR * 0.1, headY + headR * 0.15);
  ctx.lineTo( headR * 0.1, headY + headR * 0.15);
  ctx.lineTo( 0,           headY + headR * 0.3);
  ctx.fillStyle = '#ff4488';
  ctx.fill();

  // ── Mouth ──
  ctx.beginPath();
  ctx.moveTo(0, headY + headR * 0.3);
  ctx.quadraticCurveTo(-headR * 0.25, headY + headR * 0.45,
                       -headR * 0.3,  headY + headR * 0.38);
  ctx.moveTo(0, headY + headR * 0.3);
  ctx.quadraticCurveTo( headR * 0.25, headY + headR * 0.45,
                         headR * 0.3, headY + headR * 0.38);
  ctx.strokeStyle = '#cc3366';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // ── Whiskers ──
  [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(([dx, dy]) => {
    ctx.beginPath();
    ctx.moveTo(dx * headR * 0.05, headY + headR * 0.2);
    ctx.lineTo(dx * headR * 0.75, headY + headR * (0.1 + dy * 0.12));
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1;
    ctx.stroke();
  });

  // ── Chonk level indicator (tiny burger icons) ──
  if (chonkLevel > 0 && state !== 'dead') {
    const maxDots = Math.min(chonkLevel, 5);
    for (let i = 0; i < maxDots; i++) {
      ctx.beginPath();
      ctx.arc(-maxDots * 7 / 2 + i * 7, -bh * 0.6, 3, 0, Math.PI * 2);
      ctx.fillStyle = `hsl(${30 + chonkLevel * 8}, 100%, 55%)`;
      ctx.fill();
    }
  }

  ctx.restore();
}

// ── Draw squished Benny (for game over screen) ──
function drawSquishBenny(ctx, cx, cy, width) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, 0.12);
  ctx.beginPath();
  ctx.ellipse(0, 0, width * 0.45, width * 0.45, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#ff8c00';
  ctx.fill();
  ctx.strokeStyle = '#cc5500';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();

  // stars
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const r = width * 0.4;
    const sx = cx + Math.cos(angle) * r;
    const sy = cy + Math.sin(angle) * r * 0.3;
    ctx.save();
    ctx.translate(sx, sy);
    drawStar(ctx, 0, 0, 5, 8, 4, '#ffd700');
    ctx.restore();
  }
}

function drawStar(ctx, cx, cy, spikes, outerR, innerR, color) {
  ctx.beginPath();
  let rot = (Math.PI / 2) * 3;
  const step = Math.PI / spikes;
  ctx.moveTo(cx, cy - outerR);
  for (let i = 0; i < spikes; i++) {
    ctx.lineTo(cx + Math.cos(rot) * outerR, cy + Math.sin(rot) * outerR);
    rot += step;
    ctx.lineTo(cx + Math.cos(rot) * innerR, cy + Math.sin(rot) * innerR);
    rot += step;
  }
  ctx.lineTo(cx, cy - outerR);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

// ============================================================
// DRAWING — Obstacles
// ============================================================
function drawCar(ctx, x, y, w, h, color, dir) {
  ctx.save();
  ctx.translate(x + w / 2, y);

  // Body
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h * 0.6, 4);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = darken(color, 0.3);
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Roof
  ctx.beginPath();
  ctx.roundRect(-w * 0.3, -h / 2 - h * 0.35, w * 0.6, h * 0.38, 4);
  ctx.fillStyle = lighten(color, 0.15);
  ctx.fill();

  // Windows
  ctx.fillStyle = 'rgba(180,220,255,0.8)';
  ctx.beginPath();
  ctx.roundRect(-w * 0.27, -h / 2 - h * 0.32, w * 0.24, h * 0.28, 2);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(w * 0.03, -h / 2 - h * 0.32, w * 0.24, h * 0.28, 2);
  ctx.fill();

  // Wheels
  [-w * 0.3, w * 0.3].forEach(wx => {
    ctx.beginPath();
    ctx.ellipse(wx, h * 0.1, h * 0.22, h * 0.22, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#333';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(wx, h * 0.1, h * 0.1, 0, Math.PI * 2);
    ctx.fillStyle = '#888';
    ctx.fill();
  });

  // Headlights / taillights
  const lightX = dir > 0 ? w / 2 - 3 : -w / 2 + 3;
  ctx.beginPath();
  ctx.ellipse(lightX, -h * 0.1, 4, 3, 0, 0, Math.PI * 2);
  ctx.fillStyle = dir > 0 ? '#fff' : '#ff2200';
  ctx.fill();

  ctx.restore();
}

function drawFoodTruck(ctx, x, y, w, h, color) {
  ctx.save();
  ctx.translate(x + w / 2, y);

  // Main body
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h * 0.75, 5);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = darken(color, 0.3);
  ctx.lineWidth = 2;
  ctx.stroke();

  // Cab
  ctx.beginPath();
  ctx.roundRect(w * 0.2, -h / 2 - h * 0.3, w * 0.28, h * 0.55, 4);
  ctx.fillStyle = lighten(color, 0.2);
  ctx.fill();
  ctx.stroke();

  // Serving window
  ctx.beginPath();
  ctx.roundRect(-w * 0.3, -h / 2 + h * 0.05, w * 0.4, h * 0.28, 3);
  ctx.fillStyle = 'rgba(180,220,255,0.7)';
  ctx.fill();

  // Branding text on truck
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${h * 0.18}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('🍔', 0, -h * 0.05);

  // Wheels
  [-w * 0.35, -w * 0.05, w * 0.28].forEach(wx => {
    ctx.beginPath();
    ctx.ellipse(wx, h * 0.28, h * 0.2, h * 0.2, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#2a2a2a';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(wx, h * 0.28, h * 0.08, 0, Math.PI * 2);
    ctx.fillStyle = '#888';
    ctx.fill();
  });

  ctx.restore();
}

function drawBike(ctx, x, y, w, h, color, dir, animT) {
  ctx.save();
  ctx.translate(x + w / 2, y);

  const wheelR = h * 0.35;
  const wheelY = h * 0.15;
  const spin   = animT * 8;

  // Wheels
  [-w * 0.28, w * 0.28].forEach(wx => {
    ctx.beginPath();
    ctx.arc(wx, wheelY, wheelR, 0, Math.PI * 2);
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 3;
    ctx.stroke();
    // Spoke
    for (let s = 0; s < 4; s++) {
      const a = spin + (s / 4) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(wx, wheelY);
      ctx.lineTo(wx + Math.cos(a) * wheelR * 0.85,
                 wheelY + Math.sin(a) * wheelR * 0.85);
      ctx.strokeStyle = '#666';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  });

  // Frame
  ctx.beginPath();
  ctx.moveTo(-w * 0.28, wheelY);
  ctx.lineTo(0, -h * 0.25);
  ctx.lineTo(w * 0.28, wheelY);
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.stroke();

  // Seat
  ctx.beginPath();
  ctx.moveTo(-w * 0.05, -h * 0.22);
  ctx.lineTo(-w * 0.2, -h * 0.22);
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Handlebars
  ctx.beginPath();
  ctx.moveTo(w * 0.02, -h * 0.18);
  ctx.lineTo(w * 0.18, -h * 0.28);
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 3;
  ctx.stroke();

  // Rider (simple)
  ctx.beginPath();
  ctx.arc(-w * 0.05, -h * 0.45, h * 0.2, 0, Math.PI * 2);
  ctx.fillStyle = dir > 0 ? '#e74c3c' : '#3498db';
  ctx.fill();

  ctx.restore();
}

function drawDonut(ctx, x, y, r, animT) {
  ctx.save();
  ctx.translate(x + r, y);
  ctx.rotate(animT * 3); // rolling rotation

  // Squish from rolling
  const sq = 1 + Math.abs(Math.sin(animT * 6)) * 0.08;
  ctx.scale(1, sq);

  // Outer ring
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = '#c87941';
  ctx.fill();

  // Glaze
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = '#f5b8d0';
  ctx.fill();

  // Hole
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.38, 0, Math.PI * 2);
  ctx.fillStyle = 'transparent';
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fill();
  ctx.restore();

  // Sprinkles
  const sprinkleColors = ['#ff4466', '#44aaff', '#44ff88', '#ffee00'];
  for (let s = 0; s < 7; s++) {
    const a  = (s / 7) * Math.PI * 2 + 0.3;
    const sr = r * 0.65;
    ctx.save();
    ctx.translate(Math.cos(a) * sr, Math.sin(a) * sr);
    ctx.rotate(a + Math.PI / 4);
    ctx.beginPath();
    ctx.roundRect(-2, -5, 4, 10, 2);
    ctx.fillStyle = sprinkleColors[s % sprinkleColors.length];
    ctx.fill();
    ctx.restore();
  }

  ctx.restore();
}

// ============================================================
// DRAWING — Collectibles
// ============================================================
function drawBurger(ctx, cx, cy, size, pulse) {
  const s = size * (0.9 + pulse * 0.1);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s / 40, s / 40);

  // Bottom bun
  ctx.beginPath();
  ctx.ellipse(0, 12, 18, 8, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#d4a017';
  ctx.fill();

  // Patty
  ctx.beginPath();
  ctx.ellipse(0, 5, 17, 6, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#7b3e00';
  ctx.fill();

  // Cheese
  ctx.beginPath();
  ctx.ellipse(0, 0, 18, 5, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#f5a623';
  ctx.fill();

  // Lettuce
  ctx.beginPath();
  ctx.ellipse(0, -5, 19, 5, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#5cb85c';
  ctx.fill();

  // Top bun
  ctx.beginPath();
  ctx.arc(0, -13, 17, Math.PI, 0);
  ctx.lineTo(17, -7);
  ctx.lineTo(-17, -7);
  ctx.closePath();
  ctx.fillStyle = '#d4a017';
  ctx.fill();

  // Sesame seeds
  ctx.fillStyle = '#fff8dc';
  [[-7, -16], [0, -18], [8, -16]].forEach(([sx, sy]) => {
    ctx.beginPath();
    ctx.ellipse(sx, sy, 2.5, 1.5, 0.5, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.restore();
}

function drawTaco(ctx, cx, cy, size, pulse) {
  const s = size * (0.9 + pulse * 0.1);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s / 40, s / 40);

  // Shell
  ctx.beginPath();
  ctx.arc(0, 5, 20, Math.PI, 0);
  ctx.fillStyle = '#f5c842';
  ctx.fill();
  ctx.strokeStyle = '#c8a030';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Fillings
  ctx.beginPath();
  ctx.ellipse(0, 2, 16, 8, 0, Math.PI, 0);
  ctx.fillStyle = '#7b3e00';
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(-4, -2, 6, 4, -0.3, 0, Math.PI * 2);
  ctx.fillStyle = '#5cb85c';
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(4, -3, 5, 4, 0.3, 0, Math.PI * 2);
  ctx.fillStyle = '#ff6347';
  ctx.fill();

  ctx.restore();
}

function drawPizza(ctx, cx, cy, size, pulse) {
  const s = size * (0.9 + pulse * 0.1);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s / 40, s / 40);
  ctx.rotate(0.2);

  // Crust
  ctx.beginPath();
  ctx.moveTo(0, -22);
  ctx.lineTo(-20, 14);
  ctx.lineTo(20, 14);
  ctx.closePath();
  ctx.fillStyle = '#e8a74a';
  ctx.fill();

  // Sauce
  ctx.beginPath();
  ctx.moveTo(0, -16);
  ctx.lineTo(-15, 11);
  ctx.lineTo(15, 11);
  ctx.closePath();
  ctx.fillStyle = '#e03030';
  ctx.fill();

  // Cheese
  ctx.beginPath();
  ctx.moveTo(0, -10);
  ctx.lineTo(-10, 9);
  ctx.lineTo(10, 9);
  ctx.closePath();
  ctx.fillStyle = '#f5d442';
  ctx.fill();

  // Pepperoni
  [[-4, 2], [5, -2], [0, -5]].forEach(([px, py]) => {
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#c0392b';
    ctx.fill();
  });

  ctx.restore();
}

function drawSpecialFood(ctx, cx, cy, size, pulse, time) {
  const s = size * (0.95 + pulse * 0.15);
  ctx.save();
  ctx.translate(cx, cy);

  // Glow effect
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 0.9);
  glow.addColorStop(0,   `hsla(${(time * 60) % 360}, 100%, 70%, 0.7)`);
  glow.addColorStop(0.5, `hsla(${(time * 60 + 120) % 360}, 100%, 60%, 0.3)`);
  glow.addColorStop(1,   'transparent');
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.9, 0, Math.PI * 2);
  ctx.fillStyle = glow;
  ctx.fill();

  // Star
  ctx.scale(s / 40, s / 40);
  ctx.rotate(time * 2);
  drawStar(ctx, 0, 0, 5, 22, 10, `hsl(${(time * 60) % 360}, 100%, 65%)`);

  // Burger in center
  ctx.rotate(-time * 2);
  ctx.scale(0.6, 0.6);
  drawBurger(ctx, 0, 0, 40, 0);

  ctx.restore();
}

// ============================================================
// DRAWING — Lane backgrounds
// ============================================================
function drawGrassTile(ctx, tx, ty, tileSize) {
  ctx.fillStyle = (Math.floor(tx + ty) % 2 === 0) ? '#3d7a24' : '#357020';
  ctx.fillRect(tx * tileSize, ty * tileSize, tileSize, tileSize);

  // Occasional grass tufts
  if ((tx * 7 + ty * 13) % 11 === 0) {
    ctx.fillStyle = '#4d9a30';
    ctx.beginPath();
    const bx = tx * tileSize + tileSize * 0.3;
    const by = ty * tileSize + tileSize * 0.55;
    ctx.moveTo(bx, by);
    ctx.lineTo(bx - 5, by - 12);
    ctx.lineTo(bx + 2, by - 8);
    ctx.lineTo(bx + 4, by - 15);
    ctx.lineTo(bx + 9, by - 6);
    ctx.fill();
  }
}

function drawRoadLane(ctx, laneY, canvasW, tileSize) {
  ctx.fillStyle = '#555';
  ctx.fillRect(0, laneY * tileSize, canvasW, tileSize);

  // Lane markings
  ctx.setLineDash([20, 15]);
  ctx.strokeStyle = 'rgba(255,255,230,0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  const my = laneY * tileSize + tileSize / 2;
  ctx.moveTo(0, my);
  ctx.lineTo(canvasW, my);
  ctx.stroke();
  ctx.setLineDash([]);

  // Road texture (use abs to avoid negative modulo)
  const absLane = Math.abs(laneY);
  ctx.fillStyle = 'rgba(0,0,0,0.07)';
  for (let s = 0; s < 4; s++) {
    const sx = ((absLane * 29 + s * 73) % canvasW + canvasW) % canvasW;
    ctx.fillRect(sx, laneY * tileSize + 2, 40 + (s * 17 % 30), 3);
    ctx.fillRect(sx + 20, laneY * tileSize + tileSize - 6, 30, 3);
  }
}

// ============================================================
// COLOR HELPERS
// ============================================================
function darken(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, (n >> 16) - Math.round(amt * 255));
  const g = Math.max(0, ((n >> 8) & 0xff) - Math.round(amt * 255));
  const b = Math.max(0, (n & 0xff) - Math.round(amt * 255));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
function lighten(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, (n >> 16) + Math.round(amt * 255));
  const g = Math.min(255, ((n >> 8) & 0xff) + Math.round(amt * 255));
  const b = Math.min(255, (n & 0xff) + Math.round(amt * 255));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

// ============================================================
// LANE GENERATOR
// ============================================================
class LaneGen {
  constructor() {
    this.next = 3; // next lane index to generate
    this.lanes = {}; // map: laneIndex → laneData
    // Safe starting lanes
    for (let i = 0; i < 3; i++) this.lanes[i] = { type: 'grass' };
    this._groupIdx  = 0;
    this._groupRoad = 0;
    this._groupGrass = 0;
    this._inRoad    = false;
    this._count     = 0;
  }

  getLane(idx) {
    while (idx >= this.next) this._generate();
    return this.lanes[idx];
  }

  _generate() {
    const idx   = this.next++;
    const group = CFG.LANE_GROUPS[this._groupIdx % CFG.LANE_GROUPS.length];

    if (!this._inRoad && this._count < group.grass) {
      this.lanes[idx] = { type: 'grass' };
      this._count++;
      if (this._count >= group.grass) { this._inRoad = true; this._count = 0; }
    } else if (this._inRoad && this._count < group.road) {
      const dir   = Math.random() < 0.5 ? 1 : -1;
      const speedScale = Math.min(1, Math.max(window.innerWidth, 1) / 900);
      const speed = rand(80, 200) * speedScale;
      const obsTypes = ['car', 'car', 'car', 'bike', 'donut',
                        ...(this._groupIdx > 2 ? ['truck'] : [])];
      this.lanes[idx] = {
        type:    'road',
        dir,
        speed,
        obsType: randChoice(obsTypes),
        numObs:  randInt(CFG.MIN_OBS_PER_LANE, CFG.MAX_OBS_PER_LANE),
      };
      this._count++;
      if (this._count >= group.road) {
        this._inRoad = false; this._count = 0; this._groupIdx++;
      }
    }
  }
}

// ============================================================
// OBSTACLE
// ============================================================
const OBS_SIZES = {
  car:   { w: 90,  h: 44 },
  truck: { w: 160, h: 54 },
  bike:  { w: 60,  h: 44 },
  donut: { w: 38,  h: 38 },
};

const CAR_COLORS = ['#e74c3c','#3498db','#2ecc71','#9b59b6','#f39c12','#1abc9c','#e67e22'];

class Obstacle {
  constructor(laneIdx, laneData, canvasW, tileSize, score) {
    this.laneIdx  = laneIdx;
    this.type     = laneData.obsType || 'car';
    this.dir      = laneData.dir;
    const diff    = 1 + score / CFG.DIFF_RATE;
    this.speed    = laneData.speed * diff;
    this.tileSize = tileSize;
    this.canvasW  = canvasW;

    const s = OBS_SIZES[this.type] || OBS_SIZES.car;
    this.w = s.w;
    this.h = s.h;

    // World y: lane center at -laneIdx * T + T/2; obstacle top = center - h/2
    this.y     = -laneIdx * tileSize + tileSize / 2 - this.h / 2;
    // x is set by _spawnObstaclesForLane after construction
    this.x     = this.dir > 0 ? -this.w - 20 : canvasW + 20;
    this.color = randChoice(CAR_COLORS);
    this.animT = Math.random() * 100;
  }

  update(dt) {
    this.x    += this.dir * this.speed * dt;
    this.animT += dt;
    // wrap around
    if (this.dir > 0 && this.x >  this.canvasW + this.w + 20) this.x = -this.w - 20;
    if (this.dir < 0 && this.x < -this.w - 20) this.x = this.canvasW + 20;
  }

  draw(ctx) {
    switch (this.type) {
      case 'truck': drawFoodTruck(ctx, this.x, this.y, this.w, this.h, this.color); break;
      case 'bike':  drawBike(ctx, this.x, this.y, this.w, this.h, this.color, this.dir, this.animT); break;
      case 'donut': drawDonut(ctx, this.x, this.y, this.h / 2, this.animT); break;
      default:      drawCar(ctx, this.x, this.y, this.w, this.h, this.color, this.dir);
    }
  }

  getBounds() {
    return { x: this.x + 4, y: this.y + 4, w: this.w - 8, h: this.h - 8 };
  }
}

// ============================================================
// COLLECTIBLE
// ============================================================
const COLLECTIBLE_TYPES = ['burger', 'taco', 'pizza', 'special'];
const COLLECTIBLE_SCORES = { burger: CFG.BURGER_SCORE, taco: CFG.TACO_SCORE,
                              pizza: CFG.PIZZA_SCORE, special: CFG.SPECIAL_SCORE };

class Collectible {
  constructor(tileX, tileY, type, tileSize) {
    this.tileX    = tileX;
    this.tileY    = tileY;
    this.type     = type;
    this.tileSize = tileSize;
    this.px       = tileX * tileSize + tileSize / 2;
    this.py       = -tileY * tileSize + tileSize / 2;
    this.size     = tileSize * 0.38;
    this.collected = false;
    this.popAnim  = 0; // 0→1 when collected
    this.popDone  = false;
  }

  update(dt, time) {
    if (this.collected && !this.popDone) {
      this.popAnim += dt * 4;
      if (this.popAnim >= 1) this.popDone = true;
    }
    this.time = time;
  }

  draw(ctx, time) {
    if (this.popDone) return;
    const pulse = Math.sin(time * 3) * 0.5 + 0.5;

    ctx.save();
    // Always translate to collectible's world position
    const drawY = this.py - (this.collected ? this.popAnim * 20 : 0);
    ctx.translate(this.px, drawY);

    if (this.collected) {
      ctx.globalAlpha = Math.max(0, 1 - this.popAnim);
    }

    switch (this.type) {
      case 'burger':  drawBurger(ctx, 0, 0, this.size, pulse); break;
      case 'taco':    drawTaco(ctx, 0, 0, this.size, pulse); break;
      case 'pizza':   drawPizza(ctx, 0, 0, this.size, pulse); break;
      case 'special': drawSpecialFood(ctx, 0, 0, this.size, pulse, time); break;
    }

    if (!this.collected) {
      // Shadow at offset below collectible (in translated context)
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.beginPath();
      ctx.ellipse(0, this.size * 0.4, this.size * 0.35, this.size * 0.1, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  getBounds() {
    const r = this.tileSize * 0.3;
    return { x: this.px - r, y: this.py - r, w: r * 2, h: r * 2 };
  }
}

// ============================================================
// MAIN GAME CLASS
// ============================================================
class Game {
  constructor() {
    this.canvas  = document.getElementById('gameCanvas');
    this.ctx     = this.canvas.getContext('2d');
    this.audio   = new AudioEngine();
    this.audio.loadAllSounds().catch(() => {}); // fire-and-forget; synth fallback used until files load
    this.laneGen = new LaneGen();

    this.state     = 'title';  // title | playing | dead
    this.score     = 0;
    this.highScore = parseInt(localStorage.getItem('benny_hi') || '0');
    this.chonkLevel = 0;
    this.dashAvailable = false;
    this.dashTimer = 0;
    this.dashing   = false;

    // Player
    this.player = {
      tileX: 4, tileY: 1,
      px: 0, py: 0,           // pixel position (interpolated)
      targetPx: 0, targetPy: 0,
      moving: false,
      moveT: 0,               // 0→1 move progress
      state: 'idle',          // idle | walking | dead
      deadT: 0,
      animT: 0,
    };

    // Camera
    this.camY = 0; // pixel offset (scrolls up)

    // Obstacles / collectibles
    this.obstacles   = [];
    this.collectibles = [];
    this.generatedUpTo = -1; // farthest lane generated

    // Input
    this.keys    = {};
    this.moveQueue = null;
    this.lastMoveTime = 0;
    this.lastDpadTime = 0;

    // Timers
    this.time    = 0;
    this.lastTS  = null;
    this.deathDelay = 0;

    // Particle effects
    this.particles = [];

    this.resize();
    this.bindInput();
    this.initScreens();
    this.drawTitleBenny();
  }

  // ── RESIZE ──────────────────────────────────────────────
  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width  = w;
    this.canvas.height = h;
    this.W = w;
    this.H = h;

    // Tile size: fit CFG.COLS tiles in canvas width
    this.TILE = Math.floor(w / CFG.COLS);

    // Re-sync player pixel position
    this._syncPlayerPixel();
    this._resetCamera();
  }

  _syncPlayerPixel() {
    this.player.px       = this.player.tileX * this.TILE + this.TILE / 2;
    this.player.py       = -this.player.tileY * this.TILE + this.TILE / 2;
    this.player.targetPx = this.player.px;
    this.player.targetPy = this.player.py;
  }

  _resetCamera() {
    // Keep player at ~70% down the screen; higher tileY = higher on screen (lower world Y)
    this.camY = this.H * 0.7 - this.player.py;
  }

  // ── INIT SCREENS ────────────────────────────────────────
  initScreens() {
    document.getElementById('start-btn').addEventListener('click', () => this.startGame());
    document.getElementById('restart-btn').addEventListener('click', () => this.startGame());
    document.getElementById('share-btn').addEventListener('click', () => this.shareScore());

    // Show D-pad on mobile
    const hasTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    this.isTouchDevice = hasTouch;
    if (hasTouch) {
      document.getElementById('touch-controls').classList.add('visible');
    }
  }

  drawTitleBenny() {
    const c = document.getElementById('title-canvas');
    const x = c.getContext('2d');
    x.clearRect(0, 0, c.width, c.height);
    let t = 0;
    const animate = () => {
      if (this.state !== 'title') return;
      t += 0.016;
      x.clearRect(0, 0, c.width, c.height);
      x.save();
      x.translate(c.width / 2, c.height / 2 + Math.sin(t * 2) * 6);
      drawBenny(x, 0, 0, c.width * 0.42, Math.floor(t * 0.4) % CFG.MAX_CHONK,
                'walking', t);
      x.restore();
      requestAnimationFrame(animate);
    };
    animate();
  }

  // ── START / RESTART ──────────────────────────────────────
  startGame() {
    this.audio.resume();

    // Unlock speech synthesis for mobile (must be called from user gesture)
    if (window.speechSynthesis) {
      const unlock = new SpeechSynthesisUtterance('');
      unlock.volume = 0;
      window.speechSynthesis.speak(unlock);
    }

    this.state      = 'playing';
    this.score      = 0;
    this.chonkLevel = 0;
    this.dashAvailable = false;
    this.dashTimer  = 0;
    this.dashing    = false;
    this.time       = 0;
    this.lastTS     = null;
    this.deathDelay = 0;
    this.moveQueue  = null;
    this.lastMoveTime = 0;
    this.dpadTouched = false;
    this.lastDpadTime = 0;
    this.particles  = [];
    this.milestoneText  = '';
    this.milestoneTimer = 0;
    this.shownMilestones = new Set();

    // Reset lane generator
    this.laneGen      = new LaneGen();
    this.generatedUpTo = -1;

    // Reset player
    const startX = Math.floor(CFG.COLS / 2);
    this.player = {
      tileX: startX, tileY: 1,
      px: startX * this.TILE + this.TILE / 2,
      py: -1 * this.TILE + this.TILE / 2,
      targetPx: startX * this.TILE + this.TILE / 2,
      targetPy: -1 * this.TILE + this.TILE / 2,
      moving: false, moveT: 0,
      state: 'idle', deadT: 0, animT: 0,
    };

    this.obstacles   = [];
    this.collectibles = [];
    this._resetCamera();
    this._generateWorld();

    document.getElementById('title-screen').classList.add('hidden');
    document.getElementById('gameover-screen').classList.add('hidden');
    document.getElementById('touch-controls').classList.add('visible');

    requestAnimationFrame((ts) => this.loop(ts));
  }

  // ── GAME OVER ────────────────────────────────────────────
  triggerDeath() {
    if (this.state !== 'playing') return;
    this.state = 'dead';
    this.player.state = 'dead';
    this.player.deadT = 0;
    this.audio.sadTrombone();
    this._spawnDeathParticles();
    this.deathDelay = 0;

    if (this.score > this.highScore) {
      this.highScore = this.score;
      localStorage.setItem('benny_hi', this.highScore);
    }
  }

  showGameOver() {
    document.getElementById('final-score').textContent  = this.score;
    document.getElementById('final-chonk').textContent  = this.chonkLevel;
    document.getElementById('best-score').textContent   = this.highScore;
    document.getElementById('gameover-screen').classList.remove('hidden');
    document.getElementById('touch-controls').classList.remove('visible');

    // Draw squish on dedicated canvas
    const sc = document.getElementById('squish-canvas');
    const sx = sc.getContext('2d');
    sx.clearRect(0, 0, sc.width, sc.height);
    drawSquishBenny(sx, sc.width / 2, sc.height / 2, sc.width);
  }

  shareScore() {
    const msg = BRAND.SHARE_MESSAGE(this.score);
    navigator.clipboard.writeText(msg).then(() => {
      const el = document.getElementById('share-notice');
      el.classList.remove('hidden');
      setTimeout(() => el.classList.add('hidden'), 2500);
    }).catch(() => {
      prompt('Copy this text:', msg);
    });
  }

  // ── WORLD GENERATION ─────────────────────────────────────
  _generateWorld() {
    const visibleLanes = Math.ceil(this.H / this.TILE) + 6;
    const topLane      = this.player.tileY + visibleLanes;

    for (let lane = this.generatedUpTo + 1; lane <= topLane; lane++) {
      const laneData = this.laneGen.getLane(lane);
      if (laneData.type === 'road') {
        this._spawnObstaclesForLane(lane, laneData);
        this._maybeSpawnCollectible(lane, 'road');
      } else {
        this._maybeSpawnCollectible(lane, 'grass');
      }
      this.generatedUpTo = Math.max(this.generatedUpTo, lane);
    }
  }

  _spawnObstaclesForLane(laneIdx, laneData) {
    // Don't double-spawn
    if (this.obstacles.some(o => o.laneIdx === laneIdx)) return;

    const n = Math.min(laneData.numObs, this.W < CFG.MOBILE_WIDTH_THRESHOLD ? CFG.MOBILE_MAX_OBS_PER_LANE : CFG.MAX_OBS_PER_LANE);
    const spacing = Math.max(this.TILE * 2, (this.W + 400) / n);
    for (let i = 0; i < n; i++) {
      const obs = new Obstacle(laneIdx, laneData, this.W, this.TILE, this.score);
      // Stagger all obstacles off-screen in their travel direction's origin side
      if (laneData.dir > 0) {
        obs.x = -obs.w - 20 - i * spacing;
      } else {
        obs.x = this.W + 20 + i * spacing;
      }
      this.obstacles.push(obs);
    }
  }

  _maybeSpawnCollectible(laneIdx, laneType) {
    if (Math.random() > (laneType === 'road' ? 0.35 : 0.25)) return;
    const tileX = randInt(0, CFG.COLS - 1);
    // Weighted type selection
    const roll = Math.random();
    let type;
    if (roll < 0.35)      type = 'burger';
    else if (roll < 0.65) type = 'taco';
    else if (roll < 0.88) type = 'pizza';
    else                  type = 'special';

    this.collectibles.push(new Collectible(tileX, laneIdx, type, this.TILE));
  }

  _pruneWorld() {
    const minLane = this.player.tileY - 5;
    this.obstacles    = this.obstacles.filter(o  => o.laneIdx >= minLane);
    this.collectibles = this.collectibles.filter(c => !c.popDone && c.tileY >= minLane);
  }

  // ── INPUT ────────────────────────────────────────────────
  bindInput() {
    document.addEventListener('keydown', e => this._onKey(e));

    // D-pad buttons
    ['up','down','left','right'].forEach(dir => {
      const btn = document.getElementById(`btn-${dir}`);
      if (!btn) return;
      const ev = (e) => {
        e.stopPropagation();
        this.dpadTouched = true;
        this.lastDpadTime = Date.now();
        if (this.state === 'playing') this._queueMove(dir);
      };
      btn.addEventListener('touchstart', ev, { passive: true });
      btn.addEventListener('mousedown',  ev);
    });

    // Swipe support
    let tx0 = 0, ty0 = 0;
    document.addEventListener('touchstart', e => {
      tx0 = e.touches[0].clientX;
      ty0 = e.touches[0].clientY;
    }, { passive: true });
    document.addEventListener('touchend', e => {
      if (this.dpadTouched) { this.dpadTouched = false; return; }
      if (Date.now() - this.lastDpadTime < CFG.DPAD_SWIPE_DEBOUNCE_MS) return;
      if (this.state !== 'playing') return;
      const dx = e.changedTouches[0].clientX - tx0;
      const dy = e.changedTouches[0].clientY - ty0;
      const adx = Math.abs(dx), ady = Math.abs(dy);
      if (Math.max(adx, ady) < CFG.MIN_SWIPE_DISTANCE) return;
      if (adx > ady) this._queueMove(dx > 0 ? 'right' : 'left');
      else           this._queueMove(dy > 0 ? 'down'  : 'up');
    }, { passive: true });

    window.addEventListener('resize', () => this.resize());
  }

  _onKey(e) {
    if (this.state !== 'playing') return;
    const map = {
      ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
      w: 'up', s: 'down', a: 'left', d: 'right',
      W: 'up', S: 'down', A: 'left', D: 'right',
    };
    if (map[e.key]) { e.preventDefault(); this._queueMove(map[e.key]); }

    // Dash on Shift or Space
    if ((e.key === 'Shift' || e.key === ' ') && this.dashAvailable) {
      e.preventDefault();
      this._activateDash();
    }
  }

  _queueMove(dir) {
    if (this.player.moving) return;
    this.moveQueue = dir;
  }

  _processMove() {
    if (!this.moveQueue) return;
    if (this.player.moving) return;

    const now = Date.now();
    const baseCooldown = this.isTouchDevice ? CFG.MOVE_COOLDOWN_TOUCH : CFG.MOVE_COOLDOWN;
    const cooldown = baseCooldown * (1 + this.chonkLevel * CFG.CHONK_SPEED_PENALTY);
    if (now - this.lastMoveTime < cooldown) return;

    const dir = this.moveQueue;
    this.moveQueue = null;

    let nx = this.player.tileX;
    let ny = this.player.tileY;

    if (dir === 'up')    ny++;
    if (dir === 'down')  ny--;
    if (dir === 'left')  nx--;
    if (dir === 'right') nx++;

    // Bounds
    if (nx < 0 || nx >= CFG.COLS) return;
    if (ny < 0) return;

    this.player.tileX = nx;
    this.player.tileY = ny;
    this.player.targetPx = nx * this.TILE + this.TILE / 2;
    this.player.targetPy = -ny * this.TILE + this.TILE / 2;
    this.player.moving = true;
    this.player.moveT  = 0;
    this.player.state  = 'walking';
    this.lastMoveTime  = now;

    this.audio.hop();

    // Update score (max distance)
    if (ny > this.score) this.score = ny;

    // Generate more world ahead
    this._generateWorld();
    this._pruneWorld();

    // Safety net: clear any stale queued input
    this.moveQueue = null;
  }

  _activateDash() {
    if (!this.dashAvailable) return;
    this.dashAvailable = false;
    this.dashing    = true;
    this.dashTimer  = CFG.DASH_DURATION;
    this.lastMoveTime = Date.now() - CFG.MOVE_COOLDOWN * CFG.DASH_COOLDOWN_SKIP;
    this.audio.dash();
    this._spawnDashParticles();
  }

  // ── PARTICLES ────────────────────────────────────────────
  _spawnDeathParticles() {
    for (let i = 0; i < 20; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = rand(50, 180);
      this.particles.push({
        x: this.player.px, y: this.player.py + this.camY,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 80,
        color: randChoice(['#ff8c00','#ffcc00','#ff4466','#ffd700']),
        life: 1, maxLife: 1, size: rand(4, 12),
        type: 'star',
      });
    }
  }

  _spawnDashParticles() {
    for (let i = 0; i < 10; i++) {
      this.particles.push({
        x: this.player.px + rand(-20, 20),
        y: this.player.py + this.camY + rand(-20, 20),
        vx: rand(-40, 40), vy: rand(-80, -20),
        color: `hsl(${rand(40, 60)}, 100%, 70%)`,
        life: 1, maxLife: 0.6, size: rand(3, 8),
        type: 'circle',
      });
    }
  }

  _spawnCollectParticles(x, y) {
    // Convert world coords to screen coords for particles (drawn outside camera transform)
    const screenY = y + this.camY;
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      this.particles.push({
        x, y: screenY,
        vx: Math.cos(angle) * 60, vy: Math.sin(angle) * 60,
        color: randChoice(['#ffd700','#ff8c00','#ff4466','#44ff88']),
        life: 1, maxLife: 0.5, size: rand(3, 7),
        type: 'circle',
      });
    }
  }

  _updateParticles(dt) {
    for (const p of this.particles) {
      p.x  += p.vx * dt;
      p.y  += p.vy * dt;
      p.vy += 200 * dt; // gravity
      p.life -= dt / p.maxLife;
    }
    this.particles = this.particles.filter(p => p.life > 0);
  }

  _drawParticles(ctx) {
    for (const p of this.particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      if (p.type === 'star') {
        drawStar(ctx, p.x, p.y, 5, p.size, p.size * 0.4, p.color);
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ── COLLISION ────────────────────────────────────────────
  _checkCollisions() {
    const pw = this.TILE * (CFG.PLAYER_BASE_SIZE + this.chonkLevel * CFG.CHONK_SIZE_GAIN) * 0.75;
    const pb = {
      x: this.player.px - pw / 2,
      y: this.player.py - pw / 2,
      w: pw, h: pw,
    };

    // Obstacle collision
    for (const obs of this.obstacles) {
      const ob = obs.getBounds();
      // Only check if on same tile row
      if (Math.abs(obs.laneIdx - this.player.tileY) > 0.5) continue;
      if (this._aabb(pb, ob)) {
        this.triggerDeath();
        return;
      }
    }

    // Collectible collision
    for (const col of this.collectibles) {
      if (col.collected) continue;
      if (Math.abs(col.tileX - this.player.tileX) > 0.7) continue;
      if (Math.abs(col.tileY - this.player.tileY) > 0.7) continue;
      const cb = col.getBounds();
      if (this._aabb(pb, cb)) {
        this._collectItem(col);
      }
    }
  }

  _aabb(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x &&
           a.y < b.y + b.h && a.y + a.h > b.y;
  }

  _collectItem(col) {
    col.collected = true;
    const scoreGain = COLLECTIBLE_SCORES[col.type] || 5;
    this.score += scoreGain;

    if (col.type === 'special') {
      this.dashAvailable = true;
      this.audio.specialChomp();
      this._activateDash(); // auto-trigger
    } else {
      this.audio.chomp();
    }

    this._spawnCollectParticles(col.px, col.py);

    // Chonk mechanic
    if (this.chonkLevel < CFG.MAX_CHONK) {
      this.chonkLevel++;
    }

    // Chonk milestone callout
    const milestone = CHONK_MILESTONES[this.chonkLevel];
    if (milestone && !this.shownMilestones.has(this.chonkLevel)) {
      this.shownMilestones.add(this.chonkLevel);
      this.milestoneText  = milestone;
      this.milestoneTimer = 2.5;

      // Speak it out loud (strip emoji for cleaner TTS)
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
        const spokenMsg = milestone.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}]/gu, '').trim();
        const utter = new SpeechSynthesisUtterance(spokenMsg);
        utter.rate   = 1.1;
        utter.pitch  = 0.8; // deeper voice for comedy
        utter.volume = 1.0;
        window.speechSynthesis.speak(utter);
      }
    }
  }

  // ── GAME LOOP ────────────────────────────────────────────
  loop(ts) {
    if (this.state === 'title') return;

    const dt = this.lastTS ? Math.min((ts - this.lastTS) / 1000, 0.05) : 0.016;
    this.lastTS = ts;
    this.time  += dt;

    if (this.state === 'playing') {
      this._update(dt);
    } else if (this.state === 'dead') {
      this._updateDead(dt);
    }

    this._render();
    requestAnimationFrame(ts2 => this.loop(ts2));
  }

  _update(dt) {
    // Dash timer
    if (this.dashing) {
      this.dashTimer -= dt * 1000;
      if (this.dashTimer <= 0) { this.dashing = false; this.dashTimer = 0; }
    }

    // Milestone callout timer
    if (this.milestoneTimer > 0) {
      this.milestoneTimer = Math.max(0, this.milestoneTimer - dt);
    }

    // Process pending move
    this._processMove();

    // Smooth player movement
    if (this.player.moving) {
      const baseDuration = 0.12; // seconds
      const chonkPenalty = 1 + this.chonkLevel * CFG.CHONK_SPEED_PENALTY;
      const duration     = this.dashing ? baseDuration * 0.4 : baseDuration * chonkPenalty;
      this.player.moveT += dt / duration;
      if (this.player.moveT >= 1) {
        this.player.moveT  = 1;
        this.player.moving = false;
        this.player.state  = 'idle';
      }
      const t = easeOut(this.player.moveT);
      this.player.px = lerp(this.player.px, this.player.targetPx, t);
      this.player.py = lerp(this.player.py, this.player.targetPy, t);
    } else {
      this.player.px = this.player.targetPx;
      this.player.py = this.player.targetPy;
    }

    this.player.animT += dt;

    // Smooth camera — keep player at ~70% down screen
    const targetCamY = this.H * 0.7 + this.player.tileY * this.TILE - this.TILE / 2;
    this.camY = lerp(this.camY, targetCamY, 0.08);

    // Update obstacles
    for (const obs of this.obstacles) obs.update(dt);

    // Update collectibles
    for (const col of this.collectibles) col.update(dt, this.time);

    // Check collisions
    this._checkCollisions();

    // Update particles
    this._updateParticles(dt);
  }

  _updateDead(dt) {
    this.player.deadT  = Math.min(1, this.player.deadT + dt * 2.5);
    this.player.animT += dt;
    this._updateParticles(dt);

    this.deathDelay += dt;
    if (this.deathDelay > 2.2) this.showGameOver();
  }

  // ── RENDER ───────────────────────────────────────────────
  _render() {
    const ctx  = this.ctx;
    const T    = this.TILE;
    const camY = this.camY;

    ctx.clearRect(0, 0, this.W, this.H);

    ctx.save();
    ctx.translate(0, camY);

    // Visible lane range — lane L draws at world y = -L * T
    // visible when 0 <= -L*T + camY <= H  =>  (camY-H)/T <= L <= camY/T
    const topLane    = Math.ceil(this.camY / T) + 2;
    const bottomLane = Math.max(0, Math.floor((this.camY - this.H) / T) - 2);

    // Draw lane backgrounds
    for (let lane = bottomLane; lane <= topLane; lane++) {
      const laneData = this.laneGen.getLane(lane);
      if (laneData.type === 'grass') {
        for (let col = 0; col < CFG.COLS + 1; col++) {
          drawGrassTile(ctx, col, -lane, T);
        }
      } else {
        drawRoadLane(ctx, -lane, this.W, T);
      }
    }

    // Draw collectibles (below obstacles)
    for (const col of this.collectibles) {
      if (col.tileY < bottomLane || col.tileY > topLane) continue;
      col.draw(ctx, this.time);
    }

    // Draw obstacles
    for (const obs of this.obstacles) {
      if (obs.laneIdx < bottomLane || obs.laneIdx > topLane) continue;
      obs.draw(ctx);
    }

    // Draw Benny
    const bennySize = this.TILE * (CFG.PLAYER_BASE_SIZE + this.chonkLevel * CFG.CHONK_SIZE_GAIN);
    drawBenny(
      ctx,
      this.player.px, this.player.py,
      bennySize,
      this.chonkLevel,
      this.player.state,
      this.player.animT
    );

    // Death "I'm still hungry" text
    if (this.state === 'dead' && this.player.deadT > 0.3) {
      const alpha = Math.min(1, (this.player.deadT - 0.3) * 3);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = `bold ${T * 0.45}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 4;
      ctx.strokeText('"I\'m still hungry..."', this.player.px, this.player.py - bennySize - 15);
      ctx.fillStyle = '#ff6b6b';
      ctx.fillText('"I\'m still hungry..."', this.player.px, this.player.py - bennySize - 15);
      ctx.restore();
    }

    ctx.restore(); // end camera transform

    // Draw particles (in screen space)
    this._drawParticles(ctx);

    // HUD
    this._drawHUD(ctx);
  }

  _drawHUD(ctx) {
    const T   = this.TILE;
    const pad = 12;

    // Score
    ctx.save();
    ctx.font      = `bold ${Math.min(T * 0.42, 28)}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur  = 6;
    ctx.fillText(`Score: ${this.score}`, pad, pad + 22);

    // High score
    ctx.font      = `${Math.min(T * 0.3, 18)}px sans-serif`;
    ctx.fillStyle = '#ffd700';
    ctx.fillText(`Best: ${this.highScore}`, pad, pad + 44);

    // Chonk meter
    const chonkW  = Math.min(160, this.W * 0.3);
    const chonkH  = 14;
    const chonkX  = this.W - chonkW - pad;
    const chonkY  = pad;

    ctx.font      = `bold ${14}px sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillStyle = '#fff';
    ctx.fillText('🍔 Chonk', this.W - pad, chonkY + 12);

    ctx.shadowBlur = 0;
    ctx.fillStyle  = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.roundRect(chonkX, chonkY + 16, chonkW, chonkH, 6);
    ctx.fill();

    const chonkFill = (this.chonkLevel / CFG.MAX_CHONK) * chonkW;
    const chonkHue  = 30 + this.chonkLevel * 8;
    ctx.fillStyle   = `hsl(${chonkHue}, 100%, 50%)`;
    ctx.beginPath();
    ctx.roundRect(chonkX, chonkY + 16, chonkFill, chonkH, 6);
    ctx.fill();

    // Dash meter
    if (this.dashing || this.dashTimer > 0) {
      const dashW  = Math.min(120, this.W * 0.22);
      const dashH  = 10;
      const dashX  = this.W - dashW - pad;
      const dashY  = chonkY + 38;
      const fill   = (this.dashTimer / CFG.DASH_DURATION) * dashW;

      ctx.font      = `bold ${12}px sans-serif`;
      ctx.textAlign = 'right';
      ctx.fillStyle = '#88eeff';
      ctx.fillText('⚡ Dash', this.W - pad, dashY + 10);

      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath();
      ctx.roundRect(dashX, dashY + 14, dashW, dashH, 5);
      ctx.fill();

      ctx.fillStyle = '#00ccff';
      ctx.beginPath();
      ctx.roundRect(dashX, dashY + 14, fill, dashH, 5);
      ctx.fill();
    } else if (this.dashAvailable) {
      ctx.font = `bold ${14}px sans-serif`;
      ctx.textAlign = 'right';
      ctx.fillStyle = `hsl(${(this.time * 60) % 360}, 100%, 70%)`;
      ctx.fillText('⚡ DASH READY!', this.W - pad, chonkY + 38);
    }

    // Chonk milestone callout popup
    if (this.milestoneTimer > 0 && this.milestoneText) {
      const TOTAL   = 2.5;   // seconds (must match milestoneTimer initial value)
      const FADE_IN = 0.3;   // seconds for bounce-in phase (timer counts down, so near TOTAL)
      const FADE_OUT = 0.5;  // seconds for fade-out at end (timer near 0)

      const elapsed = TOTAL - this.milestoneTimer; // time since popup appeared
      const remaining = this.milestoneTimer;

      // Alpha: fade in over first FADE_IN s, fade out over last FADE_OUT s
      let alpha = 1;
      if (elapsed < FADE_IN)   alpha = elapsed / FADE_IN;
      if (remaining < FADE_OUT) alpha = remaining / FADE_OUT;

      // Scale: bounce-in effect — overshoot then settle
      let scale = 1;
      if (elapsed < FADE_IN) {
        const t = elapsed / FADE_IN;
        // simple spring: overshoot to 1.25 at t=0.6, then settle to 1.0
        scale = t < 0.6
          ? 1.25 * (t / 0.6)
          : 1.25 - 0.25 * ((t - 0.6) / 0.4);
      }

      ctx.save();
      ctx.globalAlpha = clamp(alpha, 0, 1);
      ctx.textAlign   = 'center';
      ctx.textBaseline = 'middle';

      const fontSize = Math.min(this.W * 0.065, 32);
      ctx.font = `bold ${fontSize}px sans-serif`;

      ctx.translate(this.W / 2, this.H * 0.38);
      ctx.scale(scale, scale);

      // Shadow / stroke for readability
      ctx.lineWidth   = 6;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.strokeText(this.milestoneText, 0, 0);
      ctx.fillStyle   = '#fff700';
      ctx.fillText(this.milestoneText, 0, 0);

      ctx.restore();
    }

    ctx.restore();
  }
}

// ============================================================
// BOOTSTRAP
// ============================================================
window.addEventListener('load', () => {
  const game = new Game();

  // Expose for debugging
  window.__game = game;

  // Start loop for title screen animation
  // (actual game loop starts on button click)
});
