/**
 * ToME 2.3.8-ah Mobile Web Client Controller
 * Native Port of Angbandroid AdvKeyboard.java, AdvButton.java, & OptionPopup
 */

(function () {
  'use strict';

  // --- Constants & Special Key Codes ---
  const InputUtils = {
    Visibility: '⎘',
    BlackWhite: '◧',
    SpaceBar: '▭',
    Menu: '▤',
    Shift: '⇧',
    BackSpace: '⌫',
    Enter: '⏎',
    Escape: '⎋'
  };

  const FUNCTION_KEY_ANSI = {
    'F1': '\x1bOP', 'F2': '\x1bOQ', 'F3': '\x1bOR', 'F4': '\x1bOS',
    'F5': '\x1b[15~', 'F6': '\x1b[17~', 'F7': '\x1b[18~', 'F8': '\x1b[19~',
    'F9': '\x1b[20~', 'F10': '\x1b[21~', 'F11': '\x1b[23~', 'F12': '\x1b[24~',
    'tab': '\t', '⌫': '\x7f', '⏎': '\r', '⎋': '\x1b', '▭': ' '
  };

  // --- State ---
  const state = {
    ws: null,
    term: null,
    fitAddon: null,
    reconnectTimer: null,
    dockMode: localStorage.getItem('tome_dock_mode') || 'docked', // 'docked' | 'overlap'
    keyboardsData: null,
    page: 0,
    shiftMode: 0, // 0: Lowercase (a-z), 1: Uppercase (A-Z), 2: Control (^A-^Z)
    locked: false,
    keymapMode: false,
    runningMode: false,
    opacityMode: 0, // 0: Normal, 1: Ghost/Translucent, 2: Hidden
    longPressTimer: null,
    currentLongPressTarget: null,
    skipNextClick: false,
    customKeymaps: {}, // { trigger: { action: string, alwaysVisible: boolean } }
    editingTrigger: null,
    lastCols: 80,
    lastRows: 24,
    recentScreenText: ''
  };

  // --- DOM Elements ---
  const elApp = document.getElementById('app');
  const elStatus = document.getElementById('conn-status');
  const elIndShift = document.getElementById('ind-shift');
  const elIndLock = document.getElementById('ind-lock');
  const elIndRun = document.getElementById('ind-run');
  const elBtnDock = document.getElementById('btn-dock');
  const elBtnGhost = document.getElementById('btn-ghost');
  const elBtnRestart = document.getElementById('btn-restart');
  const elKeyboardPanel = document.getElementById('keyboard-panel');
  const elRibbonBar = document.getElementById('ribbon-bar');
  const elDynamicRibbon = document.getElementById('dynamic-ribbon');
  const elTerminalWrapper = document.getElementById('terminal-wrapper');

  // OptionPopup Modal Elements
  const elModal = document.getElementById('keymap-modal');
  const elModalBadge = document.getElementById('keymap-trigger-badge');
  const elModalInput = document.getElementById('keymap-action-input');
  const elModalCheck = document.getElementById('keymap-always-visible');
  const elBtnSave = document.getElementById('btn-keymap-save');
  const elBtnClear = document.getElementById('btn-keymap-clear');
  const elBtnCancel = document.getElementById('btn-keymap-cancel');

  const defaultDynamicRibbonHTML = elDynamicRibbon.innerHTML;

  // --- Keymap Serialization (Angbandroid Format) ---
  function loadPersistedKeymaps() {
    const raw = localStorage.getItem('tome_adv_keymaps');
    state.customKeymaps = {};
    if (!raw) return;

    // Format: trigger:prop:action:prop:alwaysVisible:sep:...
    const pairs = raw.split(':sep:');
    for (const pair of pairs) {
      const parts = pair.split(':prop:');
      if (parts.length >= 3 && parts[1].length > 0) {
        state.customKeymaps[parts[0]] = {
          action: parts[1],
          alwaysVisible: parts[2] === 'yes'
        };
      }
    }
  }

  function persistKeymaps() {
    const arr = [];
    for (const trigger in state.customKeymaps) {
      const item = state.customKeymaps[trigger];
      if (item.action && item.action.length > 0) {
        arr.push(`${trigger}:prop:${item.action}:prop:${item.alwaysVisible ? 'yes' : 'no'}`);
      }
    }
    localStorage.setItem('tome_adv_keymaps', arr.join(':sep:'));
  }

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

    term.onData(data => {
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
      renderKeyboard();
    });
    window.addEventListener('orientationchange', () => {
      setTimeout(() => {
        adjustTerminalScale();
        renderKeyboard();
      }, 150);
    });

    adjustTerminalScale();
  }

  function adjustTerminalScale() {
    if (!state.fitAddon || !state.term) return;

    const cw = elTerminalWrapper.clientWidth - 4;
    const ch = elTerminalWrapper.clientHeight - 4;
    if (cw <= 0 || ch <= 0) return;

    const isPortrait = window.innerHeight > window.innerWidth;
    const charAspect = 0.58;
    const lineHeight = 1.15;

    let optimalFontSize;
    if (isPortrait) {
      optimalFontSize = Math.floor(cw / (80 * charAspect));
    } else {
      optimalFontSize = Math.floor(ch / (24 * lineHeight));
    }

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
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(data);
    }
  }

  function sendJSON(obj) {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify(obj));
    }
  }

  function haptic() {
    if (navigator.vibrate) {
      try { navigator.vibrate(10); } catch (e) {}
    }
  }

  // --- Angbandroid Input Resolution Engine (InputUtils.java) ---
  function parseActionString(txt) {
    const result = [];
    let i = 0;
    const n = txt.length;

    while (i < n) {
      const ch0 = txt.charAt(i);
      const next = (i + 1 < n) ? txt.charAt(i + 1) : '';

      if (ch0 === '^' && /[a-zA-Z]/.test(next)) {
        // Control sequence: ^A -> \x01, ^Z -> \x1a
        const code = next.toUpperCase().charCodeAt(0) - 64;
        result.push(String.fromCharCode(code));
        i += 2;
      } else if (ch0 === '\\') {
        switch (next.toLowerCase()) {
          case 'n': result.push('\r'); break; // Enter
          case 'e': result.push('\x1b'); break; // Escape
          case 't': result.push('\t'); break;   // Tab
          case 's': result.push(' '); break;    // Space
          case 'b': result.push('\x7f'); break;  // BackSpace
          default: result.push(next); break;
        }
        i += 2;
      } else {
        result.push(ch0);
        i += 1;
      }
    }
    return result.join('');
  }

  function processAction(action) {
    const parsed = parseActionString(action);

    // If runningMode is on and it's a direction digit 1-9
    if (state.runningMode && parsed.length === 1 && parsed >= '1' && parsed <= '9') {
      sendRaw('.' + parsed);
      return;
    }

    sendRaw(parsed);
  }

  // --- Angbandroid AdvKeyboard Native Engine ---

  function changeShiftMode() {
    state.shiftMode = (state.shiftMode + 1) % 3;
    updateStatusIndicators();
    updateKeyboardKeyLabels();
  }

  function exitShiftMode() {
    if (!state.locked && state.shiftMode !== 0) {
      state.shiftMode = 0;
      updateStatusIndicators();
      updateKeyboardKeyLabels();
    }
  }

  function toggleLock() {
    state.locked = !state.locked;
    if (state.locked && state.shiftMode === 0) {
      changeShiftMode();
    }
    if (!state.locked) {
      state.shiftMode = 0;
      updateKeyboardKeyLabels();
    }
    updateStatusIndicators();
    updateToggledButtons();
  }

  function changePage() {
    state.page = state.page === 0 ? 1 : 0;
    renderKeyboard();
  }

  function resetPage() {
    if (state.page !== 0 && !state.locked) {
      changePage();
    }
  }

  function toggleKeymapMode() {
    state.keymapMode = !state.keymapMode;
    elKeyboardPanel.classList.toggle('keymap-mode-active', state.keymapMode);
    updateToggledButtons();
    renderKeyboard();
  }

  function toggleRunningMode() {
    state.runningMode = !state.runningMode;
    updateStatusIndicators();
    updateToggledButtons();
  }

  function changeOpacityMode() {
    state.opacityMode = (state.opacityMode + 1) % 3;
    elKeyboardPanel.classList.remove('ghost', 'hidden-panel');
    if (state.opacityMode === 1) {
      elKeyboardPanel.classList.add('ghost');
    } else if (state.opacityMode === 2) {
      elKeyboardPanel.classList.add('hidden-panel');
    }
    adjustTerminalScale();
  }

  function updateStatusIndicators() {
    // Shift indicator
    if (state.shiftMode === 0) {
      elIndShift.textContent = 'a-z';
      elIndShift.className = 'status-pill';
    } else if (state.shiftMode === 1) {
      elIndShift.textContent = 'A-Z';
      elIndShift.className = 'status-pill mode-upper';
    } else if (state.shiftMode === 2) {
      elIndShift.textContent = '^A-Z';
      elIndShift.className = 'status-pill mode-ctrl';
    }

    // Lock indicator
    elIndLock.classList.toggle('hidden-pill', !state.locked);
    if (state.locked) elIndLock.className = 'status-pill mode-active';

    // Run indicator
    elIndRun.classList.toggle('hidden-pill', !state.runningMode);
    if (state.runningMode) elIndRun.className = 'status-pill mode-run';
  }

  function updateToggledButtons() {
    const kmpBtn = elKeyboardPanel.querySelector('[data-default="kmp"]');
    if (kmpBtn) kmpBtn.classList.toggle('toggled', state.keymapMode);

    const lckBtn = elKeyboardPanel.querySelector('[data-default="lck"]');
    if (lckBtn) lckBtn.classList.toggle('toggled', state.locked);

    const runBtn = elKeyboardPanel.querySelector('[data-default="run"]');
    if (runBtn) runBtn.classList.toggle('toggled', state.runningMode);
  }

  function getActiveButtonValue(defaultValue) {
    if (defaultValue.length === 1 && /[a-zA-Z]/.test(defaultValue)) {
      if (state.shiftMode === 1) {
        return defaultValue.toUpperCase();
      }
      if (state.shiftMode === 2) {
        return '^' + defaultValue.toUpperCase();
      }
    }
    return defaultValue;
  }

  function updateKeyboardKeyLabels() {
    const btns = elKeyboardPanel.querySelectorAll('.adv-btn');
    btns.forEach(btn => {
      const def = btn.getAttribute('data-default');
      const custom = state.customKeymaps[def];
      if (state.keymapMode && custom && custom.action) {
        btn.textContent = custom.action.slice(0, 4);
        btn.classList.add('has-keymap');
      } else {
        const activeVal = getActiveButtonValue(def);
        btn.textContent = activeVal;
        btn.classList.toggle('has-keymap', !!(custom && custom.action));
      }
    });
  }

  // --- Button Execution Dispatcher (AdvButton.java execute) ---
  function executeButton(defaultValue) {
    haptic();

    if (defaultValue === 'kmp') {
      toggleKeymapMode();
      return;
    }

    if (defaultValue === 'lck') {
      toggleLock();
      return;
    }

    if (defaultValue === InputUtils.BlackWhite) {
      changeOpacityMode();
      return;
    }

    if (defaultValue === InputUtils.Shift) {
      changeShiftMode();
      return;
    }

    if (defaultValue === '+/-' || defaultValue === 'abc') {
      changePage();
      return;
    }

    if (defaultValue === 'run') {
      toggleRunningMode();
      return;
    }

    if (defaultValue === InputUtils.Menu) {
      toggleKeymapMode();
      return;
    }

    // Check custom keymap
    if (state.keymapMode && state.customKeymaps[defaultValue]) {
      const custom = state.customKeymaps[defaultValue];
      if (custom && custom.action) {
        processAction(custom.action);
        exitShiftMode();
        resetPage();
        return;
      }
    }

    // Check function keys / special ANSI
    if (FUNCTION_KEY_ANSI[defaultValue]) {
      sendRaw(FUNCTION_KEY_ANSI[defaultValue]);
      exitShiftMode();
      resetPage();
      return;
    }

    // Normal active value
    const activeValue = getActiveButtonValue(defaultValue);
    processAction(activeValue);

    exitShiftMode();
    resetPage();
  }

  // --- Render AdvKeyboard Layout from keyboards.json ---
  function renderKeyboard() {
    if (!state.keyboardsData) return;

    elKeyboardPanel.innerHTML = '';
    const isPortrait = window.innerHeight > window.innerWidth;
    const orientationKey = isPortrait ? 'portrait' : 'landscape';
    const orientationConfig = state.keyboardsData[orientationKey];

    const pageData = orientationConfig.pages[state.page] || orientationConfig.pages[0];

    for (const rowKeys of pageData.keys) {
      const rowEl = document.createElement('div');
      rowEl.className = 'adv-row';

      for (const keyDef of rowKeys) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'adv-btn';
        btn.setAttribute('data-default', keyDef);

        const custom = state.customKeymaps[keyDef];
        if (state.keymapMode && custom && custom.action) {
          btn.textContent = custom.action.slice(0, 4);
          btn.classList.add('has-keymap');
        } else {
          btn.textContent = getActiveButtonValue(keyDef);
          if (custom && custom.action) {
            btn.classList.add('has-keymap');
          }
        }

        bindAdvButtonTouch(btn, keyDef);
        rowEl.appendChild(btn);
      }
      elKeyboardPanel.appendChild(rowEl);
    }

    updateStatusIndicators();
    updateToggledButtons();
    adjustTerminalScale();
  }

  // --- Touch & Long-Press Handling (AdvKeyboard onTouch + OptionPopup trigger) ---
  function bindAdvButtonTouch(btn, defaultValue) {
    const neverKeymap = ['◧', '⏎', '⎋', '⇧', '+/-', 'abc', 'kmp', 'lck', '▤'];

    const onPointerDown = (e) => {
      btn.classList.add('pressed');
      state.skipNextClick = false;
      state.currentLongPressTarget = defaultValue;

      clearTimeout(state.longPressTimer);
      // 1000ms Long Press -> OptionPopup
      if (!neverKeymap.includes(defaultValue)) {
        state.longPressTimer = setTimeout(() => {
          state.skipNextClick = true;
          btn.classList.remove('pressed');
          openOptionPopup(defaultValue);
        }, 1000);
      }
    };

    const onPointerUp = (e) => {
      clearTimeout(state.longPressTimer);
      btn.classList.remove('pressed');

      if (state.skipNextClick) {
        state.skipNextClick = false;
        return;
      }

      // If in keymap mode, open editor instead of executing
      if (state.keymapMode && !neverKeymap.includes(defaultValue)) {
        openOptionPopup(defaultValue);
        return;
      }

      executeButton(defaultValue);
    };

    const onPointerCancel = () => {
      clearTimeout(state.longPressTimer);
      btn.classList.remove('pressed');
      state.skipNextClick = false;
    };

    btn.addEventListener('pointerdown', onPointerDown);
    btn.addEventListener('pointerup', onPointerUp);
    btn.addEventListener('pointercancel', onPointerCancel);
    btn.addEventListener('pointerleave', onPointerCancel);
  }

  // --- Angbandroid OptionPopup Modal Dialog Controller ---
  function openOptionPopup(trigger) {
    haptic();
    state.editingTrigger = trigger;
    elModalBadge.textContent = `Key: [ ${trigger} ]`;

    const existing = state.customKeymaps[trigger] || { action: '', alwaysVisible: false };
    elModalInput.value = existing.action;
    elModalCheck.checked = existing.alwaysVisible;

    elModal.classList.remove('hidden-modal');
    elModalInput.focus();
  }

  function closeOptionPopup() {
    elModal.classList.add('hidden-modal');
    state.editingTrigger = null;
  }

  function setupOptionPopup() {
    // Quick insert buttons
    const insertButtons = elModal.querySelectorAll('.quick-insert-btn');
    insertButtons.forEach(b => {
      b.addEventListener('click', () => {
        haptic();
        const str = b.getAttribute('data-insert');
        elModalInput.value += str;
        elModalInput.focus();
      });
    });

    // Save button
    elBtnSave.addEventListener('click', () => {
      haptic();
      const trigger = state.editingTrigger;
      if (!trigger) return;

      const action = elModalInput.value.trim();
      const alwaysVisible = elModalCheck.checked;

      if (action.length > 0) {
        state.customKeymaps[trigger] = { action, alwaysVisible };
      } else {
        delete state.customKeymaps[trigger];
      }

      persistKeymaps();
      closeOptionPopup();
      renderKeyboard();
    });

    // Clear button
    elBtnClear.addEventListener('click', () => {
      haptic();
      const trigger = state.editingTrigger;
      if (!trigger) return;

      delete state.customKeymaps[trigger];
      persistKeymaps();
      closeOptionPopup();
      renderKeyboard();
    });

    // Cancel button
    elBtnCancel.addEventListener('click', () => {
      closeOptionPopup();
    });

    // Close on overlay backdrop tap
    elModal.addEventListener('click', (e) => {
      if (e.target === elModal) {
        closeOptionPopup();
      }
    });
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

  // --- Setup Top Bar & Ribbon Controls ---
  function applyDockMode(mode) {
    state.dockMode = mode;
    localStorage.setItem('tome_dock_mode', mode);

    elApp.classList.remove('docked-mode', 'overlap-mode');
    elApp.classList.add(`${mode}-mode`);

    elBtnDock.textContent = mode === 'docked' ? '⇱ Dock' : '⇲ Overlap';
    adjustTerminalScale();
  }

  function setupControls() {
    elBtnDock.addEventListener('click', () => {
      haptic();
      const nextMode = state.dockMode === 'docked' ? 'overlap' : 'docked';
      applyDockMode(nextMode);
    });

    elBtnGhost.addEventListener('click', () => {
      haptic();
      changeOpacityMode();
    });

    elBtnRestart.addEventListener('click', () => {
      if (confirm('Restart game session?')) {
        sendJSON({ type: 'restart' });
      }
    });

    // Delegated click for Ribbon buttons
    document.addEventListener('click', (e) => {
      const keyBtn = e.target.closest('[data-key]');
      if (keyBtn) {
        haptic();
        const rawKey = keyBtn.getAttribute('data-key');
        processAction(rawKey);
      }
    });
  }

  // --- Fetch keyboards.json and Startup ---
  async function loadKeyboardsAndInit() {
    try {
      const res = await fetch('keyboards.json');
      state.keyboardsData = await res.json();
    } catch (err) {
      console.error('Failed to load keyboards.json:', err);
    }

    loadPersistedKeymaps();
    applyDockMode(state.dockMode);
    setupControls();
    setupOptionPopup();
    initTerminal();
    renderKeyboard();
    connectWebSocket();
  }

  window.addEventListener('DOMContentLoaded', () => {
    loadKeyboardsAndInit();
  });

})();
