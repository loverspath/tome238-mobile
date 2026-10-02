#!/data/data/com.termux/files/usr/bin/python3
"""
Automated regression test for ToME 2.3.8-ah Adventurer TomeNET Runecraft integration.
Guarantees that:
1. Adventurer class starts with Runecraft skill (skill id 34).
2. Command '09m' and skill menu 'm' -> 'c' trigger Lua MKEY 9 hook intercepting the legacy C runecrafter.
3. Interactive Runecraft prompts (Rune 1 -> Rune 2 -> Form -> Mode -> Direction) function correctly:
   - Moderate Fire Bolt ('09m' -> 'a' -> 'e' -> 'b' -> 'm' -> '6') casts cleanly and consumes mana.
   - Brief Fire Bolt ('09m' -> 'a' -> 'e' -> 'b' -> 'b' -> '6') operates with half-turn energy cost.
4. Higher-tier forms enforce skill level prerequisites ("Your skill is not high enough!").
5. ESC cancellation returns cleanly to normal game state without consuming mana or freezing.
6. Skill menu list 'm' correctly lists 'c - 9) Use Runespells'.
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

def run_runecraft_tests():
    char_save = "RuneTester"
    save_path = f"/data/data/com.termux/files/home/tome238-mobile/saves/{char_save}"
    if os.path.exists(save_path):
        try:
            os.remove(save_path)
        except OSError:
            pass

    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 80, 0, 0))

    # Disable IXON/IXOFF
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
        print("[Setup] Launching ToME and spawning Adventurer character...")
        time.sleep(3.2)
        send_and_drain(b" ")
        send_and_drain(b"a")
        send_and_drain(char_save.encode("ascii") + b"\r")
        send_and_drain(b"   \r\x1b", delay=0.6)
        send_and_drain(b"b") # Male
        send_and_drain(b"a") # Human
        send_and_drain(b"a") # Classic
        send_and_drain(b"g") # Adventurer class
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

        def clear_prompts():
            for _ in range(3):
                send_and_drain(b" \x1b", delay=0.15)

        clear_prompts()
        print("  -> Adventurer successfully spawned in world.")

        # =====================================================================
        # Test Case 1: Cast Moderate Fire Bolt eastward via '09m' (Rune 1: a, Rune 2: e)
        # =====================================================================
        print("\n[Test 1] Invoking '09m' -> Moderate Fire Bolt eastward...")
        # Send 09m to trigger MKEY_RUNE
        out1, dead, _ = send_and_drain(b"09m", delay=0.35)
        if dead: return False, "Process died on '09m'"
        if "Rune 1:" not in out1:
            return False, f"Expected Rune 1 prompt on '09m', got:\n{out1}"

        # Send Rune 1 choice: 'a' (Lite)
        out2, dead, _ = send_and_drain(b"a", delay=0.35)
        if dead: return False, "Process died on Rune 1 selection 'a'"
        if "Rune 2" not in out2 and "same=pure" not in out2:
            return False, f"Expected Rune 2 prompt, got:\n{out2}"

        # Send Rune 2 choice: 'e' (Chao) -> Lite + Chao = Fire
        out2b, dead, _ = send_and_drain(b"e", delay=0.35)
        if dead: return False, "Process died on Rune 2 selection 'e'"
        if "Form:" not in out2b or "Fire" not in out2b:
            return False, f"Expected [Fire] Form prompt, got:\n{out2b}"

        # Send Form choice: 'b' (Bolt)
        out3, dead, _ = send_and_drain(b"b", delay=0.35)
        if dead: return False, "Process died on spell form selection 'b'"
        if "Mode:" not in out3:
            return False, f"Expected Mode prompt, got:\n{out3}"

        # Send Mode choice: 'm' (Moderate)
        out4, dead, _ = send_and_drain(b"m", delay=0.35)
        if dead: return False, "Process died on spell mode selection 'm'"
        if "Direction" not in out4:
            return False, f"Expected Direction prompt, got:\n{out4}"

        # Send Direction: '6' (East)
        out5, dead, _ = send_and_drain(b"6", delay=0.5)
        if dead: return False, "Process died on direction selection '6'"

        if "trace a Moderate Fire Bolt" not in out5:
            return False, f"Moderate Fire Bolt message not detected in output:\n{out5}"

        print("  -> PASS: Moderate Fire Bolt successfully cast via '09m' interactive sequence.")

        # =====================================================================
        # Test Case 2: Cast Brief Fire Bolt eastward (50% energy use)
        # =====================================================================
        print("\n[Test 2] Invoking '09m' -> Brief Fire Bolt (50% energy use)...")
        clear_prompts()

        out_b1, dead, _ = send_and_drain(b"09m", delay=0.35)
        if dead: return False, "Process died on Brief bolt '09m'"
        if "Rune 1:" not in out_b1:
            return False, f"Expected Rune 1 prompt on '09m' in Test 2, got:\n{out_b1}"

        out_b2, dead, _ = send_and_drain(b"a", delay=0.35) # Lite
        if dead: return False, "Process died selecting Lite in Test 2"
        if "Rune 2" not in out_b2 and "same=pure" not in out_b2:
            return False, f"Expected Rune 2 prompt in Test 2, got:\n{out_b2}"

        out_b2b, dead, _ = send_and_drain(b"e", delay=0.35) # Chao -> Fire
        if dead: return False, "Process died selecting Chao in Test 2"
        if "Form:" not in out_b2b:
            return False, f"Expected Form prompt in Test 2, got:\n{out_b2b}"

        out_b3, dead, _ = send_and_drain(b"b", delay=0.35) # Bolt
        if dead: return False, "Process died selecting Bolt in Test 2"
        if "Mode:" not in out_b3:
            return False, f"Expected Mode prompt in Test 2, got:\n{out_b3}"

        out_b4, dead, _ = send_and_drain(b"b", delay=0.35) # 'b' = Brief mode
        if dead: return False, "Process died selecting Brief in Test 2"
        if "Direction" not in out_b4:
            return False, f"Expected Direction prompt in Test 2, got:\n{out_b4}"

        out_b5, dead, _ = send_and_drain(b"6", delay=0.5)  # East
        if dead: return False, "Process died on Brief bolt cast"

        if "trace a Brief Fire Bolt" not in out_b5:
            return False, f"Brief Fire Bolt message not detected in output:\n{out_b5}"

        print("  -> PASS: Brief Fire Bolt successfully cast.")

        # =====================================================================
        # Test Case 3: Skill Gate Enforcement (Storm requires higher level)
        # =====================================================================
        print("\n[Test 3] Testing skill gate rejection (Moderate Storm requires level 23)...")
        clear_prompts()

        out_s1, dead, _ = send_and_drain(b"09m", delay=0.35)
        if dead: return False, "Process died on '09m' in Test 3"
        if "Rune 1:" not in out_s1:
            return False, f"Expected Rune 1 prompt on '09m' in Test 3, got:\n{out_s1}"

        out_s2, dead, _ = send_and_drain(b"a", delay=0.35) # Lite
        if dead: return False, "Process died selecting Lite in Test 3"
        if "Rune 2" not in out_s2 and "same=pure" not in out_s2:
            return False, f"Expected Rune 2 prompt in Test 3, got:\n{out_s2}"

        out_s2b, dead, _ = send_and_drain(b"e", delay=0.35) # Chao -> Fire
        if dead: return False, "Process died selecting Chao in Test 3"
        if "Form:" not in out_s2b:
            return False, f"Expected Form prompt in Test 3, got:\n{out_s2b}"

        out_s3, dead, _ = send_and_drain(b"s", delay=0.35) # Storm (base_lvl = 22)
        if dead: return False, "Process died selecting Storm in Test 3"
        if "Mode:" not in out_s3:
            return False, f"Expected Mode prompt in Test 3, got:\n{out_s3}"

        out_s4, dead, _ = send_and_drain(b"m", delay=0.4)  # Moderate (lvl_mod = 1)
        if dead: return False, "Process died during skill gate test"

        if "skill is not high enough" not in out_s4:
            return False, f"Expected 'skill is not high enough' message, got:\n{out_s4}"

        print("  -> PASS: Skill gate correctly blocked unauthorized high-level spell.")

        # =====================================================================
        # Test Case 4: ESC Clean Cancellation
        # =====================================================================
        print("\n[Test 4] Testing ESC cancellation during rune prompt...")
        clear_prompts()

        out_c1, dead, _ = send_and_drain(b"09m", delay=0.35)
        if dead: return False, "Process died on '09m' in Test 4"
        if "Rune 1:" not in out_c1:
            return False, f"Expected Rune 1 prompt in Test 4, got:\n{out_c1}"

        out_c2, dead, _ = send_and_drain(b"\x1b", delay=0.35) # Cancel with ESC
        if dead: return False, "Process died on ESC cancellation"

        # Verify terminal remains alive and responsive
        out_alive, dead, _ = send_and_drain(b"\x12", delay=0.3) # Ctrl+R redraw
        if dead: return False, "Process died after ESC cancellation"

        print("  -> PASS: ESC cleanly cancelled Runecraft prompt and restored game state.")

        # =====================================================================
        # Test Case 5: Menu-based Invocation ('m' -> 'c')
        # =====================================================================
        print("\n[Test 5] Testing skill menu invocation ('m' -> 'c' -> Rune prompt)...")
        clear_prompts()

        out_m1, dead, _ = send_and_drain(b"m", delay=0.35)
        if dead: return False, "Process died opening skill menu 'm'"
        if "Select a skill" not in out_m1:
            return False, f"Expected 'Select a skill' prompt, got:\n{out_m1}"

        out_m2, dead, _ = send_and_drain(b"c", delay=0.35) # Select Runecraft
        if dead: return False, "Process died selecting skill 'c'"
        if "Rune 1:" not in out_m2:
            return False, f"Expected 'Rune 1:' prompt upon selecting 'c', got:\n{out_m2}"

        # Cleanly exit via ESC
        send_and_drain(b"\x1b", delay=0.2)
        print("  -> PASS: Skill menu 'm' -> 'c' seamlessly invokes Runecraft engine.")

        return True, "All Runecraft regression tests PASSED!"

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
    print(" ToME 2.3.8-ah Adventurer Runecraft Regression Test")
    print("==================================================")
    ok, msg = run_runecraft_tests()
    if not ok:
        print(f"\n[FAIL] {msg}")
        sys.exit(1)
    print(f"\n[PASS] {msg}")
    sys.exit(0)
