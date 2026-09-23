# Contributing to Roseboard

Feedback goes to [GitHub Issues](https://github.com/ranKirito/obsidian-roseboard/issues/new/choose). The supported release is **1.5.0**.

For bugs, include the Obsidian and Roseboard versions, device/OS, reproduction steps, expected behavior and actual behavior. A small synthetic board is better than an entire personal vault. Remove private notes, file paths and credentials from attachments.

For feature requests, describe the workflow and what feels difficult today. Screenshots or a sketch are welcome.

## Code changes

Use `main` as the base. Install the lockfile with `npm ci`, run `npm test` and `npm run build`, and read `AGENTS.md` before changing board storage. Keep schema compatibility and protect notes from concurrent overwrites. Use a disposable vault and separate Obsidian profile for integration tests; see the README and test report.

Pull requests should explain the user-visible behavior and include focused validation. Never commit real vault contents, recovery drafts or credentials.
