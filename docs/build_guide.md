# ToME 2.3.8-ah Termux Native Build Guide

## 1. Overview
This project targets running ToME 2.3.8-ah (Tales of Middle-earth) natively in the Termux Linux environment (aarch64 Android) without relying on Android APK packaging, NDK JNI bridges, or Java/Gradle layers.

## 2. Build Toolchain & Dependencies
- **Compiler**: Clang (LLVM / Termux package `clang`)
- **Build System**: GNU Make (`make`)
- **Libraries**:
  - `libncursesw` (wide-character curses library, Termux package `ncurses`)
  - `libm` (standard math library)
- **Runtime / Test Tools**: Python 3 (for automated PTY smoke testing)

## 3. Architecture & Frontend Separation
- **Upstream Curses Frontend**: The native terminal frontend uses `main-gcu.c` (`-DUSE_GCU`), which interacts with standard curses/ncurses terminal interfaces.
- **Android JNI Layer Omission**: Angbandroid's JNI wrappers (`main-android.c`, `droid.c`, Android Java UI) were removed from the native build target.
- **Embedded Lua Engine**: ToME 2.3.8 bundles Lua 4.0 and `tolua` in `game/src/lua/`. On 64-bit platforms (ARM64), `__LP64__` correctly configures integer sizes (`s32b`).
- **Data/Library Path**: `TOME_PATH` environment variable or default `./lib/` path resolves game modules, scripts, help files, and pref tables in `game/lib/`.

## 4. Key Compiler Flags
```makefile
CC ?= clang
CFLAGS ?= -Wall -O2 -pipe -g
DEFINES = -DUSE_GCU -DUSE_NCURSES -DUSE_TPOSIX -DUSE_CURS_SET -DUSE_LUA \
          -Wno-format-security -Wno-parentheses-equality \
          -Wno-implicit-function-declaration -Wno-deprecated-non-prototype \
          -Wno-incompatible-pointer-types -Wno-format -Wno-return-type \
          -DDEFAULT_PATH=\"./lib/\"
INCLUDES = -I. -Ilua $(shell pkg-config --cflags ncursesw)
LIBS = $(shell pkg-config --libs ncursesw) -lm
```

## 5. Verification & Testing
Run automated PTY smoke test:
```bash
./scripts/test.sh
```
This tests command line argument parsing (`--help`), module selection initialization (`-n`), and clean terminal restoration on exit.
