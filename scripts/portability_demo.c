/*
 * Portability Demo: A minimal interactive terminal application for mobile shell verification.
 * Renders an 80x24 ASCII box, handles arrow/numpad navigation of '@', and exits on 'q' or Esc.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <termios.h>

static struct termios orig_termios;

static void disable_raw_mode(void) {
    tcsetattr(STDIN_FILENO, TCSAFLUSH, &orig_termios);
    printf("\033[?25h\033[0m\n"); // restore cursor and reset attributes
    fflush(stdout);
}

static void enable_raw_mode(void) {
    tcgetattr(STDIN_FILENO, &orig_termios);
    atexit(disable_raw_mode);

    struct termios raw = orig_termios;
    raw.c_iflag &= ~(BRKINT | ICRNL | INPCK | ISTRIP | IXON);
    raw.c_oflag &= ~(OPOST);
    raw.c_cflag |= (CS8);
    raw.c_lflag &= ~(ECHO | ICANON | IEXTEN | ISIG);
    raw.c_cc[VMIN] = 1;
    raw.c_cc[VTIME] = 0;
    tcsetattr(STDIN_FILENO, TCSAFLUSH, &raw);
}

static void draw_screen(int px, int py, int steps, const char *last_key) {
    // Clear screen and home cursor
    printf("\033[2J\033[H\033[?25l");

    // Title banner
    printf("\033[1;33m+------------------------------------------------------------------------------+\033[0m\r\n");
    printf("\033[1;33m|\033[1;36m  PORTABILITY PROOF: Generic Mobile Terminal Shell (Decoupled from ToME)      \033[1;33m|\033[0m\r\n");
    printf("\033[1;33m+------------------------------------------------------------------------------+\033[0m\r\n");

    // Arena (rows 4 to 20)
    for (int y = 0; y < 16; y++) {
        printf("\033[1;34m|\033[0m");
        for (int x = 0; x < 78; x++) {
            if (x == px && y == py) {
                printf("\033[1;32m@\033[0m"); // Player
            } else if ((x == 10 && y == 5) || (x == 60 && y == 10)) {
                printf("\033[1;31m$\033[0m"); // Gold
            } else {
                printf(" ");
            }
        }
        printf("\033[1;34m|\033[0m\r\n");
    }

    // Status / instructions footer
    printf("\033[1;33m+------------------------------------------------------------------------------+\033[0m\r\n");
    printf("\033[1;37m| Pos: (%2d,%2d) | Steps: %4d | Last Key: %-10s | Controls: 1-9/arrows, q=Exit  |\033[0m\r\n",
           px, py, steps, last_key);
    printf("\033[1;33m+------------------------------------------------------------------------------+\033[0m\r\n");
    fflush(stdout);
}

int main(void) {
    enable_raw_mode();

    int px = 39;
    int py = 7;
    int steps = 0;
    char last_key[32] = "None";

    draw_screen(px, py, steps, last_key);

    char c;
    while (read(STDIN_FILENO, &c, 1) == 1) {
        if (c == 12) { // Ctrl+L (Clear/Redraw)
            draw_screen(px, py, steps, "REDRAW");
            continue;
        }

        if (c == 'q' || c == 'Q' || c == '\033') {
            // Check if it's an escape sequence
            if (c == '\033') {
                char seq[3];
                struct termios t;
                tcgetattr(STDIN_FILENO, &t);
                t.c_cc[VMIN] = 0;
                t.c_cc[VTIME] = 1;
                tcsetattr(STDIN_FILENO, TCSANOW, &t);

                int n = read(STDIN_FILENO, &seq[0], 1);
                if (n == 0) {
                    break;
                }
                if (seq[0] == '[') {
                    read(STDIN_FILENO, &seq[1], 1);
                    if (seq[1] == 'A') { c = '8'; }
                    else if (seq[1] == 'B') { c = '2'; }
                    else if (seq[1] == 'C') { c = '6'; }
                    else if (seq[1] == 'D') { c = '4'; }
                }

                t.c_cc[VMIN] = 1;
                t.c_cc[VTIME] = 0;
                tcsetattr(STDIN_FILENO, TCSANOW, &t);

                if (c == '\033') continue;
            } else {
                break;
            }
        }

        int dx = 0, dy = 0;
        if (c == '8' || c == 'k') { dy = -1; snprintf(last_key, sizeof(last_key), "UP (8)"); }
        else if (c == '2' || c == 'j') { dy = 1; snprintf(last_key, sizeof(last_key), "DOWN (2)"); }
        else if (c == '4' || c == 'h') { dx = -1; snprintf(last_key, sizeof(last_key), "LEFT (4)"); }
        else if (c == '6' || c == 'l') { dx = 1; snprintf(last_key, sizeof(last_key), "RIGHT (6)"); }
        else if (c == '7' || c == 'y') { dx = -1; dy = -1; snprintf(last_key, sizeof(last_key), "UP-LEFT (7)"); }
        else if (c == '9' || c == 'u') { dx = 1; dy = -1; snprintf(last_key, sizeof(last_key), "UP-RIGHT (9)"); }
        else if (c == '1' || c == 'b') { dx = -1; dy = 1; snprintf(last_key, sizeof(last_key), "DN-LEFT (1)"); }
        else if (c == '3' || c == 'n') { dx = 1; dy = 1; snprintf(last_key, sizeof(last_key), "DN-RIGHT (3)"); }
        else if (c == '5' || c == '.') { snprintf(last_key, sizeof(last_key), "WAIT (5)"); }
        else {
            snprintf(last_key, sizeof(last_key), "Key 0x%02X", (unsigned char)c);
        }

        px += dx;
        py += dy;
        if (px < 0) px = 0;
        if (px > 77) px = 77;
        if (py < 0) py = 0;
        if (py > 15) py = 15;

        steps++;
        draw_screen(px, py, steps, last_key);
    }

    return 0;
}
