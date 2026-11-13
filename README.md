# Flip Helper

An iPhone-first web app (PWA) that helps a reseller draft a listing from a photo, post it on more than one site, and keep track from listed to sold to shipped.

Working name — easy to rename later.

**Live preview:** https://kjnoot.github.io/flip-helper/

On an iPhone: open that address in Safari, tap the Share button, then **Add to Home Screen**. It gets its own icon and opens full screen. No App Store account is needed for this preview.

## What this version (0.1.0) does

- **Working:** Take or choose photos. An AI draft (title, description, category, condition, brand guess, price range, per-site tweaks, and "best price" / "fastest sale" site suggestions) using a key you paste once in Settings. Price and site advice are clearly labeled as AI estimates, not checked against real sold listings. The key stays on the phone only, in localStorage, and is never put in a backup or in this repo. You always review and can edit. In Settings you pick which sites you sell on (eBay, Poshmark, Mercari, Facebook Marketplace, Etsy, Depop, Vinted, Grailed, Shopify, OfferUp, Craigslist, Whatnot, Kidizen, and thredUP). Inventory lives on the phone (IndexedDB, with a localStorage fallback): Draft, Listed, Sold, Shipped. Cost, sale price, fees, and profit. A sold checklist reminds you to take the item down on the other sites. Simple monthly totals. Export a backup or delete everything. Send a suggestion from every screen. Works offline except for the AI draft.
- **Needs you to post:** Copy-for-site buttons and links that open each site's own selling page. You paste and post yourself, then tick the sites you listed on. Taking a listing down is a checklist with open links, not automatic.
- **Coming later:** Official one-tap listing and take-down, starting with eBay, after an official developer account and the seller's permission. Not promised for Poshmark, Mercari, or Facebook Marketplace unless those companies open an official door.

**Prices from the AI are estimates.** They are not checked against real sold listings. Sold-price search links are there so you can check.

This app will not ask for a selling-site password, and it does not log into eBay, Poshmark, Mercari, Facebook Marketplace, Etsy, or Depop.

## Develop

```
npm test          # unit tests, then a headless phone-sized smoke test
npm run test:unit
npm run serve     # http://127.0.0.1:8080/
```

The smoke test uses Google Chrome (`/usr/bin/google-chrome`) through Playwright, in `test/`.

## Full version (later)

See [ROADMAP.md](ROADMAP.md) for the legal path to official auto-list and auto-delist (eBay, Etsy, Shopify first; Depop and Vinted by application) and a desktop companion for sites with no API, only on her approval, respecting each site's terms. Poshmark's rules against unauthorized automation are called out there on purpose.

## Deploy

The site is the `app/` folder, served from the `gh-pages` branch (subtree split), same idea as Coach:

```
git subtree split --prefix=app -b gh-pages
git push origin gh-pages --force
gh api -X POST repos/KJNoot/flip-helper/pages/builds
```

## Privacy

Never put real customer data, API keys, or the tester's email in this repo. The AI key is pasted in Settings and stays on the device.
