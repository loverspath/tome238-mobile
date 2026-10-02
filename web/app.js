/**
 * ToME 2.3.8-ah Mobile Web Client Controller
 * Manages Xterm.js terminal, WebSocket PTY streaming, and mobile touch keyboard.
 */

(function () {
  'use strict';

  // --- State ---
  const state = {
    ws: null,
    term: null,
    fitAddon: null,
    reconnectTimer: null,
    shift: false,
    ctrl: false,
    run: false,
    opacityState: 0, // 0: Normal, 1: Ghost, 2: Hidden
    activeRepeatTimer: null,
    activeRepeatInterval: null,
    recentScreenText: ''
  };

  // --- DOM Elements ---
  const elStatus = document.getElementById('conn-status');
  const elRestart = document.getElementById('btn-restart');
  const elGhost = document.getElementById('btn-ghost');
  const elKeyboardPanel = document.getElementById('keyboard-panel');
  const elRibbonBar = document.getElementById('ribbon-bar');
  const elDynamicRibbon = document.getElementById('dynamic-ribbon');
  const elBtnShift = document.getElementById('btn-shift');
  const elBtnCtrl = document.getElementById('btn-ctrl');
  const elBtnRun = document.getElementById('btn-run');

  // Cache default dynamic ribbon HTML
  const defaultDynamicRibbonHTML = elDynamicRibbon.innerHTML;

  // --- Terminal Initialization ---
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
      sendRaw(data);
    });

    state.term = term;
    state.fitAddon = fitAddon;

    adjustTerminalScale();
    window.addEventListener('resize', () => {
      adjustTerminalScale();
    });
  }

  function adjustTerminalScale() {
    if (!state.fitAddon || !state.term) return;
    const container = document.getElementById('terminal-wrapper');
    const cw = container.clientWidth - 8;
    const ch = container.clientHeight - 8;

    // Calculate optimal font size for 80x24
    // Standard char aspect ratio is approx 0.6 (w/h)
    const maxFontW = cw / (80 * 0.62);
    const maxFontH = ch / (24 * 1.18);
    const optimalSize = Math.max(9, Math.floor(Math.min(maxFontW, maxFontH)));

    if (state.term.options.fontSize !== optimalSize) {
      state.term.options.fontSize = optimalSize;
    }
    state.fitAddon.fit();
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
      // Synchronize 80x24 window size
      sendJSON({ type: 'resize', cols: 80, rows: 24 });
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

      // Context sniffing for quick confirmation prompts
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
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(data);
    }
  }

  function sendJSON(obj) {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify(obj));
    }
  }

  // --- Input Resolution ---
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
      elBtnShift.classList.remove('active');
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
      elBtnCtrl.classList.remove('active');
    }

    return output;
  }

  function handleDirection(dir) {
    haptic();
    let cmd = dir;
    // In Angband/ToME, prefixing '.' with direction triggers RUN
    if (state.run) {
      cmd = '.' + dir;
      // Keep RUN active or toggle off? Leave it toggleable
    } else if (state.shift) {
      // Shift + direction in roguelikes also triggers running
      cmd = '.' + dir;
      state.shift = false;
      elBtnShift.classList.remove('active');
    }
    sendRaw(cmd);
  }

  // --- Context Sniffer (docs/mobile_keyboard_spec.md §4.2) ---
  let contextMode = 'normal';

  function inspectScreenForContext(chunk) {
    state.recentScreenText = (state.recentScreenText + chunk).slice(-500);

    const isYesNo = /\((y\/n|y\/n\/esc|\[y\/n\])\)/i.test(state.recentScreenText);
    const isDirection = /(Direction\?|Which direction\?)/i.test(state.recentScreenText);

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

  // --- Setup Event Listeners ---
  function setupControls() {
    // Top Bar Buttons
    elRestart.addEventListener('click', () => {
      if (confirm('Restart game session?')) {
        sendJSON({ type: 'restart' });
      }
    });

    elGhost.addEventListener('click', () => {
      state.opacityState = (state.opacityState + 1) % 3;
      elKeyboardPanel.classList.remove('ghost', 'hidden-panel');
      if (state.opacityState === 1) {
        elKeyboardPanel.classList.add('ghost');
      } else if (state.opacityState === 2) {
        elKeyboardPanel.classList.add('hidden-panel');
      }
      adjustTerminalScale();
    });

    // Modifiers
    elBtnShift.addEventListener('click', () => {
      haptic();
      state.shift = !state.shift;
      elBtnShift.classList.toggle('active', state.shift);
    });

    elBtnCtrl.addEventListener('click', () => {
      haptic();
      state.ctrl = !state.ctrl;
      elBtnCtrl.classList.toggle('active', state.ctrl);
    });

    elBtnRun.addEventListener('click', () => {
      haptic();
      state.run = !state.run;
      elBtnRun.classList.toggle('active', state.run);
    });

    // Delegated click for Ribbon and Action buttons
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-key]');
      if (!btn) return;
      haptic();
      const rawKey = btn.getAttribute('data-key');
      const resolved = resolveAction(rawKey);
      sendRaw(resolved);
    });

    // D-Pad with repeat listener (Continuous movement on hold)
    const dpadButtons = document.querySelectorAll('.dpad-btn');
    dpadButtons.forEach(btn => {
      const dir = btn.getAttribute('data-dir');

      const startHold = (e) => {
        e.preventDefault();
        btn.classList.add('active');
        handleDirection(dir);

        clearTimeout(state.activeRepeatTimer);
        clearInterval(state.activeRepeatInterval);

        // Repeat only for directions, not center '5' unless desired
        if (dir !== '5') {
          state.activeRepeatTimer = setTimeout(() => {
            state.activeRepeatInterval = setInterval(() => {
              handleDirection(dir);
            }, 75);
          }, 300);
        }
      };

      const endHold = (e) => {
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

  // --- App Startup ---
  window.addEventListener('DOMContentLoaded', () => {
    initTerminal();
    setupControls();
    connectWebSocket();
  });

})();
