import { normalizeText } from './text';
import type { MatchableBranch } from './types';

export interface BranchMatch {
  branch: MatchableBranch;
  score: number;
}

/** Minimum score to *suggest* a branch; below this the hotel is "unknown". */
export const BRANCH_MATCH_THRESHOLD = 0.6;
/**
 * Minimum score to *auto-assign* a branch without the admin confirming. Between
 * this and the suggest threshold the branch is offered as a candidate only and
 * requires manual confirmation.
 */
export const BRANCH_CONFIDENT_THRESHOLD = 0.85;

/**
 * Extra strings that should map to a branch on top of its seeded hotel name.
 * Booking.com truncates and drops accents inconsistently ("Ben Than" vs the full
 * "Ben Thanh"), so a few conservative aliases keep confident matches confident.
 *
 * This is also where a branch's **current** Booking.com public name lives when it
 * differs from the seeded `hotelName`. A property can be listed under different
 * public names on different platforms, and it can be renamed over time — every
 * name simply resolves to the same stable branch code. Earlier names are kept as
 * backward-compatible aliases so historical emails still parse; each alias must
 * resolve to exactly one branch (asserted in the branch-matcher tests).
 *
 * Agoda's public "KAS …" property names live in {@link AGODA_HOTEL_NAMES} below —
 * the same module, branch config and normalisation, but resolved by EXACT name
 * rather than similarity (see the note there).
 */
export const BRANCH_ALIASES: Record<string, readonly string[]> = {
  TRUONG_DINH_05: ['Saigon Hotel Ben Thanh', 'Saigon Ben Thanh Hotel'],
  LY_TU_TRONG_260: [
    // Current Booking.com public name (operator-confirmed).
    'Bamboo Water Hotel',
    // Earlier public names, retained so historical emails still resolve.
    'Luxury Elegance Hotel Ben Thanh',
    'Luxury Elegance Ben Thanh',
  ],
  NGUYEN_THAI_BINH_170: [
    // Current Booking.com public name (operator-confirmed).
    'Kaliee Nata Hotel',
  ],
  LE_THANH_TON_278: ['Boutique Zody Hotel Ben Thanh'],
  BUI_THI_XUAN_40: ['Ben Thanh Market Luxury Hotel', 'Ben Thanh Market Luxury'],
};

/**
 * The eight Agoda public property names → the existing stable branch codes.
 * All eight pairings are operator-confirmed; the codes come from the branch seed.
 *
 * These are resolved by an **exact** (case/whitespace/accent-normalised) lookup,
 * never by similarity scoring. Every KAS name shares the tokens "KAS" and "Hotel",
 * so fuzzy matching would rate different properties alike (e.g. *KAS Passion
 * Boutique Hotel* vs *KAS Zody Boutique Hotel*) and could silently dispatch a
 * booking to the wrong branch. Exact matching is also what keeps incomplete names
 * such as "KAS Passion Hotel", "Milestone Premium" or "KAS Luxury Hotel"
 * unresolved rather than guessed.
 *
 * A `branchCode: null` entry would mean the pairing is not established: such a
 * name is never assigned to a default branch — the Admin picks it manually until
 * the operator confirms the mapping here.
 */
export const AGODA_HOTEL_NAMES: ReadonlyArray<{ name: string; branchCode: string | null }> = [
  { name: 'KAS Passion Boutique Hotel', branchCode: 'TRUONG_DINH_05' },
  { name: 'KAS Elegance Hotel', branchCode: 'LY_TU_TRONG_260' },
  { name: 'KAS Ancient Boutique Hotel', branchCode: 'NGUYEN_TRAI_47A' },
  { name: 'KAS Milestone Premium Hotel', branchCode: 'NGUYEN_THAI_BINH_170' },
  { name: 'KAS Zody Boutique Hotel', branchCode: 'LE_THANH_TON_278' },
  { name: 'KAS Sonata Luxury Hotel', branchCode: 'BUI_THI_XUAN_40' },
  { name: 'KAS Eliana Luxury Hotel', branchCode: 'BUI_THI_XUAN_13' },
  { name: 'KAS Dilly Hotel', branchCode: 'LE_THANH_TON_191' },
];

/**
 * Resolves an Agoda public hotel name to a configured branch, or null when the
 * name is unknown/incomplete or its pairing still needs operator confirmation.
 * Normalisation is limited to case, accents and whitespace — no meaningful word
 * (Passion, Elegance, Ancient, Milestone, Zody, Sonata, Eliana, Dilly, Boutique,
 * Luxury, Premium) is ever dropped.
 */
export function resolveAgodaBranch(
  hotelName: string | null | undefined,
  branches: readonly MatchableBranch[],
): MatchableBranch | null {
  if (!hotelName) return null;
  const key = normalizeText(hotelName);
  if (key.length === 0) return null;
  const entry = AGODA_HOTEL_NAMES.find((h) => normalizeText(h.name) === key);
  if (!entry?.branchCode) return null;
  return branches.find((b) => b.code === entry.branchCode) ?? null;
}

function tokenList(text: string): string[] {
  return normalizeText(text).split(' ').filter(Boolean);
}

/** Two tokens match when equal, or one is a prefix of the other (len >= 3). */
function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 3 || b.length < 3) return false;
  return a.startsWith(b) || b.startsWith(a);
}

function jaccard(candidate: string, target: string): number {
  const setA = tokenList(candidate);
  const setB = tokenList(target);
  if (setA.length === 0 || setB.length === 0) return 0;
  const usedB = new Array<boolean>(setB.length).fill(false);
  let intersection = 0;
  for (const a of setA) {
    for (let j = 0; j < setB.length; j += 1) {
      if (!usedB[j] && tokensMatch(a, setB[j]!)) {
        usedB[j] = true;
        intersection += 1;
        break;
      }
    }
  }
  const union = setA.length + setB.length - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Similarity of a candidate hotel string to a single target name.
 * 1.0 for an exact normalised match, 0.9 when one contains the other, otherwise
 * a prefix-tolerant Jaccard overlap of their word tokens. The prefix tolerance
 * absorbs the truncations Booking.com itself produces ("Ben Than", "Luxur").
 */
function scoreAgainst(candidate: string, target: string): number {
  const a = normalizeText(candidate);
  const b = normalizeText(target);
  if (a.length === 0 || b.length === 0) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.9;
  return jaccard(candidate, target);
}

/** Best similarity of a candidate to a branch (seeded name plus its aliases). */
export function scoreHotel(candidate: string, branch: MatchableBranch): number {
  let best = scoreAgainst(candidate, branch.hotelName);
  for (const alias of BRANCH_ALIASES[branch.code] ?? []) {
    best = Math.max(best, scoreAgainst(candidate, alias));
  }
  return best;
}

/** Best branch for a single candidate string. */
export function matchBranch(
  candidate: string,
  branches: readonly MatchableBranch[],
): BranchMatch | null {
  let best: BranchMatch | null = null;
  for (const branch of branches) {
    const score = scoreHotel(candidate, branch);
    if (!best || score > best.score) {
      best = { branch, score };
    }
  }
  return best;
}

/**
 * Scans candidate lines and returns the highest-scoring branch match found
 * anywhere, along with the line that produced it (used as the hotel name when no
 * explicit "Khách sạn:" label is present). Prefers a confident match over the
 * first loose line — the first line of pasted Booking.com text is often
 * navigation chrome, not the hotel.
 */
export function findBestBranch(
  lines: readonly string[],
  branches: readonly MatchableBranch[],
): { match: BranchMatch | null; line: string | null } {
  let best: BranchMatch | null = null;
  let bestLine: string | null = null;
  for (const line of lines) {
    const match = matchBranch(line, branches);
    if (match && (!best || match.score > best.score)) {
      best = match;
      bestLine = line;
    }
  }
  return { match: best, line: bestLine };
}
