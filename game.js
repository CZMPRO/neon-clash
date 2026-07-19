(() => {
  "use strict";
  const C = document.querySelector("#game"),
    ctx = C.getContext("2d"),
    screen = document.querySelector("#screen"),
    announce = document.querySelector("#announce"),
    touch = document.querySelector("#touch"),
    homeButton = document.querySelector("#home-button"),
    shell = document.querySelector("#game-shell");
  ctx.imageSmoothingEnabled = false;
  const W = 384,
    H = 216,
    FLOOR = 174,
    clamp = (v, a, b) => Math.max(a, Math.min(b, v)),
    lerp = (a, b, t) => a + (b - a) * t,
    rnd = (a, b) => a + Math.random() * (b - a);
  const readStore = (key, fallback) => {
    try {
      return Object.assign(
        {},
        fallback,
        JSON.parse(localStorage.getItem(key) || "{}"),
      );
    } catch {
      return Object.assign({}, fallback);
    }
  };
  const SETTINGS = readStore("neonSettings", {
    music: 0.35,
    sfx: 0.7,
    shake: 1,
    contrast: false,
    reducedFx: matchMedia("(prefers-reduced-motion: reduce)").matches,
  });
  const PROGRESS = readStore("neonProgress", {
    bestFloor: 0,
    bestScore: 0,
    clears: 0,
    tutorial: false,
  });
  const save = () =>
    localStorage.setItem("neonSettings", JSON.stringify(SETTINGS));
  const saveProgress = () =>
    localStorage.setItem("neonProgress", JSON.stringify(PROGRESS));

  function fitGameShell() {
    const compact = matchMedia("(pointer: coarse), (max-width: 700px)").matches;
    if (compact) {
      shell.style.removeProperty("width");
      shell.style.removeProperty("height");
      return;
    }
    const scale = clamp(
      Math.floor(Math.min((innerWidth - 24) / W, (innerHeight - 24) / H)),
      1,
      4,
    );
    shell.style.width = `${W * scale}px`;
    shell.style.height = `${H * scale}px`;
  }
  addEventListener("resize", fitGameShell);
  fitGameShell();
  function syncShellControls(state) {
    const inCombat = ["fight", "roundIntro"].includes(state);
    homeButton.hidden = ["title", "homeConfirm"].includes(state);
    homeButton.classList.toggle("in-combat", inCombat);
    homeButton.setAttribute(
      "aria-label",
      inCombat ? "暂停并返回游戏首页" : "返回游戏首页",
    );
  }
  const Input = {
    held: {},
    pressed: {},
    lastDir: { left: 0, right: 0 },
    map: {
      KeyA: "left",
      KeyD: "right",
      KeyW: "jump",
      KeyS: "down",
      KeyJ: "light",
      KeyK: "heavy",
      KeyL: "special",
      KeyI: "guard",
      KeyU: "ultimate",
      ShiftLeft: "shift",
      ShiftRight: "shift",
      Escape: "escape",
      Enter: "enter",
      ArrowUp: "menuUp",
      ArrowDown: "menuDown",
      ArrowLeft: "menuLeft",
      ArrowRight: "menuRight",
      KeyR: "restart",
    },
    down(k) {
      if (!this.held[k]) this.pressed[k] = true;
      this.held[k] = true;
    },
    up(k) {
      this.held[k] = false;
    },
    eat(k) {
      const v = this.pressed[k];
      delete this.pressed[k];
      return v;
    },
    clear() {
      this.held = {};
      this.pressed = {};
    },
  };
  const Pad = {
    held: {},
    pressed: {},
    previous: {},
    connected: false,
    poll() {
      const pad = navigator.getGamepads?.()[0];
      if (!pad) {
        this.connected = false;
        this.held = {};
        this.pressed = {};
        this.previous = {};
        return;
      }
      this.connected = true;
      const button = (n) => !!pad.buttons[n]?.pressed;
      const axis = pad.axes[0] || 0;
      const current = {
        left: axis < -0.35 || button(14),
        right: axis > 0.35 || button(15),
        down: button(13),
        jump: button(0) || button(12),
        light: button(2),
        heavy: button(3),
        special: button(1),
        guard: button(4),
        ultimate: button(5),
        shift: button(6) || button(7),
        escape: button(9),
      };
      for (const [key, value] of Object.entries(current)) {
        if (value && !this.previous[key]) this.pressed[key] = true;
      }
      this.previous = current;
      this.held = current;
    },
    eat(k) {
      const value = this.pressed[k];
      delete this.pressed[k];
      return value;
    },
    clear() {
      this.held = {};
      this.pressed = {};
      this.previous = {};
    },
  };
  addEventListener("keydown", (e) => {
    const k = Input.map[e.code];
    if (k) {
      e.preventDefault();
      Input.down(k);
    }
    if (
      !screen.classList.contains("hidden") &&
      (e.code === "ArrowDown" || e.code === "ArrowUp")
    ) {
      const items = [...screen.querySelectorAll('button,[tabindex="0"]')],
        i = Math.max(0, items.indexOf(document.activeElement)),
        n =
          e.code === "ArrowDown"
            ? (i + 1) % items.length
            : (i - 1 + items.length) % items.length;
      items[n]?.focus();
    }
  });
  addEventListener("keyup", (e) => {
    const k = Input.map[e.code];
    if (k) {
      e.preventDefault();
      Input.up(k);
    }
  });
  addEventListener("blur", () => {
    Input.clear();
    Pad.clear();
    if (Game.state === "fight") Game.pause();
  });
  addEventListener("visibilitychange", () => {
    if (document.hidden && Game.state === "fight") Game.pause();
  });
  touch.querySelectorAll("button").forEach((b) => {
    const k = b.dataset.key,
      down = (e) => {
        e.preventDefault();
        Audio.unlock();
        Input.down(k);
        b.classList.add("pressed");
      },
      up = (e) => {
        e.preventDefault();
        Input.up(k);
        b.classList.remove("pressed");
      };
    b.addEventListener("pointerdown", down);
    b.addEventListener("pointerup", up);
    b.addEventListener("pointercancel", up);
  });
  const Audio = {
    ac: null,
    master: null,
    musicTimer: 0,
    unlock() {
      if (!this.ac) {
        this.ac = new (window.AudioContext || window.webkitAudioContext)();
        this.master = this.ac.createGain();
        this.master.connect(this.ac.destination);
      }
      if (this.ac.state === "suspended") this.ac.resume();
    },
    raw(freq, dur, type, vol, slide = 0) {
      if (!this.ac) return;
      const o = this.ac.createOscillator(),
        g = this.ac.createGain(),
        t = this.ac.currentTime;
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      o.frequency.exponentialRampToValueAtTime(
        Math.max(30, freq + slide),
        t + dur,
      );
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g);
      g.connect(this.master);
      o.start(t);
      o.stop(t + dur);
    },
    tone(freq, dur = 0.08, type = "square", vol = 0.12, slide = 0) {
      if (SETTINGS.sfx) this.raw(freq, dur, type, vol * SETTINGS.sfx, slide);
    },
    music(dt, final = false) {
      if (!this.ac || !SETTINGS.music) return;
      this.musicTimer -= dt;
      if (this.musicTimer <= 0) {
        this.musicTimer = final ? 0.22 : 0.32;
        const beat = Math.floor(performance.now() / 300) % 8,
          n = [55, 55, 65, 55, 73, 65, 49, 55][beat];
        this.raw(n, 0.12, "triangle", 0.035 * SETTINGS.music, -5);
        if (beat % 2 === 0)
          this.raw(
            final ? 130 : 110,
            0.035,
            "square",
            0.018 * SETTINGS.music,
            -35,
          );
      }
    },
    hit(kind) {
      if (kind === "light") {
        this.tone(170, 0.06, "square", 0.11, -70);
      } else {
        this.tone(90, 0.14, "sawtooth", 0.18, -45);
        this.tone(55, 0.18, "triangle", 0.12, -20);
      }
    },
    ui() {
      this.tone(480, 0.04, "square", 0.06, 90);
    },
    parry() {
      this.tone(880, 0.18, "sine", 0.15, 500);
    },
    start() {
      this.tone(220, 0.1, "square", 0.1, 220);
      this.tone(440, 0.18, "square", 0.07, 300);
    },
    ko() {
      this.tone(120, 0.5, "sawtooth", 0.16, -80);
    },
  };
  document.addEventListener("pointerdown", () => Audio.unlock(), {
    once: true,
  });
  const particles = [],
    effects = [];
  function particle(x, y, col, n = 5, pow = 1) {
    for (let i = 0; i < n && particles.length < 180; i++)
      particles.push({
        x,
        y,
        vx: rnd(-55, 55) * pow,
        vy: rnd(-80, 10) * pow,
        t: rnd(0.18, 0.42),
        c: col,
        s: Math.random() < 0.3 ? 2 : 1,
      });
  }
  function castFx(f, move, hit = false) {
    const kind = move.startsWith("light")
      ? "light"
      : move === "heavy"
        ? "heavy"
        : move === "special"
          ? f.type === "chi"
            ? "fireArc"
            : "stoneWall"
          : move === "ultimate"
            ? f.type === "chi"
              ? "wing"
              : "pillar"
            : "dash";
    effects.push({
      kind,
      x: f.x + f.face * (hit ? 18 : 12),
      y: f.y - (kind === "heavy" ? 8 : 32),
      face: f.face,
      t: 0,
      max:
        kind === "light"
          ? 10
          : kind === "heavy"
            ? 22
            : kind === "stoneWall"
              ? 34
              : kind === "fireArc"
                ? 26
                : 44,
      col: f.cfg.accent,
    });
    if (effects.length > 48) effects.shift();
  }
  function drawFx(e) {
    const q = e.t / e.max,
      x = Math.round(e.x),
      y = Math.round(e.y),
      d = e.face;
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - q);
    if (e.kind === "light") {
      for (let i = 0; i < 4; i++)
        rect(x + d * (i * 5 + q * 8), y - 5 + i * 3, 8 - i, 1, e.col);
    } else if (e.kind === "heavy") {
      for (let i = 0; i < 5; i++) {
        const w = 10 + i * 10 + q * 18;
        rect(x - w / 2, y + i * 3, w, 2, i % 2 ? e.col : "#d8eef0");
      }
      for (let i = 0; i < 7; i++)
        rect(
          x + (i - 3) * 7,
          y - 4 - Math.abs(i - 3) * 2 - q * 12,
          2,
          7,
          e.col,
        );
    } else if (e.kind === "fireArc") {
      for (let i = 0; i < 9; i++) {
        const px = x + d * (i * 5 + q * 18),
          py = y - 12 + Math.abs(i - 4) * 3;
        rect(px, py, 5, 2, i % 2 ? e.col : "#f04b38");
      }
    } else if (e.kind === "stoneWall") {
      for (let i = 0; i < 5; i++) {
        rect(
          x + d * (i % 2) * 4,
          y - 4 - i * 8,
          8,
          6,
          i % 2 ? "#51d7e2" : "#9b7beb",
        );
        rect(x + d * (8 + q * 9), y - 2 - i * 7, 2, 4, "#dff6f4");
      }
    } else if (e.kind === "wing") {
      for (let s of [-1, 1])
        for (let i = 0; i < 8; i++)
          rect(
            x + d * (i * 4),
            y + s * (i * 3 + q * 10),
            7,
            2,
            i % 2 ? "#ffc75b" : "#ed4437",
          );
    } else if (e.kind === "pillar") {
      for (let i = 0; i < 9; i++) {
        rect(
          x + (i - 4) * 6,
          y - (i % 3) * 5 - q * 20,
          4,
          20 + (i % 3) * 5,
          i % 2 ? "#43d5df" : "#8a72dc",
        );
        rect(x + (i - 4) * 7, FLOOR - 3, 5, 3, "#c8edf0");
      }
    }
    ctx.restore();
  }
  const MOVES = {
    chi: {
      light1: {
        n: "流火掌 一",
        len: 19,
        a: 5,
        b: 8,
        d: 35,
        p: 19,
        k: 28,
        next: "light2",
      },
      light2: {
        n: "流火掌 二",
        len: 20,
        a: 5,
        b: 9,
        d: 38,
        p: 20,
        k: 30,
        next: "light3",
      },
      light3: { n: "流火掌 三", len: 25, a: 7, b: 11, d: 55, p: 28, k: 55 },
      heavy: {
        n: "赤羽破",
        len: 38,
        a: 15,
        b: 20,
        d: 105,
        p: 52,
        k: 78,
        heavy: 1,
        down: 1,
      },
      special: {
        n: "鸢返",
        len: 34,
        a: 9,
        b: 18,
        d: 90,
        p: 42,
        k: 70,
        dash: 150,
        heavy: 1,
      },
      dash: {
        n: "追风掌",
        len: 27,
        a: 8,
        b: 13,
        d: 62,
        p: 30,
        k: 58,
        dash: 110,
      },
      air: { n: "掠羽踢", len: 27, a: 6, b: 15, d: 58, p: 28, k: 48 },
      ultimate: {
        n: "百羽燎原",
        len: 142,
        a: 34,
        b: 98,
        d: 48,
        p: 30,
        k: 24,
        multi: 5,
        ultimate: 1,
      },
    },
    xuan: {
      light1: {
        n: "碎岩拳 一",
        len: 24,
        a: 7,
        b: 11,
        d: 48,
        p: 24,
        k: 35,
        next: "light2",
      },
      light2: { n: "碎岩拳 二", len: 29, a: 9, b: 14, d: 62, p: 31, k: 52 },
      heavy: {
        n: "镇岳击",
        len: 46,
        a: 19,
        b: 25,
        d: 135,
        p: 68,
        k: 95,
        heavy: 1,
        down: 1,
      },
      special: {
        n: "玄壁",
        len: 44,
        a: 4,
        b: 32,
        d: 110,
        p: 58,
        k: 88,
        guardMove: 1,
        heavy: 1,
      },
      dash: {
        n: "铁山靠",
        len: 34,
        a: 12,
        b: 18,
        d: 82,
        p: 43,
        k: 72,
        dash: 85,
        heavy: 1,
      },
      air: { n: "坠岩拳", len: 34, a: 8, b: 19, d: 74, p: 35, k: 60, down: 1 },
      ultimate: {
        n: "天柱坠",
        len: 154,
        a: 38,
        b: 110,
        d: 52,
        p: 35,
        k: 28,
        multi: 5,
        ultimate: 1,
      },
    },
  };
  const CHAR = {
    chi: {
      name: "赤鸢",
      hp: 950,
      speed: 78,
      jump: 186,
      posture: 250,
      col: "#ef503e",
      accent: "#ffc45b",
    },
    xuan: {
      name: "玄嶂",
      hp: 1100,
      speed: 58,
      jump: 166,
      posture: 330,
      col: "#3ccbdc",
      accent: "#9a78e9",
    },
  };
  class Fighter {
    constructor(type, x, ai = false) {
      this.type = type;
      this.cfg = Object.assign({}, CHAR[type]);
      this.ai = ai;
      if (!ai) {
        this.cfg.hp = Math.round(this.cfg.hp * 1.18);
        this.cfg.posture = Math.round(this.cfg.posture * 1.12);
        this.cfg.speed = Math.round(this.cfg.speed * 1.08);
      }
      this.damageMul = ai ? 1 : 1.14;
      this.energyMul = ai ? 1 : 1.18;
      this.x = x;
      this.y = FLOOR;
      this.vx = 0;
      this.vy = 0;
      this.face = x < W / 2 ? 1 : -1;
      this.hp = this.cfg.hp;
      this.delayedHp = this.hp;
      this.energy = 0;
      this.posture = this.cfg.posture;
      this.state = "intro";
      this.frame = 0;
      this.hitstun = 0;
      this.invuln = 0;
      this.combo = 0;
      this.comboTimer = 0;
      this.bestCombo = 0;
      this.parries = 0;
      this.wins = 0;
      this.move = null;
      this.hitSet = new Set();
      this.chain = false;
      this.low = false;
      this.stats = { damage: 0 };
      this.aiData = { timer: 0, mode: "wait", memory: [] };
    }
    reset(x) {
      Object.assign(this, {
        x,
        y: FLOOR,
        vx: 0,
        vy: 0,
        face: x < W / 2 ? 1 : -1,
        hp: this.cfg.hp,
        delayedHp: this.cfg.hp,
        energy: 0,
        posture: this.cfg.posture,
        state: "intro",
        frame: 0,
        hitstun: 0,
        invuln: 0,
        combo: 0,
        comboTimer: 0,
        move: null,
        chain: false,
        lastMulti: -99,
      });
      this.hitSet.clear();
    }
    get grounded() {
      return this.y >= FLOOR - 0.1;
    }
    get busy() {
      return (
        this.move ||
        this.hitstun > 0 ||
        ["down", "rise", "ko", "win", "intro"].includes(this.state)
      );
    }
    attack(name) {
      if (this.busy || Game.freeze > 0) return false;
      if (name === "ultimate" && this.energy < 100) return false;
      if (name === "air" && this.grounded) return false;
      this.move = Object.assign(
        { id: performance.now() + Math.random() },
        MOVES[this.type][name],
      );
      this.state = name;
      this.frame = 0;
      this.hitSet.clear();
      this.chain = false;
      castFx(this, name);
      if (name === "ultimate") {
        this.energy = 0;
        Game.cinematic = 30;
        Audio.tone(
          this.type === "chi" ? 540 : 130,
          0.4,
          "sawtooth",
          0.16,
          this.type === "chi" ? 620 : -40,
        );
      } else if (name === "special")
        Audio.tone(
          this.type === "chi" ? 420 : 95,
          0.18,
          this.type === "chi" ? "sawtooth" : "triangle",
          0.11,
          this.type === "chi" ? 380 : -25,
        );
      else
        Audio.tone(
          name === "heavy" ? 120 : 260,
          0.07,
          name === "heavy" ? "sawtooth" : "square",
          0.06,
          name === "heavy" ? -30 : 90,
        );
      return true;
    }
    update(dt, opp, control) {
      this.frame++;
      if (this.invuln > 0) this.invuln--;
      if (this.hitstun > 0) {
        this.hitstun--;
        this.x += this.vx * dt;
        this.vx *= 0.9;
        if (this.hitstun === 0) this.state = this.grounded ? "idle" : "air";
        return;
      }
      if (this.state === "down") {
        if (this.frame > 38) {
          this.state = "rise";
          this.frame = 0;
          this.invuln = 36;
        }
        return;
      }
      if (this.state === "rise") {
        if (this.frame > 22) {
          this.state = "idle";
          this.frame = 0;
        }
        return;
      }
      if (["ko", "win", "intro"].includes(this.state)) {
        if (this.state === "intro" && this.frame > 80) this.state = "idle";
        return;
      }
      if (this.comboTimer > 0) {
        this.comboTimer--;
        if (!this.comboTimer) {
          this.combo = 0;
        }
      }
      if (this.delayedHp > this.hp)
        this.delayedHp = Math.max(
          this.hp,
          this.delayedHp - this.cfg.hp * dt * 0.18,
        );
      if (!this.move && this.posture < this.cfg.posture)
        this.posture = Math.min(this.cfg.posture, this.posture + 18 * dt);
      if (!this.grounded) {
        this.vy += 440 * dt;
        this.y += this.vy * dt;
        this.x += this.vx * dt * 0.55;
        if (this.y >= FLOOR) {
          this.y = FLOOR;
          this.vy = 0;
          this.state = "land";
          this.frame = 0;
          Audio.tone(75, 0.05, "triangle", 0.05, -20);
          particle(this.x, FLOOR, "#8bb8c2", 3, 0.4);
        }
      }
      if (this.move) {
        const m = this.move;
        if (control.light && m.next && this.frame > m.b - 2) this.chain = true;
        if (m.dash && this.frame < m.a + 4) this.x += m.dash * this.face * dt;
        if (this.frame > m.len) {
          if (this.chain && m.next) {
            this.move = null;
            this.attack(m.next);
          } else {
            this.move = null;
            this.state = this.grounded ? "idle" : "air";
            this.frame = 0;
          }
        }
        return;
      }
      const left = control.left,
        right = control.right,
        dir = (right ? 1 : 0) - (left ? 1 : 0);
      if (control.guard) {
        if (this.state !== "guard") {
          this.state = "guard";
          this.frame = 0;
        }
        this.vx = 0;
        return;
      } else if (this.state === "guard") this.state = "idle";
      if (control.jump && this.grounded) {
        this.vy = -this.cfg.jump;
        this.y -= 1;
        this.state = "jump";
        this.frame = 0;
        Audio.tone(190, 0.06, "square", 0.05, 80);
      }
      if (control.down && this.grounded) {
        this.state = "crouch";
        this.vx = 0;
        this.invuln = Math.max(this.invuln, 2);
      } else if (dir && this.grounded) {
        this.vx = dir * this.cfg.speed * (control.dash ? 1.8 : 1);
        this.x += this.vx * dt;
        this.state = control.dash ? "dashMove" : "walk";
        this.face = opp.x > this.x ? 1 : -1;
      } else if (this.grounded) {
        this.vx = 0;
        if (!["land", "crouch"].includes(this.state) || this.frame > 10)
          this.state = "idle";
      }
      if (control.light) this.attack(this.grounded ? "light1" : "air");
      else if (control.heavy) this.attack(this.grounded ? "heavy" : "air");
      else if (control.special) this.attack("special");
      else if (control.ultimate) this.attack("ultimate");
      else if (control.dashAttack) this.attack("dash");
    }
    box() {
      const m = this.move;
      if (!m || this.frame < m.a || this.frame > m.b) return null;
      const reach =
        this.type === "chi" ? (m.ultimate ? 54 : 31) : m.ultimate ? 58 : 40;
      return {
        x: this.face > 0 ? this.x + 7 : this.x - reach - 7,
        y: this.y - (m.down ? 24 : 42),
        w: reach,
        h: m.down ? 28 : 31,
      };
    }
    hurt() {
      return {
        x: this.x - 9,
        y: this.y - (this.state === "crouch" ? 27 : 48),
        w: 18,
        h: this.state === "crouch" ? 27 : 48,
      };
    }
  }
  const overlap = (a, b) =>
    a &&
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y;
  const DIFF = {
    easy: { react: 0.42, attack: 0.46, guard: 0.12, error: 0.3, combo: 1 },
    normal: { react: 0.24, attack: 0.7, guard: 0.3, error: 0.13, combo: 2 },
    hard: { react: 0.14, attack: 0.82, guard: 0.5, error: 0.05, combo: 3 },
  };
  const TOWER_REWARDS = [
    { id: "ember", name: "赤焰芯", desc: "造成伤害 +14%" },
    { id: "gale", name: "疾风足", desc: "移动速度 +13%" },
    { id: "iron", name: "玄铁架", desc: "架势上限 +22%" },
    { id: "vital", name: "再生脉", desc: "生命上限 +16%" },
    { id: "surge", name: "聚能环", desc: "能量获取 +28%" },
    { id: "spark", name: "先制火花", desc: "每层初始能量 +30" },
  ];
  function aiControl(me, op, dt) {
    const d = DIFF[Game.difficulty],
      a = me.aiData;
    a.timer -= dt;
    if (a.timer <= 0) {
      a.timer = d.react * rnd(0.8, 1.25);
      const dist = Math.abs(op.x - me.x),
        r = Math.random(),
        reach = me.type === "chi" ? 36 : 45,
        recovering = op.move && op.frame > op.move.b;
      if (r < d.error) a.mode = "hesitate";
      else if (recovering && dist < reach + 15 && Game.difficulty !== "easy")
        a.mode = "attack";
      else if (me.hp / me.cfg.hp < 0.28 && dist < reach + 8)
        a.mode = r < 0.55 ? "guard" : "back";
      else if (op.move && dist < reach + 18 && r < d.guard) a.mode = "guard";
      else if (
        me.energy >= 100 &&
        dist < reach + 10 &&
        (!op.move || op.hitstun) &&
        r < 0.55
      )
        a.mode = "ultimate";
      else if (dist > reach + 20) a.mode = r < 0.12 ? "jump" : "approach";
      else if (dist < 22) a.mode = r < 0.25 ? "back" : "attack";
      else
        a.mode =
          r < d.attack ? "attack" : r < d.attack + d.guard ? "guard" : "space";
    }
    const toward = op.x > me.x ? "right" : "left",
      away = toward === "right" ? "left" : "right",
      c = {};
    if (a.mode === "approach") {
      c[toward] = 1;
      if (Math.abs(op.x - me.x) > 105 && Game.difficulty !== "easy") c.dash = 1;
    }
    if (a.mode === "back" || a.mode === "space") c[away] = 1;
    if (a.mode === "guard") c.guard = 1;
    if (a.mode === "jump") {
      c[toward] = 1;
      c.jump = 1;
    }
    if (a.mode === "ultimate") c.ultimate = 1;
    if (a.mode === "attack" && !me.busy) {
      const r = Math.random();
      const dist = Math.abs(op.x - me.x),
        reach = me.type === "chi" ? 36 : 45;
      if (dist > reach + 7) {
        c[toward] = 1;
        if (dist < 76 && r < 0.35) c.dashAttack = 1;
      } else if (r < 0.5) c.light = 1;
      else if (r < 0.76) c.heavy = 1;
      else c.special = 1;
    }
    if (
      me.move &&
      me.move.next &&
      me.frame > me.move.b &&
      me.frame < me.move.len - 3 &&
      Math.random() < 0.12 * d.combo
    )
      c.light = 1;
    return c;
  }
  function playerControl() {
    const now = performance.now(),
      c = {
        left: Input.held.left || Pad.held.left,
        right: Input.held.right || Pad.held.right,
        down: Input.held.down || Pad.held.down,
        guard: Input.held.guard || Pad.held.guard,
        jump: Input.eat("jump") || Pad.eat("jump"),
        light: Input.eat("light") || Pad.eat("light"),
        heavy: Input.eat("heavy") || Pad.eat("heavy"),
        special: Input.eat("special") || Pad.eat("special"),
        ultimate: Input.eat("ultimate") || Pad.eat("ultimate"),
      };
    for (const d of ["left", "right"])
      if (Input.eat(d)) {
        c[d] = 1;
        c.dash = Input.held.shift || now - Input.lastDir[d] < 220;
        Input.lastDir[d] = now;
      }
    c.dash = c.dash || Input.held.shift || Pad.held.shift;
    return c;
  }
  const Game = {
    state: "title",
    mode: "duel",
    playerType: "chi",
    difficulty: "normal",
    overlayReturn: "menu",
    homeReturnState: "menu",
    homeReturnOverlay: "menu",
    p: null,
    e: null,
    timer: 60,
    round: 1,
    freeze: 0,
    cinematic: 0,
    shake: 0,
    flash: 0,
    message: "",
    messageT: 0,
    totalTime: 0,
    sudden: false,
    roundEnding: 0,
    introTime: 0,
    towerFloor: 1,
    towerMax: 5,
    towerScore: 0,
    towerBestCombo: 0,
    towerParries: 0,
    towerMods: [],
    towerHpRatio: 1,
    towerCleared: false,
    rewardChoices: [],
    tutorialStep: 0,
    tutorialGuard: 0,
    tutorialCompleteT: 0,
    setState(s) {
      this.state = s;
      Input.clear();
      Pad.clear();
      syncShellControls(s);
      touch.classList.toggle("in-game", ["fight", "roundIntro"].includes(s));
      screen.classList.toggle("hidden", ["fight", "roundIntro"].includes(s));
      if (s === "title") UI.title();
      if (s === "menu") UI.menu();
      if (s === "select") UI.select();
      if (s === "difficulty") UI.difficulty();
      if (s === "controls") UI.controls(this.overlayReturn);
      if (s === "settings") UI.settings(this.overlayReturn);
      if (s === "credits") UI.credits();
      if (s === "results") UI.results();
      if (s === "reward") UI.reward();
      if (s === "tutorialComplete") UI.tutorialComplete();
    },
    openOverlay(s, returnTo = "menu") {
      this.overlayReturn = returnTo;
      this.setState(s);
    },
    closeOverlay() {
      const returnTo = this.overlayReturn;
      this.overlayReturn = "menu";
      if (returnTo === "paused") UI.pause();
      else this.setState("menu");
    },
    requestHome() {
      const activeStates = ["fight", "roundIntro", "paused", "reward"],
        pausedOverlay =
          ["controls", "settings"].includes(this.state) &&
          this.overlayReturn === "paused";
      if (!activeStates.includes(this.state) && !pausedOverlay) {
        this.goHome();
        return;
      }
      this.homeReturnState = this.state;
      this.homeReturnOverlay = this.overlayReturn;
      this.state = "homeConfirm";
      syncShellControls(this.state);
      touch.classList.remove("in-game");
      UI.homeConfirm();
    },
    cancelHome() {
      const returnTo = this.homeReturnState;
      this.overlayReturn = this.homeReturnOverlay;
      if (["fight", "roundIntro"].includes(returnTo)) {
        this.state = returnTo;
        syncShellControls(returnTo);
        screen.classList.add("hidden");
        touch.classList.add("in-game");
        Input.clear();
        Pad.clear();
        return;
      }
      if (returnTo === "paused") {
        UI.pause();
        return;
      }
      this.setState(returnTo);
    },
    goHome() {
      this.p = null;
      this.e = null;
      this.mode = "duel";
      this.freeze = 0;
      this.cinematic = 0;
      this.flash = 0;
      this.message = "";
      this.messageT = 0;
      this.overlayReturn = "menu";
      this.setState("title");
    },
    startMatch(mode = "duel") {
      this.mode = mode;
      const enemy = this.playerType === "chi" ? "xuan" : "chi";
      this.p = new Fighter(this.playerType, 112);
      this.e = new Fighter(enemy, 272, true);
      this.round = 1;
      this.totalTime = 0;
      this.p.wins = this.e.wins = 0;
      this.startRound();
    },
    startTower() {
      this.mode = "tower";
      this.towerFloor = 1;
      this.towerScore = 0;
      this.towerBestCombo = 0;
      this.towerParries = 0;
      this.towerMods = [];
      this.towerHpRatio = 1;
      this.towerCleared = false;
      this.totalTime = 0;
      this.startTowerFloor();
    },
    startTowerFloor() {
      const enemy = this.playerType === "chi" ? "xuan" : "chi";
      this.p = new Fighter(this.playerType, 112);
      this.e = new Fighter(enemy, 272, true);
      for (const mod of this.towerMods) {
        if (mod === "ember") this.p.damageMul *= 1.14;
        if (mod === "gale") this.p.cfg.speed *= 1.13;
        if (mod === "iron") this.p.cfg.posture *= 1.22;
        if (mod === "vital") this.p.cfg.hp *= 1.16;
        if (mod === "surge") this.p.energyMul *= 1.28;
      }
      const scale = 1 + (this.towerFloor - 1) * 0.09;
      this.e.cfg.hp = Math.round(this.e.cfg.hp * scale);
      this.e.cfg.posture = Math.round(this.e.cfg.posture * scale);
      this.e.damageMul *= 1 + (this.towerFloor - 1) * 0.055;
      if (this.towerFloor === this.towerMax) {
        this.e.cfg.name += "·零式";
        this.e.cfg.hp = Math.round(this.e.cfg.hp * 1.22);
        this.e.cfg.accent = "#ffd36b";
        this.e.damageMul *= 1.1;
      }
      this.round = 1;
      this.p.wins = this.e.wins = 0;
      this.startRound();
    },
    startTutorial() {
      this.mode = "tutorial";
      this.p = new Fighter(this.playerType, 142);
      this.e = new Fighter(this.playerType === "chi" ? "xuan" : "chi", 202);
      this.e.cfg.name = "训练傀儡";
      this.e.cfg.hp = 3000;
      this.p.wins = this.e.wins = 0;
      this.round = 1;
      this.totalTime = 0;
      this.tutorialStep = 0;
      this.tutorialGuard = 0;
      this.tutorialCompleteT = 0;
      this.startRound();
    },
    startRound() {
      const px = this.mode === "tutorial" ? 142 : 112,
        ex = this.mode === "tutorial" ? 202 : 272;
      this.p.reset(px);
      this.e.reset(ex);
      if (this.mode === "tower") {
        this.p.hp = this.p.delayedHp = Math.round(
          this.p.cfg.hp * this.towerHpRatio,
        );
        if (this.towerMods.includes("spark")) this.p.energy = 30;
        if (this.towerFloor === this.towerMax) this.e.energy = 45;
      }
      this.timer =
        this.mode === "tower" ? 50 : this.mode === "tutorial" ? 99 : 60;
      this.sudden = false;
      this.roundEnding = 0;
      this.introTime = this.mode === "tutorial" ? 0.65 : 1.2;
      this.message =
        this.mode === "tower"
          ? this.towerFloor === this.towerMax
            ? "BOSS FLOOR"
            : `TOWER ${this.towerFloor}/${this.towerMax}`
          : this.mode === "tutorial"
            ? "TRAINING"
            : this.round === 3
              ? "FINAL ROUND"
              : "ROUND " + this.round;
      this.messageT = 105;
      this.state = "roundIntro";
      syncShellControls(this.state);
      screen.classList.add("hidden");
      touch.classList.add("in-game");
      Audio.start();
    },
    pause() {
      if (this.state === "fight") {
        this.state = "paused";
        syncShellControls(this.state);
        UI.pause();
      }
    },
    resume() {
      this.state = "fight";
      syncShellControls(this.state);
      screen.classList.add("hidden");
      touch.classList.add("in-game");
      Input.clear();
      Pad.clear();
    },
    restart() {
      if (this.mode === "tower") this.startTower();
      else if (this.mode === "tutorial") this.startTutorial();
      else this.startMatch("duel");
    },
    update(dt) {
      if (Input.eat("escape") || Pad.eat("escape")) {
        if (this.state === "fight") this.pause();
        else if (this.state === "paused") this.resume();
      }
      if (this.state === "roundIntro") {
        this.p.update(dt, this.e, {});
        this.e.update(dt, this.p, {});
        this.introTime -= dt;
        if (this.introTime <= 0) {
          this.p.state = this.e.state = "idle";
          this.p.frame = this.e.frame = 0;
          this.state = "fight";
          this.message = "FIGHT";
          this.messageT = 55;
          announce.textContent = "战斗开始";
        }
        return;
      }
      if (this.state !== "fight") return;
      if (this.freeze > 0) {
        this.freeze--;
        return;
      }
      if (this.cinematic > 0) this.cinematic--;
      Audio.music(
        dt,
        this.round === 3 ||
          (this.mode === "tower" && this.towerFloor === this.towerMax),
      );
      this.totalTime += dt;
      if (this.mode !== "tutorial") this.timer = Math.max(0, this.timer - dt);
      const pc = playerControl(),
        ec = this.mode === "tutorial" ? {} : aiControl(this.e, this.p, dt);
      if (this.mode === "tutorial") this.updateTutorial(pc, dt);
      this.p.update(dt, this.e, pc);
      this.e.update(dt, this.p, ec);
      this.resolve(this.p, this.e);
      this.resolve(this.e, this.p);
      this.separate();
      this.p.x = clamp(this.p.x, 22, 362);
      this.e.x = clamp(this.e.x, 22, 362);
      this.p.face = this.e.x > this.p.x ? 1 : -1;
      this.e.face = -this.p.face;
      if (this.mode === "tutorial") {
        this.e.hp = Math.max(this.e.hp, this.e.cfg.hp * 0.55);
        if (!this.e.busy && Math.abs(this.e.x - this.p.x) > 72)
          this.e.x = clamp(this.p.x + this.p.face * 58, 45, 339);
        if (this.tutorialCompleteT > 0 && --this.tutorialCompleteT === 0) {
          PROGRESS.tutorial = true;
          saveProgress();
          this.setState("tutorialComplete");
        }
        return;
      }
      if (this.timer <= 0) {
        if (
          Math.abs(this.p.hp / this.p.cfg.hp - this.e.hp / this.e.cfg.hp) <
            0.001 &&
          !this.sudden
        ) {
          this.sudden = true;
          this.timer = 10;
          this.p.hp = this.e.hp = 160;
          this.p.delayedHp = this.e.delayedHp = 160;
          this.message = "SUDDEN DEATH";
          this.messageT = 80;
        } else
          this.endRound(
            this.p.hp / this.p.cfg.hp > this.e.hp / this.e.cfg.hp
              ? this.p
              : this.e,
            "TIME UP",
          );
      }
      if (this.p.hp <= 0) this.endRound(this.e, "K.O.");
      if (this.e.hp <= 0) this.endRound(this.p, "K.O.");
      if (this.roundEnding > 0 && --this.roundEnding === 0) this.finishRound();
    },
    updateTutorial(pc, dt) {
      if (this.tutorialCompleteT > 0) return;
      const checks = [
        () => pc.left || pc.right,
        () => pc.light && !this.p.busy,
        () => pc.heavy && !this.p.busy,
        () => pc.special && !this.p.busy,
        () => {
          this.tutorialGuard =
            pc.guard && !this.p.busy ? this.tutorialGuard + dt : 0;
          return this.tutorialGuard >= 0.35;
        },
        () => pc.ultimate && !this.p.busy,
      ];
      if (this.tutorialStep === 5) this.p.energy = 100;
      if (!checks[this.tutorialStep]?.()) return;
      this.tutorialStep++;
      this.tutorialGuard = 0;
      this.message = `STEP ${Math.min(this.tutorialStep, 6)} CLEAR`;
      this.messageT = 42;
      Audio.ui();
      announce.textContent = `教学步骤 ${this.tutorialStep} 完成`;
      if (this.tutorialStep >= checks.length) {
        this.tutorialCompleteT = 95;
        this.message = "TRAINING COMPLETE";
        this.messageT = 95;
      }
    },
    resolve(a, b) {
      const hit = a.box(),
        m = a.move,
        multiReady = m?.multi && a.frame - a.lastMulti >= 12;
      if (
        !hit ||
        (!multiReady && a.hitSet.has(b)) ||
        !overlap(hit, b.hurt()) ||
        b.invuln > 0
      )
        return;
      const stance =
        b.move?.guardMove && b.frame >= b.move.a && b.frame <= b.move.b;
      const guarded = (b.state === "guard" || stance) && b.face === -a.face,
        parry = (b.state === "guard" && b.frame <= 8) || stance,
        counterHit = !guarded && b.move && b.frame > b.move.b;
      if (parry && guarded) {
        a.hitstun = stance ? 34 : 24;
        a.vx = -a.face * (stance ? 105 : 75);
        b.energy = clamp(b.energy + (stance ? 18 : 14) * b.energyMul, 0, 100);
        b.parries++;
        b.state = "parry";
        b.frame = 0;
        b.move = null;
        Audio.parry();
        particle(b.x, b.y - 30, "#ffd66b", 14, 1);
        castFx(b, b.type === "chi" ? "special" : "special", true);
        this.message = stance ? "COUNTER" : "PARRY";
        this.messageT = 38;
        this.freeze = 5;
        return;
      }
      let scale = Math.max(0.35, 1 - a.combo * 0.11),
        damage = m.d * scale * a.damageMul;
      if (counterHit) {
        damage *= 1.18;
        this.message = "COUNTER HIT";
        this.messageT = 42;
      }
      if (guarded) {
        damage *= 0.2;
        b.posture -= m.p;
        b.energy = clamp(b.energy + 4 * b.energyMul, 0, 100);
        Audio.tone(210, 0.08, "square", 0.1, -80);
        particle(b.x, b.y - 32, "#9fb8c2", 5, 0.6);
        if (b.posture <= 0) {
          b.posture = b.cfg.posture * 0.45;
          b.hitstun = 48;
          b.state = "break";
          this.message = "GUARD BREAK";
          this.messageT = 48;
          damage *= 1.7;
          this.shake = 7;
        } else {
          a.hitSet.add(b);
          return;
        }
      }
      b.hp = clamp(b.hp - damage, this.mode === "tutorial" ? 1 : 0, b.cfg.hp);
      b.hitstun = (m.heavy ? 28 : 16) + (counterHit ? 7 : 0);
      b.state = m.down ? "down" : "hit";
      b.frame = 0;
      b.vx = a.face * m.k;
      b.vy = m.down ? -70 : 0;
      if (m.down) {
        b.y -= 1;
        b.invuln = 0;
      }
      a.energy = clamp(a.energy + (m.heavy ? 14 : 9) * a.energyMul, 0, 100);
      b.energy = clamp(b.energy + 6 * b.energyMul, 0, 100);
      a.combo++;
      a.comboTimer = 45;
      a.bestCombo = Math.max(a.bestCombo, a.combo);
      a.stats.damage += damage;
      a.hitSet.add(b);
      if (m.multi) a.lastMulti = a.frame;
      castFx(a, a.state, true);
      Audio.hit(m.heavy ? "heavy" : "light");
      particle(
        b.x,
        b.y - 35,
        a.cfg.accent,
        m.heavy ? 14 : 7,
        m.heavy ? 1.25 : 0.75,
      );
      this.freeze = m.ultimate ? 10 : m.heavy ? 6 : 3;
      this.shake = SETTINGS.reducedFx ? 0 : m.ultimate ? 10 : m.heavy ? 6 : 2;
      this.flash = SETTINGS.reducedFx ? 0 : m.heavy ? 6 : 2;
      if (this.sudden) this.endRound(a, "DECISIVE HIT");
    },
    separate() {
      const min = 23,
        d = this.e.x - this.p.x;
      if (Math.abs(d) < min) {
        const push = (min - Math.abs(d)) / 2,
          s = Math.sign(d) || 1;
        this.p.x -= push * s;
        this.e.x += push * s;
      }
    },
    endRound(w, msg) {
      if (
        this.mode === "tutorial" ||
        this.roundEnding ||
        this.state !== "fight"
      )
        return;
      w.wins++;
      const loser = w === this.p ? this.e : this.p;
      loser.state = "ko";
      w.state = "win";
      this.message = msg;
      this.messageT = 100;
      this.roundEnding = 95;
      Audio.ko();
      announce.textContent = msg;
    },
    finishRound() {
      if (this.mode === "tower") {
        const won = this.p.wins > this.e.wins;
        this.towerBestCombo = Math.max(this.towerBestCombo, this.p.bestCombo);
        this.towerParries += this.p.parries;
        PROGRESS.bestFloor = Math.max(PROGRESS.bestFloor, this.towerFloor);
        if (won) {
          this.towerScore += Math.round(
            800 * this.towerFloor + this.timer * 12 + this.p.hp * 0.35,
          );
          this.towerHpRatio = clamp(this.p.hp / this.p.cfg.hp + 0.22, 0.3, 1);
          if (this.towerFloor >= this.towerMax) {
            this.towerCleared = true;
            PROGRESS.clears++;
            PROGRESS.bestScore = Math.max(PROGRESS.bestScore, this.towerScore);
            saveProgress();
            this.setState("results");
            return;
          }
          const available = TOWER_REWARDS.filter(
            (reward) => !this.towerMods.includes(reward.id),
          );
          this.rewardChoices = available
            .map((reward) => ({ reward, order: Math.random() }))
            .sort((a, b) => a.order - b.order)
            .slice(0, 3)
            .map(({ reward }) => reward);
          PROGRESS.bestScore = Math.max(PROGRESS.bestScore, this.towerScore);
          saveProgress();
          this.setState("reward");
        } else {
          this.towerCleared = false;
          PROGRESS.bestScore = Math.max(PROGRESS.bestScore, this.towerScore);
          saveProgress();
          this.setState("results");
        }
        return;
      }
      if (this.p.wins >= 2 || this.e.wins >= 2) {
        this.setState("results");
      } else {
        this.round++;
        this.startRound();
      }
    },
    chooseTowerReward(id) {
      if (!this.rewardChoices.some((reward) => reward.id === id)) return;
      this.towerMods.push(id);
      this.towerFloor++;
      this.startTowerFloor();
    },
  };
  const UI = {
    show(html, panelClass = "", view = "default") {
      screen.dataset.view = view;
      screen.innerHTML = `<div class="panel ${panelClass}">${html}</div>`;
      screen.classList.remove("hidden");
      syncShellControls(Game.state);
      screen.querySelectorAll("button").forEach((b) =>
        b.addEventListener("click", () => {
          Audio.unlock();
          Audio.ui();
        }),
      );
      screen.querySelector("button")?.focus();
    },
    title() {
      this.show(
        `<div class="title-topbar"><span class="live-status"><i aria-hidden="true"></i> ZERO CITY // SECTOR 07</span><span class="title-season">武斗祭 · 雨夜场</span></div><div class="title-layout"><div class="title-hero"><p class="eyebrow">原创像素格斗 · 今夜开战</p><h1 class="logo title-logo"><span>零界武斗</span><strong>NEON CLASH</strong></h1><p class="title-lede">在霓虹与暴雨交界的城市，用截然不同的武道风格争夺中央能源塔的资格。</p><button id="enter" class="hero-cta"><span>进入零界城</span><small>ENTER THE ARENA</small><b aria-hidden="true">→</b></button><div class="feature-chips"><span>双武者流派</span><span>五层零界塔</span><span>本地成长记录</span></div></div><aside class="event-card" aria-label="今晚主赛"><div class="event-head"><span>TONIGHT'S MAIN EVENT</span><b>LIVE</b></div><div class="versus-board"><div class="fighter-ticket chi-ticket"><span class="duelist-mark" aria-hidden="true"></span><small>疾速压制</small><strong>赤鸢</strong></div><span class="versus-mark">VS</span><div class="fighter-ticket xuan-ticket"><span class="duelist-mark" aria-hidden="true"></span><small>重甲反击</small><strong>玄嶂</strong></div></div><p class="event-copy">两套完整招式、反击判定与终结技。先在教学中热身，或直接登上雨幕天台。</p><div class="event-meta"><div><span>零界塔最高层</span><strong>${PROGRESS.bestFloor}/${Game.towerMax}</strong></div><div><span>历史最高分</span><strong>${PROGRESS.bestScore}</strong></div></div></aside></div><div class="title-footer"><span>键盘 · 手柄 · 触控</span><span>无需登录 · 进度保存在本机</span></div>`,
        "title-panel",
        "title",
      );
      screen.querySelector("#enter").onclick = () => Game.setState("menu");
    },
    menu() {
      this.show(
        `<div class="hub-head"><div><p class="eyebrow">ZERO CITY FIGHT TERMINAL</p><h1 class="logo hub-logo">NEON CLASH</h1><p class="subtitle">选择今晚的战斗方式</p></div><div class="pilot-card"><span>当前武者</span><strong class="${Game.playerType === "chi" ? "red" : "cyan"}">${Game.playerType === "chi" ? "赤鸢" : "玄嶂"}</strong><small>${Game.playerType === "chi" ? "高速近战 · 连续压迫" : "力量防御 · 架势反击"}</small></div></div><div class="progress-strip hub-progress"><span><i aria-hidden="true"></i> 零界塔最高层 <strong>${PROGRESS.bestFloor}/${Game.towerMax}</strong></span><span>历史最高 <strong>${PROGRESS.bestScore}</strong></span><span>教学 ${PROGRESS.tutorial ? "已完成" : "待完成"}</span></div><div class="mode-grid"><button id="start" class="mode-card duel-card"><span class="mode-no">01</span><span class="mode-copy"><strong>快速对战</strong><small>三局两胜 · 立即迎战 AI</small></span><span class="mode-arrow" aria-hidden="true">→</span></button><button id="tower" class="mode-card tower-card"><span class="mode-no">02</span><span class="mode-copy"><strong>零界塔</strong><small>五层生存 · 三选一强化</small></span><span class="mode-arrow" aria-hidden="true">↑</span></button><button id="tutorial" class="mode-card tutorial-card"><span class="mode-no">03</span><span class="mode-copy"><strong>${PROGRESS.tutorial ? "再次训练" : "实战教学"}</strong><small>${PROGRESS.tutorial ? "重温六步基础训练" : "六步上手 · 新玩家推荐"}</small></span><span class="mode-arrow" aria-hidden="true">◎</span></button></div><div class="hub-subhead"><span>战术终端</span><small>FIGHTER CONFIGURATION</small></div><div class="hub-tools"><button id="select"><span>武者</span><strong>角色选择</strong></button><button id="diff"><span>AI</span><strong>${{ easy: "简单", normal: "普通", hard: "困难" }[Game.difficulty]}难度</strong></button><button id="controls"><span>KEY</span><strong>操作说明</strong></button><button id="settings"><span>SFX</span><strong>声音与辅助</strong></button><button id="credits"><span>INFO</span><strong>制作信息</strong></button><button id="home-menu"><span>⌂</span><strong>返回首页</strong></button></div>`,
        "hub-panel",
        "menu",
      );
      screen.querySelector("#start").onclick = () => Game.startMatch("duel");
      screen.querySelector("#tower").onclick = () => Game.startTower();
      screen.querySelector("#tutorial").onclick = () => Game.startTutorial();
      screen.querySelector("#select").onclick = () => Game.setState("select");
      screen.querySelector("#diff").onclick = () => Game.setState("difficulty");
      screen.querySelector("#controls").onclick = () =>
        Game.openOverlay("controls", "menu");
      screen.querySelector("#settings").onclick = () =>
        Game.openOverlay("settings", "menu");
      screen.querySelector("#credits").onclick = () => Game.setState("credits");
      screen.querySelector("#home-menu").onclick = () => Game.goHome();
    },
    select() {
      this.show(
        `<h1 class="logo">选择武者</h1><p class="subtitle">截然不同的进攻节奏</p><div class="row"><button class="portrait ${Game.playerType === "chi" ? "selected" : ""}" data-char="chi"><span class="fighter-mark chi-mark" aria-hidden="true"></span><h2 class="red">赤鸢</h2><p>高速近战 · 连续压迫</p><div class="stats">速度 S　攻击 B<br>防御 C　技巧 A</div><div class="signature">流火掌 / 赤羽破 / 百羽燎原</div></button><button class="portrait ${Game.playerType === "xuan" ? "selected" : ""}" data-char="xuan"><span class="fighter-mark xuan-mark" aria-hidden="true"></span><h2 class="cyan">玄嶂</h2><p>力量防御 · 架势反击</p><div class="stats">速度 C　攻击 S<br>防御 S　技巧 B</div><div class="signature">碎岩拳 / 玄壁 / 天柱坠</div></button></div><div class="menu" style="margin-top:12px"><button id="confirm">确认并返回</button></div>`,
      );
      screen.querySelectorAll("[data-char]").forEach(
        (e) =>
          (e.onclick = () => {
            Game.playerType = e.dataset.char;
            this.select();
          }),
      );
      screen.querySelector("#confirm").onclick = () => Game.setState("menu");
    },
    difficulty() {
      this.show(
        `<h1 class="logo">AI 难度</h1><p class="subtitle">公平反应，不读取未来输入</p><div class="menu"><button data-d="easy">简单 · 宽松反击窗口</button><button data-d="normal">普通 · 自然攻防博弈</button><button data-d="hard">困难 · 观察并惩罚空招</button><button id="back">返回</button></div>`,
      );
      screen.querySelectorAll("[data-d]").forEach(
        (b) =>
          (b.onclick = () => {
            Game.difficulty = b.dataset.d;
            Game.setState("menu");
          }),
      );
      screen.querySelector("#back").onclick = () => Game.setState("menu");
    },
    controls(returnTo = "menu") {
      Game.overlayReturn = returnTo;
      this.show(
        `<h1 class="logo">操作说明</h1><div class="help"><p><kbd>A</kbd> <kbd>D</kbd> 移动　<kbd>W</kbd> 跳跃　<kbd>S</kbd> 低姿态</p><p><kbd>Shift</kbd> + 方向或双击方向：冲刺 / 撤步</p><p><kbd>J</kbd> 轻攻击　<kbd>K</kbd> 重攻击　<kbd>L</kbd> 特殊技</p><p><kbd>I</kbd> 防御，按下瞬间可完美防御　<kbd>U</kbd> 满能终结技</p><p><kbd>Esc</kbd> 暂停　<kbd>R</kbd> 结算后再次挑战</p><p class="tiny">手柄：摇杆移动，A跳跃，X/Y/B轻击/重击/特殊，LB防御，RB终结技。</p></div><div class="menu"><button id="training">进入实战教学</button><button id="back">返回</button></div>`,
      );
      screen.querySelector("#training").onclick = () => Game.startTutorial();
      screen.querySelector("#back").onclick = () => Game.closeOverlay();
    },
    settings(returnTo = "menu") {
      Game.overlayReturn = returnTo;
      this.show(
        `<h1 class="logo">声音与辅助</h1><div class="setting"><label for="music">音乐音量</label><input id="music" aria-label="音乐音量" type="range" min="0" max="1" step=".05" value="${SETTINGS.music}"></div><div class="setting"><label for="sfx">音效音量</label><input id="sfx" aria-label="音效音量" type="range" min="0" max="1" step=".05" value="${SETTINGS.sfx}"></div><div class="setting"><label for="shake">屏幕震动</label><input id="shake" aria-label="屏幕震动" type="range" min="0" max="1" step=".5" value="${SETTINGS.shake}"></div><div class="menu"><button id="contrast">高对比 HUD：${SETTINGS.contrast ? "开" : "关"}</button><button id="reduced">减弱闪光特效：${SETTINGS.reducedFx ? "开" : "关"}</button><button id="back">保存并返回</button></div><p class="tiny">手柄状态：${Pad.connected ? "已连接" : "自动检测"}</p>`,
      );
      ["music", "sfx", "shake"].forEach(
        (k) =>
          (screen.querySelector("#" + k).oninput = (e) =>
            (SETTINGS[k] = +e.target.value)),
      );
      screen.querySelector("#contrast").onclick = () => {
        SETTINGS.contrast = !SETTINGS.contrast;
        this.settings(returnTo);
      };
      screen.querySelector("#reduced").onclick = () => {
        SETTINGS.reducedFx = !SETTINGS.reducedFx;
        this.settings(returnTo);
      };
      screen.querySelector("#back").onclick = () => {
        save();
        Game.closeOverlay();
      };
    },
    credits() {
      this.show(
        `<h1 class="logo">制作信息</h1><div class="help"><p>原创世界观、角色、战斗系统与程序化像素美术。</p><p>零界城建立于古武遗迹之上。今夜，赤鸢与玄嶂为中央能源塔的资格而战。</p><p class="tiny">无外部素材 · 无在线依赖 · Canvas 2D / Web Audio</p></div><div class="menu"><button id="back">返回</button></div>`,
      );
      screen.querySelector("#back").onclick = () => Game.setState("menu");
    },
    homeConfirm() {
      const runName =
        Game.mode === "tower"
          ? `零界塔第 ${Game.towerFloor} 层`
          : Game.mode === "tutorial"
            ? "实战教学"
            : "当前对战";
      this.show(
        `<div class="confirm-icon" aria-hidden="true">⌂</div><p class="eyebrow">RETURN TO TITLE</p><h1 class="confirm-title">返回游戏首页？</h1><p class="confirm-copy">${runName}仍在进行。返回后，本局尚未结算的进度不会保留。</p><div class="menu confirm-actions"><button id="cancel-home">继续当前游戏</button><button id="confirm-home" class="danger-action">确认返回首页</button></div>`,
        "confirm-panel",
        "confirm",
      );
      screen.querySelector("#cancel-home").onclick = () => Game.cancelHome();
      screen.querySelector("#confirm-home").onclick = () => Game.goHome();
    },
    pause() {
      Game.state = "paused";
      syncShellControls(Game.state);
      touch.classList.remove("in-game");
      this.show(
        `<h1 class="logo">暂停</h1><p class="subtitle">${Game.mode === "tower" ? `零界塔 ${Game.towerFloor}/${Game.towerMax}` : Game.mode === "tutorial" ? "实战教学" : "快速对战"}</p><div class="menu"><button id="resume">继续游戏</button><button id="restart">重新开始</button><button id="controls">操作说明</button><button id="settings">声音与辅助</button><button id="menu">返回主菜单</button><button id="home">返回游戏首页</button></div>`,
      );
      screen.querySelector("#resume").onclick = () => Game.resume();
      screen.querySelector("#restart").onclick = () => Game.restart();
      screen.querySelector("#controls").onclick = () =>
        Game.openOverlay("controls", "paused");
      screen.querySelector("#settings").onclick = () =>
        Game.openOverlay("settings", "paused");
      screen.querySelector("#menu").onclick = () => Game.setState("menu");
      screen.querySelector("#home").onclick = () => Game.requestHome();
    },
    results() {
      if (Game.mode === "tower") {
        this.show(
          `<h1 class="logo">${Game.towerCleared ? "TOWER CLEAR" : "RUN OVER"}</h1><p class="subtitle">${Game.towerCleared ? "零界塔制霸" : `止步第 ${Game.towerFloor} 层`}</p><div class="result-grid"><div><span>本次得分</span><strong>${Game.towerScore}</strong></div><div><span>最高连击</span><strong>${Game.towerBestCombo}</strong></div><div><span>完美防御</span><strong>${Game.towerParries}</strong></div><div><span>历史最高</span><strong>${PROGRESS.bestScore}</strong></div></div><div class="menu"><button id="again">重新挑战零界塔</button><button id="change">更换角色</button><button id="menu">返回主菜单</button></div>`,
        );
        screen.querySelector("#again").onclick = () => Game.startTower();
        screen.querySelector("#change").onclick = () => Game.setState("select");
        screen.querySelector("#menu").onclick = () => Game.setState("menu");
        return;
      }
      const win = Game.p.wins > Game.e.wins;
      const styleScore =
          Game.p.bestCombo * 2 + Game.p.parries * 4 + (win ? 6 : 0),
        rank =
          styleScore >= 22
            ? "S"
            : styleScore >= 14
              ? "A"
              : styleScore >= 8
                ? "B"
                : "C";
      this.show(
        `<h1 class="logo">${win ? "VICTORY" : "DEFEAT"}</h1><p class="subtitle">${Game.p.cfg.name} ${Game.p.wins} - ${Game.e.wins} ${Game.e.cfg.name}</p><div class="rank-line"><span>战斗评价</span><strong>${rank}</strong></div><div class="result-grid"><div><span>剩余生命</span><strong>${Math.ceil(Game.p.hp)}</strong></div><div><span>最高连击</span><strong>${Game.p.bestCombo}</strong></div><div><span>完美防御</span><strong>${Game.p.parries}</strong></div><div><span>战斗用时</span><strong>${Game.totalTime.toFixed(1)}s</strong></div></div><div class="menu"><button id="again">立即再战</button><button id="change">更换角色</button><button id="menu">返回主菜单</button></div>`,
      );
      screen.querySelector("#again").onclick = () => Game.startMatch("duel");
      screen.querySelector("#change").onclick = () => Game.setState("select");
      screen.querySelector("#menu").onclick = () => Game.setState("menu");
    },
    reward() {
      this.show(
        `<h1 class="logo">选择强化</h1><p class="subtitle">第 ${Game.towerFloor} 层突破 · 生命恢复至 ${Math.round(Game.towerHpRatio * 100)}%</p><div class="reward-grid">${Game.rewardChoices.map((reward) => `<button class="reward-card" data-reward="${reward.id}"><span>${reward.name}</span><strong>${reward.desc}</strong></button>`).join("")}</div><p class="tiny">强化仅在本次零界塔挑战中生效。</p>`,
      );
      screen
        .querySelectorAll("[data-reward]")
        .forEach(
          (button) =>
            (button.onclick = () =>
              Game.chooseTowerReward(button.dataset.reward)),
        );
    },
    tutorialComplete() {
      this.show(
        `<h1 class="logo">训练完成</h1><p class="subtitle">你已掌握零界武斗基础</p><div class="help"><p>移动、轻击、重击、特殊技、防御与终结技已经完成。</p><p>下一步建议进入快速对战，再挑战五层零界塔。</p></div><div class="menu"><button id="duel">开始快速对战</button><button id="tower">进入零界塔</button><button id="menu">返回主菜单</button></div>`,
      );
      screen.querySelector("#duel").onclick = () => Game.startMatch("duel");
      screen.querySelector("#tower").onclick = () => Game.startTower();
      screen.querySelector("#menu").onclick = () => Game.setState("menu");
    },
  };
  function rect(x, y, w, h, c) {
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }
  function text(t, x, y, size = 8, col = "#e9f3f4", align = "left") {
    ctx.font = `900 ${size}px monospace`;
    ctx.textAlign = align;
    ctx.fillStyle = "#06101c";
    ctx.fillText(t, x + 1, y + 1);
    ctx.fillStyle = col;
    ctx.fillText(t, x, y);
  }
  function background(time) {
    rect(0, 0, W, H, "#07101d");
    ctx.fillStyle = "#10172c";
    ctx.beginPath();
    ctx.moveTo(0, 58);
    ctx.lineTo(70, 42);
    ctx.lineTo(106, 60);
    ctx.lineTo(165, 31);
    ctx.lineTo(215, 59);
    ctx.lineTo(284, 36);
    ctx.lineTo(384, 54);
    ctx.lineTo(384, 120);
    ctx.lineTo(0, 120);
    ctx.fill();
    for (let i = 0; i < 18; i++) {
      let x = ((i * 29 - time * 2 * ((i % 3) + 1)) % 430) - 20,
        h = 26 + ((i * 17) % 48);
      rect(x, 114 - h, 22, h, "#101f31");
      for (let y = 0; y < h - 8; y += 8)
        if ((i + y) % 3)
          rect(
            x + 4 + (y % 12),
            89 - h + y,
            2,
            2,
            i % 4 ? "#276070" : "#9f3d6f",
          );
    }
    rect(286, 32, 18, 86, "#172a3d");
    rect(292, 16, 6, 22, "#29546b");
    rect(294, 8, 2, 10, "#c14d78");
    ctx.globalAlpha = 0.45;
    rect(45, 74, 46, 17, "#153c4d");
    text("零界", 68, 86, 7, "#4cd3d5", "center");
    ctx.globalAlpha = 1;
    rect(0, 119, W, 55, "#0c1a26");
    rect(0, 144, W, 30, "#112531");
    for (let x = 0; x < W; x += 32) {
      rect(x, 145, 22, 2, "#376070");
      rect(x + 4, 154, 18, 2, "#1b3d4c");
    }
    rect(0, FLOOR, W, H - FLOOR, "#101923");
    rect(0, FLOOR, W, 2, "#526a72");
    for (let x = 10; x < W; x += 38) {
      rect(x, 187, 25, 2, "#172d36");
      rect(x + 7, 191, 13, 1, "#24505a");
    }
    for (let i = 0; i < 90; i++) {
      let x = ((i * 47 + time * 22) % 410) - 10,
        y = (i * 29 + time * 75) % 180;
      ctx.globalAlpha = 0.2 + (i % 3) * 0.13;
      rect(x, y, 1, (i % 4) + 2, "#94d9e3");
    }
    ctx.globalAlpha = 1;
    for (let x = 18; x < W; x += 62) {
      rect(x, 202, 28, 1, "#224a55");
      rect(x + 5, 203, 18, 1, "#183642");
    }
  }
  function limb(x, y, w, h, c) {
    rect(x, y, w, h, "#05090e");
    rect(x + 1, y + 1, w - 2, h - 2, c);
  }
  function fighter(f) {
    let x = Math.round(f.x),
      y = Math.round(f.y),
      flip = f.face,
      phase = Math.sin(f.frame * 0.13),
      hurt = f.state === "hit" || f.state === "break",
      c = f.cfg.col,
      a = f.cfg.accent;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(flip, 1);
    if (f.invuln && f.invuln % 4 < 2) ctx.globalAlpha = 0.4;
    let crouch = f.state === "crouch" ? 8 : 0,
      lean =
        f.state === "walk"
          ? phase * 2
          : f.move
            ? f.frame < f.move.a
              ? -3
              : f.frame <= f.move.b
                ? 5
                : 0
            : 0;
    if (f.state === "down" || f.state === "ko") {
      ctx.rotate((-Math.PI / 2) * flip);
      ctx.translate(28, -5);
    }
    if (f.state === "win") lean = -2;
    if (hurt) lean = -5;
    limb(-8, -18 + crouch, 6, 18, "#17202b");
    limb(3, -18 + crouch, 7, 18, f.type === "chi" ? "#2a1b20" : "#142c3d");
    limb(
      -9,
      -39 + crouch + lean,
      18,
      24,
      f.type === "chi" ? "#4a2024" : "#17384b",
    );
    rect(-7, -37 + crouch + lean, 14, 3, c);
    if (f.type === "chi") {
      rect(-10, -38 + crouch + lean, 4, 18, "#1a1218");
      rect(7, -35 + crouch + lean, 3, 21, "#9d302d");
      rect(10, -18 + crouch + lean, 8 + Math.abs(phase * 7), 2, "#dc3d35");
    } else {
      rect(-12, -38 + crouch + lean, 6, 21, "#253345");
      rect(7, -38 + crouch + lean, 7, 25, "#235d70");
      rect(10, -35 + crouch + lean, 5, 4, a);
    }
    limb(-5, -50 + crouch + lean, 11, 11, "#c39a7c");
    rect(
      -6,
      -52 + crouch + lean,
      12,
      5,
      f.type === "chi" ? "#17151b" : "#202b32",
    );
    rect(flip > 0 ? 2 : -3, -47 + crouch + lean, 2, 1, "#eff6e9");
    let armY = -35 + crouch + lean,
      ext =
        f.move && f.frame >= f.move.a - 3 && f.frame <= f.move.b + 2 ? 19 : 0;
    limb(6, armY, 7 + ext, 6, f.type === "chi" ? c : "#2b6c79");
    if (f.type === "xuan") rect(9, armY - 2, 9 + ext, 10, "#375c67");
    limb(-12, armY + 2, 7, 6, f.type === "chi" ? "#2b2025" : "#1b3343");
    if (f.state === "guard") {
      rect(12, -46, 3, 32, a);
      ctx.globalAlpha = 0.3;
      rect(15, -47, 5, 34, a);
    }
    if (f.move && f.move.ultimate && f.frame > 20) {
      ctx.globalAlpha = 0.35;
      for (let i = 1; i < 4; i++) rect(-i * 9, -47, 12, 40, c);
    }
    ctx.restore();
    if (f.low) {
    }
  }
  function hudBar(x, y, w, val, max, col, flip = false) {
    rect(x, y, w, 7, "#07101d");
    rect(x + 1, y + 1, w - 2, 5, "#263442");
    let fill = (w - 2) * clamp(val / max, 0, 1);
    rect(flip ? x + w - 1 - fill : x + 1, y + 1, fill, 5, col);
  }
  function hud() {
    if (!Game.p) return;
    const p = Game.p,
      e = Game.e;
    rect(6, 6, 372, 31, SETTINGS.contrast ? "#020407" : "#081421e6");
    text(p.cfg.name, 9, 14, 7, p.cfg.accent);
    text(e.cfg.name, 375, 14, 7, e.cfg.accent, "right");
    hudBar(9, 18, 142, p.delayedHp, p.cfg.hp, "#76575b");
    hudBar(9, 18, 142, p.hp, p.cfg.hp, p.cfg.col);
    hudBar(233, 18, 142, e.delayedHp, e.cfg.hp, "#506176", true);
    hudBar(233, 18, 142, e.hp, e.cfg.hp, e.cfg.col, true);
    hudBar(9, 27, 92, p.energy, 100, "#e5b94f");
    hudBar(283, 27, 92, e.energy, 100, "#e5b94f", true);
    hudBar(105, 27, 46, p.posture, p.cfg.posture, "#b9d1d4");
    hudBar(233, 27, 46, e.posture, e.cfg.posture, "#b9d1d4", true);
    text(`气 ${Math.round(p.energy)}`, 10, 33, 4, "#fff1a8");
    text(
      `架 ${Math.round((p.posture / p.cfg.posture) * 100)}`,
      106,
      33,
      4,
      "#d7edf0",
    );
    text(`气 ${Math.round(e.energy)}`, 374, 33, 4, "#fff1a8", "right");
    text(
      `架 ${Math.round((e.posture / e.cfg.posture) * 100)}`,
      278,
      33,
      4,
      "#d7edf0",
      "right",
    );
    text(
      String(Math.ceil(Game.timer)).padStart(2, "0"),
      192,
      25,
      14,
      Game.timer < 10 ? "#ff5548" : "#eef3e8",
      "center",
    );
    text(`胜 ${p.wins}/2`, 158, 13, 6, p.cfg.accent, "right");
    text(`${e.wins}/2 胜`, 226, 13, 6, e.cfg.accent);
    if (p.combo > 1) text(`${p.combo} HIT`, 24, 55, 10, p.cfg.accent);
    if (e.combo > 1) text(`${e.combo} HIT`, 360, 55, 10, e.cfg.accent, "right");
    if (p.energy >= 100) text("U 终结技就绪", 10, 43, 6, "#ffd36b");
    if (Game.mode === "tower")
      text(
        `零界塔 ${Game.towerFloor}/${Game.towerMax}  ·  ${Game.towerScore} PTS`,
        192,
        43,
        5,
        "#9ddde3",
        "center",
      );
    if (Game.mode === "tutorial" && Game.tutorialCompleteT <= 0) {
      const prompts = [
        "A / D  移动",
        "J  轻攻击",
        "K  重攻击",
        "L  特殊技",
        "按住 I  防御",
        "U  释放终结技",
      ];
      rect(78, 187, 228, 20, "#07101de8");
      text(`实战教学 ${Game.tutorialStep + 1}/6`, 86, 195, 5, "#ffc85a");
      text(
        prompts[Game.tutorialStep] || "训练完成",
        192,
        203,
        7,
        "#f2f7f0",
        "center",
      );
    }
  }
  function render(t) {
    let power =
        Game.shake > 0 ? (Game.shake > 8 ? 4 : Game.shake > 4 ? 2 : 0) : 0,
      sx = power ? rnd(-power, power) * SETTINGS.shake : 0,
      sy = power ? rnd(-power, power) * SETTINGS.shake : 0;
    if (Game.shake > 0) Game.shake *= 0.7;
    if (Game.shake < 0.3) Game.shake = 0;
    ctx.save();
    ctx.translate(Math.round(sx), Math.round(sy));
    background(t);
    if (Game.p) {
      for (const e of effects) drawFx(e);
      fighter(Game.p);
      fighter(Game.e);
      for (const p of particles) rect(p.x, p.y, p.s, p.s, p.c);
    }
    ctx.restore();
    if (Game.p) hud();
    if (Game.flash > 0) {
      if (!SETTINGS.reducedFx) {
        ctx.globalAlpha = Game.flash / 15;
        rect(0, 0, W, H, "#f6e7c4");
        ctx.globalAlpha = 1;
      }
      Game.flash--;
    }
    if (Game.messageT > 0) {
      Game.messageT--;
      const s = Game.message.includes("ROUND")
        ? 18
        : Game.message === "FIGHT"
          ? 27
          : 15;
      text(
        Game.message,
        192,
        91,
        s,
        Game.message === "PARRY" ? "#ffd86b" : "#f1e9d9",
        "center",
      );
    }
    if (Game.state === "title" && !Game.p) {
      text("零界城 · 雨夜", 192, 197, 7, "#80a7b5", "center");
    }
  }
  let last = performance.now(),
    acc = 0;
  function loop(now) {
    const rawDt = Math.max(0, (now - last) / 1000),
      dt = Math.min(0.12, rawDt),
      skipped = rawDt - dt;
    last = now;
    Pad.poll();
    if (skipped > 0 && !document.hidden) {
      if (Game.state === "roundIntro") Game.introTime -= skipped;
      if (Game.state === "fight" && Game.mode !== "tutorial") {
        Game.timer = Math.max(0, Game.timer - skipped);
        Game.totalTime += skipped;
      }
    }
    acc += dt;
    while (acc >= 1 / 60) {
      Game.update(1 / 60);
      for (let i = particles.length - 1; i >= 0; i--) {
        let p = particles[i];
        p.t -= 1 / 60;
        p.x += p.vx / 60;
        p.y += p.vy / 60;
        p.vy += 190 / 60;
        if (p.t <= 0) particles.splice(i, 1);
      }
      for (let i = effects.length - 1; i >= 0; i--) {
        if (++effects[i].t >= effects[i].max) effects.splice(i, 1);
      }
      acc -= 1 / 60;
    }
    render(now / 1000);
    requestAnimationFrame(loop);
  }
  function selfTest() {
    const out = [],
      ok = (name, v) => out.push({ name, pass: !!v }),
      unfreeze = () => (Game.freeze = 0);
    let a = new Fighter("chi", 150),
      b = new Fighter("xuan", 170);
    a.state = b.state = "idle";
    unfreeze();
    a.attack("light1");
    a.frame = 6;
    Game.p = a;
    Game.e = b;
    Game.state = "fight";
    const hp = b.hp;
    Game.resolve(a, b);
    ok("有效帧造成伤害", b.hp < hp);
    a = new Fighter("chi", 150);
    b = new Fighter("xuan", 170);
    a.state = "idle";
    b.state = "guard";
    b.face = -1;
    b.frame = 20;
    unfreeze();
    a.attack("heavy");
    a.frame = 17;
    Game.p = a;
    Game.e = b;
    const guardedHp = b.hp;
    Game.resolve(a, b);
    ok("防御降低伤害", guardedHp - b.hp < MOVES.chi.heavy.d * 0.5);
    a = new Fighter("chi", 150);
    a.state = "idle";
    unfreeze();
    ok("空能量禁止终结技", a.attack("ultimate") === false);
    a.energy = 100;
    ok("满能量允许终结技", a.attack("ultimate") === true && a.energy === 0);
    Game.p = new Fighter("chi", 100);
    Game.e = new Fighter("xuan", 105);
    Game.separate();
    ok("角色推挤防重叠", Math.abs(Game.e.x - Game.p.x) >= 22.9);
    ok(
      "朝向攻击框镜像",
      (() => {
        const f = new Fighter("chi", 100);
        f.state = "idle";
        f.face = -1;
        unfreeze();
        f.attack("light1");
        f.frame = 6;
        return f.box().x < 100;
      })(),
    );
    const oldError = DIFF.normal.error;
    DIFF.normal.error = -1;
    const ai = new Fighter("xuan", 280, true),
      target = new Fighter("chi", 90);
    ai.state = target.state = "idle";
    ai.aiData.timer = 0;
    Game.difficulty = "normal";
    const aiMove = aiControl(ai, target, 1 / 60);
    DIFF.normal.error = oldError;
    ok("远距离 AI 主动接近", !!aiMove.left || !!aiMove.jump);
    Game.playerType = "chi";
    Game.mode = "tower";
    Game.towerFloor = 2;
    Game.towerMods = ["ember", "vital"];
    Game.towerHpRatio = 1;
    Game.startTowerFloor();
    ok(
      "零界塔强化应用",
      Game.p.damageMul > 1.14 && Game.p.cfg.hp > CHAR.chi.hp,
    );
    Game.state = "paused";
    Game.openOverlay("settings", "paused");
    screen.querySelector("#back").click();
    ok("暂停设置返回暂停页", Game.state === "paused");
    Game.startTutorial();
    Game.state = "fight";
    Game.p.state = Game.e.state = "idle";
    for (const control of [
      { right: 1 },
      { light: 1 },
      { heavy: 1 },
      { special: 1 },
    ])
      Game.updateTutorial(control, 1 / 60);
    Game.updateTutorial({ guard: 1 }, 0.4);
    Game.updateTutorial({ ultimate: 1 }, 1 / 60);
    ok("六步实战教学可完成", Game.tutorialCompleteT > 0);
    Game.setState("menu");
    screen.querySelector("#home-menu").click();
    ok("主菜单可返回游戏首页", Game.state === "title" && homeButton.hidden);
    Game.startMatch("duel");
    Game.state = "fight";
    syncShellControls(Game.state);
    homeButton.click();
    const homePrompt = Game.state === "homeConfirm";
    screen.querySelector("#confirm-home")?.click();
    ok(
      "战斗中可安全返回首页",
      homePrompt && Game.state === "title" && !Game.p,
    );
    const pass = out.every((x) => x.pass);
    screen.classList.remove("hidden");
    screen.innerHTML = `<div class="panel"><h1 class="logo">SELF TEST ${pass ? "PASS" : "FAIL"}</h1><pre>${out.map((x) => `${x.pass ? "PASS" : "FAIL"}  ${x.name}`).join("\n")}</pre></div>`;
    document.title = `${pass ? "PASS" : "FAIL"} - NEON CLASH`;
    announce.dataset.selftest = JSON.stringify(out);
  }
  addEventListener("keydown", (e) => {
    if (e.code === "KeyR" && Game.state === "results") Game.restart();
  });
  homeButton.addEventListener("click", () => {
    Audio.unlock();
    Audio.ui();
    Game.requestHome();
  });
  syncShellControls(Game.state);
  UI.title();
  const query = new URLSearchParams(location.search);
  if (query.has("selftest")) {
    try {
      selfTest();
    } catch (e) {
      screen.innerHTML = `<div class="panel"><h1 class="logo">SELF TEST ERROR</h1><pre>${e.stack}</pre></div>`;
      document.title = "ERROR - NEON CLASH";
    }
  } else if (query.has("autoplay")) {
    Game.startMatch("duel");
    Game.introTime = 0.02;
  }
  requestAnimationFrame(loop);
  window.NeonClash = {
    Game,
    Fighter,
    MOVES,
    CHAR,
    DIFF,
    TOWER_REWARDS,
    overlap,
  };
})();
