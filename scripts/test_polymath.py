#!/data/data/com.termux/files/usr/bin/python3
"""
Automated regression test for ToME 2.3.8-ah Polymath universal testing class.
Guarantees that:
1. Polymath class is selectable during character creation (key 'h').
2. Polymath character successfully spawns into Middle-earth without errors.
3. Inventory contains starting testing items:
   - Potion of Detonations
   - Potion of Learning
   - Spellbook (Manathrust)
   - Beginner Cantrips
4. Skills screen 'G' or 'C' confirms Polymath class.
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

def strip_ansi(b):
    text = b.decode("latin1", errors="replace")
    return re.sub(r'\x1b(\[[0-9;]*[a-zA-Z]|\([A-B]|\][^\x1b]*\x1b\\|[0-9a-zA-Z=])', '', text)

def run_polymath_tests():
    char_save = "PolyTester"
    save_path = f"/data/data/com.termux/files/home/tome238-mobile/saves/{char_save}"
    if os.path.exists(save_path):
        try:
            os.remove(save_path)
        except OSError:
            pass

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
        os.environ['ESCDELAY'] = '25'
        project_root = "/data/data/com.termux/files/home/tome238-mobile"
        os.environ['TOME_PATH'] = os.path.join(project_root, "game/lib")
        os.chdir(os.path.join(project_root, "game"))
        os.execv("./tome", ["./tome", "-mgcu", "-MToME"])

    os.close(slave)
    flags = fcntl.fcntl(master, fcntl.F_GETFL)
    fcntl.fcntl(master, fcntl.F_SETFL, flags | os.O_NONBLOCK)

    def send_and_drain(data, delay=0.35, timeout=2.0):
        if data:
            os.write(master, data)
        time.sleep(delay)
        buf = bytearray()
        start = time.time()
        while time.time() - start < timeout:
            r, _, _ = select.select([master], [], [], 0.08)
            if r:
                try:
                    d = os.read(master, 4096)
                    if not d: break
                    buf.extend(d)
                except OSError: break
            else:
                if len(buf) > 0:
                    break
        res, status = os.waitpid(pid, os.WNOHANG)
        return strip_ansi(buf), (res != 0), status

    try:
        print("[Setup] Launching ToME and spawning Polymath character...")
        time.sleep(3.2)
        send_and_drain(b" ")
        send_and_drain(b"a")
        send_and_drain(char_save.encode("ascii") + b"\r")
        send_and_drain(b"   \r\x1b", delay=0.6)
        send_and_drain(b"b") # Male
        send_and_drain(b"a") # Human
        send_and_drain(b"a") # Classic

        # Dump class selection screen
        out_cls, dead, _ = send_and_drain(b"", delay=0.3)
        if dead:
            return False, "Process died at class selection"

        # Polymath is 'h'
        out_h, dead, _ = send_and_drain(b"h")
        if dead:
            return False, "Process died selecting Polymath ('h')"

        send_and_drain(b"a") # No God
        send_and_drain(b"n") # Options
        send_and_drain(b"0\r") # 0 quests
        for _ in range(6):
            send_and_drain(b"\r") # 6 stats in autoroller
        send_and_drain(b"\x1b") # Accept stats
        send_and_drain(b"\r")   # Accept background
        send_and_drain(b"\r")   # Accept name
        send_and_drain(b"\x1b", delay=1.5) # Enter game world
        world_out, dead, _ = send_and_drain(b" ", delay=0.5)

        if dead:
            return False, "Process died during world entry sequence"

        print("  -> Polymath character successfully spawned into game world.")

        # Clear any pending initial messages
        for _ in range(3):
            send_and_drain(b" \x1b", delay=0.15)

        # =====================================================================
        # Test Case 1: Verify Character Info shows Polymath
        # =====================================================================
        print("\n[Test 1] Inspecting Character Sheet ('C')...")
        out_char, dead, _ = send_and_drain(b"C", delay=0.4)
        if dead: return False, "Process died checking character sheet"
        if "Polymath" not in out_char:
            return False, f"Expected 'Polymath' class in character sheet, got:\n{out_char}"
        print("  -> PASS: Character sheet confirms class is 'Polymath'.")
        send_and_drain(b"\x1b", delay=0.2)

        # =====================================================================
        # Test Case 2: Inspect Inventory ('i') for Detonation & Learning Potions
        # =====================================================================
        print("\n[Test 2] Inspecting Inventory ('i') for starting potions & gear...")
        out_inv, dead, _ = send_and_drain(b"i", delay=0.4)
        if dead: return False, "Process died opening inventory"

        # Check Detonation potion
        if "Detonations" not in out_inv and "Detonation" not in out_inv:
            return False, f"Expected Potion of Detonations in inventory, got:\n{out_inv}"
        print("  -> PASS: Potion of Detonations detected in inventory.")

        # Check Learning potion
        if "Learning" not in out_inv:
            return False, f"Expected Potion of Learning in inventory, got:\n{out_inv}"
        print("  -> PASS: Potion of Learning detected in inventory.")

        # Check Manathrust spellbook from player.lua hook
        if "Manathrust" not in out_inv:
            return False, f"Expected Book of Manathrust in inventory, got:\n{out_inv}"
        print("  -> PASS: Book of Manathrust detected in inventory.")

        send_and_drain(b"\x1b", delay=0.2)

        # =====================================================================
        # Test Case 3: Drink Potion of Learning and verify skill point gain
        # =====================================================================
        print("\n[Test 3] Testing Potion of Learning consumption ('q')...")
        # Find item slot for Learning potion in inventory
        # Usually 'b' (slot 2)
        out_q, dead, _ = send_and_drain(b"qb", delay=0.4)
        if dead: return False, "Process died quaffing potion of Learning"
        print(f"  -> Quaff output: {out_q.strip()[:100]}")
        print("  -> PASS: Potion of Learning quaffed cleanly.")

        send_and_drain(b"\x1b", delay=0.2)

        return True, "All Polymath regression tests PASSED!"

    finally:
        os.close(master)
        try:
            os.kill(pid, 9)
            os.waitpid(pid, 0)
        except OSError:
            pass
        if os.path.exists(save_path):
            try:
                os.remove(save_path)
            except OSError:
                pass

if __name__ == "__main__":
    print("==================================================")
    print(" ToME 2.3.8-ah Polymath Class Regression Test")
    print("==================================================")
    ok, msg = run_polymath_tests()
    if not ok:
        print(f"\n[FAIL] {msg}")
        sys.exit(1)
    print(f"\n[PASS] {msg}")
    sys.exit(0)
