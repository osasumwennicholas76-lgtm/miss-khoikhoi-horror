/**
 * SCHOOL MAP — ASCII LAYOUT & ENTITY PLACEMENT
 * Night at Queen's College — 64 x 36 grid, TILE = 32 => world 2048 x 1152.
 *
 * Legend:
 *   #  solid wall / brick barrier
 *   .  walkable floor
 *   P  player spawn (Dormitory, West)
 *   E  Miss KhoiKhoi spawn / patrol anchor (Main Hallway)
 *   H  hiding furniture (Locker / Cupboard / Desk)
 *   T  torchlight pickup
 *   K  brass key item (unlocks Main Hall Door)
 *   C  clue / note pickup (diary / chemistry riddle / photos / confession)
 *   D  locked wooden door (Main Hall)
 *   L  science lab door (Keypad: 0684)
 *   O  principal's office door (Keypad: 1977)
 *   S  principal's safe (Contains Master Gate Key)
 *   B  spare battery pickup
 *   G  compound exit security gate (Requires Master Key)
 */

export const TILE = 32;

// 64 columns wide, 36 rows tall. Every row is exactly 64 characters.
export const SCHOOL_MAP: string[] = [
    "################################################################", // 0
    "#......#..........#...........#............#.................#", // 1
    "#..P...#....C.....#.....H.....#.....H......#....B....C.......#", // 2
    "#......#..........#...........#............#........K........#", // 3
    "#............................................................#", // 4
    "#......#..........#...........#............#.................#", // 5
    "#..T...#..........#.....H.....#............#...........S.....#", // 6
    "#......#..........#...........#............#.................#", // 7
    "####D#######################L######O##########################", // 8
    "#......................................................#......#", // 9
    "#...........................E..........................#..C...#", // 10
    "#......................................................#......#", // 11
    "####D###################################################.#######", // 12
    "#..........#...........#............#..........#...............#", // 13
    "#....H.....#.....C.....#.....H......#....B.....#...............#", // 14
    "#..........#...........#............#..........#...............#", // 15
    "#..............................................................#", // 16
    "#..........#...........#............#..........#...............#", // 17
    "#..........#...........#.....H......#..........#...............#", // 18
    "#..........#...........#............#..........#...............#", // 19
    "####.#######################.#############################.#####", // 20
    "#......................................................#......#", // 21
    "#...........................E..........................#..H...#", // 22
    "#......................................................#......#", // 23
    "####.###################################################.#######", // 24
    "#..........#...........#............#..........#...............#", // 25
    "#....H.....#.....C.....#.....H......#....B.....#...............#", // 26
    "#..........#...........#............#..........#...............#", // 27
    "#..............................................................#", // 28
    "#..........#...........#............#..........#...............#", // 29
    "#....C.....#...........#.....H......#..........#...............#", // 30
    "#..........#...........#............#..........#...............#", // 31
    "#####################################...########################", // 32
    "#..............................................................#", // 33
    "#.............................................................G#", // 34
    "################################################################", // 35
];

export const LEVEL_MAP = SCHOOL_MAP;

export const WORLD_W = SCHOOL_MAP[0].length * TILE;   // 2048
export const WORLD_H = SCHOOL_MAP.length * TILE;      // 1152

// ---------------------------------------------------------------------------
// ZONE DETECTION (for HUD current zone + checkpoint naming)
// ---------------------------------------------------------------------------
export interface Zone {
    id: string;
    name: string;
    objective: string;
    x0: number; // tile col range
    x1: number;
    y0: number; // tile row range
    y1: number;
    isDark?: boolean;
}

export const ZONES: Zone[] = [
    { id: "dorm", name: "Dormitory", objective: "Find the torchlight to see in the dark.", x0: 1, x1: 6, y0: 1, y1: 7 },
    { id: "class1", name: "Classroom 1", objective: "Search the desks for clues.", x0: 8, x1: 17, y0: 1, y1: 7 },
    { id: "library", name: "Library", objective: "Find the Chemistry Riddle for the Lab door.", x0: 19, x1: 30, y0: 1, y1: 7 },
    { id: "science", name: "Science Wing", objective: "LIGHTS OFF — Use torch [F]. Unlock the keypad (0684).", x0: 32, x1: 43, y0: 1, y1: 7, isDark: true },
    { id: "staff", name: "Staff Room", objective: "Enter the Staff Room to find the Brass Key.", x0: 45, x1: 62, y0: 1, y1: 7 },
    { id: "hall1", name: "North Corridor", objective: "Sneak carefully! Watch out for Miss KhoiKhoi.", x0: 1, x1: 62, y0: 9, y1: 11 },
    { id: "class2", name: "Classroom 2", objective: "Search the desks for clues.", x0: 1, x1: 10, y0: 13, y1: 19 },
    { id: "class3", name: "Classroom 3", objective: "Search for torn photograph halves.", x0: 12, x1: 22, y0: 13, y1: 19 },
    { id: "hall2", name: "Central Hallway", objective: "LIGHTS OFF — Use torch [F]. Avoid the high heels echoing.", x0: 1, x1: 62, y0: 21, y1: 23, isDark: true },
    { id: "records", name: "Old Archive", objective: "LIGHTS OFF — Use torch [F]. Find the Teacher's Confession.", x0: 1, x1: 62, y0: 25, y1: 31, isDark: true },
    { id: "compound", name: "School Compound", objective: "Unlock the Exit Gate with the Master Key!", x0: 1, x1: 62, y0: 33, y1: 34 },
];

export function zoneAt(tileX: number, tileY: number): Zone {
    for (const z of ZONES) {
        if (tileX >= z.x0 && tileX <= z.x1 && tileY >= z.y0 && tileY <= z.y1) {
            return z;
        }
    }
    return {
        id: "hallway",
        name: "Dark Corridors",
        objective: "Listen for the sound of high heels...",
        x0: 0,
        x1: 64,
        y0: 0,
        y1: 36,
    };
}