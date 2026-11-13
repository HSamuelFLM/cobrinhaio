const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const CONFIG = require('./config');
require('dotenv').config();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';
const FRONTEND_ORIGINS = new Set((process.env.FRONTEND_ORIGIN || '').split(',').map(value => value.trim()).filter(Boolean));
const LOCAL_ORIGINS = new Set(['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5173', 'http://127.0.0.1:5173']);
function isAllowedOrigin(origin) { return !origin || FRONTEND_ORIGINS.has(origin) || LOCAL_ORIGINS.has(origin); }
const loginAttempts = new Map();

function safeEqual(a, b) {
    const left = Buffer.from(String(a));
    const right = Buffer.from(String(b));
    return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function createAdminToken() {
    const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 60 * 60 * 1000 })).toString('base64url');
    const signature = crypto.createHmac('sha256', ADMIN_SECRET).update(payload).digest('base64url');
    return `${payload}.${signature}`;
}

function isValidAdminToken(token) {
    if (!ADMIN_SECRET || typeof token !== 'string') return false;
    const parts = token.split('.');
    if (parts.length !== 2) return false;
    const expected = crypto.createHmac('sha256', ADMIN_SECRET).update(parts[0]).digest('base64url');
    if (!safeEqual(parts[1], expected)) return false;
    try {
        const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
        return Number.isFinite(payload.exp) && payload.exp > Date.now();
    } catch {
        return false;
    }
}
const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
    pingInterval: 5000,
    pingTimeout: 3000,
    transports: ['websocket'],
    maxHttpBufferSize: 10 * 1024,
    cors: { origin: (origin, callback) => callback(null, isAllowedOrigin(origin)), methods: ['GET', 'POST'] },
    allowRequest: (req, callback) => callback(null, isAllowedOrigin(req.headers.origin)),
});

app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && isAllowedOrigin(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(origin && !isAllowedOrigin(origin) ? 403 : 204);
    next();
});
app.get('/healthz', (req, res) => res.json({ ok: true, players: state.players.size }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '10kb' }));

// ============= ESTADO DO JOGO =============
const state = {
    players: new Map(),
    foods: [],
    leaderboard: [],
    bannedIPs: new Set(),
    mutedPlayers: new Set(),
    stats: {
        started: Date.now(),
        totalPlayers: 0,
        peakPlayers: 0,
        totalDeaths: 0,
        totalFoodEaten: 0
    }
};

// ============= CLASSES =============
class Snake {
    constructor(id, name, ip) {
        this.id = id;
        this.name = name;
        this.ip = ip;
        this.colors = { body: '#4ECDC4', head: '#44B3A8', eye: '#FFFFFF' };
        this.skinId = 'classic';
        this.warnings = 0;
        this.alive = true;
        this.lastActivity = Date.now();
        this.reset();
    }

    reset() {
        const angle = Math.random() * Math.PI * 2;
        const margin = 500;
        const x = margin + Math.random() * (CONFIG.WORLD_WIDTH - margin * 2);
        const y = margin + Math.random() * (CONFIG.WORLD_HEIGHT - margin * 2);

        this.segments = [];
        for (let i = 0; i < CONFIG.INITIAL_LENGTH; i++) {
            this.segments.push({
                x: x - Math.cos(angle) * i * CONFIG.SEGMENT_SPACING,
                y: y - Math.sin(angle) * i * CONFIG.SEGMENT_SPACING
            });
        }

        this.angle = angle;
        this.targetAngle = angle;
        this.speed = CONFIG.MIN_SPEED;
        this.score = CONFIG.INITIAL_LENGTH;
        this.boosting = false;
        this.alive = true;
        this.lastActivity = Date.now();
        this.boostDistance = 0;
        this.trailDistance = 0;
    }

    get head() {
        return this.segments.length > 0 ? this.segments[0] : { x: 0, y: 0 };
    }

    get length() {
        return this.segments.length;
    }

    move() {
        if (!this.alive || this.segments.length === 0) return;

        // Rotação suave (lerp) - independe da velocidade
        let angleDiff = this.targetAngle - this.angle;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

        const turnAmount = angleDiff * CONFIG.TURN_RATE;
        this.angle += turnAmount;

        while (this.angle > Math.PI * 2) this.angle -= Math.PI * 2;
        while (this.angle < 0) this.angle += Math.PI * 2;

        // Boost só afeta velocidade linear
        this.speed = this.boosting ? CONFIG.BOOST_SPEED : CONFIG.MIN_SPEED;

        // Calcular nova posição
        const prevHead = this.head;
        const newHead = {
            x: prevHead.x + Math.cos(this.angle) * this.speed,
            y: prevHead.y + Math.sin(this.angle) * this.speed
        };

        this.segments.unshift(newHead);

        // Boost com consumo por distância e rastro de orbes
        if (this.boosting) {
            const distMoved = Math.hypot(newHead.x - prevHead.x, newHead.y - prevHead.y);
            this.boostDistance += distMoved;
            this.trailDistance += distMoved;

            // Consumir score
            while (this.boostDistance >= CONFIG.BOOST_COST_INTERVAL && this.score > CONFIG.INITIAL_LENGTH) {
                this.score -= 1;
                this.boostDistance -= CONFIG.BOOST_COST_INTERVAL;
            }

            // Rastro de orbes a cada TRAIL_SPACING pixels
            while (this.trailDistance >= CONFIG.BOOST_TRAIL_SPACING) {
                this.trailDistance -= CONFIG.BOOST_TRAIL_SPACING;

                // Criar orbe no meio da cobra
                const midIndex = Math.floor(this.segments.length / 2);
                if (midIndex > 0 && midIndex < this.segments.length) {
                    const seg = this.segments[midIndex];
                    state.foods.push(new Food(
                        seg.x + (Math.random() - 0.5) * 30,
                        seg.y + (Math.random() - 0.5) * 30,
                        this.colors.body,
                        1
                    ));
                }
            }

            // Parar boost se sem tamanho
            if (this.score <= CONFIG.INITIAL_LENGTH) {
                this.boosting = false;
                this.boostDistance = 0;
                this.trailDistance = 0;
                this.score = CONFIG.INITIAL_LENGTH;
            }
        } else {
            this.boostDistance = 0;
            this.trailDistance = 0;
        }

        // Manter tamanho
        const targetLength = Math.floor(this.score);
        while (this.segments.length > targetLength && this.segments.length > CONFIG.INITIAL_LENGTH) {
            this.segments.pop();
        }
    }
}

class Food {
    constructor(x, y, color, value) {
        this.id = crypto.randomUUID();
        this.x = x ?? Math.random() * CONFIG.WORLD_WIDTH;
        this.y = y ?? Math.random() * CONFIG.WORLD_HEIGHT;
        this.color = color || CONFIG.PRESET_COLORS[Math.floor(Math.random() * CONFIG.PRESET_COLORS.length)];
        this.value = value || CONFIG.FOOD_VALUE;
        this.radius = this.value >= CONFIG.SUPER_FOOD_VALUE ? CONFIG.SUPER_FOOD_RADIUS : CONFIG.FOOD_RADIUS;
    }
}

// ============= GERAÇÃO DE COMIDA =============
function generateFood() {
    state.foods = [];

    const clusters = 20;
    const clusterRadius = 600;
    const foodPerCluster = Math.floor(CONFIG.FOOD_COUNT / clusters);
    const cols = 5;
    const rows = 4;

    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const centerX = (CONFIG.WORLD_WIDTH / (cols + 1)) * (col + 1) + (Math.random() - 0.5) * 400;
            const centerY = (CONFIG.WORLD_HEIGHT / (rows + 1)) * (row + 1) + (Math.random() - 0.5) * 400;

            for (let j = 0; j < foodPerCluster; j++) {
                const angle = Math.random() * Math.PI * 2;
                const distance = Math.pow(Math.random(), 0.6) * clusterRadius;

                const x = Math.max(10, Math.min(CONFIG.WORLD_WIDTH - 10, centerX + Math.cos(angle) * distance));
                const y = Math.max(10, Math.min(CONFIG.WORLD_HEIGHT - 10, centerY + Math.sin(angle) * distance));

                const value = Math.random() < 0.20 ? CONFIG.SUPER_FOOD_VALUE : CONFIG.FOOD_VALUE;
                state.foods.push(new Food(x, y, null, value));
            }
        }
    }

    while (state.foods.length < CONFIG.FOOD_COUNT) {
        state.foods.push(new Food());
    }

    console.log(`🍎 ${state.foods.length} comidas em ${clusters} clusters (grade ${cols}x${rows})`);
}

// ============= LEADERBOARD =============
function getLeaderboard() {
    return Array.from(state.players.values())
        .filter(p => p.alive)
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)
        .map(p => ({
            id: p.id,
            name: p.name,
            score: Math.floor(p.score),
            colors: p.colors
        }));
}

// ============= MORTE =============
function killSnake(snake, killerId = null) {
    if (!snake.alive) return;

    snake.alive = false;
    state.stats.totalDeaths++;

    if (killerId) {
        const killer = state.players.get(killerId);
        if (killer && killer.alive) {
            killer.score += Math.floor(snake.score * 0.6);
        }
    }

    // Soltar comida ao morrer
    snake.segments.forEach((seg, i) => {
        if (i % 2 === 0) {
            state.foods.push(new Food(
                seg.x + (Math.random() - 0.5) * 30,
                seg.y + (Math.random() - 0.5) * 30,
                snake.colors.body,
                CONFIG.SUPER_FOOD_VALUE
            ));
        }
    });

    io.to(snake.id).emit('died', {
        score: Math.floor(snake.score),
        killer: killerId ? state.players.get(killerId)?.name : null
    });

    setTimeout(() => {
        if (state.players.has(snake.id) && !state.bannedIPs.has(snake.ip)) {
            snake.reset();
            io.to(snake.id).emit('respawn');
        }
    }, CONFIG.RESPAWN_DELAY);
}

// ============= COLISÕES =============
function checkCollisions(snake) {
    if (!snake.alive || snake.segments.length === 0) return true;

    const head = snake.head;

    // Bordas
    if (head.x < 0 || head.x > CONFIG.WORLD_WIDTH ||
        head.y < 0 || head.y > CONFIG.WORLD_HEIGHT) {
        killSnake(snake);
        return true;
    }

    // Coletar comida
    for (let i = state.foods.length - 1; i >= 0; i--) {
        const food = state.foods[i];
        if (Math.hypot(head.x - food.x, head.y - food.y) < CONFIG.FOOD_COLLECT_RADIUS) {
            snake.score += food.value;
            state.stats.totalFoodEaten++;
            state.foods.splice(i, 1);
        }
    }

    // Ignore os segmentos imediatamente atrás da cabeça: a distância entre eles é determinada pela velocidade por tick.
    // Comparar esses segmentos com o raio de colisão causava mortes instantâneas no spawn.
    const selfCollisionIgnore = Math.ceil(CONFIG.COLLISION_DISTANCE / Math.max(snake.speed, CONFIG.MIN_SPEED)) + 1;
    for (let i = selfCollisionIgnore; i < snake.segments.length; i++) {
        if (Math.hypot(head.x - snake.segments[i].x, head.y - snake.segments[i].y) < CONFIG.COLLISION_DISTANCE) {
            killSnake(snake);
            return true;
        }
    }

    // Colisão com outras cobras.
    for (const [otherId, other] of state.players) {
        if (otherId === snake.id || !other.alive || other.segments.length === 0) continue;
        if (Math.hypot(head.x - other.head.x, head.y - other.head.y) < CONFIG.COLLISION_DISTANCE) {
            killSnake(snake);
            killSnake(other);
            return true;
        }
        for (let i = 1; i < other.segments.length; i++) {
            if (Math.hypot(head.x - other.segments[i].x, head.y - other.segments[i].y) < CONFIG.COLLISION_DISTANCE) {
                killSnake(snake, otherId);
                return true;
            }
        }
    }

    return !snake.alive;
}

// ============= GAME LOOP (20 TPS) =============
function gameLoop() {
    const startTime = Date.now();

    // Limpar inativos
    const now = Date.now();
    for (const [id, snake] of state.players) {
        if (now - snake.lastActivity > 15000) {
            if (snake.alive) killSnake(snake);
            state.players.delete(id);
        }
    }

    // Mover
    for (const snake of state.players.values()) {
        if (snake.alive) snake.move();
    }

    // Colisões
    for (const snake of state.players.values()) {
        if (snake.alive) checkCollisions(snake);
    }

    // Reabastecer comida
    while (state.foods.length < CONFIG.FOOD_COUNT) {
        state.foods.push(new Food());
    }

    // Leaderboard
    state.leaderboard = getLeaderboard();

    // Broadcast
    broadcastState();

    // Próximo tick
    const elapsed = Date.now() - startTime;
    const delay = Math.max(0, 1000 / CONFIG.TICK_RATE - elapsed);
    setTimeout(gameLoop, delay);
}

function broadcastState() {
    const playersData = [];
    for (const snake of state.players.values()) {
        if (snake.alive) {
            playersData.push({
                id: snake.id,
                name: snake.name,
                segments: snake.segments.slice(0, 50),
                colors: snake.colors,
                score: Math.floor(snake.score),
                boosting: snake.boosting,
                angle: snake.angle,
                length: snake.length,
                speed: snake.speed
            });
        }
    }

    io.emit('gameState', {
        players: playersData,
        foods: state.foods.slice(0, 200).map(f => ({
            id: f.id, x: f.x, y: f.y, color: f.color, value: f.value, radius: f.radius
        })),
        leaderboard: state.leaderboard,
        serverTime: Date.now()
    });
}

// ============= ADMIN API =============
app.post('/admin/login', (req, res) => {
    if (!ADMIN_PASSWORD || !ADMIN_SECRET) {
        return res.status(503).json({ success: false, message: 'Painel admin desativado: configure ADMIN_PASSWORD e ADMIN_SECRET.' });
    }
    const ip = req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const attempts = loginAttempts.get(ip) || { count: 0, resetAt: now + 15 * 60 * 1000 };
    if (attempts.resetAt <= now) { attempts.count = 0; attempts.resetAt = now + 15 * 60 * 1000; }
    if (attempts.count >= 5) return res.status(429).json({ success: false, message: 'Muitas tentativas. Tente novamente em 15 minutos.' });
    if (safeEqual(req.body?.password || '', ADMIN_PASSWORD)) {
        loginAttempts.delete(ip);
        return res.json({ success: true, token: createAdminToken() });
    }
    attempts.count++;
    loginAttempts.set(ip, attempts);
    if (loginAttempts.size > 10000) {
        for (const [key, value] of loginAttempts) if (value.resetAt <= now) loginAttempts.delete(key);
    }
    res.status(401).json({ success: false, message: 'Senha incorreta' });
});

function requireAdmin(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!isValidAdminToken(token)) return res.status(401).json({ error: 'Não autorizado' });
    next();
}

function findPlayer(query) {
    const lower = query.toLowerCase();
    for (const [id, player] of state.players) {
        if (player.name.toLowerCase().includes(lower) || player.ip.includes(query) || id === query) {
            return { id, player };
        }
    }
    return null;
}

app.post('/admin/action', requireAdmin, (req, res) => {
    const { action, target = '' } = req.body || {};
    if (typeof action !== 'string' || typeof target !== 'string' || target.length > 128 || (action !== 'list' && !target.trim())) {
        return res.status(400).json({ success: false, message: 'Parâmetros inválidos' });
    }

    switch (action) {
        case 'list': {
            const players = Array.from(state.players.values()).map(p => ({
                id: p.id, name: p.name, ip: p.ip,
                score: Math.floor(p.score), alive: p.alive,
                warnings: p.warnings, length: p.length
            }));
            return res.json({ success: true, players });
        }

        case 'kick': {
            const result = findPlayer(target);
            if (!result) return res.json({ success: false, message: 'Jogador não encontrado' });
            io.to(result.id).emit('kicked', { message: 'Expulso pelo admin' });
            setTimeout(() => { const s = io.sockets.sockets.get(result.id); if (s) s.disconnect(true); }, 500);
            if (result.player.alive) killSnake(result.player);
            state.players.delete(result.id);
            return res.json({ success: true, message: `${result.player.name} expulso` });
        }

        case 'ban': {
            const result = findPlayer(target);
            if (!result) return res.json({ success: false });
            state.bannedIPs.add(result.player.ip);
            io.to(result.id).emit('banned', { message: 'Banido permanentemente' });
            setTimeout(() => { const s = io.sockets.sockets.get(result.id); if (s) s.disconnect(true); }, 500);
            if (result.player.alive) killSnake(result.player);
            state.players.delete(result.id);
            return res.json({ success: true, message: `${result.player.name} banido` });
        }

        case 'unban': {
            const removed = state.bannedIPs.delete(target);
            return res.json({ success: removed, message: removed ? 'Desbanido' : 'IP não encontrado' });
        }

        case 'warn': {
            const result = findPlayer(target);
            if (!result) return res.json({ success: false });
            result.player.warnings++;
            if (result.player.warnings >= 3) {
                io.to(result.id).emit('kicked', { message: '3 advertências' });
                setTimeout(() => { const s = io.sockets.sockets.get(result.id); if (s) s.disconnect(true); }, 500);
                if (result.player.alive) killSnake(result.player);
                state.players.delete(result.id);
                return res.json({ success: true, message: `${result.player.name} expulso (3 warns)` });
            }
            io.to(result.id).emit('warned', { message: `Advertência ${result.player.warnings}/3` });
            return res.json({ success: true, message: `${result.player.name} advertido` });
        }

        case 'mute': {
            const result = findPlayer(target);
            if (!result) return res.json({ success: false });
            state.mutedPlayers.add(result.id);
            io.to(result.id).emit('muted', { message: 'Silenciado' });
            return res.json({ success: true, message: `${result.player.name} silenciado` });
        }

        case 'unmute': {
            const result = findPlayer(target);
            if (!result) return res.json({ success: false });
            state.mutedPlayers.delete(result.id);
            io.to(result.id).emit('unmuted', { message: 'Desilenciado' });
            return res.json({ success: true });
        }

        case 'kickall': {
            let count = 0;
            for (const [id] of state.players) {
                io.to(id).emit('kicked', { message: 'Servidor limpo' });
                setTimeout(() => { const s = io.sockets.sockets.get(id); if (s) s.disconnect(true); }, 500);
                count++;
            }
            state.players.clear();
            return res.json({ success: true, message: `${count} expulsos` });
        }

        case 'stats': {
            return res.json({
                success: true, stats: {
                    online: state.players.size, peak: state.stats.peakPlayers,
                    totalPlayers: state.stats.totalPlayers, totalDeaths: state.stats.totalDeaths,
                    totalFood: state.stats.totalFoodEaten, foodOnMap: state.foods.length,
                    banned: state.bannedIPs.size, muted: state.mutedPlayers.size,
                    uptime: Math.floor((Date.now() - state.stats.started) / 1000)
                }
            });
        }

        default:
            return res.json({ success: false, message: 'Ação inválida' });
    }
});

// ============= SOCKET.IO =============
io.on('connection', (socket) => {
    const ip = socket.handshake.address;

    if (state.bannedIPs.has(ip)) {
        socket.emit('banned', { message: 'Banido' });
        return socket.disconnect(true);
    }

    if (state.players.size >= CONFIG.MAX_PLAYERS) {
        socket.emit('serverFull', { message: 'Servidor cheio' });
        return socket.disconnect(true);
    }

    let sameIP = 0;
    for (const p of state.players.values()) { if (p.ip === ip) sameIP++; }
    if (sameIP >= 3) return socket.disconnect(true);

    const snake = new Snake(socket.id, `Jogador_${Math.floor(Math.random() * 10000)}`, ip);
    state.players.set(snake.id, snake);
    state.stats.totalPlayers++;
    state.stats.peakPlayers = Math.max(state.stats.peakPlayers, state.players.size);

    console.log(`🟢 ${snake.name} (${ip}) - ${state.players.size} online`);

    socket.emit('init', {
        id: socket.id,
        config: {
            worldWidth: CONFIG.WORLD_WIDTH, worldHeight: CONFIG.WORLD_HEIGHT,
            minSpeed: CONFIG.MIN_SPEED, boostSpeed: CONFIG.BOOST_SPEED,
            turnRate: CONFIG.TURN_RATE, segmentSpacing: CONFIG.SEGMENT_SPACING,
            baseRadius: CONFIG.BASE_RADIUS, foodCollectRadius: CONFIG.FOOD_COLLECT_RADIUS,
            skins: CONFIG.SKINS, presetColors: CONFIG.PRESET_COLORS
        }
    });

    let lastInputAt = 0;
    socket.on('input', (data) => {
        const player = state.players.get(socket.id);
        if (!player || !player.alive) return;
        const now = Date.now();
        if (now - lastInputAt < 45) return;
        lastInputAt = now;
        player.lastActivity = now;
        if (!data || typeof data.angle !== 'number' || !Number.isFinite(data.angle)) return;
        player.targetAngle = Math.max(-Math.PI, Math.min(Math.PI, data.angle));
        player.boosting = data.boost === true && player.score > CONFIG.INITIAL_LENGTH;
    });

    socket.on('setName', (name) => {
        if (state.mutedPlayers.has(socket.id)) return;
        const player = state.players.get(socket.id);
        if (player && typeof name === 'string') {
            const cleanName = name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 20);
            if (cleanName) player.name = cleanName;
        }
    });

    socket.on('setColors', (colors) => {
        const player = state.players.get(socket.id);
        if (player && colors && typeof colors === 'object') {
            const validColor = value => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
            if (validColor(colors.body)) player.colors.body = colors.body;
            if (validColor(colors.head)) player.colors.head = colors.head;
            if (validColor(colors.eye)) player.colors.eye = colors.eye;
            if (typeof colors.skinId === 'string' && CONFIG.SKINS.some(s => s.id === colors.skinId)) player.skinId = colors.skinId;
        }
    });

    socket.on('disconnect', () => {
        const player = state.players.get(socket.id);
        if (player) {
            console.log(`🔴 ${player.name} saiu`);
            if (player.alive) killSnake(player);
            state.players.delete(socket.id);
        }
    });
});

// ============= INICIAR =============
if (require.main === module) {
    generateFood();
    gameLoop();
    server.listen(Number(process.env.PORT) || CONFIG.PORT, '0.0.0.0', () => {
    const os = require('os');
    const nets = os.networkInterfaces();
    let ip = 'localhost';
    for (const name of Object.keys(nets))
        for (const net of nets[name])
            if (net.family === 'IPv4' && !net.internal) { ip = net.address; break; }

    console.log('');
    console.log('═══════════════════════════════════');
    console.log('  🐍 SNAKE MULTIPLAYER');
    console.log('═══════════════════════════════════');
    console.log(`  🌐 http://localhost:${CONFIG.PORT}`);
    console.log(`  📡 http://${ip}:${CONFIG.PORT}`);
    console.log(`  👑 admin.html`);
    console.log(`  ⚙️  ${CONFIG.TICK_RATE} TPS | 🎮 60+ FPS`);
    console.log(`  🍎 ${CONFIG.FOOD_COUNT} comidas | 💨 Rastro: ${CONFIG.BOOST_TRAIL_SPACING}px`);
    console.log('═══════════════════════════════════');
    if (!ADMIN_PASSWORD || !ADMIN_SECRET) console.warn('⚠️  Painel admin desativado: configure ADMIN_PASSWORD e ADMIN_SECRET.');
    console.log('');
    });
}

module.exports = server;