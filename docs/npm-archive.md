# npm archive

`ost-agent` published 0.20.0, 0.21.0, and 0.22.0 to npm. Git was never tagged
at those versions and no branch carries them, so the registry tarballs were the
only copy of that source.

They are preserved as assets on the `npm-archive` GitHub release, downloaded
with `npm pack` before `npm unpublish` ran.

This is a safety net for source with no other copy. It is not a distribution
channel — OST-Agent installs only as a Claude Code plugin.
