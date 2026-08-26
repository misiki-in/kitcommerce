/**
 * "You are running a version whose notes you have not read yet."
 *
 * The whole check is local: the build knows its own version, the browser
 * remembers the last one whose notes were opened, and a mismatch is the
 * notification. Updating is `git pull`, so by the time there is something new
 * to announce the new notes are already on disk — which means the honest
 * trigger is the version changing under the user, not a poll against a release
 * feed. No network, works offline, and cannot tell you about an update you do
 * not actually have.
 *
 * A fresh install shows the badge once. That is intended: the notes for the
 * version you just installed are worth one glance, and dismissing them is a
 * single click.
 */
import { browser } from "$app/environment";
import { CURRENT_VERSION } from "./releases";

/** Read by nothing else, but named consistently with the theme key. */
const KEY = "oc:seen-release";

let seen = $state("");

if (browser) {
  try {
    seen = localStorage.getItem(KEY) ?? "";
  } catch {
    // Private mode or storage disabled. Showing the badge every load is a
    // worse failure than never showing it, so treat storage loss as read.
    seen = CURRENT_VERSION;
  }
}

export const releaseNotice = {
  /** True when this build's notes have not been opened on this device. */
  get unread() {
    return seen !== CURRENT_VERSION;
  },

  get version() {
    return CURRENT_VERSION;
  },

  markRead() {
    seen = CURRENT_VERSION;
    if (!browser) return;
    try {
      localStorage.setItem(KEY, CURRENT_VERSION);
    } catch {
      // Nothing to recover: the badge simply returns on the next load.
    }
  },
};
