"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  Users,
  Wifi,
  BookOpen,
  Copy,
  Check,
  Trophy,
  Undo2,
  RotateCcw,
  Volume2,
  VolumeX,
  X,
  LogOut,
  Zap,
  Loader2,
  Radio,
  SkipForward,
} from "lucide-react";
import GameCanvas from "@/components/GameCanvas";
import { storageGet, storageSet, storageSetJSON } from "@/game/storage";
import { Director, HudState } from "@/game/director";
import type { BotLevel } from "@/game/ai";
import { sound } from "@/game/sound";
import { ARENAS, DEFAULT_ARENA, getArena } from "@/game/arenas";
import {
  PITCH_KINDS,
  PitchKind,
  pitchShape,
  shapeLabel,
  currentIsPhone,
  currentIsLandscape,
} from "@/game/presets";

/* ================= helpers ================= */

// UI accents: soft bright neon cyan and coral red, matching the on-pitch laser/neon lines
const BLUE = "#00d4ff";
const RED = "#ff3366";

function labelSide(hud: HudState, idx: 0 | 1): string {
  if (hud.mode === "online") return idx === hud.mySide ? "ВЫ" : "СОПЕРНИК";
  return hud.names[idx];
}

const NAMES_KEY = "ps_names";
function loadNames(): [string, string] {
  try {
    const raw = storageGet(NAMES_KEY);
    if (!raw) return ["Ты", "Соперник"];
    const p = JSON.parse(raw) as [string, string];
    return [String(p[0] ?? "Ты"), String(p[1] ?? "Соперник")];
  } catch {
    return ["Ты", "Соперник"];
  }
}
function saveNames(n: [string, string]) {
  storageSetJSON(NAMES_KEY, n);
}

function cls(...xs: (string | false | null | undefined)[]): string {
  return xs.filter(Boolean).join(" ");
}

interface BoardData {
  recent: unknown[];
  bot: { difficulty: string | null; wins: number; losses: number }[];
}

/* ================= page ================= */

export default function Page() {
  const director = useMemo(() => new Director(), []);
  const [hud, setHud] = useState<HudState | null>(() => director.hud());
  const [rulesOpen, setRulesOpen] = useState(false);

  useEffect(() => director.subscribe(setHud), [director]);
  useEffect(() => {
    director.startDemo();
    return () => director.dispose();
  }, [director]);

  // Any user activity wakes the pitch from the attract screensaver.
  useEffect(() => {
    const wake = () => director.notifyActivity();
    const opts = { passive: true } as const;
    window.addEventListener("pointerdown", wake, opts);
    window.addEventListener("pointermove", wake, opts);
    window.addEventListener("wheel", wake, opts);
    window.addEventListener("keydown", wake);
    return () => {
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("pointermove", wake);
      window.removeEventListener("wheel", wake);
      window.removeEventListener("keydown", wake);
    };
  }, [director]);

  // Desktop shortcut: Space voluntarily passes the turn when the in-game Pass
  // control is available. Ignore form/button focus so typing and native button
  // keyboard activation keep their normal browser behaviour.
  useEffect(() => {
    const isEditable = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      return Boolean(
        target.closest("input, textarea, select, button, [contenteditable='true'], [role='textbox']"),
      );
    };
    const onKeyDown = (event: KeyboardEvent) => {
      let coarsePointer = false;
      try {
        coarsePointer = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
      } catch {
        coarsePointer = false;
      }
      if (
        event.code !== "Space" ||
        event.repeat ||
        event.defaultPrevented ||
        coarsePointer ||
        isEditable(event.target)
      ) return;
      if (!director.hud().canEndTurn) return;
      event.preventDefault(); // do not scroll the page when Space performs Pass
      director.endTurn();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [director]);

  return (
    <main className="noise relative h-[100dvh] w-full overflow-hidden bg-[#050805]">
      <GameCanvas director={director} />
      {hud && hud.phase === "menu" && (
        <MenuScreen director={director} onRules={() => setRulesOpen(true)} />
      )}
      {hud && hud.phase !== "menu" && (
        <GameHUD hud={hud} director={director} />
      )}
      {rulesOpen && <RulesModal onClose={() => setRulesOpen(false)} />}
    </main>
  );
}

/* ================= menu ================= */

function MenuScreen({ director, onRules }: { director: Director; onRules: () => void }) {
  const [level, setLevel] = useState<BotLevel>("medium");
  const [winScore, setWinScore] = useState(3);
  const [pitchKind, setPitchKind] = useState<PitchKind>("classic");
  // Phones get a rectangular pitch oriented like the screen, so the cells stay
  // large and tappable in both portrait and landscape.
  const [phone, setPhone] = useState(false);
  const [landscape, setLandscape] = useState(false);
  const [names, setNames] = useState<[string, string]>(["Ты", "Соперник"]);
  const [arena, setArenaState] = useState<string>(DEFAULT_ARENA);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [board, setBoard] = useState<BoardData | null>(null);
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    void fetch("/api/matches")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setBoard(d as BoardData))
      .catch(() => undefined);
    setHasSession(!!storageGet("ps_room"));
    setNames(loadNames());
    const savedArena = getArena(storageGet("ps_arena")).id;
    setArenaState(savedArena);
    director.setArena(savedArena);
  }, [director]);

  // Pitch shape follows the device class and survives rotation.
  useEffect(() => {
    const sync = () => {
      const isPhone = currentIsPhone();
      setPhone(isPhone);
      setLandscape(currentIsLandscape());
      // Marathon is intentionally desktop/tablet-only: phones keep the two
      // compact, fully playable presets instead of exposing a scrolling field.
      if (isPhone && pitchKind === "marathon") setPitchKind("classic");
    };
    sync();
    window.addEventListener("resize", sync);
    window.addEventListener("orientationchange", sync);
    return () => {
      window.removeEventListener("resize", sync);
      window.removeEventListener("orientationchange", sync);
    };
  }, [pitchKind]);

  const pickArena = (id: string) => {
    setArenaState(id);
    director.setArena(id); // live preview on the attract pitch behind the menu
    storageSet("ps_arena", id);
  };

  const setName = (i: 0 | 1, v: string) => {
    const next: [string, string] = i === 0 ? [v, names[1]] : [names[0], v];
    setNames(next);
    saveNames(next);
  };

  const click = (fn: () => void) => () => {
    sound.unlock();
    sound.ui();
    setErr(null);
    fn();
  };

  const shape = pitchShape(pitchKind, phone, landscape);
  const cfg = { size: shape.cols, cols: shape.cols, rows: shape.rows, winScore };

  const hostGame = async () => {
    setBusy("host");
    try {
      await director.hostOnline(cfg);
    } catch (e) {
      setErr(`Не удалось создать комнату: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const joinGame = async (withStored?: boolean) => {
    setBusy("join");
    try {
      if (withStored) {
        director.resumeSession();
      } else {
        if (code.trim().length < 4) {
          setErr("Введите код комнаты");
          return;
        }
        await director.joinOnline(code.trim());
      }
    } catch (e) {
      const msg = (e as Error).message;
      setErr(msg === "not-found" ? "Комната не найдена" : msg === "room-full" ? "Комната уже заполнена" : msg);
    } finally {
      setBusy(null);
    }
  };

  const botStat = (d: string) => board?.bot.find((b) => b.difficulty === d);

  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-gradient-to-b from-black/72 via-black/55 to-black/80">
      <header className="flex items-center justify-end px-5 py-4 md:px-8">
        <button
          onClick={click(onRules)}
          className="flex items-center gap-2 transition-colors hover:text-[#9fe870]"
        >
          <BookOpen size={14} /> Правила
        </button>
      </header>

      <div className="flex-1 overflow-y-auto scroll-thin">
        <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col items-center justify-center px-5 pb-10">
          <div className="anim-rise text-center">
            <h1 className="display mt-3 text-[clamp(3.4rem,11vw,8.5rem)] text-[#f0ead6]">
              Paper <span className="text-stroke">Soccer</span>
            </h1>
          </div>

          <div className="mt-8 grid w-full max-w-3xl gap-3 md:grid-cols-3">
            {/* vs bot */}
            <div className="mode-card anim-rise-1 glass rounded-2xl p-5">
              <div className="flex items-center justify-between">
                <Bot size={20} className="text-[#9fe870]" />
              </div>
              <h3 className="display mt-4 text-2xl">Против бота</h3>
              <div className="mt-4 flex gap-1.5">
                {(["easy", "medium", "hard"] as BotLevel[]).map((l) => (
                  <button
                    key={l}
                    onClick={click(() => setLevel(l))}
                    className={cls(
                      "flex-1 rounded-lg border px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors",
                      level === l
                        ? "border-[#9fe870] bg-[#9fe870]/15 text-[#9fe870]"
                        : "border-white/10 text-[#f0ead6]/55 hover:border-white/25",
                    )}
                  >
                    {l === "easy" ? "Лёгкий" : l === "medium" ? "Средний" : "Тяжёлый"}
                  </button>
                ))}
              </div>
              {/* team names */}
              <div className="mt-3 grid grid-cols-2 gap-1.5">
                <label className="flex flex-col gap-1">
                  <span className="text-[8px] font-bold uppercase tracking-[0.2em]" style={{ color: BLUE }}>
                    Твоя команда
                  </span>
                  <input
                    value={names[0]}
                    maxLength={14}
                    onChange={(e) => setName(0, e.target.value)}
                    placeholder="Ты"
                    className="w-full rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 text-[12px] text-[#f0ead6] outline-none placeholder:text-[#f0ead6]/30 focus:border-[#9fe870]/60"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[8px] font-bold uppercase tracking-[0.2em]" style={{ color: RED }}>
                    Соперник
                  </span>
                  <input
                    value={names[1]}
                    maxLength={14}
                    onChange={(e) => setName(1, e.target.value)}
                    placeholder="Соперник"
                    className="w-full rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 text-[12px] text-[#f0ead6] outline-none placeholder:text-[#f0ead6]/30 focus:border-[#9fe870]/60"
                  />
                </label>
              </div>
              {botStat(level) && (
                <p className="mono mt-2 text-[10px] text-[#f0ead6]/40">
                  история: {botStat(level)!.wins}W — {botStat(level)!.losses}L
                </p>
              )}
              <button
                onClick={click(() => director.startBot(level, cfg, names))}
                className="mt-3 w-full rounded-xl bg-[#9fe870] py-2.5 text-xs font-black uppercase tracking-[0.18em] text-[#061006] transition-transform hover:scale-[1.02] active:scale-95"
              >
                Кик-офф
              </button>
            </div>

            {/* local */}
            <div className="mode-card anim-rise-2 glass flex flex-col rounded-2xl p-5">
              <div className="flex items-center justify-between">
                <Users size={20} style={{ color: RED }} />
              </div>
              <h3 className="display mt-4 text-2xl">Двое за экраном</h3>
              <p className="mt-4 text-[11px] leading-relaxed text-[#f0ead6]/55">
                Классика на перемене: ходите по очереди одним устройством.
                Синие атакуют красные ворота, красные — синие. Перед матчем — жеребьёвка.
              </p>
              <button
                onClick={click(() => director.startLocal(cfg))}
                className="mt-auto w-full rounded-xl py-2.5 pt-2.5 text-xs font-black uppercase tracking-[0.18em] text-black transition-transform hover:scale-[1.02] active:scale-95"
                style={{ background: RED, marginTop: "auto" }}
              >
                Начать матч
              </button>
            </div>

            {/* online */}
            <div className="mode-card anim-rise-3 glass rounded-2xl p-5">
              <div className="flex items-center justify-between">
                <Wifi size={20} className="text-[#5ad2ff]" />
              </div>
              <h3 className="display mt-4 text-2xl">Онлайн PvP</h3>
              <div className="mt-4 flex gap-1.5">
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5))}
                  placeholder="КОД"
                  className="mono w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm tracking-[0.3em] text-[#f0ead6] outline-none placeholder:text-[#f0ead6]/25 focus:border-[#5ad2ff]/60"
                />
                <button
                  onClick={click(() => void joinGame())}
                  disabled={busy !== null}
                  className="rounded-lg border border-[#5ad2ff]/40 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[#5ad2ff] transition-colors hover:bg-[#5ad2ff]/10 disabled:opacity-40"
                >
                  Войти
                </button>
              </div>
              <button
                onClick={click(() => void hostGame())}
                disabled={busy !== null}
                className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-xl bg-[#5ad2ff] py-2.5 text-xs font-black uppercase tracking-[0.18em] text-black transition-transform hover:scale-[1.02] active:scale-95 disabled:opacity-50"
              >
                {busy === "host" ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                Создать комнату
              </button>
              {hasSession && (
                <button
                  onClick={click(() => void joinGame(true))}
                  className="mono mt-2 w-full text-center text-[10px] uppercase tracking-widest text-[#f0ead6]/45 underline-offset-2 hover:text-[#5ad2ff] hover:underline"
                >
                  переподключиться к матчу
                </button>
              )}
            </div>
          </div>

          {/* arena picker */}
          <div className="anim-rise-3 mt-6 w-full max-w-3xl">
            <p className="mb-2 text-center text-[10px] uppercase tracking-[0.25em] text-[#f0ead6]/45">
              арена
            </p>
            <div className="grid grid-cols-5 gap-2">
              {ARENAS.map((a) => {
                const active = a.id === arena;
                return (
                  <button
                    key={a.id}
                    onClick={click(() => pickArena(a.id))}
                    title={a.tagline}
                    className={cls(
                      "group relative overflow-hidden rounded-xl border p-1 text-left transition-all",
                      active
                        ? "border-[#9fe870] shadow-[0_0_0_2px_rgba(159,232,112,0.25)]"
                        : "border-white/10 hover:border-white/30",
                    )}
                  >
                    <div
                      className="relative h-14 w-full rounded-lg md:h-16"
                      style={{ background: a.swatch }}
                    >
                      {/* mini pitch markings */}
                      <div
                        className="absolute inset-[14%] rounded-[2px] border opacity-70"
                        style={{ borderColor: `rgb(${a.chalk.join(",")})` }}
                      />
                      <div
                        className="absolute left-1/2 top-1/2 h-[26%] w-[26%] -translate-x-1/2 -translate-y-1/2 rounded-full border opacity-70"
                        style={{ borderColor: `rgb(${a.chalk.join(",")})` }}
                      />
                      <div
                        className="absolute left-[14%] right-[14%] top-1/2 h-px opacity-70"
                        style={{ background: `rgb(${a.chalk.join(",")})` }}
                      />
                      {active && (
                        <span className="absolute right-1 top-1 rounded-full bg-[#9fe870] p-0.5 text-black">
                          <Check size={9} strokeWidth={3} />
                        </span>
                      )}
                    </div>
                    <p
                      className={cls(
                        "mt-1.5 truncate px-1 pb-0.5 text-[9px] font-bold uppercase tracking-[0.12em]",
                        active ? "text-[#9fe870]" : "text-[#f0ead6]/65 group-hover:text-[#f0ead6]",
                      )}
                    >
                      {a.name}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* match config */}
          <div className="anim-rise-3 mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-3">
            <span className="text-[10px] uppercase tracking-[0.25em] text-[#f0ead6]/45">поле:</span>
            {PITCH_KINDS.filter((k) => !phone || k.kind !== "marathon").map((k) => {
              const sh = pitchShape(k.kind, phone, landscape);
              return (
                <button
                  key={k.kind}
                  onClick={click(() => setPitchKind(k.kind))}
                  className={cls(
                    "rounded-lg border px-3 py-1.5 transition-colors",
                    pitchKind === k.kind
                      ? "border-[#9fe870] bg-[#9fe870]/15 text-[#9fe870]"
                      : "border-white/10 text-[#f0ead6]/50 hover:border-white/30",
                  )}
                >
                  <span className="display text-lg leading-none">{shapeLabel(sh)}</span>
                  <span className="ml-1.5 text-[9px] uppercase tracking-wider opacity-70">{k.hint}</span>
                </button>
              );
            })}
            <span className="mx-2 hidden h-6 w-px bg-white/10 sm:block" />
            <span className="text-[10px] uppercase tracking-[0.25em] text-[#f0ead6]/45">матч до:</span>
            {[1, 3, 5].map((n) => (
              <button
                key={n}
                onClick={click(() => setWinScore(n))}
                className={cls(
                  "display h-9 w-9 rounded-lg border text-lg transition-colors",
                  winScore === n
                    ? "border-[#9fe870] bg-[#9fe870]/15 text-[#9fe870]"
                    : "border-white/10 text-[#f0ead6]/50 hover:border-white/30",
                )}
              >
                {n}
              </button>
            ))}
          </div>
          {err && (
            <p className="mt-3 rounded-lg border border-red-400/30 bg-red-500/10 px-4 py-2 text-xs text-red-300">
              {err}
            </p>
          )}

        </div>
      </div>
    </div>
  );
}

/* ================= in-game HUD ================= */

function GameHUD({
  hud,
  director,
}: {
  hud: HudState;
  director: Director;
}) {
  const [copied, setCopied] = useState(false);

  const click = (fn: () => void) => () => {
    sound.unlock();
    sound.ui();
    fn();
  };

  const turnText = (): string => {
    if (hud.mode === "online") {
      if (!hud.peerConnected) return "ОЖИДАЕМ СОПЕРНИКА";
      return hud.current === hud.mySide ? "ВАШ УДАР" : "ХОД СОПЕРНИКА";
    }
    if (hud.mode === "bot") {
      return hud.current === 0 ? `УДАР — ${hud.names[0].toUpperCase()}` : `${hud.names[1].toUpperCase()} ДУМАЕТ…`;
    }
    return `ХОД — ${hud.names[hud.current].toUpperCase()}`;
  };

  const turnColor = hud.current === 0 ? BLUE : RED;

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex flex-col">
      {/* top bar: 3 equal columns → scoreboard is dead-centre regardless of button widths.
          Base classes are the compact phone layout; md: restores the roomy desktop one. */}
      <div className="pointer-events-auto grid grid-cols-[1fr_auto_1fr] items-start gap-2 px-2.5 pt-2 md:px-5 md:pt-3">
        <div className="flex justify-start">
          <button
            onClick={click(() => director.quitToMenu())}
            className="glass flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-[0.18em] text-[#f0ead6]/75 transition-colors hover:text-[#9fe870]"
          >
            <LogOut size={12} /> Меню
          </button>
        </div>

        {/* compact scoreboard — centred */}
        <div className="glass anim-rise justify-self-center rounded-xl px-2.5 py-1 md:px-4 md:py-1.5">
          <div className="flex items-center gap-2 md:gap-4">
            <div className="flex min-w-[52px] flex-col items-center md:min-w-[84px]">
              <span
                className="mb-0.5 h-1 w-5 rounded-full transition-all md:w-6"
                style={{
                  background: hud.current === 0 && hud.phase === "playing" ? BLUE : "rgba(91,139,224,0.25)",
                }}
              />
              <span
                className="max-w-[70px] truncate text-[7px] font-bold uppercase tracking-[0.18em] md:max-w-[110px] md:text-[8px]"
                style={{ color: `${BLUE}dd` }}
                title={labelSide(hud, 0)}
              >
                {labelSide(hud, 0)}
              </span>
              <span className="display text-xl leading-none md:text-3xl" style={{ color: BLUE }}>
                {hud.scores[0]}
              </span>
            </div>
            <div className="flex flex-col items-center pb-1">
              <span className="display text-base leading-none text-[#f0ead6]/35 md:text-lg">:</span>
              <span className="mono text-[7px] uppercase tracking-[0.2em] text-[#f0ead6]/40">
                до {hud.cfg.winScore}
              </span>
            </div>
            <div className="flex min-w-[52px] flex-col items-center md:min-w-[84px]">
              <span
                className="mb-0.5 h-1 w-5 rounded-full transition-all md:w-6"
                style={{
                  background: hud.current === 1 && hud.phase === "playing" ? RED : "rgba(224,86,74,0.25)",
                }}
              />
              <span
                className="max-w-[70px] truncate text-[7px] font-bold uppercase tracking-[0.18em] md:max-w-[110px] md:text-[8px]"
                style={{ color: `${RED}dd` }}
                title={labelSide(hud, 1)}
              >
                {labelSide(hud, 1)}
              </span>
              <span className="display text-xl leading-none md:text-3xl" style={{ color: RED }}>
                {hud.scores[1]}
              </span>
            </div>
          </div>
        </div>

        {/* Secondary actions stay in the top bar; Pass lives by the thumb. */}
        <div className="flex justify-end gap-1.5">
          <button
            onClick={click(() => director.undo())}
            disabled={!hud.canUndo}
            title="Отменить ход"
            className="glass rounded-lg p-2 text-[#f0ead6]/75 transition-colors hover:text-[#9fe870] disabled:opacity-30"
          >
            <Undo2 size={14} />
          </button>
          {hud.mode !== "online" && (
            <button
              onClick={click(() => director.rematch())}
              title="Начать заново"
              className="glass rounded-lg p-2 text-[#f0ead6]/75 transition-colors hover:text-[#9fe870]"
            >
              <RotateCcw size={14} />
            </button>
          )}
          <button
            onClick={click(() => director.toggleSound())}
            className="glass rounded-lg p-2 text-[#f0ead6]/75 transition-colors hover:text-[#9fe870]"
          >
            {hud.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </button>
        </div>
      </div>

      {/* turn pill + banner */}
      <div className="mt-1.5 flex flex-col items-center gap-1 md:mt-2 md:gap-1.5">
        <div
          className="glass mono flex items-center gap-2 rounded-full px-3 py-0.5 text-[8px] uppercase tracking-[0.28em] md:px-3.5 md:py-1 md:text-[9px]"
          style={{ color: turnColor }}
        >
          <span
            className="inline-block h-1.5 w-1.5 animate-[pulsedot_1.2s_ease-in-out_infinite] rounded-full"
            style={{ background: turnColor }}
          />
          {turnText()}
          {hud.phase === "playing" && (
            <span className="rounded bg-white/10 px-1.5 py-0.5 text-[8px] tracking-[0.12em] text-[#f0ead6]/75">
              {hud.bouncePending ? "↩ ОТСКОК" : `${hud.turnMoves}/3`}
            </span>
          )}
          {hud.thinking && <Loader2 size={11} className="animate-spin" />}
        </div>
        {hud.banner && (
          <div className="anim-goal display rounded-lg border border-[#9fe870]/40 bg-black/70 px-4 py-1.5 text-base tracking-[0.15em] text-[#9fe870]">
            {hud.banner}
          </div>
        )}
      </div>

      {/* coin toss overlay */}
      {hud.toss && <CoinTossOverlay winner={hud.toss.winner} at={hud.toss.at} hud={hud} />}

      {/* Desktop/tablet Pass stays where it was: centred below the pitch.
          On phones the canvas positions a separate button beside the goal. */}
      {hud.canEndTurn && !hud.phone && (
        <div className="pass-dock pointer-events-none absolute bottom-[max(0.5rem,env(safe-area-inset-bottom))] right-[max(0.75rem,env(safe-area-inset-right))] z-10 md:right-auto md:left-1/2 md:-translate-x-1/2">
          <button
            type="button"
            onClick={click(() => director.endTurn())}
            aria-label="Пас — завершить ход и передать мяч сопернику"
            title="Завершить ход и передать мяч"
            className="pointer-events-auto flex min-h-12 min-w-28 items-center justify-center gap-2 rounded-xl border border-[#9fe870]/50 bg-[#0b170e]/95 px-4 text-[12px] font-bold uppercase tracking-[0.14em] text-[#b9ef8c] shadow-[0_8px_28px_rgba(0,0,0,0.4)] backdrop-blur-sm transition-colors hover:border-[#9fe870] hover:bg-[#193020] active:scale-[0.98]"
          >
            <SkipForward size={16} aria-hidden="true" />
            <span>Пас</span>
            <span className="hidden border-l border-[#9fe870]/30 pl-2 text-[10px] font-normal normal-case tracking-normal text-[#f0ead6]/60 md:inline">
              передать ход
            </span>
          </button>
        </div>
      )}

      {/* lobby overlay */}
      {hud.phase === "lobby" && (
        <LobbyOverlay hud={hud} director={director} copied={copied} setCopied={setCopied} />
      )}

      {/* goal overlay */}
      {hud.phase === "goal" && hud.goalFlash && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="anim-goal text-center">
            <p className="display rotate-[-3deg] text-[clamp(4rem,16vw,11rem)] text-[#9fe870] drop-shadow-[0_10px_40px_rgba(0,0,0,0.8)]">
              ГОЛ!
            </p>
            <p className="display mt-2 text-xl tracking-[0.2em] text-[#f0ead6]">
              {labelSide(hud, hud.goalFlash.scorer)} ЗАБИВАЕТ
            </p>
          </div>
        </div>
      )}

      {/* match over */}
      {hud.phase === "matchover" && <MatchOverOverlay hud={hud} director={director} />}
    </div>
  );
}

function CoinTossOverlay({ winner, at, hud }: { winner: 0 | 1; at: number; hud: HudState }) {
  const [, force] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => force((x) => x + 1), 100);
    return () => clearInterval(iv);
  }, []);
  const elapsed = performance.now() - at;
  if (elapsed > 2500) return null;
  const teamColor = winner === 0 ? BLUE : RED;
  const teamName =
    hud.mode === "online"
      ? winner === hud.mySide
        ? "ВЫ ХОДИТЕ ПЕРВЫМИ"
        : "ПЕРВЫЙ ХОД — СОПЕРНИК"
      : `ПЕРВЫЙ ХОД — ${hud.names[winner].toUpperCase()}`;
  const settled = elapsed > 1150;
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
      <div className="flex flex-col items-center">
        <p className="mono mb-5 text-[10px] uppercase tracking-[0.4em] text-[#f0ead6]/60">
          жеребьёвка
        </p>
        {/* coin */}
        <div className="coin-spin relative h-24 w-24" style={{ perspective: "600px" }}>
          <div
            className="absolute inset-0 rounded-full border-4"
            style={{
              borderColor: settled ? teamColor : "rgba(212,175,55,0.9)",
              background: settled
                ? `radial-gradient(circle at 35% 30%, ${teamColor}ff, ${teamColor}88 70%, #00000055)`
                : "radial-gradient(circle at 35% 30%, #ffe289, #d4af37 65%, #8a6d1f)",
              boxShadow: "0 10px 40px rgba(0,0,0,0.6), inset 0 2px 8px rgba(255,255,255,0.35)",
            }}
          />
          <div className="absolute inset-0 flex items-center justify-center">
            {settled ? (
              <span className="display text-2xl" style={{ color: "#ffffff" }}>
                {winner === 0 ? "С" : "К"}
              </span>
            ) : (
              <span className="display text-3xl text-[#8a6d1f]">?</span>
            )}
          </div>
        </div>
        {/* result */}
        <p className="toss-text display mt-6 text-3xl tracking-[0.08em]" style={{ color: teamColor }}>
          {teamName}
        </p>
      </div>
    </div>
  );
}

function LobbyOverlay({
  hud,
  director,
  copied,
  setCopied,
}: {
  hud: HudState;
  director: Director;
  copied: boolean;
  setCopied: (b: boolean) => void;
}) {
  const copy = async () => {
    sound.unlock();
    sound.ui();
    try {
      await navigator.clipboard.writeText(hud.roomCode ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked */
    }
  };
  return (
    <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass anim-rise noise relative w-[min(92vw,430px)] rounded-3xl p-8 text-center">
        <Radio size={18} className="breathe mx-auto text-[#5ad2ff]" />
        <h2 className="display mt-3 text-2xl">Комната создана</h2>
        <p className="mt-2 text-xs text-[#f0ead6]/60">
          Отправь код другу — он подключится с главного экрана.
        </p>
        <button
          onClick={() => void copy()}
          className="group mx-auto mt-5 flex items-center gap-3 rounded-2xl border border-[#5ad2ff]/30 bg-black/50 px-8 py-4 transition-colors hover:border-[#5ad2ff]/70"
        >
          <span className="mono text-4xl font-bold tracking-[0.35em] text-[#f0ead6]">{hud.roomCode}</span>
          {copied ? <Check size={18} className="text-[#9fe870]" /> : <Copy size={18} className="text-[#5ad2ff]" />}
        </button>
        <div className="mono mt-5 flex items-center justify-center gap-2 text-[10px] uppercase tracking-[0.3em] text-[#f0ead6]/45">
          <span className="inline-block h-1.5 w-1.5 animate-[pulsedot_1.1s_ease-in-out_infinite] rounded-full bg-[#5ad2ff]" />
          ждём соперника…
        </div>
        <button
          onClick={() => {
            sound.ui();
            director.quitToMenu();
          }}
          className="mono mt-6 text-[10px] uppercase tracking-[0.25em] text-[#f0ead6]/45 underline-offset-2 hover:text-red-300 hover:underline"
        >
          отменить матч
        </button>
      </div>
    </div>
  );
}

function MatchOverOverlay({ hud, director }: { hud: HudState; director: Director }) {
  const title =
    hud.winner === null
      ? "НИЧЬЯ"
      : hud.mode === "online"
        ? hud.winner === hud.mySide
          ? "ПОБЕДА!"
          : "ПОРАЖЕНИЕ"
        : hud.mode === "bot"
          ? hud.winner === 0
            ? "ПОБЕДА!"
            : "ПОРАЖЕНИЕ"
          : `ПОБЕДА — ${hud.names[hud.winner].toUpperCase()}`;
  const subtitle =
    hud.winner === null ? null : `${hud.names[hud.winner]} побеждает`;
  return (
    <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-black/65 backdrop-blur-sm">
      <div className="glass anim-rise noise relative w-[min(92vw,460px)] rounded-3xl p-8 text-center">
        <Trophy
          size={26}
          className={cls("mx-auto", hud.winner !== null ? "text-[#ffd166]" : "text-[#f0ead6]/50")}
        />
        <h2 className="display mt-3 text-[clamp(2.2rem,7vw,3.4rem)] text-[#f0ead6]">{title}</h2>
        {subtitle && hud.mode !== "local" && (
          <p className="mono mt-1 text-[10px] uppercase tracking-[0.3em] text-[#f0ead6]/55">{subtitle}</p>
        )}
        <div className="display mt-2 text-6xl">
          <span style={{ color: BLUE }}>{hud.scores[0]}</span>
          <span className="mx-2 text-[#f0ead6]/40">:</span>
          <span style={{ color: RED }}>{hud.scores[1]}</span>
        </div>
        <p className="mono mt-3 text-[10px] uppercase tracking-[0.3em] text-[#f0ead6]/45">
          матч до {hud.cfg.winScore}
        </p>
        <div className="mt-6 flex gap-3">
          {hud.mode !== "online" && (
            <button
              onClick={() => {
                sound.ui();
                director.rematch();
              }}
              className="flex-1 rounded-xl bg-[#9fe870] py-3 text-xs font-black uppercase tracking-[0.2em] text-black transition-transform hover:scale-[1.02] active:scale-95"
            >
              Реванш
            </button>
          )}
          <button
            onClick={() => {
              sound.ui();
              director.quitToMenu();
            }}
            className="flex-1 rounded-xl border border-white/15 py-3 text-xs font-black uppercase tracking-[0.2em] text-[#f0ead6]/80 transition-colors hover:border-white/40"
          >
            В меню
          </button>
        </div>
      </div>
    </div>
  );
}

/* ================= rules ================= */

function RulesModal({ onClose }: { onClose: () => void }) {
  const rules: [string, string][] = [
    ["ЦЕЛЬ", "Загони мяч в ворота соперника — прямоугольный створ его цвета: синие атакуют красные ворота (сверху), красные — синие (снизу). Матч — до выбранного числа голов."],
    ["ЖЕРЕБЬЁВКА", "Как в настоящем футболе, первый ход решает бросок монетки — перед каждым матчем и реваншем."],
    ["ХОД", "Проведи 1–3 линии от мяча к соседним узлам — 8 направлений. После первой или второй нажми «Пас», если хочешь передать мяч; после третьей ход передаётся автоматически."],
    ["ОТСКОК", "Попал на узел, где уже есть линии, или на борт? Мяч отскакивает и ход продолжается от этого узла. Отскок не обновляет лимит линий на новые три хода. По самой боковой линии проехаться нельзя."],
    ["ЗАПРЕТ", "Дважды одну и ту же линию провести нельзя. Пересечение диагоналей внутри клетки — разрешено."],
    ["ПЕНАЛЬТИ", "Тупик — нет ни одного легального хода: мяч возвращается на центральную точку, удар получает соперник."],
    ["АВТОГОЛ", "Мяч в твоих воротах — очко сопернику. После гола поле очищается, начинает пропустивший."],
  ];
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="glass noise anim-rise relative max-h-[88dvh] w-[min(94vw,560px)] overflow-y-auto scroll-thin rounded-3xl p-7">
        <button
          onClick={() => {
            sound.ui();
            onClose();
          }}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-[#f0ead6]/60 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X size={16} />
        </button>
        <h2 className="display text-3xl">Правила</h2>
        <div className="mt-5 space-y-4">
          {rules.map(([t, d]) => (
            <div key={t} className="flex gap-4">
              <span className="display mt-0.5 w-20 shrink-0 text-sm text-[#9fe870]">{t}</span>
              <p className="text-[13px] leading-relaxed text-[#f0ead6]/75">{d}</p>
            </div>
          ))}
        </div>
        <div className="mt-6 rounded-2xl border border-white/10 bg-black/40 p-4">
          <p className="mono text-[9px] uppercase tracking-[0.3em] text-[#f0ead6]/40">engine core</p>
          <p className="mono mt-2 text-[11px] leading-relaxed text-[#f0ead6]/60">
            shared/engine — чистые правила, поля 15/19/23. shared/ai — random / lookahead-2 / minimax
            α-β depth 5 до прямоугольных ворот. render — процедурный PBR-газон, частицы, динамический
            свет. net — socket-контракт поверх комнат с серверной валидацией цепочек ходов.
          </p>
        </div>
      </div>
    </div>
  );
}
