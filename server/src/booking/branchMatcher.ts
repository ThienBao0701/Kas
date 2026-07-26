import { normalizeText } from './text';
import type {
  BranchAliasConfig,
  BranchResolution,
  BranchAliasSourceKey,
  MatchableBranch,
} from './types';

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
 *
 * Since Milestone C.3.7 these two tables are the **legacy defaults**, not the
 * operational configuration: `npm run db:seed` backfills them into
 * `BranchSourceAlias` (keyed by stable branch code) and the Admin manages names
 * from the UI afterwards. They remain the fallback for pure fixtures and for a
 * branch that has no alias row at all, so nothing changes before the backfill.
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
 * Branch codes that have in-code default names (the eight originally seeded
 * branches). Only these may fall back to the legacy tables when no alias row
 * exists yet — a branch the Admin adds later routes strictly by the aliases the
 * Admin configured, so its internal name can never fuzzy-steal a booking.
 */
const LEGACY_BRANCH_CODES: ReadonlySet<string> = new Set<string>([
  ...Object.keys(BRANCH_ALIASES),
  ...AGODA_HOTEL_NAMES.map((h) => h.branchCode).filter((c): c is string => c !== null),
]);

export function hasLegacyDefaults(branchCode: string): boolean {
  return LEGACY_BRANCH_CODES.has(branchCode);
}

/**
 * The platform names configured for a branch on one source.
 *
 * When the branch carries Admin-configured `aliases` (the database-backed
 * configuration) those are authoritative. Otherwise the legacy in-code tables
 * above are used, so pure fixtures — and any branch whose aliases have not been
 * backfilled yet — keep resolving exactly as before.
 */
export function aliasesFor(
  branch: MatchableBranch,
  source: BranchAliasSourceKey,
): readonly BranchAliasConfig[] {
  if (branch.aliases) return branch.aliases.filter((a) => a.source === source);
  if (source === 'AGODA') {
    return AGODA_HOTEL_NAMES.filter((h) => h.branchCode === branch.code).map((h) => ({
      source: 'AGODA' as const,
      alias: h.name,
      matchMode: 'EXACT' as const,
    }));
  }
  if (source !== 'BOOKING_COM') return [];
  return [
    { source: 'BOOKING_COM', alias: branch.hotelName, matchMode: 'SIMILARITY' },
    ...(BRANCH_ALIASES[branch.code] ?? []).map((alias) => ({
      source: 'BOOKING_COM' as const,
      alias,
      matchMode: 'SIMILARITY' as const,
    })),
  ];
}

/** A branch only takes part in automatic routing while it is active. */
function routable(branch: MatchableBranch): boolean {
  return branch.active !== false;
}

/**
 * Resolves an Agoda public hotel name to a configured branch, or null when the
 * name is unknown/incomplete or its pairing still needs operator confirmation.
 * Normalisation is limited to case, accents and whitespace — no meaningful word
 * (Passion, Elegance, Ancient, Milestone, Zody, Sonata, Eliana, Dilly, Boutique,
 * Luxury, Premium) is ever dropped. Matching is EXACT for every Agoda alias,
 * whether it comes from the database or from the legacy table.
 */
export function resolveAgodaBranch(
  hotelName: string | null | undefined,
  branches: readonly MatchableBranch[],
): MatchableBranch | null {
  if (!hotelName) return null;
  const key = normalizeText(hotelName);
  if (key.length === 0) return null;
  for (const branch of branches) {
    if (!routable(branch)) continue;
    const hit = aliasesFor(branch, 'AGODA').some((a) => normalizeText(a.alias) === key);
    if (hit) return branch;
  }
  return null;
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

/**
 * Score of one candidate against one configured alias. An EXACT alias only ever
 * scores 1 (a normalised equality) or 0 — it never contributes a fuzzy score —
 * so an Agoda-style name can never be similarity-matched by accident.
 */
function scoreAlias(candidate: string, alias: BranchAliasConfig): number {
  if (alias.matchMode === 'EXACT') {
    return normalizeText(candidate) === normalizeText(alias.alias) ? 1 : 0;
  }
  return scoreAgainst(candidate, alias.alias);
}

/**
 * Best similarity of a candidate to a branch's Booking.com names. An exact alias
 * always wins (score 1); similarity aliases fill in the truncations Booking.com
 * produces. An inactive branch scores 0, so it is never routed to automatically.
 */
export function scoreHotel(candidate: string, branch: MatchableBranch): number {
  if (!routable(branch)) return 0;
  let best = 0;
  for (const alias of aliasesFor(branch, 'BOOKING_COM')) {
    best = Math.max(best, scoreAlias(candidate, alias));
  }
  return best;
}

/** Best branch for a single candidate string. Inactive branches are skipped. */
export function matchBranch(
  candidate: string,
  branches: readonly MatchableBranch[],
): BranchMatch | null {
  let best: BranchMatch | null = null;
  for (const branch of branches) {
    if (!routable(branch)) continue;
    const score = scoreHotel(candidate, branch);
    if (!best || score > best.score) {
      best = { branch, score };
    }
  }
  return best;
}

/**
 * The full resolution answer for one hotel name on one source: which branch (id,
 * stable code, stored address), which configured alias won, how confident, and
 * why. This is the shape §8 of the branch-management spec asks a resolver to
 * return; parsers keep using {@link matchBranch}/{@link resolveAgodaBranch},
 * whose behaviour is unchanged.
 *
 * Safety rules encoded here:
 *  - Agoda resolves by EXACT alias only; an unknown name stays unresolved.
 *  - Booking.com prefers an exact alias, then similarity above the suggest
 *    threshold.
 *  - A tie between two different branches is AMBIGUOUS and resolves to nothing,
 *    so a wrong-branch dispatch is never guessed.
 *  - An unknown name never falls back to the first/default branch.
 */
export function resolveBranchForSource(
  candidate: string | null | undefined,
  source: BranchAliasSourceKey,
  branches: readonly MatchableBranch[],
): BranchResolution {
  const unresolved = (reason: BranchResolution['reason']): BranchResolution => ({
    branch: null,
    branchId: null,
    branchCode: null,
    address: null,
    sourceAlias: null,
    confidence: 0,
    reason,
  });

  if (!candidate || normalizeText(candidate).length === 0) return unresolved('NO_INPUT');

  let best: { branch: MatchableBranch; alias: BranchAliasConfig; score: number } | null = null;
  let tied = false;
  for (const branch of branches) {
    if (!routable(branch)) continue;
    for (const alias of aliasesFor(branch, source)) {
      const score = scoreAlias(candidate, alias);
      if (score <= 0) continue;
      if (!best || score > best.score) {
        best = { branch, alias, score };
        tied = false;
      } else if (score === best.score && branch.code !== best.branch.code) {
        tied = true;
      }
    }
  }

  if (!best) return unresolved('UNKNOWN');
  if (tied) return unresolved('AMBIGUOUS');
  if (best.score < BRANCH_MATCH_THRESHOLD) return unresolved('UNKNOWN');

  return {
    branch: best.branch,
    branchId: best.branch.id,
    branchCode: best.branch.code,
    address: best.branch.address,
    sourceAlias: best.alias.alias,
    confidence: Math.round(best.score * 100),
    reason: best.score === 1 ? 'EXACT_ALIAS' : 'SIMILARITY',
  };
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
  const routableBranches = branches.filter(routable);
  let best: BranchMatch | null = null;
  let bestLine: string | null = null;
  for (const line of lines) {
    const match = matchBranch(line, routableBranches);
    if (match && (!best || match.score > best.score)) {
      best = match;
      bestLine = line;
    }
  }
  return { match: best, line: bestLine };
}
