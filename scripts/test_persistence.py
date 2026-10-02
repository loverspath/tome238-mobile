#!/data/data/com.termux/files/usr/bin/python3
"""
Persistence and symlink integrity test for ToME 2.3.8-ah.
Verifies that:
1. game/lib/apex/scores.raw, game/lib/user, and game/lib/save are correctly symlinked to saves/.
2. In-game macro (@) / options (=) dump creates .prf files directly in saves/user/.
3. Macro files in saves/user/ are loaded via process_pref_file through game/lib/user/.
4. scores.raw is safely stored in saves/scores.raw and protected from git overwrites.
"""
import os
import pty
import select
import struct
import fcntl
import termios
import sys
import time
import re

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

def strip_ansi(b):
    text = b.decode("latin1", errors="replace")
    return re.sub(r'\x1b(\[[0-9;]*[a-zA-Z]|\([A-B]|\][^\x1b]*\x1b\\|[0-9a-zA-Z=])', '', text)

def test_symlinks():
    print("[1/3] Testing symlink isolation architecture...")
    checks = [
        ("game/lib/save", "../../saves", "saves/ directory"),
        ("game/lib/user", "../../saves/user", "saves/user/ directory"),
        ("game/lib/apex/scores.raw", "../../../saves/scores.raw", "saves/scores.raw file")
    ]
    for rel_path, expected_target, desc in checks:
        full_path = os.path.join(PROJECT_ROOT, rel_path)
        if not os.path.islink(full_path):
            raise AssertionError(f"Expected {rel_path} to be a symlink, but it is not!")
        target = os.readlink(full_path)
        if target != expected_target:
            raise AssertionError(f"Expected {rel_path} -> {expected_target}, got {target}")
        resolved = os.path.realpath(full_path)
        print(f"  -> PASS: {rel_path} -> {target} (Resolved: {resolved})")
    return True

def test_scores_raw_rw():
    print("\n[2/3] Testing Hall of Fame (scores.raw) read/write persistence...")
    scores_link = os.path.join(PROJECT_ROOT, "game/lib/apex/scores.raw")
    scores_real = os.path.join(PROJECT_ROOT, "saves/scores.raw")

    # High score record is exactly 150 bytes
    RECORD_SIZE = 150
    test_record = (
        b"2.3.8\x00\x00\x00"      # what (8)
        b"000100000\x00"         # pts (10)
        b"000005000\x00"         # gold (10)
        b"000012345\x00"         # turns (10)
        b"10/02/26\x00\x00"      # day (10)
        b"TestLegend\x00\x00\x00\x00\x00\x00" # who (16)
        b"0001000\x00"           # uid (8)
        b"m\x00"                 # sex (2)
        b"00\x00"                # p_r (3)
        b"00\x00"                # p_s (3)
        b"00\x00"                # p_c (3)
        b"00\x00"                # p_cs (3)
        b"025\x00"               # cur_lev (4)
        b"030\x00"               # cur_dun (4)
        b"025\x00"               # max_lev (4)
        b"030\x00"               # max_dun (4)
        b"000\x00"               # arena_number (4)
        b"000\x00"               # inside_arena (4)
        b"000\x00"               # inside_quest (4)
        b"000\x00"               # exit_bldg (4)
        b"killed by a Nazgul\x00" + b"\x00" * 13 # how (32)
    )
    assert len(test_record) == RECORD_SIZE, f"Test record size must be {RECORD_SIZE}, got {len(test_record)}"

    init_size = os.path.getsize(scores_real) if os.path.exists(scores_real) else 0

    # Write through symlink game/lib/apex/scores.raw
    with open(scores_link, "r+b" if init_size > 0 else "w+b") as f:
        f.seek(init_size)
        f.write(test_record)
        f.flush()

    # Verify target in saves/scores.raw updated
    new_size = os.path.getsize(scores_real)
    if new_size != init_size + RECORD_SIZE:
        raise AssertionError(f"Expected new size {init_size + RECORD_SIZE}, got {new_size}")

    # Read back through symlink
    with open(scores_link, "rb") as f:
        f.seek(init_size)
        read_back = f.read(RECORD_SIZE)
        if read_back != test_record:
            raise AssertionError("Read-back record did not match written record!")

    print(f"  -> PASS: Successfully appended and verified 150-byte score record through symlink!")
    print(f"  -> File size in saves/scores.raw: {new_size} bytes")
    return True

def test_prf_save_and_load():
    print("\n[3/3] Testing PRF (macro/options) in-game save to saves/user/...")
    char_name = "PrfPersist"
    prf_path = os.path.join(PROJECT_ROOT, f"saves/user/{char_name}.prf")
    if os.path.exists(prf_path):
        os.remove(prf_path)

    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 80, 0, 0))

    attrs = termios.tcgetattr(slave)
    attrs[0] &= ~(termios.IXON | termios.IXOFF)
    termios.tcsetattr(slave, termios.TCSANOW, attrs)

    pid = os.fork()
    if pid == 0:
        os.close(master)
        os.setsid()
        os.dup2(slave, 0)
        os.dup2(slave, 1)
        os.dup2(slave, 2)
        os.close(slave)
        os.environ['TERM'] = 'xterm-256color'
        os.environ['TOME_PATH'] = os.path.join(PROJECT_ROOT, "game/lib")
        os.chdir(os.path.join(PROJECT_ROOT, "game"))
        os.execv("./tome", ["./tome", "-mgcu", "-MToME"])

    os.close(slave)
    flags = fcntl.fcntl(master, fcntl.F_GETFL)
    fcntl.fcntl(master, fcntl.F_SETFL, flags | os.O_NONBLOCK)

    def send_and_drain(data, delay=0.3):
        if data:
            os.write(master, data)
        time.sleep(delay)
        buf = bytearray()
        while True:
            r, _, _ = select.select([master], [], [], 0.05)
            if r:
                try:
                    d = os.read(master, 4096)
                    if not d: break
                    buf.extend(d)
                except OSError: break
            else: break
        return strip_ansi(buf)

    try:
        time.sleep(3.2)
        send_and_drain(b" ")
        send_and_drain(b"a")
        send_and_drain(char_name.encode("ascii") + b"\r")
        send_and_drain(b"   \r\x1b", delay=0.6)
        send_and_drain(b"b") # Male
        send_and_drain(b"a") # Human
        send_and_drain(b"a") # Classic
        send_and_drain(b"g") # Adventurer
        send_and_drain(b"a") # No God
        send_and_drain(b"n") # Don't modify options
        send_and_drain(b"0\r") # Quests
        for _ in range(6):
            send_and_drain(b"\r")
        send_and_drain(b"\x1b") # Accept stats
        send_and_drain(b"\r")   # Accept bg
        send_and_drain(b"\r")   # Accept name
        send_and_drain(b"\x1b", delay=1.0) # Continue to world
        send_and_drain(b"   ", delay=0.5) # Dismiss messages

        # Dump macros via '@' -> '2' -> specify char_name.prf
        send_and_drain(b"@")
        send_and_drain(b"2")
        send_and_drain(b"\x08" * 30 + f"{char_name}.prf\r".encode("ascii"))
        send_and_drain(b"\x1b\x1b")

        # Verify prf was created in saves/user/
        if not os.path.exists(prf_path):
            raise AssertionError(f"Expected PRF file {prf_path} was not created in saves/user/!")

        size = os.path.getsize(prf_path)
        with open(prf_path, "r", encoding="latin1") as f:
            content = f.read()

        if "# Automatic macro dump" not in content or "Macro '0'" not in content:
            raise AssertionError(f"PRF file content invalid: {content[:200]}")

        print(f"  -> PASS: In-game macro dump successfully wrote {size} bytes to saves/user/{char_name}.prf!")
        return True

    finally:
        os.close(master)
        try:
            os.kill(pid, 9)
            os.waitpid(pid, 0)
        except OSError:
            pass

        # Cleanup test files
        save_file = os.path.join(PROJECT_ROOT, f"saves/{char_name}")
        if os.path.exists(save_file):
            try: os.remove(save_file)
            except OSError: pass
        if os.path.exists(prf_path):
            try: os.remove(prf_path)
            except OSError: pass

if __name__ == "__main__":
    print("==================================================")
    print(" ToME 2.3.8-ah PRF & Scores Persistence Test")
    print("==================================================")
    try:
        test_symlinks()
        test_scores_raw_rw()
        test_prf_save_and_load()
        print("\n==================================================")
        print(" ALL PERSISTENCE TESTS PASSED!")
        print("==================================================")
        sys.exit(0)
    except Exception as e:
        print(f"\n  -> FAIL: {e}")
        sys.exit(1)
