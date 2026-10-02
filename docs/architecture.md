# ToME 2.3.8-ah Mobile Web Terminal Architecture Specification

> **Core Philosophy**:  
> «Preserve the game. Keep the transport thin. Make iteration cheap.»  
> 
> - **Preserve the game**: The ToME 2.3.8-ah C core engine remains an unadulterated ANSI/VT100 curses application. Game mechanics, RNG, savefile formats, and dungeon logic remain pure.
> - **Keep the transport thin**: A decoupled asynchronous transport bridges the OS pseudo-terminal (PTY) to modern WebSockets without bloating either side.
> - **Make iteration cheap**: Zero native Android compilation (no Android Studio, Gradle, NDK, or APK signing). Any changes to UI, touch layout, or server logic can be tested in seconds via browser refresh.

---

## 1. System Full Architecture Diagram

```mermaid
flowchart TD
    subgraph Client_Layer["Mobile Client Layer (Browser)"]
        Browser["Mobile Web Browser<br>(Chrome / Firefox / Safari)"]
        Xterm["Xterm.js Canvas Engine<br>(80x24 VT100 Terminal)"]
        
        subgraph Touch_UI["Touch Controls & UX"]
            AdvKeyboard["AdvKeyboard Virtual Pad<br>(JSON Data-Driven Layouts)"]
            ActionRibbon["Action Ribbon<br>(Fixed + Dynamic Context + Macros)"]
            Sniffer["Context Sniffer<br>(Screen Buffer Regex from Profile)"]
            KeymapEditor["Inline Keymap Editor<br>(LocalStorage Key Binding)"]
        end
    end

    subgraph Profile_Layer["Declarative Profile Layer (profiles/*.json)"]
        ProfileDoc["Game Profile (JSON Schema)<br>(executable, args, env, cwd, redraw_key, context_rules)"]
        ProfileTome["profiles/tome238.json<br>(Official ToME 2.3.8-ah)"]
        ProfileDemo["profiles/portability_demo.json<br>(Decoupled Shell Demo)"]
        ProfileTomenet["profiles/tomenet.json<br>(Future Multi-Process C/S)"]
        ProfileDoc -.-> ProfileTome
        ProfileDoc -.-> ProfileDemo
        ProfileDoc -.-> ProfileTomenet
    end

    subgraph Shell_Host["Generic Mobile Terminal Shell (web/server.py)"]
        HTTP_Server["HTTP Static Server & REST API<br>(GET / & GET /api/profile)"]
        WS_Server["WebSocket Server (/ws?session=id)<br>(Bidirectional JSON / Raw Binary Stream)"]
        SessionMgr["PtySession Supervisor<br>(Lifecycle, Resize, Process Tracking)"]
        RingBuffer["64KB Circular Ring Buffer<br>(Preserves Last 65,536 Bytes of VT100 Output)"]
        PTY_Master["Linux PTY Master FD<br>(O_NONBLOCK, Asyncio add_reader)"]
    end

    subgraph Kernel_Transport["Kernel & Local Transport"]
        PTY_Slave["PTY Slave Device (/dev/pts/X)<br>(termios TIOCSWINSZ 80x24)"]
        LoopbackTCP["Android Loopback TCP (127.0.0.1)<br>(Latency < 0.2ms, Non-Root)"]
    end

    subgraph Target_Process["Target Executable Layer (Managed Processes)"]
        subgraph Single_Proc["Single-Process Mode (e.g. ToME 2.3.8-ah)"]
            GCU_Driver["Ncurses GCU Driver<br>(main-gcu.c + libncursesw.so.6.5)"]
            Core_C["ToME C Core Engine<br>(Dungeon, Combat, Spells, Saves)"]
            Lua_Engine["Embedded Lua 4.0.1 Engine<br>(game/src/lua/ + tolua Bindings)"]
            GCU_Driver <--> Core_C
            Core_C <--> Lua_Engine
        end

        subgraph Multi_Proc["Multi-Process Mode (e.g. TomeNET C/S)"]
            Client_Bin["TomeNET Client (tomenet -c)<br>[PTY Foreground Child]"]
            Server_Bin["TomeNET Server (tomenet.server)<br>[Supervised Companion Daemon]"]
            Client_Bin <-->|Local TCP Port 18348| LoopbackTCP
            LoopbackTCP <--> Server_Bin
        end
    end

    %% Client Interactions
    Browser --> Xterm
    AdvKeyboard --> WS_Server
    ActionRibbon --> WS_Server
    KeymapEditor --> AdvKeyboard
    Sniffer -.->|Scans Terminal Stream| ActionRibbon

    %% Client <-> Shell
    Xterm <-->|Bidirectional WebSocket Stream| WS_Server
    Browser <-->|HTTP GET & /api/profile| HTTP_Server

    %% Shell Internal & Profile Binding
    ProfileLayer -.->|Loaded on Startup (--profile)| SessionMgr
    SessionMgr --> HTTP_Server
    WS_Server <--> SessionMgr
    SessionMgr --> PTY_Master
    PTY_Master --> RingBuffer
    RingBuffer -.->|Replay on Reconnect + redraw_key| WS_Server

    %% Shell <-> Kernel & Executables
    PTY_Master <--> PTY_Slave
    PTY_Slave <--> GCU_Driver
    PTY_Slave <--> Client_Bin
    SessionMgr -.->|Daemon Lifecycle Supervision| Server_Bin
```

---

## 2. Asynchronous PTY-WebSocket Transport Layer

The transport layer is implemented in [`web/server.py`](file:///data/data/com.termux/files/home/tome238-mobile/web/server.py) using Python's standard `asyncio` and the `websockets` library.

### 2.1 PTY Spawning and Terminal Supervision
1. **Pseudo-Terminal Pair**: `pty.openpty()` creates a master/slave file descriptor pair.
2. **Window Geometry Pinned**: The slave FD is configured to 80 columns by 24 rows using `termios.TIOCSWINSZ`:
   ```python
   fcntl.ioctl(slave_fd, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 80, 0, 0))
   ```
3. **Child Process Isolation**: A `fork()` executes `game/tome -mgcu -MToME` in the child process after duplicating `slave_fd` onto standard file descriptors (0, 1, 2) and invoking `os.setsid()`.
4. **Non-Blocking Asynchronous Read**: The parent process closes `slave_fd` and configures `master_fd` with `O_NONBLOCK`. Python's `asyncio.get_running_loop().add_reader(master_fd, self._on_pty_read)` notifies the event loop whenever raw ANSI escape bytes are ready to be read.

### 2.2 64KB Circular Ring Buffer & Seamless Reconnection
Mobile environments suffer from frequent connection dropouts caused by screen locks, app switching, or cellular/Wi-Fi transitions. A naive terminal bridge would either drop the game process or present a blank screen upon reconnect.

```mermaid
sequenceDiagram
    autonumber
    actor Player as Mobile Player
    participant WS as WebSocket Client (app.js)
    participant Srv as PtySession (server.py)
    participant PTY as Linux PTY / ToME Engine

    Note over Player,PTY: Normal Game Session Active
    PTY->>Srv: Emits ANSI VT100 Escape Stream
    Srv->>Srv: Append to 64KB Ring Buffer (bytearray)
    Srv->>WS: Broadcast Raw Bytes
    WS->>Player: Renders Dungeon Map on Xterm.js

    Note over Player,WS: Mobile Screen Locks or Network Drops
    WS--xSrv: Connection Closed (TCP FIN / RST)
    Note over Srv: Session remains alive (300s grace period)
    PTY->>Srv: Engine awaits input in background

    Note over Player,WS: Player Re-opens Browser (Reconnect)
    WS->>Srv: Connect /ws?session=default
    Srv->>Srv: Attach new WebSocket to existing PtySession
    Srv->>WS: Send Cached 64KB Ring Buffer (Immediate Full State)
    Srv->>PTY: Inject '\x12' (Ctrl+R / Terminal Redraw)
    PTY->>Srv: Engine re-emits fresh screen frame
    Srv->>WS: Stream fresh frame
    WS->>Player: Instant Glitch-Free Screen Restoration!
```

- **Ring Buffer Sizing**: `max_buffer_size = 65536` bytes (64KB). Since an 80x24 ASCII terminal screen contains 1,920 cells plus color attributes (~4 to 8KB per full frame), 64KB retains 8 to 15 full historical screen redraws.
- **Reconnection Sequence**:
  1. Client connects to `/ws?session=<id>`.
  2. If the session exists and is alive, the server immediately sends the entire cached `bytearray`.
  3. The server immediately writes `\x12` (`Ctrl+R`, the universal Roguelike terminal redraw keystroke) to the PTY master.
  4. The ToME curses driver redraws the entire window canvas, synchronizing the client without user intervention.
- **Session Lifecycle & Cleanup**: If all clients disconnect, a delayed cleanup task waits 300 seconds (5 minutes). If no client reconnects within that window, the game process is gracefully terminated with `SIGTERM` followed by `SIGKILL`.

---

## 3. Mobile Touch UI & Input Subsystems

The client frontend in [`web/app.js`](file:///data/data/com.termux/files/home/tome238-mobile/web/app.js) and [`web/style.css`](file:///data/data/com.termux/files/home/tome238-mobile/web/style.css) translates mobile touch interactions into precise terminal keystrokes, adapting design patterns from `Cuboideb/angbandroid`.

### 3.1 3x3 Tactile D-Pad with Dual-Stage Auto-Repeat
Traditional roguelikes require diagonal movement (8 directions) and resting. Virtual on-screen joysticks lack accuracy on small touchscreens. We implement a fixed 3x3 tactile button grid:

```
┌───────┬───────┬───────┐
│ ↖ (7) │ ↑ (8) │ ↗ (9) │
├───────┼───────┼───────┤
│ ← (4) │ · (5) │ → (6) │
├───────┼───────┼───────┤
│ ↙ (1) │ ↓ (2) │ ↘ (3) │
└───────┴───────┴───────┘
```

- **Pointer Events**: Uses `pointerdown`, `pointerup`, `pointercancel`, and `pointerleave` for instant touch response without 300ms mobile browser click latency.
- **Haptic Feedback**: Fires `navigator.vibrate(8)` on touch start for tactile confirmation.
- **Dual-Stage Repeat Timing**:
  - `Initial Delay`: 300ms hold required before repeating begins.
  - `Repeat Interval`: Fires repeated directional keystrokes every 75ms (~13 steps/sec) for smooth corridor running.
- **Center Button (`5`)**: Serves as single-turn rest/wait. Long-press repeat is intentionally disabled for safety.

### 3.2 Dynamic Context Sniffer
Text roguelikes frequently prompt the player with binary or directional questions (e.g., `"Die? (y/n)"`, `"Are you sure? (y/n/esc)"`, `"Direction?"`). On a mobile screen, typing `y` or `n` usually requires opening the full OS keyboard, obscuring the prompt.

The **Context Sniffer** solves this:
1. It maintains a sliding buffer of the last 500 characters streamed to the terminal:
   ```javascript
   state.recentScreenText = (state.recentScreenText + chunk).slice(-500);
   ```
2. A regex evaluates incoming text:
   ```javascript
   const isYesNo = /\((y\/n|y\/n\/esc|\[y\/n\])\)/i.test(state.recentScreenText);
   ```
3. When detected, the dynamic ribbon swaps out standard action keys and injects high-contrast, large touch targets:
   - `[✔ Yes (y)]` (Green accent)
   - `[✖ No (n)]` (Red accent)
   - `[⎋ Esc]` (Neutral accent)
4. Once the prompt is resolved and cleared from the terminal buffer, the ribbon automatically restores default roguelike actions.

### 3.3 Modifier State Machine & Movement Prefixing
- **RUN Mode**: In ToME and Angband, prepending a period (`.`) to a directional key activates continuous sprint until an obstacle or monster appears (e.g., `.6` runs east). The `RUN` toggle button sets an active state so touching any D-Pad direction automatically prefixes `.` to the command.
- **Shift / Ctrl Modifiers**: Latching toggles that uppercase the subsequent action keystroke or convert it to ASCII control characters (`Ctrl+A` through `Ctrl+Z`).
- **Ghost Opacity Mode**:
  - `Normal` (State 0): Fully opaque high-contrast keyboard.
  - `Ghost` (State 1): 30% semi-transparent overlay allowing the player to inspect map tiles and messages located underneath the control panel.
  - `Hidden` (State 2): Keyboard slides off-screen, granting 100% full-screen terminal view for long reads or external Bluetooth keyboards.

---

## 4. Responsiveness & Monospace Scaling

ToME 2.3.8-ah requires an exact 80-column by 24-row grid. Partial character clipping breaks alignment of the dungeon map and stats sidebar.

[`adjustTerminalScale()`](file:///data/data/com.termux/files/home/tome238-mobile/web/app.js#L88-L115) dynamically computes optimal font sizing based on available viewport dimensions:
```javascript
const maxFontW = containerWidth / (80 * 0.62);
const maxFontH = containerHeight / (24 * 1.18);
const optimalSize = Math.max(9, Math.floor(Math.min(maxFontW, maxFontH)));
```
This guarantees that whether viewed on a compact 5.8-inch smartphone in portrait mode, a 10-inch tablet, or a desktop browser, the 80x24 grid scales to fit with zero horizontal or vertical clipping.

---

## 5. Declarative Profile Architecture & Seam Specification

The mobile terminal shell ([`web/server.py`](file:///data/data/com.termux/files/home/tome238-mobile/web/server.py) and [`web/app.js`](file:///data/data/com.termux/files/home/tome238-mobile/web/app.js)) is an engine-agnostic PTY streaming platform. The seam between the generic shell and specific game engines is managed entirely by declarative JSON profiles located in [`profiles/`](file:///data/data/com.termux/files/home/tome238-mobile/profiles/).

### 5.1 Profile Schema & Configuration
A profile defines execution environment, metadata, and input adaptations:
```json
{
  "id": "tome238",
  "name": "Tales of Middle-earth 2.3.8-ah",
  "title": "ToME 2.3.8-ah Mobile Terminal",
  "brand": { "logo": "⚡ ToME", "version": "2.3.8-ah" },
  "executable": "game/tome",
  "args": ["-mgcu", "-MToME"],
  "cwd": "game",
  "env": { "TERM": "xterm-256color", "TOME_PATH": "lib", "LANG": "en_US.UTF-8" },
  "geometry": { "cols": 80, "rows": 24 },
  "redraw_key": "\u0012",
  "keyboard_config": "keyboards.json",
  "context_rules": [
    { "type": "yes_no", "pattern": "\\((y\\/n|y\\/n\\/esc|\\[y\\/n\\])\\)" }
  ]
}
```

- **Dynamic Injection**: `web/server.py` serves the active profile via the `GET /api/profile` REST endpoint. Upon loading, `web/app.js` fetches this metadata, dynamically updating the browser tab title, navbar branding, keyboard definitions, and regex sniffer rules.
- **Portability Proof**: Verified with [`scripts/portability_demo.c`](file:///data/data/com.termux/files/home/tome238-mobile/scripts/portability_demo.c) and [`profiles/portability_demo.json`](file:///data/data/com.termux/files/home/tome238-mobile/profiles/portability_demo.json) via [`scripts/test_portability.py`](file:///data/data/com.termux/files/home/tome238-mobile/scripts/test_portability.py), proving that non-ToME terminal applications run flawlessly without editing a single line of web or server code.

---

## 6. Decoupling Audit Checkpoint

Full audit results are documented in [`docs/decoupling_checkpoint.md`](file:///data/data/com.termux/files/home/tome238-mobile/docs/decoupling_checkpoint.md). The codebase was evaluated against a 4-way classification matrix:

| Classification | Meaning | Examples in Codebase | Action Taken |
| :--- | :--- | :--- | :--- |
| **`GENERIC`** | Game-agnostic terminal infrastructure | PTY master/slave allocation, xterm.js auto-fit math, WebSocket event loop | Retained as common host core. |
| **`CONFIG`** | Hardcoded values needing declarative externalization | Game paths, command line args, env vars, UI titles, ribbon buttons | Extracted into `profiles/*.json`. |
| **`ADAPTER`** | Game-specific behaviors requiring strategy wrappers | Redraw keystroke (`Ctrl+R` vs `Ctrl+L`), Run movement syntax (`.` vs `Shift`), Sniffer regex | Parameterized in profiles & handlers. |
| **`LEAVE ALONE`** | Coupling points where abstraction cost exceeds benefits | 80x24 standard geometry, Latin-1 fallback parsing | Preserved as practical roguelike conventions. |

---

## 7. Local Multi-Process Architecture & Feasibility

TomeNET (and similar C/S roguelikes) requires both a server daemon and an interactive client. Feasibility analysis on Android Termux ARM64 is detailed in [`docs/multiprocess_feasibility.md`](file:///data/data/com.termux/files/home/tome238-mobile/docs/multiprocess_feasibility.md):

### 7.1 Verified Feasibility Metrics
- **Build Compatibility**: Compiles cleanly with Termux Clang, `libncursesw`, `libcrypt`, and `libm`.
- **Loopback Socket Latency**: Android kernel `127.0.0.1` loopback latency is `< 0.2ms` with zero non-root permission hurdles.
- **Resource Footprint**: Server + Client combined RSS memory is `< 50MB`, and idle CPU is `< 2%` on typical modern mobile ARM64 SoCs.

### 7.2 Process Supervision Model
```
┌──────────────────────────────────────────────────────────┐
│ Python Transport Shell (server.py)                       │
│  ├─ Supervised Companion Daemon: tomenet.server (127.0.0.1)│
│  └─ Foreground Child PTY:        tomenet -c (GCU Client) │
│      └─ Bidirectional Stream <───> WebSocket (/ws)       │
└──────────────────────────────────────────────────────────┘
```
- **Concealment**: The web client only interacts with the client PTY stream; the background server process is completely transparent to the user.
- **Metaserver Isolation**: `REPORT_TO_METASERVER = false` is enforced in `tomenet.cfg` to prevent advertising single-player local games to the public Internet.
- **Cascading Teardown**: Upon session termination or 300-second idle disconnect, `server.py` guarantees clean shutdown of both processes (`SIGTERM` -> 200ms grace -> `SIGKILL`).

---

## 8. Architectural Cross-References

- **Decoupling Audit & Checkpoint**: [`docs/decoupling_checkpoint.md`](file:///data/data/com.termux/files/home/tome238-mobile/docs/decoupling_checkpoint.md)
- **Local Multi-Process (TomeNET) Feasibility Study**: [`docs/multiprocess_feasibility.md`](file:///data/data/com.termux/files/home/tome238-mobile/docs/multiprocess_feasibility.md)
- **Mobile Keyboard Detailed Specification**: [`docs/mobile_keyboard_spec.md`](file:///data/data/com.termux/files/home/tome238-mobile/docs/mobile_keyboard_spec.md)
- **TomeNET Runecraft Archeology & Bitmask Mechanics**: [`docs/tomenet_runecraft_spec.md`](file:///data/data/com.termux/files/home/tome238-mobile/docs/tomenet_runecraft_spec.md)
- **Semantic Mapping of Runecraft into ToME 2.3.8-ah**: [`docs/runecraft_mapping.md`](file:///data/data/com.termux/files/home/tome238-mobile/docs/runecraft_mapping.md)
- **Runecraft Vertical Slice Prototype (Lua MVP)**: [`docs/runecraft_vertical_slice_spec.md`](file:///data/data/com.termux/files/home/tome238-mobile/docs/runecraft_vertical_slice_spec.md)
- **Gameplay Changes & Adventurer Class Specification**: [`docs/gameplay_changes.md`](file:///data/data/com.termux/files/home/tome238-mobile/docs/gameplay_changes.md)
- **Native Termux Build Guide**: [`docs/build_guide.md`](file:///data/data/com.termux/files/home/tome238-mobile/docs/build_guide.md)
- **Operational Guidelines for AI Agents**: [`AGENTS.md`](file:///data/data/com.termux/files/home/tome238-mobile/AGENTS.md)


