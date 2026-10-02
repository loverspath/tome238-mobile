# AGENTS.md - Agent Operations & Handover Guidelines

> **Project Mission**: Deliver a high-performance, mobile-optimized web terminal experience for **Tales of Middle-earth (ToME) 2.3.8-ah** running directly on an Android Termux native environment.  
> **Core Engineering Philosophy**:  
> «Preserve the game. Keep the transport thin. Make iteration cheap.»

---

## 1. Quick Operational Commands

All operations can be executed from the project root (`/data/data/com.termux/files/home/tome238-mobile`).

| Task | Command | Description |
| :--- | :--- | :--- |
| **Build Engine** | [`./scripts/build.sh`](file:///data/data/com.termux/files/home/tome238-mobile/scripts/build.sh) or `./build` | Compiles native C ToME engine using Clang (`make -j4`) with `ncursesw` into `game/tome`. |
| **Run CLI (Local)** | [`./scripts/run.sh`](file:///data/data/com.termux/files/home/tome238-mobile/scripts/run.sh) or `./run` | Launches game directly in local Termux terminal via curses (`main-gcu.c`). |
| **Run Web Server** | [`./scripts/run_web.sh [PORT]`](file:///data/data/com.termux/files/home/tome238-mobile/scripts/run_web.sh) or `./run_web` | Spawns Python async PTY-WebSocket bridge server (default port: `8080`). |
| **Restart Web Server** | [`./restart [PORT]`](file:///data/data/com.termux/files/home/tome238-mobile/restart) | Gracefully terminates existing servers, restarts daemon in background, and verifies HTTP 200 OK. |
| **Run All Tests** | [`./test`](file:///data/data/com.termux/files/home/tome238-mobile/test) | Runs both CLI smoke test and Web integration test suites sequentially. |
| **Engine Smoke Test** | [`./scripts/test.sh`](file:///data/data/com.termux/files/home/tome238-mobile/scripts/test.sh) | Headless PTY test ([`scripts/smoke_test.py`](file:///data/data/com.termux/files/home/tome238-mobile/scripts/smoke_test.py)) validating `--help`, module loading, and clean exit. |
| **Web Integration Test** | `python3 scripts/test_web.py` | Automated test suite validating HTTP endpoints, WebSocket handshake, PTY spawning, output streaming, and keystroke echo. |

---

## 2. Directory Layout & Key File Map

```
tome238-mobile/
├── AGENTS.md               # [THIS FILE] Operational rules and architecture guide for agents
├── README.md               # User-facing overview, quickstart, and features
├── build                   # Convenience shim -> scripts/build.sh
├── run                     # Convenience shim -> scripts/run.sh
├── run_web                 # Convenience shim -> scripts/run_web.sh
├── restart                 # Daemon manager & restart script
├── test                    # Convenience test runner -> scripts/test.sh + scripts/test_web.py
├── profiles/               # Declarative game and application profiles (JSON)
│   ├── tome238.json        # Official ToME 2.3.8-ah profile
│   └── portability_demo.json # Standalone C portability proof profile
├── docs/                   # Architectural, design, and gameplay specifications
│   ├── architecture.md     # Full system architecture (PTY bridge, ring buffer, Web UI)
│   ├── decoupling_checkpoint.md # Decoupling audit & generic shell architecture checkpoint
│   ├── multiprocess_feasibility.md # Local multiprocess (TomeNET server+client) feasibility analysis
│   ├── gameplay_changes.md # Fork modifications, Adventurer class spec, Runecraft roadmap
│   ├── build_guide.md      # Toolchain details, flags, and library dependencies
│   ├── mobile_keyboard_spec.md # Angbandroid UX analysis & virtual keyboard spec
│   ├── mobile_ui_ux_plan.md    # Comprehensive Mobile UI/UX Setup Hierarchy & Keyboard/Screen Implementation Plan
│   ├── tomenet_runecraft_spec.md # TomeNET Runecraft mechanics & formulas archaeology
│   ├── runecraft_mapping.md # 1:1 semantic mapping of Runecraft into ToME 2.3.8-ah primitives
│   └── runecraft_vertical_slice_spec.md # Fire/Cold × Bolt/Ball Zero-C prototype Lua spec


├── game/                   # ToME 2.3.8-ah core engine
│   ├── src/                # C source files, makefiles, and Lua 4.0 engine
│   │   ├── main-gcu.c      # Native ncurses/curses frontend (active)
│   │   ├── lua/            # Bundled Lua 4.0.1 engine & tolua code generator
│   │   └── defines.h       # Engine constants, flags, and element IDs (GF_*)
│   ├── lib/                # Runtime game assets (modules, scripts, edit files)
│   │   ├── edit/           # Base text databases (p_info.txt, s_info.txt, etc.)
│   │   ├── scpt/           # Engine Lua scripts (mkeys.lua, help.lua, etc.)
│   │   ├── mods/           # Game modules (Theme, Fury)
│   │   └── save/           # Symlink -> ../../saves
│   └── tome                # Compiled ARM64 native ELF binary
├── web/                    # Mobile web front-end & transport daemon
│   ├── index.html          # Mobile web single-page interface
│   ├── style.css           # Mobile touch styling, D-Pad, ribbons, Ghost opacity
│   ├── app.js              # Xterm.js controller, touch event handler & context sniffer
│   ├── server.py           # Asyncio PTY <-> WebSocket server + HTTP static server
│   └── vendor/             # Bundled offline xterm.js (4.19.0) and fit addon
├── saves/                  # Persistent player savefiles (separated from source tree)
└── scripts/                # Automation and validation scripts
```

---

## 3. Two Reference Repositories & Their Roles

External reference repositories are cloned at `/data/data/com.termux/files/home/ref_repos/`:

### 1. `Cuboideb/angbandroid` (`/data/data/com.termux/files/home/ref_repos/angbandroid`)
- **Native Port Reference (`app/src/main/cpp/tome23x/`)**:
  - Provides reference patches for compiling ToME 2.3.x on 64-bit ARM/Linux platforms.
  - Documents how legacy 32-bit assumptions were addressed (`__LP64__`, `s32b`).
  - *Note*: We explicitly discarded Angbandroid's JNI/NDK layers (`main-android.c`, `droid.c`) in favor of native curses (`main-gcu.c`).
- **Mobile UX Reference (`app/src/main/java/org/rephial/xyangband/`)**:
  - Primary source of proven mobile roguelike UX design:
    - 3x3 D-Pad with long-press continuous auto-repeat (`AdvButton.java`, `TermView.java`).
    - Scrolling action ribbon with dynamic context awareness (`ButtonRibbon.java`).
    - Modifier toggles (`Shift`, `Ctrl`, `RUN` / `.` movement prefix).
    - Ghost / translucent overlay modes for managing mobile screen estate.

### 2. `TomenetGame/tomenet` (`/data/data/com.termux/files/home/ref_repos/tomenet`)
- **Runecraft Engine Archaeology (`lib/scpt/runecraft.lua`, `src/server/runecraft.c`, `src/common/defines.h`)**:
  - Ground truth for the Runecraft/Runemastery spell combination mechanics.
  - Defines the 32-bit spell bitmask: `R1 | (R2 << 8) | (MODE << 16) | (TYPE << 24)`.
  - Full mathematical rules for 6 fundamental runes, 15 combination pairs (21 elements total), 14 spell shapes, 8 casting modes, mana costs, and failure backlash damage.
  - Used directly to formulate [`docs/tomenet_runecraft_spec.md`](file:///data/data/com.termux/files/home/tome238-mobile/docs/tomenet_runecraft_spec.md) and [`docs/runecraft_mapping.md`](file:///data/data/com.termux/files/home/tome238-mobile/docs/runecraft_mapping.md).

---

## 4. History of Modified Systems

### Phase 1: Native Engine Recovery (Complete)
- Isolated and neutralized Android JNI dependencies from upstream sources.
- Re-enabled the clean standard Unix Curses frontend ([`game/src/main-gcu.c`](file:///data/data/com.termux/files/home/tome238-mobile/game/src/main-gcu.c)).
- Configured Termux Clang build with `-DUSE_GCU -DUSE_NCURSES -DUSE_TPOSIX -DUSE_LUA` linking dynamically against `libncursesw.so.6.5` and `libm`.
- Ensured savefile persistence via symlinked `game/lib/save -> ../../saves`.

### Phase 2: Asynchronous PTY-WebSocket Transport (Complete)
- Created [`web/server.py`](file:///data/data/com.termux/files/home/tome238-mobile/web/server.py) using modern Python `asyncio` and `websockets`.
- Utilizes Linux `pty.openpty()` to spawn `game/tome -mgcu -MToME` in a dedicated pseudo-terminal with non-blocking I/O (`fcntl`).
- Handles terminal window sizing via `ioctl(TIOCSWINSZ)` pinned to 80x24 standard geometry.
- **64KB Ring Buffer Reconnection Recovery**: Caches the last 65,536 bytes of terminal escape streams. When a mobile browser reconnects (e.g., after screen lock or network switch), the server replays the buffer and triggers `Ctrl+R` (`\x12`), instantly restoring the screen without tearing or game resets.
- Multi-client broadcast support and graceful process termination with SIGTERM/SIGKILL.

### Phase 3: Mobile Web Frontend & Virtual Touch Interface (Complete)
- **Offline Display**: Bundled local `xterm.js` and `xterm-addon-fit` in [`web/vendor/`](file:///data/data/com.termux/files/home/tome238-mobile/web/vendor/), functioning without internet access.
- **Angbandroid D-Pad**: 3x3 layout with 8-way movement and center wait/rest (`5`). Implements tactile pointer events with 300ms initial hold delay followed by continuous 75ms repeat ticks.
- **Context Sniffer**: Continuously scans incoming terminal text for prompts like `(y/n)` or `(y/n/esc)` and dynamically swaps the ribbon to prominent `[✔ Yes (y)]`, `[✖ No (n)]`, and `[⎋ Esc]` buttons.
- **Action Ribbon**: Direct touch access for vital roguelike actions (`Esc`, `Enter`, `Space`, `Tab`, `Rest`, `Inven`, `Magic`, `Look`, `Target`, `Fire`, `Pickup`, `Wield`, `Quaff`, `Read`, `Use`, `Map`).
- **Modifier Machine**: Sticky toggles for `Shift`, `Ctrl`, and `RUN` (`.` + direction).
- **Ghost Mode**: 3-state toggle (Opaque -> 30% Ghost Translucent -> Hidden) to free up visual space during exploration.

### Phase 4: Mobile UI/UX Hierarchy, Neon Cyan AdvKeyboard & Floating Controllers (Active)
- **Visual & Source Audit**: Reverse engineered 8 native Angbandroid screenshots and matching Java sources (`GameActivity.java`, `TermView.java`, `AdvKeyboard.java`, `Preferences.java`, `preferences.xml`, `fab_crud.xml`).
- **Master Plan Specification**: Authored [`docs/mobile_ui_ux_plan.md`](file:///data/data/com.termux/files/home/tome238-mobile/docs/mobile_ui_ux_plan.md) covering the 16-item Quick Settings menu, 3-category Preferences system, 5x10 neon cyan keycap matrix, viewport auto-fit equations (`Fit Width`/`Fit Height`), and draggable 3x3 D-Pad/FAB engine.
- **Neon Cyan Glassmorphism**: Translucent dark glass keyboard styling with `#00e5ff` cyan text glow and responsive keycaps.
- **Floating Controls**: 3x3 directional D-pad draggable via center '5' button with `localStorage` offset persistence. Quick Settings context menu triggered via in-game menu key or bottom-left tap.

---

## 5. Architectural Decoupling: Generic Mobile Terminal Shell vs Game Engine

The project strictly follows a **two-tier decoupled architecture**:

1. **Generic Mobile Terminal Shell** ([`web/server.py`](file:///data/data/com.termux/files/home/tome238-mobile/web/server.py), [`web/app.js`](file:///data/data/com.termux/files/home/tome238-mobile/web/app.js), [`web/index.html`](file:///data/data/com.termux/files/home/tome238-mobile/web/index.html), [`web/keyboards.json`](file:///data/data/com.termux/files/home/tome238-mobile/web/keyboards.json)):
   - A completely game-agnostic PTY host, WebSocket streaming broker, and responsive touch keyboard client.
   - Operates with zero hardcoded game logic, paths, or macros.
   - Tested and verified via [`scripts/test_portability.py`](file:///data/data/com.termux/files/home/tome238-mobile/scripts/test_portability.py) with a standalone C demo ([`scripts/portability_demo.c`](file:///data/data/com.termux/files/home/tome238-mobile/scripts/portability_demo.c)).
2. **Declarative Game Profiles** ([`profiles/`](file:///data/data/com.termux/files/home/tome238-mobile/profiles/)):
   - Defines game-specific parameters in declarative JSON schema:
     - `id`, `name`, `title`, `brand`: Branding and browser window title.
     - `executable`, `args`, `cwd`, `env`: Process spawn command, working directory, and environment variables.
     - `geometry`: Terminal dimensions (`cols`, `rows`, default 80x24).
     - `redraw_key`: Screen refresh keystroke (`\x12` for ToME, `\x0c` for standard curses/sh).
     - `keyboard_config`: Target virtual keyboard layout definition (`keyboards.json`).
     - `context_rules`: Regex sniffer rules for dynamic prompt button injection.
   - Loaded via CLI: `python3 web/server.py --profile profiles/tome238.json`.
   - Exposed to frontend dynamically via `GET /api/profile`.

### Multi-Process Game Preparation (TomeNET Server + Client Local Hosting)
As investigated and verified in [`docs/multiprocess_feasibility.md`](file:///data/data/com.termux/files/home/tome238-mobile/docs/multiprocess_feasibility.md):
- **Local Loopback Transport**: Termux ARM64 allows non-root binding and connection over `127.0.0.1` (<0.2ms latency).
- **Process Orchestration Model**:
  - The PTY host (`server.py`) attaches directly to the interactive client process (`tomenet -c -f client.cfg 127.0.0.1 ...`).
  - The local server process (`tomenet.server`) is spawned as a background companion daemon.
  - **Metaserver Isolation**: Must configure `REPORT_TO_METASERVER = false` in `tomenet.cfg` to prevent public broadcast of private local mobile runs.
  - **Cascade Lifecycle**: When the client session disconnects or expires, `server.py` cleans up both the client PTY and the background server daemon via `SIGTERM` followed by `SIGKILL`.
- **Full Audit Reference**: See [`docs/decoupling_checkpoint.md`](file:///data/data/com.termux/files/home/tome238-mobile/docs/decoupling_checkpoint.md) for the 20-point coupling audit matrix (`GENERIC`, `CONFIG`, `ADAPTER`, `LEAVE ALONE`).

---

## 6. Critical Legacy Areas: What NOT to Refactor (Taboos & Pitfalls)

To preserve engine stability, incoming agents must strictly obey the following constraints:

> [!CAUTION]
> **DO NOT refactor these core legacy systems.** Doing so has historically led to broken builds, memory corruption, and unrecoverable savefile loss in Angband/ToME variants.


### 1. Old C Macros and Bitmasks (`defines.h`, `types.h`, `angband.h`)
- Do NOT convert `#define` macros into C++ style enums or inline functions.
- The C codebase relies on macro stringification, bitmask offsets, and hardcoded flag constants across hundreds of compilation units. Changing a macro can silently corrupt flag structures (`flags1`, `flags2`, `mflag`, `smart`).

### 2. Embedded Lua 4.0.1 and `tolua` Bindings (`game/src/lua/`, `*.pkg`)
- Do NOT attempt to upgrade Lua to 5.1, 5.3, or LuaJIT.
- The game engine's C-to-Lua binding is generated by a vintage `tolua` binary that specifically targets Lua 4.0 syntax and internal data structures.
- All bindings in `game/src/w_*.c` are generated from `game/src/*.pkg`. If you must expose new C functions to Lua, inspect existing `.pkg` files and adhere strictly to `tolua` conventions.

### 3. Savefile Serialization Format (`save.c`, `load.c`)
- Savefiles (`saves/`) use raw packed binary streams (`wr_u32b`, `rd_u32b`, `wr_byte`, etc.) that mirror C struct layouts.
- Adding fields or altering field order in `player_type`, `monster_type`, or `object_type` without updating savefile version checks will corrupt existing saves.

### 4. Global State & Single-Threaded Design
- The game relies on pervasive global variables: `p_ptr` (player), `cave` (dungeon grid), `dun_level`, `energy_use`, `unsafe`, `Term`.
- The engine is completely non-reentrant and not thread-safe. Never attempt to multithread the C engine. All concurrency must remain isolated in the external Python transport layer (`web/server.py`).

### 5. Transport Thinness: Keep Game I/O Decoupled from the Web
- Do NOT modify the C code to output JSON, WebSockets, or HTTP directly.
- The C engine must remain a pure, headless curses/terminal application communicating via standard ANSI VT100 escapes over PTY.
- The transport layer (`server.py`) and UI layer (`app.js`) are solely responsible for translation, touch interaction, and layout.

---

## 7. Development & Iteration Workflow

When implementing new features or making adjustments:

1. **Verify Baseline**:
   ```bash
   ./scripts/test.sh && python3 scripts/test_web.py
   ```
2. **Make Small, Incremental Edits**:
   - For UI/Touch adjustments: modify [`web/app.js`](file:///data/data/com.termux/files/home/tome238-mobile/web/app.js) or [`web/style.css`](file:///data/data/com.termux/files/home/tome238-mobile/web/style.css), then refresh browser.
   - For server/PTY adjustments: modify [`web/server.py`](file:///data/data/com.termux/files/home/tome238-mobile/web/server.py), then execute `./restart`.
   - For C game logic: modify files in `game/src/`, compile with `./scripts/build.sh`, and run tests.
3. **Validate**:
   - Run integration tests before committing.
   - Test reconnection by refreshing the browser tab while a game session is active.
4. **Documentation**:
   - Update [`docs/gameplay_changes.md`](file:///data/data/com.termux/files/home/tome238-mobile/docs/gameplay_changes.md) if game balance, skills, or classes are modified.
   - Update [`docs/architecture.md`](file:///data/data/com.termux/files/home/tome238-mobile/docs/architecture.md) if transport, server, or client architecture changes.
