# Where this fixture pair comes from

Three files, one declaration and two grants, standing in for the configuration five
recorded firings of this repo's meta vault actually ran under.

- `skill.md` — the declaration. Its `allowed-tools` line is the shape
  `.claude/skills/opportunity-solution-tree/SKILL.md` carries: plugin-namespaced MCP
  tools, plus the repo reads a build pass makes under a product path, plus one command
  form (`Bash(npx vitest run:*)`) that a grant covers by prefix rather than by literal.

- `settings.json` — the grant those firings ran under. It omits four MCP tools
  (`ost_check`, `ost_debt`, `ost_status`, `ost_flag_humans_required`), which is the
  omission `examples/automation/autonomous-pass.sh` documents in its own comments, and
  it scopes `Glob` to the **vault** directory while the declaration asks to read the
  **repo**. That second one is the case the parent assumption turns on: four of fifteen
  recorded denials in this workspace were `Glob` refused on `/Users/tanner/dev/OST-Agent`
  — the tool was available and the directory was not, so a resolver comparing names
  alone would report "granted" for a call that is about to be denied.

- `settings-cleared.json` — the same declaration, fully covered, with the coverage
  coming from patterns rather than literals: one server-level MCP grant, one path glob,
  one Bash prefix. It exists so "names every gap" cannot be passed by a resolver that
  reports everything as a gap.

The paths are the real ones from this machine because the scoping bug is about real
absolute paths; nothing in the suite touches them on disk.
