// Mistake catcher: flag easy-to-miss gaps before she saves or posts.
// These are warnings, not hard blocks. She can confirm "no brand",
// "no size", or "no flaws" and move on.
import { guessFor } from "./honesty.js";

export const MISTAKE_NOTE = "A quick check before you save or copy a listing. You can still continue. Nothing is posted on its own.";

/**
 * Issues worth a look. Each has an id she can dismiss by confirming
 * the "no X" flag, or by filling in the missing value.
 */
export function catchMistakes(item) {
  const issues = [];
  if (!item) return issues;

  const size = String(item.size || "").trim();
  const measurements = String(item.measurements || "").trim();
  const packed = item.packedLengthIn || item.packedWidthIn || item.packedHeightIn;
  if (!size && !measurements && !packed && !item.noSize) {
    issues.push({
      id: "size",
      field: "size",
      severity: "warn",
      title: "Size or measurements are missing",
      detail: "Buyers often need a size or a measurement. Add one, or mark that this item doesn't have one."
    });
  }

  const confirm = item.youConfirm || {};
  const brandValue = String(item.brand || "").trim();
  const brandGuess = guessFor(item, "brand") || (item.aiGuess && item.aiGuess.brand) || "";
  const brandConfirmed = !!(confirm.brand && confirm.brand.confirmed);
  if (!item.noBrand) {
    if (brandGuess && !brandConfirmed && !brandValue) {
      issues.push({
        id: "brand",
        field: "brand",
        severity: "warn",
        title: "The brand is an AI guess and isn't confirmed",
        detail: "Check the brand against the photo or a tag, then tick “I confirm the brand”, or mark that there is no brand."
      });
    } else if (brandGuess && !brandConfirmed && brandValue && brandValue === brandGuess) {
      issues.push({
        id: "brand",
        field: "brand",
        severity: "warn",
        title: "The brand is an AI guess and isn't confirmed",
        detail: "Check the brand against the photo or a tag, then tick “I confirm the brand”, or clear it if you're not sure."
      });
    } else if (!brandValue && !brandGuess && looksLikeBrandedCategory(item)) {
      issues.push({
        id: "brand",
        field: "brand",
        severity: "info",
        title: "No brand is listed",
        detail: "If you can see a brand, add it. If there isn't one, mark “No brand”."
      });
    }
  }

  const flawsValue = (confirm.flaws && confirm.flaws.value) || (item.photoShows && item.photoShows.visibleFlaws) || "";
  const flawsConfirmed = !!(confirm.flaws && confirm.flaws.confirmed) || item.flawsNoted;
  const notesFlaws = /flaw|stain|chip|crack|tear|hole|wear|damage|scratch|pilling|faded|ripped|missing/i.test(String(item.notes || "") + " " + String(item.description || ""));
  if (!item.noFlaws && !flawsConfirmed && !notesFlaws && !String(flawsValue).trim()) {
    issues.push({
      id: "flaws",
      field: "flaws",
      severity: "warn",
      title: "Flaws aren't noted",
      detail: "Take a moment to look for damage and write it down, or mark “No flaws that I can see”."
    });
  }

  if (item.photoShows && item.photoShows.visibleFlaws && !item.noFlaws && !flawsConfirmed && !notesFlaws) {
    // If we already pushed flaws-not-noted, skip. If the photo shows flaws
    // but she hasn't acknowledged them, that's a stronger warning.
    if (!issues.some(i => i.id === "flaws")) {
      issues.push({
        id: "flaws",
        field: "flaws",
        severity: "warn",
        title: "The photo may show damage that isn't in the listing",
        detail: "The AI noted: “" + String(item.photoShows.visibleFlaws).trim() + "”. Add it to the description if it's real, and check that a clean-up didn't hide it."
      });
    }
  }

  if (!String(item.title || "").trim()) {
    issues.push({
      id: "title",
      field: "title",
      severity: "warn",
      title: "This item has no title",
      detail: "Add a short title before you copy it to a selling site."
    });
  }

  return issues;
}

function looksLikeBrandedCategory(item) {
  const text = [item.category, item.title].filter(Boolean).join(" ").toLowerCase();
  return /shoe|sneaker|boot|bag|purse|watch|jacket|coat|jean|dress|phone|camera|console|electronics|apparel|clothing|handbag/.test(text);
}

export function dismissMistake(item, id, at = Date.now()) {
  const next = { ...item, updatedAt: at };
  if (id === "brand") next.noBrand = true;
  if (id === "size") next.noSize = true;
  if (id === "flaws") { next.noFlaws = true; next.flawsNoted = true; }
  return next;
}

export function hasBlockingMistakes(issues) {
  // Nothing is a hard block. All are warnings she can continue past.
  return false;
}

export function mistakeSummary(issues) {
  if (!issues || !issues.length) return "";
  if (issues.length === 1) return issues[0].title;
  return `${issues.length} things to check before you post.`;
}
