const socket = io();

const ringEl = document.getElementById("ring");
const queueEl = document.getElementById("queue");
const logsEl = document.getElementById("logs");

socket.on("state", (state) => {
  renderRing(state.ring);
  renderQueue(state.queue);
  renderLogs(state.logs);
});

function renderRing(fighters) {
  let html = "";
  for (let i = 0; i < 10; i++) {
    const f = fighters[i];
    if (f) {
      const hpPct = Math.max(0, Math.round((f.hp / f.maxHp) * 100));
      const hpColor = hpPct > 60 ? "#2dff6b" : hpPct > 30 ? "#ffd700" : "#ff2d55";
      const cls = [
        "fighter-slot",
        f.alive ? "active" : "dead",
        f.isBot ? "bot" : ""
      ].join(" ");

      html += `
        <div class="${cls}">
          <span class="slot-number">#${i + 1}</span>
          <div class="character char-color-${i} ${f.isBot ? 'bot-char' : ''}">
            <div class="char-head">
              <div class="char-eyes">
                <div class="char-eye"></div>
                <div class="char-eye"></div>
              </div>
            </div>
            <div class="char-body">
              <div class="char-arms">
                <div class="char-arm"></div>
                <div class="char-arm"></div>
              </div>
            </div>
            <div class="char-legs">
              <div class="char-leg"></div>
              <div class="char-leg"></div>
            </div>
          </div>
          <div class="fighter-name ${f.isBot ? 'bot-name' : ''}">${esc(f.name)}</div>
          <div class="hp-bar-container">
            <div class="hp-bar" style="width:${hpPct}%;background:${hpColor}"></div>
          </div>
          <div class="hp-text">${f.hp} / ${f.maxHp}</div>
          <div class="fighter-stats">
            <span>💰${f.totalSpent}</span>
            <span>⚔️${f.kills}</span>
          </div>
        </div>`;
    } else {
      html += `
        <div class="fighter-slot empty">
          <span class="empty-text">فارغ</span>
        </div>`;
    }
  }
  ringEl.innerHTML = html;
}

function renderQueue(q) {
  if (!q || q.length === 0) {
    queueEl.innerHTML = '<div style="color:#555;font-size:0.8rem">لا أحد في الانتظار</div>';
    return;
  }
  queueEl.innerHTML = q.map((p, i) =>
    `<div class="queue-item"><span class="queue-pos">${i + 1}</span>${esc(p.name)}</div>`
  ).join("");
}

function renderLogs(l) {
  if (!l || l.length === 0) {
    logsEl.innerHTML = '<div style="color:#555;font-size:0.8rem">لا أحداث بعد</div>';
    return;
  }
  logsEl.innerHTML = l.map(entry => {
    const t = new Date(entry.time);
    const ts = t.toLocaleTimeString("en", { hour12: false });
    return `<div class="log-entry">${entry.msg}<span class="log-time">${ts}</span></div>`;
  }).join("");
}

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}
