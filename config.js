const CONFIG = {
    // Mundo
    WORLD_WIDTH: 6000,
    WORLD_HEIGHT: 6000,

    // Cobra
    INITIAL_LENGTH: 10,
    MIN_SPEED: 3.5,
    BOOST_SPEED: 7.0,
    BASE_RADIUS: 8,
    SEGMENT_SPACING: 6,

    // Física
    TURN_RATE: 0.15,
    COLLISION_DISTANCE: 15,
    FOOD_COLLECT_RADIUS: 25,

    // Boost
    BOOST_COST_INTERVAL: 100,
    BOOST_TRAIL_FOOD: 0.35,
    BOOST_TRAIL_SPACING: 30,

    // Comida
    FOOD_COUNT: 800,
    FOOD_RADIUS: 5,
    SUPER_FOOD_RADIUS: 9,
    FOOD_VALUE: 1,
    SUPER_FOOD_VALUE: 3,

    // Servidor
    PORT: 3000,
    TICK_RATE: 20,
    MAX_PLAYERS: 50,
    RESPAWN_DELAY: 3000,
    ADMIN_PASSWORD: 'admin123',

    // Cores
    PRESET_COLORS: [
        '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
        '#FFEAA7', '#DDA0DD', '#F7DC6F', '#A29BFE',
        '#FD79A8', '#00B894', '#6C5CE7', '#E17055',
        '#00CEC9', '#FF7675', '#74B9FF', '#55EFC4',
        '#FAB1A0', '#81ECEC', '#FF9FF3', '#FECA57',
        '#FF6348', '#7BED9F', '#70A1FF', '#FFA502'
    ],

    SKINS: [
        { id: 'classic', name: 'Clássica', body: '#4ECDC4', head: '#44B3A8', eye: '#FFFFFF' },
        { id: 'dragon', name: 'Dragão', body: '#FF6B6B', head: '#EE5A24', eye: '#FECA57' },
        { id: 'galaxy', name: 'Galáxia', body: '#6C5CE7', head: '#A29BFE', eye: '#DFE6E9' },
        { id: 'neon', name: 'Neon', body: '#00FF00', head: '#00DD00', eye: '#FFFFFF' },
        { id: 'golden', name: 'Dourada', body: '#FFD700', head: '#FFED4A', eye: '#000000' },
        { id: 'ghost', name: 'Fantasma', body: '#DFE6E9', head: '#B2BEC3', eye: '#2D3436' },
        { id: 'robot', name: 'Robô', body: '#636E72', head: '#2D3436', eye: '#00B894' },
        { id: 'cobra', name: 'Cobra Real', body: '#2D3436', head: '#636E72', eye: '#FF7675' },
        { id: 'candy', name: 'Doce', body: '#FD79A8', head: '#E84393', eye: '#FFEAA7' },
        { id: 'ocean', name: 'Oceano', body: '#0984E3', head: '#74B9FF', eye: '#FFFFFF' }
    ]
};

module.exports = CONFIG;