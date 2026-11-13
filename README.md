# Jessika's Flip Side

An iPhone-first web app (PWA) that helps a reseller draft a listing from a photo, post it on more than one site, and keep track from listed to sold to shipped.

The display name is **Jessika's Flip Side**. The repository and preview address stay `flip-helper`, so a Home Screen shortcut already installed keeps working.

**Live preview:** https://kjnoot.github.io/flip-helper/

On an iPhone: open that address in Safari, tap the Share button, then **Add to Home Screen**. It gets its own icon and opens full screen. No App Store account is needed for this preview.

## Philosophy

One complete app from day one. There is no subscription in this test version, and no essential tool is locked behind an upgrade. The app is built so someone who is not used to computers can use it: big, clear buttons, one main action per screen, plain words, a first-open welcome and try-it demo, a short skippable walkthrough, a "?" on tricky controls, and advanced options behind "More" rather than removed.

## What this version (0.7.0) does

- **Working:** A first-open welcome that plays a short promo video (full-width, muted, with tap-for-sound and a skip button) starring a stylized Jessika character: one photo, a Buy-or-pass estimate, listing, a sold take-down checklist, and “one complete app, no upgrade games.” A “try it before you install” demo: try it with your own photo, or try one of three built-in sample items (original drawings, no real brands). The demo is fully sandboxed — a separate in-memory store, so nothing touches your real inventory, and every listing, sale, and take-down is clearly labeled pretend (“Pretend: nothing was posted”). The path is photo → AI draft (real AI if a key is already in Settings; otherwise a realistic canned example labeled Sample) → Buy or pass → pick sites → pretend listing → “Sold on Mercari!” → take-them-all-down walk-through (pretend) → packing and shipping → a profit summary. Each step has a one-line explanation of what happens for real. The end screen shows iPhone Add-to-Home-Screen steps (Share → Add to Home Screen), skipped if the app is already installed, plus “Start for real.” You can watch the intro or try the demo again from Settings. A private invite link can show a short terms summary (first names only) before the welcome video; the public link is unchanged and does not show that step. The written agreement and invite token are not in this repository. Then: Take or choose photos, and “Make it look pro”: a real on-phone studio photo. A proven U²-Netp model (Apache-2.0, about 4.4 MB, lazy-loaded and cached after the first use, no paid API) removes the background on the phone, then the app offers a pure-white marketplace backdrop, a soft gray studio, or the original background; a soft drop shadow; auto-centering with even padding; a gentle straighten if a small tilt is found; a gentle light and white-balance correction; and a square (1:1) or tall (4:5, for Poshmark and Depop-style feeds) export. A before-and-after slider lets you check the result. Apply to one photo or all of them. The original is always kept. It does not hide damage, and there is no blur or smooth filter — a note asks you to check that flaws are still visible. If the edges look off, you can try again or use the basic clean-up (brighten, contrast, crop to a square, optional plain background), which is still available as a smaller option. If the model cannot start, the app falls back to that basic clean-up with a kind message. An optional, labeled “Cover photo check” (the existing gpt-4o-mini key) can suggest a photo order and whether a missing angle (tag, sole, back, or label) would help. An AI draft (title, description, category, condition, a brand guess, price range, per-site tweaks, and "best price" / "fastest sale" site suggestions) using a key you paste once in Settings. The key stays on the phone only, in localStorage, and is never put in a backup or in this repo. Drafts are split into "Photo shows", "You confirm" (brand, material, size, flaws), and "AI guess" — the app will not invent a brand or condition as fact. You can speak flaws and measurements. A quick check flags missing measurements, an unconfirmed brand, or flaws not noted; you can still continue. You always review and can edit, with Undo, an edit history, and the original photo and text kept. Autosave, and a "Photograph the whole haul" flow that turns several photos into drafts without duplicates. In Settings you pick which sites you sell on (eBay, Poshmark, Mercari, Facebook Marketplace, Etsy, Depop, Vinted, Grailed, Shopify, OfferUp, Craigslist, Whatnot, Kidizen, and thredUP). Inventory lives on the phone (IndexedDB, with a localStorage fallback): Draft, Listed, Sold, Shipped, plus a per-site status (Draft, Pending, Live, Sold, Removed, Failed, Needs a manual step) that you set yourself, with Retry or "I did it". Cost, sale price, marketplace and payment fees, postage, supplies, discounts, returns, money received, and estimated profit. A sold take-down checklist with a countdown, an in-app badge, optional phone notifications (while the app is open), and a prominent "Take them all down automatically" button — today that flags the item Unavailable everywhere, then walks you through each remaining site and ticks it off when you confirm. This cannot promise a double sale is impossible. A "This morning" list (must ship, still live after a sale, needs a decision). Price-drop and "send offers" ideas that will not go below your profit floor. A Buy or pass scanner with a "Buy up to $X" amount and a "You may already own this" warning. A Second look button on Home: record or pick a slow pan across a table (or take one wide photo), and the app pulls stills on the phone, looks them over in the background (so she can keep shopping), and returns a list of things worth a closer look — each with a cropped thumbnail, where it is in plain words, a rough estimate (clearly labeled), and what to check (maker's marks, hallmarks, tags, condition). Each result card directs you to "Go check this one": find it, check the what-to-check list, and take a picture of just that item (and of any mark, tag or label). The table-scan price is labeled "First guess from the table: check it up close". Price, Buy up to, and Help me haggle are secondary and best used after the close-up is verified — haggle is still allowed before, with a first-guess note, and is recommended once the close-up result is in. After the close-up, the existing single-item pricing runs (that flow is not changed), then the card is marked Checked and the verified result replaces the first guess. Unchecked items are listed first, with a "2 of 3 checked" counter. "Help me haggle" suggests an opening offer, a fair price, and a walk-away number, plus three short polite lines and a bundle tip. "Coach me in my earbud" is labeled Coming later — it is not built, because a reliable live whisper is not simple to reuse in the browser. Each card also has "List it", which opens the existing listing flow already filled in from the close-up, or from the first table guess if you haven't checked yet. "Not interested" dismisses a card. Scans are saved on the phone with the date. Frames go only to the AI service for that look; thumbnails stay on the phone. A too-long video, a missing key, or no internet are handled in plain words. Bin location and an in-browser printable QR label; when an item sells, its photo, bin, and a packing checklist. Receipts, mileage, and returns tied to an item. A tax year view with a mileage log (IRS business rate), CSV, and a printable summary — not tax advice. Free export, CSV import with column mapping, and a merge-duplicates helper. "Pause all automation" (today pauses reminders and notifications). A US marketplace compatibility chart with official-API / needs-your-tap / not-available and source links. An always-visible "Ask a question" helper (same device-held key, gpt-4o-mini) that answers how-to and selling questions with the current screen, app version, and a built-in guide, and can offer "Send this as a suggestion". A short, skippable first-run walkthrough. Send a suggestion from every screen. Works offline except for AI checks. There's no subscription in this test version.
- **Estimate:** AI prices, three asking-price options (Sell quickly, Balanced, Hold for more) with estimated money you'd keep after fees and shipping, AI sold-price estimates, Buy or pass verdicts and "Buy up to", Second look table-scan guesses and haggle numbers, per-site fee tables (approximate, dated November 2026), box and weight suggestions, and shipping-cost tables (USPS Ground Advantage, USPS Priority, UPS Ground, approximate). Sold-price search links include eBay's sold and completed listings and other sites' sold filters where they exist, plus sold prices you log yourself (date, condition, confidence). If there is no sold data, the app says "No sold data yet" and does not invent a number.
- **Needs you to post:** Copy-for-site buttons and links that open each site's own selling page. You paste and post yourself, then tick the sites you listed on. Taking a listing down, and changing a price after you approve a drop, is a checklist with open links, not automatic. The guided take-down opens each site for you and waits for "I did it". Some sites will always need your tap.
- **Coming later:** Official one-tap listing and take-down, starting with eBay, Etsy, and Shopify, after an official developer account and the seller's permission, and a computer helper. Automatic checks that a listing is really live or gone. Official eBay sold prices through eBay's API (Needs eBay developer account (free), coming soon) — this version defines the adapter and does not scrape. Buying a real shipping label (needs a shipping service account). A live “coach me in my earbud” mode for haggling (mic to a short suggestion in an earbud) — not faked in this version. Not promised for Poshmark, Mercari, or Facebook Marketplace unless those companies open an official door. "Pause all automation" will cover those automatic steps when they exist.

**Prices from the AI are estimates.** They are not checked against live sold listings. Use the sold-price links, and log prices you actually see.

This app will not ask for a selling-site password, and it does not log into eBay, Poshmark, Mercari, Facebook Marketplace, Etsy, or Depop.

## Develop

```
npm test          # unit tests, then a headless phone-sized smoke test
npm run test:unit
npm run serve     # http://127.0.0.1:8080/
```

The smoke test uses Google Chrome (`/usr/bin/google-chrome`) through Playwright, in `test/`.

## Full version (later)

See [ROADMAP.md](ROADMAP.md) for the legal path to official auto-list and auto-delist (eBay, Etsy, Shopify first; Depop and Vinted by application) and a desktop companion for sites with no API, only on her approval, respecting each site's terms. Poshmark's rules against unauthorized automation are called out there on purpose. The desktop helper is the path to gold-standard double-sale protection: take a listing down everywhere within minutes, and warn loudly if any site fails.


## Intro video

The welcome screen plays `app/media/intro.mp4` (~62 seconds, 720×1280, under 15 MB), with a still at `app/media/intro-poster.jpg`. `INTRO_VIDEO_READY` is true in `app/js/core/intro.js`, so the welcome lazy-loads the file. Do not add `intro.mp4` to the service worker precache list; the service worker will not cache `.mp4` files.

To replace the video, from the repo root:

```
tools/import-intro-video.sh /workspace/flip-helper-video/flip-helper-ad-final-small.mp4
```

The full-resolution cut (1080×1920, under 50 MB) lives at `/workspace/flip-helper-video/flip-helper-ad-final.mp4`, with a chat-friendly copy at `flip-helper-ad-final-small.mp4`.

A public demo that runs real AI for people who do not have a key would need a small server proxy with rate limits. That has a cost and needs Ken's approval. It is not built. See [ROADMAP.md](ROADMAP.md).

## Deploy

The site is the `app/` folder, served from the `gh-pages` branch (subtree split), same idea as Coach:

```
git subtree split --prefix=app -b gh-pages
git push origin gh-pages --force
gh api -X POST repos/KJNoot/flip-helper/pages/builds
```

## Privacy

Never put real customer data, API keys, the tester's email, last names, addresses, the written profit-share agreement, or the private invite token in this repo. The AI key is pasted in Settings and stays on the device. Second look frames are sent only to OpenAI for that look, are not uploaded anywhere else, and thumbnails are stored on the device only.
