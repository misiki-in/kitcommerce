/**
 * Theme preference.
 *
 * Three states, not two. "System" is a real choice and the default, because a
 * tool someone keeps open all day should start out agreeing with the rest of
 * their machine — a seller who runs their OS dark and gets a white dashboard on
 * first launch has been given a preference they did not ask for. Light and dark
 * are then explicit overrides for the people who want the app to disagree with
 * the OS, which is a real thing to want and is exactly what "system" cannot
 * express on its own.
 *
 * The class goes on <html> rather than <body>: app.css scopes the dark tokens
 * to `.dark`, and putting it on the documentElement means the background is
 * settled before anything inside the body renders.
 *
 * Paired with the inline script in app.html, which applies the same class
 * before first paint. That script is the load-bearing half — without it every
 * navigation in dark mode starts with a white frame, and this module runs far
 * too late to prevent it. If you change the storage key or the resolution rule
 * here, change it there in the same commit.
 */
import { browser } from "$app/environment";

export type ThemePref = "light" | "dark" | "system";

/** Shared with the inline script in app.html. Changing one changes both. */
export const THEME_KEY = "oc:theme";

const isPref = (v: unknown): v is ThemePref =>
  v === "light" || v === "dark" || v === "system";

let pref = $state<ThemePref>("system");
let systemDark = $state(false);

if (browser) {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (isPref(stored)) pref = stored;
  } catch {
    // Private mode, or storage disabled entirely. Following the OS is a fine
    // place to land, and it is what the inline script fell back to as well.
  }
  systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolved(): "light" | "dark" {
  if (pref === "system") return systemDark ? "dark" : "light";
  return pref;
}

/**
 * Write the resolution to the document.
 *
 * `color-scheme` matters as much as the class: it is what makes the scrollbars,
 * the date pickers and Chrome's autofill overlay switch with the app instead of
 * staying stubbornly light on a dark page.
 */
function paint() {
  if (!browser) return;
  const dark = resolved() === "dark";
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

export const theme = {
  /** What the person chose. */
  get pref(): ThemePref {
    return pref;
  },

  /** What that choice currently means. */
  get resolved(): "light" | "dark" {
    return resolved();
  },

  set(next: ThemePref) {
    pref = next;
    if (browser) {
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch {
        // The theme still applies for this session; it just will not survive a
        // reload. Better than refusing to switch.
      }
      paint();
    }
  },

  /**
   * Start following the OS setting. Returns a teardown, so the caller decides
   * the lifetime rather than this module leaking a listener for the life of
   * the tab.
   *
   * The listener runs whatever the preference is, because someone on "light"
   * can switch to "system" later and the answer has to already be current.
   */
  watchSystem(): () => void {
    if (!browser) return () => {};
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => {
      systemDark = e.matches;
      paint();
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  },
};
