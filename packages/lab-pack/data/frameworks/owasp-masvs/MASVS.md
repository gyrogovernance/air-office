# MASVS reference

Mobile Application Security Verification Standard extracts from the OWASP Secure Agent Playbook.

Publisher: OWASP Secure Agent Playbook. Edition: MASVS.
Source tree: https://github.com/OWASP/secure-agent-playbook/tree/65d4efd2cd0b081d52101e9708792b944e4ddebb/plugins/code-security-skills/data/masvs (32 sections).

## MASVS-AUTH-1: The app uses secure authentication and authorization protocols

# MASVS-AUTH-1

## Control

The app uses secure authentication and authorization protocols and follows the relevant best practices.

## Description

Most apps connecting to a remote endpoint require user authentication and also enforce some kind of authorization. While the enforcement of these mechanisms must be on the remote endpoint, the apps also have to ensure that it follows all the relevant best practices to ensure a secure use of the involved protocols.
## MASVS-AUTH-2: The app performs local authentication securely according to

# MASVS-AUTH-2

## Control

The app performs local authentication securely according to the platform best practices.

## Description

Many apps allow users to authenticate via biometrics or a local PIN code. These authentication mechanisms need to be correctly implemented. Additionally, some apps might not have a remote endpoint, and rely fully on local app authentication.
## MASVS-AUTH-3: The app secures sensitive operations with additional authentication.

# MASVS-AUTH-3

## Control

The app secures sensitive operations with additional authentication.

## Description

Some additional form of authentication is often desirable for sensitive actions inside the app. This can be done in different ways (biometric, pin, MFA code generator, email, deep links, etc) and they all need to be implemented securely.
## MASVS-AUTH: Authentication and Authorization

# MASVS-AUTH — Authentication and Authorization

MASVS-AUTH covers how the mobile app authenticates users to remote endpoints and to local resources (biometric unlock, device credentials). Failures here lead to account takeover, local-bypass of locked features, and broken session handling.

## What this group covers

- Protocol-level authentication (OAuth, OIDC, JWT)
- Local authentication (biometric/device credential)
- Session lifecycle (creation, refresh, invalidation, token storage)
- Authorization enforcement on both client and server

## Controls

- `MASVS-AUTH-1` — secure authentication protocol use
- `MASVS-AUTH-2` — local biometric authentication is bound to a hardware-backed key, not a bypassable boolean check
- `MASVS-AUTH-3` — sessions are correctly created, refreshed, and invalidated

See individual control files for `when_to_use`, `threats`, `static_signals`, and `mastg_tests`.
## MASVS-CODE-1: The app requires an up-to-date platform version.

# MASVS-CODE-1

## Control

The app requires an up-to-date platform version.

## Description

Every release of the mobile OS includes security patches and new security features. By supporting older versions, apps stay vulnerable to well-known threats. This control ensures that the app is running on an up-to-date platform version so that users have the latest security protections.
## MASVS-CODE-2: The app has a mechanism for enforcing app updates.

# MASVS-CODE-2

## Control

The app has a mechanism for enforcing app updates.

## Description

Sometimes critical vulnerabilities are discovered in the app when it is already in production. This control ensures that there is a mechanism to force the users to update the app before they can continue using it.
## MASVS-CODE-3: The app only uses software components without known vulnerabilities.

# MASVS-CODE-3

## Control

The app only uses software components without known vulnerabilities.

## Description

To be truly secure, a full whitebox assessment should have been performed on all app components. However, as it usually happens with e.g. for third-party components this is not always feasible and not typically part of a penetration test. This control covers "low-hanging fruit" cases, such as those that can be detected just by scanning libraries for known vulnerabilities.
## MASVS-CODE-4: The app validates and sanitizes all untrusted inputs.

# MASVS-CODE-4

## Control

The app validates and sanitizes all untrusted inputs.

## Description

Apps have many data entry points including the UI, IPC, the network, the file system, etc. This incoming data might have been inadvertently modified by untrusted actors and may lead to bypass of critical security checks as well as classical injection attacks such as SQL injection, XSS or insecure deserialization. This control ensures that this data is treated as untrusted input and is properly verified and sanitized before it's used.
## MASVS-CODE: Code Quality

# MASVS-CODE — Code Quality

MASVS-CODE covers code-level hygiene that affects security: the platform version the app runs on, whether the app enforces its own updates, dependency CVE hygiene, and input validation at trust boundaries. Failures here typically appear as exploitable outdated clients, supply-chain CVEs, and various forms of injection.

## What this group covers

- Supported platform OS / API-level minimum
- App-update enforcement (in-app update prompts, force-update gates against a server-side minimum)
- Dependency CVE hygiene (cross-refs `sca-audit`)
- Input validation at trust boundaries; safe handling of dangerous APIs

## Controls

- `MASVS-CODE-1` — the app runs on a current, supported platform OS / API level
- `MASVS-CODE-2` — the app enforces installation of available updates
- `MASVS-CODE-3` — third-party software components are free of known CVEs
- `MASVS-CODE-4` — untrusted inputs are validated and sanitized at trust boundaries

See individual control files for `when_to_use`, `threats`, `static_signals`, and `mastg_tests`.
## MASVS-CRYPTO-1: The app employs current strong cryptography and uses it according

# MASVS-CRYPTO-1

## Control

The app employs current strong cryptography and uses it according to industry best practices.

## Description

Cryptography plays an especially important role in securing the user's data - even more so in a mobile environment, where attackers having physical access to the user's device is a likely scenario. This control covers general cryptography best practices, which are typically defined in external standards.
## MASVS-CRYPTO-2: The app performs key management according to industry best

# MASVS-CRYPTO-2

## Control

The app performs key management according to industry best practices.

## Description

Even the strongest cryptography would be compromised by poor key management. This control covers the management of cryptographic keys throughout their lifecycle, including key generation, storage and protection.
## MASVS-CRYPTO: Cryptography

# MASVS-CRYPTO — Cryptography

MASVS-CRYPTO covers correct use of cryptography — algorithm choice, mode, key/IV management. Mobile apps frequently roll their own crypto or use defaults that include broken algorithms (DES, MD5), insecure modes (ECB), or hard-coded keys, all of which fully compromise the confidentiality the crypto was supposed to provide.

## What this group covers

- Algorithm and key length selection
- Mode/padding choice
- Key generation, storage, and rotation
- IV/nonce randomness

## Controls

- `MASVS-CRYPTO-1` — strong, current algorithms and modes
- `MASVS-CRYPTO-2` — secure key/IV generation and management

See individual control files for `when_to_use`, `threats`, `static_signals`, and `mastg_tests`.
## MASVS-NETWORK-1: The app secures all network traffic according to the current

# MASVS-NETWORK-1

## Control

The app secures all network traffic according to the current best practices.

## Description

Ensuring data privacy and integrity of any data in transit is critical for any app that communicates over the network. This is typically done by encrypting data and authenticating the remote endpoint, as TLS does. However, there are many ways for a developer to disable the platform secure defaults, or bypass them completely by using low-level APIs or third-party libraries. This control ensures that the app is in fact setting up secure connections in any situation.
## MASVS-NETWORK-2: The app performs identity pinning for all remote endpoints

# MASVS-NETWORK-2

## Control

The app performs identity pinning for all remote endpoints under the developer's control.

## Description

Instead of trusting all the default root CAs of the framework or device, this control will make sure that only very specific CAs are trusted. This practice is typically called certificate pinning or public key pinning.
## MASVS-NETWORK: Network Communication

# MASVS-NETWORK — Network Communication

MASVS-NETWORK covers how the app secures traffic to remote endpoints — TLS configuration, certificate validation, and certificate pinning. Misconfiguration here allows MITM attacks against any TLS-bearing endpoint.

## What this group covers

- TLS configuration (cleartext allowed, minimum protocol version)
- Certificate validation (custom TrustManager / URLSessionDelegate logic)
- Certificate pinning
- Mixed-content handling in WebViews

## Controls

- `MASVS-NETWORK-1` — secure TLS configuration and certificate validation
- `MASVS-NETWORK-2` — certificate pinning where applicable

See individual control files for `when_to_use`, `threats`, `static_signals`, and `mastg_tests`.
## MASVS-PLATFORM-1: The app uses IPC mechanisms securely.

# MASVS-PLATFORM-1

## Control

The app uses IPC mechanisms securely.

## Description

Apps typically use platform provided IPC mechanisms to intentionally expose data or functionality. Both installed apps and the user are able to interact with the app in many different ways. This control ensures that all interactions involving IPC mechanisms happen securely.
## MASVS-PLATFORM-2: The app uses WebViews securely.

# MASVS-PLATFORM-2

## Control

The app uses WebViews securely.

## Description

WebViews are typically used by apps that have a need for increased control over the UI. This control ensures that WebViews are configured securely to prevent sensitive data leakage as well as sensitive functionality exposure (e.g. via JavaScript bridges to native code).
## MASVS-PLATFORM-3: The app uses the user interface securely.

# MASVS-PLATFORM-3

## Control

The app uses the user interface securely.

## Description

Sensitive data has to be displayed in the UI in many situations (e.g. passwords, credit card details, OTP codes in notifications). This control ensures that this data doesn't end up being unintentionally leaked due to platform mechanisms such as auto-generated screenshots or accidentally disclosed via e.g. shoulder surfing or sharing the device with another person.
## MASVS-PLATFORM: Platform Interaction

# MASVS-PLATFORM — Platform Interaction

MASVS-PLATFORM covers how the app interacts with the underlying OS — IPC (intents, URL schemes, custom URI schemes), WebView bridges, deep links, and platform UI features (screenshot prevention, pasteboard hygiene). Failures here typically allow other apps or web content to invoke the app in unintended ways.

## What this group covers

- Exported components and IPC permissions
- Deep-link / URL scheme validation
- WebView native-bridge security
- UI side-channels (screen capture, pasteboard)

## Controls

- `MASVS-PLATFORM-1` — IPC mechanisms are secured (export, permissions, validation)
- `MASVS-PLATFORM-2` — WebView and bridges are configured to resist injection
- `MASVS-PLATFORM-3` — UI is protected against side-channel observation

See individual control files for `when_to_use`, `threats`, `static_signals`, and `mastg_tests`.
## MASVS-PRIVACY-1: The app minimizes access to sensitive data and resources.

# MASVS-PRIVACY-1

## Control

The app minimizes access to sensitive data and resources.

## Description

Apps should only request access to the data they absolutely need for their functionality and always with informed consent from the user. This control ensures that apps practice data minimization and restricts access control, reducing the potential impact of data breaches or leaks.

Furthermore, apps should share data with third parties only when necessary, and this should include enforcing that third-party SDKs operate based on user consent, not by default or without it. Apps should prevent third-party SDKs from ignoring consent signals or from collecting data before consent is confirmed.

Additionally, apps should be aware of the 'supply chain' of SDKs they incorporate, ensuring that no data is unnecessarily passed down their chain of dependencies. This end-to-end responsibility for data aligns with recent SBOM regulatory requirements, making apps more accountable for their data practices.
## MASVS-PRIVACY-2: The app prevents identification of the user.

# MASVS-PRIVACY-2

## Control

The app prevents identification of the user.

## Description

Protecting user identity is crucial. This control emphasizes the use of unlinkability techniques like data abstraction, anonymization and pseudonymization to prevent user identification and tracking.

Another key aspect addressed by this control is to establish technical barriers when employing complex 'fingerprint-like' signals (e.g. device IDs, IP addresses, behavioral patterns) for specific purposes. For instance, a fingerprint used for fraud detection should be isolated and not repurposed for audience measurement in an analytics SDK. This ensures that each data stream serves its intended function without risking user privacy.
## MASVS-PRIVACY-3: The app is transparent about data collection and usage.

# MASVS-PRIVACY-3

## Control

The app is transparent about data collection and usage.

## Description

Users have the right to know how their data is being used. This control ensures that apps provide clear information about data collection, storage, and sharing practices, including any behavior a user wouldn't reasonably expect, such as background data collection. Apps should also adhere to platform guidelines on data declarations.
## MASVS-PRIVACY-4: The app offers user control over their data.

# MASVS-PRIVACY-4

## Control

The app offers user control over their data.

## Description

Users should have control over their data. This control ensures that apps provide mechanisms for users to manage, delete, and modify their data, and change privacy settings as needed (e.g. to revoke consent). Additionally, apps should re-prompt for consent and update their transparency disclosures when they require more data than initially specified.
## MASVS-PRIVACY: User Privacy

# MASVS-PRIVACY — User Privacy

MASVS-PRIVACY covers data minimization, consent, and transparent handling of personal data — distinct from MASVS-STORAGE's focus on technical confidentiality. **This play covers PRIVACY only partially from source**: declared permissions, third-party SDK presence, and manifest claims are statically observable; actual data flow at runtime is deferred to a future Tier 3 `mobile-dynamic-test` skill.

## What this group covers

- Permission minimization (only what's needed)
- Third-party SDK disclosure (analytics, ads, attribution)
- User consent and tracking-transparency declarations
- Runtime data-handling discipline (the deferred part)

## Controls

- `MASVS-PRIVACY-1` — data collection is minimized and disclosed
- `MASVS-PRIVACY-2` — sensitive data is processed in compliance with applicable regulations
- `MASVS-PRIVACY-3` — third-party data sharing is disclosed and consented to
- `MASVS-PRIVACY-4` — privacy controls are observable and user-controllable

See individual control files for `when_to_use`, `threats`, `static_signals`, and `mastg_tests`.
## MASVS-RESILIENCE-1: The app validates the integrity of the platform.

# MASVS-RESILIENCE-1

## Control

The app validates the integrity of the platform.

## Description

Running on a platform that has been tampered with can be very dangerous for apps, as this may disable certain security features, putting the data of the app at risk. Trusting the platform is essential for many of the MASVS controls relying on the platform being secure (e.g. secure storage, biometrics, sandboxing, etc.). This control tries to validate that the OS has not been compromised and its security features can thus be trusted.
## MASVS-RESILIENCE-2: The app implements anti-tampering mechanisms.

# MASVS-RESILIENCE-2

## Control

The app implements anti-tampering mechanisms.

## Description

Apps run on a user-controlled device, and without proper protections it's relatively easy to run a modified version locally (e.g. to cheat in a game, or enable premium features without paying), or upload a backdoored version of it to third-party app stores. This control tries to ensure the integrity of the app's intended functionality by preventing modifications to the original code and resources.
## MASVS-RESILIENCE-3: The app implements anti-static analysis mechanisms.

# MASVS-RESILIENCE-3

## Control

The app implements anti-static analysis mechanisms.

## Description

Understanding the internals of an app is typically the first step towards tampering with it (either dynamically, or statically). This control tries to impede comprehension by making it as difficult as possible to figure out how an app works using static analysis.
## MASVS-RESILIENCE-4: The app implements anti-dynamic analysis techniques.

# MASVS-RESILIENCE-4

## Control

The app implements anti-dynamic analysis techniques.

## Description

Sometimes pure static analysis is very difficult and time consuming so it typically goes hand in hand with dynamic analysis. Observing and manipulating an app during runtime makes it much easier to decipher its behavior. This control aims to make it as difficult as possible to perform dynamic analysis, as well as prevent dynamic instrumentation which could allow an attacker to modify the code at runtime.
## MASVS-RESILIENCE: Resilience Against Reverse-Engineering

# MASVS-RESILIENCE — Resilience Against Reverse-Engineering

MASVS-RESILIENCE covers defenses against reverse-engineering, tampering, and runtime attacks: root/jailbreak detection, anti-debugging, anti-tamper, code obfuscation. **This play inspects static signals only** (build flags, library presence, manifest declarations); true resilience verification requires runtime/binary testing and is deferred to a future Tier 3 `mobile-dynamic-test` skill.

## What this group covers

- Debug/release build hygiene (debuggable, ProGuard/R8, symbols)
- Root/jailbreak detection presence
- Anti-debug code paths
- Anti-tamper / integrity checks

## Controls

- `MASVS-RESILIENCE-1` — the app detects and reacts to a tampered runtime
- `MASVS-RESILIENCE-2` — the app impedes static and dynamic analysis (obfuscation, anti-debug)
- `MASVS-RESILIENCE-3` — the app detects and reacts to root/jailbreak
- `MASVS-RESILIENCE-4` — the app verifies the integrity of its own code at runtime

See individual control files for `when_to_use`, `threats`, `static_signals`, and `mastg_tests`.
## MASVS-STORAGE-1: The app securely stores sensitive data.

# MASVS-STORAGE-1

## Control

The app securely stores sensitive data.

## Description

Apps handle sensitive data coming from many sources such as the user, the backend, system services or other apps on the device and usually need to store it locally. The storage locations may be private to the app (e.g. its internal storage) or be public and therefore accessible by the user or other installed apps (e.g. public folders such as Downloads). This control ensures that any sensitive data that is intentionally stored by the app is properly protected independently of the target location.
## MASVS-STORAGE-2: The app prevents leakage of sensitive data.

# MASVS-STORAGE-2

## Control

The app prevents leakage of sensitive data.

## Description

There are cases when sensitive data is unintentionally stored or exposed to publicly accessible locations; typically as a side-effect of using certain APIs, system capabilities such as backups or logs. This control covers this kind of unintentional leaks where the developer actually has a way to prevent it.
## MASVS-STORAGE: Sensitive Data Storage

# MASVS-STORAGE — Sensitive Data Storage

MASVS-STORAGE addresses how mobile applications persist sensitive data on the device — credentials, tokens, PII, and application secrets. Failures in this group expose user data to local attackers, malware, backup leakage, or other apps on the device.

## What this group covers

- Where the app stores secrets (SharedPreferences/NSUserDefaults vs. KeyStore/Keychain)
- Whether storage is encrypted and key material is protected
- Whether backup, cloud-sync, or external-storage paths leak data
- What other apps can read via shared content providers, app groups, or world-readable paths

## Controls

- `MASVS-STORAGE-1` — secure secret storage (KeyStore/Keychain)
- `MASVS-STORAGE-2` — no sensitive data leakage outside the app sandbox

See individual control files for `when_to_use`, `threats`, `static_signals`, and `mastg_tests`.
