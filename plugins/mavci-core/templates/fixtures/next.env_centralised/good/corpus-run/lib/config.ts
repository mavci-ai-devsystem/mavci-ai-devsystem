// FIXTURE, declared under `checks.fixtures` in the manifest patch for this rule.
//
// A scattered `process.env` read is a real blocker everywhere else. Inside a
// declared acceptance corpus it is the defect the fixture carries on purpose, so
// `next.env_centralised` must not fire on it.
//
// Fails against 0.1.15: without `isDeclaredFixture` this produces a blocker and
// check-fixtures.mjs reports "fired on its good/ fixture".
export const corpusScope = process.env.CORPUS_SCOPE ?? "unset";
