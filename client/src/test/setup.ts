import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom does not implement the object-URL APIs used for image previews.
if (typeof URL.createObjectURL !== 'function') {
  URL.createObjectURL = () => 'blob:mock';
  URL.revokeObjectURL = () => undefined;
}

// Unmount and clean up the DOM between tests so they stay isolated.
afterEach(() => {
  cleanup();
});
