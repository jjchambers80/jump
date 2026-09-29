// @jump/theme validator, catalog and migration (spec 038). The same cases
// run under Vitest in frontend/tests/unit/themePackage.test.ts.
import { describe, expect, it } from '@jest/globals';
import { runThemeCases } from '../../../packages/theme/test/run-cases.js';

runThemeCases({ describe, it, expect });
