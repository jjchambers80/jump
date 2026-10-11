// Spec 050 §5.1: setupStep keys are validated against EVENT_SETUP_STEPS, and
// the frontend registry (components/event-setup/steps.ts) must use the same
// keys. Both suites assert the shared fixture, so neither list can drift.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { EVENT_SETUP_STEPS } from '../../src/api/validators/eventValidators.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, '../fixtures/eventSetupSteps.fixtures.json'), 'utf8'));

test('EVENT_SETUP_STEPS matches the shared wizard step fixture', () => {
  expect(EVENT_SETUP_STEPS).toEqual(fixture.keys);
});
