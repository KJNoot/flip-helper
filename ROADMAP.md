# Flip Helper — roadmap to the full version

This is the plan for later, after the tester has used v0.1. Nothing here is built yet, and nothing is promised for a date. The goal is the same one Ken described: she takes a photo, approves a draft, and the item is listed on her sites; when it sells on one, it comes down on the others. That has to be done in a way that is legal, official where official doors exist, and honest where they do not.

v0.1 (this release) is the iPhone helper: photo, AI draft, her approval, a tracker, a sold checklist, and a suggestion box. Posting and taking listings down are things she does herself. That is on purpose.

## The gold standard, said plainly

Long term, two kinds of help:

1. **Official connections**, where the selling site has a real public (or partner) program. She signs in on that site's own "allow this app" screen. Flip Helper can then list and take down on her behalf, with her permission, and it can work with the computer off.
2. **A desktop companion** on a computer she leaves running, for sites that have no official door. It would run in her own browser, where she is already signed in. It would only act after she clearly approves the action. It would not ask for her selling-site passwords, and it would not try to sneak around a site's rules.

The phone app stays the place she takes photos, reviews drafts, and sees what is listed, sold, or still up. The computer does the clicking only where that is allowed and only with her OK.

## What each site actually allows

Checked against official docs and the research of November 12, 2026. This is general information, not legal advice. Each site's own terms decide, and those terms can change.

| Site | Official way to list and take down? | Path we should take | Do not do |
| --- | --- | --- | --- |
| **eBay** | Yes. Sell APIs (Listing, Inventory, or Trading) can create a listing and end one (EndItem or withdrawOffer). Public developer program at developer.ebay.com. A production app may need eBay's approval. | First official path. Ken sets up an eBay developer account. She signs in with eBay and gives permission. | Do not scrape eBay or use a hidden login. |
| **Etsy** | Yes. Open API v3 can create a draft listing and delete a listing. An app other sellers use needs Commercial Access, which Etsy reviews. | Second official path, after Etsy grants access for her (or for a public app). | Do not automate her Etsy login. |
| **Shopify** | Yes. Official Admin API, with the shop owner's permission. Shopify Partner program. | Only if she has a Shopify shop. Real and official. | — |
| **Depop** | A Selling API exists, but it is partner-only. Approval is not guaranteed. | Apply through Depop if she actually sells there and wants this. Wait for a yes. | Do not build a Depop bot while we wait. |
| **Vinted** | A Pro Integrations API exists for allowlisted Vinted Pro businesses. | Only realistic if she qualifies and Vinted allowlists the app. Apply if it fits. | Not a door for a typical individual helper app today. |
| **Facebook Marketplace** | No public listing API. Meta's Marketplace Item API is only for approved Marketplace partners. | She posts in the Facebook app. Revisit only if Meta opens a real official door we can apply for. | Do not scrape Facebook or automate a Facebook login. Against their terms. |
| **Poshmark** | No public official API found. Poshmark's Community Guidelines (the "Be Real" section) say they do not allow Poshers to use unauthorized programs or other forms of automation, including deleting and reposting, liking, sharing, following and unfollowing. Violations can mean removed listings or a restricted account. | **Do not build unauthorized automation for Poshmark.** The legal paths are: (1) a real official partner or API program, if Poshmark ever offers one and approves us; (2) **user-initiated actions** — she taps, and the Poshmark app or website does the work, which is what v0.1 already does with copy-and-open. A desktop clicker that posts or deletes in her Poshmark closet without that official door is the kind of tool their rules forbid, even if she said yes and the computer is hers. Losing the closet is worse than a late listing. | No Poshmark bot, extension clicker, or "share" automator. |
| **Mercari (US)** | No public official seller API found for the US marketplace. (Japan has a separate Mercari Shops API — a different product.) Major tools use a browser extension, not a "Sign in with Mercari" screen. | Same honest stance as Facebook: she posts herself unless Mercari opens an official door. If we ever add a desktop companion for Mercari, review their current terms first, and only act on her approval. | Do not assume an extension is allowed just because competitors do it. |
| **Grailed, Whatnot, OfferUp** | No public official third-party listing API found. Tools that support them typically use a Chrome extension. | Desktop companion only after a terms review, and only with her approval for each action. | No password collection, no hidden clicker. |
| **Craigslist** | No official listing API. Their terms have long restricted automated posting. Posting is also city-specific. | User-initiated only (open the post page). A bot here is high risk. Treat as "she posts herself" unless Craigslist offers an official program. | Do not auto-post to Craigslist. |
| **Kidizen** | No public official listing API found. | Copy-and-open unless they offer a program. | — |
| **thredUP** | Different model: she sends a bag, they list the items. Not a usual copy-and-post site. | A link to their clean-out sign-up is enough. Do not pretend we can post to thredUP the usual way. | — |

## The desktop companion (later, and only where it is allowed)

Ken's note: she is willing to leave a computer running. That solves a real complaint about other tools (auto-delist waiting for a laptop to wake), **but only for sites where a companion is allowed**.

Rules for that companion, if we build it:

- It runs on **her** computer, in **her** already-signed-in browser. Flip Helper never asks for a Poshmark, Mercari, or Facebook password.
- It **only acts after her approval**. A listing is not posted, and a listing is not taken down, until she confirms that one action (or a clearly listed batch she reviews). It is not a silent always-on clicker.
- **Each site's terms are reviewed before that site is turned on** in the companion. If the rules forbid unauthorized automation — Poshmark's guidelines say this today — that site is not included, and the phone app keeps the honest checklist instead.
- User-initiated actions (she taps "Open Poshmark" and posts herself) are always fine.
- Partner programs and official "Sign in and allow" screens are the first choice, always, when they exist.
- We stay legal, not sneaky. If a competitor uses an extension in a gray area, that is not our model.

## Order of work

1. **v0.1, in testers' hands (this release).** iPhone web app. Photo, AI draft, price and site advice (clearly labeled estimates), her approval, inventory, sold checklist, suggestion box. She picks which sites she sells on. We learn from her suggestions which sites she actually uses and what is missing.
2. **Official eBay connection.** Ken's eBay developer account, her "Sign in with eBay" permission, then real list and take-down for eBay, labeled Working. Other sites stay "Needs you to post."
3. **Official Etsy**, if Etsy grants Commercial Access (or a personal shop connection if that is all she needs). Same honest labeling.
4. **Official Shopify**, only if she has a Shopify shop.
5. **Apply, do not assume:** Depop partner API and Vinted Pro Integrations, if she sells on those and wants automatic help. Build only after a yes.
6. **Desktop companion, site by site, terms first.** Start with a site that does not forbid this and that she actually uses. Approval required for every post and every take-down. Skip Poshmark unless and until an official program exists. Skip Craigslist automation. Facebook only if Meta offers a real official door.
7. **Polish from her suggestions.** Shipping labels, better comps (real sold prices, if we can get them from an official source such as eBay's APIs), and Android / App Store packaging, as she and Ken ask for them.

At every step, features stay labeled **Working**, **Needs you to post**, or **Coming later**. We do not claim automatic take-down on a site we cannot legally and reliably reach.

## What we will not do

- Ask for her selling-site passwords.
- Build a hidden clicker, on a phone or a computer, that uses those accounts without an official door and without her approval.
- Automate Poshmark in a way their Community Guidelines forbid.
- Pretend a computer-off auto-delist works on every site.
- Put real customer data, API keys, or her email in the public repo.
