/**
 * ToME 2.3.8-ah Mobile Web Client Controller
 * Native Angbandroid UI & Proportions Engine:
 * - 5x10 Neon Cyan AdvKeyboard
 * - Draggable 3x3 Floating Touch D-Pad with Persistence
 * - Quick Settings & Preferences Modal Systems (Screenshots 1-8 Replica)
 * - Declarative Profile-Driven Viewport Auto-Fitter
 */

(function () {
  'use strict';

  // --- Constants & Key Mappings ---
  const InputUtils = {
    Visibility: '⎘',
    BlackWhite: '◧',
    SpaceBar: '▭',
    Menu: '▤',
    Shift: '⇧',
    BackSpace: '⌫',
    Enter: '⏎',
    Escape: '⎋',
    Reload: '↺'
  };

  const FUNCTION_KEY_ANSI = {
    'F1': '\x1bOP', 'F2': '\x1bOQ', 'F3': '\x1bOR', 'F4': '\x1bOS',
    'F5': '\x1b[15~', 'F6': '\x1b[17~', 'F7': '\x1b[18~', 'F8': '\x1b[19~',
    'F9': '\x1b[20~', 'F10': '\x1b[21~', 'F11': '\x1b[23~', 'F12': '\x1b[24~',
    'tab': '\t', '⌫': '\x7f', '⏎': '\r', '⎋': '\x1b', '▭': ' ', '↺': '\x12'
  };

  // --- State ---
  const state = {
    ws: null,
    term: null,
    fitAddon: null,
    reconnectTimer: null,
    profileMeta: null,
    dockMode: localStorage.getItem('tome_dock_mode') || 'overlap', // Default is Overlap per screenshots
    showRibbon: localStorage.getItem('tome_show_ribbon') !== 'false',
    showKeyboard: localStorage.getItem('tome_show_keyboard') !== 'false',
    showDpad: localStorage.getItem('tome_show_dpad') !== 'false',
    keyboardsData: null,
    page: 0,
    shiftMode: 0, // 0: a-z, 1: A-Z, 2: ^A-Z
    locked: false,
    keymapMode: false,
    runningMode: false,
    opacityMode: 0, // 0: Normal, 1: Ghost, 2: Hidden
    fitAxis: 'auto', // 'auto' | 'width' | 'height'
    customKeymaps: {},
    editingTrigger: null,
    longPressTimer: null,
    skipNextClick: false,
    repeatTimer: null,
    repeatInterval: null,
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
  const elBtnQuickSettings = document.getElementById('btn-quick-settings');
  const elBtnRestart = document.getElementById('btn-restart');
  const elKeyboardPanel = document.getElementById('keyboard-panel');
  const elFloatingDpad = document.getElementById('floating-dpad');
  const elRibbonBar = document.getElementById('ribbon-bar');
  const elDynamicRibbon = document.getElementById('dynamic-ribbon');
  const elTerminalWrapper = document.getElementById('terminal-wrapper');

  // Quick Settings Modal
  const elQuickSettingsModal = document.getElementById('quick-settings-modal');

  // Preferences Modal
  const elPreferencesModal = document.getElementById('preferences-modal');
  const elBtnPrefsClose = document.getElementById('btn-prefs-close');
  const elPrefProfileName = document.getElementById('pref-profile-name');
  const elPrefVariantName = document.getElementById('pref-variant-name');
  const elPrefFullscreen = document.getElementById('pref-fullscreen');
  const elPrefEnableKeyboard = document.getElementById('pref-enable-keyboard');
  const elPrefOverlap = document.getElementById('pref-overlap');
  const elPrefEnableDpad = document.getElementById('pref-enable-dpad');

  // OptionPopup Modal
  const elKeymapModal = document.getElementById('keymap-modal');
  const elKeymapBadge = document.getElementById('keymap-trigger-badge');
  const elKeymapInput = document.getElementById('keymap-action-input');
  const elKeymapCheck = document.getElementById('keymap-always-visible');
  const elBtnKeymapSave = document.getElementById('btn-keymap-save');
  const elBtnKeymapClear = document.getElementById('btn-keymap-clear');
  const elBtnKeymapCancel = document.getElementById('btn-keymap-cancel');

  // Crash Diagnostics Modal
  const elCrashModal = document.getElementById('crash-modal');
  const elCrashTitle = document.getElementById('crash-title');
  const elCrashBadgeSignal = document.getElementById('crash-badge-signal');
  const elCrashBadgeCode = document.getElementById('crash-badge-code');
  const elCrashTimestamp = document.getElementById('crash-timestamp');
  const elCrashSummary = document.getElementById('crash-summary');
  const elCrashLogContent = document.getElementById('crash-log-content');
  const elBtnCrashClose = document.getElementById('btn-crash-close');
  const elBtnCrashCopy = document.getElementById('btn-crash-copy');
  const elBtnCrashRestart = document.getElementById('btn-crash-restart');

  const defaultDynamicRibbonHTML = elDynamicRibbon.innerHTML;

  // --- Keymap Persistence ---
  function loadPersistedKeymaps() {
    const raw = localStorage.getItem('tome_adv_keymaps');
    state.customKeymaps = {};
    if (!raw) return;

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
    const defaultCols = state.profileMeta?.geometry?.cols || 80;
    const defaultRows = state.profileMeta?.geometry?.rows || 24;

    const term = new Terminal({
      cols: defaultCols,
      rows: defaultRows,
      cursorBlink: false,
      fontFamily: '"DejaVu Sans Mono", "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.15,
      theme: {
        background: '#000000',
        foreground: '#ffffff',
        cursor: '#00ffff',
        black: '#000000',
        red: '#ff4444',
        green: '#00ff00',
        yellow: '#ffff00',
        blue: '#0088ff',
        magenta: '#ff00ff',
        cyan: '#00ffff',
        white: '#ffffff',
        brightBlack: '#606060',
        brightRed: '#ff6666',
        brightGreen: '#66ff66',
        brightYellow: '#ffff66',
        brightBlue: '#66b2ff',
        brightMagenta: '#ff66ff',
        brightCyan: '#66ffff',
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
    state.lastCols = defaultCols;
    state.lastRows = defaultRows;

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

  /**
   * Precise 80x24 Viewport Auto-Fitter with Fit Width & Fit Height support
   */
  function adjustTerminalScale() {
    if (!state.fitAddon || !state.term) return;

    const cw = elTerminalWrapper.clientWidth - 2;
    const ch = elTerminalWrapper.clientHeight - 2;
    if (cw <= 0 || ch <= 0) return;

    const isPortrait = window.innerHeight > window.innerWidth;
    const charAspect = 0.58;
    const lineHeight = 1.15;
    const targetCols = state.profileMeta?.geometry?.cols || 80;
    const targetRows = state.profileMeta?.geometry?.rows || 24;

    let optimalFontSize;

    if (state.fitAxis === 'width' || (state.fitAxis === 'auto' && isPortrait)) {
      // Fit Width: 80 cols must fill width perfectly
      optimalFontSize = Math.floor(cw / (targetCols * charAspect));
    } else if (state.fitAxis === 'height' || (state.fitAxis === 'auto' && !isPortrait)) {
      // Fit Height: 24 rows must fill height perfectly
      optimalFontSize = Math.floor(ch / (targetRows * lineHeight));
    } else {
      optimalFontSize = Math.floor(cw / (targetCols * charAspect));
    }

    optimalFontSize = Math.max(8, Math.min(32, optimalFontSize));

    if (state.term.options.fontSize !== optimalFontSize) {
      state.term.options.fontSize = optimalFontSize;
    }

    try {
      state.fitAddon.fit();
    } catch (e) {}

    const cols = Math.max(targetCols, state.term.cols || targetCols);
    const rows = Math.max(targetRows, state.term.rows || targetRows);
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
    const sessionId = state.profileMeta?.id || 'default';
    const wsUrl = `${proto}//${window.location.host}/ws?session=${sessionId}`;

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
            if (msg.type === 'crash') {
              showCrashModal(msg);
              return;
            }
            if (msg.type === 'exit') {
              state.term.write('\r\n\x1b[33m[Session process exited. Tap ↺ to restart.]\x1b[0m\r\n');
              return;
            }
          } catch (e) {}
        }
        text = event.data;
        state.term.write(text);
      } else {
        const u8 = new Uint8Array(event.data);
        text = new TextDecoder('latin1').decode(u8);
        if (text.startsWith('{')) {
          try {
            const msg = JSON.parse(text);
            if (msg.type === 'crash') {
              showCrashModal(msg);
              return;
            }
            if (msg.type === 'exit') {
              state.term.write('\r\n\x1b[33m[Session process exited. Tap ↺ to restart.]\x1b[0m\r\n');
              return;
            }
          } catch (e) {}
        }
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

  // --- Input Resolution Engine (InputUtils.java) ---
  function parseActionString(txt) {
    const result = [];
    let i = 0;
    const n = txt.length;

    while (i < n) {
      const ch0 = txt.charAt(i);
      const next = (i + 1 < n) ? txt.charAt(i + 1) : '';

      if (ch0 === '^' && /[a-zA-Z]/.test(next)) {
        const code = next.toUpperCase().charCodeAt(0) - 64;
        result.push(String.fromCharCode(code));
        i += 2;
      } else if (ch0 === '\\') {
        switch (next.toLowerCase()) {
          case 'n': result.push('\r'); break;
          case 'e': result.push('\x1b'); break;
          case 't': result.push('\t'); break;
          case 's': result.push(' '); break;
          case 'b': result.push('\x7f'); break;
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

    if (state.runningMode && parsed.length === 1 && parsed >= '1' && parsed <= '9') {
      sendRaw('.' + parsed);
      return;
    }

    sendRaw(parsed);
  }

  function handleDirection(dir) {
    haptic();
    let cmd = dir;
    if (state.runningMode) {
      cmd = '.' + dir;
    }
    sendRaw(cmd);
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

    elIndLock.classList.toggle('hidden-pill', !state.locked);
    if (state.locked) elIndLock.className = 'status-pill mode-active';

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
      openQuickSettings();
      return;
    }

    if (defaultValue === InputUtils.Reload) {
      sendRaw('\x12'); // Ctrl+R redraw
      return;
    }

    if (state.keymapMode && state.customKeymaps[defaultValue]) {
      const custom = state.customKeymaps[defaultValue];
      if (custom && custom.action) {
        processAction(custom.action);
        exitShiftMode();
        resetPage();
        return;
      }
    }

    if (FUNCTION_KEY_ANSI[defaultValue]) {
      sendRaw(FUNCTION_KEY_ANSI[defaultValue]);
      exitShiftMode();
      resetPage();
      return;
    }

    const activeValue = getActiveButtonValue(defaultValue);
    processAction(activeValue);

    exitShiftMode();
    resetPage();
  }

  // --- Render Layout from keyboards.json (5x10 Exact Layout) ---
  function renderKeyboard() {
    if (!state.keyboardsData || !state.showKeyboard) {
      elKeyboardPanel.classList.add('hidden-panel');
      adjustTerminalScale();
      return;
    }

    elKeyboardPanel.classList.remove('hidden-panel');
    elKeyboardPanel.innerHTML = '';

    const isPortrait = window.innerHeight > window.innerWidth;
    const orientationKey = isPortrait ? 'portrait' : 'landscape';
    const orientationConfig = state.keyboardsData[orientationKey] || state.keyboardsData['landscape'];

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

  function bindAdvButtonTouch(btn, defaultValue) {
    const neverKeymap = ['◧', '⏎', '⎋', '⇧', '+/-', 'abc', 'kmp', 'lck', '▤', '↺'];

    const onPointerDown = () => {
      btn.classList.add('pressed');
      state.skipNextClick = false;

      clearTimeout(state.longPressTimer);
      if (!neverKeymap.includes(defaultValue)) {
        state.longPressTimer = setTimeout(() => {
          state.skipNextClick = true;
          btn.classList.remove('pressed');
          openOptionPopup(defaultValue);
        }, 1000);
      }
    };

    const onPointerUp = () => {
      clearTimeout(state.longPressTimer);
      btn.classList.remove('pressed');

      if (state.skipNextClick) {
        state.skipNextClick = false;
        return;
      }

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

  // --- 3x3 Floating Touch D-Pad with Drag & Drop (Screenshots 1, 7, 8) ---
  function setupFloatingDpad() {
    if (!state.showDpad) {
      elFloatingDpad.classList.add('hidden-dpad');
      return;
    }
    elFloatingDpad.classList.remove('hidden-dpad');

    // Restore saved position
    const savedPos = localStorage.getItem('tome_dpad_pos');
    if (savedPos) {
      try {
        const { left, top } = JSON.parse(savedPos);
        elFloatingDpad.style.left = `${left}px`;
        elFloatingDpad.style.top = `${top}px`;
        elFloatingDpad.style.right = 'auto';
        elFloatingDpad.style.bottom = 'auto';
      } catch (e) {}
    }

    // Drag handling
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initialX = 0;
    let initialY = 0;
    let dragThresholdPassed = false;

    const onPointerDown = (e) => {
      // If clicked on button, wait to see if it's a drag or tap
      isDragging = true;
      dragThresholdPassed = false;
      startX = e.clientX;
      startY = e.clientY;

      const rect = elFloatingDpad.getBoundingClientRect();
      initialX = rect.left;
      initialY = rect.top;

      elFloatingDpad.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      if (!dragThresholdPassed && Math.hypot(dx, dy) > 8) {
        dragThresholdPassed = true;
      }

      if (dragThresholdPassed) {
        let newX = initialX + dx;
        let newY = initialY + dy;

        // Keep inside screen bounds
        newX = Math.max(0, Math.min(window.innerWidth - elFloatingDpad.offsetWidth, newX));
        newY = Math.max(0, Math.min(window.innerHeight - elFloatingDpad.offsetHeight, newY));

        elFloatingDpad.style.left = `${newX}px`;
        elFloatingDpad.style.top = `${newY}px`;
        elFloatingDpad.style.right = 'auto';
        elFloatingDpad.style.bottom = 'auto';
      }
    };

    const onPointerUp = (e) => {
      if (!isDragging) return;
      isDragging = false;
      try { elFloatingDpad.releasePointerCapture(e.pointerId); } catch (err) {}

      if (dragThresholdPassed) {
        const rect = elFloatingDpad.getBoundingClientRect();
        localStorage.setItem('tome_dpad_pos', JSON.stringify({ left: Math.round(rect.left), top: Math.round(rect.top) }));
      }
    };

    elFloatingDpad.addEventListener('pointerdown', onPointerDown);
    elFloatingDpad.addEventListener('pointermove', onPointerMove);
    elFloatingDpad.addEventListener('pointerup', onPointerUp);
    elFloatingDpad.addEventListener('pointercancel', onPointerUp);

    // Direction cells repeat hold listener
    const cells = elFloatingDpad.querySelectorAll('.f-dpad-cell');
    cells.forEach(cell => {
      const dir = cell.getAttribute('data-dir');

      const startHold = (e) => {
        if (dragThresholdPassed) return;
        cell.classList.add('active');
        handleDirection(dir);

        clearTimeout(state.repeatTimer);
        clearInterval(state.repeatInterval);

        if (dir !== '5') {
          state.repeatTimer = setTimeout(() => {
            state.repeatInterval = setInterval(() => {
              handleDirection(dir);
            }, 75);
          }, 280);
        }
      };

      const endHold = () => {
        cell.classList.remove('active');
        clearTimeout(state.repeatTimer);
        clearInterval(state.repeatInterval);
      };

      cell.addEventListener('pointerdown', startHold);
      cell.addEventListener('pointerup', endHold);
      cell.addEventListener('pointercancel', endHold);
      cell.addEventListener('pointerleave', endHold);
    });
  }

  function resetDpadPosition() {
    localStorage.removeItem('tome_dpad_pos');
    elFloatingDpad.style.left = '';
    elFloatingDpad.style.top = '';
    elFloatingDpad.style.right = '';
    elFloatingDpad.style.bottom = '';
  }

  // --- Quick Settings Modal Controller (Screenshots 2 & 3) ---
  function openQuickSettings() {
    haptic();
    elQuickSettingsModal.classList.remove('hidden-modal');
  }

  function closeQuickSettings() {
    elQuickSettingsModal.classList.add('hidden-modal');
  }

  function setupQuickSettings() {
    elBtnQuickSettings.addEventListener('click', openQuickSettings);

    const items = elQuickSettingsModal.querySelectorAll('.qs-item-btn');
    items.forEach(btn => {
      btn.addEventListener('click', () => {
        haptic();
        const action = btn.getAttribute('data-action');
        closeQuickSettings();

        switch (action) {
          case 'fit-width':
            state.fitAxis = 'width';
            adjustTerminalScale();
            break;
          case 'fit-height':
            state.fitAxis = 'height';
            adjustTerminalScale();
            break;
          case 'reset-layout':
            state.fitAxis = 'auto';
            resetDpadPosition();
            applyDockMode('overlap');
            state.showRibbon = true;
            state.showKeyboard = true;
            state.showDpad = true;
            applyVisibilityStates();
            adjustTerminalScale();
            break;
          case 'add-floating':
            const key = prompt('Enter shortcut key/command for floating button (e.g. m, f, R*):');
            if (key) {
              alert(`Floating button [${key}] created (feature stub).`);
            }
            break;
          case 'toggle-dock':
            applyDockMode(state.dockMode === 'docked' ? 'overlap' : 'docked');
            break;
          case 'toggle-ribbon':
            state.showRibbon = !state.showRibbon;
            localStorage.setItem('tome_show_ribbon', state.showRibbon);
            applyVisibilityStates();
            break;
          case 'reset-dpad':
            resetDpadPosition();
            break;
          case 'open-preferences':
            openPreferences();
            break;
          case 'open-profiles':
            alert(`Active Profile: ${state.profileMeta?.name || 'Default'}\nVariant: ${state.profileMeta?.brand?.version || '2.3.8-ah'}`);
            break;
          case 'quit-session':
            if (confirm('Restart game session?')) {
              sendJSON({ type: 'restart' });
            }
            break;
        }
      });
    });

    elQuickSettingsModal.addEventListener('click', (e) => {
      if (e.target === elQuickSettingsModal) {
        closeQuickSettings();
      }
    });
  }

  // --- Preferences Modal Controller (Screenshots 4 & 6) ---
  function openPreferences() {
    haptic();
    if (state.profileMeta) {
      elPrefProfileName.textContent = state.profileMeta.name || 'Default';
      elPrefVariantName.textContent = state.profileMeta.title || 'ToME 2.3.8 ah';
    }

    elPrefFullscreen.checked = !!document.fullscreenElement;
    elPrefEnableKeyboard.checked = state.showKeyboard;
    elPrefOverlap.checked = state.dockMode === 'overlap';
    elPrefEnableDpad.checked = state.showDpad;

    elPreferencesModal.classList.remove('hidden-modal');
  }

  function closePreferences() {
    elPreferencesModal.classList.add('hidden-modal');
  }

  function setupPreferences() {
    elBtnPrefsClose.addEventListener('click', closePreferences);

    elPrefFullscreen.addEventListener('change', () => {
      if (elPrefFullscreen.checked) {
        if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
      } else {
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      }
    });

    elPrefEnableKeyboard.addEventListener('change', () => {
      state.showKeyboard = elPrefEnableKeyboard.checked;
      localStorage.setItem('tome_show_keyboard', state.showKeyboard);
      applyVisibilityStates();
    });

    elPrefOverlap.addEventListener('change', () => {
      applyDockMode(elPrefOverlap.checked ? 'overlap' : 'docked');
    });

    elPrefEnableDpad.addEventListener('change', () => {
      state.showDpad = elPrefEnableDpad.checked;
      localStorage.setItem('tome_show_dpad', state.showDpad);
      applyVisibilityStates();
    });

    elPreferencesModal.addEventListener('click', (e) => {
      if (e.target === elPreferencesModal) {
        closePreferences();
      }
    });
  }

  function applyVisibilityStates() {
    elRibbonBar.classList.toggle('hidden-ribbon', !state.showRibbon);
    elFloatingDpad.classList.toggle('hidden-dpad', !state.showDpad);
    elKeyboardPanel.classList.toggle('hidden-panel', !state.showKeyboard);
    adjustTerminalScale();
  }

  // --- OptionPopup Modal Dialog Controller ---
  function openOptionPopup(trigger) {
    haptic();
    state.editingTrigger = trigger;
    elKeymapBadge.textContent = `Key: [ ${trigger} ]`;

    const existing = state.customKeymaps[trigger] || { action: '', alwaysVisible: false };
    elKeymapInput.value = existing.action;
    elKeymapCheck.checked = existing.alwaysVisible;

    elKeymapModal.classList.remove('hidden-modal');
    elKeymapInput.focus();
  }

  function closeOptionPopup() {
    elKeymapModal.classList.add('hidden-modal');
    state.editingTrigger = null;
  }

  function setupOptionPopup() {
    const insertButtons = elKeymapModal.querySelectorAll('.quick-insert-btn');
    insertButtons.forEach(b => {
      b.addEventListener('click', () => {
        haptic();
        const str = b.getAttribute('data-insert');
        elKeymapInput.value += str;
        elKeymapInput.focus();
      });
    });

    elBtnKeymapSave.addEventListener('click', () => {
      haptic();
      const trigger = state.editingTrigger;
      if (!trigger) return;

      const action = elKeymapInput.value.trim();
      const alwaysVisible = elKeymapCheck.checked;

      if (action.length > 0) {
        state.customKeymaps[trigger] = { action, alwaysVisible };
      } else {
        delete state.customKeymaps[trigger];
      }

      persistKeymaps();
      closeOptionPopup();
      renderKeyboard();
    });

    elBtnKeymapClear.addEventListener('click', () => {
      haptic();
      const trigger = state.editingTrigger;
      if (!trigger) return;

      delete state.customKeymaps[trigger];
      persistKeymaps();
      closeOptionPopup();
      renderKeyboard();
    });

    elBtnKeymapCancel.addEventListener('click', () => {
      closeOptionPopup();
    });

    elKeymapModal.addEventListener('click', (e) => {
      if (e.target === elKeymapModal) {
        closeOptionPopup();
      }
    });
  }

  // --- Crash Diagnostics Modal Management ---
  function showCrashModal(crashInfo) {
    state.lastCrashInfo = crashInfo;
    if (elCrashBadgeSignal) {
      elCrashBadgeSignal.textContent = crashInfo.signal || 'CRASH';
    }
    if (elCrashBadgeCode) {
      elCrashBadgeCode.textContent = 'Exit Code: ' + (crashInfo.code !== undefined ? crashInfo.code : '?');
    }
    if (elCrashTimestamp) {
      elCrashTimestamp.textContent = crashInfo.timestamp || new Date().toISOString();
    }
    if (elCrashSummary) {
      elCrashSummary.textContent = crashInfo.message || 'Engine process crashed unexpectedly.';
    }
    if (elCrashLogContent) {
      elCrashLogContent.textContent = crashInfo.stderr || '(No stderr / PTY stream captured)';
      elCrashLogContent.scrollTop = elCrashLogContent.scrollHeight;
    }
    if (elCrashModal) {
      elCrashModal.classList.remove('hidden-modal');
    }
  }

  function closeCrashModal() {
    if (elCrashModal) {
      elCrashModal.classList.add('hidden-modal');
    }
  }

  function setupCrashModal() {
    if (elBtnCrashClose) {
      elBtnCrashClose.addEventListener('click', () => {
        haptic();
        closeCrashModal();
      });
    }
    if (elCrashModal) {
      elCrashModal.addEventListener('click', (e) => {
        if (e.target === elCrashModal) {
          closeCrashModal();
        }
      });
    }

    if (elBtnCrashCopy) {
      elBtnCrashCopy.addEventListener('click', () => {
        haptic();
        const info = state.lastCrashInfo || {};
        const report = `=== TOME 2.3.8-AH CRASH REPORT ===
Timestamp:  ${info.timestamp || new Date().toISOString()}
Signal:     ${info.signal || 'None'}
Exit Code:  ${info.code !== undefined ? info.code : 'Unknown'}
Message:    ${info.message || 'Engine process crashed'}
Profile:    ${state.profileMeta?.name || 'Default'} (${state.profileMeta?.id || 'unknown'})
Executable: ${state.profileMeta?.executable || 'game/tome'}
User Agent: ${navigator.userAgent}
Viewport:   ${window.innerWidth}x${window.innerHeight}

--- Captured Terminal / Stderr Stream ---
${info.stderr || '(empty)'}
===================================`;

        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(report).then(() => {
            const orig = elBtnCrashCopy.textContent;
            elBtnCrashCopy.textContent = '✓ Copied to Clipboard!';
            setTimeout(() => { elBtnCrashCopy.textContent = orig; }, 2000);
          }).catch(() => {
            prompt('Copy crash report below:', report);
          });
        } else {
          prompt('Copy crash report below:', report);
        }
      });
    }

    if (elBtnCrashRestart) {
      elBtnCrashRestart.addEventListener('click', () => {
        haptic();
        closeCrashModal();
        if (state.term) state.term.reset();
        sendJSON({ type: 'restart' });
      });
    }
  }

  // --- Declarative Context Sniffer ---
  let contextMode = 'normal';

  function inspectScreenForContext(chunk) {
    state.recentScreenText = (state.recentScreenText + chunk).slice(-500);

    const rules = state.profileMeta?.context_rules || [
      { type: 'yes_no', pattern: '\\((y\\/n|y\\/n\\/esc|\\[y\\/n\\])\\)' }
    ];

    let matchedRule = null;
    for (const rule of rules) {
      const reg = new RegExp(rule.pattern, 'i');
      if (reg.test(state.recentScreenText)) {
        matchedRule = rule;
        break;
      }
    }

    if (matchedRule && matchedRule.type === 'yes_no' && contextMode !== 'yes_no') {
      contextMode = 'yes_no';
      elDynamicRibbon.innerHTML = `
        <button class="ribbon-btn esc-btn" data-key="\\e">⎋ Esc</button>
        <button class="ribbon-btn" style="background:#ef4444;color:#fff;" data-key="n">✖ No (n)</button>
        <button class="ribbon-btn" style="background:#00ffff;color:#000;" data-key="y">✔ Yes (y)</button>
      `;
    } else if (!matchedRule && contextMode === 'yes_no') {
      contextMode = 'normal';
      elDynamicRibbon.innerHTML = defaultDynamicRibbonHTML;
    }
  }

  // --- Dock / Overlap Mode Management ---
  function applyDockMode(mode) {
    state.dockMode = mode;
    localStorage.setItem('tome_dock_mode', mode);

    elApp.classList.remove('docked-mode', 'overlap-mode');
    elApp.classList.add(`${mode}-mode`);

    adjustTerminalScale();
  }

  function setupControls() {
    elBtnRestart.addEventListener('click', () => {
      if (confirm('Restart game session?')) {
        sendJSON({ type: 'restart' });
      }
    });

    document.addEventListener('click', (e) => {
      const keyBtn = e.target.closest('[data-key]');
      if (keyBtn) {
        haptic();
        const rawKey = keyBtn.getAttribute('data-key');
        processAction(rawKey);
      }
    });
  }

  // --- Dynamic Profile Binding & Startup ---
  async function loadProfileAndInit() {
    try {
      const res = await fetch('/api/profile');
      if (res.ok) {
        state.profileMeta = await res.json();
      }
    } catch (err) {
      console.warn('Could not fetch /api/profile:', err);
    }

    if (state.profileMeta) {
      if (state.profileMeta.title) document.title = state.profileMeta.title;
      const logoEl = document.querySelector('#top-bar .brand .logo');
      const verEl = document.querySelector('#top-bar .brand .version');
      if (logoEl && state.profileMeta.brand?.logo) logoEl.textContent = state.profileMeta.brand.logo;
      if (verEl && state.profileMeta.brand?.version) verEl.textContent = state.profileMeta.brand.version;
    }

    const kbdConfigPath = state.profileMeta?.keyboard_config || 'keyboards.json';
    try {
      const kbdRes = await fetch(kbdConfigPath);
      state.keyboardsData = await kbdRes.json();
    } catch (err) {
      console.error('Failed to load keyboard configuration:', err);
    }

    loadPersistedKeymaps();
    applyDockMode(state.dockMode);
    setupControls();
    setupQuickSettings();
    setupPreferences();
    setupOptionPopup();
    setupCrashModal();
    setupFloatingDpad();
    applyVisibilityStates();
    initTerminal();
    renderKeyboard();
    connectWebSocket();
  }

  window.addEventListener('DOMContentLoaded', () => {
    loadProfileAndInit();
  });

})();
