/**
 * The single source of truth for business-type (DIRECT / PARTNER) detection.
 *
 * All partner keywords, direct-evidence keywords, configured partner names and
 * the confidence threshold live here — nothing about detection is scattered
 * across the codebase. To teach the detector a new partner (a corporate account,
 * a travel agency, a wholesaler) add a keyword or a configured name below; no
 * other file needs to change. A future milestone may move these into an Admin-
 * managed table, but for now they are configured in code on purpose.
 *
 * Matching is done on diacritic-free, lowercased, whitespace-collapsed text (see
 * `normalizeForPhrase`). Keywords must therefore be written diacritic-free.
 *
 * IMPORTANT: keywords are specific multi-word phrases. The bare word "partner"
 * is deliberately NOT a keyword, because the Booking.com extranet chrome itself
 * reads "Booking.com for Partners" — a normal OTA reservation must never be
 * classified PARTNER merely from that chrome or from the OTA source alone.
 */

export interface DetectionRule {
  /** Stable machine id reported in `matchedRules`. */
  id: string;
  /** Diacritic-free, lowercased phrases; any one matching fires the rule. */
  keywords: readonly string[];
  /** 0–100 confidence contributed when the rule matches. */
  weight: number;
}

/** Explicit partner / B2B / agency / corporate / wholesaler evidence. */
export const PARTNER_RULES: readonly DetectionRule[] = [
  {
    id: 'partner-rate',
    keywords: ['partner rate', 'partner reservation', 'partner booking', 'channel partner', 'gia doi tac', 'dat doi tac', 'don doi tac'],
    weight: 100,
  },
  {
    id: 'corporate',
    keywords: ['corporate booking', 'corporate rate', 'corporate account', 'company booking', 'cong ty dat phong', 'doan cong ty'],
    weight: 95,
  },
  {
    id: 'travel-agent',
    keywords: ['travel agent', 'travel agency', 'tour operator', 'dai ly du lich', 'cong ty du lich', 'cong ty lu hanh'],
    weight: 95,
  },
  {
    id: 'wholesaler',
    keywords: ['wholesaler', 'wholesale rate', 'wholesale booking'],
    weight: 95,
  },
  {
    id: 'b2b-affiliate',
    keywords: ['b2b', 'affiliate booking', 'affiliate rate', 'agency booking', 'reservation agency'],
    weight: 92,
  },
];

/** Explicit ordinary / retail evidence that makes a booking DIRECT. */
export const DIRECT_RULES: readonly DetectionRule[] = [
  {
    id: 'direct-booking',
    keywords: ['direct booking', 'dat truc tiep', 'booking truc tiep', 'khach le', 'khach truc tiep', 'walk in', 'walk-in'],
    weight: 100,
  },
  {
    id: 'retail-rate',
    keywords: [
      'best available rate',
      'flexible rate',
      'fully flexible',
      'standard rate',
      'domestic rate',
      'genius',
      'mobile rate',
      'non-refundable',
      'nonrefundable',
      'non refundable',
    ],
    weight: 90,
  },
];

/**
 * Configured partner company names / aliases (diacritic-free, lowercased). When
 * any appears in the booking text the booking is treated as a partner booking.
 * Extend this list as partners are learned — this is the one place to add them.
 */
export const CONFIGURED_PARTNER_NAMES: readonly string[] = [
  // e.g. 'acme travel', 'saigon tourist'
];

/** At/above this confidence the type is classified automatically; below it → UNKNOWN. */
export const BUSINESS_TYPE_CONFIDENCE_THRESHOLD = 90;
