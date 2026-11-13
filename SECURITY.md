```
▐██████ ▐██ ▐██████      ▐██████ ▐██████ ▐██████ ▐██ ▐██████ ▐██████
▐██ ▐██ ▐██ ▐██ ▐██      ▐██ ▐██ ▐██     ▐██     ▐██ ▐██     ▐██    
▐██████ ▐██ ▐██████      ▐██ ▐██ ▐████   ▐████   ▐██ ▐██     ▐████  
▐██ ▐██ ▐██ ▐██▐██       ▐██ ▐██ ▐██     ▐██     ▐██ ▐██     ▐██    
▐██ ▐██ ▐██ ▐██ ▐██      ▐██████ ▐██     ▐██     ▐██ ▐██████ ▐██████
```

# Security policy

## Supported versions

AIR Office is in alpha. Security fixes target the current `main` branch and the latest published pre-release when one exists.

## Reporting a vulnerability

Please report security issues privately. Do not open a public GitHub issue for vulnerabilities that could expose user data, credentials, or remote code execution.

- Prefer GitHub’s private vulnerability reporting for this repository when it is enabled.
- Otherwise email [Gyro Governance Lab](http://gyrogovernance.com/) and mark the subject clearly as a security report.

Include the app or commit version, operating system, a clear description of the issue, and steps to reproduce. Remove API keys, tokens, and private document content before sharing logs or screenshots.

We will acknowledge receipt when we can and keep you informed of the status of the report. Please give us a reasonable window to investigate and ship a fix before any public disclosure.

## Scope notes

AIR Office stores workspace data locally and can call local models, hosted providers, and optional connectors. Reports that involve credential handling, local filesystem authorization, chat tool permissions, dependency supply chain, or desktop packaging are especially useful.

Privacy, local data control, and operator oversight are summarized in [docs/sovereignty.md](docs/sovereignty.md).

Out of scope for private security reports: feature requests, general bugs that do not create a security risk, and speculative issues without a practical impact.
