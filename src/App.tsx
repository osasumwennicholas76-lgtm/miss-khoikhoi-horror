import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import StartGame, { EventBus, HudPayload, InspectNotePayload, KeypadPayload } from './game/main';
import { DEFAULT_SETTINGS, GameSettings, runtimeSettings, TUTORIAL_STEPS } from './game/config';
import { playSFX, setSoundMuted, isSoundMuted } from './game/audio';

export type GamePhase =
    | 'MENU'
    | 'TUTORIAL'
    | 'PLAYING'
    | 'PAUSED'
    | 'INSPECT_NOTE'
    | 'KEYPAD_PUZZLE'
    | 'GAME_OVER'
    | 'VICTORY'
    | 'SETTINGS'
    | 'CREDITS';

export interface IRefPhaserGame {
    game: Phaser.Game | null;
    scene: Phaser.Scene | null;
}

export default function App() {
    const phaserRef = useRef<IRefPhaserGame | null>(null);

    // State Machine
    const [phase, setPhase] = useState<GamePhase>('MENU');
    const [tutorialStep, setTutorialStep] = useState<number>(0);
    const [hasSavedGame, setHasSavedGame] = useState<boolean>(false);

    // HUD State
    const [hud, setHud] = useState<HudPayload>({
        health: 3,
        maxHealth: 3,
        hasTorch: false,
        flashlight: false,
        battery: 100,
        keys: [],
        cluesFound: [],
        totalClues: 6,
        objective: 'Find the torchlight to see in the dark.',
        zoneName: 'Dormitory',
        isDarkArea: false,
        isHiding: false,
        isChased: false,
        isSprinting: false,
        promptText: '',
        promptType: 'none',
        tension: 0,
    });

    // Note Inspection Modal State
    const [activeNote, setActiveNote] = useState<InspectNotePayload | null>(null);

    // Keypad Puzzle Modal State
    const [keypadData, setKeypadData] = useState<KeypadPayload | null>(null);
    const [enteredCode, setEnteredCode] = useState<string>('');
    const [keypadError, setKeypadError] = useState<boolean>(false);
    const [keypadSuccess, setKeypadSuccess] = useState<boolean>(false);

    // Settings State
    const [settings, setSettings] = useState<GameSettings>({ ...DEFAULT_SETTINGS });
    const [muted, setMuted] = useState<boolean>(false);

    // Stats
    const [gameStartTime, setGameStartTime] = useState<number>(0);
    const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);

    // Check for save on mount
    useEffect(() => {
        try {
            const save = localStorage.getItem('qc_khoikhoi_save');
            if (save) setHasSavedGame(true);
        } catch {
            // Ignore storage errors
        }
    }, [phase]);

    // Timer for victory stats
    useEffect(() => {
        let timer: any;
        if (phase === 'PLAYING') {
            timer = setInterval(() => {
                setElapsedSeconds(Math.floor((Date.now() - gameStartTime) / 1000));
            }, 1000);
        }
        return () => clearInterval(timer);
    }, [phase, gameStartTime]);

    // Mount Phaser Game
    useLayoutEffect(() => {
        if (phaserRef.current === null) {
            const game = StartGame('game-container');
            phaserRef.current = { game, scene: null };
        }

        const sceneHandler = (scene: Phaser.Scene) => {
            if (phaserRef.current) {
                phaserRef.current.scene = scene;
            }
        };

        const hudHandler = (payload: HudPayload) => {
            setHud(payload);
        };

        const phaseHandler = (newPhase: GamePhase) => {
            setPhase(newPhase);
        };

        const noteHandler = (note: InspectNotePayload) => {
            setActiveNote(note);
            setPhase('INSPECT_NOTE');
        };

        const keypadHandler = (keypad: KeypadPayload) => {
            setKeypadData(keypad);
            setEnteredCode('');
            setKeypadError(false);
            setKeypadSuccess(false);
            setPhase('KEYPAD_PUZZLE');
        };

        EventBus.on('current-scene-ready', sceneHandler);
        EventBus.on('hud-updated', hudHandler);
        EventBus.on('phase-changed', phaseHandler);
        EventBus.on('inspect-note', noteHandler);
        EventBus.on('open-keypad', keypadHandler);

        return () => {
            EventBus.removeListener('current-scene-ready', sceneHandler);
            EventBus.removeListener('hud-updated', hudHandler);
            EventBus.removeListener('phase-changed', phaseHandler);
            EventBus.removeListener('inspect-note', noteHandler);
            EventBus.removeListener('open-keypad', keypadHandler);

            if (phaserRef.current) {
                phaserRef.current.game?.destroy(true);
                phaserRef.current = null;
            }
        };
    }, []);

    // Action Dispatchers
    const startNewGame = () => {
        playSFX('button');
        try {
            localStorage.removeItem('qc_khoikhoi_save');
        } catch {}
        setGameStartTime(Date.now());
        setElapsedSeconds(0);
        EventBus.emit('start-game', { continueSave: false });
        setPhase('PLAYING');
    };

    const continueGame = () => {
        playSFX('button');
        setGameStartTime(Date.now());
        EventBus.emit('start-game', { continueSave: true });
        setPhase('PLAYING');
    };

    const togglePause = () => {
        playSFX('button');
        EventBus.emit('toggle-pause');
    };

    const resumeGame = () => {
        playSFX('button');
        EventBus.emit('toggle-pause');
    };

    const closeNote = () => {
        playSFX('button');
        setActiveNote(null);
        EventBus.emit('modal-closed');
        setPhase('PLAYING');
    };

    const handleKeypadDigit = (digit: string) => {
        if (enteredCode.length < 4 && !keypadSuccess) {
            playSFX('blip');
            setEnteredCode((prev) => prev + digit);
            setKeypadError(false);
        }
    };

    const handleKeypadClear = () => {
        playSFX('button');
        setEnteredCode('');
        setKeypadError(false);
    };

    const handleKeypadSubmit = () => {
        if (!keypadData) return;
        if (enteredCode === keypadData.requiredCode) {
            setKeypadSuccess(true);
            playSFX('unlock');
            EventBus.emit('keypad-unlocked', { doorId: keypadData.doorId });
            setTimeout(() => {
                setKeypadData(null);
                EventBus.emit('modal-closed');
                setPhase('PLAYING');
            }, 900);
        } else {
            setKeypadError(true);
            playSFX('error');
            setTimeout(() => {
                setEnteredCode('');
            }, 600);
        }
    };

    const handleSettingChange = (key: keyof GameSettings, val: number | boolean) => {
        const next = { ...settings, [key]: val };
        setSettings(next);
        Object.assign(runtimeSettings, next);
        EventBus.emit('update-settings', next);
    };

    const handleMuteToggle = () => {
        const next = !muted;
        setMuted(next);
        setSoundMuted(next);
        if (phaserRef.current?.scene) {
            phaserRef.current.scene.sound.mute = next;
        }
    };

    // Keyboard support for the tutorial modal (fixes dead-end overlay)
    useEffect(() => {
        if (phase !== 'TUTORIAL') return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'ArrowRight' || e.key === 'Enter') {
                setTutorialStep((prev) => Math.min(TUTORIAL_STEPS.length - 1, prev + 1));
            } else if (e.key === 'ArrowLeft') {
                setTutorialStep((prev) => Math.max(0, prev - 1));
            } else if (e.key === 'Escape') {
                setPhase('MENU');
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [phase]);

    // UI Helpers
    const formatTime = (secs: number) => {
        const m = Math.floor(secs / 60);
        const s = secs % 60;
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    };

    return (
        <div id="app">
            {/* Phaser Game Container */}
            <div id="game-container" />

            {/* React Fullscreen Horror HUD & Screen Overlays */}
            <div id="hud">
                {/* 1. TENSION VIGNETTE (Dynamic blood-red edge glow when chased/near Miss KhoiKhoi) */}
                {phase === 'PLAYING' && (hud.tension > 0.05 || hud.isChased) && (
                    <div
                        className="tension-vignette"
                        style={{
                            opacity: hud.isChased ? 0.85 : Math.min(0.7, hud.tension * 0.9),
                            boxShadow: `inset 0 0 ${hud.isChased ? '120px 40px' : '80px 20px'} rgba(217, 4, 41, ${hud.tension})`,
                        }}
                    />
                )}

                {/* 2. IN-GAME HUD (Top bar, Battery, Items, Objectives) */}
                {phase === 'PLAYING' && (
                    <div className="game-hud-container">
                        {/* Top Left: Health & Zone */}
                        <div className="hud-panel hud-top-left">
                            <div className="hud-zone-badge">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#e8c15a" strokeWidth="2">
                                    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                                </svg>
                                <span>{hud.zoneName}</span>
                            </div>

                            {hud.isDarkArea && (
                                <div className="hud-dark-warning">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ff6b35" strokeWidth="2">
                                        <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
                                    </svg>
                                    <span>LIGHTS OFF — Use torch [F]</span>
                                </div>
                            )}

                            <div className="hud-health-row">
                                {[...Array(hud.maxHealth)].map((_, i) => (
                                    <div key={i} className={`heart-icon ${i < hud.health ? 'full' : 'empty'}`}>
                                        <svg width="22" height="22" viewBox="0 0 24 24" fill={i < hud.health ? '#d90429' : '#333'}>
                                            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                                        </svg>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Top Center: Objective Tracker */}
                        <div className="hud-panel hud-top-center">
                            <div className="objective-icon">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0ec3c9" strokeWidth="2">
                                    <circle cx="12" cy="12" r="10" />
                                    <circle cx="12" cy="12" r="4" />
                                </svg>
                            </div>
                            <span className="objective-text">{hud.objective}</span>
                        </div>

                        {/* Top Right: Clues & Pause Button */}
                        <div className="hud-panel hud-top-right">
                            <div className="clues-counter">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e5c158" strokeWidth="2">
                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                    <polyline points="14 2 14 8 20 8" />
                                </svg>
                                <span>
                                    {hud.cluesFound.length} / {hud.totalClues} Clues
                                </span>
                            </div>

                            <button className="hud-icon-btn" onClick={togglePause} title="Pause Game">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff">
                                    <rect x="6" y="4" width="4" height="16" />
                                    <rect x="14" y="4" width="4" height="16" />
                                </svg>
                            </button>
                        </div>

                        {/* Bottom Left: Flashlight Battery & Inventory Belt */}
                        <div className="hud-panel hud-bottom-left">
                            {/* Flashlight Battery Bar */}
                            <div className={`battery-container ${hud.battery < 25 ? 'low-battery' : ''}`}>
                                <div className="battery-header">
                                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#ffd76a" strokeWidth="2">
                                        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                                    </svg>
                                    <span>TORCH {hud.hasTorch ? (hud.flashlight ? `${hud.battery}%` : 'OFF') : 'NONE'}</span>
                                </div>
                                <div className="battery-track">
                                    <div
                                        className="battery-fill"
                                        style={{
                                            width: `${hud.hasTorch ? hud.battery : 0}%`,
                                            backgroundColor: hud.battery > 40 ? '#54d98c' : hud.battery > 20 ? '#f39c12' : '#d90429',
                                        }}
                                    />
                                </div>
                            </div>

                            {/* Inventory Items */}
                            <div className="inventory-row">
                                <div className={`inv-slot ${hud.hasTorch ? 'active' : ''}`} title="Torchlight">
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill={hud.hasTorch ? '#ffd76a' : '#444'}>
                                        <path d="M12 2a4 4 0 0 0-4 4v2H7v4h10V8h-1V6a4 4 0 0 0-4-4zm0 2a2 2 0 0 1 2 2v2h-4V6a2 2 0 0 1 2-2zm-3 8v8a3 3 0 0 0 6 0v-8H9z" />
                                    </svg>
                                </div>

                                <div className={`inv-slot ${hud.keys.includes('brass') ? 'active' : ''}`} title="Brass Key">
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill={hud.keys.includes('brass') ? '#e8c15a' : '#444'}>
                                        <path d="M7 14A6 6 0 1 1 13 8.35L17.5 13H20v3h-3v2h-2v-2.5L12.65 13A6 6 0 0 1 7 14zm0-8a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />
                                    </svg>
                                </div>

                                <div className={`inv-slot ${hud.keys.includes('master') ? 'active' : ''}`} title="Master Gate Key">
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill={hud.keys.includes('master') ? '#2ec4b6' : '#444'}>
                                        <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-1 6h2v6h-2V7zm0 8h2v2h-2v-2z" />
                                    </svg>
                                </div>
                            </div>
                        </div>

                        {/* Bottom Center: Contextual Interaction Prompt */}
                        {hud.promptText && (
                            <div className={`interaction-prompt type-${hud.promptType}`}>
                                <span className="prompt-key">[E]</span>
                                <span>{hud.promptText}</span>
                            </div>
                        )}

                        {/* Bottom Center: Hiding Status Alert */}
                        {hud.isHiding && (
                            <div className="hud-hiding-banner">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="#54d98c">
                                    <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z" />
                                </svg>
                                <span>HIDING IN LOCKER — HOLD BREATH</span>
                            </div>
                        )}

                        {/* Bottom Control Guide Pill (always visible while playing) */}
                        <div className="control-hints-pill">
                            <span><b>[WASD]</b> Move</span>
                            <span className={hud.isSprinting ? 'hint-active' : ''}><b>[Shift]</b> Run</span>
                            <span><b>[E]</b> Interact/Doors</span>
                            <span><b>[F]</b> Torch</span>
                            <span><b>[Esc]</b> Pause</span>
                        </div>

                        {/* Mobile Touch Quick Controls (Torch Switch + Interact E) */}
                        <div className="mobile-touch-actions">
                            <button
                                className={`mobile-action-btn torch-btn ${hud.flashlight ? 'torch-on' : ''}`}
                                onClick={() => EventBus.emit('trigger-flashlight')}
                                title="Toggle Flashlight [F]"
                            >
                                <svg width="24" height="24" viewBox="0 0 24 24" fill={hud.flashlight ? '#ffd76a' : '#888'}>
                                    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                                </svg>
                                <span>[F]</span>
                            </button>

                            <button
                                className="mobile-action-btn interact-btn"
                                onClick={() => EventBus.emit('trigger-interact')}
                                title="Interact / Search [E]"
                            >
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="#0ec3c9">
                                    <circle cx="12" cy="12" r="9" stroke="#0ec3c9" strokeWidth="2" fill="none" />
                                    <path d="M12 7v6l4 2" stroke="#0ec3c9" strokeWidth="2" />
                                </svg>
                                <span>[E]</span>
                            </button>
                        </div>
                    </div>
                )}

                {/* 3. MAIN MENU SCREEN */}
                {phase === 'MENU' && (
                    <div className="overlay-screen menu-screen">
                        <div className="menu-backdrop-glow" />
                        <div className="school-crest">
                            <svg width="44" height="44" viewBox="0 0 24 24" fill="#d90429">
                                <path d="M12 2L1 7l11 5 9-4.09V17h2V7L12 2zm-8.2 7.76L12 13.45l6.33-2.88A19.78 19.78 0 0 1 12 22a19.78 19.78 0 0 1-8.2-12.24z" />
                            </svg>
                        </div>
                        <h1 className="horror-title">NIGHT AT QUEEN'S COLLEGE</h1>
                        <h2 className="horror-subtitle">The Legend of Miss KhoiKhoi</h2>

                        <div className="menu-button-group">
                            <button className="horror-btn primary" onClick={startNewGame}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                                    <polygon points="5 3 19 12 5 21 5 3" />
                                </svg>
                                <span>NEW GAME</span>
                            </button>

                            {hasSavedGame && (
                                <button className="horror-btn" onClick={continueGame}>
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M13 3a9 9 0 0 0-9 9H1l4 4 4-4H6a7 7 0 1 1 7 7 7 7 0 0 1-5-2.09l-1.42 1.42A9 9 0 1 0 13 3z" />
                                    </svg>
                                    <span>CONTINUE</span>
                                </button>
                            )}

                            <button className="horror-btn" onClick={() => setPhase('TUTORIAL')}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 15h-2v-6h2zm0-8h-2V7h2z" />
                                </svg>
                                <span>HOW TO PLAY</span>
                            </button>

                            <button className="horror-btn" onClick={() => setPhase('SETTINGS')}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
                                </svg>
                                <span>SETTINGS</span>
                            </button>

                            <button className="horror-btn" onClick={() => setPhase('CREDITS')}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
                                </svg>
                                <span>CREDITS & LORE</span>
                            </button>
                        </div>

                        <div className="menu-footer-lore">
                            "Listen closely for the click-clack of her heels... khoi... khoi... khoi..."
                        </div>
                    </div>
                )}

                {/* 4. HOW TO PLAY / STEP-BY-STEP TUTORIAL */}
                {phase === 'TUTORIAL' && (
                    <div className="overlay-screen tutorial-screen">
                        <div className="modal-card tutorial-card">
                            <div className="modal-header">
                                <h2>HOW TO SURVIVE</h2>
                                <span className="step-badge">
                                    {tutorialStep + 1} / {TUTORIAL_STEPS.length}
                                </span>
                            </div>

                            <div className="tutorial-body">
                                <h3 className="tutorial-step-title">{TUTORIAL_STEPS[tutorialStep].title}</h3>
                                <p className="tutorial-step-text">{TUTORIAL_STEPS[tutorialStep].body}</p>
                            </div>

                            {/* Tutorial Navigation Steps Indicator */}
                            <div className="tutorial-dots">
                                {TUTORIAL_STEPS.map((_, i) => (
                                    <div
                                        key={i}
                                        className={`dot ${i === tutorialStep ? 'active' : ''}`}
                                        onClick={() => setTutorialStep(i)}
                                    />
                                ))}
                            </div>

                            <div className="modal-btn-row">
                                <button
                                    className="horror-btn"
                                    disabled={tutorialStep === 0}
                                    onClick={() => setTutorialStep((prev) => Math.max(0, prev - 1))}
                                >
                                    PREVIOUS
                                </button>

                                {tutorialStep < TUTORIAL_STEPS.length - 1 ? (
                                    <button
                                        className="horror-btn primary"
                                        onClick={() => setTutorialStep((prev) => Math.min(TUTORIAL_STEPS.length - 1, prev + 1))}
                                    >
                                        NEXT
                                    </button>
                                ) : (
                                    <button className="horror-btn primary" onClick={() => setPhase('MENU')}>
                                        RETURN TO MENU
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* 5. NOTE / DIARY INSPECTION MODAL */}
                {phase === 'INSPECT_NOTE' && activeNote && (
                    <div className="overlay-screen inspect-screen">
                        <div className="parchment-note">
                            <div className="note-pin" />
                            <h3 className="note-title">{activeNote.title}</h3>
                            <div className="note-divider" />
                            <p className="note-content">{activeNote.text}</p>
                            {activeNote.hint && <div className="note-hint">★ {activeNote.hint}</div>}
                            <button className="horror-btn primary note-close-btn" onClick={closeNote}>
                                [E / ESC] FOLD NOTE & RESUME
                            </button>
                        </div>
                    </div>
                )}

                {/* 6. KEYPAD DIGITAL LOCK PUZZLE MODAL */}
                {phase === 'KEYPAD_PUZZLE' && keypadData && (
                    <div className="overlay-screen keypad-screen">
                        <div className="keypad-panel">
                            <div className="keypad-header">
                                <h3>{keypadData.title}</h3>
                                <div className="keypad-led-display">
                                    <span className={`led-digits ${keypadError ? 'led-error' : keypadSuccess ? 'led-success' : ''}`}>
                                        {keypadSuccess
                                            ? 'GRANTED'
                                            : keypadError
                                            ? 'DENIED'
                                            : enteredCode.padEnd(4, '_')}
                                    </span>
                                </div>
                            </div>

                            <div className="keypad-grid">
                                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                                    <button key={digit} className="keypad-btn" onClick={() => handleKeypadDigit(digit)}>
                                        {digit}
                                    </button>
                                ))}
                                <button className="keypad-btn action-clear" onClick={handleKeypadClear}>
                                    CLR
                                </button>
                                <button className="keypad-btn" onClick={() => handleKeypadDigit('0')}>
                                    0
                                </button>
                                <button className="keypad-btn action-enter" onClick={handleKeypadSubmit}>
                                    ENT
                                </button>
                            </div>

                            <button className="horror-btn abort-btn" onClick={() => { EventBus.emit('modal-closed'); setPhase('PLAYING'); }}>
                                STEP BACK
                            </button>
                        </div>
                    </div>
                )}

                {/* 7. PAUSE MENU MODAL */}
                {phase === 'PAUSED' && (
                    <div className="overlay-screen pause-screen">
                        <div className="modal-card pause-card">
                            <h2>GAME PAUSED</h2>
                            <div className="menu-button-group">
                                <button className="horror-btn primary" onClick={resumeGame}>
                                    RESUME
                                </button>
                                <button className="horror-btn" onClick={() => setPhase('SETTINGS')}>
                                    SETTINGS
                                </button>
                                <button className="horror-btn" onClick={() => setPhase('TUTORIAL')}>
                                    HOW TO PLAY
                                </button>
                                <button className="horror-btn" onClick={() => setPhase('MENU')}>
                                    QUIT TO MENU
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* 8. SETTINGS MODAL */}
                {phase === 'SETTINGS' && (
                    <div className="overlay-screen settings-screen">
                        <div className="modal-card settings-card">
                            <h2>SETTINGS</h2>
                            <div className="settings-list">
                                <div className="setting-row">
                                    <label>Music Volume ({Math.round(settings.musicVol * 100)}%)</label>
                                    <input
                                        type="range"
                                        min="0"
                                        max="1"
                                        step="0.05"
                                        value={settings.musicVol}
                                        onChange={(e) => handleSettingChange('musicVol', parseFloat(e.target.value))}
                                    />
                                </div>

                                <div className="setting-row">
                                    <label>SFX Volume ({Math.round(settings.sfxVol * 100)}%)</label>
                                    <input
                                        type="range"
                                        min="0"
                                        max="1"
                                        step="0.05"
                                        value={settings.sfxVol}
                                        onChange={(e) => handleSettingChange('sfxVol', parseFloat(e.target.value))}
                                    />
                                </div>

                                <div className="setting-row">
                                    <label>Brightness / Gamma ({Math.round(settings.brightness * 100)}%)</label>
                                    <input
                                        type="range"
                                        min="0.1"
                                        max="0.8"
                                        step="0.05"
                                        value={settings.brightness}
                                        onChange={(e) => handleSettingChange('brightness', parseFloat(e.target.value))}
                                    />
                                </div>

                                <div className="setting-row toggle-row">
                                    <label>Haptic Vibration</label>
                                    <input
                                        type="checkbox"
                                        checked={settings.vibration}
                                        onChange={(e) => handleSettingChange('vibration', e.target.checked)}
                                    />
                                </div>

                                <div className="setting-row toggle-row">
                                    <label>Mute All Sound</label>
                                    <input type="checkbox" checked={muted} onChange={handleMuteToggle} />
                                </div>
                            </div>

                            <button className="horror-btn primary" onClick={() => setPhase('MENU')}>
                                BACK
                            </button>
                        </div>
                    </div>
                )}

                {/* 9. CREDITS & NIGERIAN HORROR LORE MODAL */}
                {phase === 'CREDITS' && (
                    <div className="overlay-screen credits-screen">
                        <div className="modal-card credits-card">
                            <h2>THE LEGEND OF MISS KHOIKHOI</h2>
                            <div className="credits-text">
                                <p>
                                    Madam / Miss KhoiKhoi is one of Nigeria's most enduring urban legends, told across boarding schools
                                    and secondary colleges for generations.
                                </p>
                                <p>
                                    Said to be a fashionable teacher who walked with a distinct heel sound — <em>khoi... khoi... khoi...</em> —
                                    she was said to roam the dormitories and dark corridors at night seeking revenge or her missing heel.
                                </p>
                                <p className="credit-sub">
                                    Created with Phaser 4 & React. All audio, mechanics, and stealth survival puzzles crafted for an authentic African boarding school survival horror experience.
                                </p>
                            </div>
                            <button className="horror-btn primary" onClick={() => setPhase('MENU')}>
                                BACK TO MENU
                            </button>
                        </div>
                    </div>
                )}

                {/* 10. GAME OVER SCREEN */}
                {phase === 'GAME_OVER' && (
                    <div className="overlay-screen gameover-screen">
                        <div className="blood-splatter" />
                        <h1 className="gameover-title">CAUGHT IN THE DARK</h1>
                        <p className="gameover-subtitle">Miss KhoiKhoi's icy touch has claimed another student...</p>

                        <div className="menu-button-group">
                            {hasSavedGame && (
                                <button className="horror-btn primary" onClick={continueGame}>
                                    RESTART FROM CHECKPOINT
                                </button>
                            )}
                            <button className="horror-btn" onClick={startNewGame}>
                                NEW GAME
                            </button>
                            <button className="horror-btn" onClick={() => setPhase('MENU')}>
                                MAIN MENU
                            </button>
                        </div>
                    </div>
                )}

                {/* 11. VICTORY SCREEN */}
                {phase === 'VICTORY' && (
                    <div className="overlay-screen victory-screen">
                        <div className="dawn-sky-glow" />
                        <h1 className="victory-title">DAWN AT QUEEN'S COLLEGE</h1>
                        <h2 className="victory-subtitle">
                            {hud.cluesFound.length >= 5
                                ? 'ENDING B: THE TRUTH UNVEILED'
                                : 'ENDING A: THE ESCAPED SURVIVOR'}
                        </h2>

                        <div className="victory-stats-card">
                            <p>
                                {hud.cluesFound.length >= 5
                                    ? 'You unlocked the dark secret of 1977 and escaped into the sunrise with the full confession. Miss KhoiKhoi’s spirit is finally understood.'
                                    : 'You slipped past the compound gates into the morning light, though the dark secrets of the school remain buried.'}
                            </p>
                            <div className="stats-grid">
                                <div className="stat-box">
                                    <span className="stat-label">TIME TAKEN</span>
                                    <span className="stat-val">{formatTime(elapsedSeconds)}</span>
                                </div>
                                <div className="stat-box">
                                    <span className="stat-label">CLUES RECOVERED</span>
                                    <span className="stat-val">
                                        {hud.cluesFound.length} / {hud.totalClues}
                                    </span>
                                </div>
                                <div className="stat-box">
                                    <span className="stat-label">HEALTH REMAINING</span>
                                    <span className="stat-val">{hud.health} / 3</span>
                                </div>
                            </div>
                        </div>

                        <div className="menu-button-group">
                            <button className="horror-btn primary" onClick={startNewGame}>
                                PLAY AGAIN
                            </button>
                            <button className="horror-btn" onClick={() => setPhase('MENU')}>
                                MAIN MENU
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}