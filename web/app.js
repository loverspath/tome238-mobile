/**
 * ToME 2.3.8-ah Mobile Web Client Controller
 * Full 108-Key PC Keyboard & Angbandroid Adaptive Viewport
 */

(function () {
  'use strict';

  // --- Constants & Key Mappings ---
  const PROFILES = ['full108', 'default', 'numpad', 'minimal'];
  const PROFILE_LABELS = {
    full108: '⌨ PC 108 Key',
    default: '⌨ Roguelike',
    numpad: '⌨ NumPad',
    minimal: '⌨ Minimal'
  };

  const SHIFT_MAP = {
    '`': '~', '1': '!', '2': '@', '3': '#', '4': '$', '5': '%',
    '6': '^', '7': '&', '8': '*', '9': '(', '0': ')', '-': '_', '=': '+',
    '[': '{', ']': '}', '\\': '|', ';': ':', "'": '"', ',': '<', '.': '>', '/': '?'
  };

  const SPECIAL_KEYS = {
    'F1': '\x1bOP', 'F2': '\x1bOQ', 'F3': '\x1bOR', 'F4': '\x1bOS',
    'F5': '\x1b[15~', 'F6': '\x1b[17~', 'F7': '\x1b[18~', 'F8': '\x1b[19~',
    'F9': '\x1b[20~', 'F10': '\x1b[21~', 'F11': '\x1b[23~', 'F12': '\x1b[24~',
    'Up': '\x1b[A', 'Down': '\x1b[B', 'Right': '\x1b[C', 'Left': '\x1b[D',
    'Home': '\x1b[H', 'End': '\x1b[F', 'Insert': '\x1b[2~', 'Delete': '\x1b[3~',
    'PgUp': '\x1b[5~', 'PgDn': '\x1b[6~',
    'Esc': '\x1b', 'Tab': '\t', 'Enter': '\r', 'BS': '\x7f', 'Space': ' '
  };

  // --- State ---
  const state = {
    ws: null,
    term: null,
    fitAddon: null,
    reconnectTimer: null,
    profile: localStorage.getItem('tome_kb_profile') || 'full108',
    dockMode: localStorage.getItem('tome_dock_mode') || 'docked', // 'docked' | 'overlap'
    activeLayer: 'qwerty', // 'qwerty' | 'fn_nav' | 'symbols' | 'numpad'
    shift: false,
    ctrl: false,
    alt: false,
    run: false,
    opacityState: 0, // 0: Normal (1.0), 1: Ghost (0.35), 2: Hidden (0.0)
    activeRepeatTimer: null,
    activeRepeatInterval: null,
    idleTimer: null,
    recentScreenText: '',
    lastCols: 80,
    lastRows: 24
  };

  // --- DOM Elements ---
  const elApp = document.getElementById('app');
  const elStatus = document.getElementById('conn-status');
  const elBtnProfile = document.getElementById('btn-profile');
  const elBtnDock = document.getElementById('btn-dock');
  const elBtnGhost = document.getElementById('btn-ghost');
  const elBtnRestart = document.getElementById('btn-restart');
  const elKeyboardPanel = document.getElementById('keyboard-panel');
  const elRibbonBar = document.getElementById('ribbon-bar');
  const elDynamicRibbon = document.getElementById('dynamic-ribbon');
  const elTerminalWrapper = document.getElementById('terminal-wrapper');

  const defaultDynamicRibbonHTML = elDynamicRibbon.innerHTML;

  // --- Terminal Initialization & Viewport Auto-Fitter ---
  function initTerminal() {
    const term = new Terminal({
      cols: 80,
      rows: 24,
      cursorBlink: false,
      fontFamily: '"DejaVu Sans Mono", "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.15,
      theme: {
        background: '#000000',
        foreground: '#ffffff',
        cursor: '#e69a28',
        black: '#000000',
        red: '#c00000',
        green: '#008000',
        yellow: '#c08000',
        blue: '#0000c0',
        magenta: '#c000c0',
        cyan: '#00c0c0',
        white: '#c0c0c0',
        brightBlack: '#606060',
        brightRed: '#ff0000',
        brightGreen: '#00ff00',
        brightYellow: '#ffff00',
        brightBlue: '#0000ff',
        brightMagenta: '#ff00ff',
        brightCyan: '#00ffff',
        brightWhite: '#ffffff'
      }
    });

    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(document.getElementById('terminal'));

    // Handle physical keyboard input
    term.onData(data => {
      resetIdleTimer();
      sendRaw(data);
    });

    state.term = term;
    state.fitAddon = fitAddon;

    const resizeObserver = new ResizeObserver(() => {
      adjustTerminalScale();
    });
    resizeObserver.observe(elTerminalWrapper);

    window.addEventListener('resize', () => {
      adjustTerminalScale();
    });
    window.addEventListener('orientationchange', () => {
      setTimeout(adjustTerminalScale, 150);
    });

    adjustTerminalScale();
  }

  /**
   * Angbandroid-style Math-based Viewport Auto-scaler
   */
  function adjustTerminalScale() {
    if (!state.fitAddon || !state.term) return;

    const cw = elTerminalWrapper.clientWidth - 4;
    const ch = elTerminalWrapper.clientHeight - 4;
    if (cw <= 0 || ch <= 0) return;

    const isPortrait = window.innerHeight > window.innerWidth;
    const charAspect = 0.58; // Monospace width/height ratio
    const lineHeight = 1.15;

    let optimalFontSize;
    if (isPortrait) {
      // Width-bound: 80 columns must strictly fit container width
      optimalFontSize = Math.floor(cw / (80 * charAspect));
    } else {
      // Height-bound: 24 rows must strictly fit container height
      optimalFontSize = Math.floor(ch / (24 * lineHeight));
    }

    // Clamp between 8px and 28px
    optimalFontSize = Math.max(8, Math.min(28, optimalFontSize));

    if (state.term.options.fontSize !== optimalFontSize) {
      state.term.options.fontSize = optimalFontSize;
    }

    try {
      state.fitAddon.fit();
    } catch (e) {}

    const cols = Math.max(80, state.term.cols || 80);
    const rows = Math.max(24, state.term.rows || 24);
    if (cols !== state.lastCols || rows !== state.lastRows) {
      state.lastCols = cols;
      state.lastRows = rows;
      sendJSON({ type: 'resize', cols, rows });
    }
  }

  // --- WebSocket Connection ---
  function connectWebSocket() {
    if (state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/ws?session=tome_default`;

    updateStatus('Connecting...', false);
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      updateStatus('Connected', true);
      sendJSON({ type: 'resize', cols: state.lastCols, rows: state.lastRows });
      adjustTerminalScale();
    };

    ws.onmessage = (event) => {
      let text = '';
      if (typeof event.data === 'string') {
        if (event.data.startsWith('{')) {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'exit') {
              state.term.write('\r\n\x1b[33m[Game process exited. Tap ↺ to restart.]\x1b[0m\r\n');
              return;
            }
          } catch (e) {}
        }
        text = event.data;
        state.term.write(text);
      } else {
        const u8 = new Uint8Array(event.data);
        text = new TextDecoder('latin1').decode(u8);
        state.term.write(u8);
      }

      inspectScreenForContext(text);
    };

    ws.onclose = () => {
      updateStatus('Disconnected', false);
      scheduleReconnect();
    };

    ws.onerror = () => {
      ws.close();
    };

    state.ws = ws;
  }

  function scheduleReconnect() {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = setTimeout(() => {
      connectWebSocket();
    }, 2000);
  }

  function updateStatus(text, isConnected) {
    elStatus.textContent = text;
    elStatus.className = 'status-indicator ' + (isConnected ? 'connected' : 'disconnected');
  }

  function sendRaw(data) {
    resetIdleTimer();
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(data);
    }
  }

  function sendJSON(obj) {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify(obj));
    }
  }

  // --- Haptic & Input Resolution ---
  function haptic() {
    if (navigator.vibrate) {
      try { navigator.vibrate(10); } catch (e) {}
    }
  }

  function parseEscapes(str) {
    return str
      .replace(/\\e/g, '\x1b')
      .replace(/\\n/g, '\r')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\b/g, '\x7f')
      .replace(/\\s/g, ' ');
  }

  function resolveKeyAction(action) {
    // If it's a special function/nav key
    if (SPECIAL_KEYS[action]) {
      let code = SPECIAL_KEYS[action];
      if (state.alt) {
        code = '\x1b' + code;
        state.alt = false;
        updateModifierButtons();
      }
      return code;
    }

    let output = parseEscapes(action);

    // Apply Shift
    if (state.shift) {
      if (SHIFT_MAP[output]) {
        output = SHIFT_MAP[output];
      } else {
        output = output.toUpperCase();
      }
      state.shift = false;
      updateModifierButtons();
      updateQwertyKeyLabels();
    }

    // Apply Ctrl
    if (state.ctrl) {
      if (output.length === 1) {
        const code = output.toUpperCase().charCodeAt(0);
        if (code >= 64 && code <= 95) {
          output = String.fromCharCode(code - 64);
        }
      }
      state.ctrl = false;
      updateModifierButtons();
    }

    // Apply Alt
    if (state.alt) {
      output = '\x1b' + output;
      state.alt = false;
      updateModifierButtons();
    }

    return output;
  }

  function handleDirection(dir) {
    haptic();
    let cmd = dir;
    if (state.run || state.shift) {
      cmd = '.' + dir;
      if (state.shift) {
        state.shift = false;
        updateModifierButtons();
        updateQwertyKeyLabels();
      }
    }
    sendRaw(cmd);
  }

  function updateModifierButtons() {
    document.querySelectorAll('.mod-shift').forEach(b => b.classList.toggle('active', state.shift));
    document.querySelectorAll('.mod-ctrl').forEach(b => b.classList.toggle('active', state.ctrl));
    document.querySelectorAll('.mod-alt').forEach(b => b.classList.toggle('active', state.alt));
    document.querySelectorAll('.mod-run').forEach(b => b.classList.toggle('active', state.run));
  }

  function updateQwertyKeyLabels() {
    const keys = elKeyboardPanel.querySelectorAll('.pc-key[data-base-char]');
    keys.forEach(k => {
      const base = k.getAttribute('data-base-char');
      const sub = k.getAttribute('data-sub-char') || '';
      if (state.shift) {
        const shifted = SHIFT_MAP[base] || base.toUpperCase();
        k.childNodes[0].nodeValue = shifted;
      } else {
        k.childNodes[0].nodeValue = base;
      }
    });
  }

  // --- Keyboard Profiles & Layer Rendering ---
  function renderKeyboard() {
    elKeyboardPanel.innerHTML = '';
    elApp.classList.remove('profile-full108', 'profile-default', 'profile-numpad', 'profile-minimal');
    elApp.classList.add(`profile-${state.profile}`);

    elBtnProfile.textContent = PROFILE_LABELS[state.profile] || '⌨ Profile';

    if (state.profile === 'full108') {
      renderFull108Profile();
    } else if (state.profile === 'default') {
      renderDefaultProfile();
    } else if (state.profile === 'numpad') {
      renderNumpadProfile();
    } else if (state.profile === 'minimal') {
      renderMinimalProfile();
    }

    bindTouchListeners();
    adjustTerminalScale();
  }

  /**
   * [1] Full 108 PC Keyboard with Layer Tabs & F-Keys
   */
  function renderFull108Profile() {
    elKeyboardPanel.innerHTML = `
      <!-- Layer Tabs Switcher -->
      <div class="kbd-layer-tabs">
        <button class="layer-tab-btn ${state.activeLayer === 'qwerty' ? 'active' : ''}" data-layer="qwerty">⌨ QWERTY</button>
        <button class="layer-tab-btn ${state.activeLayer === 'fn_nav' ? 'active' : ''}" data-layer="fn_nav">⚡ Fn & Nav</button>
        <button class="layer-tab-btn ${state.activeLayer === 'symbols' ? 'active' : ''}" data-layer="symbols">#@! Symbols</button>
        <button class="layer-tab-btn ${state.activeLayer === 'numpad' ? 'active' : ''}" data-layer="numpad">⚄ NumPad</button>
      </div>

      <!-- F-Keys Quick Bar (F1 ~ F12 + Esc + Edit) -->
      <div class="fkeys-toolbar">
        <button class="fkey-btn esc-btn" data-key="Esc">⎋ Esc</button>
        <button class="fkey-btn" data-key="F1">F1</button>
        <button class="fkey-btn" data-key="F2">F2</button>
        <button class="fkey-btn" data-key="F3">F3</button>
        <button class="fkey-btn" data-key="F4">F4</button>
        <button class="fkey-btn" data-key="F5">F5</button>
        <button class="fkey-btn" data-key="F6">F6</button>
        <button class="fkey-btn" data-key="F7">F7</button>
        <button class="fkey-btn" data-key="F8">F8</button>
        <button class="fkey-btn" data-key="F9">F9</button>
        <button class="fkey-btn" data-key="F10">F10</button>
        <button class="fkey-btn" data-key="F11">F11</button>
        <button class="fkey-btn" data-key="F12">F12</button>
        <button class="fkey-btn" data-key="Tab">⇥ Tab</button>
        <button class="fkey-btn" data-key="BS">⌫ BS</button>
      </div>

      <!-- Layer 1: Full QWERTY -->
      <div id="layer-qwerty" class="layer-body ${state.activeLayer === 'qwerty' ? '' : 'hidden-layer'}">
        <!-- Row 1: Numbers & Symbols -->
        <div class="pc-key-row">
          <button class="pc-key" data-key="\`" data-base-char="\`" data-sub-char="~">\`<span class="sub-char">~</span></button>
          <button class="pc-key" data-key="1" data-base-char="1" data-sub-char="!">1<span class="sub-char">!</span></button>
          <button class="pc-key" data-key="2" data-base-char="2" data-sub-char="@">2<span class="sub-char">@</span></button>
          <button class="pc-key" data-key="3" data-base-char="3" data-sub-char="#">3<span class="sub-char">#</span></button>
          <button class="pc-key" data-key="4" data-base-char="4" data-sub-char="$">4<span class="sub-char">$</span></button>
          <button class="pc-key" data-key="5" data-base-char="5" data-sub-char="%">5<span class="sub-char">%</span></button>
          <button class="pc-key" data-key="6" data-base-char="6" data-sub-char="^">6<span class="sub-char">^</span></button>
          <button class="pc-key" data-key="7" data-base-char="7" data-sub-char="&">7<span class="sub-char">&</span></button>
          <button class="pc-key" data-key="8" data-base-char="8" data-sub-char="*">8<span class="sub-char">*</span></button>
          <button class="pc-key" data-key="9" data-base-char="9" data-sub-char="(">9<span class="sub-char">(</span></button>
          <button class="pc-key" data-key="0" data-base-char="0" data-sub-char=")">0<span class="sub-char">)</span></button>
          <button class="pc-key" data-key="-" data-base-char="-" data-sub-char="_">-<span class="sub-char">_</span></button>
          <button class="pc-key" data-key="=" data-base-char="=" data-sub-char="+">=<span class="sub-char">+</span></button>
          <button class="pc-key flex-12" data-key="BS">⌫</button>
        </div>

        <!-- Row 2: QWERTY Row -->
        <div class="pc-key-row">
          <button class="pc-key flex-12" data-key="Tab">Tab</button>
          <button class="pc-key" data-key="q" data-base-char="q">q</button>
          <button class="pc-key" data-key="w" data-base-char="w">w</button>
          <button class="pc-key" data-key="e" data-base-char="e">e</button>
          <button class="pc-key" data-key="r" data-base-char="r">r</button>
          <button class="pc-key" data-key="t" data-base-char="t">t</button>
          <button class="pc-key" data-key="y" data-base-char="y">y</button>
          <button class="pc-key" data-key="u" data-base-char="u">u</button>
          <button class="pc-key" data-key="i" data-base-char="i">i</button>
          <button class="pc-key" data-key="o" data-base-char="o">o</button>
          <button class="pc-key" data-key="p" data-base-char="p">p</button>
          <button class="pc-key" data-key="[" data-base-char="[" data-sub-char="{">[<span class="sub-char">{</span></button>
          <button class="pc-key" data-key="]" data-base-char="]" data-sub-char="}">]<span class="sub-char">}</span></button>
          <button class="pc-key" data-key="\\" data-base-char="\\" data-sub-char="|">\\<span class="sub-char">|</span></button>
        </div>

        <!-- Row 3: ASDF Row -->
        <div class="pc-key-row">
          <button class="pc-key mod-key mod-ctrl flex-12" data-mod="ctrl">Ctrl</button>
          <button class="pc-key" data-key="a" data-base-char="a">a</button>
          <button class="pc-key" data-key="s" data-base-char="s">s</button>
          <button class="pc-key" data-key="d" data-base-char="d">d</button>
          <button class="pc-key" data-key="f" data-base-char="f">f</button>
          <button class="pc-key" data-key="g" data-base-char="g">g</button>
          <button class="pc-key" data-key="h" data-base-char="h">h</button>
          <button class="pc-key" data-key="j" data-base-char="j">j</button>
          <button class="pc-key" data-key="k" data-base-char="k">k</button>
          <button class="pc-key" data-key="l" data-base-char="l">l</button>
          <button class="pc-key" data-key=";" data-base-char=";" data-sub-char=":">;<span class="sub-char">:</span></button>
          <button class="pc-key" data-key="'" data-base-char="'" data-sub-char="&quot;">'<span class="sub-char">"</span></button>
          <button class="pc-key enter-key flex-16" data-key="Enter">⏎ Ret</button>
        </div>

        <!-- Row 4: ZXCV Row -->
        <div class="pc-key-row">
          <button class="pc-key mod-key mod-shift flex-14" data-mod="shift">⇧ Shift</button>
          <button class="pc-key" data-key="z" data-base-char="z">z</button>
          <button class="pc-key" data-key="x" data-base-char="x">x</button>
          <button class="pc-key" data-key="c" data-base-char="c">c</button>
          <button class="pc-key" data-key="v" data-base-char="v">v</button>
          <button class="pc-key" data-key="b" data-base-char="b">b</button>
          <button class="pc-key" data-key="n" data-base-char="n">n</button>
          <button class="pc-key" data-key="m" data-base-char="m">m</button>
          <button class="pc-key" data-key="," data-base-char="," data-sub-char="&lt;">,<span class="sub-char">&lt;</span></button>
          <button class="pc-key" data-key="." data-base-char="." data-sub-char="&gt;">.<span class="sub-char">&gt;</span></button>
          <button class="pc-key" data-key="/" data-base-char="/" data-sub-char="?">/<span class="sub-char">?</span></button>
          <button class="pc-key mod-key mod-shift flex-14" data-mod="shift">⇧ Shift</button>
        </div>

        <!-- Row 5: Modifiers, Space, Directions -->
        <div class="pc-key-row">
          <button class="pc-key mod-key mod-alt flex-12" data-mod="alt">Alt</button>
          <button class="pc-key mod-key run-key mod-run flex-12" data-mod="run">⚡ RUN</button>
          <button class="pc-key space-key" data-key="Space">␣ Space</button>
          <button class="pc-key" data-dir="4">←</button>
          <button class="pc-key" data-dir="2">↓</button>
          <button class="pc-key" data-dir="8">↑</button>
          <button class="pc-key" data-dir="6">→</button>
        </div>
      </div>

      <!-- Layer 2: Fn & Navigation -->
      <div id="layer-fn-nav" class="layer-body ${state.activeLayer === 'fn_nav' ? '' : 'hidden-layer'}">
        <div class="fn-grid">
          <button class="pc-key" data-key="F1">F1</button>
          <button class="pc-key" data-key="F2">F2</button>
          <button class="pc-key" data-key="F3">F3</button>
          <button class="pc-key" data-key="F4">F4</button>
          <button class="pc-key" data-key="F5">F5</button>
          <button class="pc-key" data-key="F6">F6</button>
          <button class="pc-key" data-key="F7">F7</button>
          <button class="pc-key" data-key="F8">F8</button>
          <button class="pc-key" data-key="F9">F9</button>
          <button class="pc-key" data-key="F10">F10</button>
          <button class="pc-key" data-key="F11">F11</button>
          <button class="pc-key" data-key="F12">F12</button>
        </div>
        <div class="nav-grid">
          <button class="pc-key esc-key" data-key="Esc">⎋ Esc</button>
          <button class="pc-key" data-key="Insert">Insert</button>
          <button class="pc-key" data-key="Home">Home</button>
          <button class="pc-key" data-key="PgUp">PgUp</button>
          <button class="pc-key enter-key" data-key="Enter">⏎ Enter</button>
          <button class="pc-key" data-key="Delete">Delete</button>
          <button class="pc-key" data-key="End">End</button>
          <button class="pc-key" data-key="PgDn">PgDn</button>
        </div>
      </div>

      <!-- Layer 3: Complete Symbols Grid -->
      <div id="layer-symbols" class="layer-body ${state.activeLayer === 'symbols' ? '' : 'hidden-layer'}">
        <button class="pc-key symbol-key" data-key="!">!</button>
        <button class="pc-key symbol-key" data-key="&quot;">"</button>
        <button class="pc-key symbol-key" data-key="#">#</button>
        <button class="pc-key symbol-key" data-key="$">$</button>
        <button class="pc-key symbol-key" data-key="%">%</button>
        <button class="pc-key symbol-key" data-key="&amp;">&amp;</button>
        <button class="pc-key symbol-key" data-key="'">'</button>
        <button class="pc-key symbol-key" data-key="(">(</button>
        <button class="pc-key symbol-key" data-key=")">)</button>
        <button class="pc-key symbol-key" data-key="*">*</button>
        <button class="pc-key symbol-key" data-key="+">+</button>
        <button class="pc-key symbol-key" data-key=",">,</button>
        <button class="pc-key symbol-key" data-key="-">-</button>
        <button class="pc-key symbol-key" data-key=".">.</button>
        <button class="pc-key symbol-key" data-key="/">/</button>
        <button class="pc-key symbol-key" data-key=":">:</button>
        <button class="pc-key symbol-key" data-key=";">;</button>
        <button class="pc-key symbol-key" data-key="&lt;">&lt;</button>
        <button class="pc-key symbol-key" data-key="=">=</button>
        <button class="pc-key symbol-key" data-key="&gt;">&gt;</button>
        <button class="pc-key symbol-key" data-key="?">?</button>
        <button class="pc-key symbol-key" data-key="@">@</button>
        <button class="pc-key symbol-key" data-key="[">[</button>
        <button class="pc-key symbol-key" data-key="\\">\\</button>
        <button class="pc-key symbol-key" data-key="]">]</button>
        <button class="pc-key symbol-key" data-key="^">^</button>
        <button class="pc-key symbol-key" data-key="_">_</button>
        <button class="pc-key symbol-key" data-key="\`">\`</button>
        <button class="pc-key symbol-key" data-key="{">{</button>
        <button class="pc-key symbol-key" data-key="|">|</button>
        <button class="pc-key symbol-key" data-key="}">}</button>
        <button class="pc-key symbol-key" data-key="~">~</button>
      </div>

      <!-- Layer 4: PC 4x4 Numpad -->
      <div id="layer-numpad" class="layer-body ${state.activeLayer === 'numpad' ? '' : 'hidden-layer'}">
        <div class="numpad-tools-left">
          <div class="pc-key-row">
            <button class="pc-key esc-key" data-key="Esc">⎋ Esc</button>
            <button class="pc-key enter-key" data-key="Enter">⏎ Ret</button>
          </div>
          <div class="pc-key-row">
            <button class="pc-key mod-key mod-shift" data-mod="shift">⇧ Shift</button>
            <button class="pc-key mod-key run-key mod-run" data-mod="run">⚡ RUN</button>
          </div>
          <div class="pc-key-row">
            <button class="pc-key" data-key="i">🎒 Inv</button>
            <button class="pc-key macro-btn" data-key="R&\\n">💤 Rest</button>
          </div>
          <div class="pc-key-row">
            <button class="pc-key" data-key="M">🗺 Map</button>
            <button class="pc-key" data-key="*">🎯 Trgt</button>
          </div>
        </div>
        <div class="numpad-keys-right">
          <button class="numpad-key-btn" data-dir="7">7<span class="arrow-sub">↖</span></button>
          <button class="numpad-key-btn" data-dir="8">8<span class="arrow-sub">↑</span></button>
          <button class="numpad-key-btn" data-dir="9">9<span class="arrow-sub">↗</span></button>
          <button class="numpad-key-btn" data-key="/">/</button>

          <button class="numpad-key-btn" data-dir="4">4<span class="arrow-sub">←</span></button>
          <button class="numpad-key-btn" data-dir="5">5<span class="arrow-sub">·</span></button>
          <button class="numpad-key-btn" data-dir="6">6<span class="arrow-sub">→</span></button>
          <button class="numpad-key-btn" data-key="*">*</button>

          <button class="numpad-key-btn" data-dir="1">1<span class="arrow-sub">↙</span></button>
          <button class="numpad-key-btn" data-dir="2">2<span class="arrow-sub">↓</span></button>
          <button class="numpad-key-btn" data-dir="3">3<span class="arrow-sub">↘</span></button>
          <button class="numpad-key-btn" data-key="-">-</button>

          <button class="numpad-key-btn" data-key="0">0</button>
          <button class="numpad-key-btn" data-key=".">.</button>
          <button class="numpad-key-btn enter-key" data-key="Enter">⏎</button>
          <button class="numpad-key-btn" data-key="+">+</button>
        </div>
      </div>
    `;

    // Layer tab click handlers
    const tabs = elKeyboardPanel.querySelectorAll('.layer-tab-btn');
    tabs.forEach(tab => {
      tab.addEventListener('click', (e) => {
        haptic();
        resetIdleTimer();
        const targetLayer = tab.getAttribute('data-layer');
        state.activeLayer = targetLayer;

        tabs.forEach(t => t.classList.toggle('active', t.getAttribute('data-layer') === targetLayer));
        const layers = elKeyboardPanel.querySelectorAll('.layer-body');
        layers.forEach(l => l.classList.toggle('hidden-layer', l.id !== `layer-${targetLayer}`));
      });
    });

    updateModifierButtons();
  }

  /**
   * [2] Roguelike Default Profile
   */
  function renderDefaultProfile() {
    elKeyboardPanel.innerHTML = `
      <div style="display:flex;width:100%;height:100%;gap:6px;">
        <div class="action-grid" style="flex:1;display:flex;flex-direction:column;gap:3px;">
          <div class="pc-key-row">
            <button class="pc-key mod-key mod-shift" data-mod="shift">⇧ Shift</button>
            <button class="pc-key mod-key mod-ctrl" data-mod="ctrl">^ Ctrl</button>
            <button class="pc-key mod-key run-key mod-run" data-mod="run">⚡ RUN</button>
          </div>
          <div class="pc-key-row">
            <button class="pc-key" data-key=".">· Wait</button>
            <button class="pc-key" data-key=",">, Stay</button>
            <button class="pc-key" data-key="?">? Help</button>
          </div>
          <div class="pc-key-row">
            <button class="pc-key" data-key="<">&lt; Up</button>
            <button class="pc-key" data-key=">">&gt; Down</button>
            <button class="pc-key" data-key="0">0 Rpt</button>
          </div>
          <div class="pc-key-row">
            <button class="pc-key" data-key="c">c Close</button>
            <button class="pc-key" data-key="o">o Open</button>
            <button class="pc-key" data-key="B">B Bash</button>
          </div>
        </div>

        <div class="dpad-grid" style="width:175px;min-width:175px;display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr);gap:4px;">
          <button class="dpad-btn diag" data-dir="7">↖<span class="num">7</span></button>
          <button class="dpad-btn cardinal" data-dir="8">↑<span class="num">8</span></button>
          <button class="dpad-btn diag" data-dir="9">↗<span class="num">9</span></button>

          <button class="dpad-btn cardinal" data-dir="4">←<span class="num">4</span></button>
          <button class="dpad-btn center" data-dir="5">·<span class="num">5</span></button>
          <button class="dpad-btn cardinal" data-dir="6">→<span class="num">6</span></button>

          <button class="dpad-btn diag" data-dir="1">↙<span class="num">1</span></button>
          <button class="dpad-btn cardinal" data-dir="2">↓<span class="num">2</span></button>
          <button class="dpad-btn diag" data-dir="3">↘<span class="num">3</span></button>
        </div>
      </div>
    `;
    updateModifierButtons();
  }

  /**
   * [3] Numpad Focused Profile
   */
  function renderNumpadProfile() {
    elKeyboardPanel.innerHTML = `
      <div style="display:flex;width:100%;height:100%;gap:6px;">
        <div class="numpad-tools-left" style="flex:0 0 38%;display:flex;flex-direction:column;gap:3px;">
          <div class="pc-key-row">
            <button class="pc-key esc-key" data-key="Esc">⎋ Esc</button>
            <button class="pc-key enter-key" data-key="Enter">⏎ Ret</button>
          </div>
          <div class="pc-key-row">
            <button class="pc-key mod-key mod-shift" data-mod="shift">⇧ Shift</button>
            <button class="pc-key mod-key run-key mod-run" data-mod="run">⚡ RUN</button>
          </div>
          <div class="pc-key-row">
            <button class="pc-key" data-key="i">🎒 Inv</button>
            <button class="pc-key macro-btn" data-key="R&\\n">💤 Rest</button>
          </div>
          <div class="pc-key-row">
            <button class="pc-key" data-key="M">🗺 Map</button>
            <button class="pc-key" data-key="*">🎯 Trgt</button>
          </div>
        </div>

        <div class="numpad-keys-right" style="flex:1 1 62%;display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(4,1fr);gap:4px;">
          <button class="numpad-key-btn" data-dir="7">7<span class="arrow-sub">↖</span></button>
          <button class="numpad-key-btn" data-dir="8">8<span class="arrow-sub">↑</span></button>
          <button class="numpad-key-btn" data-dir="9">9<span class="arrow-sub">↗</span></button>

          <button class="numpad-key-btn" data-dir="4">4<span class="arrow-sub">←</span></button>
          <button class="numpad-key-btn" data-dir="5">5<span class="arrow-sub">·</span></button>
          <button class="numpad-key-btn" data-dir="6">6<span class="arrow-sub">→</span></button>

          <button class="numpad-key-btn" data-dir="1">1<span class="arrow-sub">↙</span></button>
          <button class="numpad-key-btn" data-dir="2">2<span class="arrow-sub">↓</span></button>
          <button class="numpad-key-btn" data-dir="3">3<span class="arrow-sub">↘</span></button>

          <button class="numpad-key-btn" data-key="0">0<span class="arrow-sub">Rpt</span></button>
          <button class="numpad-key-btn" data-key=".">.<span class="arrow-sub">Wait</span></button>
          <button class="numpad-key-btn" data-key="BS">⌫<span class="arrow-sub">BS</span></button>
        </div>
      </div>
    `;
    updateModifierButtons();
  }

  /**
   * [4] Minimal Ribbon Profile
   */
  function renderMinimalProfile() {
    // Hidden via CSS
  }

  // --- Dock / Overlap Mode Management ---
  function applyDockMode(mode) {
    state.dockMode = mode;
    localStorage.setItem('tome_dock_mode', mode);

    elApp.classList.remove('docked-mode', 'overlap-mode');
    elApp.classList.add(`${mode}-mode`);

    if (mode === 'docked') {
      elBtnDock.textContent = '⇱ Dock';
      elBtnDock.title = 'Current: Docked (Tap for Overlap)';
    } else {
      elBtnDock.textContent = '⇲ Overlap';
      elBtnDock.title = 'Current: Overlap (Tap for Docked)';
    }

    resetIdleTimer();
    adjustTerminalScale();
  }

  function resetIdleTimer() {
    if (state.dockMode !== 'overlap') return;

    elApp.classList.remove('idle-dim');
    clearTimeout(state.idleTimer);

    // Dim keyboard after 5 seconds of inactivity in overlap mode
    state.idleTimer = setTimeout(() => {
      if (state.dockMode === 'overlap') {
        elApp.classList.add('idle-dim');
      }
    }, 5000);
  }

  // --- Context Sniffer ---
  let contextMode = 'normal';

  function inspectScreenForContext(chunk) {
    state.recentScreenText = (state.recentScreenText + chunk).slice(-500);

    const isYesNo = /\((y\/n|y\/n\/esc|\[y\/n\])\)/i.test(state.recentScreenText);

    if (isYesNo && contextMode !== 'yes_no') {
      contextMode = 'yes_no';
      elDynamicRibbon.innerHTML = `
        <button class="ribbon-btn esc-btn" data-key="Esc">⎋ Esc</button>
        <button class="ribbon-btn" style="background:#ef4444;color:#fff;" data-key="n">✖ No (n)</button>
        <button class="ribbon-btn" style="background:#10b981;color:#fff;" data-key="y">✔ Yes (y)</button>
      `;
    } else if (!isYesNo && contextMode === 'yes_no') {
      contextMode = 'normal';
      elDynamicRibbon.innerHTML = defaultDynamicRibbonHTML;
    }
  }

  // --- Event Handling & Touch Listeners ---
  function bindTouchListeners() {
    // Direction Pad & Numpad pointer repeat
    const dirButtons = elKeyboardPanel.querySelectorAll('[data-dir]');
    dirButtons.forEach(btn => {
      const dir = btn.getAttribute('data-dir');

      const startHold = (e) => {
        e.preventDefault();
        resetIdleTimer();
        btn.classList.add('active');
        handleDirection(dir);

        clearTimeout(state.activeRepeatTimer);
        clearInterval(state.activeRepeatInterval);

        if (dir !== '5') {
          state.activeRepeatTimer = setTimeout(() => {
            state.activeRepeatInterval = setInterval(() => {
              handleDirection(dir);
            }, 75);
          }, 280);
        }
      };

      const endHold = () => {
        btn.classList.remove('active');
        clearTimeout(state.activeRepeatTimer);
        clearInterval(state.activeRepeatInterval);
      };

      btn.addEventListener('pointerdown', startHold);
      btn.addEventListener('pointerup', endHold);
      btn.addEventListener('pointercancel', endHold);
      btn.addEventListener('pointerleave', endHold);
    });
  }

  function setupControls() {
    // Profile Switcher Button
    elBtnProfile.addEventListener('click', () => {
      haptic();
      resetIdleTimer();
      const nextIdx = (PROFILES.indexOf(state.profile) + 1) % PROFILES.length;
      state.profile = PROFILES[nextIdx];
      localStorage.setItem('tome_kb_profile', state.profile);
      renderKeyboard();
    });

    // Dock / Overlap Mode Toggle Button
    elBtnDock.addEventListener('click', () => {
      haptic();
      const nextMode = state.dockMode === 'docked' ? 'overlap' : 'docked';
      applyDockMode(nextMode);
    });

    // Ghost / Opacity Button
    elBtnGhost.addEventListener('click', () => {
      haptic();
      resetIdleTimer();
      state.opacityState = (state.opacityState + 1) % 3;
      elKeyboardPanel.classList.remove('ghost', 'hidden-panel');
      if (state.opacityState === 1) {
        elKeyboardPanel.classList.add('ghost');
      } else if (state.opacityState === 2) {
        elKeyboardPanel.classList.add('hidden-panel');
      }
      adjustTerminalScale();
    });

    // Game Restart
    elBtnRestart.addEventListener('click', () => {
      if (confirm('Restart game session?')) {
        sendJSON({ type: 'restart' });
      }
    });

    // Delegated click for Action, Modifiers, and Keys
    document.addEventListener('click', (e) => {
      resetIdleTimer();

      // Modifiers
      const modBtn = e.target.closest('[data-mod]');
      if (modBtn) {
        haptic();
        const mod = modBtn.getAttribute('data-mod');
        if (mod === 'shift') {
          state.shift = !state.shift;
          updateQwertyKeyLabels();
        }
        if (mod === 'ctrl') state.ctrl = !state.ctrl;
        if (mod === 'alt') state.alt = !state.alt;
        if (mod === 'run') state.run = !state.run;
        updateModifierButtons();
        return;
      }

      // Keys (F-keys, PC keys, Ribbon keys, Symbol keys)
      const keyBtn = e.target.closest('[data-key]');
      if (keyBtn) {
        haptic();
        const rawKey = keyBtn.getAttribute('data-key');
        const resolved = resolveKeyAction(rawKey);
        sendRaw(resolved);
      }
    });

    // Restore opacity on tap
    elApp.addEventListener('pointerdown', () => {
      resetIdleTimer();
    });
  }

  // --- App Startup ---
  window.addEventListener('DOMContentLoaded', () => {
    applyDockMode(state.dockMode);
    renderKeyboard();
    setupControls();
    initTerminal();
    connectWebSocket();
  });

})();
