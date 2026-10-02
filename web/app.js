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

  const FUNCTION_KEY_MAP = {
    f1: '\x1bOP',
    f2: '\x1bOQ',
    f3: '\x1bOR',
    f4: '\x1bOS',
    f5: '\x1b[15~',
    f6: '\x1b[17~',
    f7: '\x1b[18~',
    f8: '\x1b[19~',
    f9: '\x1b[20~',
    f10: '\x1b[21~',
    f11: '\x1b[23~',
    f12: '\x1b[24~'
  };

  const SPECIAL_TOKEN_MAP = {
    esc: '\x1b',
    escape: '\x1b',
    enter: '\r',
    ret: '\r',
    return: '\r',
    tab: '\t',
    space: ' ',
    spc: ' ',
    bs: '\x7f',
    backspace: '\x7f',
    wait: '.',
    rest: '.',
    target: '*',
    redraw: '\x12',
    save: '\x13',
    quit: '\x18'
  };

  const DEFAULT_FLOATING_BUTTONS = [
    { id: 'fb_1', label: 'F1', action: '{F1}', left: null, top: null },
    { id: 'fb_2', label: 'Rest', action: 'R&\\n', left: null, top: null }
  ];

  const DEFAULT_RIBBON_BUTTONS = [
    { label: "💤 Rest", action: "R&\\n" },
    { label: "🎒 Inven", action: "i" },
    { label: "✨ Magic", action: "m" },
    { label: "🗑 Drop", action: "d" },
    { label: "👁 Look", action: "l" },
    { label: "🎯 Target", action: "*" },
    { label: "🏹 Fire", action: "f" },
    { label: "✋ Pickup", action: "g" },
    { label: "⚔ Wield", action: "w" },
    { label: "🧪 Quaff", action: "q" },
    { label: "📜 Read", action: "r" },
    { label: "🪄 Use", action: "u" },
    { label: "🗺 Map", action: "M" }
  ];

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
    keyboardStyle: localStorage.getItem('tome_keyboard_style') || 'adv', // 'adv' | 'simple'
    customKeymaps: {},
    floatingButtons: [],
    customRibbon: [],
    customPresets: [],
    editorTarget: null,
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
  const elBrandProfileBtn = document.getElementById('brand-profile-btn');
  const elBrandLogo = document.getElementById('brand-logo');
  const elBrandVersion = document.getElementById('brand-version');
  const elIndShift = document.getElementById('ind-shift');
  const elIndLock = document.getElementById('ind-lock');
  const elIndRun = document.getElementById('ind-run');
  const elBtnToggleKeyboard = document.getElementById('btn-toggle-keyboard');
  const elBtnSwitchKbdStyle = document.getElementById('btn-switch-kbd-style');
  const elBtnQuickSettings = document.getElementById('btn-quick-settings');
  const elBtnRedraw = document.getElementById('btn-redraw');
  const elBtnRestart = document.getElementById('btn-restart');
  const elKeyboardPanel = document.getElementById('keyboard-panel');
  const elFloatingDpad = document.getElementById('floating-dpad');
  const elFloatingButtonsLayer = document.getElementById('floating-buttons-layer');
  const elRibbonBar = document.getElementById('ribbon-bar');
  const elDynamicRibbon = document.getElementById('dynamic-ribbon');
  const elTerminalWrapper = document.getElementById('terminal-wrapper');

  // Quick Settings Modal
  const elQuickSettingsModal = document.getElementById('quick-settings-modal');

  // Game Profiles Modal
  const elProfilesModal = document.getElementById('profiles-modal');
  const elBtnProfilesClose = document.getElementById('btn-profiles-close');
  const elBtnProfilesDone = document.getElementById('btn-profiles-done');
  const elProfilesList = document.getElementById('profiles-list');

  // Manage Floating Buttons Modal
  const elManageFbModal = document.getElementById('manage-fb-modal');
  const elBtnManageFbClose = document.getElementById('btn-manage-fb-close');
  const elBtnManageFbDone = document.getElementById('btn-manage-fb-done');
  const elBtnFbAddNew = document.getElementById('btn-fb-add-new');
  const elBtnFbDeleteAll = document.getElementById('btn-fb-delete-all');
  const elManageFbList = document.getElementById('manage-fb-list');
  const elFbCountBadge = document.getElementById('fb-count-badge');

  // Presets Modal
  const elPresetsModal = document.getElementById('presets-modal');
  const elBtnPresetsClose = document.getElementById('btn-presets-close');
  const elBtnPresetsDone = document.getElementById('btn-presets-done');
  const elPresetNameInput = document.getElementById('preset-name-input');
  const elBtnPresetSave = document.getElementById('btn-preset-save');
  const elPresetsList = document.getElementById('presets-list');

  // Preferences Modal
  const elPreferencesModal = document.getElementById('preferences-modal');
  const elBtnPrefsClose = document.getElementById('btn-prefs-close');
  const elPrefProfileName = document.getElementById('pref-profile-name');
  const elPrefVariantName = document.getElementById('pref-variant-name');
  const elPrefFullscreen = document.getElementById('pref-fullscreen');
  const elPrefEnableKeyboard = document.getElementById('pref-enable-keyboard');
  const elPrefOverlap = document.getElementById('pref-overlap');
  const elPrefEnableDpad = document.getElementById('pref-enable-dpad');

  // Button & Keymap Editor Modal
  const elKeymapModal = document.getElementById('keymap-modal');
  const elEditorModalTitle = document.getElementById('editor-modal-title');
  const elKeymapBadge = document.getElementById('keymap-trigger-badge');
  const elEditorLabelGroup = document.getElementById('editor-label-group');
  const elKeymapLabelInput = document.getElementById('keymap-label-input');
  const elKeymapInput = document.getElementById('keymap-action-input');
  const elEditorGhostRow = document.getElementById('editor-ghost-row');
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

  // --- Persistence Engines (Keymaps, Floating Buttons, Custom Ribbon) ---
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

  function loadFloatingButtons() {
    const raw = localStorage.getItem('tome_floating_buttons');
    if (raw) {
      try {
        state.floatingButtons = JSON.parse(raw);
        if (!Array.isArray(state.floatingButtons)) state.floatingButtons = [];
      } catch (e) {
        state.floatingButtons = JSON.parse(JSON.stringify(DEFAULT_FLOATING_BUTTONS));
      }
    } else {
      state.floatingButtons = JSON.parse(JSON.stringify(DEFAULT_FLOATING_BUTTONS));
    }
  }

  function persistFloatingButtons() {
    localStorage.setItem('tome_floating_buttons', JSON.stringify(state.floatingButtons));
  }

  function loadCustomRibbon() {
    const raw = localStorage.getItem('tome_custom_ribbon');
    if (raw) {
      try {
        state.customRibbon = JSON.parse(raw);
        if (!Array.isArray(state.customRibbon)) state.customRibbon = [];
      } catch (e) {
        state.customRibbon = JSON.parse(JSON.stringify(DEFAULT_RIBBON_BUTTONS));
      }
    } else {
      state.customRibbon = JSON.parse(JSON.stringify(DEFAULT_RIBBON_BUTTONS));
    }
  }

  function persistRibbon() {
    localStorage.setItem('tome_custom_ribbon', JSON.stringify(state.customRibbon));
  }

  // --- Built-in & Custom Presets Management ---
  const BUILTIN_PRESETS = [
    {
      id: 'builtin_default',
      name: 'Default',
      isBuiltin: true,
      desc: 'Standard 5x10 AdvKeyboard + Default Ribbon & Shortcuts',
      keyboardStyle: 'adv',
      showKeyboard: true,
      showDpad: true,
      dockMode: 'overlap',
      floatingButtons: DEFAULT_FLOATING_BUTTONS,
      customRibbon: DEFAULT_RIBBON_BUTTONS,
      customKeymaps: {}
    },
    {
      id: 'builtin_minimal_touch',
      name: 'Minimal Touch',
      isBuiltin: true,
      desc: 'Maximized Screen, Hidden Keyboard, D-Pad + 4 Quick Action Badges',
      keyboardStyle: 'adv',
      showKeyboard: false,
      showDpad: true,
      dockMode: 'overlap',
      floatingButtons: [
        { id: 'fb_f1', label: 'F1', action: '{F1}', left: 16, top: 120 },
        { id: 'fb_f2', label: 'F2', action: '{F2}', left: 16, top: 175 },
        { id: 'fb_inv', label: '🎒 Inven', action: 'i', left: null, top: null },
        { id: 'fb_rest', label: '💤 Rest', action: 'R&\n', left: null, top: null }
      ],
      customRibbon: DEFAULT_RIBBON_BUTTONS,
      customKeymaps: {}
    },
    {
      id: 'builtin_compact_simple',
      name: 'Compact 3-Row',
      isBuiltin: true,
      desc: 'Slim 3-Row Keyboard (High Viewport) + Direction Pad & Floating Badges',
      keyboardStyle: 'simple',
      showKeyboard: true,
      showDpad: true,
      dockMode: 'overlap',
      floatingButtons: DEFAULT_FLOATING_BUTTONS,
      customRibbon: DEFAULT_RIBBON_BUTTONS,
      customKeymaps: {}
    }
  ];

  function loadCustomPresets() {
    const raw = localStorage.getItem('tome_presets');
    if (raw) {
      try {
        state.customPresets = JSON.parse(raw);
        if (!Array.isArray(state.customPresets)) state.customPresets = [];
      } catch (e) {
        state.customPresets = [];
      }
    } else {
      state.customPresets = [];
    }
  }

  function persistCustomPresets() {
    localStorage.setItem('tome_presets', JSON.stringify(state.customPresets));
  }

  function openPresetsModal() {
    haptic();
    loadCustomPresets();
    renderPresetsList();
    if (elPresetNameInput) elPresetNameInput.value = '';
    if (elPresetsModal) elPresetsModal.classList.remove('hidden-modal');
  }

  function closePresetsModal() {
    if (elPresetsModal) elPresetsModal.classList.add('hidden-modal');
  }

  function renderPresetsList() {
    if (!elPresetsList) return;
    elPresetsList.innerHTML = '';

    const allPresets = [...BUILTIN_PRESETS, ...state.customPresets];

    allPresets.forEach(preset => {
      const card = document.createElement('div');
      card.className = 'preset-card';

      const info = document.createElement('div');
      info.className = 'preset-info';

      const titleRow = document.createElement('div');
      titleRow.className = 'preset-title-row';

      const nameEl = document.createElement('span');
      nameEl.className = 'preset-name';
      nameEl.textContent = preset.name;
      titleRow.appendChild(nameEl);

      const tag = document.createElement('span');
      tag.className = 'preset-tag ' + (preset.isBuiltin ? 'tag-builtin' : 'tag-custom');
      tag.textContent = preset.isBuiltin ? 'Built-in' : 'Custom';
      titleRow.appendChild(tag);

      info.appendChild(titleRow);

      const descEl = document.createElement('div');
      descEl.className = 'preset-desc';
      descEl.textContent = preset.desc || (preset.keyboardStyle === 'simple' ? '3-Row Simple' : '5x10 Adv');
      info.appendChild(descEl);

      card.appendChild(info);

      const actions = document.createElement('div');
      actions.className = 'preset-actions';

      const applyBtn = document.createElement('button');
      applyBtn.type = 'button';
      applyBtn.className = 'modal-btn btn-primary btn-sm';
      applyBtn.textContent = '🔄 Apply';
      applyBtn.addEventListener('click', () => {
        haptic();
        applyPreset(preset);
      });
      actions.appendChild(applyBtn);

      if (!preset.isBuiltin) {
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'modal-btn btn-danger btn-sm';
        delBtn.textContent = '✕';
        delBtn.title = 'Delete preset';
        delBtn.addEventListener('click', () => {
          haptic();
          if (confirm(`Delete preset "${preset.name}"?`)) {
            state.customPresets = state.customPresets.filter(p => p.id !== preset.id);
            persistCustomPresets();
            renderPresetsList();
          }
        });
        actions.appendChild(delBtn);
      }

      card.appendChild(actions);
      elPresetsList.appendChild(card);
    });
  }

  function applyPreset(preset) {
    if (preset.keyboardStyle) {
      state.keyboardStyle = preset.keyboardStyle;
      localStorage.setItem('tome_keyboard_style', state.keyboardStyle);
    }
    if (preset.showKeyboard !== undefined) {
      state.showKeyboard = preset.showKeyboard;
      localStorage.setItem('tome_show_keyboard', state.showKeyboard);
    }
    if (preset.showDpad !== undefined) {
      state.showDpad = preset.showDpad;
      localStorage.setItem('tome_show_dpad', state.showDpad);
    }
    if (preset.dockMode) {
      applyDockMode(preset.dockMode);
    }
    if (preset.floatingButtons) {
      state.floatingButtons = JSON.parse(JSON.stringify(preset.floatingButtons));
      persistFloatingButtons();
      renderFloatingButtons();
    }
    if (preset.customRibbon) {
      state.customRibbon = JSON.parse(JSON.stringify(preset.customRibbon));
      persistRibbon();
      renderDynamicRibbon();
    }
    if (preset.customKeymaps) {
      state.customKeymaps = JSON.parse(JSON.stringify(preset.customKeymaps));
      persistKeymaps();
    }

    applyVisibilityStates();
    updateKeyboardToggleBtn();
    updateKeyboardStyleBtn();
    renderKeyboard();
    adjustTerminalScale();
    closePresetsModal();
  }

  function saveCurrentAsPreset() {
    const rawName = elPresetNameInput ? elPresetNameInput.value.trim() : '';
    const name = rawName || ('Preset ' + (state.customPresets.length + 1));
    const kbdDesc = state.keyboardStyle === 'simple' ? '3-Row Compact' : '5x10 Adv';
    const fbCount = state.floatingButtons.length;
    const rbCount = state.customRibbon.length;

    const newPreset = {
      id: 'preset_' + Date.now(),
      name: name,
      isBuiltin: false,
      desc: `${kbdDesc}, ${fbCount} floating btns, ${rbCount} ribbon items`,
      keyboardStyle: state.keyboardStyle,
      showKeyboard: state.showKeyboard,
      showDpad: state.showDpad,
      dockMode: state.dockMode,
      floatingButtons: JSON.parse(JSON.stringify(state.floatingButtons)),
      customRibbon: JSON.parse(JSON.stringify(state.customRibbon)),
      customKeymaps: JSON.parse(JSON.stringify(state.customKeymaps))
    };

    state.customPresets.push(newPreset);
    persistCustomPresets();
    renderPresetsList();
    if (elPresetNameInput) elPresetNameInput.value = '';
  }

  function setupPresetsModal() {
    if (elBtnPresetsClose) elBtnPresetsClose.addEventListener('click', closePresetsModal);
    if (elBtnPresetsDone) elBtnPresetsDone.addEventListener('click', closePresetsModal);
    if (elBtnPresetSave) {
      elBtnPresetSave.addEventListener('click', () => {
        haptic();
        saveCurrentAsPreset();
      });
    }
    if (elPresetNameInput) {
      elPresetNameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          haptic();
          saveCurrentAsPreset();
        }
      });
    }
    if (elPresetsModal) {
      elPresetsModal.addEventListener('click', (e) => {
        if (e.target === elPresetsModal) closePresetsModal();
      });
    }
  }

  // --- Manage Floating Buttons Modal Controller ---
  function openManageFbModal() {
    haptic();
    renderManageFbList();
    if (elManageFbModal) elManageFbModal.classList.remove('hidden-modal');
  }

  function closeManageFbModal() {
    if (elManageFbModal) elManageFbModal.classList.add('hidden-modal');
  }

  function renderManageFbList() {
    if (!elManageFbList) return;
    elManageFbList.innerHTML = '';

    if (elFbCountBadge) {
      elFbCountBadge.textContent = `Active Buttons (${state.floatingButtons.length})`;
    }

    if (state.floatingButtons.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'manage-fb-empty';
      empty.textContent = 'No floating buttons yet. Tap "➕ Add New" to create one.';
      elManageFbList.appendChild(empty);
      return;
    }

    state.floatingButtons.forEach((fb, idx) => {
      const item = document.createElement('div');
      item.className = 'manage-fb-item';

      const info = document.createElement('div');
      info.className = 'manage-fb-info';

      const main = document.createElement('div');
      main.className = 'manage-fb-main';

      const badge = document.createElement('span');
      badge.className = 'manage-fb-badge';
      badge.textContent = fb.label || 'Btn';
      main.appendChild(badge);

      const action = document.createElement('span');
      action.className = 'manage-fb-action';
      action.textContent = fb.action;
      action.title = fb.action;
      main.appendChild(action);

      info.appendChild(main);

      const pos = document.createElement('div');
      pos.className = 'manage-fb-pos';
      pos.textContent = `Pos: (${Math.round(fb.left || 0)}, ${Math.round(fb.top || 0)})`;
      info.appendChild(pos);

      item.appendChild(info);

      const actions = document.createElement('div');
      actions.className = 'manage-fb-actions';

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'modal-btn btn-secondary btn-sm';
      editBtn.textContent = '✏️ Edit';
      editBtn.addEventListener('click', () => {
        haptic();
        closeManageFbModal();
        openButtonEditor({
          type: 'floating',
          index: idx,
          id: fb.id,
          isNew: false,
          label: fb.label,
          action: fb.action,
          left: fb.left,
          top: fb.top
        });
      });
      actions.appendChild(editBtn);

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'modal-btn btn-danger btn-sm';
      delBtn.textContent = '🗑️ Delete';
      delBtn.addEventListener('click', () => {
        haptic();
        state.floatingButtons.splice(idx, 1);
        persistFloatingButtons();
        renderFloatingButtons();
        renderManageFbList();
      });
      actions.appendChild(delBtn);

      item.appendChild(actions);
      elManageFbList.appendChild(item);
    });
  }

  function setupManageFbModal() {
    if (elBtnManageFbClose) elBtnManageFbClose.addEventListener('click', closeManageFbModal);
    if (elBtnManageFbDone) elBtnManageFbDone.addEventListener('click', closeManageFbModal);
    if (elBtnFbAddNew) {
      elBtnFbAddNew.addEventListener('click', () => {
        haptic();
        closeManageFbModal();
        openButtonEditor({ type: 'floating', isNew: true });
      });
    }
    if (elBtnFbDeleteAll) {
      elBtnFbDeleteAll.addEventListener('click', () => {
        haptic();
        if (state.floatingButtons.length === 0) return;
        if (confirm('Delete all floating buttons?')) {
          state.floatingButtons = [];
          persistFloatingButtons();
          renderFloatingButtons();
          renderManageFbList();
        }
      });
    }
    if (elManageFbModal) {
      elManageFbModal.addEventListener('click', (e) => {
        if (e.target === elManageFbModal) closeManageFbModal();
      });
    }
  }

  // --- Keyboard Visibility & Style Controllers ---
  function toggleKeyboardVisibility() {
    haptic();
    state.showKeyboard = !state.showKeyboard;
    localStorage.setItem('tome_show_keyboard', state.showKeyboard);
    applyVisibilityStates();
    if (state.showKeyboard) {
      renderKeyboard();
    }
  }

  function updateKeyboardToggleBtn() {
    if (!elBtnToggleKeyboard) return;
    elBtnToggleKeyboard.classList.toggle('active-toggled', !state.showKeyboard);
    elBtnToggleKeyboard.title = state.showKeyboard ? 'Toggle Keyboard (Hide)' : 'Toggle Keyboard (Show)';
  }

  function switchKeyboardStyle(forcedStyle) {
    haptic();
    if (forcedStyle) {
      state.keyboardStyle = forcedStyle;
    } else {
      state.keyboardStyle = state.keyboardStyle === 'simple' ? 'adv' : 'simple';
    }
    localStorage.setItem('tome_keyboard_style', state.keyboardStyle);
    updateKeyboardStyleBtn();
    renderKeyboard();
  }

  function updateKeyboardStyleBtn() {
    if (!elBtnSwitchKbdStyle) return;
    if (state.keyboardStyle === 'simple') {
      elBtnSwitchKbdStyle.textContent = '3-Row';
      elBtnSwitchKbdStyle.title = 'Keyboard: Simple 3-Row (Tap for 5x10 Adv)';
    } else {
      elBtnSwitchKbdStyle.textContent = '5x10';
      elBtnSwitchKbdStyle.title = 'Keyboard: Adv 5x10 (Tap for Simple 3-Row)';
    }
  }

  // --- Game Profiles Switcher Controller ---
  async function openProfilesModal() {
    haptic();
    if (elProfilesModal) elProfilesModal.classList.remove('hidden-modal');
    await renderProfilesList();
  }

  function closeProfilesModal() {
    if (elProfilesModal) elProfilesModal.classList.add('hidden-modal');
  }

  async function renderProfilesList() {
    if (!elProfilesList) return;
    elProfilesList.innerHTML = '<div style="color: var(--fg-dim); font-size: 12px; padding: 12px; text-align: center;">Loading profiles...</div>';

    try {
      const res = await fetch('/api/profiles');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const profiles = await res.json();
      elProfilesList.innerHTML = '';

      profiles.forEach(p => {
        const card = document.createElement('div');
        const isActive = p.active || (state.profileMeta && p.id === state.profileMeta.id);
        card.className = 'profile-select-card' + (isActive ? ' active-profile' : '');

        const left = document.createElement('div');
        left.className = 'profile-card-left';

        const header = document.createElement('div');
        header.className = 'profile-card-header';

        const logo = document.createElement('span');
        logo.className = 'profile-card-logo';
        logo.textContent = p.brand?.logo || '🎮';
        header.appendChild(logo);

        const name = document.createElement('span');
        name.className = 'profile-card-name';
        name.textContent = p.name || p.id;
        header.appendChild(name);

        left.appendChild(header);

        const desc = document.createElement('div');
        desc.className = 'profile-card-desc';
        desc.textContent = p.title || (p.id === 'tomenet' ? 'Real-time Multiplayer Roguelike C/S' : 'Classic Single Player Roguelike');
        left.appendChild(desc);

        card.appendChild(left);

        const badge = document.createElement('span');
        badge.className = 'profile-card-badge ' + (isActive ? 'badge-active' : 'badge-switch');
        badge.textContent = isActive ? 'Active ✓' : 'Switch 🎮';
        card.appendChild(badge);

        card.addEventListener('click', () => {
          if (!isActive) {
            switchProfile(p.id);
          } else {
            closeProfilesModal();
          }
        });

        elProfilesList.appendChild(card);
      });
    } catch (err) {
      elProfilesList.innerHTML = `<div style="color: #fca5a5; font-size: 12px; padding: 12px; text-align: center;">Failed to load profiles: ${err.message}</div>`;
    }
  }

  async function switchProfile(profileId) {
    haptic();
    closeProfilesModal();
    updateStatus(`Switching to ${profileId}...`, false);

    try {
      const res = await fetch(`/api/switch_profile?id=${encodeURIComponent(profileId)}`);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      state.profileMeta = data.active_profile;

      // Update UI title and brand
      if (state.profileMeta) {
        if (state.profileMeta.title) document.title = state.profileMeta.title;
        if (elBrandLogo) elBrandLogo.textContent = state.profileMeta.brand?.logo || '⚡ Game';
        if (elBrandVersion) elBrandVersion.textContent = state.profileMeta.brand?.version || '';
        if (elPrefProfileName) elPrefProfileName.textContent = state.profileMeta.name || 'Default';
        if (elPrefVariantName) elPrefVariantName.textContent = state.profileMeta.title || state.profileMeta.name;
      }

      // Reconnect websocket with clean terminal
      if (state.ws) {
        try { state.ws.close(); } catch (e) {}
        state.ws = null;
      }
      if (state.term) {
        state.term.reset();
      }

      connectWebSocket();
      adjustTerminalScale();
    } catch (err) {
      alert(`Failed to switch profile: ${err.message}`);
    }
  }

  function setupProfilesModal() {
    if (elBrandProfileBtn) {
      elBrandProfileBtn.addEventListener('click', openProfilesModal);
    }
    if (elBtnProfilesClose) elBtnProfilesClose.addEventListener('click', closeProfilesModal);
    if (elBtnProfilesDone) elBtnProfilesDone.addEventListener('click', closeProfilesModal);
    if (elProfilesModal) {
      elProfilesModal.addEventListener('click', (e) => {
        if (e.target === elProfilesModal) closeProfilesModal();
      });
    }
  }

  // --- Terminal Initialization & Viewport Auto-Fitter ---
  function initTerminal() {
    const defaultCols = state.profileMeta?.geometry?.cols || 80;
    const defaultRows = state.profileMeta?.geometry?.rows || 24;

    const term = new Terminal({
      cols: defaultCols,
      rows: defaultRows,
      cursorBlink: false,
      fontFamily: '"DejaVu Sans Mono", "Courier New", "Liberation Mono", monospace',
      fontSize: 13,
      lineHeight: 1.15,
      letterSpacing: 0,
      windowsPty: false,
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
      triggerAutoRedraw(150);
    });
    window.addEventListener('orientationchange', () => {
      setTimeout(() => {
        adjustTerminalScale();
        renderKeyboard();
        triggerAutoRedraw(150);
      }, 150);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        adjustTerminalScale();
        triggerAutoRedraw(80);
      }
    });

    adjustTerminalScale();
  }

  let autoRedrawTimer = null;
  function triggerAutoRedraw(delay = 120) {
    if (autoRedrawTimer) clearTimeout(autoRedrawTimer);
    autoRedrawTimer = setTimeout(() => {
      if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        sendRaw('\x12'); // Ctrl+R full redraw
      }
    }, delay);
  }

  /**
   * Precise 80x24 Viewport Auto-Fitter with Fit Width & Fit Height support.
   * Strictly clamps geometry to 80x24 for ToME to prevent tile shifts and wrapping corruption.
   */
  function adjustTerminalScale() {
    if (!state.term) return;

    const cw = elTerminalWrapper.clientWidth - 2;
    const ch = elTerminalWrapper.clientHeight - 2;
    if (cw <= 0 || ch <= 0) return;

    const isPortrait = window.innerHeight > window.innerWidth;
    const charAspect = 0.58;
    const lineHeight = 1.15;
    const targetCols = state.profileMeta?.geometry?.cols || 80;
    const targetRows = state.profileMeta?.geometry?.rows || 24;
    const isFixedGeometry = state.profileMeta?.fixed_geometry !== false;

    let optimalFontSize;

    if (state.fitAxis === 'width' || (state.fitAxis === 'auto' && isPortrait)) {
      // Fit Width: targetCols must fill cw perfectly
      optimalFontSize = Math.floor(cw / (targetCols * charAspect));
    } else if (state.fitAxis === 'height' || (state.fitAxis === 'auto' && !isPortrait)) {
      // Fit Height: targetRows must fill ch perfectly
      optimalFontSize = Math.floor(ch / (targetRows * lineHeight));
    } else {
      // Both (contain)
      const byW = Math.floor(cw / (targetCols * charAspect));
      const byH = Math.floor(ch / (targetRows * lineHeight));
      optimalFontSize = Math.min(byW, byH);
    }

    optimalFontSize = Math.max(9, Math.min(32, optimalFontSize));

    if (state.term.options.fontSize !== optimalFontSize) {
      state.term.options.fontSize = optimalFontSize;
    }

    if (isFixedGeometry) {
      // Strict 80x24 grid: never allow xterm.js or PTY to diverge from 80x24!
      if (state.term.cols !== targetCols || state.term.rows !== targetRows) {
        state.term.resize(targetCols, targetRows);
      }
      if (state.lastCols !== targetCols || state.lastRows !== targetRows) {
        state.lastCols = targetCols;
        state.lastRows = targetRows;
        sendJSON({ type: 'resize', cols: targetCols, rows: targetRows });
      }
    } else {
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
  }

  // --- WebSocket Connection ---
  function connectWebSocket() {
    if (state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const profileId = state.profileMeta?.id || 'default';
    const wsUrl = `${proto}//${window.location.host}/ws?session=${encodeURIComponent(profileId)}&profile=${encodeURIComponent(profileId)}`;

    updateStatus('Connecting...', false);
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      updateStatus('Connected', true);
      sendJSON({ type: 'resize', cols: state.lastCols, rows: state.lastRows });
      adjustTerminalScale();
      triggerAutoRedraw(120);
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

  // --- Input Resolution Engine (InputUtils.java & Function Key / Macro Parser) ---
  function parseActionString(txt) {
    if (!txt) return '';

    // Standalone F1 ~ F12 shorthand without braces
    const trimmed = txt.trim().toLowerCase();
    if (FUNCTION_KEY_MAP[trimmed]) {
      return FUNCTION_KEY_MAP[trimmed];
    }

    const result = [];
    let i = 0;
    const n = txt.length;

    while (i < n) {
      const ch0 = txt.charAt(i);

      // Handle {TOKEN} (e.g. {F1}, {F12}, {ESC}, {ENTER}, {SPACE}, {TAB}, etc.)
      if (ch0 === '{') {
        const closeIdx = txt.indexOf('}', i + 1);
        if (closeIdx !== -1) {
          const token = txt.substring(i + 1, closeIdx).trim().toLowerCase();
          if (FUNCTION_KEY_MAP[token]) {
            result.push(FUNCTION_KEY_MAP[token]);
            i = closeIdx + 1;
            continue;
          } else if (SPECIAL_TOKEN_MAP[token] !== undefined) {
            result.push(SPECIAL_TOKEN_MAP[token]);
            i = closeIdx + 1;
            continue;
          }
        }
      }

      // Handle ^X (Control key shortcuts like ^S, ^X, ^R, ^A-Z)
      const next = (i + 1 < n) ? txt.charAt(i + 1) : '';
      if (ch0 === '^' && /[a-zA-Z]/.test(next)) {
        const code = next.toUpperCase().charCodeAt(0) - 64;
        result.push(String.fromCharCode(code));
        i += 2;
        continue;
      }

      // Handle \n, \r, \e, \t, \s, \b escape sequences
      if (ch0 === '\\') {
        switch (next.toLowerCase()) {
          case 'n': result.push('\r'); break;
          case 'r': result.push('\r'); break;
          case 'e': result.push('\x1b'); break;
          case 't': result.push('\t'); break;
          case 's': result.push(' '); break;
          case 'b': result.push('\x7f'); break;
          default: result.push(next); break;
        }
        i += 2;
        continue;
      }

      result.push(ch0);
      i += 1;
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

    if (defaultValue === InputUtils.Escape || defaultValue === '⎋') {
      sendRaw('\x1b');
      exitShiftMode();
      resetPage();
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

  // --- Render Layout from keyboards.json (5x10 Adv or 3-Row Simple Layout) ---
  function renderKeyboard() {
    if (!state.keyboardsData || !state.showKeyboard) {
      elKeyboardPanel.classList.add('hidden-panel');
      adjustTerminalScale();
      return;
    }

    elKeyboardPanel.classList.remove('hidden-panel');
    elKeyboardPanel.innerHTML = '';

    const isSimple = state.keyboardStyle === 'simple';
    elKeyboardPanel.classList.toggle('simple-keyboard', isSimple);

    const isPortrait = window.innerHeight > window.innerWidth;
    let orientationKey;
    if (isSimple) {
      orientationKey = isPortrait ? 'simple_portrait' : 'simple_landscape';
      if (!state.keyboardsData[orientationKey]) {
        orientationKey = state.keyboardsData['simple_landscape'] ? 'simple_landscape' : (isPortrait ? 'portrait' : 'landscape');
      }
    } else {
      orientationKey = isPortrait ? 'portrait' : 'landscape';
    }

    const orientationConfig = state.keyboardsData[orientationKey] || state.keyboardsData['landscape'];
    const pageIndex = isSimple ? 0 : (state.page || 0);
    const pageData = orientationConfig.pages[pageIndex] || orientationConfig.pages[0];

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

  // --- Floating Action Buttons System (Draggable Touch Shortcuts & F-Keys) ---
  function renderFloatingButtons() {
    if (!elFloatingButtonsLayer) return;
    elFloatingButtonsLayer.innerHTML = '';

    state.floatingButtons.forEach((fb, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'floating-action-btn';
      btn.setAttribute('data-fb-id', fb.id);
      btn.textContent = fb.label || 'Btn';
      btn.title = `${fb.label || 'Btn'}: ${fb.action} (Hold to edit/drag)`;

      let left = fb.left;
      let top = fb.top;
      if (left == null || top == null) {
        left = Math.max(10, window.innerWidth - 75);
        top = Math.max(60, Math.min(window.innerHeight - 100, 160 + idx * 56));
        fb.left = left;
        fb.top = top;
      }
      btn.style.left = `${left}px`;
      btn.style.top = `${top}px`;

      bindFloatingButtonEvents(btn, fb);
      elFloatingButtonsLayer.appendChild(btn);
    });
  }

  function bindFloatingButtonEvents(btn, fb) {
    let isDragging = false;
    let dragThresholdPassed = false;
    let isLongPress = false;
    let startX = 0;
    let startY = 0;
    let initialX = 0;
    let initialY = 0;
    let longPressTimer = null;

    const onPointerDown = (e) => {
      isDragging = true;
      dragThresholdPassed = false;
      isLongPress = false;
      startX = e.clientX;
      startY = e.clientY;

      const rect = btn.getBoundingClientRect();
      initialX = rect.left;
      initialY = rect.top;

      try { btn.setPointerCapture(e.pointerId); } catch (err) {}
      btn.classList.add('pressed');

      clearTimeout(longPressTimer);
      longPressTimer = setTimeout(() => {
        if (!dragThresholdPassed) {
          isLongPress = true;
          haptic();
          btn.classList.remove('pressed');
          openButtonEditor({ type: 'floating', id: fb.id, isNew: false });
        }
      }, 1000);
    };

    const onPointerMove = (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      if (!dragThresholdPassed && Math.hypot(dx, dy) > 6) {
        dragThresholdPassed = true;
        clearTimeout(longPressTimer);
      }

      if (dragThresholdPassed) {
        let newX = initialX + dx;
        let newY = initialY + dy;

        newX = Math.max(0, Math.min(window.innerWidth - btn.offsetWidth, newX));
        newY = Math.max(0, Math.min(window.innerHeight - btn.offsetHeight, newY));

        btn.style.left = `${newX}px`;
        btn.style.top = `${newY}px`;
        fb.left = Math.round(newX);
        fb.top = Math.round(newY);
      }
    };

    const onPointerUp = (e) => {
      if (!isDragging) return;
      isDragging = false;
      clearTimeout(longPressTimer);
      btn.classList.remove('pressed');

      try { btn.releasePointerCapture(e.pointerId); } catch (err) {}

      if (dragThresholdPassed) {
        persistFloatingButtons();
      } else if (!isLongPress) {
        haptic();
        processAction(fb.action);
      }
    };

    btn.addEventListener('pointerdown', onPointerDown);
    btn.addEventListener('pointermove', onPointerMove);
    btn.addEventListener('pointerup', onPointerUp);
    btn.addEventListener('pointercancel', onPointerUp);
  }

  // --- Dynamic Action Ribbon Controller ---
  function renderDynamicRibbon() {
    if (!elDynamicRibbon) return;
    if (contextMode === 'yes_no') return;

    elDynamicRibbon.innerHTML = '';
    state.customRibbon.forEach((rb, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ribbon-btn';
      if (rb.action && (rb.action.includes('\n') || rb.action.includes('\\n'))) {
        btn.classList.add('macro-btn');
      }
      btn.setAttribute('data-key', rb.action);
      btn.setAttribute('data-ribbon-idx', idx);
      btn.textContent = rb.label;

      bindRibbonButtonEvents(btn, idx, rb);
      elDynamicRibbon.appendChild(btn);
    });

    // Append '+' Add Ribbon Button
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'ribbon-btn ribbon-add-btn';
    addBtn.id = 'btn-ribbon-add';
    addBtn.title = 'Add Ribbon Button';
    addBtn.textContent = '➕';
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      haptic();
      openButtonEditor({ type: 'ribbon', isNew: true });
    });
    elDynamicRibbon.appendChild(addBtn);
  }

  function bindRibbonButtonEvents(btn, idx, rb) {
    let longPressTimer = null;
    let didLongPress = false;

    const onPointerDown = () => {
      didLongPress = false;
      clearTimeout(longPressTimer);
      longPressTimer = setTimeout(() => {
        didLongPress = true;
        haptic();
        openButtonEditor({ type: 'ribbon', index: idx, isNew: false, label: rb.label, action: rb.action });
      }, 1000);
    };

    const onPointerUp = () => {
      clearTimeout(longPressTimer);
    };

    btn.addEventListener('pointerdown', onPointerDown);
    btn.addEventListener('pointerup', onPointerUp);
    btn.addEventListener('pointercancel', onPointerUp);
    btn.addEventListener('pointerleave', onPointerUp);

    btn.addEventListener('click', (e) => {
      if (didLongPress) {
        e.stopImmediatePropagation();
        didLongPress = false;
      }
    });
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
          case 'toggle-keyboard':
            toggleKeyboardVisibility();
            break;
          case 'switch-keyboard-style':
            switchKeyboardStyle();
            break;
          case 'manage-floating':
            openManageFbModal();
            break;
          case 'open-presets':
            openPresetsModal();
            break;
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
            state.keyboardStyle = 'adv';
            localStorage.setItem('tome_keyboard_style', 'adv');
            updateKeyboardToggleBtn();
            updateKeyboardStyleBtn();
            applyVisibilityStates();
            renderKeyboard();
            adjustTerminalScale();
            break;
          case 'add-floating':
            openButtonEditor({ type: 'floating', isNew: true });
            break;
          case 'reset-ribbon':
            state.customRibbon = JSON.parse(JSON.stringify(DEFAULT_RIBBON_BUTTONS));
            persistRibbon();
            renderDynamicRibbon();
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
            openProfilesModal();
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
    updateKeyboardToggleBtn();
    if (elPrefEnableKeyboard) {
      elPrefEnableKeyboard.checked = state.showKeyboard;
    }
    adjustTerminalScale();
  }

  // --- Universal Button & Macro Editor Controller ---
  function openOptionPopup(trigger) {
    openButtonEditor({ type: 'key', trigger: trigger });
  }

  function closeOptionPopup() {
    closeButtonEditor();
  }

  function insertIntoActionInput(str) {
    const input = elKeymapInput;
    const start = input.selectionStart || 0;
    const end = input.selectionEnd || 0;
    const val = input.value;
    input.value = val.substring(0, start) + str + val.substring(end);
    input.selectionStart = input.selectionEnd = start + str.length;
    input.focus();
  }

  function openButtonEditor(target) {
    haptic();
    state.editorTarget = target;

    elKeymapInput.value = '';
    if (elKeymapLabelInput) elKeymapLabelInput.value = '';
    if (elKeymapCheck) elKeymapCheck.checked = false;

    if (target.type === 'key') {
      const trigger = target.trigger;
      state.editingTrigger = trigger;
      if (elEditorModalTitle) elEditorModalTitle.textContent = '⚙ Keymap Editor';
      elKeymapBadge.textContent = `Key: [ ${trigger} ]`;
      if (elEditorLabelGroup) elEditorLabelGroup.style.display = 'none';
      if (elEditorGhostRow) elEditorGhostRow.style.display = 'flex';
      elBtnKeymapClear.textContent = 'Clear Keymap';
      elBtnKeymapClear.style.display = 'inline-block';
      elBtnKeymapSave.textContent = 'Save Keymap';

      const existing = state.customKeymaps[trigger] || { action: '', alwaysVisible: false };
      elKeymapInput.value = existing.action;
      if (elKeymapCheck) elKeymapCheck.checked = existing.alwaysVisible;
    } else if (target.type === 'floating') {
      if (elEditorModalTitle) elEditorModalTitle.textContent = target.isNew ? '➕ Add Floating Button' : '⚙ Edit Floating Button';
      elKeymapBadge.textContent = target.isNew ? 'Floating Button (New)' : 'Floating Button';
      if (elEditorLabelGroup) elEditorLabelGroup.style.display = 'flex';
      if (elEditorGhostRow) elEditorGhostRow.style.display = 'none';
      elBtnKeymapClear.textContent = '🗑️ Delete Button';
      elBtnKeymapClear.style.display = target.isNew ? 'none' : 'inline-block';
      elBtnKeymapSave.textContent = 'Save Button';

      if (!target.isNew) {
        const fb = state.floatingButtons.find(b => b.id === target.id);
        if (fb) {
          if (elKeymapLabelInput) elKeymapLabelInput.value = fb.label;
          elKeymapInput.value = fb.action;
        }
      }
    } else if (target.type === 'ribbon') {
      if (elEditorModalTitle) elEditorModalTitle.textContent = target.isNew ? '➕ Add Ribbon Button' : '⚙ Edit Ribbon Button';
      elKeymapBadge.textContent = target.isNew ? 'Ribbon Button (New)' : `Ribbon Button #${target.index + 1}`;
      if (elEditorLabelGroup) elEditorLabelGroup.style.display = 'flex';
      if (elEditorGhostRow) elEditorGhostRow.style.display = 'none';
      elBtnKeymapClear.textContent = '🗑️ Delete from Ribbon';
      elBtnKeymapClear.style.display = target.isNew ? 'none' : 'inline-block';
      elBtnKeymapSave.textContent = 'Save Button';

      if (!target.isNew) {
        const rb = state.customRibbon[target.index];
        if (rb) {
          if (elKeymapLabelInput) elKeymapLabelInput.value = rb.label;
          elKeymapInput.value = rb.action;
        }
      }
    }

    elKeymapModal.classList.remove('hidden-modal');
    if (target.type !== 'key' && elKeymapLabelInput && !elKeymapLabelInput.value) {
      elKeymapLabelInput.focus();
    } else {
      elKeymapInput.focus();
    }
  }

  function closeButtonEditor() {
    elKeymapModal.classList.add('hidden-modal');
    state.editorTarget = null;
    state.editingTrigger = null;
  }

  function setupButtonEditor() {
    // F-Keys Palette Buttons (F1 ~ F12)
    const fkeyBtns = elKeymapModal.querySelectorAll('.fkey-btn');
    fkeyBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        haptic();
        const fkey = btn.getAttribute('data-fkey');
        const token = btn.getAttribute('data-insert') || `{${fkey}}`;
        insertIntoActionInput(token);

        if (elKeymapLabelInput && (!elKeymapLabelInput.value || /^F[0-9]{1,2}$/i.test(elKeymapLabelInput.value.trim()))) {
          elKeymapLabelInput.value = fkey;
        }
      });
    });

    // Special Keys Buttons
    const specialBtns = elKeymapModal.querySelectorAll('.special-btn');
    specialBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        haptic();
        const str = btn.getAttribute('data-insert');
        insertIntoActionInput(str);
      });
    });

    // Control & Macro Template Chips
    const macroChips = elKeymapModal.querySelectorAll('.macro-chip');
    macroChips.forEach(btn => {
      btn.addEventListener('click', () => {
        haptic();
        const str = btn.getAttribute('data-insert');
        const label = btn.getAttribute('data-label');
        insertIntoActionInput(str);
        if (elKeymapLabelInput && !elKeymapLabelInput.value && label) {
          elKeymapLabelInput.value = label;
        }
      });
    });

    // Save Button
    elBtnKeymapSave.addEventListener('click', () => {
      haptic();
      const target = state.editorTarget;
      if (!target) return;

      const action = elKeymapInput.value.trim();
      const label = elKeymapLabelInput ? elKeymapLabelInput.value.trim() : '';
      const alwaysVisible = elKeymapCheck ? elKeymapCheck.checked : false;

      if (target.type === 'key') {
        const trigger = target.trigger;
        if (action.length > 0) {
          state.customKeymaps[trigger] = { action, alwaysVisible };
        } else {
          delete state.customKeymaps[trigger];
        }
        persistKeymaps();
        renderKeyboard();
      } else if (target.type === 'floating') {
        if (action.length > 0) {
          if (target.isNew) {
            const newId = 'fb_' + Date.now();
            const defLeft = Math.max(10, window.innerWidth - 75);
            const defTop = Math.max(60, Math.min(window.innerHeight - 100, 160 + state.floatingButtons.length * 56));
            state.floatingButtons.push({
              id: newId,
              label: label || action,
              action: action,
              left: defLeft,
              top: defTop
            });
          } else {
            const fb = state.floatingButtons.find(b => b.id === target.id);
            if (fb) {
              fb.label = label || action;
              fb.action = action;
            }
          }
          persistFloatingButtons();
          renderFloatingButtons();
          if (elManageFbModal && !elManageFbModal.classList.contains('hidden-modal')) {
            renderManageFbList();
          }
        }
      } else if (target.type === 'ribbon') {
        if (action.length > 0) {
          if (target.isNew) {
            state.customRibbon.push({
              label: label || action,
              action: action
            });
          } else {
            if (state.customRibbon[target.index]) {
              state.customRibbon[target.index] = {
                label: label || action,
                action: action
              };
            }
          }
          persistRibbon();
          renderDynamicRibbon();
        }
      }

      closeButtonEditor();
    });

    // Delete / Clear Button
    elBtnKeymapClear.addEventListener('click', () => {
      haptic();
      const target = state.editorTarget;
      if (!target) return;

      if (target.type === 'key') {
        const trigger = target.trigger;
        delete state.customKeymaps[trigger];
        persistKeymaps();
        renderKeyboard();
      } else if (target.type === 'floating') {
        if (!target.isNew) {
          state.floatingButtons = state.floatingButtons.filter(b => b.id !== target.id);
          persistFloatingButtons();
          renderFloatingButtons();
          if (elManageFbModal && !elManageFbModal.classList.contains('hidden-modal')) {
            renderManageFbList();
          }
        }
      } else if (target.type === 'ribbon') {
        if (!target.isNew && target.index >= 0) {
          state.customRibbon.splice(target.index, 1);
          persistRibbon();
          renderDynamicRibbon();
        }
      }

      closeButtonEditor();
    });

    // Cancel Button
    elBtnKeymapCancel.addEventListener('click', () => {
      closeButtonEditor();
    });

    // Backdrop Click
    elKeymapModal.addEventListener('click', (e) => {
      if (e.target === elKeymapModal) {
        closeButtonEditor();
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
      renderDynamicRibbon();
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
    if (elBtnToggleKeyboard) {
      elBtnToggleKeyboard.addEventListener('click', toggleKeyboardVisibility);
    }

    if (elBtnSwitchKbdStyle) {
      elBtnSwitchKbdStyle.addEventListener('click', () => switchKeyboardStyle());
    }

    if (elBtnRedraw) {
      elBtnRedraw.addEventListener('click', () => {
        haptic();
        sendRaw('\x12'); // Ctrl+R full redraw
      });
    }

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

    window.addEventListener('resize', () => {
      // Re-clamp floating buttons to viewport
      state.floatingButtons.forEach(fb => {
        if (fb.left != null) {
          fb.left = Math.max(0, Math.min(window.innerWidth - 60, fb.left));
        }
        if (fb.top != null) {
          fb.top = Math.max(0, Math.min(window.innerHeight - 60, fb.top));
        }
      });
      renderFloatingButtons();
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
    loadFloatingButtons();
    loadCustomRibbon();
    loadCustomPresets();
    applyDockMode(state.dockMode);
    setupControls();
    setupQuickSettings();
    setupPreferences();
    setupButtonEditor();
    setupManageFbModal();
    setupPresetsModal();
    setupProfilesModal();
    setupCrashModal();
    setupFloatingDpad();
    renderFloatingButtons();
    renderDynamicRibbon();
    applyVisibilityStates();
    updateKeyboardToggleBtn();
    updateKeyboardStyleBtn();
    initTerminal();
    renderKeyboard();
    connectWebSocket();
  }

  window.addEventListener('DOMContentLoaded', () => {
    loadProfileAndInit();
  });

})();
