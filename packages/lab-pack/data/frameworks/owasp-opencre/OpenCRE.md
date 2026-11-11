# OpenCRE reference

OpenCRE cross-reference extracts bundled with the OWASP Secure Agent Playbook.

Publisher: OWASP Secure Agent Playbook. Edition: OpenCRE.
Source tree: https://github.com/OWASP/secure-agent-playbook/tree/65d4efd2cd0b081d52101e9708792b944e4ddebb/data/opencre (13 sections).

## CWE-16 Configuration

# CWE-16: Configuration

## OpenCRE Mappings

| CRE ID | CRE Name | Link |
|--------|----------|------|
| 180-488 | Proper Configuration for all applications and frameworks | [opencre.org/cre/180-488](https://www.opencre.org/cre/180-488) |
| 462-245 | Remove unnecessary elements from external components | [opencre.org/cre/462-245](https://www.opencre.org/cre/462-245) |
| 623-347 | Disallow shared high privileged accounts | [opencre.org/cre/623-347](https://www.opencre.org/cre/623-347) |

## What to Look For

- Default credentials or sample configurations in production
- Debug endpoints, admin panels, or development tools exposed
- Missing security headers (X-Content-Type-Options, Strict-Transport-Security, etc.)
- Overly permissive CORS (Access-Control-Allow-Origin: *)
- Directory listing enabled
- Missing rate limiting on sensitive endpoints

## References

- [CWE-16](https://cwe.mitre.org/data/definitions/16.html)
- [OWASP Security Headers](https://owasp.org/www-project-secure-headers/)
## CWE-200 Exposure of Sensitive Information

# CWE-200: Exposure of Sensitive Information

## OpenCRE Mappings

| CRE ID | CRE Name | Link |
|--------|----------|------|
| 713-683 | Protect logs against unauthorized access | [opencre.org/cre/713-683](https://www.opencre.org/cre/713-683) |
| 743-110 | Do not disclose technical info in HTTP headers | [opencre.org/cre/743-110](https://www.opencre.org/cre/743-110) |
| 227-045 | Identify sensitive data and subject it to a policy | [opencre.org/cre/227-045](https://www.opencre.org/cre/227-045) |

## What to Look For

- Stack traces or internal paths in error responses
- Verbose logging of requests/responses containing PII
- Missing response headers (X-Content-Type-Options, etc.)
- API responses including more fields than necessary
- Debug mode enabled in production configs
- LLM outputs containing memorized training data

## References

- [CWE-200](https://cwe.mitre.org/data/definitions/200.html)
- [OWASP Error Handling Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Error_Handling_Cheat_Sheet.html)
## CWE-22 Path Traversal

# CWE-22: Path Traversal

## OpenCRE Mappings

| CRE ID | CRE Name | Link |
|--------|----------|------|
| 675-168 | Sanitize filename metadata from untrusted origin | [opencre.org/cre/675-168](https://www.opencre.org/cre/675-168) |

## What to Look For

- User input in file path construction without canonicalization
- Missing validation for `../` sequences or null bytes in file paths
- File operations using user-supplied filenames directly
- Archive extraction without path validation (zip slip)
- MCP server or LLM agent tools that accept file paths from model output

## References

- [CWE-22](https://cwe.mitre.org/data/definitions/22.html)
- [OWASP Path Traversal](https://owasp.org/www-community/attacks/Path_Traversal)
## CWE-287 Improper Authentication

# CWE-287: Improper Authentication

## OpenCRE Mappings

| CRE ID | CRE Name | Link |
|--------|----------|------|
| 813-610 | Do not use static secrets | [opencre.org/cre/813-610](https://www.opencre.org/cre/813-610) |
| 605-735 | Authenticate all external connections | [opencre.org/cre/605-735](https://www.opencre.org/cre/605-735) |
| 816-631 | Ensure timely expiration of OOB auth tokens | [opencre.org/cre/816-631](https://www.opencre.org/cre/816-631) |

## What to Look For

- Missing authentication on endpoints or functions
- Hardcoded credentials or API keys
- JWT issues: `none` algorithm, missing expiry, weak signing key, secrets in payload
- Weak password requirements or missing rate limiting on login
- Missing MFA enforcement for sensitive operations
- Session tokens in URLs or logs

## References

- [CWE-287](https://cwe.mitre.org/data/definitions/287.html)
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
## CWE-327 Use of a Broken or Risky Cryptographic Algorithm

# CWE-327: Use of a Broken or Risky Cryptographic Algorithm

## OpenCRE Mappings

| CRE ID | CRE Name | Link |
|--------|----------|------|
| 742-431 | Use approved cryptographic algorithms | [opencre.org/cre/742-431](https://www.opencre.org/cre/742-431) |
| 002-801 | Use approved algorithms for generation, seeding and verification | [opencre.org/cre/002-801](https://www.opencre.org/cre/002-801) |
| 504-340 | Encrypt with algorithms providing confidentiality and integrity | [opencre.org/cre/504-340](https://www.opencre.org/cre/504-340) |

## What to Look For

- MD5 or SHA1 used for password hashing (use bcrypt, scrypt, or Argon2)
- DES, 3DES, RC4, or Blowfish in production code
- ECB mode usage (use GCM or CBC with HMAC)
- Hardcoded encryption keys, IVs, or salts
- RSA keys < 2048 bits or AES keys < 128 bits
- Custom cryptographic implementations instead of vetted libraries

## References

- [CWE-327](https://cwe.mitre.org/data/definitions/327.html)
- [OWASP Cryptographic Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html)
## CWE-352 Cross-Site Request Forgery (CSRF)

# CWE-352: Cross-Site Request Forgery (CSRF)

## OpenCRE Mappings

| CRE ID | CRE Name | Link |
|--------|----------|------|
| 464-084 | Add CSRF protection for cookie based REST services | [opencre.org/cre/464-084](https://www.opencre.org/cre/464-084) |
| 060-472 | Use CSRF protection against authenticated functionality | [opencre.org/cre/060-472](https://www.opencre.org/cre/060-472) |

## What to Look For

- State-changing operations without CSRF tokens
- Missing SameSite cookie attribute or set to `None`
- CORS misconfiguration allowing cross-origin requests with credentials
- Framework CSRF middleware disabled or exempted on sensitive routes

## References

- [CWE-352](https://cwe.mitre.org/data/definitions/352.html)
- [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
## CWE-384 Session Fixation

# CWE-384: Session Fixation

## OpenCRE Mappings

| CRE ID | CRE Name | Link |
|--------|----------|------|
| 002-630 | Generate a new session token after authentication | [opencre.org/cre/002-630](https://www.opencre.org/cre/002-630) |

## What to Look For

- Missing session ID regeneration after login
- Session tokens unchanged after privilege escalation
- Accepting session IDs from URL parameters or form fields
- Missing session invalidation on logout or password change

## References

- [CWE-384](https://cwe.mitre.org/data/definitions/384.html)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
## CWE-502 Deserialization of Untrusted Data

# CWE-502: Deserialization of Untrusted Data

## OpenCRE Mappings

| CRE ID | CRE Name | Link |
|--------|----------|------|
| 831-563 | Avoid deserialization logic | [opencre.org/cre/831-563](https://www.opencre.org/cre/831-563) |
| 736-554 | Block serialization of content from untrusted clients | [opencre.org/cre/736-554](https://www.opencre.org/cre/736-554) |
| 762-616 | Secure serialized objects (integrity checks) | [opencre.org/cre/762-616](https://www.opencre.org/cre/762-616) |

## What to Look For

- Native deserialization of untrusted input (Java ObjectInputStream, Python unpickling, PHP unserialize, Ruby Marshal, .NET BinaryFormatter)
- Missing integrity checks on serialized data (unsigned cookies or tokens)
- ML model files loaded without verification
- Missing CSRF protection on state-changing operations using serialized payloads

## References

- [CWE-502](https://cwe.mitre.org/data/definitions/502.html)
- [OWASP Deserialization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Deserialization_Cheat_Sheet.html)
## CWE-778 Insufficient Logging

# CWE-778: Insufficient Logging

## OpenCRE Mappings

| CRE ID | CRE Name | Link |
|--------|----------|------|
| 184-284 | Log all security relevant events | [opencre.org/cre/184-284](https://www.opencre.org/cre/184-284) |
| 841-710 | Log authentication decisions without exposing sensitive data | [opencre.org/cre/841-710](https://www.opencre.org/cre/841-710) |
| 555-048 | Log events sufficiently to recreate their order | [opencre.org/cre/555-048](https://www.opencre.org/cre/555-048) |

## What to Look For

- Missing logs for authentication successes and failures
- No audit trail for authorization decisions or privilege changes
- Sensitive data (passwords, tokens, PII) in log entries
- Logs without timestamps, user IDs, or source IPs
- Missing log integrity protections (append-only, centralized collection)

## References

- [CWE-778](https://cwe.mitre.org/data/definitions/778.html)
- [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)
## CWE-78 OS Command Injection

# CWE-78: OS Command Injection

## OpenCRE Mappings

| CRE ID | CRE Name | Link |
|--------|----------|------|
| 857-718 | Protect against OS command injection attack | [opencre.org/cre/857-718](https://www.opencre.org/cre/857-718) |
| 683-722 | Block direct file metadata execution from untrusted origin | [opencre.org/cre/683-722](https://www.opencre.org/cre/683-722) |

## What to Look For

- User input in system(), popen(), or subprocess calls without sanitization
- Shell interpolation of variables in command strings
- Missing use of array-based process invocation (safer than shell strings)
- LLM agent tools that construct shell commands from model output
- MCP server tools accepting free-form command parameters

## References

- [CWE-78](https://cwe.mitre.org/data/definitions/78.html)
- [OWASP OS Command Injection Defense Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/OS_Command_Injection_Defense_Cheat_Sheet.html)
## CWE-79 Cross-site Scripting (XSS)

# CWE-79: Cross-site Scripting (XSS)

## OpenCRE Mappings

| CRE ID | CRE Name | Link |
|--------|----------|------|
| 366-835 | Escape output against XSS | [opencre.org/cre/366-835](https://www.opencre.org/cre/366-835) |

## Cross-Standard References

Via OpenCRE 366-835:
- **ASVS**: V5.3.3 — Verify context-aware output encoding
- **WSTG**: WSTG-INPV-01 — Testing for Reflected XSS
- **OWASP Cheat Sheet**: XSS Prevention
- **NIST 800-53**: SI-10 — Information Input Validation

## What to Look For

- User input rendered without output encoding in HTML, JavaScript, CSS, or URL contexts
- Template engines with auto-escaping disabled or bypassed (safe filters, raw output, unsafe HTML rendering props)
- DOM manipulation using innerHTML or unsafe DOM write methods with user data
- LLM-generated Markdown or HTML rendered without sanitization
- Missing Content-Security-Policy headers

## References

- [CWE-79](https://cwe.mitre.org/data/definitions/79.html)
- [OWASP XSS Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Scripting_Prevention_Cheat_Sheet.html)
## CWE-798 Use of Hard-coded Credentials

# CWE-798: Use of Hard-coded Credentials

## OpenCRE Mappings

| CRE ID | CRE Name | Link |
|--------|----------|------|
| 551-054 | Use ephemeral secrets rather than static secrets | [opencre.org/cre/551-054](https://www.opencre.org/cre/551-054) |
| 774-888 | Do not store secrets in the code | [opencre.org/cre/774-888](https://www.opencre.org/cre/774-888) |
| 340-375 | Use a dedicated secrets management solution | [opencre.org/cre/340-375](https://www.opencre.org/cre/340-375) |

## What to Look For

- API keys, passwords, or tokens in source code or configs
- Connection strings with embedded credentials
- Private keys or certificates committed to repositories
- Credentials in LLM system prompts or CLAUDE.md files
- High-risk files: .env, docker-compose, *.tfvars, terraform.tfstate, kubeconfig

## References

- [CWE-798](https://cwe.mitre.org/data/definitions/798.html)
- [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
## CWE-89 SQL Injection

# CWE-89: SQL Injection

## OpenCRE Mappings

| CRE ID | CRE Name | Link |
|--------|----------|------|
| 064-808 | Encode output context-specifically | [opencre.org/cre/064-808](https://www.opencre.org/cre/064-808) |
| 732-873 | Lock/precompile queries (parameterization) | [opencre.org/cre/732-873](https://www.opencre.org/cre/732-873) |

## Cross-Standard References

Via OpenCRE 732-873:
- **ASVS**: V5.3.4 — Verify parameterized queries or ORM usage
- **WSTG**: WSTG-INPV-05 — Testing for SQL Injection
- **OWASP Cheat Sheet**: SQL Injection Prevention
- **NIST 800-53**: SI-10 — Information Input Validation

## What to Look For

- String concatenation or interpolation in SQL queries
- ORM raw query methods (`raw()`, `execute()`, `$queryRaw`)
- Missing parameterized queries or prepared statements
- Dynamic table/column names from user input
- LLM output passed directly to database query functions

## References

- [CWE-89](https://cwe.mitre.org/data/definitions/89.html)
- [OWASP SQL Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html)
