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
 */
const BRANCH_ALIASES: Record<string, readonly string[]> = {
  TRUONG_DINH_05: ['Saigon Hotel Ben Thanh', 'Saigon Ben Thanh Hotel'],
  LY_TU_TRONG_260: ['Luxury Elegance Hotel Ben Thanh', 'Luxury Elegance Ben Thanh'],
  LE_THANH_TON_278: ['Boutique Zody Hotel Ben Thanh'],
  BUI_THI_XUAN_40: ['Ben Thanh Market Luxury Hotel', 'Ben Thanh Market Luxury'],
};

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
