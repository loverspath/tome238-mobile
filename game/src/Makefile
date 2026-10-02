CC ?= clang
CFLAGS ?= -Wall -O2 -pipe -g
DEFINES = -DUSE_GCU -DUSE_NCURSES -DUSE_TPOSIX -DUSE_CURS_SET -DUSE_LUA \
          -Wno-format-security -Wno-parentheses-equality \
          -Wno-implicit-function-declaration -Wno-deprecated-non-prototype \
          -Wno-incompatible-pointer-types -Wno-format -Wno-return-type \
          -DDEFAULT_PATH=\"./lib/\"

INCLUDES = -I. -Ilua $(shell pkg-config --cflags ncursesw 2>/dev/null || echo "-I/data/data/com.termux/files/usr/include")
LIBS = $(shell pkg-config --libs ncursesw 2>/dev/null || echo "-lncursesw") -lm

ALL_CFLAGS = $(CFLAGS) $(INCLUDES) $(DEFINES)

BASESRCS = \
  main-gcu.c main.c \
  z-rand.c z-util.c z-form.c z-virt.c z-term.c z-sock.c \
  variable.c tables.c plots.c util.c cave.c dungeon.c \
  melee1.c melee2.c modules.c \
  object1.c object2.c randart.c squeltch.c traps.c \
  monster1.c monster2.c monster3.c \
  xtra1.c xtra2.c skills.c powers.c gods.c \
  spells1.c spells2.c \
  status.c files.c notes.c loadsave.c \
  cmd1.c cmd2.c cmd3.c cmd4.c cmd5.c cmd6.c cmd7.c \
  help.c \
  generate.c gen_maze.c gen_evol.c wild.c levels.c store.c bldg.c \
  cmovie.c irc.c \
  wizard2.c init2.c birth.c wizard1.c init1.c

BASEOBJS = $(BASESRCS:.c=.o)

LUASRCS = \
  script.c lua_bind.c \
  w_util.c w_player.c w_z_pack.c w_obj.c w_mnster.c w_spells.c w_quest.c w_play_c.c w_dun.c

LUAOBJS = $(LUASRCS:.c=.o)

TOLUASRCS = \
  lua/lapi.c lua/lcode.c lua/ldebug.c lua/ldo.c lua/lfunc.c lua/lgc.c \
  lua/llex.c lua/lmem.c lua/lobject.c lua/lparser.c lua/lstate.c lua/lstring.c \
  lua/ltable.c lua/ltests.c lua/ltm.c lua/lundump.c lua/lvm.c lua/lzio.c \
  lua/lauxlib.c lua/lbaselib.c lua/ldblib.c lua/liolib.c lua/lstrlib.c \
  lua/tolua_lb.c lua/tolua_rg.c lua/tolua_tt.c lua/tolua_tm.c lua/tolua_gp.c \
  lua/tolua_eh.c lua/tolua_bd.c

TOLUAOBJS = $(TOLUASRCS:.c=.o)

OBJS = $(BASEOBJS) $(LUAOBJS) $(TOLUAOBJS)

TARGET = tome
TOLUA = tolua

all: $(TARGET) $(TOLUA)

$(TARGET): $(OBJS)
	$(CC) $(ALL_CFLAGS) $(LDFLAGS) -o $@ $(OBJS) $(LIBS)
	cp -f $(TARGET) ..

$(TOLUA): $(TOLUAOBJS) lua/tolua.c lua/tolualua.c
	$(CC) $(ALL_CFLAGS) $(LDFLAGS) -o $@ $(TOLUAOBJS) lua/tolua.c lua/tolualua.c $(LIBS)

%.o: %.c
	$(CC) $(ALL_CFLAGS) -c -o $@ $<

plots.o: plots.c q_rand.c q_main.c q_one.c q_ultrag.c q_ultrae.c \
	q_thief.c q_hobbit.c q_nazgul.c q_troll.c q_wight.c \
	q_spider.c q_poison.c \
	q_eol.c q_nirna.c q_invas.c \
	q_betwen.c \
	q_narsil.c q_shroom.c q_thrain.c q_wolves.c q_dragons.c q_haunted.c q_evil.c
	$(CC) $(ALL_CFLAGS) -c -o $@ $<

clean:
	rm -f *.o lua/*.o $(TARGET) $(TOLUA) ../$(TARGET)

.PHONY: all clean
