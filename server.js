const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { WebcastPushConnection } = require("tiktok-live-connector");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

// ═══════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════
const TIKTOK_USERNAME = "ali_sayed_fathy";
const MAX_RING = 10;
const INACTIVITY_MS = 3 * 60 * 1000;
const COOLDOWN_MS = 2000;
const MAX_LOGS = 50;
const BOT_ATTACK_INTERVAL = 4000;

// ═══════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════
let ring = [];
let queue = [];
let logs = [];
let botInterval = null;

// ═══════════════════════════════════════════
// GIFT VALUE MAP (fallback)
// ═══════════════════════════════════════════
const giftValues = {
  "Rose": 1, "rose": 1,
  "TikTok": 1,
  "Finger Heart": 5,
  "GG": 1,
  "Ice Cream Cone": 1,
  "Doughnut": 3,
  "Cap": 1,
  "Love you": 5,
  "Sun Cream": 5,
  "Hearts": 5,
  "Perfume": 20,
  "Sunglasses": 20,
  "Hand Hearts": 100,
  "Drama Queen": 5,
  "Money Gun": 100,
  "Galaxy": 1000,
  "Universe": 3000,
  "Lion": 500,
  "Rocket": 20,
  "Interstellar": 200,
};

function resolveGiftValue(data) {
  if (data.diamondCount && data.diamondCount > 0) return data.diamondCount;
  if (data.giftValue && data.giftValue > 0) return data.giftValue;
  if (data.diamonds && data.diamonds > 0) return data.diamonds;
  const name = data.giftName || data.name || "";
  if (giftValues[name] !== undefined) return giftValues[name];
  return 1;
}

// ═══════════════════════════════════════════
// ATTACK MAPPING
// ═══════════════════════════════════════════
function getAttackByGiftValue(value) {
  if (value >= 100 && value <= 100) return { name: "HALF_DAMAGE", damage: 0, special: "half", emoji: "💥" };
  if (value > 100) return { name: "FINISHER", damage: 150, special: null, emoji: "☠️" };
  if (value >= 30) return { name: "CHOKE", damage: 50, special: null, emoji: "🤼" };
  if (value >= 20) return { name: "HEADBUTT", damage: 35, special: null, emoji: "🤕" };
  if (value >= 5) return { name: "KICK", damage: 20, special: null, emoji: "🦵" };
  return { name: "PUNCH", damage: 10, special: null, emoji: "👊" };
}

// ═══════════════════════════════════════════
// PLAYER FACTORY
// ═══════════════════════════════════════════
function createFighter(userId, name, isBot = false) {
  return {
    userId,
    name,
    hp: 100,
    maxHp: 100,
    slot: -1,
    inRing: false,
    alive: true,
    lastSeenAt: Date.now(),
    totalSpent: 0,
    totalDamage: 0,
    kills: 0,
    lastAttackAt: 0,
    isBot,
  };
}

// ═══════════════════════════════════════════
// CORE LOGIC
// ═══════════════════════════════════════════
function findInRing(userId) { return ring.find(f => f.userId === userId); }
function findInQueue(userId) { return queue.find(f => f.userId === userId); }

function reassignSlots() {
  ring.forEach((f, i) => { f.slot = i; });
}

function logEvent(msg) {
  const entry = { time: Date.now(), msg };
  logs.unshift(entry);
  if (logs.length > MAX_LOGS) logs.length = MAX_LOGS;
}

function spawnOrQueue(userId, name) {
  if (findInRing(userId)) return findInRing(userId);
  if (findInQueue(userId)) return findInQueue(userId);

  const fighter = createFighter(userId, name);
  if (ring.length < MAX_RING) {
    fighter.inRing = true;
    fighter.slot = ring.length;
    ring.push(fighter);
    logEvent(`⚔️ ${name} دخل الحلبة!`);
    manageBotPresence();
  } else {
    queue.push(fighter);
    logEvent(`⏳ ${name} في قائمة الانتظار (${queue.length})`);
  }
  broadcastState();
  return fighter;
}

function getTarget(attacker) {
  if (ring.length <= 1) return null;
  const idx = ring.indexOf(attacker);
  if (idx === -1) return null;
  const targetIdx = (idx + 1) % ring.length;
  return ring[targetIdx];
}

function applyAttack(attackerUserId, giftValue) {
  const attacker = findInRing(attackerUserId);
  if (!attacker || !attacker.alive) return;

  const now = Date.now();
  if (!attacker.isBot && now - attacker.lastAttackAt < COOLDOWN_MS) return;
  attacker.lastAttackAt = now;
  attacker.lastSeenAt = now;
  attacker.totalSpent += giftValue;

  const target = getTarget(attacker);
  if (!target) return;

  const attack = getAttackByGiftValue(giftValue);
  let actualDamage = 0;

  if (attack.special === "half") {
    actualDamage = Math.floor(target.hp / 2);
    target.hp -= actualDamage;
  } else {
    actualDamage = attack.damage;
    target.hp -= actualDamage;
  }

  attacker.totalDamage += actualDamage;

  logEvent(`${attack.emoji} ${attacker.name} ← ${attack.name} → ${target.name} (-${actualDamage} HP)`);

  if (target.hp <= 0) {
    target.hp = 0;
    target.alive = false;
    attacker.kills++;
    logEvent(`💀 ${target.name} مات على يد ${attacker.name}!`);
    eliminateFighter(target);
  }

  broadcastState();
}

function eliminateFighter(fighter) {
  ring = ring.filter(f => f.userId !== fighter.userId);
  reassignSlots();
  refillRingSlots();
}

function removeFighterByLeave(userId) {
  const inR = findInRing(userId);
  if (inR) {
    logEvent(`🚪 ${inR.name} غادر الحلبة`);
    ring = ring.filter(f => f.userId !== userId);
    reassignSlots();
    refillRingSlots();
    broadcastState();
    return;
  }
  const qIdx = queue.findIndex(f => f.userId === userId);
  if (qIdx !== -1) {
    logEvent(`🚪 ${queue[qIdx].name} غادر الانتظار`);
    queue.splice(qIdx, 1);
    broadcastState();
  }
}

function refillRingSlots() {
  while (ring.length < MAX_RING && queue.length > 0) {
    const next = queue.shift();
    next.inRing = true;
    next.hp = 100;
    next.alive = true;
    next.slot = ring.length;
    ring.push(next);
    logEvent(`🔥 ${next.name} دخل الحلبة من الانتظار!`);
  }
  reassignSlots();
  manageBotPresence();
}

function broadcastState() {
  io.emit("state", {
    ring: ring.map(f => ({
      userId: f.userId,
      name: f.name,
      hp: f.hp,
      maxHp: f.maxHp,
      slot: f.slot,
      totalSpent: f.totalSpent,
      totalDamage: f.totalDamage,
      kills: f.kills,
      alive: f.alive,
      isBot: f.isBot,
    })),
    queue: queue.map(f => ({ userId: f.userId, name: f.name })),
    logs: logs.slice(0, 30),
  });
}

function updateActivity(userId) {
  const f = findInRing(userId) || findInQueue(userId);
  if (f) f.lastSeenAt = Date.now();
}

// ═══════════════════════════════════════════
// BOT: ali sayed
// ═══════════════════════════════════════════
const BOT_ID = "__bot_ali_sayed__";
const BOT_NAME = "ali sayed";

function manageBotPresence() {
  const botInRing = findInRing(BOT_ID);
  if (ring.length === 0 && queue.length === 0 && !botInRing) {
    spawnBot();
  }
}

function spawnBot() {
  if (findInRing(BOT_ID) || findInQueue(BOT_ID)) return;
  const bot = createFighter(BOT_ID, BOT_NAME, true);
  bot.inRing = true;
  bot.slot = ring.length;
  ring.push(bot);
  logEvent(`🤖 ${BOT_NAME} (بوت) في الحلبة!`);
  broadcastState();
  startBotAttacks();
}

function startBotAttacks() {
  if (botInterval) return;
  botInterval = setInterval(() => {
    const bot = findInRing(BOT_ID);
    if (!bot || !bot.alive) {
      stopBotAttacks();
      return;
    }
    if (ring.length <= 1) return;
    const randomValues = [1, 1, 1, 5, 5, 20, 1, 1, 5];
    const val = randomValues[Math.floor(Math.random() * randomValues.length)];
    bot.lastSeenAt = Date.now();
    applyAttack(BOT_ID, val);
  }, BOT_ATTACK_INTERVAL);
}

function stopBotAttacks() {
  if (botInterval) {
    clearInterval(botInterval);
    botInterval = null;
  }
}

// ═══════════════════════════════════════════
// INACTIVITY CHECK
// ═══════════════════════════════════════════
setInterval(() => {
  const now = Date.now();
  const inactive = ring.filter(f => !f.isBot && now - f.lastSeenAt > INACTIVITY_MS);
  inactive.forEach(f => {
    logEvent(`⏰ ${f.name} خرج بسبب عدم النشاط`);
    ring = ring.filter(x => x.userId !== f.userId);
  });
  if (inactive.length > 0) {
    reassignSlots();
    refillRingSlots();
    broadcastState();
  }
  const inactiveQ = queue.filter(f => now - f.lastSeenAt > INACTIVITY_MS);
  if (inactiveQ.length > 0) {
    queue = queue.filter(f => now - f.lastSeenAt <= INACTIVITY_MS);
    broadcastState();
  }
}, 30000);

// ═══════════════════════════════════════════
// TIKTOK CONNECTION
// ═══════════════════════════════════════════
let tiktokConnection = null;

function connectTikTok() {
  console.log(`[TikTok] Connecting to @${TIKTOK_USERNAME}...`);
  tiktokConnection = new WebcastPushConnection(TIKTOK_USERNAME);

  tiktokConnection.connect().then(state => {
    console.log(`[TikTok] ✅ Connected! Room: ${state.roomId}`);
  }).catch(err => {
    console.error(`[TikTok] ❌ Connection failed:`, err.message);
    console.log("[TikTok] Retrying in 10s...");
    setTimeout(connectTikTok, 10000);
  });

  tiktokConnection.on("gift", data => {
    try {
      const userId = data.userId || data.uniqueId || `user_${data.nickname}`;
      const name = data.nickname || data.uniqueId || "Unknown";
      const val = resolveGiftValue(data);
      const fighter = findInRing(userId);
      if (fighter && fighter.alive) {
        applyAttack(userId, val);
      } else {
        spawnOrQueue(userId, name);
        if (findInRing(userId)) {
          setTimeout(() => applyAttack(userId, val), 500);
        }
      }
    } catch (e) { console.error("[Gift Error]", e.message); }
  });

  tiktokConnection.on("chat", data => {
    try {
      const userId = data.userId || data.uniqueId || `user_${data.nickname}`;
      updateActivity(userId);
    } catch (e) {}
  });

  tiktokConnection.on("member", data => {
    try {
      const userId = data.userId || data.uniqueId || `user_${data.nickname}`;
      updateActivity(userId);
    } catch (e) {}
  });

  tiktokConnection.on("disconnected", () => {
    console.log("[TikTok] Disconnected. Reconnecting in 5s...");
    setTimeout(connectTikTok, 5000);
  });

  tiktokConnection.on("error", err => {
    console.error("[TikTok] Error:", err.message);
  });
}

// ═══════════════════════════════════════════
// SOCKET.IO
// ═══════════════════════════════════════════
io.on("connection", socket => {
  console.log("[Socket] Client connected");
  broadcastState();
  socket.on("disconnect", () => console.log("[Socket] Client disconnected"));
});

// ═══════════════════════════════════════════
// START
// ═══════════════════════════════════════════
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[Server] Running on http://localhost:${PORT}`);
  spawnBot();
  connectTikTok();
});
