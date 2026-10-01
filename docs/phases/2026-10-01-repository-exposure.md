# Repository exposure review

The configured destination is `KampusOne/platform`, currently public. A correct repository URL from Meta AI is not proof that private credentials or database rows were accessed. Public source can be discovered and read from GitHub without application authorization. There is no app-side robots rule, hidden subdomain or source-code setting that reliably makes a public GitHub repository inaccessible to AI.

Restricting future unauthenticated source access requires a private repository with explicitly reviewed collaborators and deployment integrations. This does not recall copies already downloaded; existing public forks can remain public. Review any GitHub Pages dependency before changing visibility. No visibility change was made in this phase.

A targeted scan of 739 tracked and intended delivery paths checked high-confidence provider-key, database-URL and private-key patterns. Five locations were reviewed: the documented database URL example, the GA4 validator's expected PEM-header literal, and synthetic provider credentials in three test fixtures. No real credential was identified in that scan. The scan covers the checkout and intended delivery files, not every historical commit, external copy, deployment secret or third-party AI conversation. No source-repository link is advertised by the mobile or portal UI. Private runtime files remain ignored and are excluded from the delivery bundle.

The portal retains no-index metadata and the existing obscure admin hostname. Server authentication, explicit permissions, university scope and auditing protect administrative operations regardless of whether that hostname is known. New private documents and identity submissions are never projected into public business profiles.

Automatic approval review rejected `git push -u origin feat/business-platform-20260930` because it would publish potentially sensitive source and migration details to the public repository without specific authorization for that payload and destination. No alternate connector or execution path bypassed that rejection. The completed branch remains local and is packaged for review; publication needs an explicit choice of public or private destination.

Primary references: https://docs.github.com/en/repositories/creating-and-managing-repositories/about-repositories and https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility .
