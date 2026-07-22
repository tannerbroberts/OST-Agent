Source: implementation note, Atlassian adapter, 2026-07-22

A downloaded standalone tool cannot borrow the host's MCP connections, so integrations must
authenticate themselves. The Atlassian adapter uses the Cloud REST APIs directly with a
least-privilege, read-only API token from an environment variable, and issues only GET
requests. Operators worry about credential blast radius and about the agent writing back
to their systems of record; it never writes back, and the token is never stored in the vault.
