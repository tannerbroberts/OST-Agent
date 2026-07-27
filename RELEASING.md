# Releasing

OST-Agent is not published anywhere. A release is a git tag plus a rebuilt
bundle, and users get it by updating the plugin.

1. `npm test` and `npx tsc --noEmit` — both clean.
2. Bump `version` in `package.json`, `.claude-plugin/plugin.json`, AND `VERSION`
   in `src/index.ts`. All three must match; `test/release/version.test.ts`
   enforces it.
3. `npm run bundle` — rebuild `dist/ost-agent.mjs`.
4. Commit the bump and the rebuilt bundle together. CI fails the build if the
   committed bundle does not match a fresh one.
5. Update `CHANGELOG.md`.
6. `git tag vX.Y.Z && git push --tags`.

There is no publish step. There is no npm package. `package.json` is `private`,
so `npm publish` fails at the client before it reaches the registry.
