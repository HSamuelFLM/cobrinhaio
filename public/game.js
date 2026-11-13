const socket = io(window.GAME_SERVER_URL || undefined, { transports: ['websocket'], upgrade: false });

let myId = null, gameConfig = null;
let players = [], foods = [], leaderboard = [];
let camera = { x: 0, y: 0 };
let mouseAngle = 0, isBoosting = false, gameRunning = false;
let lastInputSentAt = 0;

// Interpolação
let previousState = null, currentState = null, stateTimestamp = 0;

let customColors = { body: '#4ECDC4', head: '#44B3A8', eye: '#FFFFFF' };
let selectedSkinId = 'classic';

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const minimapCanvas = document.getElementById('minimapCanvas');
const minimapCtx = minimapCanvas.getContext('2d');

// ============= INIT =============
function init() {
    console.log('🎮 20 TPS servidor | 60+ FPS cliente com interpolação');
    resizeCanvases();
    window.addEventListener('resize', resizeCanvases);
    setupColorPresets();
    setupColorInputs();
    startPreview();
    document.getElementById('playButton').addEventListener('click', startGame);
    document.getElementById('nameInput').addEventListener('keypress', e => { if (e.key === 'Enter') startGame(); });
    setupSocketEvents();
}

function resizeCanvases() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

// ============= PREVIEW =============
let previewTime = 0;
function startPreview() {
    const pc = document.getElementById('previewCanvas');
    const pctx = pc.getContext('2d');
    (function anim() {
        pctx.clearRect(0, 0, pc.width, pc.height);
        pctx.fillStyle = '#0a0a1a'; pctx.fillRect(0, 0, pc.width, pc.height);
        previewTime += 0.03;
        const segs = [], cx = pc.width / 2, cy = pc.height / 2;
        for (let i = 0; i < 18; i++) segs.push({ x: cx + Math.sin(previewTime + i * 0.3) * 60 + i * 3, y: cy + Math.cos(previewTime + i * 0.25) * 35 });
        segs.forEach((s, i) => {
            const r = i === 0 ? 12 : 8;
            pctx.fillStyle = i === 0 ? customColors.head : customColors.body;
            pctx.beginPath(); pctx.arc(s.x, s.y, r, 0, Math.PI * 2); pctx.fill();
            if (i === 0) {
                const a = Math.atan2(segs[0].y - segs[1].y, segs[0].x - segs[1].x);
                for (let d = -1; d <= 1; d += 2) {
                    const ex = s.x + Math.cos(a + d * 0.6) * 5, ey = s.y + Math.sin(a + d * 0.6) * 5;
                    pctx.fillStyle = customColors.eye; pctx.beginPath(); pctx.arc(ex, ey, 4, 0, Math.PI * 2); pctx.fill();
                    pctx.fillStyle = '#000'; pctx.beginPath(); pctx.arc(ex + Math.cos(a) * 1.5, ey + Math.sin(a) * 1.5, 2, 0, Math.PI * 2); pctx.fill();
                }
            }
        });
        requestAnimationFrame(anim);
    })();
}

// ============= COLORS & SKINS =============
function setupColorPresets() {
    const colors = ['#4ECDC4', '#FF6B6B', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#F7DC6F', '#A29BFE', '#FD79A8', '#00B894', '#6C5CE7', '#E17055', '#00CEC9', '#FF7675', '#74B9FF', '#55EFC4', '#FAB1A0', '#81ECEC'];
    ['body', 'head'].forEach(part => {
        const c = document.getElementById(`${part}Presets`); c.innerHTML = '';
        colors.forEach(color => {
            const d = document.createElement('div'); d.className = 'preset-dot'; d.style.backgroundColor = color; d.title = color;
            d.addEventListener('click', () => { customColors[part] = color; document.getElementById(`${part}Color`).value = color; document.getElementById(`${part}Hex`).value = color; });
            c.appendChild(d);
        });
    });
}

function setupColorInputs() {
    ['body', 'head', 'eye'].forEach(part => {
        document.getElementById(`${part}Color`).addEventListener('input', e => { customColors[part] = e.target.value; document.getElementById(`${part}Hex`).value = e.target.value; });
        document.getElementById(`${part}Hex`).addEventListener('input', e => { if (/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) { customColors[part] = e.target.value; document.getElementById(`${part}Color`).value = e.target.value; } });
    });
}

function renderSkinGrid(skins) {
    const g = document.getElementById('skinsGrid'); g.innerHTML = '';
    skins.forEach(s => {
        const c = document.createElement('div'); c.className = 'skin-card'; if (s.id === selectedSkinId) c.classList.add('selected');
        c.addEventListener('click', () => { document.querySelectorAll('.skin-card').forEach(x => x.classList.remove('selected')); c.classList.add('selected'); selectedSkinId = s.id; customColors.body = s.body; customColors.head = s.head; customColors.eye = s.eye; document.getElementById('bodyColor').value = s.body; document.getElementById('bodyHex').value = s.body; document.getElementById('headColor').value = s.head; document.getElementById('headHex').value = s.head; document.getElementById('eyeColor').value = s.eye; document.getElementById('eyeHex').value = s.eye; });
        const o = document.createElement('div'); o.className = 'skin-circle'; o.style.background = `linear-gradient(135deg,${s.head},${s.body})`;
        const l = document.createElement('div'); l.className = 'skin-label'; l.textContent = s.name;
        c.appendChild(o); c.appendChild(l); g.appendChild(c);
    });
}

// ============= SOCKET EVENTS =============
function setupSocketEvents() {
    socket.on('init', data => { myId = data.id; gameConfig = data.config; renderSkinGrid(data.config.skins); });
    socket.on('gameState', state => {
        previousState = currentState; currentState = state; stateTimestamp = performance.now();
        players = state.players || []; foods = state.foods || []; leaderboard = state.leaderboard || [];
        const me = players.find(p => p.id === myId); if (me?.segments?.length) updateHUD(me);
        updateLeaderboard(); drawMinimap();
    });
    socket.on('died', d => showDeath(d.score));
    socket.on('respawn', () => { document.getElementById('deathPopup').style.display = 'none'; });
    socket.on('kicked', m => { alert(`👢 ${m.message || 'Expulso'}`); location.reload(); });
    socket.on('banned', m => { alert(`🚫 ${m.message || 'Banido'}`); location.reload(); });
}

// ============= START GAME =============
function startGame() {
    const n = document.getElementById('nameInput').value.trim(); if (n) socket.emit('setName', n);
    socket.emit('setColors', { ...customColors, skinId: selectedSkinId });
    document.getElementById('setupScreen').style.display = 'none'; document.getElementById('gameScreen').style.display = 'block';
    setupInput(); gameRunning = true; requestAnimationFrame(gameLoop);
}

// ============= INPUT =============
function setupInput() {
    canvas.addEventListener('mousemove', e => { const r = canvas.getBoundingClientRect(); mouseAngle = Math.atan2(e.clientY - r.top - canvas.height / 2, e.clientX - r.left - canvas.width / 2); });
    canvas.addEventListener('mousedown', () => isBoosting = true);
    canvas.addEventListener('mouseup', () => isBoosting = false);
    canvas.addEventListener('mouseleave', () => isBoosting = false);
    canvas.addEventListener('touchmove', e => { e.preventDefault(); const t = e.touches[0], r = canvas.getBoundingClientRect(); mouseAngle = Math.atan2(t.clientY - r.top - canvas.height / 2, t.clientX - r.left - canvas.width / 2); }, { passive: false });
    canvas.addEventListener('touchstart', e => { e.preventDefault(); isBoosting = true; });
    canvas.addEventListener('touchend', () => isBoosting = false);
    const bb = document.getElementById('boostButton'); if (bb) { bb.addEventListener('mousedown', () => isBoosting = true); bb.addEventListener('mouseup', () => isBoosting = false); bb.addEventListener('mouseleave', () => isBoosting = false); bb.addEventListener('touchstart', e => { e.preventDefault(); isBoosting = true; }); bb.addEventListener('touchend', () => isBoosting = false); }
}

// ============= GAME LOOP (60+ FPS) =============
function gameLoop(ts) {
    if (!gameRunning) return;
    requestAnimationFrame(gameLoop);
    if (ts - lastInputSentAt >= 50) {
        socket.emit('input', { angle: mouseAngle, boost: isBoosting });
        lastInputSentAt = ts;
    }
    if (currentState) { const me = currentState.players.find(p => p.id === myId); if (me?.segments?.length) { const h = me.segments[0]; camera.x += (h.x - canvas.width / 2 - camera.x) * 0.1; camera.y += (h.y - canvas.height / 2 - camera.y) * 0.1; } }
    render();
}

// ============= RENDER COM INTERPOLAÇÃO =============
function render() {
    ctx.fillStyle = '#0a0a1a'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const gs = 50; ctx.strokeStyle = 'rgba(255,255,255,0.03)'; ctx.lineWidth = 1;
    for (let x = -camera.x % gs; x < canvas.width; x += gs) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke(); }
    for (let y = -camera.y % gs; y < canvas.height; y += gs) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke(); }
    if (gameConfig) { ctx.strokeStyle = '#ff4444'; ctx.lineWidth = 4; ctx.strokeRect(-camera.x, -camera.y, gameConfig.worldWidth, gameConfig.worldHeight); }

    if (currentState) {
        const now = performance.now(), tickTime = 1000 / 20, t = Math.max(0, Math.min((now - stateTimestamp) / tickTime, 1.0));

        for (const f of currentState.foods) {
            const sx = f.x - camera.x, sy = f.y - camera.y; if (sx < -50 || sx > canvas.width + 50 || sy < -50 || sy > canvas.height + 50) continue;
            ctx.fillStyle = f.color; ctx.beginPath(); ctx.arc(sx, sy, f.radius || 5, 0, Math.PI * 2); ctx.fill();
            if (f.value >= 3) { ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.beginPath(); ctx.arc(sx - (f.radius || 5) * 0.3, sy - (f.radius || 5) * 0.3, (f.radius || 5) * 0.4, 0, Math.PI * 2); ctx.fill(); }
        }

        for (const p of currentState.players) {
            if (!p.segments?.length) continue;
            let pp = null; if (previousState) pp = previousState.players.find(x => x.id === p.id);
            const cl = p.colors || { body: '#4ECDC4', head: '#44B3A8', eye: '#FFFFFF' };
            const segs = p.segments.slice(0, 50);
            for (let i = segs.length - 1; i >= 0; i--) {
                let seg = segs[i];
                if (pp?.segments?.[i]) { const ps = pp.segments[i]; seg = { x: ps.x + (seg.x - ps.x) * t, y: ps.y + (seg.y - ps.y) * t }; }
                const sx = seg.x - camera.x, sy = seg.y - camera.y; if (sx < -40 || sx > canvas.width + 40 || sy < -40 || sy > canvas.height + 40) continue;
                const r = i === 0 ? 9 : 6; ctx.fillStyle = i === 0 ? cl.head : cl.body; ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
                if (i === 0 && p.segments.length > 1) {
                    const n = p.segments[1], a = Math.atan2(seg.y - n.y, seg.x - n.x);
                    for (let s = -1; s <= 1; s += 2) {
                        const ex = sx + Math.cos(a + s * 0.55) * 4, ey = sy + Math.sin(a + s * 0.55) * 4;
                        ctx.fillStyle = cl.eye; ctx.beginPath(); ctx.arc(ex, ey, 3.5, 0, Math.PI * 2); ctx.fill();
                        ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(ex + Math.cos(a) * 1.2, ey + Math.sin(a) * 1.2, 1.8, 0, Math.PI * 2); ctx.fill();
                    }
                }
            }
            const h = p.segments[0]; let nx = h.x - camera.x, ny = h.y - camera.y;
            if (pp?.segments?.[0]) { const ph = pp.segments[0]; nx = ph.x + (h.x - ph.x) * t - camera.x; ny = ph.y + (h.y - ph.y) * t - camera.y; }
            if (nx > -100 && nx < canvas.width + 100 && ny > -100 && ny < canvas.height + 100) { ctx.fillStyle = '#fff'; ctx.font = 'bold 12px Poppins'; ctx.textAlign = 'center'; ctx.fillText(p.name, nx, ny - 22); if (p.id === myId) { ctx.fillStyle = '#ffd700'; ctx.font = 'bold 10px Poppins'; ctx.fillText(`⭐ ${Math.floor(p.score)}`, nx, ny + 22); } }
        }
    }
}

// ============= MINIMAP =============
function drawMinimap() { minimapCtx.fillStyle = 'rgba(0,0,0,0.8)'; minimapCtx.fillRect(0, 0, 150, 150); if (!gameConfig || !currentState) return; const sx = 150 / gameConfig.worldWidth, sy = 150 / gameConfig.worldHeight; minimapCtx.strokeStyle = '#ff4444'; minimapCtx.lineWidth = 1; minimapCtx.strokeRect(0, 0, 150, 150); for (const p of currentState.players) { if (!p.segments?.length) continue; const h = p.segments[0]; minimapCtx.fillStyle = p.id === myId ? '#fff' : (p.colors?.body || '#4ECDC4'); minimapCtx.fillRect(h.x * sx, h.y * sy, 3, 3); } }

// ============= HUD =============
function updateHUD(p) { document.getElementById('scoreValue').textContent = Math.floor(p.score); document.getElementById('lengthValue').textContent = p.length; const b = document.getElementById('boostStatus'); if (p.boosting) { b.textContent = '⚡ ATIVO'; b.style.color = '#ff6b6b'; } else if (p.score <= 10) { b.textContent = '❌ PRECISA COMER'; b.style.color = '#ff4444'; } else { b.textContent = '✅ PRONTO'; b.style.color = '#4ecdc4'; } }
function updateLeaderboard() {
    const list = document.getElementById('leaderboardList');
    list.replaceChildren();
    if (!leaderboard.length) {
        const empty = document.createElement('li');
        empty.textContent = 'Nenhum jogador';
        empty.style.color = '#888';
        list.appendChild(empty);
        return;
    }
    leaderboard.forEach((entry, index) => {
        const item = document.createElement('li');
        const medal = index === 0 ? '🥇 ' : index === 1 ? '🥈 ' : index === 2 ? '🥉 ' : `${index + 1}. `;
        item.textContent = `${medal}${entry.name}: ${entry.score}`;
        list.appendChild(item);
    });
}
function showDeath(s) { const p = document.getElementById('deathPopup'); document.getElementById('deathScore').textContent = s; p.style.display = 'flex'; let c = 3; document.getElementById('countdown').textContent = c; const i = setInterval(() => { c--; document.getElementById('countdown').textContent = c; if (c <= 0) { clearInterval(i); p.style.display = 'none'; } }, 1000); }

// ============= START =============
window.addEventListener('DOMContentLoaded', init);