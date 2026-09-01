# Acceptance corpus (fixture)

This directory is declared in `.mavci/project.json` under `checks.fixtures`, which
is the good case for `config.fixture_scope`: a plain repo-relative subdirectory
that overlaps no source root.

It deliberately holds NO code file. `config.fixture_scope` emits a `warning` naming
how many code files a declared root is exempting, and `check-fixtures.mjs` requires
a `good/` fixture to produce no findings at all — warnings included. Putting a
`.ts` file here would fire that warning and make this fixture fail for the right
reason at the wrong time.

The exemption's positive behaviour — a violating file under a declared root
producing no blocker — is asserted where it belongs, in the `good/` fixtures of
`next.no_service_role_client` and `next.env_centralised`, each with a
`MANIFEST_PATCH` declaring this root.
