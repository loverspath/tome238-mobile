#!/data/data/com.termux/files/usr/bin/python3
import os
import pty
import select
import struct
import fcntl
import termios
import sys
import time
import re

def run_test(args, inputs=None, timeout=3.0):
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
        
        project_root = "/data/data/com.termux/files/home/tome238-mobile"
        os.environ['TOME_PATH'] = os.path.join(project_root, "game/lib")
        os.chdir(os.path.join(project_root, "game"))
        os.execv("./tome", ["./tome"] + args)
    
    os.close(slave)
    
    flags = fcntl.fcntl(master, fcntl.F_GETFL)
    fcntl.fcntl(master, fcntl.F_SETFL, flags | os.O_NONBLOCK)
    
    output = bytearray()
    start_time = time.time()
    
    if inputs:
        time.sleep(0.5)
        for inp in inputs:
            os.write(master, inp)
            time.sleep(0.2)
            
    while time.time() - start_time < timeout:
        r, _, _ = select.select([master], [], [], 0.2)
        if r:
            try:
                data = os.read(master, 4096)
                if not data:
                    break
                output.extend(data)
            except OSError:
                break
        
    # Check child process status
    try:
        pid_res, status = os.waitpid(pid, os.WNOHANG)
        if pid_res != 0:
            os.close(master)
            return os.waitstatus_to_exitcode(status), bytes(output)
        else:
            # Still running after timeout, kill it
            os.kill(pid, 9)
            os.waitpid(pid, 0)
    except OSError:
        pass
    os.close(master)
    return -1, bytes(output)

if __name__ == "__main__":
    print("========================================")
    print(" ToME 2.3.8-ah Native Build Smoke Test")
    print("========================================")
    
    # Test 1: Help CLI test
    print("\n[Test 1] Executing ./tome --help...")
    code, out = run_test(["--help"])
    text1 = out.decode("latin1", errors="replace")
    if code == 0 and "Usage: tome" in text1 and "-mgcu" in text1:
        print("  -> PASS: Options and -mgcu curses flag displayed correctly.")
    else:
        print(f"  -> FAIL: code={code}, out={text1[:200]}")
        sys.exit(1)
        
    # Test 2: Module loader & clean exit test
    print("\n[Test 2] Executing ./tome -n and testing clean exit via Escape...")
    code, out = run_test(["-n"], inputs=[b"\x1b"])
    clean_text = re.sub(r'\x1b(\[[0-9;]*[a-zA-Z]|\([A-B]|\][^\x1b]*\x1b\\|[0-9a-zA-Z=])', '', out.decode('latin1', errors='replace'))
    if "Welcome to ToME" in clean_text and code == 0:
        print("  -> PASS: Module select UI loaded and exited cleanly (exit code 0).")
        print("  -> Module info found:")
        for line in clean_text.splitlines():
            s = line.strip()
            if s and any(k in s for k in ["Tales of Middle-earth", "ToME", "Dol Guldur"]):
                print(f"     | {s}")
    else:
        print(f"  -> FAIL: code={code}, text snippet={clean_text[:200]}")
        sys.exit(1)

    print("\n[Summary] All native smoke tests PASSED successfully!")
    sys.exit(0)
