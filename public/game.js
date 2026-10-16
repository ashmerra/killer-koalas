(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const app = $('app');
  const canvas = $('game');
  const ctx = canvas.getContext('2d');

  // Logical playfield is 400 units wide; height follows the screen's aspect.
  const LW = 400;
  const HORDE_BAND = 200;
  const MAX_PULL = 200;
  const AIM_X = 1.6;
  const LOCK_PAD = 12;
  const MAX_CHARGES = 2;
  const RALLY_PER_CHARGE = 150;
  const START_KOALAS = 20;
  const SPLASH_R = 44;
  const CHAIN_R = 135;
  const PICKUP_R = 30;
  const DOME_R = 52;
  const RUN_SPEED = 125;
  const PART_EVERY = 1.6;
  const BEST_KEY = 'killerKoalas.best';
  const MUTE_KEY = 'killerKoalas.muted';

  const QUIPS = [
    'THE COMEBACK IS CUDDLY',
    'DROP BEARS INBOUND',
    'NO SEA PARTS THIS HORDE',
    'HOLD THE ROCK',
    'HUG THEM ALL',
    'GUM LEAVES FOREVER',
    'RED TEAM RISES',
  ];

  const INTROS = {
    blaster: ['BAJA BLASTERS · THEY SOAK THE HORDE', '#3ff0c8'],
    tablet: ['TABLET MOSES · HIT HIM TWICE', '#e9dfcc'],
    parter: ['STAFF UP = PARTED · WAIT IT OUT', '#8fb6ff'],
  };

  let LH = 800;
  let LINE_Y = 600;
  let OX = LW / 2;
  let OY = 680;
  let RY = 710;
  let scale = 1;
  let dpr = 1;
  let state = 'title';
  let g = null;
  let last = 0;
  let aim = null;
  let bg = null;
  let backSprite = null;
  let slots = [];

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
  const hash = (n) => {
    const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

  function resize() {
    const r = app.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    scale = r.width / LW;
    LH = r.height / scale;
    LINE_Y = Math.round(LH - HORDE_BAND);
    OY = Math.round(LH - 124);
    RY = OY + 34;
    buildSlots();
    buildBackdrop();
    buildSprites();
    if (g) {
      for (const m of g.moses) if (m.atLine) m.y = LINE_Y - 4;
    }
    if (state !== 'play') render();
  }

  // ---------------------------------------------------------------- audio
  const Sfx = {
    ctx: null,
    master: null,
    noiseBuf: null,
    muted: localStorage.getItem(MUTE_KEY) === '1',

    init() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ac = (this.ctx = new AC());
      this.master = ac.createGain();
      this.master.gain.value = this.muted ? 0 : 0.7;
      this.master.connect(ac.destination);

      const len = ac.sampleRate * 2;
      this.noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    },

    setMuted(m) {
      this.muted = m;
      localStorage.setItem(MUTE_KEY, m ? '1' : '0');
      if (this.master) this.master.gain.value = m ? 0 : 0.7;
    },

    tone(freq, dur, { type = 'sine', vol = 0.2, slide = 0, delay = 0 } = {}) {
      if (!this.ctx) return;
      const ac = this.ctx;
      const t = ac.currentTime + delay;
      const o = ac.createOscillator();
      const gn = ac.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
      gn.gain.setValueAtTime(0.0001, t);
      gn.gain.exponentialRampToValueAtTime(vol, t + 0.01);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(gn).connect(this.master);
      o.start(t);
      o.stop(t + dur + 0.05);
    },

    noise(dur, { vol = 0.3, freq = 1200, to = 0, type = 'lowpass', delay = 0 } = {}) {
      if (!this.ctx) return;
      const ac = this.ctx;
      const t = ac.currentTime + delay;
      const src = ac.createBufferSource();
      src.buffer = this.noiseBuf;
      const f = ac.createBiquadFilter();
      f.type = type;
      f.frequency.setValueAtTime(freq, t);
      if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
      const gn = ac.createGain();
      gn.gain.setValueAtTime(vol, t);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f).connect(gn).connect(this.master);
      src.start(t, Math.random());
      src.stop(t + dur + 0.05);
    },

    toss() {
      this.noise(0.28, { vol: 0.18, freq: 500, to: 2600, type: 'bandpass' });
      this.tone(320, 0.18, { type: 'triangle', vol: 0.08, slide: 720 });
    },
    land() {
      this.tone(130, 0.2, { type: 'sine', vol: 0.3, slide: 55 });
      this.noise(0.25, { vol: 0.2, freq: 900, to: 150 });
    },
    cuddle(i) {
      const f = 820 + i * 140;
      this.tone(f, 0.1, { type: 'triangle', vol: 0.16, slide: f * 1.5 });
      this.tone(f * 1.25, 0.16, { type: 'triangle', vol: 0.12, delay: 0.07, slide: f * 1.9 });
    },
    bonk() {
      this.tone(190, 0.14, { type: 'square', vol: 0.1, slide: 90 });
    },
    crack() {
      this.noise(0.18, { vol: 0.32, freq: 3200, type: 'highpass' });
      this.tone(220, 0.1, { type: 'square', vol: 0.07, slide: 110 });
    },
    deflect() {
      this.tone(1300, 0.25, { type: 'sine', vol: 0.12, slide: 380 });
      this.noise(0.22, { vol: 0.16, freq: 2000, type: 'bandpass' });
    },
    part() {
      this.noise(0.5, { vol: 0.22, freq: 400, to: 2600, type: 'bandpass' });
      this.tone(196, 0.4, { type: 'triangle', vol: 0.1, slide: 147 });
    },
    splash() {
      this.noise(0.35, { vol: 0.22, freq: 3000, to: 300 });
    },
    join() {
      this.tone(523, 0.18, { type: 'sine', vol: 0.18 });
      this.tone(784, 0.25, { type: 'sine', vol: 0.14, delay: 0.08 });
    },
    leaves() {
      [784, 988, 1175].forEach((f, i) => this.tone(f, 0.18, { type: 'sine', vol: 0.12, delay: i * 0.06 }));
    },
    charge() {
      [660, 880, 1100, 1320].forEach((f, i) => this.tone(f, 0.16, { type: 'square', vol: 0.06, delay: i * 0.06 }));
    },
    horn() {
      this.tone(220, 0.45, { type: 'sawtooth', vol: 0.07 });
      this.tone(330, 0.55, { type: 'sawtooth', vol: 0.06, delay: 0.18 });
    },
    boss() {
      this.tone(110, 1.0, { type: 'sawtooth', vol: 0.13, slide: 70 });
      this.tone(82, 1.2, { type: 'square', vol: 0.06, delay: 0.2 });
    },
    clear() {
      [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.3, { type: 'triangle', vol: 0.12, delay: i * 0.08 }));
    },
    stampede() {
      this.noise(1.4, { vol: 0.5, freq: 180, to: 900 });
      for (let i = 0; i < 12; i++) this.tone(85, 0.1, { type: 'sine', vol: 0.3, slide: 40, delay: i * 0.1 });
      this.tone(440, 0.5, { type: 'square', vol: 0.05, slide: 1320 });
    },
    over() {
      [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.4, { type: 'triangle', vol: 0.14, delay: i * 0.16 }));
      this.noise(1.4, { vol: 0.35, freq: 2000, to: 100 });
    },
  };

  const buzz = (p) => {
    if (navigator.vibrate) {
      try { navigator.vibrate(p); } catch (_) { /* ignore */ }
    }
  };

  // ---------------------------------------------------------------- game state
  function newGame() {
    g = {
      t: 0,
      score: 0,
      horde: START_KOALAS,
      peakHorde: START_KOALAS,
      wave: 0,
      waveState: 'break',
      waveT: 1.6,
      waveTotal: 1,
      toSpawn: 0,
      spawnT: 0,
      moses: [],
      flyers: [],
      runners: [],
      bottles: [],
      pickups: [],
      particles: [],
      tossed: [],
      texts: [],
      banners: [],
      seen: {},
      combo: 0,
      bestChain: 0,
      cuddled: 0,
      thrown: 0,
      rally: 0,
      charges: 1,
      stampede: null,
      chiefThrow: 0,
      pickupT: 7,
      moteT: 0,
      shake: 0,
      flash: 0,
      flashColor: '255,255,255',
      warnedParting: false,
      quip: 0,
      dying: 0,
    };
    showBanner('HOLD THE ROCK', '#ffcf4a');
  }

  const multiplier = () => 1 + Math.min(4, Math.floor(g.combo / 3));
  const maxHits = () => 2 + Math.min(2, Math.floor(g.combo / 5));
  const alive = () => g.moses.filter((m) => m.alive);

  function showBanner(text, color = '#fff') {
    g.banners.push({ text, color, t: 0 });
  }

  function floatText(text, x, y, color = '#fff', size = 18) {
    g.texts.push({ text, x, y, color, size, t: 0 });
  }

  function burst(x, y, n, colors, speed = 140, kind = 'dust', grav = 0) {
    for (let i = 0; i < n; i++) {
      const a = rand(Math.PI * 2);
      const sp = rand(speed * 0.3, speed);
      g.particles.push({
        kind,
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp * (kind === 'dust' ? 0.55 : 1) - (kind === 'heart' ? 60 : 0),
        grav,
        life: rand(0.4, 0.9),
        max: 0.9,
        size: kind === 'heart' ? rand(3, 5.5) : rand(1.5, 4),
        rot: rand(6.28),
        vr: rand(-6, 6),
        color: colors[(Math.random() * colors.length) | 0],
      });
    }
  }

  const DUST = ['#e8a272', '#c9774a', '#f4c79a', '#8a3a22'];
  const TEAL_DROPS = ['#3ff0c8', '#c9fff1', '#0e9f86', '#fff'];
  const BLUE_DROPS = ['#2f6bff', '#8fb6ff', '#1846b8', '#fff'];
  const HEARTS = ['#ff4d6d', '#ff8fa3', '#e3262f', '#ffd0d8'];
  const STONE = ['#9b9285', '#6e665b', '#c8c0b2'];
  const LEAVES = ['#6f9e7a', '#4f8a5b', '#9cc79a'];

  // ---------------------------------------------------------------- waves
  function startWave(n) {
    g.wave = n;
    g.waveState = 'fight';
    const boss = n % 5 === 0;
    g.toSpawn = boss ? 2 + n : 4 + n * 3;
    g.waveTotal = g.toSpawn + (boss ? 1 : 0);
    g.spawnT = 1.2;
    if (boss) {
      spawnMoses('boss', LW / 2, -40);
      showBanner(`WAVE ${n} · BIG MOSES`, '#8fb6ff');
      Sfx.boss();
      buzz([60, 40, 60]);
    } else {
      showBanner(`WAVE ${n}`, '#ffcf4a');
      Sfx.horn();
    }
  }

  function clearWave() {
    g.waveState = 'break';
    g.waveT = 3.2;
    const reinf = 3 + Math.floor(g.wave / 2);
    const bonus = 50 * g.wave;
    g.score += bonus;
    for (let i = 0; i < reinf; i++) {
      g.runners.push({ x: rand(60, LW - 60), y: rand(LH * 0.02, LH * 0.12) - 40, t: rand(10), fresh: true });
    }
    showBanner(`WAVE ${g.wave} CLEARED · +${reinf} KOALAS`, '#ffcf4a');
    showBanner(QUIPS[g.quip++ % QUIPS.length], '#fff');
    floatText(`+${bonus}`, LW / 2, LINE_Y - 40, '#ffcf4a', 22);
    Sfx.clear();
  }

  function pickType(n) {
    const w = [
      ['walker', 1],
      ['blaster', n >= 2 ? 0.3 + n * 0.03 : 0],
      ['tablet', n >= 3 ? 0.32 : 0],
      ['parter', n >= 4 ? 0.3 : 0],
    ];
    let total = 0;
    for (const [, v] of w) total += v;
    let r = rand(total);
    for (const [k, v] of w) {
      if ((r -= v) <= 0) return k;
    }
    return 'walker';
  }

  function spawnMoses(type, x, y) {
    const base = { walker: [24, 1], blaster: [34, 1], tablet: [17, 2], parter: [22, 1], boss: [9, 8 + g.wave] };
    const [sp, hp] = base[type];
    const speedMul = 1 + Math.min(0.6, g.wave * 0.045);
    g.moses.push({
      type,
      x: x === undefined ? rand(64, LW - 64) : x,
      y: y === undefined ? -24 : y,
      hp,
      maxHp: hp,
      speed: sp * speedMul * rand(0.85, 1.15),
      r: type === 'boss' ? 26 : 13,
      t: rand(10),
      sway: rand(1000),
      alive: true,
      fade: 0,
      fallDir: 1,
      stun: 0,
      kbx: 0,
      kby: 0,
      atLine: false,
      partT: PART_EVERY * 0.5,
      raise: 0,
      stopY: LINE_Y * rand(0.24, 0.48),
      fireT: rand(1.4, 2.4),
      domeT: rand(1.2, 2.6),
      dome: 0,
      summonT: 5,
    });
    if (INTROS[type] && !g.seen[type]) {
      g.seen[type] = true;
      showBanner(...INTROS[type]);
    }
  }

  function updateWaves(dt) {
    if (g.waveState === 'break') {
      g.waveT -= dt;
      if (g.waveT <= 0) startWave(g.wave + 1);
      return;
    }
    if (g.toSpawn > 0) {
      g.spawnT -= dt;
      if (g.spawnT <= 0) {
        spawnMoses(pickType(g.wave));
        g.toSpawn--;
        g.spawnT = Math.max(0.55, 2.3 - g.wave * 0.16) * rand(0.7, 1.3);
        if (Math.random() < Math.min(0.35, g.wave * 0.04) && g.toSpawn > 0) {
          spawnMoses(pickType(g.wave));
          g.toSpawn--;
        }
      }
    } else if (g.moses.length === 0 && g.bottles.length === 0) {
      clearWave();
    }
  }

  // ---------------------------------------------------------------- update
  function update(dt) {
    g.t += dt;
    if (g.banners.length) {
      const b = g.banners[0];
      b.t += dt * (g.banners.length > 2 ? 1.7 : 1);
      if (b.t > 2) g.banners.shift();
    }
    g.flash = Math.max(0, g.flash - dt * 2.5);
    g.shake = Math.max(0, g.shake - dt * 30);
    g.chiefThrow = Math.max(0, g.chiefThrow - dt);

    if (g.dying > 0) {
      g.dying -= dt;
      updateMoses(dt);
      updateParticles(dt);
      updateTexts(dt);
      if (g.dying <= 0) gameOver();
      return;
    }

    updateWaves(dt);
    updatePickups(dt);
    updateMoses(dt);
    updateFlyers(dt);
    updateRunners(dt);
    updateBottles(dt);
    updateStampede(dt);
    updateParticles(dt);
    updateTexts(dt);

    if (g.horde <= 0 && g.flyers.length === 0 && g.runners.length === 0) {
      g.dying = 1.6;
      aim = null;
      g.shake = 12;
      g.flash = 1;
      g.flashColor = '47,107,255';
      showBanner('THE HORDE IS PARTED', '#8fb6ff');
      Sfx.over();
      buzz([100, 60, 300]);
    }
  }

  function updateTexts(dt) {
    for (const t of g.texts) {
      t.t += dt;
      t.y -= 40 * dt;
    }
    g.texts = g.texts.filter((t) => t.t < 1.1);
  }

  function updateMoses(dt) {
    const lineY = LINE_Y - 4;
    for (const m of g.moses) {
      m.t += dt;
      if (!m.alive) {
        m.fade -= dt;
        continue;
      }
      m.raise = Math.max(0, m.raise - dt);
      m.x += m.kbx * dt;
      m.y += m.kby * dt;
      const damp = 1 - Math.min(1, dt * 6);
      m.kbx *= damp;
      m.kby *= damp;
      if (m.stun > 0) {
        m.stun -= dt;
      } else if (g.dying > 0) {
        // Victory march.
        m.y += m.speed * 0.6 * dt;
      } else if (!m.atLine) {
        let moving = true;
        if (m.type === 'blaster' && m.y >= m.stopY) {
          moving = false;
          m.x += Math.sin(m.t * 0.9 + m.sway) * 28 * dt;
          m.fireT -= dt;
          if (m.fireT <= 0) {
            m.fireT = rand(3, 4.2);
            m.raise = 0.35;
            lobBottle(m);
          }
        }
        if (m.type === 'parter') {
          if (m.dome > 0) {
            m.dome -= dt;
            moving = false;
          } else {
            m.domeT -= dt;
            if (m.domeT <= 0) {
              m.dome = 1.9;
              m.domeT = rand(2.2, 3.4);
            }
          }
        }
        if (m.type === 'boss') {
          m.summonT -= dt;
          if (m.summonT <= 0 && m.y > 20) {
            m.summonT = 6;
            m.raise = 0.6;
            for (const side of [-1, 1]) spawnMoses('walker', clamp(m.x + side * 44, 64, LW - 64), m.y + 6);
            burst(m.x, m.y - 30, 16, BLUE_DROPS, 120);
            Sfx.part();
          }
        }
        if (moving) {
          m.y += m.speed * dt;
          m.x += Math.sin(m.t * 1.3 + m.sway) * 7 * dt;
        }
        if (m.y >= lineY) {
          m.atLine = true;
          m.y = lineY;
          if (!g.warnedParting) {
            g.warnedParting = true;
            showBanner('THEY ARE PARTING THE HORDE!', '#8fb6ff');
          }
        }
      } else {
        m.y = lineY;
        m.partT -= dt;
        if (m.partT <= 0) {
          m.partT = m.type === 'boss' ? 1.1 : PART_EVERY;
          m.raise = 0.5;
          partHorde(m, m.type === 'boss' ? 2 : 1);
        }
      }
      m.x = clamp(m.x, 56, LW - 56);
      if (m.y > lineY) m.y = lineY;
    }
    g.moses = g.moses.filter((m) => m.alive || m.fade > 0);
  }

  function loseKoala(x, y, label, colors, color) {
    burst(x, y, 12, colors, 150, 'drop', 200);
    g.tossed.push({ x, y, vx: rand(-160, 160), vy: rand(-320, -220), rot: 0, vr: rand(-10, 10), life: 1.1 });
    floatText(label, x, y - 10, color, 14);
    buzz(30);
  }

  function partHorde(m, n) {
    let lost = 0;
    for (let i = 0; i < n && g.horde > 0; i++) {
      g.horde--;
      lost++;
      loseKoala(m.x + rand(-30, 30), LINE_Y + rand(16, 50), 'PARTED', BLUE_DROPS, '#8fb6ff');
    }
    if (lost) {
      g.shake = Math.max(g.shake, 5);
      Sfx.part();
    }
  }

  function lobBottle(m) {
    const tx = rand(50, LW - 50);
    const ty = rand(LINE_Y + 18, LH - 40);
    g.bottles.push({
      x0: m.x + 10, y0: m.y - 6, x1: tx, y1: ty, x: m.x, y: m.y, z: 0,
      t: 0, T: 1.05 + rand(0.25), H: 80, spin: rand(-12, 12),
    });
  }

  function updateBottles(dt) {
    const keep = [];
    for (const b of g.bottles) {
      b.t += dt;
      const p = Math.min(1, b.t / b.T);
      b.x = lerp(b.x0, b.x1, p);
      b.y = lerp(b.y0, b.y1, p);
      b.z = 4 * b.H * p * (1 - p);
      if (Math.random() < 0.4) g.particles.push({ kind: 'drop', x: b.x, y: b.y - b.z, vx: rand(-20, 20), vy: rand(-10, 30), grav: 120, life: 0.4, max: 0.4, size: rand(1.2, 2.4), rot: 0, vr: 0, color: '#3ff0c8' });
      if (p < 1) {
        keep.push(b);
        continue;
      }
      burst(b.x, b.y, 22, TEAL_DROPS, 170, 'drop', 160);
      Sfx.splash();
      let soaked = false;
      g.runners = g.runners.filter((r) => {
        if (dist(r.x, r.y, b.x, b.y) < 26) {
          loseKoala(r.x, r.y, 'SOAKED', TEAL_DROPS, '#3ff0c8');
          soaked = true;
          return false;
        }
        return true;
      });
      if (b.y > LINE_Y && g.horde > 0) {
        g.horde--;
        loseKoala(b.x, b.y, 'SOAKED', TEAL_DROPS, '#3ff0c8');
        soaked = true;
      }
      if (soaked) g.shake = Math.max(g.shake, 4);
    }
    g.bottles = keep;
  }

  // ---------------------------------------------------------------- throwing
  // Slingshot: pull down for distance, pull sideways to aim the opposite way. The axes are
  // independent so a sideways correction never changes how far the koala flies.
  function aimTarget(a) {
    const dx = a.sx - a.cx;
    const dy = a.cy - a.sy;
    if (dy < 12) return null;
    const range = (Math.min(dy, MAX_PULL) / MAX_PULL) * (OY + 12);
    return [clamp(OX + dx * AIM_X, 22, LW - 22), clamp(OY - range, -10, LINE_Y)];
  }

  // The Moses under the reticle, if any. A locked throw homes in on him.
  function lockedMoses(tx, ty) {
    let best = null;
    let bd = Infinity;
    for (const m of g.moses) {
      if (!m.alive || m.dome > 0) continue;
      const d = dist(tx, ty, m.x, m.y);
      if (d < m.r + LOCK_PAD && d < bd) {
        bd = d;
        best = m;
      }
    }
    return best;
  }

  function launchFrom() {
    return [OX, OY - 14];
  }

  function throwKoala(tx, ty) {
    if (state !== 'play' || !g || g.dying > 0 || g.horde <= 0) return false;
    g.horde--;
    g.thrown++;
    g.chiefThrow = 0.3;
    const [x0, y0] = launchFrom();
    const d = dist(x0, y0, tx, ty);
    g.flyers.push({ x0, y0, x1: tx, y1: ty, x: x0, y: y0, z: 0, t: 0, T: 0.32 + d / 1200, H: 30 + d * 0.2, hits: 0, last: null, target: lockedMoses(tx, ty), deflected: false, spin: rand(-1, 1) });
    Sfx.toss();
    buzz(12);
    return true;
  }

  function updateFlyers(dt) {
    const keep = [];
    for (const f of g.flyers) {
      f.t += dt;
      if (f.target && f.target.alive) {
        f.x1 = f.target.x;
        f.y1 = f.target.y;
      }
      const p = Math.min(1, f.t / f.T);
      f.x = lerp(f.x0, f.x1, p);
      f.y = lerp(f.y0, f.y1, p);
      f.z = 4 * f.H * p * (1 - p);
      if (p < 1 || !land(f)) keep.push(f);
    }
    g.flyers = keep;
  }

  function hop(f, x, y, tx, ty, T, H) {
    f.x0 = x;
    f.y0 = y;
    f.x1 = tx;
    f.y1 = ty;
    f.t = 0;
    f.T = T;
    f.H = H;
  }

  // Resolves a landing. Returns true when the koala is done flying.
  function land(f) {
    const x = f.x1;
    const y = f.y1;

    // Raised staffs part the air: the koala bounces off the dome.
    for (const m of g.moses) {
      if (!m.alive || m.dome <= 0) continue;
      const d = dist(x, y, m.x, m.y);
      if (d < DOME_R) {
        const a = d > 1 ? Math.atan2(y - m.y, x - m.x) : rand(Math.PI * 2);
        const nx = clamp(m.x + Math.cos(a) * (DOME_R + 34), 30, LW - 30);
        const ny = clamp(m.y + Math.sin(a) * (DOME_R + 34), -10, LINE_Y);
        f.target = null;
        f.deflected = true;
        hop(f, x, y, nx, ny, 0.34, 26);
        burst(x, y, 14, BLUE_DROPS, 140, 'drop', 120);
        floatText('PARTED!', x, y - 16, '#8fb6ff', 15);
        Sfx.deflect();
        return false;
      }
    }

    Sfx.land();
    g.shake = Math.max(g.shake, 3);
    burst(x, y, 12, DUST, 120);

    let hit = null;
    let bd = Infinity;
    for (const m of g.moses) {
      if (!m.alive) continue;
      const d = dist(x, y, m.x, m.y);
      if (d < m.r + 10 && d < bd) {
        bd = d;
        hit = m;
      }
    }

    for (const m of g.moses) {
      if (!m.alive || m === hit || m.type === 'boss') continue;
      const d = dist(x, y, m.x, m.y);
      if (d < SPLASH_R) {
        const a = Math.atan2(m.y - y, m.x - x);
        m.kbx += Math.cos(a) * 110;
        m.kby += Math.sin(a) * 110;
        m.stun = Math.max(m.stun, 0.7);
      }
    }

    for (const it of g.pickups) {
      if (!it.taken && dist(x, y, it.x, it.y) < PICKUP_R) collect(it);
    }

    if (hit) {
      f.hits++;
      f.last = hit;
      strike(hit, f.hits);
      if (f.hits < maxHits()) {
        let next = null;
        let nd = CHAIN_R;
        for (const m of g.moses) {
          if (!m.alive || m === hit) continue;
          const d = dist(x, y, m.x, m.y);
          if (d < nd) {
            nd = d;
            next = m;
          }
        }
        if (next) {
          f.target = next;
          hop(f, x, y, next.x, next.y, 0.26 + nd / 1400, 26 + nd * 0.15);
          return false;
        }
      }
    }

    // The throw is over: score the combo and send the koala home.
    if (f.hits > 0) {
      g.combo++;
      g.bestChain = Math.max(g.bestChain, f.hits);
    } else {
      g.combo = 0;
    }
    g.runners.push({ x, y, t: rand(10) });
    return true;
  }

  function strike(m, idx) {
    m.hp--;
    m.stun = Math.max(m.stun, 0.35);
    if (m.type === 'tablet' && m.hp === 1) {
      burst(m.x, m.y, 18, STONE, 160, 'stone', 260);
      floatText('SHATTERED', m.x, m.y - 22, '#e9dfcc', 14);
      g.score += 5 * multiplier();
      m.speed *= 1.35;
      Sfx.crack();
      return;
    }
    if (m.hp > 0) {
      const pts = 15 * multiplier();
      g.score += pts;
      m.kby -= 40;
      burst(m.x, m.y - 20, 8, HEARTS, 90, 'heart');
      floatText(`+${pts}`, m.x, m.y - 40, '#ffcf4a', 14);
      addRally(4);
      Sfx.bonk();
      return;
    }
    cuddle(m, idx);
  }

  function cuddle(m, idx, earnsRally = true) {
    m.alive = false;
    m.fade = 0.8;
    m.fallDir = Math.random() < 0.5 ? -1 : 1;
    m.dome = 0;
    g.cuddled++;
    const boss = m.type === 'boss';
    const pts = boss ? 500 * multiplier() : 10 * idx * multiplier();
    g.score += pts;
    burst(m.x, m.y - 10, boss ? 30 : 12, HEARTS, boss ? 200 : 110, 'heart');
    const label = boss ? `BIG MOSES CUDDLED +${pts}` : idx > 1 ? `CHAIN x${idx} +${pts}` : `CUDDLED +${pts}`;
    floatText(label, m.x, m.y - 26, idx > 1 || boss ? '#ffcf4a' : '#fff', idx > 1 || boss ? 17 : 15);
    if (earnsRally) addRally(boss ? 60 : 7 + idx * 2);
    Sfx.cuddle(idx);
    if (boss) {
      g.shake = 14;
      g.flash = 1;
      g.flashColor = '255,207,74';
      dropPickup('flag', m.x - 20, m.y);
      if (earnsRally) dropPickup('leaves', m.x + 20, m.y);
      buzz([40, 30, 90]);
    } else if (earnsRally && Math.random() < 0.08) {
      dropPickup('leaves', m.x, m.y);
    }
  }

  function addRally(v) {
    // A full bank cannot store a hidden extra stampede in the meter.
    if (g.charges >= MAX_CHARGES) return;
    g.rally += v;
    while (g.rally >= RALLY_PER_CHARGE && g.charges < MAX_CHARGES) {
      g.rally -= RALLY_PER_CHARGE;
      g.charges++;
      floatText('STAMPEDE READY!', OX, OY - 60, '#ffcf4a', 18);
      Sfx.charge();
      buzz(25);
    }
    if (g.charges >= MAX_CHARGES) g.rally = 0;
  }

  // ---------------------------------------------------------------- pickups and runners
  function dropPickup(type, x, y) {
    g.pickups.push({ type, x: clamp(x, 60, LW - 60), y: clamp(y, 20, LINE_Y - 30), life: 9, t: rand(10), taken: false });
  }

  function updatePickups(dt) {
    g.pickupT -= dt;
    if (g.pickupT <= 0 && g.waveState === 'fight') {
      g.pickupT = rand(7, 11);
      dropPickup(Math.random() < 0.55 ? 'leaves' : 'flag', rand(70, LW - 70), rand(LINE_Y * 0.16, LINE_Y * 0.7));
    }
    for (const it of g.pickups) {
      it.t += dt;
      it.life -= dt;
    }
    g.pickups = g.pickups.filter((it) => !it.taken && it.life > 0);
  }

  function collect(it) {
    it.taken = true;
    if (it.type === 'leaves') {
      addRally(25);
      burst(it.x, it.y, 14, LEAVES, 130, 'leaf');
      floatText('+GUM LEAVES', it.x, it.y - 18, '#8fd18a', 15);
      Sfx.leaves();
    } else {
      for (let i = 0; i < 3; i++) g.runners.push({ x: it.x + (i - 1) * 12, y: it.y + rand(-4, 4), t: rand(10) });
      floatText('+3 KOALAS', it.x, it.y - 18, '#fff', 15);
      Sfx.join();
    }
    g.score += 20;
  }

  function updateRunners(dt) {
    const keep = [];
    for (const r of g.runners) {
      r.t += dt;
      const tx = clamp(r.x, 50, LW - 50);
      r.x += (tx - r.x) * Math.min(1, dt * 3);
      r.y += RUN_SPEED * (r.fresh ? 1.6 : 1) * dt;
      if (r.y >= LINE_Y + 10) {
        g.horde++;
        g.peakHorde = Math.max(g.peakHorde, g.horde);
        continue;
      }
      keep.push(r);
    }
    g.runners = keep;
  }

  // ---------------------------------------------------------------- stampede
  function stampede() {
    if (state !== 'play' || !g || g.dying > 0 || g.charges <= 0 || g.stampede) return;
    g.charges--;
    g.stampede = { y: LINE_Y + 20, hit: new Set() };
    g.flash = 1;
    g.flashColor = '255,207,74';
    g.shake = 10;
    showBanner('CUDDLE STAMPEDE!', '#ffcf4a');
    Sfx.stampede();
    buzz([40, 30, 90]);
  }

  function updateStampede(dt) {
    const s = g.stampede;
    if (!s) return;
    s.y -= 560 * dt;
    g.shake = Math.max(g.shake, 4);
    for (let i = 0; i < 4; i++) {
      g.particles.push({ kind: 'dust', x: rand(LW), y: s.y + rand(0, 20), vx: rand(-40, 40), vy: rand(20, 90), grav: 0, life: rand(0.4, 0.8), max: 0.8, size: rand(3, 7), rot: 0, vr: 0, color: DUST[(Math.random() * 4) | 0] });
    }
    for (const m of g.moses) {
      if (!m.alive || m.y < s.y - 10 || s.hit.has(m)) continue;
      s.hit.add(m);
      if (m.type === 'boss') {
        m.hp -= 4;
        m.stun = 1;
        m.kby -= 160;
        if (m.hp <= 0) cuddle(m, 1, false);
        else floatText('-4', m.x, m.y - 50, '#ffcf4a', 18);
      } else {
        // Stampedes still score, but cannot fund the next stampede via kills or leaves.
        cuddle(m, 1, false);
      }
    }
    g.bottles = g.bottles.filter((b) => {
      if (b.y - b.z < s.y) return true;
      burst(b.x, b.y - b.z, 10, TEAL_DROPS, 120, 'drop', 120);
      return false;
    });
    if (s.y < -80) g.stampede = null;
  }

  function updateParticles(dt) {
    g.moteT -= dt;
    if (g.moteT <= 0) {
      g.moteT = 0.25;
      g.particles.push({ kind: 'mote', x: rand(LW), y: rand(LH), vx: rand(8, 22), vy: rand(-6, 6), grav: 0, life: 3, max: 3, size: rand(0.8, 1.8), rot: 0, vr: 0, color: '#ffe2b8' });
    }
    const keep = [];
    for (const p of g.particles) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.grav * dt;
      p.rot += p.vr * dt;
      if (p.kind !== 'mote') {
        p.vx *= 1 - dt * 2.5;
        if (!p.grav) p.vy *= 1 - dt * 2.5;
      }
      keep.push(p);
    }
    if (keep.length > 700) keep.splice(0, keep.length - 700);
    g.particles = keep;

    for (const k of g.tossed) {
      k.life -= dt;
      k.x += k.vx * dt;
      k.y += k.vy * dt;
      k.vy += 640 * dt;
      k.rot += k.vr * dt;
    }
    g.tossed = g.tossed.filter((k) => k.life > 0);
  }

  // ---------------------------------------------------------------- static art
  function wallX(y, side) {
    const w = 30 + 11 * Math.sin(y * 0.021 + side * 2.1) + 6 * Math.sin(y * 0.063 + side) + (y < 90 ? (90 - y) * 0.3 : 0);
    return side < 0 ? w : LW - w;
  }

  function buildSlots() {
    slots = [];
    const rows = Math.floor((LH - LINE_Y - 10) / 16);
    let n = 0;
    for (let r = 0; r < rows; r++) {
      for (let x = 34 + (r % 2) * 11; x < LW - 30; x += 22) {
        n++;
        const sx = x + (hash(n * 1.3) - 0.5) * 7;
        const sy = LINE_Y + 16 + r * 16 + (hash(n * 2.9) - 0.5) * 5;
        const ex = (sx - OX) / 84;
        const ey = (sy - RY) / 56;
        if (ex * ex + ey * ey < 1) continue;
        slots.push({ x: sx, y: sy, ph: hash(n * 5.1) * 10, order: r + hash(n * 7.7) * 3 });
      }
    }
    slots.sort((a, b) => a.order - b.order);
  }

  function buildSprites() {
    const s = scale * dpr;
    backSprite = document.createElement('canvas');
    backSprite.width = backSprite.height = Math.ceil(28 * s);
    const c = backSprite.getContext('2d');
    c.setTransform(s, 0, 0, s, 0, 0);
    drawKoalaBack(c, 14, 13, 0.86, 0, true);
  }

  function buildBackdrop() {
    bg = bg || document.createElement('canvas');
    bg.width = canvas.width;
    bg.height = canvas.height;
    const b = bg.getContext('2d');
    const s = scale * dpr;
    b.setTransform(s, 0, 0, s, 0, 0);

    const fl = b.createLinearGradient(0, 0, 0, LH);
    fl.addColorStop(0, '#f6b26a');
    fl.addColorStop(0.1, '#da7d46');
    fl.addColorStop(0.55, '#b4593a');
    fl.addColorStop(1, '#6e2418');
    b.fillStyle = fl;
    b.fillRect(0, 0, LW, LH);

    // Far mesas against the sunset.
    const mesas = [[-20, 80, 34], [70, 150, 18], [140, 236, 42], [226, 300, 16], [290, 420, 30]];
    b.fillStyle = 'rgba(120,36,24,0.5)';
    for (const [x0, x1, h] of mesas) {
      b.beginPath();
      b.moveTo(x0 - 10, 64);
      b.lineTo(x0 + 6, 64 - h);
      b.lineTo(x1 - 6, 64 - h);
      b.lineTo(x1 + 10, 64);
      b.closePath();
      b.fill();
    }
    const sun = b.createRadialGradient(LW * 0.74, -20, 10, LW * 0.74, -20, 320);
    sun.addColorStop(0, 'rgba(255,244,200,0.95)');
    sun.addColorStop(0.22, 'rgba(255,196,110,0.55)');
    sun.addColorStop(1, 'rgba(255,150,80,0)');
    b.fillStyle = sun;
    b.fillRect(0, 0, LW, LH * 0.6);
    const haze = b.createLinearGradient(0, 40, 0, 110);
    haze.addColorStop(0, 'rgba(240,150,90,0)');
    haze.addColorStop(0.5, 'rgba(240,150,90,0.55)');
    haze.addColorStop(1, 'rgba(240,150,90,0)');
    b.fillStyle = haze;
    b.fillRect(0, 40, LW, 70);

    // Pebbles and cracks in the dust.
    for (let i = 0; i < 260; i++) {
      const x = hash(i * 3.1) * LW;
      const y = 60 + hash(i * 7.7) * (LH - 60);
      const hs = hash(i * 1.9);
      b.fillStyle = `rgba(70,20,10,${0.12 + hs * 0.16})`;
      b.beginPath();
      b.ellipse(x, y, 1.2 + hs * 3.2, 0.8 + hs * 2, hs * 3, 0, Math.PI * 2);
      b.fill();
      if (hs > 0.7) {
        b.fillStyle = 'rgba(255,214,170,0.18)';
        b.beginPath();
        b.ellipse(x - 0.8, y - 0.8, hs * 1.4, hs, 0, 0, Math.PI * 2);
        b.fill();
      }
    }
    b.strokeStyle = 'rgba(60,15,8,0.22)';
    b.lineWidth = 1.1;
    for (let i = 0; i < 26; i++) {
      let x = hash(i * 9.3) * LW;
      let y = 90 + hash(i * 4.4) * (LH - 140);
      b.beginPath();
      b.moveTo(x, y);
      for (let k = 0; k < 4; k++) {
        x += (hash(i * 13 + k) - 0.5) * 26;
        y += 4 + hash(i * 17 + k) * 8;
        b.lineTo(x, y);
      }
      b.stroke();
    }

    // Trampled ground where the horde stands.
    const hg = b.createLinearGradient(0, LINE_Y - 30, 0, LH);
    hg.addColorStop(0, 'rgba(60,8,6,0)');
    hg.addColorStop(0.2, 'rgba(60,8,6,0.22)');
    hg.addColorStop(1, 'rgba(40,4,4,0.4)');
    b.fillStyle = hg;
    b.fillRect(0, LINE_Y - 30, LW, LH);
    b.strokeStyle = 'rgba(255,70,60,0.35)';
    b.lineWidth = 3;
    b.setLineDash([14, 10]);
    b.beginPath();
    for (let x = 0; x <= LW; x += 8) b.lineTo(x, LINE_Y + 6 + Math.sin(x * 0.07) * 2);
    b.stroke();
    b.setLineDash([]);

    // Canyon walls.
    for (const side of [-1, 1]) {
      const outer = side < 0 ? -6 : LW + 6;
      b.beginPath();
      b.moveTo(outer, -6);
      for (let y = -6; y <= LH + 6; y += 6) b.lineTo(wallX(y, side), y);
      b.lineTo(outer, LH + 6);
      b.closePath();
      const wg = b.createLinearGradient(side < 0 ? 0 : LW, 0, side < 0 ? 46 : LW - 46, 0);
      wg.addColorStop(0, '#3e100b');
      wg.addColorStop(1, '#94401f');
      b.save();
      b.fillStyle = wg;
      b.fill();
      b.clip();
      for (let k = 1; k <= 7; k++) {
        b.strokeStyle = k % 2 ? 'rgba(255,170,110,0.13)' : 'rgba(40,8,4,0.22)';
        b.lineWidth = 2;
        b.beginPath();
        for (let y = -6; y <= LH + 6; y += 8) b.lineTo(wallX(y, side) + side * k * 5 + Math.sin(y * 0.11 + k) * 1.5, y);
        b.stroke();
      }
      b.restore();
      b.strokeStyle = 'rgba(40,8,4,0.25)';
      b.lineWidth = 12;
      b.beginPath();
      for (let y = -6; y <= LH + 6; y += 6) b.lineTo(wallX(y, side) - side * 6, y);
      b.stroke();
      b.strokeStyle = '#e8925a';
      b.lineWidth = 2.5;
      b.beginPath();
      for (let y = -6; y <= LH + 6; y += 6) b.lineTo(wallX(y, side), y);
      b.stroke();
    }

    drawRock(b);
  }

  function drawRock(b) {
    const cx = OX;
    const cy = RY;
    b.fillStyle = 'rgba(40,6,4,0.4)';
    b.beginPath();
    b.ellipse(cx, cy + 34, 88, 16, 0, 0, Math.PI * 2);
    b.fill();
    const pts = [];
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      const rr = 1 + (hash(i * 3.3) - 0.5) * 0.16;
      pts.push([cx + Math.cos(a) * 76 * rr, cy + Math.sin(a) * 42 * rr * (Math.sin(a) < 0 ? 1.05 : 0.95)]);
    }
    b.beginPath();
    pts.forEach(([x, y], i) => (i ? b.lineTo(x, y) : b.moveTo(x, y)));
    b.closePath();
    const rg = b.createLinearGradient(0, cy - 44, 0, cy + 44);
    rg.addColorStop(0, '#c8946a');
    rg.addColorStop(0.45, '#8e5a3c');
    rg.addColorStop(1, '#4e2a1c');
    b.fillStyle = rg;
    b.fill();
    b.strokeStyle = '#3a1c10';
    b.lineWidth = 2;
    b.stroke();
    b.save();
    b.clip();
    b.fillStyle = 'rgba(255,225,190,0.22)';
    b.beginPath();
    b.ellipse(cx - 14, cy - 28, 46, 12, -0.08, 0, Math.PI * 2);
    b.fill();
    b.strokeStyle = 'rgba(50,20,10,0.45)';
    b.lineWidth = 1.4;
    b.beginPath();
    b.moveTo(cx - 52, cy - 6);
    b.lineTo(cx - 36, cy + 4);
    b.lineTo(cx - 40, cy + 20);
    b.moveTo(cx + 46, cy - 16);
    b.lineTo(cx + 58, cy + 2);
    b.stroke();
    b.restore();
    // Red paint, as on the poster.
    b.save();
    b.translate(cx + 4, cy + 22);
    b.rotate(-0.05);
    b.textAlign = 'center';
    b.fillStyle = 'rgba(200,18,28,0.9)';
    b.font = '900 8px "Arial Black", system-ui, sans-serif';
    b.fillText('THE COMEBACK IS', 0, -6);
    b.font = '900 14px "Arial Black", system-ui, sans-serif';
    b.fillText('CUDDLY', 0, 8);
    b.fillRect(-26, 11, 46, 1.6);
    b.restore();
  }

  // ---------------------------------------------------------------- sprites
  function drawShadow(x, y, rx, ry, a = 0.28) {
    ctx.fillStyle = `rgba(50,12,6,${a})`;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawBranch(c, flap) {
    c.strokeStyle = '#5b4a22';
    c.lineWidth = 1.4;
    c.beginPath();
    c.moveTo(0, 4);
    c.quadraticCurveTo(1.5, -8, 0, -22);
    c.stroke();
    for (let i = 0; i < 6; i++) {
      const ly = -20 + i * 3.6;
      for (const sx of [-1, 1]) {
        c.fillStyle = (i + (sx > 0 ? 1 : 0)) % 2 ? '#5d9a72' : '#7fb68e';
        c.beginPath();
        c.ellipse(sx * 3.4, ly + 1.4, 4.2, 1.4, sx * (-0.55 + flap * 0.08), 0, Math.PI * 2);
        c.fill();
      }
    }
  }

  // Koala seen from behind: the horde and the chief face up the canyon.
  function drawKoalaBack(c, x, y, sc, flap, shoulders) {
    c.save();
    c.translate(x, y);
    c.scale(sc, sc);
    c.strokeStyle = '#3b3128';
    c.lineWidth = 1.1;
    if (shoulders) {
      c.fillStyle = '#857869';
      c.beginPath();
      c.ellipse(0, 10, 11, 6.5, 0, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      c.fillStyle = '#b3141c';
      c.beginPath();
      c.ellipse(0, 8.5, 9, 3, 0, 0, Math.PI * 2);
      c.fill();
    }
    for (const sx of [-1, 1]) {
      c.fillStyle = '#968979';
      c.beginPath();
      c.arc(sx * 8, -5, 5.4, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      c.fillStyle = '#6f6457';
      c.beginPath();
      c.arc(sx * 8.4, -4.6, 2.6, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = '#968979';
    c.beginPath();
    c.ellipse(0, 0, 8.6, 7.6, 0, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    c.fillStyle = 'rgba(255,255,255,0.13)';
    c.beginPath();
    c.ellipse(-2, -3.5, 4.5, 2.4, -0.2, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#e3262f';
    c.lineWidth = 2.4;
    c.beginPath();
    c.moveTo(-8.4, -1.5);
    c.quadraticCurveTo(0, 1.5, 8.4, -1.5);
    c.stroke();
    c.lineWidth = 1.8;
    c.beginPath();
    c.moveTo(0, 0.2);
    c.quadraticCurveTo(-3 - flap * 2, 5, -5 - flap * 3, 9);
    c.moveTo(0, 0.2);
    c.quadraticCurveTo(3 + flap, 5, 4 + flap * 2, 10);
    c.stroke();
    c.fillStyle = '#b3141c';
    c.beginPath();
    c.arc(0, 0.2, 1.8, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }

  // Koala seen from the front: flying drop bears and koalas running home.
  function drawKoala(x, y, sc, { rot = 0, arms = 'spread', t = 0, cape = true } = {}) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(sc, sc);
    const flap = Math.sin(t * 14);
    ctx.strokeStyle = '#3b3128';
    ctx.lineWidth = 1.1;
    if (cape) {
      ctx.fillStyle = '#b3141c';
      ctx.strokeStyle = '#5a0a0e';
      ctx.beginPath();
      ctx.moveTo(-6, -2);
      ctx.quadraticCurveTo(-15 - flap * 2, 8, -13 - flap * 3, 17);
      ctx.lineTo(13 + flap * 3, 17);
      ctx.quadraticCurveTo(15 + flap * 2, 8, 6, -2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = '#857869';
    ctx.strokeStyle = '#3b3128';
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      if (arms === 'spread') ctx.ellipse(sx * 11, -3 + flap * sx, 3, 6, sx * -1.1, 0, Math.PI * 2);
      else ctx.ellipse(sx * 8.5, 4 + Math.sin(t * 16 + sx * 1.6) * 2.5, 3, 5, sx * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    if (arms === 'spread') {
      ctx.fillStyle = '#26211d';
      for (const sx of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(sx * 16, -6 + flap * sx, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.fillStyle = '#968979';
    ctx.beginPath();
    ctx.ellipse(0, 4, 8.5, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#d8cbb6';
    ctx.beginPath();
    ctx.ellipse(0, 6, 4.8, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#d61e26';
    ctx.beginPath();
    ctx.ellipse(0, -1.5, 7.5, 2.6, 0, 0, Math.PI * 2);
    ctx.fill();
    for (const sx of [-1, 1]) {
      ctx.fillStyle = '#968979';
      ctx.strokeStyle = '#3b3128';
      ctx.beginPath();
      ctx.arc(sx * 7, -11, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#f2e9dc';
      ctx.beginPath();
      ctx.arc(sx * 7.4, -10.5, 2.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#968979';
    ctx.strokeStyle = '#3b3128';
    ctx.beginPath();
    ctx.ellipse(0, -7, 7, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = '#e3262f';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(-7.4, -9);
    ctx.lineTo(7.4, -9);
    ctx.moveTo(6.8, -9);
    ctx.quadraticCurveTo(11, -10 + flap * 2, 15, -7 + flap * 3);
    ctx.moveTo(6.8, -9);
    ctx.quadraticCurveTo(10, -7 - flap, 13.5, -3 - flap * 2);
    ctx.stroke();
    ctx.strokeStyle = '#1a1612';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(-4.6, -8);
    ctx.lineTo(-1.4, -6.6);
    ctx.moveTo(4.6, -8);
    ctx.lineTo(1.4, -6.6);
    ctx.stroke();
    ctx.fillStyle = '#1a1612';
    ctx.beginPath();
    ctx.arc(-3, -5.6, 1, 0, Math.PI * 2);
    ctx.arc(3, -5.6, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#26211d';
    ctx.beginPath();
    ctx.ellipse(0, -3.6, 2.4, 2.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.arc(-0.8, -4.6, 0.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawBottle(x, y, angle, size = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.scale(size, size);
    ctx.fillStyle = 'rgba(70,225,180,0.95)';
    ctx.strokeStyle = '#0a5c4c';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-4, 8);
    ctx.lineTo(-4, -2);
    ctx.quadraticCurveTo(-4, -6, -2, -7);
    ctx.lineTo(-2, -10);
    ctx.lineTo(2, -10);
    ctx.lineTo(2, -7);
    ctx.quadraticCurveTo(4, -6, 4, -2);
    ctx.lineTo(4, 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#0b3d2f';
    ctx.fillRect(-2.4, -12.5, 4.8, 3);
    ctx.fillStyle = '#e3141c';
    ctx.fillRect(-4, -0.5, 8, 3.2);
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.fillRect(-2.8, -1, 1.2, 8);
    ctx.restore();
  }

  function drawTablets(cx, cy, w, h) {
    for (const side of [-1, 1]) {
      const x = cx + side * (w + 0.6);
      ctx.fillStyle = '#9b9285';
      ctx.strokeStyle = '#4e463c';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(x - w, cy + h);
      ctx.lineTo(x - w, cy - h + w);
      ctx.arc(x, cy - h + w, w, Math.PI, 0);
      ctx.lineTo(x + w, cy + h);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = 'rgba(50,40,30,0.6)';
      ctx.lineWidth = 0.8;
      for (let l = 0; l < 4; l++) {
        const ly = cy - h + w + 1 + l * ((2 * h - w) / 4.5);
        ctx.beginPath();
        ctx.moveTo(x - w * 0.55, ly);
        ctx.lineTo(x + w * 0.55, ly);
        ctx.stroke();
      }
    }
  }

  function drawMoses(m) {
    const boss = m.type === 'boss';
    const sc = boss ? 1.9 : 1;
    const x = m.x;
    const y = m.y;
    let alpha = 1;
    let rot = 0;
    if (!m.alive) {
      const p = 1 - m.fade / 0.8;
      rot = p * 1.3 * m.fallDir;
      alpha = clamp(1 - p * p, 0, 1);
    } else if (m.stun > 0) {
      rot = Math.sin(m.t * 38) * 0.12;
    }
    if (m.dome > 0) drawDome(m);
    drawShadow(x, y + 13 * sc, 11 * sc, 4 * sc);
    const walking = m.alive && m.stun <= 0 && !m.atLine;
    const bob = walking ? Math.abs(Math.sin(m.t * 7)) * -1.6 : 0;
    const raised = m.dome > 0 || m.raise > 0;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y + bob);
    ctx.rotate(rot);
    ctx.scale(sc, sc);

    if (boss) {
      const glow = ctx.createRadialGradient(0, -6, 4, 0, -6, 34);
      glow.addColorStop(0, 'rgba(143,182,255,0.55)');
      glow.addColorStop(1, 'rgba(143,182,255,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, -6, 34, 0, Math.PI * 2);
      ctx.fill();
    }

    // robe
    ctx.fillStyle = '#1c48b8';
    ctx.strokeStyle = '#0a1f5c';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-8, -5);
    ctx.quadraticCurveTo(0, -9, 8, -5);
    ctx.lineTo(11, 12);
    ctx.quadraticCurveTo(0, 16, -11, 12);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(240,232,210,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-4, -6);
    ctx.lineTo(-6, 13.5);
    ctx.moveTo(4, -6);
    ctx.lineTo(6, 13.5);
    ctx.stroke();
    ctx.fillStyle = '#7a4a22';
    ctx.fillRect(-9.5, 2, 19, 2.6);

    // arms and props
    const skin = '#c99a72';
    const sleeve = (x0, y0, x1, y1) => {
      ctx.strokeStyle = '#163ea6';
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.fillStyle = skin;
      ctx.beginPath();
      ctx.arc(x1, y1, 2.4, 0, Math.PI * 2);
      ctx.fill();
    };
    const staff = (x0, y0, x1, y1, glow) => {
      ctx.strokeStyle = '#6b4423';
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x1 - 2.6, y1, 2.6, 0, Math.PI, true);
      ctx.stroke();
      if (glow) {
        ctx.fillStyle = 'rgba(160,210,255,0.8)';
        ctx.beginPath();
        ctx.arc(x1 - 1, y1 - 2, 4 + Math.sin(m.t * 20) * 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    if (m.type === 'blaster') {
      const lift = raised ? -7 : 0;
      for (const side of [-1, 1]) {
        sleeve(side * 6, -3, side * 13, 1 + lift);
        drawBottle(side * 14, -1 + lift, side * (raised ? 0.4 : 2.6), 0.85);
      }
    } else if (m.type === 'tablet' && m.hp > 1) {
      sleeve(-6, -3, -7, 4);
      sleeve(6, -3, 7, 4);
      drawTablets(0, 5, 5, 9);
    } else if (raised) {
      sleeve(-6, -4, -9, -17);
      sleeve(6, -4, 9, -17);
      staff(9, -2, 10, -36, true);
    } else {
      sleeve(-6, -3, -10, 5);
      sleeve(6, -3, 10, 3);
      staff(10.5, 13, 11.5, -22, false);
    }

    // head: white hair, face, beard
    ctx.fillStyle = '#e9e3d6';
    ctx.strokeStyle = '#8f877a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(0, -12.5, 7.2, 7.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.ellipse(0, -12, 4.6, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e9e3d6';
    ctx.beginPath();
    ctx.moveTo(-5, -11.5);
    ctx.quadraticCurveTo(-5.6, -3, 0, 1);
    ctx.quadraticCurveTo(5.6, -3, 5, -11.5);
    ctx.quadraticCurveTo(0, -7.6, -5, -11.5);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(140,130,115,0.7)';
    ctx.beginPath();
    ctx.moveTo(-1.5, -7);
    ctx.lineTo(-1.2, -2);
    ctx.moveTo(1.5, -7);
    ctx.lineTo(1.2, -2);
    ctx.stroke();
    ctx.strokeStyle = '#f4efe4';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-3.4, -15.4);
    ctx.lineTo(-0.8, -14.4);
    ctx.moveTo(3.4, -15.4);
    ctx.lineTo(0.8, -14.4);
    ctx.stroke();
    ctx.fillStyle = '#1a1612';
    ctx.beginPath();
    ctx.arc(-1.9, -13, 0.8, 0, Math.PI * 2);
    ctx.arc(1.9, -13, 0.8, 0, Math.PI * 2);
    ctx.fill();

    if (!m.alive) {
      // A koala hug to see him off.
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = alpha;
      drawKoala(x, y - 18 * sc, 0.7, { rot: rot * 0.5, arms: 'spread', t: m.t, cape: false });
    }
    ctx.restore();

    if (m.alive && m.stun > 0) {
      ctx.fillStyle = '#ffe9a8';
      for (let i = 0; i < 3; i++) {
        const a = m.t * 6 + (i * Math.PI * 2) / 3;
        ctx.beginPath();
        ctx.arc(x + Math.cos(a) * 9 * sc, y - 22 * sc + Math.sin(a) * 3, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (boss && m.alive) {
      const w = 56;
      const yy = y - 58;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(x - w / 2 - 1.5, yy - 1.5, w + 3, 7);
      ctx.fillStyle = '#2f6bff';
      ctx.fillRect(x - w / 2, yy, w * clamp(m.hp / m.maxHp, 0, 1), 4);
    }

    if (m.atLine && m.alive && m.raise > 0) {
      // The parting: blue swoosh into the horde.
      const p = m.raise / 0.5;
      ctx.strokeStyle = `rgba(143,182,255,${p * 0.9})`;
      ctx.lineWidth = 4;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(x, y + 10);
        ctx.quadraticCurveTo(x + side * 30, y + 26, x + side * (40 + (1 - p) * 30), y + 60);
        ctx.stroke();
      }
    }
  }

  function drawDome(m) {
    const p = Math.min(1, (1.9 - m.dome) / 0.2, m.dome / 0.25);
    const r = DOME_R * (0.6 + 0.4 * p);
    const grd = ctx.createRadialGradient(m.x, m.y, r * 0.3, m.x, m.y, r);
    grd.addColorStop(0, 'rgba(63,140,255,0.05)');
    grd.addColorStop(0.8, `rgba(63,140,255,${0.22 * p})`);
    grd.addColorStop(1, `rgba(160,210,255,${0.5 * p})`);
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(m.x, m.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(200,230,255,${0.85 * p})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 8]);
    ctx.lineDashOffset = -g.t * 40;
    ctx.beginPath();
    ctx.arc(m.x, m.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ---------------------------------------------------------------- render
  function render() {
    const w = canvas.width;
    const h = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (!g) {
      if (bg) ctx.drawImage(bg, 0, 0);
      return;
    }
    const s = scale * dpr;
    let ox = 0;
    let oy = 0;
    if (g.shake > 0) {
      ox = rand(-g.shake, g.shake) * 0.5;
      oy = rand(-g.shake, g.shake) * 0.5;
    }
    ctx.fillStyle = '#3e100b';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bg, ox * s, oy * s);
    ctx.setTransform(s, 0, 0, s, ox * s, oy * s);

    drawPickups();
    drawHorde();
    drawFlags();
    const order = g.moses.slice().sort((a, b) => a.y - b.y);
    for (const m of order) drawMoses(m);
    drawRunners();
    drawChief();
    drawStampede();
    drawBottles();
    drawFlyers();
    drawParticles();
    drawTossed();
    drawAim();
    drawTexts();

    ctx.setTransform(s, 0, 0, s, 0, 0);
    drawVignette();
    drawBanner();
    if (g.flash > 0) {
      ctx.fillStyle = `rgba(${g.flashColor},${g.flash * 0.35})`;
      ctx.fillRect(0, 0, LW, LH);
    }
  }

  function drawHorde() {
    const n = Math.min(g.horde, slots.length);
    for (let i = n - 1; i >= 0; i--) {
      const sl = slots[i];
      const bob = Math.sin(g.t * 5 + sl.ph) * 1.1;
      ctx.drawImage(backSprite, sl.x - 14, sl.y - 13 + bob, 28, 28);
    }
    if (g.horde > slots.length) {
      ctx.font = '900 14px "Arial Black", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      const label = `+${g.horde - slots.length}`;
      ctx.strokeText(label, OX - 92, LH - 12);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, OX - 92, LH - 12);
    }
  }

  function drawFlag(x, y, h, ph, lean = 0) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(lean);
    ctx.strokeStyle = '#4a2c14';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -h);
    ctx.stroke();
    const t = g ? g.t : 0;
    const w1 = Math.sin(t * 6 + ph) * 2.5;
    const w2 = Math.sin(t * 6 + ph + 1.5) * 2.5;
    ctx.fillStyle = '#d61e26';
    ctx.strokeStyle = '#6b0008';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -h);
    ctx.quadraticCurveTo(10, -h - 3 + w1, 22, -h + w2);
    ctx.lineTo(22, -h + 15 + w2);
    ctx.quadraticCurveTo(10, -h + 12 + w1, 0, -h + 15);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(80,0,6,0.75)';
    const ex = 11;
    const ey = -h + 7.5 + w1 * 0.6;
    ctx.beginPath();
    ctx.arc(ex, ey + 1, 3.6, 0, Math.PI * 2);
    ctx.arc(ex - 3.6, ey - 2, 2.2, 0, Math.PI * 2);
    ctx.arc(ex + 3.6, ey - 2, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawFlags() {
    const spots = [[52, 34], [128, 70], [276, 70], [350, 34]];
    spots.forEach(([x, dy], i) => {
      if (g.horde > i * 5 + 2) drawFlag(x, LINE_Y + dy, 34, i * 1.7);
    });
    drawFlag(wallX(LINE_Y * 0.35, -1) - 4, LINE_Y * 0.35, 30, 0.4, 0.35);
    drawFlag(wallX(LINE_Y * 0.62, 1) + 4, LINE_Y * 0.62, 30, 2.2, -0.35);
  }

  function drawChief() {
    const t = g.t;
    const flap = Math.sin(t * 4);
    const throwing = g.chiefThrow / 0.3;
    ctx.save();
    ctx.translate(OX, OY + 4);
    ctx.scale(1.45, 1.45);
    ctx.fillStyle = '#b3141c';
    ctx.strokeStyle = '#5a0a0e';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-7, -2);
    ctx.quadraticCurveTo(-15 - flap * 2, 10, -13 - flap * 3, 22);
    ctx.quadraticCurveTo(0, 25, 13 + flap * 3, 22);
    ctx.quadraticCurveTo(15 + flap * 2, 10, 7, -2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(90,10,14,0.6)';
    ctx.beginPath();
    ctx.moveTo(-3, 2);
    ctx.lineTo(-5 - flap, 21);
    ctx.moveTo(3, 2);
    ctx.lineTo(5 + flap, 21);
    ctx.stroke();
    ctx.fillStyle = '#857869';
    ctx.strokeStyle = '#3b3128';
    ctx.beginPath();
    ctx.ellipse(0, 2, 8, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // right arm holds the eucalyptus branch aloft
    ctx.save();
    ctx.translate(7.5, -3);
    ctx.rotate(0.35 + Math.sin(t * 3) * 0.12);
    ctx.fillStyle = '#857869';
    ctx.beginPath();
    ctx.ellipse(0, -6, 3, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.translate(0, -12);
    drawBranch(ctx, flap);
    ctx.restore();
    // left arm: windup while aiming, swing on release
    ctx.save();
    ctx.translate(-7.5, -3);
    ctx.rotate(aim ? -0.2 : throwing > 0 ? -2.4 + throwing * 2.2 : -0.5);
    ctx.fillStyle = '#857869';
    ctx.beginPath();
    ctx.ellipse(0, -6, 3, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    drawKoalaBack(ctx, 0, -9, 1, flap, false);
    ctx.restore();

    if (aim && aim.target && g.horde > 0) {
      const [lx, ly] = launchFrom();
      drawKoala(lx - 12, ly - 12, 0.7, { rot: -0.3, arms: 'spread', t, cape: true });
    }
  }

  function drawRunners() {
    for (const r of g.runners) {
      drawShadow(r.x, r.y + 7, 6, 2.4);
      drawKoala(r.x, r.y - Math.abs(Math.sin(r.t * 14)) * 2.5, 0.6, { arms: 'run', t: r.t, cape: true });
    }
  }

  function drawFlyers() {
    for (const f of g.flyers) {
      const sc = 0.95 + (0.6 * f.z) / (f.z + 80);
      drawShadow(f.x, f.y + 4, 10 / (1 + f.z / 70), 4 / (1 + f.z / 70), 0.35);
      drawKoala(f.x, f.y - f.z, sc, { rot: Math.sin(f.t * 10) * 0.35 * f.spin, arms: 'spread', t: g.t, cape: true });
    }
  }

  function drawBottles() {
    for (const b of g.bottles) {
      drawShadow(b.x, b.y + 4, 6 / (1 + b.z / 80), 2.5 / (1 + b.z / 80), 0.3);
      drawBottle(b.x, b.y - b.z, b.t * b.spin, 1.1);
    }
  }

  function drawPickups() {
    for (const it of g.pickups) {
      if (it.life < 2 && Math.floor(it.life * 8) % 2 === 0) continue;
      const pulse = 0.5 + Math.sin(it.t * 5) * 0.5;
      const col = it.type === 'leaves' ? '143,209,138' : '255,207,74';
      const glow = ctx.createRadialGradient(it.x, it.y, 2, it.x, it.y, 26);
      glow.addColorStop(0, `rgba(${col},${0.45 + pulse * 0.25})`);
      glow.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(it.x, it.y, 26, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(255,255,255,${0.35 + pulse * 0.3})`;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 5]);
      ctx.lineDashOffset = -it.t * 12;
      ctx.beginPath();
      ctx.arc(it.x, it.y, PICKUP_R - 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      drawShadow(it.x, it.y + 9, 9, 3);
      if (it.type === 'leaves') {
        ctx.save();
        ctx.translate(it.x, it.y + 6 - Math.sin(it.t * 4) * 1.5);
        ctx.rotate(Math.sin(it.t * 2) * 0.25);
        drawBranch(ctx, Math.sin(it.t * 3));
        ctx.rotate(0.7);
        drawBranch(ctx, Math.sin(it.t * 3 + 1));
        ctx.restore();
      } else {
        drawFlag(it.x - 6, it.y + 10, 26, it.t);
        drawKoala(it.x + 8, it.y + 2, 0.5, { arms: 'run', t: it.t * 0.5, cape: false });
      }
    }
  }

  function drawStampede() {
    const s = g.stampede;
    if (!s) return;
    const grd = ctx.createLinearGradient(0, s.y, 0, Math.min(LH, s.y + 220));
    grd.addColorStop(0, 'rgba(214,30,38,0.55)');
    grd.addColorStop(1, 'rgba(214,30,38,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, s.y, LW, 220);
    for (let row = 0; row < 3; row++) {
      for (let x = 22 + row * 9; x < LW; x += 21) {
        const y = s.y + row * 16 + Math.abs(Math.sin(g.t * 18 + x)) * -3;
        ctx.drawImage(backSprite, x - 14 * 1.3, y - 13 * 1.3, 28 * 1.3, 28 * 1.3);
      }
    }
    drawFlag(LW * 0.3, s.y + 30, 40, 0);
    drawFlag(LW * 0.7, s.y + 30, 40, 2);
  }

  function heartPath(x, y, sz) {
    ctx.beginPath();
    ctx.moveTo(x, y + sz * 0.9);
    ctx.bezierCurveTo(x - sz * 1.6, y - sz * 0.2, x - sz * 0.6, y - sz * 1.3, x, y - sz * 0.35);
    ctx.bezierCurveTo(x + sz * 0.6, y - sz * 1.3, x + sz * 1.6, y - sz * 0.2, x, y + sz * 0.9);
    ctx.closePath();
  }

  function drawParticles() {
    for (const p of g.particles) {
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1) * (p.kind === 'mote' ? 0.5 : 1);
      ctx.fillStyle = p.color;
      if (p.kind === 'heart') {
        heartPath(p.x, p.y, p.size);
        ctx.fill();
      } else if (p.kind === 'leaf' || p.kind === 'stone') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        if (p.kind === 'leaf') {
          ctx.beginPath();
          ctx.ellipse(0, 0, p.size * 1.4, p.size * 0.5, 0, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.8);
        }
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawTossed() {
    for (const k of g.tossed) {
      ctx.globalAlpha = clamp(k.life / 0.6, 0, 1);
      drawKoala(k.x, k.y, 0.6, { rot: k.rot, arms: 'spread', t: g.t, cape: false });
    }
    ctx.globalAlpha = 1;
  }

  function drawAim() {
    if (!aim) return;
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(aim.sx, aim.sy);
    ctx.lineTo(aim.cx, aim.cy);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.arc(aim.sx, aim.sy, 5, 0, Math.PI * 2);
    ctx.fill();
    if (!aim.target) return;
    const [tx, ty] = aim.target;
    const [x0, y0] = launchFrom();
    const H = 30 + dist(x0, y0, tx, ty) * 0.22;
    const N = 16;
    const off = (g.t * 2.2) % 1;
    for (let i = 0; i < N; i++) {
      const p = (i + off) / N;
      const x = lerp(x0, tx, p);
      const y = lerp(y0, ty, p) - 4 * H * p * (1 - p);
      ctx.fillStyle = 'rgba(80,0,6,0.55)';
      ctx.beginPath();
      ctx.arc(x, y, 3.4 - p * 1.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(x, y, 2.2 - p * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
    const lock = lockedMoses(tx, ty) !== null;
    const col = lock ? '#ffcf4a' : '#ff3b3b';
    const r = lock ? 15 + Math.sin(g.t * 16) * 2 : 14;
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(tx, ty, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = col;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([7, 5]);
    ctx.lineDashOffset = -g.t * 30;
    ctx.beginPath();
    ctx.arc(tx, ty, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      ctx.moveTo(tx + dx * (r - 5), ty + dy * (r - 5));
      ctx.lineTo(tx + dx * (r + 5), ty + dy * (r + 5));
    }
    ctx.stroke();
  }

  function drawTexts() {
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    for (const t of g.texts) {
      const a = clamp(1.4 - t.t * 1.3, 0, 1);
      ctx.globalAlpha = a;
      ctx.font = `900 ${t.size}px "Arial Black", system-ui, sans-serif`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      // Keep labels clear of the HTML HUD along the top edge.
      const x = clamp(t.x, 70, LW - 70);
      const y = Math.max(t.y, 96 + t.size);
      ctx.strokeText(t.text, x, y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, x, y);
    }
    ctx.globalAlpha = 1;
  }

  function drawVignette() {
    const v = ctx.createRadialGradient(LW / 2, LH * 0.5, LH * 0.3, LW / 2, LH * 0.5, LH * 0.8);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(30,0,4,0.45)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, LW, LH);
    if (g.horde <= 5 && g.dying <= 0) {
      const a = 0.22 + Math.sin(g.t * 6) * 0.1;
      const r = ctx.createRadialGradient(LW / 2, LH / 2, LH * 0.25, LW / 2, LH / 2, LH * 0.75);
      r.addColorStop(0, 'rgba(47,107,255,0)');
      r.addColorStop(1, `rgba(47,107,255,${a})`);
      ctx.fillStyle = r;
      ctx.fillRect(0, 0, LW, LH);
    }
  }

  function drawBanner() {
    const b = g.banners[0];
    if (!b) return;
    const inT = clamp(b.t / 0.25, 0, 1);
    const outT = clamp((2 - b.t) / 0.35, 0, 1);
    const a = Math.min(inT, outT);
    const sc = 0.6 + 0.4 * (1 - Math.pow(1 - inT, 3));
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(LW / 2, LH * 0.3);
    ctx.scale(sc, sc);
    ctx.rotate(-0.04);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let size = 30;
    ctx.font = `900 ${size}px "Arial Black", system-ui, sans-serif`;
    const maxW = LW - 40;
    const tw = ctx.measureText(b.text).width;
    if (tw > maxW) {
      size = Math.floor((size * maxW) / tw);
      ctx.font = `900 ${size}px "Arial Black", system-ui, sans-serif`;
    }
    ctx.lineJoin = 'round';
    ctx.lineWidth = 7;
    ctx.strokeStyle = '#4a0a0e';
    ctx.strokeText(b.text, 0, 0);
    ctx.fillStyle = b.color;
    ctx.fillText(b.text, 0, 0);
    ctx.restore();
    ctx.textBaseline = 'alphabetic';
  }

  // ---------------------------------------------------------------- HUD
  const hud = {
    horde: $('horde'),
    army: document.querySelector('.army'),
    mult: $('mult'),
    score: $('score'),
    waveLabel: $('waveLabel'),
    waveFill: $('waveFill'),
    btn: $('stampedeBtn'),
    count: $('stampedeCount'),
    ring: $('rallyProgress'),
    cache: {},
  };

  function setText(key, el, val) {
    if (hud.cache[key] !== val) {
      hud.cache[key] = val;
      el.textContent = val;
    }
  }

  function updateHud() {
    setText('horde', hud.horde, String(g.horde));
    const low = g.horde <= 5;
    if (hud.cache.low !== low) {
      hud.cache.low = low;
      hud.army.classList.toggle('low', low);
    }
    const m = multiplier();
    setText('mult', hud.mult, m > 1 ? `x${m} COMBO` : '');
    setText('score', hud.score, Math.floor(g.score).toLocaleString());
    setText('wave', hud.waveLabel, g.wave > 0 ? `WAVE ${g.wave}` : 'GET READY');
    let left = 1;
    if (g.waveState === 'fight') {
      const remaining = g.toSpawn + g.moses.filter((x) => x.alive).length;
      left = clamp(remaining / g.waveTotal, 0, 1);
    } else if (g.wave > 0) {
      left = 0;
    }
    const lf = Math.round(left * 100) / 100;
    if (hud.cache.left !== lf) {
      hud.cache.left = lf;
      hud.waveFill.style.transform = `scaleX(${lf})`;
    }
    setText('charges', hud.count, String(g.charges));
    const prog = g.charges >= MAX_CHARGES ? 1 : Math.round(g.rally) / RALLY_PER_CHARGE;
    if (hud.cache.prog !== prog) {
      hud.cache.prog = prog;
      hud.ring.style.strokeDashoffset = String(289 * (1 - prog));
    }
    const ready = g.charges > 0;
    if (hud.cache.ready !== ready) {
      hud.cache.ready = ready;
      hud.btn.classList.toggle('ready', ready);
      hud.btn.classList.toggle('empty', !ready);
    }
  }

  // ---------------------------------------------------------------- flow
  const screens = { title: $('title'), pause: $('pause'), over: $('over') };

  function show(name) {
    for (const [k, el] of Object.entries(screens)) el.classList.toggle('hidden', k !== name);
    $('hud').classList.toggle('hidden', name === 'title' || name === 'over');
  }

  const getBest = () => Number(localStorage.getItem(BEST_KEY) || 0);

  function refreshBest() {
    const b = getBest();
    $('bestLine').textContent = b > 0 ? `BEST: ${b.toLocaleString()}` : '';
  }

  function start() {
    Sfx.init();
    resize();
    newGame();
    aim = null;
    hud.cache = {};
    state = 'play';
    show(null);
    $('hud').classList.remove('hidden');
    updateHud();
    last = performance.now();
  }

  function pause() {
    if (state !== 'play') return;
    state = 'pause';
    aim = null;
    show('pause');
  }

  function resume() {
    if (state !== 'pause') return;
    Sfx.init();
    state = 'play';
    show(null);
    $('hud').classList.remove('hidden');
    last = performance.now();
  }

  function toTitle() {
    state = 'title';
    refreshBest();
    show('title');
  }

  function gameOver() {
    state = 'over';
    const score = Math.floor(g.score);
    const prev = getBest();
    const isBest = score > prev;
    if (isBest) localStorage.setItem(BEST_KEY, String(score));
    $('oScore').textContent = score.toLocaleString();
    $('oWave').textContent = String(g.wave);
    $('oCuddled').textContent = String(g.cuddled);
    $('oChain').textContent = g.bestChain > 0 ? `x${g.bestChain}` : '0';
    $('oHorde').textContent = String(g.peakHorde);
    $('oBest').textContent = Math.max(score, prev).toLocaleString();
    $('overTitle').innerHTML = isBest
      ? 'THE HORDE<br>WAS PARTED<span class="new-best">★ NEW BEST ★</span>'
      : 'THE HORDE<br>WAS PARTED';
    show('over');
  }

  function frame(now) {
    const dt = clamp((now - last) / 1000 || 0, 0, 0.033);
    last = now;
    if (state === 'play') {
      update(dt);
      if (state === 'play') updateHud();
    }
    if (state !== 'title') render();
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- input
  const toLogical = (e) => {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) / scale, (e.clientY - r.top) / scale];
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (state !== 'play' || !g || g.dying > 0 || aim) return;
    const [x, y] = toLogical(e);
    aim = { id: e.pointerId, sx: x, sy: y, cx: x, cy: y, target: null };
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!aim || aim.id !== e.pointerId) return;
    [aim.cx, aim.cy] = toLogical(e);
    aim.target = aimTarget(aim);
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!aim || aim.id !== e.pointerId) return;
    const target = aim.target;
    aim = null;
    if (target) throwKoala(target[0], target[1]);
  });
  canvas.addEventListener('pointercancel', (e) => {
    if (aim && aim.id === e.pointerId) aim = null;
  });

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === ' ') {
      e.preventDefault();
      if (state === 'play') stampede();
      else if (state === 'title' || state === 'over') start();
    } else if (k === 'escape' || k === 'p') {
      if (state === 'play') pause();
      else if (state === 'pause') resume();
    }
  });

  $('stampedeBtn').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    stampede();
  });
  $('pauseBtn').addEventListener('click', pause);
  $('playBtn').addEventListener('click', start);
  $('againBtn').addEventListener('click', start);
  $('homeBtn').addEventListener('click', toTitle);
  $('resumeBtn').addEventListener('click', resume);
  $('quitBtn').addEventListener('click', toTitle);

  const muteBtn = $('muteBtn');
  const syncMute = () => { muteBtn.textContent = Sfx.muted ? '🔇' : '🔊'; };
  muteBtn.addEventListener('click', () => {
    Sfx.setMuted(!Sfx.muted);
    syncMute();
  });
  syncMute();

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
  });
  window.addEventListener('blur', pause);
  window.addEventListener('resize', resize);
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  // Debug hook for automated checks.
  window.__koala = {
    get state() { return state; },
    get g() { return g; },
    get layout() { return { LW, LH, LINE_Y, OX, OY }; },
    start,
    stampede,
    throwAt: throwKoala,
  };

  refreshBest();
  resize();
  requestAnimationFrame(frame);
})();
