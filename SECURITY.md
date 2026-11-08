# Security policy

Focus Spoofer runs code inside every page it protects, so security reports matter to us.

## Reporting a vulnerability

Please **don't open a public issue**. Report privately through
[GitHub security advisories](https://github.com/Abhinav-ranish/Focus-Spoofer/security/advisories/new)
with steps to reproduce and the extension version you tested.

You should hear back within a week. Once a fix ships to the Chrome Web Store we'll credit
you in the advisory unless you'd rather stay anonymous.

## Scope

In scope: the extension in `extension/`, and the backend in `server/` and `site-proxy/`.
For example, a page escaping the spoofer to read extension state, a way to make the
extension send data a user didn't opt in to, or abuse of the feedback endpoints.

Out of scope: a website still detecting tab switches. That's a compatibility bug; please
[report it as an issue](https://github.com/Abhinav-ranish/Focus-Spoofer/issues/new?template=site_compat.yml).

Only the latest Chrome Web Store version is supported.
