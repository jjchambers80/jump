// Where focus goes after the next step change (spec 050 §11.4). Normally the
// step's h1. Two cases need more: an error-summary link to a field on another
// step focuses that field, and the create remounts the wizard on its new
// route, which must still focus the h1 and announce the step. Module scope,
// so it survives that remount; read once.

let target: { field?: string } | null = null;

export function focusAfterStepChange(next: { field?: string } = {}) {
  target = next;
}

export function takeStepFocus() {
  const value = target;
  target = null;
  return value;
}
