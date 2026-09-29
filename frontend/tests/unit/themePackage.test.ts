// @jump/theme parity: same cases as backend/tests/unit/themePackage.test.js.
import { describe, expect, it } from 'vitest';
import { runThemeCases } from '../../../packages/theme/test/run-cases.js';

runThemeCases({ describe, it, expect });
