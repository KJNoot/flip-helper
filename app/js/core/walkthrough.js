// A short, skippable first-run walkthrough. 4 plain screens.
const KEY = "flip-helper.walkthroughDone";

function store(injected) {
  if (injected) return injected;
  try { return globalThis.localStorage; } catch (e) { return null; }
}

export const WALKTHROUGH_SCREENS = [
  {
    id: "welcome",
    title: "Welcome to Flip Helper",
    body: "This app helps you sell something on more than one site. Take a photo, get a draft listing, and keep track from listed to sold to shipped.",
    extra: "There is no account to create. Everything stays on this phone, except when you ask for a draft from a photo."
  },
  {
    id: "add",
    title: "Start with a photo",
    body: "On the bottom row, tap Add. Take a photo, then tap “Make a draft from the photo”. Check the draft, change anything that's wrong, and tap Save.",
    extra: "You can also write the listing yourself, or use Buy or pass at a thrift store to see if an item is worth buying."
  },
  {
    id: "sell",
    title: "List it, then take it down when it sells",
    body: "Open an item and tap “Copy for” a site, then post it in that site's own app. Tick the site so Flip Helper can keep track. When it sells, tap “Mark as sold”. If it's still listed elsewhere, a loud card will help you take it down so it doesn't sell twice.",
    extra: "This app cannot promise a double sale is impossible. Please still check."
  },
  {
    id: "help",
    title: "Help is always here",
    body: "Tap “Ask a question” any time — the round button — and ask in plain words. You'll get a short answer and which button to tap. “Send a suggestion” at the top sends an idea to the people building the app.",
    extra: "You're ready. You can see these tips again from Settings."
  }
];

export function walkthroughDone(storage) {
  const s = store(storage);
  if (!s) return false;
  try { return s.getItem(KEY) === "1"; } catch (e) { return false; }
}

export function setWalkthroughDone(done = true, storage) {
  const s = store(storage);
  if (!s) return;
  try {
    if (done) s.setItem(KEY, "1");
    else s.removeItem(KEY);
  } catch (e) { /* quota */ }
}

export function shouldShowWalkthrough(storage) {
  return !walkthroughDone(storage);
}

export { KEY as WALKTHROUGH_KEY };
