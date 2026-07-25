/**
 * Shared constants for the developer test tools. These tools are DEVELOPMENT
 * ONLY — every entry point is gated by `devToolsEnabled` (the explicit
 * ENABLE_DEV_TEST_TOOLS flag AND a non-production environment).
 */

/** The single dedicated test-receptionist account (may switch branches in dev). */
export const TEST_RECEPTIONIST_USERNAME = 'reception_test';
export const TEST_RECEPTIONIST_FULLNAME = 'Lễ tân Test 8 Chi Nhánh';
/** A fixed, clearly non-secret dev password (documented; dev-only account). */
export const TEST_RECEPTIONIST_PASSWORD = 'ReceptionTest1';

/** Safe upper bounds for a single demo-generation request. */
export const MAX_BOOKINGS_PER_BRANCH = 100;
export const MAX_ISSUES_PER_BRANCH = 50;

/** The exact phrase the client must send to confirm a demo wipe. */
export const CLEAR_DEMO_PHRASE = 'XOA DU LIEU DEMO';

/** The exact phrase required by the official-launch reset (CLI). */
export const OFFICIAL_RESET_PHRASE = 'PREPARE KAS FOR OFFICIAL USE';
