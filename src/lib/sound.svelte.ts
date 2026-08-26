/**
 * Activity sound.
 *
 * The activity rail sits open all day, so new entries land while you are
 * looking at something else. A short chime is the cheapest way to notice one
 * without watching the column — and it has to be the cheapest thing to switch
 * off, which is why the toggle lives in the activity header rather than three
 * levels down in settings.
 *
 * Off by default: a tool that makes noise before you asked it to is a tool
 * people mute at the OS level and never un-mute.
 */
import { browser } from "$app/environment";

const KEY = "oc:activity-sound";

let enabled = $state(false);
if (browser) enabled = localStorage.getItem(KEY) === "on";

/**
 * Built on first use, not at import: constructing an AudioContext before any
 * gesture leaves it suspended and, in some browsers, logs a warning.
 */
let ctx: AudioContext | null = null;

function play(tone: "new" | "attention") {
  if (!browser) return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();

    // Rising for ordinary activity, falling for something that wants you.
    const notes = tone === "attention" ? [640, 430] : [640, 860];
    for (const [i, hz] of notes.entries()) {
      const at = ctx.currentTime + i * 0.085;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = hz;
      // Ramped rather than gated — a square envelope clicks at both ends.
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.05, at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.15);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.17);
    }
  } catch {
    // No output device, an autoplay policy, an old browser: none of these are
    // worth interrupting the page over. Silence is a fine failure mode.
  }
}

export const sound = {
  get enabled() {
    return enabled;
  },

  toggle() {
    enabled = !enabled;
    if (browser) localStorage.setItem(KEY, enabled ? "on" : "off");
    // Play on the way on so you hear what you just agreed to. It doubles as
    // the user gesture that unlocks the audio context for later chimes.
    if (enabled) play("new");
  },

  /** Called when the feed gains entries. Silent unless asked for. */
  chime(tone: "new" | "attention" = "new") {
    if (enabled) play(tone);
  },
};
