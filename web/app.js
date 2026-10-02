/**
 * ToME 2.3.8-ah Mobile Web Client Controller
 * Manages Xterm.js terminal, WebSocket PTY streaming, and mobile touch keyboard.
 * Implements Angbandroid adaptive keyboard profiles and viewport auto-fit.
 */

(function () {
  'use strict';

  // --- Constants & Profiles ---
  const PROFILES = ['default', 'numpad', 'minimal'];
  const PROFILE_LABELS = {
    default: '⌨ Default',
    numpad: '⌨ Numpad',
    minimal: '⌨ Minimal'
  };

  // --- State ---
  const state = {
    ws: null,
    term: null,
    fitAddon: null,
    reconnectTimer: null,
    profile: localStorage.getItem('tome_kb_profile') || 'default',
    dockMode: localStorage.getItem('tome_dock_mode') || 'docked', // 'docked' | 'overlap'
    shift: false,
    ctrl: false,
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

  // Cache default dynamic ribbon HTML
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

    // Use ResizeObserver for precise container-driven auto-fit
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
   * Guarantees 80x24 standard display fits without horizontal/vertical clipping
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
      const maxFontW = Math.floor(cw / (80 * charAspect));
      optimalFontSize = maxFontW;
    } else {
      // Height-bound: 24 rows must strictly fit container height
      const maxFontH = Math.floor(ch / (24 * lineHeight));
      optimalFontSize = maxFontH;
    }

    // Clamp between 8px and 28px
    optimalFontSize = Math.max(8, Math.min(28, optimalFontSize));

    if (state.term.options.fontSize !== optimalFontSize) {
      state.term.options.fontSize = optimalFontSize;
    }

    try {
      state.fitAddon.fit();
    } catch (e) {
      // FitAddon might throw if dimensions are transitioning
    }

    // Notify backend PTY if size changed
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

  function resolveAction(action) {
    let output = parseEscapes(action);

    // Apply Shift modifier
    if (state.shift) {
      output = output.toUpperCase();
      state.shift = false;
      updateModifierButtons();
    }

    // Apply Ctrl modifier
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

    return output;
  }

  function handleDirection(dir) {
    haptic();
    let cmd = dir;
    if (state.run || state.shift) {
      // In Angband/ToME, prefixing '.' with direction triggers RUN
      cmd = '.' + dir;
      if (state.shift) {
        state.shift = false;
        updateModifierButtons();
      }
    }
    sendRaw(cmd);
  }

  function updateModifierButtons() {
    const shiftBtns = document.querySelectorAll('.mod-shift');
    const ctrlBtns = document.querySelectorAll('.mod-ctrl');
    const runBtns = document.querySelectorAll('.mod-run');

    shiftBtns.forEach(b => b.classList.toggle('active', state.shift));
    ctrlBtns.forEach(b => b.classList.toggle('active', state.ctrl));
    runBtns.forEach(b => b.classList.toggle('active', state.run));
  }

  // --- Keyboard Profiles Rendering ---
  function renderKeyboard() {
    elKeyboardPanel.innerHTML = '';
    elApp.classList.remove('profile-default', 'profile-numpad', 'profile-minimal');
    elApp.classList.add(`profile-${state.profile}`);

    elBtnProfile.textContent = PROFILE_LABELS[state.profile] || '⌨ Profile';

    if (state.profile === 'default') {
      renderDefaultProfile();
    } else if (state.profile === 'numpad') {
      renderNumpadProfile();
    } else if (state.profile === 'minimal') {
      renderMinimalProfile();
    }

    bindTouchListeners();
    adjustTerminalScale();
  }

  function renderDefaultProfile() {
    elKeyboardPanel.innerHTML = `
      <div class="action-grid">
        <div class="grid-row">
          <button class="action-btn mod-btn mod-shift" data-mod="shift">⇧ Shift</button>
          <button class="action-btn mod-btn mod-ctrl" data-mod="ctrl">^ Ctrl</button>
          <button class="action-btn mod-btn run-btn mod-run" data-mod="run">⚡ RUN</button>
        </div>
        <div class="grid-row">
          <button class="action-btn" data-key=".">· Wait</button>
          <button class="action-btn" data-key=",">, Stay</button>
          <button class="action-btn" data-key="?">? Help</button>
        </div>
        <div class="grid-row">
          <button class="action-btn" data-key="<">&lt; Up</button>
          <button class="action-btn" data-key=">">&gt; Down</button>
          <button class="action-btn" data-key="0">0 Rpt</button>
        </div>
        <div class="grid-row">
          <button class="action-btn" data-key="c">c Close</button>
          <button class="action-btn" data-key="o">o Open</button>
          <button class="action-btn" data-key="B">B Bash</button>
        </div>
      </div>

      <div class="dpad-grid">
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
    `;
    updateModifierButtons();
  }

  function renderNumpadProfile() {
    elKeyboardPanel.innerHTML = `
      <div class="numpad-panel-container">
        <!-- Left Tools -->
        <div class="numpad-left-tools">
          <div class="grid-row">
            <button class="action-btn esc-btn" data-key="\\e">⎋ Esc</button>
            <button class="action-btn enter-btn" data-key="\\n">⏎ Ret</button>
          </div>
          <div class="grid-row">
            <button class="action-btn mod-btn mod-shift" data-mod="shift">⇧ Shift</button>
            <button class="action-btn mod-btn run-btn mod-run" data-mod="run">⚡ RUN</button>
          </div>
          <div class="grid-row">
            <button class="action-btn" data-key="i">🎒 Inv</button>
            <button class="action-btn macro-btn" data-key="R&\\n">💤 Rest</button>
          </div>
          <div class="grid-row">
            <button class="action-btn" data-key="M">🗺 Map</button>
            <button class="action-btn" data-key="*">🎯 Trgt</button>
          </div>
        </div>

        <!-- Right Large Numpad 3x4 -->
        <div class="numpad-right-keys">
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
          <button class="numpad-key-btn" data-key="\\b">⌫<span class="arrow-sub">BS</span></button>
        </div>
      </div>
    `;
    updateModifierButtons();
  }

  function renderMinimalProfile() {
    // Keyboard panel is hidden via CSS (.profile-minimal #keyboard-panel { display: none })
    // Extra direction buttons are added to ribbon if needed
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
        <button class="ribbon-btn esc-btn" data-key="\\e">⎋ Esc</button>
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

        // Continuous movement on hold
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

    // Delegated click for Action and Modifier buttons
    document.addEventListener('click', (e) => {
      resetIdleTimer();

      // Modifiers
      const modBtn = e.target.closest('[data-mod]');
      if (modBtn) {
        haptic();
        const mod = modBtn.getAttribute('data-mod');
        if (mod === 'shift') state.shift = !state.shift;
        if (mod === 'ctrl') state.ctrl = !state.ctrl;
        if (mod === 'run') state.run = !state.run;
        updateModifierButtons();
        return;
      }

      // Keys (Ribbon, action, numpad)
      const keyBtn = e.target.closest('[data-key]');
      if (keyBtn) {
        haptic();
        const rawKey = keyBtn.getAttribute('data-key');
        const resolved = resolveAction(rawKey);
        sendRaw(resolved);
      }
    });

    // Touch on app restores overlap opacity
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
