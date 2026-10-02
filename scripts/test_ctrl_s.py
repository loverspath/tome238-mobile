#!/data/data/com.termux/files/usr/bin/python3
"""
Regression test for Ctrl+S in-game saving and PTY IXON/IXOFF flow control bypass.
Guarantees that:
1. PTY / termios does not trap Ctrl+S (\x13) as XOFF flow control pause.
2. Game engine receives \x13 and invokes do_cmd_save_game().
3. Savefile is properly written to disk (saves/ directory).
4. Terminal remains interactive and responsive to subsequent commands.
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

def run_ctrl_s_regression_test():
    char_save = "CtrlSTest"
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 80, 0, 0))

    # Explicitly clear IXON and IXOFF on slave PTY
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
        return strip_ansi(buf), (res != 0), status

    try:
        # Step through character creation
        time.sleep(3.2)
        send_and_drain(b" ")
        send_and_drain(b"a")
        send_and_drain(char_save.encode("ascii") + b"\r")
        send_and_drain(b"   \r\x1b", delay=0.6)
        send_and_drain(b"b") # Male
        send_and_drain(b"a") # Human
        send_and_drain(b"a") # Classic
        send_and_drain(b"g") # Adventurer
        send_and_drain(b"a") # No God
        send_and_drain(b"n") # Don't modify options
        send_and_drain(b"0\r") # 0 quests

        # 6 stats in autoroller
        for _ in range(6):
            send_and_drain(b"\r")

        send_and_drain(b"\x1b") # Accept stats
        send_and_drain(b"\r")   # Accept bg
        send_and_drain(b"\r")   # Accept name
        send_and_drain(b"\x1b", delay=1.0) # Continue to world
        world_out, dead, _ = send_and_drain(b"   ", delay=0.5) # Dismiss messages

        if dead:
            return False, "Process died during world entry sequence"

        if "Human" not in world_out and "#" not in world_out:
            return False, f"Failed to confirm world spawn. Screen content:\n{world_out}"

        # Now in game world. Send Ctrl+S (\x13) to save
        save_out, dead, status = send_and_drain(b"\x13", delay=1.0)
        if dead:
            return False, f"Process crashed upon Ctrl+S with exit status {status}"

        if "Saving game" not in save_out and "done" not in save_out:
            return False, f"Expected 'Saving game... done.' message, got: {save_out}"

        # Verify savefile exists on disk
        save_path = f"/data/data/com.termux/files/home/tome238-mobile/saves/{char_save}"
        if not os.path.exists(save_path):
            return False, f"Savefile {save_path} was not created on disk!"

        save_size = os.path.getsize(save_path)
        if save_size < 1000:
            return False, f"Savefile size is suspiciously small ({save_size} bytes)"

        # Verify terminal remains interactive (not hung by XOFF)
        test_out, dead, _ = send_and_drain(b"\x12", delay=0.5) # Redraw key Ctrl+R
        if dead:
            return False, "Process died on post-save input"
        if len(test_out) == 0:
            return False, "Terminal output appears frozen after Ctrl+S (zero bytes on Ctrl+R)"

        return True, f"In-game Ctrl+S saved cleanly ({save_size} bytes) and terminal remained responsive"

    finally:
        os.close(master)
        try:
            os.kill(pid, 9)
            os.waitpid(pid, 0)
        except OSError:
            pass

        # Clean up test savefile
        save_path = f"/data/data/com.termux/files/home/tome238-mobile/saves/{char_save}"
        if os.path.exists(save_path):
            try:
                os.remove(save_path)
            except OSError:
                pass
        global_svg = "/data/data/com.termux/files/home/tome238-mobile/saves/global.svg"
        if os.path.exists(global_svg):
            try:
                os.remove(global_svg)
            except OSError:
                pass

if __name__ == "__main__":
    print("==================================================")
    print(" ToME 2.3.8-ah In-Game Ctrl+S Save Regression Test")
    print("==================================================")
    ok, msg = run_ctrl_s_regression_test()
    if not ok:
        print(f"  -> FAIL: {msg}")
        sys.exit(1)
    print(f"  -> PASS: {msg}")
    print("==================================================")
    sys.exit(0)
