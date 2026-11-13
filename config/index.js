// config/index.js — ZeroExtens Bots PRO (improved)
// FIX velocità spawn: spawnDelay 300 -> 0 (respawn immediato, massima velocità).
export const config = {
    serverSettings: {
        port: 80,
        secure: false,
        keyPath: 'path/to/privkey.pem',
        certPath: 'path/to/fullchain.pem',
        // Numero massimo di client contemporanei (protezione DDoS leggero)
        maxClients: 50,
        // Heartbeat interval ms per rilevare client zombie
        heartbeatInterval: 20000,
    },
    proxySettings: {
        protocol: "http",
        enableProxy: false,
        // Ruota proxy round-robin invece di shift/push (non consuma la lista)
        rotationMode: "round-robin",
    },
    facebookBotSettings: {
        skin: {
            // Lista completa skin disponibili nel gioco
            names: [
                'fly', 'spider', 'lizard', 'bat', 'snake', 'fox', 'coyote',
                'hunter', 'sumo', 'bear', 'cougar', 'panther', 'lion',
                'crocodile', 'shark', 'mammoth', 'raptor', 't_rex', 'kraken',
                'tiny_fairy', 'small_goblin', 'young_elf', 'grove_spirit',
                'mystical_dwarf', 'brave_halfling', 'wild_werewolf',
                'powerful_sorcerer', 'stealthy_assassin', 'valiant_knight',
                // Nuove skin aggiunte
                'shadow_wolf', 'fire_dragon', 'ice_phoenix', 'thunder_eagle',
                'poison_scorpion', 'golden_tiger', 'dark_knight', 'arcane_mage',
            ],
            enable: true,
            // Se true usa la skin passata dal client (campo xev-bot-skin)
            // Se false usa sempre una skin casuale dalla lista
            preferClientSkin: true,
        },
        useMassBoost: true,
        // Massa massima da impostare quando il client attiva maxMassMode
        // delt.io/doublesplit con token FB: 150 | agar.io nativo: 10000
        maxMassValues: {
            delt: 150,
            agar: 10000,
            doublesplit: 150,
        },
        // FIX: delay in ms tra uno spawn e il successivo (anti-flood).
        // Prima era 300; ora 0 per respawn immediato (massima velocità).
        spawnDelay: 0,
        // Quante volte un bot può morire prima di fermarsi (0 = infinito)
        maxDeaths: 0,
        // Auto-reconnect se il WS cade
        autoReconnect: true,
        // FIX riconnessione rapida: delay base ridotto e niente backoff lungo.
        reconnectDelay: 1000,
        maxReconnectAttempts: 1,
    },
    // Statistiche esposte via HTTP /stats (JSON)
    stats: {
        enable: true,
        path: '/stats',
    },
};
