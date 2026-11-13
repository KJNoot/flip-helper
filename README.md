# Jessika's Flip Side

An iPhone-first web app (PWA) that helps a reseller draft a listing from a photo, post it on more than one site, and keep track from listed to sold to shipped.

The display name is **Jessika's Flip Side**. The repository and preview address stay `flip-helper`, so a Home Screen shortcut already installed keeps working.

**Live preview:** https://kjnoot.github.io/flip-helper/

On an iPhone: open that address in Safari, tap the Share button, then **Add to Home Screen**. It gets its own icon and opens full screen. No App Store account is needed for this preview.

## Philosophy

One complete app from day one. There is no subscription in this test version, and no essential tool is locked behind an upgrade. The app is built so someone who is not used to computers can use it: big, clear buttons, one main action per screen, plain words, a short skippable walkthrough, a "?" on tricky controls, and advanced options behind "More" rather than removed.

## What this version (0.3.2) does

- **Working:** Take or choose photos, and a basic on-phone clean-up (brighten, contrast, crop to a square, optional plain background — it does not hide damage, and there is no blur or smooth filter). An AI draft (title, description, category, condition, a brand guess, price range, per-site tweaks, and "best price" / "fastest sale" site suggestions) using a key you paste once in Settings. The key stays on the phone only, in localStorage, and is never put in a backup or in this repo. Drafts are split into "Photo shows", "You confirm" (brand, material, size, flaws), and "AI guess" — the app will not invent a brand or condition as fact. You can speak flaws and measurements. A quick check flags missing measurements, an unconfirmed brand, or flaws not noted; you can still continue. You always review and can edit, with Undo, an edit history, and the original photo and text kept. Autosave, and a "Photograph the whole haul" flow that turns several photos into drafts without duplicates. In Settings you pick which sites you sell on (eBay, Poshmark, Mercari, Facebook Marketplace, Etsy, Depop, Vinted, Grailed, Shopify, OfferUp, Craigslist, Whatnot, Kidizen, and thredUP). Inventory lives on the phone (IndexedDB, with a localStorage fallback): Draft, Listed, Sold, Shipped, plus a per-site status (Draft, Pending, Live, Sold, Removed, Failed, Needs a manual step) that you set yourself, with Retry or "I did it". Cost, sale price, marketplace and payment fees, postage, supplies, discounts, returns, money received, and estimated profit. A sold take-down checklist with a countdown, an in-app badge, optional phone notifications (while the app is open), and a prominent "Take them all down automatically" button — today that flags the item Unavailable everywhere, then walks you through each remaining site and ticks it off when you confirm. This cannot promise a double sale is impossible. A "This morning" list (must ship, still live after a sale, needs a decision). Price-drop and "send offers" ideas that will not go below your profit floor. A Buy or pass scanner with a "Buy up to $X" amount and a "You may already own this" warning. Bin location and an in-browser printable QR label; when an item sells, its photo, bin, and a packing checklist. Receipts, mileage, and returns tied to an item. A tax year view with a mileage log (IRS business rate), CSV, and a printable summary — not tax advice. Free export, CSV import with column mapping, and a merge-duplicates helper. "Pause all automation" (today pauses reminders and notifications). A US marketplace compatibility chart with official-API / needs-your-tap / not-available and source links. An always-visible "Ask a question" helper (same device-held key, gpt-4o-mini) that answers how-to and selling questions with the current screen, app version, and a built-in guide, and can offer "Send this as a suggestion". A short, skippable first-run walkthrough. Send a suggestion from every screen. Works offline except for AI checks. There's no subscription in this test version.
- **Estimate:** AI prices, three asking-price options (Sell quickly, Balanced, Hold for more) with estimated money you'd keep after fees and shipping, AI sold-price estimates, Buy or pass verdicts and "Buy up to", per-site fee tables (approximate, dated November 2026), box and weight suggestions, and shipping-cost tables (USPS Ground Advantage, USPS Priority, UPS Ground, approximate). Sold-price search links include eBay's sold and completed listings and other sites' sold filters where they exist, plus sold prices you log yourself (date, condition, confidence). If there is no sold data, the app says "No sold data yet" and does not invent a number.
- **Needs you to post:** Copy-for-site buttons and links that open each site's own selling page. You paste and post yourself, then tick the sites you listed on. Taking a listing down, and changing a price after you approve a drop, is a checklist with open links, not automatic. The guided take-down opens each site for you and waits for "I did it". Some sites will always need your tap.
- **Coming later:** Official one-tap listing and take-down, starting with eBay, Etsy, and Shopify, after an official developer account and the seller's permission, and a computer helper. Automatic checks that a listing is really live or gone. Official eBay sold prices through eBay's API (Needs eBay developer account (free), coming soon) — this version defines the adapter and does not scrape. Buying a real shipping label (needs a shipping service account). Not promised for Poshmark, Mercari, or Facebook Marketplace unless those companies open an official door. "Pause all automation" will cover those automatic steps when they exist.

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

## Deploy

The site is the `app/` folder, served from the `gh-pages` branch (subtree split), same idea as Coach:

```
git subtree split --prefix=app -b gh-pages
git push origin gh-pages --force
gh api -X POST repos/KJNoot/flip-helper/pages/builds
```

## Privacy

Never put real customer data, API keys, or the tester's email in this repo. The AI key is pasted in Settings and stays on the device.
