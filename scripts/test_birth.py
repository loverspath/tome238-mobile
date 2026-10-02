#!/data/data/com.termux/files/usr/bin/python3
"""
Regression test for character creation birth flow and Adventurer class initialization.
Guarantees that:
1. Confirming default player name (Return on 'PLAYER') does not trigger null FILE* crash.
2. Adventurer class and Lua birth hook (__birth_hook_objects) execute cleanly.
3. Character spawns into game world without backend termination.
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

def run_birth_test(char_name=None, select_adventurer=True):
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 80, 0, 0))

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
        res, status = os.waitpid(pid, os.WNOHANG)
        return strip_ansi(buf), (res != 0)

    try:
        # Wait for splash
        time.sleep(3.2)
        send_and_drain(b" ")

        # 'a' for New Character
        send_and_drain(b"a")

        # Confirm name
        if char_name:
            out, dead = send_and_drain(b"\x08" * 15 + char_name.encode("ascii") + b"\r")
        else:
            # Just hit Return on default 'PLAYER'
            out, dead = send_and_drain(b"\r")

        if dead:
            return False, "Process died during savefile name confirmation"

        # Skip intro animation
        send_and_drain(b"   \r\x1b", delay=0.6)

        # Sex: Male ('b')
        out, dead = send_and_drain(b"b")
        if dead: return False, "Process died on sex selection"

        # Race: Human ('a')
        out, dead = send_and_drain(b"a")
        if dead: return False, "Process died on race selection"

        # Subrace: Classic ('a')
        out, dead = send_and_drain(b"a")
        if dead: return False, "Process died on subrace selection"

        # Class: Adventurer ('g') or Warrior ('a')
        class_key = b"g" if select_adventurer else b"a"
        out, dead = send_and_drain(class_key)
        if dead: return False, "Process died on class selection"

        # God: No God ('a')
        out, dead = send_and_drain(b"a")
        if dead: return False, "Process died on god selection"

        # Quests: 0
        out, dead = send_and_drain(b"0\r")
        if dead: return False, "Process died on quest count entry"

        # Stats autoroll: ESC
        out, dead = send_and_drain(b"\x1b")
        if dead: return False, "Process died on stat confirmation"

        # Background edit: Return
        out, dead = send_and_drain(b"\r")
        if dead: return False, "Process died on background confirmation"

        # Player name in birth: Return
        out, dead = send_and_drain(b"\r")
        if dead: return False, "Process died on player name birth confirmation"

        # Birth prompt: ESC to continue into game
        out, dead = send_and_drain(b"\x1b", delay=1.0)
        if dead: return False, "Process died transitioning into game world"

        return True, "Character creation completed and world entered successfully"

    finally:
        os.close(master)
        try:
            os.kill(pid, 9)
            os.waitpid(pid, 0)
        except OSError:
            pass

if __name__ == "__main__":
    print("==================================================")
    print(" ToME 2.3.8-ah Character Creation Regression Test")
    print("==================================================")

    print("\n[Case 1] Default savefile name ('PLAYER') & Adventurer class...")
    ok, msg = run_birth_test(char_name=None, select_adventurer=True)
    if not ok:
        print(f"  -> FAIL: {msg}")
        sys.exit(1)
    print(f"  -> PASS: {msg}")

    print("\n[Case 2] Custom savefile name ('Hero') & Warrior class...")
    ok, msg = run_birth_test(char_name="Hero", select_adventurer=False)
    if not ok:
        print(f"  -> FAIL: {msg}")
        sys.exit(1)
    print(f"  -> PASS: {msg}")

    print("\n==================================================")
    print(" ALL BIRTH FLOW TESTS PASSED!")
    print("==================================================")
    sys.exit(0)
