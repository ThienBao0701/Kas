import { normalizeForPhrase } from './text';
import {
  BUSINESS_TYPE_CONFIDENCE_THRESHOLD,
  CONFIGURED_PARTNER_NAMES,
  DIRECT_RULES,
  PARTNER_RULES,
  type DetectionRule,
} from './partnerDetectionRules';

export type BusinessType = 'DIRECT' | 'PARTNER' | 'UNKNOWN';

export interface BusinessTypeResult {
  type: BusinessType;
  /** 0–100, always tied to matched evidence (0 when nothing matched). */
  confidence: number;
  /** The rule ids that matched (for the Admin audit / preview). */
  matchedRules: string[];
  /** True when the Admin must confirm (UNKNOWN, i.e. no confident evidence). */
  requiresAdminConfirmation: boolean;
  /** A short machine tag recording how the type was decided, for audit. */
  detectionSource: string;
}

export interface BusinessTypeInput {
  rawText: string;
  roomType?: string | null;
  specialRequest?: string | null;
}

/** The configured partner names, as a single rule (highest weight). */
function configuredNameRule(): DetectionRule {
  return { id: 'configured-partner-name', keywords: CONFIGURED_PARTNER_NAMES, weight: 100 };
}

interface RuleMatch {
  rule: DetectionRule;
  weight: number;
}

/** Rules that matched the text, strongest first. */
function matchRules(rules: readonly DetectionRule[], flat: string): RuleMatch[] {
  const hits: RuleMatch[] = [];
  for (const rule of rules) {
    if (rule.keywords.some((kw) => kw.length > 0 && flat.includes(kw))) {
      hits.push({ rule, weight: rule.weight });
    }
  }
  return hits.sort((a, b) => b.weight - a.weight);
}

function bestWeight(matches: RuleMatch[]): number {
  return matches.length > 0 ? matches[0]!.weight : 0;
}

/**
 * Deterministically classifies a booking's business type from its text.
 *
 * Rules:
 *  - It never inspects the phone number, never guesses and never uses the OTA
 *    source (Booking.com / Agoda) as evidence — only explicit keyword/name
 *    evidence counts.
 *  - PARTNER when explicit partner evidence scores ≥ the threshold (and at least
 *    as strong as any direct evidence).
 *  - DIRECT when explicit ordinary/retail evidence scores ≥ the threshold and is
 *    stronger than any partner evidence.
 *  - UNKNOWN otherwise (the Admin confirms). Its confidence is the best matched
 *    weight (below the threshold), or 0 when nothing matched.
 */
export function detectBusinessType(input: BusinessTypeInput): BusinessTypeResult {
  const flat = normalizeForPhrase(
    [input.rawText, input.roomType ?? '', input.specialRequest ?? ''].join(' \n '),
  );

  const partnerMatches = matchRules([configuredNameRule(), ...PARTNER_RULES], flat);
  const directMatches = matchRules(DIRECT_RULES, flat);
  const partnerConf = bestWeight(partnerMatches);
  const directConf = bestWeight(directMatches);

  if (partnerConf >= BUSINESS_TYPE_CONFIDENCE_THRESHOLD && partnerConf >= directConf) {
    return {
      type: 'PARTNER',
      confidence: partnerConf,
      matchedRules: partnerMatches.map((m) => m.rule.id),
      requiresAdminConfirmation: false,
      detectionSource: `auto:${partnerMatches[0]!.rule.id}`,
    };
  }
  if (directConf >= BUSINESS_TYPE_CONFIDENCE_THRESHOLD && directConf > partnerConf) {
    return {
      type: 'DIRECT',
      confidence: directConf,
      matchedRules: directMatches.map((m) => m.rule.id),
      requiresAdminConfirmation: false,
      detectionSource: `auto:${directMatches[0]!.rule.id}`,
    };
  }

  return {
    type: 'UNKNOWN',
    confidence: Math.max(partnerConf, directConf),
    matchedRules: [...partnerMatches, ...directMatches].map((m) => m.rule.id),
    requiresAdminConfirmation: true,
    detectionSource: 'auto:unknown',
  };
}
