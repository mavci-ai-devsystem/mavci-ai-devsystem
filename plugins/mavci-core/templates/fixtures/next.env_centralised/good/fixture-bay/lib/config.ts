// FIXTURE, declared under `checks.fixtures` in the manifest patch for this rule.
//
// A scattered `process.env` read is a real blocker everywhere else. Inside a root
// the manifest declares as fixtures it is the defect the fixture carries on
// purpose, so `next.env_centralised` must not fire on it.
//
// The root is `fixture-bay/` and NOT `corpus-run/`: the latter is exempt without
// any declaration, so this pair would pass there even with `checks.fixtures`
// broken. See the note in check-fixtures.mjs.
//
// Fails against 0.1.15: without `isDeclaredFixture` this produces a blocker and
// check-fixtures.mjs reports "fired on its good/ fixture".
export const corpusScope = process.env.CORPUS_SCOPE ?? "unset";
