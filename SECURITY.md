# Security policy

## Supported version

| Version | Security fixes |
| --- | --- |
| Current `main` branch and its GitHub Pages deployment | Supported |
| Older commits, downloaded copies, and forks | Not maintained by this project |

This is a static portfolio tracker using Firebase Authentication, Cloud Firestore, and a local IndexedDB cache. Prices are entered manually; the app does not place trades or provide live market data.

## Reporting a vulnerability

Please do **not** post exploit details, account information, portfolio data, credentials, screenshots containing private information, or proof-of-concept code in a public issue.

Use **Report a vulnerability** on the repository's [Advisories page](https://github.com/j-kavindu/cse-portfolio-tracker/security/advisories) to submit a private vulnerability report to the maintainers. Do not use a public issue for a security report.

In your private report, include the affected URL or commit, steps to reproduce, expected and actual behavior, potential impact, and a minimal test case with invented data. Please test only accounts and data you own. Do not access other users' portfolios or disrupt the live service.

The maintainer will review the report, investigate, and coordinate a fix and disclosure where appropriate. No fixed response or resolution time is promised.

## Data and credentials

Do not include Firebase service-account keys, OAuth client secrets, GitHub tokens, or real portfolio data in a report or pull request. The Firebase Web App configuration in `js/config.js` is public client metadata; user access is controlled by Firebase Authentication and the deployed Firestore Security Rules. Keep an exported backup of your own portfolio before testing changes that could affect your data.
