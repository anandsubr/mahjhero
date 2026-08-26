import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

// @testing-library/react auto-registers cleanup only when it detects a
// Jest-style global afterEach. Vitest does not provide one unless
// test.globals is enabled, which would inject ambient globals across the
// whole suite. Registering it here gets the same guarantee for component
// tests without touching how the lib/ tests run.
afterEach(cleanup);
