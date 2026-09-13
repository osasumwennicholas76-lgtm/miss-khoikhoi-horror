/**
 * GAME CONFIGURATION & TUNING
 * Night at Queen's College — The Legend of Miss KhoiKhoi
 * All balance variables, stealth parameters, flashlight, AI timings,
 * inventory types and clue definitions live here.
 */

export const GAME_CONFIG = {
    width: 960,
    height: 540,
    physics: {
        gravity: { x: 0, y: 0 },
    },
    player: {
        speed: 150,          // top-down walk speed (px/s)
        runSpeed: 235,       // sprint speed while Shift is held (px/s)
        sneakSpeed: 95,      // slower when sneaking
        sprintNoiseFactor: 1.45, // sprinting widens the noise radius heard by Miss KhoiKhoi
        maxHp: 3,
        bodyW: 18,
        bodyH: 18,
    },
    flashlight: {
        radius: 200,
        fov: 65,
        ambient: 70,
        darkAlpha: 0.985,
        darkAmbient: 14,
        normalAmbient: 70,
        drainRate: 2.2,
        recharge: 38,
        maxBattery: 100,
        ghostUnlitAlpha: 0.06,
        ghostLitAlpha: 1.0,
    },
    khoikhoi: {
        patrolSpeed: 70,
        chaseSpeed: 150,     // 1.4x+ faster than walking player
        searchSpeed: 110,
        sightRange: 260,     // px detection distance
        hearingRange: 150,   // px noise detection (footsteps / torch click)
        attackRange: 26,     // contact damage distance
        loseSightTime: 2600, // ms before dropping to SEARCH
        searchTime: 4200,    // ms wandering last known pos
        damage: 1,
        attackCooldown: 1400,
    },
    colors: {
        background: 0x05060a,
        text: '#e8e6df',
    },
} as const;

export const GAME_WIDTH = GAME_CONFIG.width;
export const GAME_HEIGHT = GAME_CONFIG.height;

export const COLORS = {
    BACKGROUND: GAME_CONFIG.colors.background,
    TEXT: GAME_CONFIG.colors.text,
    WALL: 0x1a1d29,
    WALL_EDGE: 0x2c3145,
    FLOOR: 0x11131c,
    FLOOR_ALT: 0x151824,
    GRASS: 0x0e1a12,
    PLAYER: 0x4f8fd6,
    PLAYER_SKIN: 0xc98a5b,
    GHOST: 0xb3262b,
    GHOST_GLOW: 0xff5566,
    KEY: 0xe8c15a,
    CLUE: 0xd9d2b8,
    BATTERY: 0x54d98c,
    TORCH: 0xffd76a,
    DOOR: 0x6b4a2b,
    DOOR_LOCKED: 0x8a2b2b,
    HIDE: 0x3a2c1c,
    EXIT: 0x2ec4b6,
} as const;

// ---------------------------------------------------------------------------
// INVENTORY / KEYS
// ---------------------------------------------------------------------------
export type KeyId = "brass" | "master";

export interface InventoryState {
    hasTorch: boolean;
    keys: KeyId[];
    cluesFound: string[];
    battery: number;
}

// ---------------------------------------------------------------------------
// CLUE / NOTE DEFINITIONS
// ---------------------------------------------------------------------------
export interface ClueDef {
    id: string;
    title: string;
    text: string;
    hint?: string;
}

export const CLUES: Record<string, ClueDef> = {
    diary1: {
        id: "diary1",
        title: "Torn Diary Page",
        text: "12th June. They say Miss KhoiKhoi walked the halls long after the bell. Her heels — khoi... khoi... khoi... — echoed even when no one was there. The night she vanished, the lab lights stayed on until morning.",
        hint: "She still patrols the corridors.",
    },
    chemistry: {
        id: "chemistry",
        title: "Chemistry Riddle Note",
        text: "To open the Science Lab, remember what the teacher drilled into us: Carbon atomic number, then the year this college was founded. Carbon = 06. Founded = 84.",
        hint: "The lab code is a 4-digit number: 0684.",
    },
    photo1: {
        id: "photo1",
        title: "Half of an Old Photograph",
        text: "A faded staff photo, torn down the middle. On this half, the back reads: The Principal's office remembers the year we...",
        hint: "The first two digits of the office code: 19.",
    },
    photo2: {
        id: "photo2",
        title: "The Other Half",
        text: "The matching torn half. Scrawled on the back in red ink: ...77. Never speak of what happened in 77.",
        hint: "The full office code is 1977.",
    },
    warning: {
        id: "warning",
        title: "Principal's Warning",
        text: "MEMO — STRICTLY CONFIDENTIAL. Any student found in the Science Wing after 10pm will be dealt with by the caretaker. The gate key is locked in my safe. Do NOT make me use it.",
        hint: "The Master Gate Key is inside the Principal's safe.",
    },
    confession: {
        id: "confession",
        title: "The Teacher's Confession",
        text: "I was there the night of the fire in 77. We told the students she went home. We lied. She is still here — and she is looking for whoever never let her leave.",
        hint: "All 5 clues gathered — the full truth is revealed.",
    },
};

export const TOTAL_CLUES = Object.keys(CLUES).length;

// ---------------------------------------------------------------------------
// DOOR / KEYPAD PUZZLES
// ---------------------------------------------------------------------------
export interface DoorDef {
    id: string;
    title: string;
    requiredCode?: string;
    requiredKey?: KeyId;
}

export const DOORS: Record<string, DoorDef> = {
    lab: { id: "lab", title: "Science Laboratory", requiredCode: "0684" },
    office: { id: "office", title: "Principal's Office", requiredCode: "1977" },
    mainhall: { id: "mainhall", title: "Main Hall Door", requiredKey: "brass" },
    gate: { id: "gate", title: "Compound Exit Gate", requiredKey: "master" },
};

// ---------------------------------------------------------------------------
// SETTINGS (mutable runtime copy)
// ---------------------------------------------------------------------------
export interface GameSettings {
    musicVol: number;     // 0..1
    sfxVol: number;       // 0..1
    brightness: number;   // 0..1 (raises ambient light floor)
    vibration: boolean;   // haptics
}

export const DEFAULT_SETTINGS: GameSettings = {
    musicVol: 0.6,
    sfxVol: 0.8,
    brightness: 0.32,
    vibration: true,
};

export const runtimeSettings: GameSettings = { ...DEFAULT_SETTINGS };

// ---------------------------------------------------------------------------
// TUTORIAL STEPS
// ---------------------------------------------------------------------------
export const TUTORIAL_STEPS: { title: string; body: string }[] = [
    { title: "Move", body: "Use WASD / Arrow keys (or the on-screen joystick) to walk through the dark corridors." },
    { title: "Explore", body: "Sneak room to room. Your torch is your only light — the school is pitch black at night." },
    { title: "Interact", body: "Press E / Space (or the [E] button) near doors, notes, furniture and the safe." },
    { title: "Collect Items", body: "Pick up keys and batteries. The Brass Key opens the Main Hall; the Master Key opens the gate." },
    { title: "Use Torch", body: "Press F (or the torch button) to toggle your flashlight. It drains battery — find spares." },
    { title: "Find Clues", body: "Read torn diary pages and notes. Gather all 5 to uncover the full mystery of Miss KhoiKhoi." },
    { title: "Solve Puzzles", body: "Some doors use a 4-digit keypad. Clues hide the codes — read them carefully." },
    { title: "Hide & Escape", body: "When you hear the heels, dive into a locker or under a desk. Then reach the Compound Gate." },
];