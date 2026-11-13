// A short built-in guide to every Jessika's Flip Side feature, in plain words.
// Used by the "Ask a question" helper so it can say which button to tap.
// This is not shown as a manual — it's context for the helper.

export const FEATURE_GUIDE = `
Jessika's Flip Side is a pocket app for people who sell used items on more than one site (eBay, Poshmark, Mercari, Facebook Marketplace, Etsy, and others). It runs on an iPhone in Safari, and can be added to the Home Screen. There is no account and no subscription in this test version. The complete app is included; nothing essential is locked.

The main button at the bottom of the phone is a row of tabs: Home, Items, Scan, Add, Settings. At the top right is "Send a suggestion". A floating "Ask a question" button is on every screen. A "Send a suggestion" button is also in the header.

Home: The first screen. The big button is "Add an item". The second is "Buy or pass". The third is "Second look: scan a table". "This morning" lists what must ship, what's still live after a sale, and what needs a decision. If something sold and is still listed elsewhere, a loud card says "Take these down — don't let them sell twice". Tap an item to open it. There is a month summary (listed, sold, profit) and a link to the year tax view.

Add an item: Take or choose photos (Take, Choose). You can tap “Make it look pro” for a studio photo on this phone (the background comes off here, with a white or soft-gray backdrop, a soft shadow, and a square or tall crop). It does not hide damage. A basic clean-up is still there if you want it. Optional: what you paid, and notes. The big button is "Make a draft from the photo" (needs the AI key in Settings). Or tap "Write it myself". Then check the draft and tap "Save this item". "Photograph the whole haul" turns each photo into its own draft. If a similar item is already in your list, you'll see "You may already own this". Drafts are saved automatically if you leave.

A draft is split into "Photo shows" (only what's visible), "You confirm" (tick brand, material, size, flaws), and "AI guess". Brand and condition are not treated as fact until you confirm them. You can speak flaws and measurements — tap "Speak". On iPhone, if Speak isn't available, use the microphone on the keyboard. Before you save or copy, a "Quick check" flags missing size or measurements, an unconfirmed brand, or flaws not noted. You can still continue.

Item page: The item's photos, title, and status. If it sold and is still up on other sites, the main action is taking it down. A big button says "Take them all down automatically". Today that marks the item Unavailable everywhere, then walks you through each remaining site: it opens that site's take-down page, and you tap "I did it" when you're done. Automatic removal comes later for eBay, Etsy, and Shopify through official connections, and through a computer helper. Some sites will always need your tap. This cannot promise that a double sale is impossible. If "Pause all automation" is on in Settings, this guided walk-through is paused.

Each site on an item has a status you set yourself: Draft, Pending, Live, Sold, Removed, Failed, or Needs a manual step, with the last check time and a Retry or "I did it" button. Automatic checks are coming later.

"Post it" is how you list: "Copy for [site]" copies the listing, "Open [site] sell page" opens that site, then tick the site once you've posted. Jessika's Flip Side does not log into selling sites and does not post for you in this version.

Tap "Mark as sold" to record a sale (site, sale price, fees, shipping). You'll get the take-down checklist. Profit is sale minus cost, marketplace fees, payment fees, postage, supplies, discounts, and refunds. Estimated profit and money received are shown separately.

Three pricing options — "Sell quickly", "Balanced", and "Hold for more" — each show the estimated money you'd keep on each site after fees and shipping. These are estimates. Pick one to set your asking price. Price-drop ideas appear when a listing has sat; a drop will not go below your profit floor (set on the item or in Settings).

Sold price check: log sold prices you actually found (price, date, condition, confidence). If none are logged, it says "No sold data yet" — it will not make up a number. AI estimates are labeled estimates. Official eBay sold prices need a free eBay developer account and are coming later.

Bin location and a QR label (printable) help you find the item. When it sells, you see its photo, bin, and a packing checklist. Shipping shows saved box sizes, packed weight and dimensions, an estimate, and you can enter the actual cost to replace the estimate. Buying a real label is coming later.

Receipts (photo), mileage, and returns can be tied to an item. Taxes (from Home or the year view) add income, costs, fees, shipping, supplies, refunds, and mileage, with a CSV and a printable summary. Not tax advice.

You can undo edits. The original photo and text are kept. Clean-up does not blur, smooth, or hide damage.

Buy or pass (Scan tab): at a thrift store, take a photo, enter what they're asking, and tap "Identify and check". You get a Buy / Maybe / Pass guide, and a big "Buy up to $X" after estimated resale minus fees, shipping, and your desired profit (you can edit those assumptions).

Second look: on Home, tap "Second look: scan a table". Record or pick a video (pan slowly across a table or shelf), or take or pick one wide photo with lots of items. The app pulls stills on the phone and looks them over in the background — a line says "Looking… you can keep shopping." When it's done, you get a list of "Worth a closer look" cards: a cropped photo, where it is in plain words ("left side of the table, near the clocks"), a rough resale estimate (labeled Estimate), and what to check (maker's marks, hallmarks like sterling or 925, brand tags, model numbers, condition, completeness). Each card walks you through three short steps: find it (where on the table), check (the what-to-check list), and snap a close photo of just that item and of any mark, tag or label. The big button is "Go check this one" / "Take a picture of just this item". The table-scan price is labeled "First guess from the table: check it up close". Price, Buy up to, and "Help me haggle" are secondary, and best used after a close-up is verified — haggle is allowed before, with a first-guess note, and is recommended once the close-up result is in. After you submit a close-up, the existing single-item pricing runs (the Buy or pass flow itself is not changed), then you come back to the card marked "Checked", with the verified result replacing the first guess. The list shows unchecked items first, with a "2 of 3 checked" counter. Each card also has "Help me haggle" (an opening offer, a fair price, a walk-away number, and three short polite lines, plus a bundle tip if there are a few items), and "Not interested". Each card also has "List it", which opens the existing listing flow with the close-up (or the first table guess, if you haven't checked yet) already filled in. "Coach me in my earbud" is labeled Coming later — it is not built yet. Prices and verdicts are estimates; check them yourself. Past scans are saved on this phone, with the date. Pictures are sent only to the AI service for this look, and are not uploaded anywhere else. Thumbnails stay on the phone. Needs the AI key in Settings, and an internet connection for the look-over. A very long video may be refused, or only the first two minutes used.

Settings: paste the AI key (it stays on the phone only). Pick the sites you sell on. Set the price-drop wait, profit floor, desired profit, mileage rate, and saved boxes. "Pause all automation" pauses reminders and notifications (and will pause automatic listing later). Export a backup (free), restore, import a CSV with column mapping, merge duplicates, export CSV. A support log of failed actions. A "Site limits" chart (US) shows what can be automated, what needs your tap, and what isn't available, with source links. There is no subscription in this test version. "Delete everything" wipes the phone copy. The key is never put in a backup.

Suggestions: "Send a suggestion" opens an email you can review and send. If you ask the helper for a new feature, it can offer "Send this as a suggestion".

Honesty labels: Working (it works), Estimate (a guide, check it), Needs you (you do this step), Coming later (not built yet).

What is not built yet: official one-tap listing and take-down (starting with eBay), official eBay sold prices, a computer helper, buying shipping labels. Poshmark and Mercari rules do not allow unauthorized automation. Jessika's Flip Side will not ask for a selling-site password.
`.trim();

export const ASK_SYSTEM = `You are a friendly helper inside Jessika's Flip Side, a simple iPhone app for resellers. Answer in short, plain words, as if the person is not used to computers. No jargon. Usually 2 to 5 short sentences. If they need to tap something, say the exact button or tab name. Do not invent features that are not in the guide. If something is Coming later, say so honestly. If you are not sure, say so.

If their message is really a request for a new feature or a change, set featureRequest to true and write a short suggestion they could send.

Reply with a single JSON object only, keys:
- answer: your plain answer (string)
- featureRequest: true or false
- suggestion: if featureRequest is true, one short paragraph they could send as a suggestion; otherwise ""
`;
