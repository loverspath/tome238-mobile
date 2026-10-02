-- =========================================================================
-- ToME 2.3.8-ah Runecraft Magic Engine (TomeNET Runemastery Integration)
-- Scope: 21 Elements x 8 Spell Forms x 7 Spell Modes
-- File: game/lib/scpt/runecraft.lua
-- Pure Lua 4.0 compliant structure
-- =========================================================================

RC_SKILL_ID = 34
RC_ACTION_MKEY = 9

-- -------------------------------------------------------------------------
-- 1. 21 Elemental Definitions & Projectile Mappings (GF_*)
-- -------------------------------------------------------------------------
RC_ELEMENTS = {
    -- 4 Basic High-Damage Elements (Weight: 1200)
    ["fire"]        = { key = "f", name = "Fire",        gf = GF_FIRE,        weight = 1200, desc = "Intense fire damage, burns flammable items" },
    ["cold"]        = { key = "c", name = "Cold",        gf = GF_COLD,        weight = 1200, desc = "Freezing cold damage, shatters potions" },
    ["elec"]        = { key = "e", name = "Electricity", gf = GF_ELEC,        weight = 1200, desc = "High electrical shock damage" },
    ["acid"]        = { key = "a", name = "Acid",        gf = GF_ACID,        weight = 1200, desc = "Corrosive acid damage, corrodes armor" },

    -- Fundamental 6 Runes
    ["lite"]        = { key = "l", name = "Light",       gf = GF_LITE,        weight = 400,  desc = "Illuminates area, blinds sensitive foes" },
    ["dark"]        = { key = "d", name = "Darkness",    gf = GF_DARK,        weight = 550,  desc = "Darkness damage, induces blindness" },
    ["neth"]        = { key = "n", name = "Nether",      gf = GF_NETHER,      weight = 550,  desc = "Nether force, effective against living creatures" },
    ["chao"]        = { key = "h", name = "Chaos",       gf = GF_CHAOS,       weight = 600,  desc = "Chaotic reality-warping energy, causes hallucinations" },
    ["mana"]        = { key = "m", name = "Mana",        gf = GF_MANA,        weight = 600,  desc = "Pure magical force penetrating resistance" },
    ["nexu"]        = { key = "x", name = "Nexus",       gf = GF_NEXUS,       weight = 250,  desc = "Spatial nexus energy, induces teleportation" },

    -- Compound Elemental Combinations
    ["pois"]        = { key = "p", name = "Poison",      gf = GF_POIS,        weight = 800,  desc = "Toxic poison damage" },
    ["soun"]        = { key = "s", name = "Sound",       gf = GF_SOUND,       weight = 400,  desc = "Sonic shockwaves, stuns targets" },
    ["shar"]        = { key = "r", name = "Shards",      gf = GF_SHARDS,      weight = 400,  desc = "Razor-sharp fragments, causes bleeding cuts" },
    ["forc"]        = { key = "o", name = "Force",       gf = GF_FORCE,       weight = 250,  desc = "Kinetic impact, knocks back enemies" },
    ["grav"]        = { key = "g", name = "Gravity",     gf = GF_GRAVITY,     weight = 150,  desc = "Crushing gravitational distortion" },
    ["iner"]        = { key = "i", name = "Inertia",     gf = GF_INERTIA,     weight = 200,  desc = "Temporal slowing field, decelerates foes" },
    ["time"]        = { key = "t", name = "Time",        gf = GF_TIME,        weight = 150,  desc = "Time disruption, drains energy" },
    ["conf"]        = { key = "u", name = "Confusion",   gf = GF_CONFUSION,   weight = 400,  desc = "Mind-boggling aura, confuses targets" },
    ["dise"]        = { key = "k", name = "Disenchant",  gf = GF_DISENCHANT,  weight = 500,  desc = "Disenchanting waves neutralizing magic" },
    ["hell"]        = { key = "j", name = "Hellfire",    gf = GF_HELL_FIRE,   weight = 400,  desc = "Unearthly hellfire ignoring standard fire immunity" },
    ["wate"]        = { key = "w", name = "Water",       gf = GF_WATER,       weight = 300,  desc = "Surging torrent, stuns and sweeps away foes" },
}

-- Fast lookup maps by character code
RC_ELEMENTS_BY_CHAR = {}
for id, elem in RC_ELEMENTS do
    RC_ELEMENTS_BY_CHAR[strbyte(elem.key)] = elem
    RC_ELEMENTS_BY_CHAR[strbyte(strupper(elem.key))] = elem
end

-- 6 Fundamental Rune IDs
RC_RUNE_LITE = 1
RC_RUNE_DARK = 2
RC_RUNE_NEXU = 4
RC_RUNE_NETH = 8
RC_RUNE_CHAO = 16
RC_RUNE_MANA = 32

RC_RUNE_COMBOS = {}
RC_RUNE_COMBOS[bor(RC_RUNE_LITE, RC_RUNE_LITE)] = "lite"
RC_RUNE_COMBOS[bor(RC_RUNE_DARK, RC_RUNE_DARK)] = "dark"
RC_RUNE_COMBOS[bor(RC_RUNE_NEXU, RC_RUNE_NEXU)] = "nexu"
RC_RUNE_COMBOS[bor(RC_RUNE_NETH, RC_RUNE_NETH)] = "neth"
RC_RUNE_COMBOS[bor(RC_RUNE_CHAO, RC_RUNE_CHAO)] = "chao"
RC_RUNE_COMBOS[bor(RC_RUNE_MANA, RC_RUNE_MANA)] = "mana"
RC_RUNE_COMBOS[bor(RC_RUNE_LITE, RC_RUNE_DARK)] = "conf"
RC_RUNE_COMBOS[bor(RC_RUNE_LITE, RC_RUNE_NEXU)] = "iner"
RC_RUNE_COMBOS[bor(RC_RUNE_LITE, RC_RUNE_NETH)] = "elec"
RC_RUNE_COMBOS[bor(RC_RUNE_LITE, RC_RUNE_CHAO)] = "fire"
RC_RUNE_COMBOS[bor(RC_RUNE_LITE, RC_RUNE_MANA)] = "wate"
RC_RUNE_COMBOS[bor(RC_RUNE_DARK, RC_RUNE_NEXU)] = "grav"
RC_RUNE_COMBOS[bor(RC_RUNE_DARK, RC_RUNE_NETH)] = "cold"
RC_RUNE_COMBOS[bor(RC_RUNE_DARK, RC_RUNE_CHAO)] = "acid"
RC_RUNE_COMBOS[bor(RC_RUNE_DARK, RC_RUNE_MANA)] = "pois"
RC_RUNE_COMBOS[bor(RC_RUNE_NEXU, RC_RUNE_NETH)] = "time"
RC_RUNE_COMBOS[bor(RC_RUNE_NEXU, RC_RUNE_CHAO)] = "soun"
RC_RUNE_COMBOS[bor(RC_RUNE_NEXU, RC_RUNE_MANA)] = "shar"
RC_RUNE_COMBOS[bor(RC_RUNE_NETH, RC_RUNE_CHAO)] = "hell"
RC_RUNE_COMBOS[bor(RC_RUNE_NETH, RC_RUNE_MANA)] = "forc"
RC_RUNE_COMBOS[bor(RC_RUNE_CHAO, RC_RUNE_MANA)] = "dise"

-- 6 Fundamental Runes (TomeNET Rune System)
RC_RUNES = {
    ["a"] = { id = 1,  key = "a", name = "Lite", full_name = "Light" },
    ["b"] = { id = 2,  key = "b", name = "Dark", full_name = "Darkness" },
    ["c"] = { id = 4,  key = "c", name = "Nexu", full_name = "Nexus" },
    ["d"] = { id = 8,  key = "d", name = "Neth", full_name = "Nether" },
    ["e"] = { id = 16, key = "e", name = "Chao", full_name = "Chaos" },
    ["f"] = { id = 32, key = "f", name = "Mana", full_name = "Mana" },
}

RC_RUNES_BY_CHAR = {}
RC_RUNES_BY_ID = {}
for k, r in RC_RUNES do
    RC_RUNES_BY_CHAR[strbyte(k)] = r
    RC_RUNES_BY_CHAR[strbyte(strupper(k))] = r
    RC_RUNES_BY_ID[r.id] = r
end

function rc_resolve_rune(val)
    local b
    if not val then return nil end
    if type(val) == "string" then
        val = strlower(val)
        if RC_RUNES[val] then return RC_RUNES[val] end
        if strlen(val) == 1 then
            b = strbyte(val)
            if RC_RUNES_BY_CHAR[b] then return RC_RUNES_BY_CHAR[b] end
        end
        for _, r in RC_RUNES do
            if strlower(r.name) == val or strlower(r.full_name) == val then
                return r
            end
        end
    elseif type(val) == "number" then
        if RC_RUNES_BY_ID[val] then return RC_RUNES_BY_ID[val] end
        if RC_RUNES_BY_CHAR[val] then return RC_RUNES_BY_CHAR[val] end
    elseif type(val) == "table" and val.id then
        return val
    end
    return nil
end

function runecraft_combine(r1, r2)
    local combo_key, elem_id
    if not r1 or not r2 then return nil end
    combo_key = bor(r1, r2)
    elem_id = RC_RUNE_COMBOS[combo_key]
    if elem_id and RC_ELEMENTS[elem_id] then
        return RC_ELEMENTS[elem_id]
    end
    return nil
end

-- -------------------------------------------------------------------------
-- 2. Spell Forms (Type)
-- -------------------------------------------------------------------------
RC_FORMS = {
    ["bolt"]  = { key = "b", name = "Bolt",  base_lvl = 1,  cost_min = 2,  cost_max = 15, is_dice = TRUE,  dam_min = 40, dam_max = 200, need_dir = TRUE },
    ["flare"] = { key = "f", name = "Flare", base_lvl = 3,  cost_min = 5,  cost_max = 20, is_dice = FALSE, dam_min = 80, dam_max = 360, need_dir = TRUE, rad = 0, time = 2 },
    ["beam"]  = { key = "e", name = "Beam",  base_lvl = 4,  cost_min = 6,  cost_max = 22, is_dice = TRUE,  dam_min = 50, dam_max = 240, need_dir = TRUE },
    ["ball"]  = { key = "a", name = "Ball",  base_lvl = 7,  cost_min = 8,  cost_max = 25, is_dice = FALSE, dam_min = 90, dam_max = 450, need_dir = TRUE, rad = 2 },
    ["cloud"] = { key = "c", name = "Cloud", base_lvl = 10, cost_min = 10, cost_max = 30, is_dice = FALSE, dam_min = 60, dam_max = 300, need_dir = TRUE, rad = 3, time = 10 },
    ["wall"]  = { key = "w", name = "Wall",  base_lvl = 14, cost_min = 12, cost_max = 35, is_dice = FALSE, dam_min = 70, dam_max = 320, need_dir = TRUE, time = 10 },
    ["wave"]  = { key = "v", name = "Wave",  base_lvl = 18, cost_min = 15, cost_max = 40, is_dice = FALSE, dam_min = 80, dam_max = 380, need_dir = TRUE, rad = 3 },
    ["storm"] = { key = "s", name = "Storm", base_lvl = 22, cost_min = 18, cost_max = 45, is_dice = FALSE, dam_min = 50, dam_max = 250, need_dir = FALSE, rad = 2, time = 15 },
}

RC_FORMS_BY_CHAR = {}
for id, form in RC_FORMS do
    RC_FORMS_BY_CHAR[strbyte(form.key)] = form
    RC_FORMS_BY_CHAR[strbyte(strupper(form.key))] = form
end

-- -------------------------------------------------------------------------
-- 3. Spell Modes (Modifiers)
-- -------------------------------------------------------------------------
RC_MODES = {
    ["moderate"]   = { key = "m", name = "Moderate",   lvl_mod = 1, cost_mul = 10, dam_mul = 10, fail_mod = 0,   rad_mod = 0,  time_mul = 10, energy = 100 },
    ["minimized"]  = { key = "i", name = "Minimized",  lvl_mod = 0, cost_mul = 6,  dam_mul = 6,  fail_mod = -20, rad_mod = -1, time_mul = 8,  energy = 100 },
    ["lengthened"] = { key = "l", name = "Lengthened", lvl_mod = 2, cost_mul = 8,  dam_mul = 8,  fail_mod = -10, rad_mod = 0,  time_mul = 14, energy = 100 },
    ["compressed"] = { key = "p", name = "Compressed", lvl_mod = 3, cost_mul = 7,  dam_mul = 9,  fail_mod = -5,  rad_mod = -2, time_mul = 12, energy = 100 },
    ["expanded"]   = { key = "e", name = "Expanded",   lvl_mod = 4, cost_mul = 14, dam_mul = 8,  fail_mod = 10,  rad_mod = 2,  time_mul = 8,  energy = 100 },
    ["brief"]      = { key = "b", name = "Brief",      lvl_mod = 1, cost_mul = 7,  dam_mul = 6,  fail_mod = 20,  rad_mod = 0,  time_mul = 6,  energy = 50  },
    ["maximized"]  = { key = "x", name = "Maximized",  lvl_mod = 6, cost_mul = 18, dam_mul = 14, fail_mod = 40,  rad_mod = 1,  time_mul = 12, energy = 100 },
}

RC_MODES_BY_CHAR = {}
for id, mode in RC_MODES do
    RC_MODES_BY_CHAR[strbyte(mode.key)] = mode
    RC_MODES_BY_CHAR[strbyte(strupper(mode.key))] = mode
end

-- -------------------------------------------------------------------------
-- 4. Mathematical Scaling & Resolution Helpers
-- -------------------------------------------------------------------------
function rc_scale(s, l, h)
    return l + ((h - l) * s / 50)
end

function rc_resolve_element(val)
    local b
    if not val then return nil end
    if type(val) == "string" then
        val = strlower(val)
        if RC_ELEMENTS[val] then return RC_ELEMENTS[val] end
        if strlen(val) == 1 then
            b = strbyte(val)
            if RC_ELEMENTS_BY_CHAR[b] then return RC_ELEMENTS_BY_CHAR[b] end
        end
    elseif type(val) == "number" then
        if RC_ELEMENTS_BY_CHAR[val] then return RC_ELEMENTS_BY_CHAR[val] end
        for _, elem in RC_ELEMENTS do
            if elem.gf == val then return elem end
        end
    end
    return nil
end

function rc_resolve_form(val)
    local b
    if not val then return nil end
    if type(val) == "string" then
        val = strlower(val)
        if RC_FORMS[val] then return RC_FORMS[val] end
        if strlen(val) == 1 then
            b = strbyte(val)
            if RC_FORMS_BY_CHAR[b] then return RC_FORMS_BY_CHAR[b] end
        end
    elseif type(val) == "number" then
        if RC_FORMS_BY_CHAR[val] then return RC_FORMS_BY_CHAR[val] end
    end
    return nil
end

function rc_resolve_mode(val)
    local b
    if not val then return nil end
    if type(val) == "string" then
        val = strlower(val)
        if RC_MODES[val] then return RC_MODES[val] end
        if strlen(val) == 1 then
            b = strbyte(val)
            if RC_MODES_BY_CHAR[b] then return RC_MODES_BY_CHAR[b] end
        end
    elseif type(val) == "number" then
        if RC_MODES_BY_CHAR[val] then return RC_MODES_BY_CHAR[val] end
    end
    return nil
end

-- -------------------------------------------------------------------------
-- 5. Core Runecraft Spellcaster Engine
-- -------------------------------------------------------------------------
function do_runecraft(arg1, arg2, arg3, arg4, arg5)
    local skill, elem, form, mode, lvl, ability, base_cost, mana_cost
    local base_fail, int_idx, dex_idx, int_bonus, dex_bonus, stat_bonus, fail_rate
    local int_min, dex_min, min_fail, weight_mul, damage, rad, time
    local spell_failed, backlash, target_dir, ret, c, dir, fail_adverb
    local dice_x, dice_y
    local opt_form, opt_mode, opt_dir
    local r1, r2, c1, c2

    -- [Precondition Checks]
    if player.confused > 0 then
        msg_print("You are too confused!")
        energy_use = 0
        return
    end

    if player.antimagic > 0 then
        msg_print("Your anti-magic field disrupts any magic attempts.")
        energy_use = 0
        return
    end

    skill = get_skill(RC_SKILL_ID)
    if skill < 1 then
        msg_print("You have no knowledge of Runecraft!")
        energy_use = 0
        return
    end

    -- [Step 1: Element Resolution (API or Interactive)]
    elem = rc_resolve_element(arg1)
    if elem then
        -- Direct element passed: do_runecraft("fire", form, mode, dir)
        opt_form = arg2
        opt_mode = arg3
        opt_dir = arg4
    else
        r1 = rc_resolve_rune(arg1)
        r2 = rc_resolve_rune(arg2)
        if r1 and r2 then
            -- Two runes passed: do_runecraft("a", "e", form, mode, dir)
            elem = runecraft_combine(r1.id, r2.id)
            opt_form = arg3
            opt_mode = arg4
            opt_dir = arg5
        elseif r1 and rc_resolve_form(arg2) then
            -- Single rune passed with form (pure element: r1 + r1)
            elem = runecraft_combine(r1.id, r1.id)
            opt_form = arg2
            opt_mode = arg3
            opt_dir = arg4
        end
    end

    -- If not yet resolved, prompt interactively: 2-step Rune selection
    if not elem then
        ret, c1 = get_com("Rune 1: [a]Lite [b]Dark [c]Nexu [d]Neth [e]Chao [f]Mana: ", strbyte("a"))
        if not ret then
            energy_use = 0
            return
        end
        r1 = rc_resolve_rune(c1)
        if not r1 then
            msg_print("Unknown rune.")
            energy_use = 0
            return
        end

        ret, c2 = get_com("Rune 2: [a]Lite [b]Dark [c]Nexu [d]Neth [e]Chao [f]Mana (same=pure): ", c1)
        if not ret then
            energy_use = 0
            return
        end
        r2 = rc_resolve_rune(c2)
        if not r2 then
            msg_print("Unknown rune.")
            energy_use = 0
            return
        end

        elem = runecraft_combine(r1.id, r2.id)
        if not elem then
            msg_print("Failed to combine runes.")
            energy_use = 0
            return
        end
    end

    -- [Step 2: Form Selection]
    form = rc_resolve_form(opt_form)
    if not form then
        ret, c = get_com(format("[%s] Form: [b]olt be[e]m b[a]ll [c]loud [w]all [v]ave [s]torm [f]lare: ", elem.name), strbyte("b"))
        if not ret then
            energy_use = 0
            return
        end
        form = rc_resolve_form(c)
        if not form then
            msg_print("Unknown spell form.")
            energy_use = 0
            return
        end
    end

    -- [Step 3: Mode Selection]
    mode = rc_resolve_mode(opt_mode)
    if not mode then
        ret, c = get_com("Mode: [m]od min[i] [l]eng com[p] [e]xpa [b]rief ma[x]: ", strbyte("m"))
        if not ret then
            energy_use = 0
            return
        end
        mode = rc_resolve_mode(c)
        if not mode then
            msg_print("Unknown spell mode.")
            energy_use = 0
            return
        end
    end

    -- [Step 4: Stats & Resource Computations]
    lvl = form.base_lvl + mode.lvl_mod
    ability = skill - lvl + 1

    if ability < 1 then
        msg_print(format("Your skill is not high enough! (%s %s; required level: %d)",
            mode.name, form.name, lvl))
        energy_use = 33
        return
    end

    base_cost = rc_scale(skill, form.cost_min, form.cost_max)
    mana_cost = (base_cost * mode.cost_mul) / 10
    if mana_cost < 1 then mana_cost = 1 end

    if player.csp < mana_cost then
        msg_print(format("You do not have enough mana! (%s %s; cost: %d, available: %d)",
            mode.name, form.name, mana_cost, player.csp))
        energy_use = 33
        return
    end

    -- Failure rate calculation (INT 65%, DEX 35%)
    base_fail = 15 - (ability > 15 and 15 or ability)
    base_fail = base_fail * 3 - 13 + mode.fail_mod

    int_idx = player.stat_ind[A_INT + 1]
    dex_idx = player.stat_ind[A_DEX + 1]
    int_bonus = adj_mag_stat[int_idx + 1]
    dex_bonus = adj_mag_stat[dex_idx + 1]
    stat_bonus = ((int_bonus * 65 + dex_bonus * 35) / 100) - 3
    fail_rate = base_fail - stat_bonus

    int_min = adj_mag_fail[int_idx + 1]
    dex_min = adj_mag_fail[dex_idx + 1]
    min_fail = (int_min * 65 + dex_min * 35) / 100
    if fail_rate < min_fail then fail_rate = min_fail end

    if player.blind > 0 then fail_rate = fail_rate + 10 end
    if player.stun > 50 then
        fail_rate = fail_rate + 25
    elseif player.stun > 0 then
        fail_rate = fail_rate + 15
    end

    if fail_rate > 95 then fail_rate = 95 end
    if fail_rate < 0 then fail_rate = 0 end

    -- Damage calculation with elemental weight scaling
    damage = 0
    if form.is_dice then
        dice_x = rc_scale(skill, 4, 46)
        dice_y = (rc_scale(skill, 2, 26) * mode.dam_mul * elem.weight) / (10 * 1000)
        if dice_y < 1 then dice_y = 1 end
        damage = damroll(dice_x, dice_y)
    else
        damage = (rc_scale(skill, form.dam_min or 50, form.dam_max or 350) * mode.dam_mul * elem.weight) / (10 * 1000)
    end
    if damage < 1 then damage = 1 end

    -- Radius and Time calculations
    rad = (form.rad or 2) + mode.rad_mod
    if rad < 0 then rad = 0 end
    time = ((form.time or 10) * mode.time_mul) / 10
    if time < 1 then time = 1 end

    -- [Step 5: Failure Roll & Backlash Computation]
    spell_failed = (magik(fail_rate) == TRUE)
    backlash = 0
    if spell_failed then
        backlash = (damage / 5) + 1  -- 20% + 1
    end

    -- [Step 6: Suicide Prevention Guard]
    if backlash >= player.chp then
        cmsg_print(TERM_L_RED, format("The strain is far too great! (Backlash: %d, HP: %d)",
            backlash, player.chp))
        energy_use = 33
        return
    end

    -- [Step 7: Target Aiming]
    target_dir = opt_dir
    if form.need_dir then
        if not target_dir then
            ret, dir = get_aim_dir()
            if not ret then
                energy_use = 0
                return
            end
            target_dir = dir
        end
    else
        target_dir = 5
    end

    -- [Step 8: Resource Consumption & Spell Execution]
    increase_mana(-mana_cost)
    energy_use = mode.energy or 100

    fail_adverb = spell_failed and "incompetently " or ""
    msg_print(format("You %strace a %s %s %s with %d mana (damage: %d, fail: %d%%).",
        fail_adverb, mode.name, elem.name, form.name, mana_cost, damage, fail_rate))

    -- Cast based on form
    if form.key == "b" then
        fire_bolt(elem.gf, target_dir, damage)
    elseif form.key == "e" then
        fire_beam(elem.gf, target_dir, damage)
    elseif form.key == "a" then
        fire_ball(elem.gf, target_dir, damage, rad)
    elseif form.key == "c" then
        fire_cloud(elem.gf, target_dir, damage, rad, time)
    elseif form.key == "w" then
        fire_wall(elem.gf, target_dir, damage, time)
    elseif form.key == "v" then
        fire_wave(elem.gf, target_dir, damage, 1, rad, EFF_WAVE)
    elseif form.key == "s" then
        fire_wave(elem.gf, 0, damage, rad, time, EFF_STORM)
    elseif form.key == "f" then
        fire_cloud(elem.gf, target_dir, damage, 0, 2)
    else
        fire_bolt(elem.gf, target_dir, damage)
    end

    -- [Step 9: Trigger Backlash Damage]
    if backlash > 0 then
        cmsg_print(TERM_L_RED, format("You are blasted by %s backlash for %d damage!",
            elem.name, backlash))
        -- who = -2: player self-harm through project_p with elemental resistance applied
        project(-2, 0, player.py, player.px, backlash, elem.gf, bor(PROJECT_KILL, PROJECT_HIDE))
    end
end

-- Backward compatibility alias
do_runecraft_slice = do_runecraft

-- -------------------------------------------------------------------------
-- 6. Register M-key Hook for Action 9 (Use Runespells)
-- -------------------------------------------------------------------------
add_mkey
{
    ["mkey"] = RC_ACTION_MKEY,
    ["fct"]  = function()
        do_runecraft()
    end,
}
