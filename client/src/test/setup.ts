import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Unmount and clean up the DOM between tests so they stay isolated.
afterEach(() => {
  cleanup();
});
