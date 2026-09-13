import * as Phaser from 'phaser';
import { AUTO, Events, Game as PhaserGame, Scale, Scene } from 'phaser';
import { CLUES, COLORS, DOORS, GAME_CONFIG, GAME_HEIGHT, GAME_WIDTH, runtimeSettings } from './config';
import { LEVEL_MAP, TILE, WORLD_H, WORLD_W, zoneAt, Zone } from './levels';
import { GameControls, PlayerInput } from './controls';
import { DarknessRenderer } from './lighting';
import { haptic, playSFX } from './audio';

export { GAME_CONFIG, GAME_WIDTH, GAME_HEIGHT, COLORS, LEVEL_MAP, TILE, GameControls };

// ---------------------------------------------------------------------------
// EVENT BUS & SIGNAL INTERFACES
// ---------------------------------------------------------------------------
export const EventBus = new Events.EventEmitter();

export interface HudPayload {
    health: number;
    maxHealth: number;
    hasTorch: boolean;
    flashlight: boolean;
    battery: number;
    keys: string[];
    cluesFound: string[];
    totalClues: number;
    objective: string;
    zoneName: string;
    isDarkArea?: boolean;
    isHiding: boolean;
    isChased: boolean;
    isSprinting: boolean;
    promptText: string;
    promptType: string;
    tension: number; // 0..1 based on proximity to Miss KhoiKhoi
}

export interface InspectNotePayload {
    id: string;
    title: string;
    text: string;
    hint?: string;
}

export interface KeypadPayload {
    doorId: string;
    title: string;
    requiredCode: string;
    isUnlocked: boolean;
}

// ---------------------------------------------------------------------------
// PHASER ENGINE BOOTSTRAP
// ---------------------------------------------------------------------------
export const StartGame = (parent: string) => {
    const config: Phaser.Types.Core.GameConfig = {
        type: AUTO,
        width: GAME_WIDTH,
        height: GAME_HEIGHT,
        parent,
        backgroundColor: '#05060a',
        scale: {
            mode: Scale.FIT,
            autoCenter: Scale.CENTER_BOTH,
        },
        input: {
            activePointers: 3,
        },
        physics: {
            default: 'arcade',
            arcade: {
                gravity: { x: 0, y: 0 },
                fps: 60,
                fixedStep: true,
            },
        },
        scene: [Game],
    };

    const game = new PhaserGame(config);
    if (typeof window !== 'undefined') {
        (window as any).__PHASER_GAME__ = game;
        (window as any).__PHASER_EVENT_BUS__ = EventBus;
    }
    return game;
};

export default StartGame;

// ---------------------------------------------------------------------------
// SURVIVAL HORROR GAME SCENE
// ---------------------------------------------------------------------------
export class Game extends Scene {
    public controls!: GameControls;

    // Entities
    private player!: Phaser.Physics.Arcade.Sprite;
    private ghost!: Phaser.Physics.Arcade.Sprite;
    private ghostEyes!: Phaser.GameObjects.Arc;
    private ghostGlow!: Phaser.GameObjects.Arc;

    // Physics Groups
    private walls!: Phaser.Physics.Arcade.StaticGroup;
    private doorsGroup!: Phaser.Physics.Arcade.StaticGroup;
    private hidingSpots!: Phaser.Physics.Arcade.StaticGroup;
    private itemsGroup!: Phaser.Physics.Arcade.StaticGroup;
    private cluesGroup!: Phaser.Physics.Arcade.StaticGroup;

    // Lighting & Darkness overlay (torch cutouts live in lighting.ts)
    private darkness!: DarknessRenderer;

    // Game & Player State
    private isPlaying: boolean = false;
    private isHiding: boolean = false;
    private currentHidingSpot: Phaser.GameObjects.GameObject | null = null;
    private health: number = GAME_CONFIG.player.maxHp;
    private hasTorch: boolean = false;
    private flashlightOn: boolean = false;
    private battery: number = 100;
    private keys: string[] = [];
    private cluesFound: string[] = [];
    private unlockedDoors: Set<string> = new Set();
    private isSafeUnlocked: boolean = false;
    private lastFacingAngle: number = 0; // radians
    private invulnerableTime: number = 0;
    private isSprinting: boolean = false;
    private uiModalOpen: boolean = false;
    private openDoors: Set<string> = new Set();
    private promptText: string = '';
    private promptType: string = 'none';
    private promptTimer: number = 0;
    private hudThrottle: number = 0;

    // Miss KhoiKhoi Ghost AI State
    private ghostState: 'PATROL' | 'INVESTIGATE' | 'CHASE' | 'SEARCH' | 'STUNNED' = 'PATROL';
    private ghostWaypoints: { x: number; y: number }[] = [];
    private ghostCurrentWaypoint: number = 0;
    private ghostLastKnownPlayerPos: { x: number; y: number } = { x: 0, y: 0 };
    private ghostSearchTimer: number = 0;
    private heelClickTimer: number = 0;
    private heartbeatTimer: number = 0;
    private stepTimer: number = 0;

    // Audio & BGM references
    private bgmAmbient?: Phaser.Sound.BaseSound;
    private bgmChase?: Phaser.Sound.BaseSound;
    private currentZone: Zone = zoneAt(3, 2);

    // Door and interactive mappings
    private doorEntities: Map<string, Phaser.Physics.Arcade.Sprite> = new Map();
    private safeSprite!: Phaser.Physics.Arcade.Sprite;

    constructor() {
        super('Game');
    }

    preload() {
        // Load horror audio and music loops safely
        this.load.audio('sfx_horror_sting', 'assets/Sounds_Pack/Musical Effects/horror_sting.wav');
        this.load.audio('sfx_ghost_whisper', 'assets/Sounds_Pack/Other/ghost_long.wav');
        this.load.audio('sfx_keys', 'assets/Sounds_Pack/Items/keys_jingling.wav');
        this.load.audio('sfx_torch_click', 'assets/Sounds_Pack/Environment/fire_lighting.wav');
        this.load.audio('sfx_collect', 'assets/audio/sfx_collect.mp3');
        this.load.audio('sfx_hit', 'assets/audio/sfx_hit.mp3');
        this.load.audio('sfx_win', 'assets/audio/sfx_win.mp3');
        this.load.audio('sfx_gameover', 'assets/audio/sfx_gameover.mp3');
        this.load.audio('sfx_button', 'assets/audio/sfx_button.mp3');
        this.load.audio('bgm_ambient', 'assets/audio/bgm_chill.mp3');
        this.load.audio('bgm_chase', 'assets/audio/bgm_action.mp3');
    }

    create() {
        // Generate crisp procedural vector textures for Nigerian school elements
        this.generateSchoolTextures();

        // Setup world bounds and physics
        this.physics.world.setBounds(0, 0, WORLD_W, WORLD_H);
        this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);
        this.cameras.main.setBackgroundColor(0x05060a);

        // Instantiate Groups
        this.walls = this.physics.add.staticGroup();
        this.doorsGroup = this.physics.add.staticGroup();
        this.hidingSpots = this.physics.add.staticGroup();
        this.itemsGroup = this.physics.add.staticGroup();
        this.cluesGroup = this.physics.add.staticGroup();

        // Build floor tiles and parsed world map
        this.buildSchoolWorld();

        // Darkness Ambiance + torchlight cutout renderer (see lighting.ts)
        this.darkness = new DarknessRenderer(this);

        // Create universal controls
        this.controls = new GameControls(this, {
            joystickRadius: 55,
            hasActionButton: true,
            actionButtonText: 'E',
        });

        // Setup Player Colliders
        this.physics.add.collider(this.player, this.walls);
        this.physics.add.collider(this.player, this.doorsGroup);
        this.physics.add.collider(this.ghost, this.walls);

        // Setup Overlaps
        this.physics.add.overlap(this.player, this.itemsGroup, ((p: any, o: any) => {
            // Brass Key must be collected via proximity interaction (E / Space / Interact),
            // not by walking over it — see interactNearby().
            if ((o as Phaser.Physics.Arcade.Sprite).getData?.('type') === 'key_brass') return;
            this.handleItemPickup(p, o);
        }) as any, undefined, this);
        this.physics.add.overlap(this.player, this.cluesGroup, this.handleCluePickup as any, undefined, this);

        // Setup Camera Follow
        this.cameras.main.startFollow(this.player, true, 0.12, 0.12);
        this.cameras.main.setZoom(1.15);

        // Setup Desktop Hotkeys
        if (this.input.keyboard) {
            this.input.keyboard.on('keydown-F', () => this.toggleFlashlight());
            this.input.keyboard.on('keydown-E', () => this.interactNearby());
            this.input.keyboard.on('keydown-SPACE', () => this.interactNearby());
            this.input.keyboard.on('keydown-ESC', () => EventBus.emit('toggle-pause'));
            this.input.keyboard.on('keydown-P', () => EventBus.emit('toggle-pause'));
        }

        // Setup EventBus Listeners from React
        EventBus.on('start-game', this.handleStartGame, this);
        EventBus.on('keypad-unlocked', this.handleKeypadUnlocked, this);
        EventBus.on('toggle-pause', this.handleTogglePause, this);
        EventBus.on('update-settings', this.applySettings, this);
        EventBus.on('trigger-interact', this.interactNearby, this);
        EventBus.on('trigger-flashlight', this.toggleFlashlight, this);
        EventBus.on('modal-closed', this.handleModalClosed, this);

        // Start BGM
        this.setupAudio();

        // Cleanup on shutdown
        this.events.once('shutdown', () => {
            EventBus.removeListener('start-game', this.handleStartGame, this);
            EventBus.removeListener('keypad-unlocked', this.handleKeypadUnlocked, this);
            EventBus.removeListener('toggle-pause', this.handleTogglePause, this);
            EventBus.removeListener('update-settings', this.applySettings, this);
            EventBus.removeListener('trigger-interact', this.interactNearby, this);
            EventBus.removeListener('trigger-flashlight', this.toggleFlashlight, this);
            EventBus.removeListener('modal-closed', this.handleModalClosed, this);

            if (this.bgmAmbient) this.bgmAmbient.stop();
            if (this.bgmChase) this.bgmChase.stop();
        });

        // Notify React that the scene is ready
        EventBus.emit('current-scene-ready', this);
    }

    private setupAudio() {
        if (this.cache.audio.exists('bgm_ambient')) {
            try {
                this.bgmAmbient = this.sound.add('bgm_ambient', { loop: true, volume: runtimeSettings.musicVol * 0.4 });
                this.bgmAmbient.play();
            } catch {
                // Audio autoplay policy
            }
        }
        if (this.cache.audio.exists('bgm_chase')) {
            try {
                this.bgmChase = this.sound.add('bgm_chase', { loop: true, volume: 0 });
                this.bgmChase.play();
            } catch {
                // Audio policy
            }
        }
    }

    private generateSchoolTextures() {
        // Floor tile (Linoleum / Terrazzo pattern)
        const gFloor = this.add.graphics();
        gFloor.fillStyle(COLORS.FLOOR, 1);
        gFloor.fillRect(0, 0, TILE, TILE);
        gFloor.fillStyle(COLORS.FLOOR_ALT, 0.4);
        gFloor.fillRect(0, 0, TILE / 2, TILE / 2);
        gFloor.fillRect(TILE / 2, TILE / 2, TILE / 2, TILE / 2);
        gFloor.lineStyle(1, 0x1f2438, 0.25);
        gFloor.strokeRect(0, 0, TILE, TILE);
        gFloor.generateTexture('tex_floor', TILE, TILE);
        gFloor.destroy();

        // Wall tile (Dark red/grey Nigerian school brick with 3D top edge)
        const gWall = this.add.graphics();
        gWall.fillStyle(COLORS.WALL, 1);
        gWall.fillRect(0, 0, TILE, TILE);
        gWall.fillStyle(COLORS.WALL_EDGE, 1);
        gWall.fillRect(0, 0, TILE, 4);
        gWall.lineStyle(1, 0x0a0c14, 0.7);
        gWall.strokeRect(0, 0, TILE, TILE);
        gWall.generateTexture('tex_wall', TILE, TILE);
        gWall.destroy();

        // Student Player Sprite (Top-Down with uniform, shoulders, flashlight mount)
        const gPlayer = this.add.graphics();
        // Head / Hair
        gPlayer.fillStyle(0x1a120b, 1);
        gPlayer.fillCircle(16, 14, 7);
        // Shoulders / School Uniform (Navy / White collar)
        gPlayer.fillStyle(COLORS.PLAYER, 1);
        gPlayer.fillRoundedRect(6, 13, 20, 14, 4);
        gPlayer.fillStyle(0xffffff, 0.9);
        gPlayer.fillTriangle(16, 14, 13, 20, 19, 20); // Collar
        // Hands
        gPlayer.fillStyle(COLORS.PLAYER_SKIN, 1);
        gPlayer.fillCircle(8, 26, 3);
        gPlayer.fillCircle(24, 26, 3);
        // Flashlight held in hand
        gPlayer.fillStyle(0x333333, 1);
        gPlayer.fillRect(22, 23, 4, 8);
        gPlayer.fillStyle(0xfff388, 1);
        gPlayer.fillCircle(24, 31, 2);
        gPlayer.generateTexture('tex_player', 32, 32);
        gPlayer.destroy();

        // Miss KhoiKhoi Sprite (Eerie Red Dress / Cape, Floating, Shadow, Red High Heels)
        const gGhost = this.add.graphics();
        // Dark crimson flowing cape/gown
        gGhost.fillStyle(0x150305, 0.7);
        gGhost.fillCircle(16, 26, 12); // Shadow aura
        gGhost.fillStyle(COLORS.GHOST, 1);
        gGhost.fillTriangle(16, 4, 4, 28, 28, 28);
        // Head & Veiled face
        gGhost.fillStyle(0x0a0305, 1);
        gGhost.fillCircle(16, 10, 6);
        // High heels peeking from below
        gGhost.fillStyle(0xd90429, 1);
        gGhost.fillRect(10, 26, 4, 5);
        gGhost.fillRect(18, 26, 4, 5);
        gGhost.generateTexture('tex_ghost', 32, 32);
        gGhost.destroy();

        // Locker / Hiding Cupboard
        const gHide = this.add.graphics();
        gHide.fillStyle(COLORS.HIDE, 1);
        gHide.fillRoundedRect(2, 2, 28, 28, 3);
        gHide.fillStyle(0x241a10, 1);
        gHide.fillRect(5, 5, 10, 22);
        gHide.fillRect(17, 5, 10, 22);
        gHide.fillStyle(0xcca352, 1);
        gHide.fillCircle(13, 16, 2); // Handles
        gHide.fillCircle(19, 16, 2);
        gHide.lineStyle(1, 0x4d3822, 1);
        gHide.strokeRoundedRect(2, 2, 28, 28, 3);
        gHide.generateTexture('tex_locker', 32, 32);
        gHide.destroy();

        // Staff desk / table (rendered under the Brass Key in the Staff Room)
        const gDesk = this.add.graphics();
        gDesk.fillStyle(0x4a3220, 1);
        gDesk.fillRoundedRect(1, 3, 30, 26, 3);
        gDesk.fillStyle(0x6f4c2e, 1);
        gDesk.fillRoundedRect(3, 5, 26, 22, 2);
        gDesk.lineStyle(1, 0x2e1f10, 1);
        gDesk.strokeRoundedRect(1, 3, 30, 26, 3);
        gDesk.generateTexture('tex_desk', 32, 32);
        gDesk.destroy();

        // Torchlight item pickup
        const gTorch = this.add.graphics();
        gTorch.fillStyle(0x333333, 1);
        gTorch.fillRoundedRect(10, 6, 12, 20, 2);
        gTorch.fillStyle(0xffd152, 1);
        gTorch.fillRect(8, 4, 16, 5);
        gTorch.fillStyle(0xffffff, 0.9);
        gTorch.fillCircle(16, 6, 3);
        gTorch.generateTexture('tex_torch', 32, 32);
        gTorch.destroy();

        // Clue Note (Weathered paper with red seal)
        const gNote = this.add.graphics();
        gNote.fillStyle(COLORS.CLUE, 1);
        gNote.fillRoundedRect(6, 6, 20, 20, 2);
        gNote.lineStyle(1, 0x5a5445, 0.8);
        gNote.strokeRoundedRect(6, 6, 20, 20, 2);
        gNote.fillStyle(0xb83a3a, 1);
        gNote.fillCircle(16, 16, 4); // Wax seal
        gNote.generateTexture('tex_clue', 32, 32);
        gNote.destroy();

        // Brass Key
        const gKey = this.add.graphics();
        gKey.fillStyle(COLORS.KEY, 1);
        gKey.fillCircle(16, 10, 5);
        gKey.fillStyle(COLORS.FLOOR, 1);
        gKey.fillCircle(16, 10, 2);
        gKey.fillStyle(COLORS.KEY, 1);
        gKey.fillRect(14, 14, 4, 12);
        gKey.fillRect(18, 20, 4, 3);
        gKey.fillRect(18, 24, 4, 3);
        gKey.generateTexture('tex_key', 32, 32);
        gKey.destroy();

        // Battery
        const gBat = this.add.graphics();
        gBat.fillStyle(COLORS.BATTERY, 1);
        gBat.fillRoundedRect(8, 8, 16, 18, 2);
        gBat.fillStyle(0xcccccc, 1);
        gBat.fillRect(13, 5, 6, 3);
        gBat.fillStyle(0x207a4a, 1);
        gBat.fillRect(10, 14, 12, 6);
        gBat.generateTexture('tex_battery', 32, 32);
        gBat.destroy();

        // Doors (Wood & Keypad Lock)
        const gDoor = this.add.graphics();
        gDoor.fillStyle(COLORS.DOOR, 1);
        gDoor.fillRect(0, 0, TILE, TILE);
        gDoor.fillStyle(0x4a321d, 1);
        gDoor.fillRect(3, 3, TILE - 6, TILE - 6);
        gDoor.fillStyle(0xe0b84c, 1);
        gDoor.fillCircle(24, 16, 3); // Brass knob
        gDoor.generateTexture('tex_door', TILE, TILE);
        gDoor.destroy();

        const gDoorKeypad = this.add.graphics();
        gDoorKeypad.fillStyle(0x2b2e38, 1);
        gDoorKeypad.fillRect(0, 0, TILE, TILE);
        gDoorKeypad.fillStyle(0x191b22, 1);
        gDoorKeypad.fillRect(3, 3, TILE - 6, TILE - 6);
        gDoorKeypad.fillStyle(0x0ec3c9, 1);
        gDoorKeypad.fillRect(20, 10, 8, 12); // Digital LED
        gDoorKeypad.generateTexture('tex_door_keypad', TILE, TILE);
        gDoorKeypad.destroy();

        // Principal's Safe
        const gSafe = this.add.graphics();
        gSafe.fillStyle(0x282c36, 1);
        gSafe.fillRoundedRect(3, 3, 26, 26, 4);
        gSafe.fillStyle(0x1a1c24, 1);
        gSafe.fillCircle(16, 16, 8);
        gSafe.fillStyle(0xe5c158, 1);
        gSafe.fillCircle(16, 16, 4); // Dial
        gSafe.fillRect(15, 12, 2, 8);
        gSafe.generateTexture('tex_safe', 32, 32);
        gSafe.destroy();

        // Compound Exit Gate
        const gGate = this.add.graphics();
        gGate.fillStyle(0x181a24, 1);
        gGate.fillRect(0, 0, TILE, TILE);
        gGate.lineStyle(2, COLORS.EXIT, 0.9);
        gGate.lineBetween(4, 0, 4, TILE);
        gGate.lineBetween(12, 0, 12, TILE);
        gGate.lineBetween(20, 0, 20, TILE);
        gGate.lineBetween(28, 0, 28, TILE);
        gGate.lineBetween(0, 8, TILE, 8);
        gGate.lineBetween(0, 24, TILE, 24);
        gGate.generateTexture('tex_gate', TILE, TILE);
        gGate.destroy();
    }

    private buildSchoolWorld() {
        let playerSpawn = { x: 3 * TILE + TILE / 2, y: 2 * TILE + TILE / 2 };
        let ghostSpawn = { x: 27 * TILE + TILE / 2, y: 10 * TILE + TILE / 2 };
        let clueIndex = 0;
        const clueKeys = Object.keys(CLUES);

        // Render floor grid and parse markers
        for (let r = 0; r < LEVEL_MAP.length; r++) {
            for (let c = 0; c < LEVEL_MAP[r].length; c++) {
                const ch = LEVEL_MAP[r][c];
                const x = c * TILE + TILE / 2;
                const y = r * TILE + TILE / 2;

                // Base floor under everything
                const floor = this.add.image(x, y, 'tex_floor');
                floor.setDepth(-10);

                switch (ch) {
                    case '#': {
                        const wall = this.walls.create(x, y, 'tex_wall') as Phaser.Physics.Arcade.Sprite;
                        wall.setDisplaySize(TILE, TILE);
                        wall.refreshBody();
                        wall.setDepth(5);
                        break;
                    }
                    case 'P':
                        playerSpawn = { x, y };
                        break;
                    case 'E':
                        ghostSpawn = { x, y };
                        this.ghostWaypoints.push({ x, y });
                        break;
                    case 'H': {
                        const hide = this.hidingSpots.create(x, y, 'tex_locker') as Phaser.Physics.Arcade.Sprite;
                        hide.setDisplaySize(TILE, TILE);
                        hide.refreshBody();
                        hide.setDepth(6);
                        break;
                    }
                    case 'T': {
                        const torch = this.itemsGroup.create(x, y, 'tex_torch') as Phaser.Physics.Arcade.Sprite;
                        torch.setData('type', 'torch');
                        torch.setDepth(8);
                        break;
                    }
                    case 'K': {
                        // Visible staff desk under the Brass Key (Staff Room)
                        const desk = this.add.image(x, y, 'tex_desk');
                        desk.setDepth(4);
                        const key = this.itemsGroup.create(x, y, 'tex_key') as Phaser.Physics.Arcade.Sprite;
                        key.setData('type', 'key_brass');
                        key.setDepth(8);
                        break;
                    }
                    case 'B': {
                        const bat = this.itemsGroup.create(x, y, 'tex_battery') as Phaser.Physics.Arcade.Sprite;
                        bat.setData('type', 'battery');
                        bat.setDepth(8);
                        break;
                    }
                    case 'C': {
                        const clueId = clueKeys[clueIndex % clueKeys.length];
                        clueIndex++;
                        const clue = this.cluesGroup.create(x, y, 'tex_clue') as Phaser.Physics.Arcade.Sprite;
                        clue.setData('clueId', clueId);
                        clue.setDepth(8);
                        break;
                    }
                    case 'D': {
                        const door = this.doorsGroup.create(x, y, 'tex_door') as Phaser.Physics.Arcade.Sprite;
                        door.setData('doorId', 'mainhall');
                        door.setDepth(7);
                        this.doorEntities.set('mainhall_' + c + '_' + r, door);
                        break;
                    }
                    case 'L': {
                        const door = this.doorsGroup.create(x, y, 'tex_door_keypad') as Phaser.Physics.Arcade.Sprite;
                        door.setData('doorId', 'lab');
                        door.setDepth(7);
                        this.doorEntities.set('lab', door);
                        break;
                    }
                    case 'O': {
                        const door = this.doorsGroup.create(x, y, 'tex_door_keypad') as Phaser.Physics.Arcade.Sprite;
                        door.setData('doorId', 'office');
                        door.setDepth(7);
                        this.doorEntities.set('office', door);
                        break;
                    }
                    case 'S': {
                        this.safeSprite = this.physics.add.sprite(x, y, 'tex_safe');
                        this.safeSprite.setImmovable(true);
                        (this.safeSprite.body as Phaser.Physics.Arcade.Body).setAllowGravity(false);
                        this.safeSprite.setDepth(7);
                        break;
                    }
                    case 'G': {
                        const gate = this.doorsGroup.create(x, y, 'tex_gate') as Phaser.Physics.Arcade.Sprite;
                        gate.setData('doorId', 'gate');
                        gate.setDepth(7);
                        this.doorEntities.set('gate', gate);
                        break;
                    }
                }
            }
        }

        // Add additional ghost patrol anchors across main corridors
        this.ghostWaypoints.push(
            { x: 10 * TILE, y: 10 * TILE },
            { x: 45 * TILE, y: 10 * TILE },
            { x: 30 * TILE, y: 22 * TILE },
            { x: 15 * TILE, y: 22 * TILE }
        );

        // Instantiate Player Sprite
        this.player = this.physics.add.sprite(playerSpawn.x, playerSpawn.y, 'tex_player');
        this.player.setCollideWorldBounds(true);
        (this.player.body as Phaser.Physics.Arcade.Body).setSize(GAME_CONFIG.player.bodyW, GAME_CONFIG.player.bodyH, true);
        this.player.setDepth(20);

        // Instantiate Miss KhoiKhoi Ghost Sprite
        this.ghost = this.physics.add.sprite(ghostSpawn.x, ghostSpawn.y, 'tex_ghost');
        this.ghost.setCollideWorldBounds(true);
        (this.ghost.body as Phaser.Physics.Arcade.Body).setSize(24, 24, true);
        this.ghost.setDepth(19);

        // Ghost Glowing Eyes & Red Aura
        this.ghostGlow = this.add.circle(ghostSpawn.x, ghostSpawn.y, 22, COLORS.GHOST_GLOW, 0.25);
        this.ghostGlow.setDepth(18);

        this.ghostEyes = this.add.circle(ghostSpawn.x, ghostSpawn.y, 3, 0xff1e27, 1);
        this.ghostEyes.setDepth(21);
    }

    private handleStartGame(payload: { continueSave?: boolean } = {}) {
        this.isPlaying = true;

        if (payload.continueSave) {
            this.loadCheckpoint();
        } else {
            this.health = GAME_CONFIG.player.maxHp;
            this.hasTorch = false;
            this.flashlightOn = false;
            this.battery = 100;
            this.keys = [];
            this.cluesFound = [];
            this.unlockedDoors.clear();
            this.isSafeUnlocked = false;
            this.isHiding = false;
            this.customObjective = '';
            this.player.setPosition(3 * TILE + TILE / 2, 2 * TILE + TILE / 2);
        }

        // Fresh run state: reset doors/items, then re-apply persisted unlocks
        this.openDoors.clear();
        this.uiModalOpen = false;
        this.promptText = '';
        this.promptType = 'none';
        this.resetAllDoors();
        this.itemsGroup.getChildren().forEach((it) => {
            const s = it as Phaser.Physics.Arcade.Sprite;
            s.enableBody(true, s.x, s.y, true, true);
        });
        this.cluesGroup.getChildren().forEach((cl) => {
            const s = cl as Phaser.Physics.Arcade.Sprite;
            s.enableBody(true, s.x, s.y, true, true);
        });
        this.unlockedDoors.forEach((doorId) => {
            this.doorEntities.forEach((doorSprite) => {
                if (doorSprite.getData('doorId') === doorId) {
                    doorSprite.disableBody(true, true);
                    doorSprite.setAlpha(0.35);
                    doorSprite.setTint(0x9fd8a0);
                    this.openDoors.add(this.doorKey(doorSprite));
                }
            });
        });

        EventBus.emit('phase-changed', 'PLAYING');
        this.emitHud();
    }

    private toggleFlashlight() {
        if (this.uiModalOpen || !this.isPlaying) return;
        if (!this.hasTorch) {
            playSFX('error');
            this.promptText = 'You need to find a Torch first!';
            this.promptType = 'hint';
            this.promptTimer = 2000;
            this.emitHud();
            return;
        }
        if (this.isHiding) {
            // Cannot use torch while hiding
            return;
        }

        this.flashlightOn = !this.flashlightOn;
        playSFX('torch');
        if (this.cache.audio.exists('sfx_torch_click')) {
            try { this.sound.play('sfx_torch_click', { volume: runtimeSettings.sfxVol * 0.7 }); } catch {}
        }

        // Sound cue may alert nearby Miss KhoiKhoi if within hearing range
        const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.ghost.x, this.ghost.y);
        if (dist < GAME_CONFIG.khoikhoi.hearingRange && this.ghostState === 'PATROL') {
            this.ghostState = 'INVESTIGATE';
            this.ghostLastKnownPlayerPos = { x: this.player.x, y: this.player.y };
        }

        this.emitHud();
    }

    private interactNearby() {
        if (!this.isPlaying || this.uiModalOpen) return;

        // 1. Check if near Hiding Spot
        let nearHiding: Phaser.Physics.Arcade.Sprite | null = null;
        this.hidingSpots.getChildren().forEach((h) => {
            const spot = h as Phaser.Physics.Arcade.Sprite;
            if (Phaser.Math.Distance.Between(this.player.x, this.player.y, spot.x, spot.y) < 38) {
                nearHiding = spot;
            }
        });

        if (nearHiding) {
            this.toggleHiding(nearHiding);
            return;
        }

        // 1.5 Interact with nearby Brass Key (press E to collect)
        if (this.keys.indexOf('brass') === -1) {
            let nearKey: Phaser.Physics.Arcade.Sprite | null = null;
            let nearKeyDist = 46;
            this.itemsGroup.getChildren().forEach((it) => {
                const item = it as Phaser.Physics.Arcade.Sprite;
                if (!item.active || item.getData('type') !== 'key_brass') return;
                const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, item.x, item.y);
                if (d < nearKeyDist) {
                    nearKeyDist = d;
                    nearKey = item;
                }
            });
            if (nearKey) {
                this.handleItemPickup(this.player, nearKey);
                return;
            }
        }

        // 2. Check if near Principal's Safe
        if (this.safeSprite && Phaser.Math.Distance.Between(this.player.x, this.player.y, this.safeSprite.x, this.safeSprite.y) < 46) {
            this.handleSafeInteraction();
            return;
        }

        // 3. Interact with the NEAREST door only (single interaction per press)
        let nearDoor: Phaser.Physics.Arcade.Sprite | null = null;
        let nearDist = 52;
        this.doorsGroup.getChildren().forEach((d) => {
            const door = d as Phaser.Physics.Arcade.Sprite;
            const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, door.x, door.y);
            if (dist < nearDist) {
                nearDist = dist;
                nearDoor = door;
            }
        });
        if (nearDoor) {
            this.handleDoorInteraction(nearDoor);
        }
    }

    private toggleHiding(spot: Phaser.GameObjects.GameObject) {
        if (this.isHiding) {
            // Exit hiding
            this.isHiding = false;
            this.currentHidingSpot = null;
            this.player.setAlpha(1);
            playSFX('blip');
        } else {
            // Enter hiding
            this.isHiding = true;
            this.currentHidingSpot = spot;
            this.flashlightOn = false; // Torch turns off automatically inside hiding spot
            this.player.setAlpha(0.2);
            playSFX('blip');
            haptic(50);

            // If ghost was chasing, drop chase to SEARCH mode
            if (this.ghostState === 'CHASE') {
                this.ghostState = 'SEARCH';
                this.ghostSearchTimer = GAME_CONFIG.khoikhoi.searchTime;
            }
        }
        this.emitHud();
    }

    private doorKey(door: Phaser.Physics.Arcade.Sprite): string {
        return `${door.getData('doorId')}_${door.x}_${door.y}`;
    }

    private resetAllDoors() {
        this.doorsGroup.getChildren().forEach((d) => {
            const door = d as Phaser.Physics.Arcade.Sprite;
            door.enableBody(true, door.x, door.y, true, true);
            door.setAlpha(1);
            door.clearTint();
        });
    }

    private handleDoorInteraction(door: Phaser.Physics.Arcade.Sprite) {
        const doorId = door.getData('doorId') as string;
        const doorDef = DOORS[doorId];
        const dKey = this.doorKey(door);

        // Keypad door still locked -> open the keypad modal
        if (doorDef?.requiredCode && !this.unlockedDoors.has(doorId)) {
            this.uiModalOpen = true;
            EventBus.emit('open-keypad', {
                doorId,
                title: doorDef.title,
                requiredCode: doorDef.requiredCode,
                isUnlocked: false,
            });
            EventBus.emit('phase-changed', 'KEYPAD_PUZZLE');
            return;
        }

        // Key-locked door still locked -> try to unlock with the required key
        if (doorDef?.requiredKey && !this.unlockedDoors.has(doorId)) {
            if (this.keys.includes(doorDef.requiredKey)) {
                this.unlockedDoors.add(doorId);
                playSFX('unlock');
                if (this.cache.audio.exists('sfx_keys')) {
                    try { this.sound.play('sfx_keys', { volume: runtimeSettings.sfxVol }); } catch {}
                }
                this.saveCheckpoint();
                if (doorId === 'gate') {
                    this.triggerVictory();
                    return;
                }
            } else {
                playSFX('error');
                haptic(30);
                this.promptText = doorDef.requiredKey === 'master'
                    ? 'Locked — Requires the Master Gate Key'
                    : 'Locked — Requires the Brass Key';
                this.promptType = 'locked';
                this.promptTimer = 1800;
                this.emitHud();
                return;
            }
        }

        // Unlocked: toggle Open <-> Closed (collision body + visual state)
        if (this.openDoors.has(dKey)) {
            this.openDoors.delete(dKey);
            door.enableBody(true, door.x, door.y, true, true);
            door.setAlpha(1);
            door.clearTint();
            playSFX('blip');
        } else {
            this.openDoors.add(dKey);
            door.disableBody(true, true);
            door.setAlpha(0.35);
            door.setTint(0x9fd8a0);
            playSFX('unlock');
        }
        this.emitHud();
    }

    private handleModalClosed() {
        this.uiModalOpen = false;
    }

    private handleSafeInteraction() {
        if (this.isSafeUnlocked) {
            return;
        }

        // Opening safe requires 4 clues found or discovering the Principal's code
        if (this.cluesFound.length >= 3 || this.unlockedDoors.has('office')) {
            this.isSafeUnlocked = true;
            this.keys.push('master');
            playSFX('unlock');
            playSFX('powerup');
            if (this.cache.audio.exists('sfx_keys')) {
                try { this.sound.play('sfx_keys', { volume: runtimeSettings.sfxVol }); } catch {}
            }
            haptic(100);
            this.emitHud();
            this.saveCheckpoint();
        } else {
            playSFX('error');
            this.uiModalOpen = true;
            EventBus.emit('inspect-note', {
                id: 'safe_locked',
                title: "Principal's Heavy Safe",
                text: "The dial is locked solid. You need more clues from the school or entry to the Principal's Office to uncover the combination.",
                hint: "Search Classrooms and the Library for clues.",
            });
            EventBus.emit('phase-changed', 'INSPECT_NOTE');
        }
    }

    private handleKeypadUnlocked(payload: { doorId: string }) {
        this.unlockedDoors.add(payload.doorId);
        this.doorEntities.forEach((door) => {
            if (door.getData('doorId') === payload.doorId) {
                door.disableBody(true, true);
                door.setAlpha(0.35);
                door.setTint(0x9fd8a0);
                this.openDoors.add(this.doorKey(door));
            }
        });
        playSFX('unlock');
        this.emitHud();
        this.saveCheckpoint();
    }

    private handleItemPickup(playerObj: any, itemObj: any) {
        const item = itemObj as Phaser.Physics.Arcade.Sprite;
        const type = item.getData('type');

        if (type === 'torch') {
            this.hasTorch = true;
            this.flashlightOn = true;
            item.disableBody(true, true);
            playSFX('powerup');
            haptic(60);
            this.emitHud();
            this.saveCheckpoint();
        } else if (type === 'key_brass') {
            this.keys.push('brass');
            this.customObjective = 'Escape through the Main Gate.';
            item.disableBody(true, true);
            playSFX('coin');
            if (this.cache.audio.exists('sfx_keys')) {
                try { this.sound.play('sfx_keys', { volume: runtimeSettings.sfxVol }); } catch {}
            }
            haptic(60);
            this.emitHud();
            this.saveCheckpoint();
        } else if (type === 'battery') {
            this.battery = Math.min(GAME_CONFIG.flashlight.maxBattery, this.battery + GAME_CONFIG.flashlight.recharge);
            item.disableBody(true, true);
            playSFX('powerup');
            haptic(40);
            this.emitHud();
        }
    }

    private handleCluePickup(playerObj: any, clueObj: any) {
        const clue = clueObj as Phaser.Physics.Arcade.Sprite;
        const clueId = clue.getData('clueId') as string;
        const clueDef = CLUES[clueId];

        if (!this.cluesFound.includes(clueId)) {
            this.cluesFound.push(clueId);
        }

        clue.disableBody(true, true);
        playSFX('coin');
        if (this.cache.audio.exists('sfx_collect')) {
            try { this.sound.play('sfx_collect', { volume: runtimeSettings.sfxVol }); } catch {}
        }
        haptic(50);
        this.emitHud();
        this.saveCheckpoint();

        if (clueDef) {
            this.uiModalOpen = true;
            EventBus.emit('inspect-note', {
                id: clueDef.id,
                title: clueDef.title,
                text: clueDef.text,
                hint: clueDef.hint,
            });
            EventBus.emit('phase-changed', 'INSPECT_NOTE');
        }
    }

    private triggerVictory() {
        this.isPlaying = false;
        (this.player.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
        if (this.bgmChase) this.bgmChase.stop();
        if (this.bgmAmbient) this.bgmAmbient.stop();

        playSFX('win');
        if (this.cache.audio.exists('sfx_win')) {
            try { this.sound.play('sfx_win', { volume: runtimeSettings.sfxVol }); } catch {}
        }

        EventBus.emit('phase-changed', 'VICTORY');
    }

    private triggerGameOver() {
        this.isPlaying = false;
        (this.player.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
        if (this.bgmChase) this.bgmChase.stop();
        if (this.bgmAmbient) this.bgmAmbient.stop();

        playSFX('gameover');
        if (this.cache.audio.exists('sfx_horror_sting')) {
            try { this.sound.play('sfx_horror_sting', { volume: runtimeSettings.sfxVol }); } catch {}
        }
        haptic(250);

        EventBus.emit('phase-changed', 'GAME_OVER');
    }

    private handleTogglePause() {
        if (!this.isPlaying || this.uiModalOpen) return;
        if (this.physics.world.isPaused) {
            this.physics.world.resume();
            this.tweens.resumeAll();
            EventBus.emit('phase-changed', 'PLAYING');
        } else {
            this.physics.world.pause();
            this.tweens.pauseAll();
            EventBus.emit('phase-changed', 'PAUSED');
        }
    }

    private applySettings(settings: any) {
        if (this.bgmAmbient && 'musicVol' in settings) {
            (this.bgmAmbient as any).setVolume(settings.musicVol * 0.4);
        }
    }

    private saveCheckpoint() {
        try {
            const saveState = {
                health: this.health,
                hasTorch: this.hasTorch,
                battery: this.battery,
                keys: this.keys,
                cluesFound: this.cluesFound,
                unlockedDoors: Array.from(this.unlockedDoors),
                isSafeUnlocked: this.isSafeUnlocked,
                playerX: this.player.x,
                playerY: this.player.y,
                zone: this.currentZone.name,
            };
            localStorage.setItem('qc_khoikhoi_save', JSON.stringify(saveState));
        } catch {
            // LocalStorage quota or private mode
        }
    }

    private loadCheckpoint() {
        try {
            const raw = localStorage.getItem('qc_khoikhoi_save');
            if (raw) {
                const s = JSON.parse(raw);
                this.health = s.health ?? GAME_CONFIG.player.maxHp;
                this.hasTorch = s.hasTorch ?? false;
                this.flashlightOn = this.hasTorch;
                this.battery = s.battery ?? 100;
                this.keys = s.keys ?? [];
                this.cluesFound = s.cluesFound ?? [];
                this.unlockedDoors = new Set(s.unlockedDoors ?? []);
                this.isSafeUnlocked = s.isSafeUnlocked ?? false;

                if (s.playerX && s.playerY) {
                    this.player.setPosition(s.playerX, s.playerY);
                }

                // Unlock already opened doors
                this.unlockedDoors.forEach((doorId) => {
                    const door = this.doorEntities.get(doorId);
                    if (door) door.disableBody(true, true);
                });
            }
        } catch {
            // Error loading save
        }
    }

    // -----------------------------------------------------------------------
    // MAIN UPDATE LOOP
    // -----------------------------------------------------------------------
    update(time: number, deltaMs: number) {
        if (!this.player || !this.player.active || !this.player.body) return;

        const delta = deltaMs / 1000;
        const body = this.player.body as Phaser.Physics.Arcade.Body;

        if (this.invulnerableTime > 0) {
            this.invulnerableTime -= deltaMs;
            this.player.setAlpha(Math.sin(time / 50) > 0 ? 0.4 : 1.0);
        } else if (!this.isHiding) {
            this.player.setAlpha(1.0);
        }

        if (!this.isPlaying) {
            body.setVelocity(0, 0);
            return;
        }

        // A React modal (note/keypad) is open: freeze player & ghost, skip AI
        if (this.uiModalOpen) {
            body.setVelocity(0, 0);
            if (this.ghost?.body) (this.ghost.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
            return;
        }

        // 1. Process Input & Player Movement
        this.updatePlayerMovement(delta, body);

        // 2. Process Flashlight Battery Drain
        this.updateFlashlight(delta);

        // 3. Process Zone Detection
        this.updateCurrentZone();

        // 4. Process Miss KhoiKhoi AI & Ghost Audio Cues
        this.updateMissKhoiKhoiAI(time, delta, deltaMs);

        // 5. Draw Darkness Mask & Flashlight Cone
        this.renderDarknessAmbiance();

        // 6. Proximity Heartbeat & Audio Tension
        this.updateHeartbeat(deltaMs);

        // 7. Contextual interaction prompt + throttled HUD sync
        this.updateProximityPrompt(deltaMs);
        this.hudThrottle -= deltaMs;
        if (this.hudThrottle <= 0) {
            this.hudThrottle = 200;
            this.emitHud();
        }
    }

    private updatePlayerMovement(delta: number, body: Phaser.Physics.Arcade.Body) {
        if (this.isHiding) {
            body.setVelocity(0, 0);
            return;
        }

        const input: PlayerInput = this.controls.getInput();
        let vx = 0;
        let vy = 0;

        if (input.left) vx -= 1;
        if (input.right) vx += 1;
        if (input.up) vy -= 1;
        if (input.down) vy += 1;

        // Normalize 8-directional movement; Shift (or mobile RUN) sprints
        const len = Math.hypot(vx, vy);
        this.isSprinting = input.sprint && len > 0;
        const speed = this.isSprinting ? GAME_CONFIG.player.runSpeed : GAME_CONFIG.player.speed;

        if (len > 0) {
            vx = (vx / len) * speed;
            vy = (vy / len) * speed;
            this.lastFacingAngle = Math.atan2(vy, vx);
            this.player.setRotation(this.lastFacingAngle - Math.PI / 2);

            // Step sound timer (sprinting = louder, draws Miss KhoiKhoi in)
            this.stepTimer -= delta;
            if (this.stepTimer <= 0) {
                this.stepTimer = this.isSprinting ? 0.3 : 0.38;
                playSFX('step', this.isSprinting ? 0.4 : 0.25);
                if (this.isSprinting && this.ghostState === 'PATROL') {
                    const noiseRange = GAME_CONFIG.khoikhoi.hearingRange * GAME_CONFIG.player.sprintNoiseFactor;
                    const dNoise = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.ghost.x, this.ghost.y);
                    if (dNoise < noiseRange) {
                        this.ghostState = 'INVESTIGATE';
                        this.ghostLastKnownPlayerPos = { x: this.player.x, y: this.player.y };
                    }
                }
            }
        }

        body.setVelocity(vx, vy);
    }

    private updateFlashlight(delta: number) {
        if (this.hasTorch && this.flashlightOn) {
            this.battery = Math.max(0, this.battery - GAME_CONFIG.flashlight.drainRate * delta);
            if (this.battery <= 0) {
                this.flashlightOn = false;
                playSFX('torch');
                haptic(80);
                this.promptText = 'Torch battery dead! Find a spare battery (B).';
                this.promptType = 'hint';
                this.promptTimer = 2500;
                this.emitHud();
            }
        }
    }

    private updateCurrentZone() {
        const tileX = Math.floor(this.player.x / TILE);
        const tileY = Math.floor(this.player.y / TILE);
        const zone = zoneAt(tileX, tileY);

        if (zone.id !== this.currentZone.id) {
            this.currentZone = zone;
            this.emitHud();
        }
    }

    private updateMissKhoiKhoiAI(time: number, delta: number, deltaMs: number) {
        if (!this.ghost || !this.ghost.active || !this.ghost.body) return;

        const ghostBody = this.ghost.body as Phaser.Physics.Arcade.Body;
        const distToPlayer = Phaser.Math.Distance.Between(this.ghost.x, this.ghost.y, this.player.x, this.player.y);

        // Dynamic ghost visibility in dark zones (based on the GHOST's own zone)
        const ghostZone = zoneAt(Math.floor(this.ghost.x / TILE), Math.floor(this.ghost.y / TILE));
        const ghostInDark = !!ghostZone.isDark;
        const ghostInBeam = this.hasTorch && this.flashlightOn && this.isEntityInFlashlight(this.ghost.x, this.ghost.y);
        if (ghostInDark && !ghostInBeam) {
            // Nearly invisible: faint silhouette, dim aura, barely-there eyes
            this.ghost.setAlpha(GAME_CONFIG.flashlight.ghostUnlitAlpha);
            this.ghostGlow.setAlpha(0.15);
            this.ghostEyes.setAlpha(0.35);
        } else {
            // Lit by the torch beam (or inside a normally lit zone)
            this.ghost.setAlpha(GAME_CONFIG.flashlight.ghostLitAlpha);
            this.ghostGlow.setAlpha(ghostInDark ? 0.5 : 0.35);
            this.ghostEyes.setAlpha(1);
        }

        // Update Ghost Eyes & Aura positions
        this.ghostGlow.setPosition(this.ghost.x, this.ghost.y);
        this.ghostEyes.setPosition(
            this.ghost.x + Math.cos(this.ghost.rotation + Math.PI / 2) * 4,
            this.ghost.y + Math.sin(this.ghost.rotation + Math.PI / 2) * 4
        );

        // High Heel "Click-Clack" Audio Cue
        this.heelClickTimer -= deltaMs;
        if (this.heelClickTimer <= 0) {
            const interval = this.ghostState === 'CHASE' ? 380 : 850;
            this.heelClickTimer = interval;

            // Volume scales with proximity
            const vol = Math.max(0.1, Math.min(1.0, 1.0 - distToPlayer / 450));
            playSFX('heel', vol);
        }

        // Check Line of Sight & Flashlight visibility
        const hasLineOfSight = !this.isHiding && distToPlayer < GAME_CONFIG.khoikhoi.sightRange;
        const inFlashlightBeam = this.hasTorch && this.flashlightOn && this.isEntityInFlashlight(this.ghost.x, this.ghost.y);

        // AI State Machine
        switch (this.ghostState) {
            case 'PATROL': {
                if (hasLineOfSight || inFlashlightBeam) {
                    this.startChase();
                    break;
                }

                // Move toward current waypoint
                const wp = this.ghostWaypoints[this.ghostCurrentWaypoint % this.ghostWaypoints.length];
                const distToWp = Phaser.Math.Distance.Between(this.ghost.x, this.ghost.y, wp.x, wp.y);

                if (distToWp < 20) {
                    this.ghostCurrentWaypoint = (this.ghostCurrentWaypoint + 1) % this.ghostWaypoints.length;
                } else {
                    const angle = Phaser.Math.Angle.Between(this.ghost.x, this.ghost.y, wp.x, wp.y);
                    ghostBody.setVelocity(
                        Math.cos(angle) * GAME_CONFIG.khoikhoi.patrolSpeed,
                        Math.sin(angle) * GAME_CONFIG.khoikhoi.patrolSpeed
                    );
                    this.ghost.setRotation(angle - Math.PI / 2);
                }
                break;
            }

            case 'INVESTIGATE': {
                if (hasLineOfSight) {
                    this.startChase();
                    break;
                }

                const distToPos = Phaser.Math.Distance.Between(
                    this.ghost.x,
                    this.ghost.y,
                    this.ghostLastKnownPlayerPos.x,
                    this.ghostLastKnownPlayerPos.y
                );

                if (distToPos < 25) {
                    this.ghostState = 'SEARCH';
                    this.ghostSearchTimer = GAME_CONFIG.khoikhoi.searchTime;
                } else {
                    const angle = Phaser.Math.Angle.Between(
                        this.ghost.x,
                        this.ghost.y,
                        this.ghostLastKnownPlayerPos.x,
                        this.ghostLastKnownPlayerPos.y
                    );
                    ghostBody.setVelocity(
                        Math.cos(angle) * GAME_CONFIG.khoikhoi.searchSpeed,
                        Math.sin(angle) * GAME_CONFIG.khoikhoi.searchSpeed
                    );
                    this.ghost.setRotation(angle - Math.PI / 2);
                }
                break;
            }

            case 'CHASE': {
                if (this.isHiding) {
                    this.ghostState = 'SEARCH';
                    this.ghostSearchTimer = GAME_CONFIG.khoikhoi.searchTime;
                    if (this.bgmChase) (this.bgmChase as any).setVolume(0);
                    break;
                }

                // Follow player aggressively
                this.ghostLastKnownPlayerPos = { x: this.player.x, y: this.player.y };
                const angle = Phaser.Math.Angle.Between(this.ghost.x, this.ghost.y, this.player.x, this.player.y);
                ghostBody.setVelocity(
                    Math.cos(angle) * GAME_CONFIG.khoikhoi.chaseSpeed,
                    Math.sin(angle) * GAME_CONFIG.khoikhoi.chaseSpeed
                );
                this.ghost.setRotation(angle - Math.PI / 2);

                // Contact Attack
                if (distToPlayer < GAME_CONFIG.khoikhoi.attackRange && this.invulnerableTime <= 0) {
                    this.inflictDamage();
                }

                // If player escaped far away
                if (distToPlayer > GAME_CONFIG.khoikhoi.sightRange * 1.5) {
                    this.ghostState = 'SEARCH';
                    this.ghostSearchTimer = GAME_CONFIG.khoikhoi.searchTime;
                    if (this.bgmChase) (this.bgmChase as any).setVolume(0);
                }
                break;
            }

            case 'SEARCH': {
                if (hasLineOfSight) {
                    this.startChase();
                    break;
                }

                this.ghostSearchTimer -= deltaMs;
                if (this.ghostSearchTimer <= 0) {
                    this.ghostState = 'PATROL';
                } else {
                    // Wander slowly around last known point
                    const angle = time / 400;
                    ghostBody.setVelocity(
                        Math.cos(angle) * GAME_CONFIG.khoikhoi.patrolSpeed * 0.7,
                        Math.sin(angle) * GAME_CONFIG.khoikhoi.patrolSpeed * 0.7
                    );
                }
                break;
            }
        }
    }

    private startChase() {
        if (this.ghostState !== 'CHASE') {
            this.ghostState = 'CHASE';
            playSFX('laser');
            if (this.cache.audio.exists('sfx_horror_sting')) {
                try { this.sound.play('sfx_horror_sting', { volume: runtimeSettings.sfxVol }); } catch {}
            }
            if (this.bgmChase) (this.bgmChase as any).setVolume(runtimeSettings.musicVol * 0.6);
            haptic(150);
            this.emitHud();
        }
    }

    private inflictDamage() {
        this.health -= GAME_CONFIG.khoikhoi.damage;
        this.invulnerableTime = 1600;
        this.cameras.main.shake(300, 0.018);

        playSFX('hit');
        if (this.cache.audio.exists('sfx_hit')) {
            try { this.sound.play('sfx_hit', { volume: runtimeSettings.sfxVol }); } catch {}
        }
        haptic(200);
        this.emitHud();

        if (this.health <= 0) {
            this.triggerGameOver();
        }
    }

    private isEntityInFlashlight(tx: number, ty: number): boolean {
        const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, tx, ty);
        if (dist > GAME_CONFIG.flashlight.radius) return false;

        const angleToTarget = Phaser.Math.Angle.Between(this.player.x, this.player.y, tx, ty);
        const diff = Phaser.Math.Angle.Wrap(angleToTarget - this.lastFacingAngle);
        const halfFov = Phaser.Math.DegToRad(GAME_CONFIG.flashlight.fov / 2);

        return Math.abs(diff) <= halfFov;
    }

    private renderDarknessAmbiance() {
        this.darkness.render({
            px: this.player.x,
            py: this.player.y,
            inDarkZone: !!this.currentZone.isDark,
            torchActive: this.hasTorch && this.flashlightOn && !this.isHiding,
            facingAngle: this.lastFacingAngle,
            brightness: runtimeSettings.brightness,
        });
    }

    private updateHeartbeat(deltaMs: number) {
        const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.ghost.x, this.ghost.y);
        const maxDist = 420;
        const tension = Math.max(0, Math.min(1.0, 1.0 - dist / maxDist));

        if (tension > 0.2) {
            this.heartbeatTimer -= deltaMs;
            const rate = Math.max(250, 950 - tension * 700);
            if (this.heartbeatTimer <= 0) {
                this.heartbeatTimer = rate;
                playSFX('heart', tension * 0.8);
                if (tension > 0.6) haptic(30);
            }
        }
    }

    private customObjective: string = "";

    private computePrompt(): { text: string; type: string } {
        if (this.isHiding) return { text: 'Press E to Exit Hiding Spot', type: 'interact' };

        let best: { text: string; type: string } | null = null;
        let bestDist = 52;

        this.hidingSpots.getChildren().forEach((h) => {
            const s = h as Phaser.Physics.Arcade.Sprite;
            const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, s.x, s.y);
            if (d < 38 && d < bestDist) {
                bestDist = d;
                best = { text: 'Press E to Hide', type: 'interact' };
            }
        });

        if (this.keys.indexOf('brass') === -1) {
            this.itemsGroup.getChildren().forEach((it) => {
                const item = it as Phaser.Physics.Arcade.Sprite;
                if (!item.active || item.getData('type') !== 'key_brass') return;
                const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, item.x, item.y);
                if (d < 42 && d < bestDist) {
                    bestDist = d;
                    best = { text: 'Press E to Collect Brass Key', type: 'interact' };
                }
            });
        }

        if (this.safeSprite && this.safeSprite.active) {
            const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.safeSprite.x, this.safeSprite.y);
            if (d < 46 && d < bestDist) {
                bestDist = d;
                best = this.isSafeUnlocked
                    ? { text: 'Safe Already Opened', type: 'none' }
                    : { text: "Press E to Search Principal's Safe", type: 'interact' };
            }
        }

        this.doorsGroup.getChildren().forEach((dd) => {
            const door = dd as Phaser.Physics.Arcade.Sprite;
            if (!door.body || !(door.body as Phaser.Physics.Arcade.Body).enable) return; // already open
            const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, door.x, door.y);
            if (d < bestDist) {
                const doorId = door.getData('doorId') as string;
                const def = DOORS[doorId];
                bestDist = d;
                if (def?.requiredCode && !this.unlockedDoors.has(doorId)) {
                    best = { text: 'Press E — Keypad Code Required', type: 'locked' };
                } else if (def?.requiredKey && !this.unlockedDoors.has(doorId)) {
                    best = this.keys.includes(def.requiredKey)
                        ? { text: 'Press E to Unlock & Open', type: 'interact' }
                        : { text: `Locked — Requires ${def.requiredKey === 'master' ? 'Master Gate Key' : 'Brass Key'}`, type: 'locked' };
                } else {
                    best = { text: 'Press E to Open', type: 'interact' };
                }
            }
        });

        return best ?? { text: '', type: 'none' };
    }

    private updateProximityPrompt(deltaMs: number) {
        if (this.promptTimer > 0) {
            this.promptTimer -= deltaMs;
            if (this.promptTimer <= 0) {
                this.promptText = '';
                this.promptType = 'none';
            }
            return; // transient hint overrides proximity prompt
        }
        const p = this.computePrompt();
        this.promptText = p.text;
        this.promptType = p.type;
    }

    private emitHud() {
        const dist = this.ghost ? Phaser.Math.Distance.Between(this.player.x, this.player.y, this.ghost.x, this.ghost.y) : 999;
        const tension = Math.max(0, Math.min(1.0, 1.0 - dist / 420));

        const payload: HudPayload = {
            health: this.health,
            maxHealth: GAME_CONFIG.player.maxHp,
            hasTorch: this.hasTorch,
            flashlight: this.flashlightOn,
            battery: Math.round(this.battery),
            keys: this.keys,
            cluesFound: this.cluesFound,
            totalClues: Object.keys(CLUES).length,
            objective: this.customObjective || this.currentZone.objective,
            zoneName: this.currentZone.name,
            isDarkArea: !!this.currentZone.isDark,
            isHiding: this.isHiding,
            isChased: this.ghostState === 'CHASE',
            isSprinting: this.isSprinting,
            promptText: this.promptText,
            promptType: this.promptType,
            tension,
        };

        EventBus.emit('hud-updated', payload);
    }
}