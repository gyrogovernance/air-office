# LLM Top 10 reference

LLM Top 10 for LLM Applications extracts from the OWASP Secure Agent Playbook.

Publisher: OWASP Secure Agent Playbook. Edition: LLM Top 10.
Source tree: https://github.com/OWASP/secure-agent-playbook/tree/65d4efd2cd0b081d52101e9708792b944e4ddebb/data/llm-top10 (10 sections).

## LLM01 Prompt Injection

# LLM01:2025 Prompt Injection

## Description

Prompt injection vulnerabilities occur when user inputs manipulate LLM behavior in unintended ways. These attacks can be imperceptible to humans and exploit how models process prompts. The vulnerability can cause models to violate guidelines, generate harmful content, enable unauthorized access, or influence critical decisions. While RAG and fine-tuning improve relevance, they don't fully prevent prompt injection.

**Direct Prompt Injection**: User input directly alters model behavior, either intentionally (malicious) or unintentionally (accidental).

**Indirect Prompt Injection**: External sources like websites, files, or tool outputs contain content that alters model behavior when processed.

## Potential Impacts

- Disclosure of sensitive information or system prompts
- Content manipulation producing incorrect or biased outputs
- Unauthorized access to LLM functions or connected systems
- Arbitrary command execution in downstream systems
- Manipulation of critical decision-making processes
- Cross-modal attacks via multimodal AI systems

## Prevention and Mitigation

| # | Strategy | Description |
|---|----------|-------------|
| 1 | Constrain model behavior | Provide specific instructions about role, capabilities, and limitations in system prompts. Enforce strict context adherence. |
| 2 | Define and validate output formats | Specify clear output formats, request detailed reasoning with source citations. |
| 3 | Implement input/output filtering | Define sensitive categories, apply semantic filters, use the RAG Triad for relevance assessment. |
| 4 | Enforce privilege control | Provide the application with its own API tokens, handle functions in code rather than delegating to the model. |
| 5 | Require human approval | Implement human-in-the-loop controls for privileged operations. |
| 6 | Segregate external content | Separate and clearly denote untrusted content to limit its influence on user prompts. |
| 7 | Conduct adversarial testing | Perform regular penetration testing and breach simulations, treating the model as an untrusted user. |

## Example Attack Scenarios

1. **Direct injection** — Attacker injects prompt into customer support chatbot instructing it to ignore guidelines, access private data, and send emails.
2. **Indirect injection** — LLM summarizes webpage with hidden instructions causing insertion of image linked to URL, exfiltrating private conversation.
3. **RAG poisoning** — Attacker modifies document in RAG repository. When user query returns modified content, malicious instructions alter LLM output.
4. **Payload splitting** — Attacker uploads resume with split malicious prompts. Combined prompts during evaluation manipulate model response.
5. **Multimodal injection** — Attacker embeds malicious prompt in image accompanying benign text. Multimodal AI processing both concurrently processes hidden prompt.
6. **Adversarial suffix** — Attacker appends seemingly meaningless character string to prompt, influencing output and bypassing safety measures.
7. **Multilingual/obfuscated attack** — Attacker uses multiple languages or encodes instructions via Base64 or emojis to evade filters.

## AISVS Controls

| AISVS Section | Control | Key Requirements |
|---------------|---------|-----------------|
| C2.1 Prompt Injection Defense | Treat external inputs as untrusted, enforce instruction hierarchy, sanitize third-party content | 2.1.1, 2.1.2, 2.1.3 |
| C2.2 Adversarial-Example Resistance | Input normalization, quarantine suspected inputs, anomaly detection, adversarial-hardened models | 2.2.1, 2.2.2, 2.2.3, 2.2.4, 2.2.5 |
| C2.7 Multi-Modal Input Validation | Validate non-text inputs, scan for steganography, detect adversarial perturbations, cross-modal attacks | 2.7.1, 2.7.2, 2.7.3, 2.7.5 |
| C2.8 Real-Time Adaptive Threat Detection | Pattern matching on inputs/outputs, risk-adaptive responses, contextual analysis | 2.8.1, 2.8.2, 2.8.3 |
| C10.1 Model Alignment & Safety | Refusal guard-rails, counter-jailbreak training | 10.1.2, 10.1.4 |

## Related Frameworks

- AML.T0051.000 — LLM Prompt Injection: Direct (MITRE ATLAS)
- AML.T0051.001 — LLM Prompt Injection: Indirect (MITRE ATLAS)
- AML.T0054 — LLM Jailbreak Injection: Direct (MITRE ATLAS)

## References

- [OWASP Top 10 for LLM Applications](https://genai.owasp.org)
- [Not what you've signed up for: Compromising Real-World LLM-Integrated Applications with Indirect Prompt Injection](https://arxiv.org/abs/2302.12173)
- [Threat Modeling LLM Applications — AI Village](https://aivillage.org/large%20language%20models/threat-modeling-llm/)
## LLM02 Sensitive Information Disclosure

# LLM02:2025 Sensitive Information Disclosure

## Description

This vulnerability encompasses unauthorized exposure of sensitive data through LLM outputs, including PII, financial details, health records, confidential business information, security credentials, and proprietary algorithms. LLMs, especially when embedded in applications, risk exposing sensitive data through their output. The risk extends to both direct users and organizations deploying these systems.

## Common Examples

1. **PII leakage** — Unintended disclosure of personal identifiable information during LLM interactions
2. **Proprietary algorithm exposure** — Model misconfigurations revealing proprietary methods or training data, enabling inversion attacks
3. **Sensitive business data disclosure** — Confidential organizational information inadvertently included in generated responses
4. **Credential leakage** — API keys or credentials stored in system prompts exposed through prompt extraction

## Prevention and Mitigation

| # | Strategy | Description |
|---|----------|-------------|
| 1 | Sanitization | Implement data scrubbing and masking techniques to prevent sensitive content from entering training processes. |
| 2 | Access controls | Limit access to sensitive data based on the principle of least privilege. Restrict model access to external data sources. |
| 3 | Federated learning | Deploy decentralized training across multiple servers to minimize centralized data exposure. |
| 4 | Differential privacy | Incorporate noise into data, making reverse-engineering individual data points difficult. |
| 5 | User education | Educate users on safe LLM interaction practices. Maintain clear data retention and deletion policies. |
| 6 | Secure configuration | Limit user ability to override system settings. Follow OWASP API8:2023 guidelines. |
| 7 | Tokenization and redaction | Use pattern-matching redaction to preprocess sensitive information before model interaction. |

## Example Attack Scenarios

1. **Unintentional data exposure** — Users receive responses containing others' personal data due to inadequate sanitization.
2. **Targeted prompt injection** — Attackers bypass filters to extract sensitive information through manipulated inputs.
3. **Training data leak** — Negligent inclusion of sensitive information in training datasets leads to disclosure.

## AISVS Controls

| AISVS Section | Control | Key Requirements |
|---------------|---------|-----------------|
| C7.3 Output Safety & Privacy Filtering | Scan and redact PII, block confidential data in outputs | 7.3.2, 7.3.3 |
| C5.4 Output Filtering & DLP | Post-inference filtering, validate citations against entitlements, output format restrictions | 5.4.1, 5.4.2, 5.4.3 |
| C11.1 Anonymization & Data Minimization | Remove/hash identifiers, automated audits for k-anonymity | 11.1.1, 11.1.2 |
| C11.2 Right-to-be-Forgotten | Deletion propagation across datasets/checkpoints, machine-unlearning routines | 11.2.1, 11.2.2 |
| C11.3 Differential-Privacy Safeguards | Privacy-loss dashboards, black-box privacy audits | 11.3.1, 11.3.2 |
| C10.3 Membership-Inference Mitigation | Entropy regularization, differentially-private optimization | 10.3.1, 10.3.2, 10.3.3 |
| C10.4 Model-Inversion Resistance | Attribute masking, query-rate limits, privacy-preserving noise | 10.4.1, 10.4.2, 10.4.3 |

## Related Frameworks

- AML.T0024.000 — Infer Training Data Membership (MITRE ATLAS)
- AML.T0024.001 — Invert ML Model (MITRE ATLAS)
- AML.T0024.002 — Extract ML Model (MITRE ATLAS)

## References

- [OWASP Top 10 for LLM Applications](https://genai.owasp.org)
- [ChatGPT Spit Out Sensitive Data When Told to Repeat 'Poem' Forever — Wired](https://www.wired.com/story/chatgpt-poem-forever-security-roundup/)
- [Lessons Learned from ChatGPT's Samsung Leak — Cybernews](https://cybernews.com/security/chatgpt-samsung-leak-explained-lessons/)
## LLM03 Supply Chain

# LLM03:2025 Supply Chain

## Description

LLM supply chains face vulnerabilities affecting training data integrity, models, and deployment platforms. Risks include biased outputs, security breaches, and system failures. Unlike traditional software vulnerabilities, ML risks extend to third-party pre-trained models and datasets that can be manipulated through tampering or poisoning. The emergence of open-access LLMs, fine-tuning methods (LoRA, PEFT), and on-device LLMs have expanded the attack surface significantly.

## Common Examples

1. **Vulnerable third-party packages** — Outdated or deprecated components exploitable during model development or fine-tuning
2. **Licensing risks** — Diverse software and dataset licenses create legal compliance challenges
3. **Outdated or deprecated models** — Unmaintained models lead to unresolved security issues
4. **Vulnerable pre-trained models** — Models are binary black boxes; static inspection offers little security assurance
5. **Weak model provenance** — Limited guarantees about model origins; supplier accounts can be compromised
6. **Vulnerable LoRA adapters** — Malicious adapters can compromise base model integrity when merged
7. **Exploited collaborative development** — Shared environments for model merging and conversion can introduce vulnerabilities
8. **On-device LLM vulnerabilities** — Compromised manufacturing, device OS exploits, and app reverse-engineering
9. **Unclear terms and privacy policies** — Ambiguous data handling practices expose sensitive training data

## Prevention and Mitigation

| # | Strategy | Description |
|---|----------|-------------|
| 1 | Vet data sources | Thoroughly vet data sources and suppliers; regularly audit their security posture and terms. |
| 2 | Vulnerability scanning | Apply scanning and patching controls per OWASP A06:2021. |
| 3 | AI red teaming | Conduct comprehensive red teaming when selecting third-party models. |
| 4 | SBOM | Maintain Software Bill of Materials with signed components to detect tampering. |
| 5 | License inventory | Establish licensing inventories using BOMs with automated monitoring. |
| 6 | Verify provenance | Use models from verifiable sources with integrity checks via signing and file hashes. |
| 7 | Monitor collaboration | Monitor collaborative development environments using automated scanning. |
| 8 | Anomaly detection | Deploy adversarial robustness tests to identify tampering and poisoning. |
| 9 | Patching policies | Ensure reliance on maintained API and model versions. |
| 10 | Encrypt edge models | Encrypt edge-deployed models with integrity checks and vendor attestation. |

## Example Attack Scenarios

1. **PoisonGPT** — Attackers bypass Hugging Face safety features by directly modifying model parameters to spread misinformation.
2. **Fine-tuning for hidden triggers** — Models fine-tuned to remove safety features while scoring well on benchmarks.
3. **Compromised LoRA suppliers** — Malicious adapters merged via model merge on Hugging Face compromise integrated systems.
4. **LeftOvers (CVE-2023-4969)** — Exploitation of leaked GPU local memory to recover sensitive data from production servers.
5. **Dataset poisoning** — Attackers poison public datasets creating backdoors favoring specific companies.

## AISVS Controls

| AISVS Section | Control | Key Requirements |
|---------------|---------|-----------------|
| C6.1 Pretrained Model Vetting | Signed provenance records, automated scanning, license documentation, quarantine high-risk models | 6.1.1, 6.1.2, 6.1.3, 6.1.4, 6.1.5 |
| C6.2 Framework & Library Scanning | CI dependency scanners, block critical vulns, static analysis on forks | 6.2.1, 6.2.2, 6.2.3 |
| C6.3 Dependency Pinning | Version pinning via lockfiles, immutable digests, alerts for unmaintained deps | 6.3.1, 6.3.2, 6.3.3 |
| C6.4 Trusted Source Enforcement | Approved sources only, cryptographic signature validation, egress controls | 6.4.1, 6.4.2, 6.4.3 |
| C6.7 AI BOM | Publish AI BOM with datasets/weights/licenses, automated generation, completeness checks | 6.7.1, 6.7.2, 6.7.3 |
| C3.1 Model Authorization & Integrity | Model registry with MBOM/AIBOM, cryptographic signing, lineage tracking | 3.1.1, 3.1.2, 3.1.3, 3.1.4 |
| C6.6 Supply Chain Attack Monitoring | Incident response playbooks, centralized audit-log monitoring, threat intelligence | 6.6.1, 6.6.2, 6.6.3 |

## Related Frameworks

- AML.T0010 — ML Supply Chain Compromise (MITRE ATLAS)

## References

- [OWASP Top 10 for LLM Applications](https://genai.owasp.org)
- [PoisonGPT: How we hid a lobotomized LLM on Hugging Face — Mithril Security](https://blog.mithrilsecurity.io/poisongpt-how-we-hid-a-lobotomized-llm-on-hugging-face-to-spread-fake-news/)
- [Hijacking Safetensors Conversion on Hugging Face](https://hiddenlayer.com/research/silent-sabotage/)
## LLM04 Data and Model Poisoning

# LLM04:2025 Data and Model Poisoning

## Description

Data poisoning involves manipulating training data across pre-training, fine-tuning, embedding, and transfer learning stages to introduce vulnerabilities, backdoors, or biases. This integrity attack compromises model security, performance, and ethical behavior. External data sources pose particular risks, and distributed models may contain malware through malicious serialization techniques. Poisoning can implement backdoors that remain dormant until triggered, effectively creating "sleeper agent" models.

## Common Examples

1. **Split-view / frontrunning poisoning** — Malicious actors introduce harmful data using techniques that achieve biased outputs
2. **Direct content injection** — Harmful content injected during training compromises output quality
3. **User-contributed sensitive data** — Users unknowingly introduce sensitive or proprietary information during interactions
4. **Unverified training data** — Insufficient vetting increases risks of biased or erroneous outputs
5. **Insufficient resource restrictions** — Unrestricted data access allows ingestion of unsafe data

## Prevention and Mitigation

| # | Strategy | Description |
|---|----------|-------------|
| 1 | Track data origins | Use OWASP CycloneDX or ML-BOM tools for provenance tracking. |
| 2 | Vet data vendors | Rigorously vet vendors and validate outputs against trusted sources. |
| 3 | Sandboxing | Implement strict sandboxing and anomaly detection to filter adversarial data. |
| 4 | Targeted fine-tuning | Tailor models through specific fine-tuning datasets for defined objectives. |
| 5 | Infrastructure controls | Prevent unintended data source access. |
| 6 | Data version control | Use DVC to track dataset changes and detect manipulation. |
| 7 | Vector database separation | Store user-supplied information in vector databases for adjustment without full retraining. |
| 8 | Red team campaigns | Conduct adversarial testing, including federated learning approaches. |
| 9 | Monitor training loss | Watch for poisoning signs using thresholds for anomaly detection. |
| 10 | RAG grounding | Integrate RAG and grounding techniques during inference to reduce risks. |

## Example Attack Scenarios

1. **Training data manipulation** — Attackers manipulate training data to bias model outputs and spread misinformation.
2. **Toxic data propagation** — Unfiltered toxic data produces harmful outputs that propagate dangerous information.
3. **Falsified training documents** — Malicious actors introduce falsified documents, causing inaccurate model outputs.
4. **Backdoor triggers** — Poisoning techniques embed triggers enabling authentication bypass, data exfiltration, or hidden command execution.

## AISVS Controls

| AISVS Section | Control | Key Requirements |
|---------------|---------|-----------------|
| C1.1 Training Data Provenance | Maintain inventory with origin/license, exclude unnecessary PII, approval workflow, watermarking | 1.1.1, 1.1.2, 1.1.3, 1.1.4 |
| C1.2 Training Data Security | Access controls, audit logging, encryption, cryptographic integrity verification | 1.2.1, 1.2.2, 1.2.4, 1.2.5, 1.2.7 |
| C1.4 Quality & Security Assurance | Automated validation, poisoning detection, confidence thresholds, adversarial defenses, label skew detection | 1.4.1, 1.4.2, 1.4.3, 1.4.4, 1.4.5 |
| C1.5 Data Lineage & Traceability | Reconstruct lineage, immutable records, track synthetic data | 1.5.1, 1.5.2, 1.5.3 |
| C10.6 Poisoned-Data Detection | Anomaly detector before inference, threshold tuning, soft-blocking, stress-testing | 10.6.1, 10.6.2, 10.6.3, 10.6.4 |
| C3.4 Secure Development Practices | Isolated training environments, validated data with chain of custody | 3.4.3, 3.4.4 |

## Related Frameworks

- AML.T0018 — Backdoor ML Model (MITRE ATLAS)
- ML07:2023 — Transfer Learning Attack (OWASP ML Security Top 10)

## References

- [OWASP Top 10 for LLM Applications](https://genai.owasp.org)
- [Sleeper Agents: Training Deceptive LLMs that Persist Through Safety Training — Anthropic](https://arxiv.org/abs/2401.05566)
- [Poisoning Language Models During Instruction Tuning](https://arxiv.org/abs/2305.00944)
## LLM05 Improper Output Handling

# LLM05:2025 Improper Output Handling

## Description

This vulnerability involves inadequate validation, sanitization, and handling of LLM-generated outputs before downstream system integration. Since LLM-generated content can be controlled by prompt input, this behavior is similar to providing users indirect access to additional functionality. Successful exploitation can enable XSS, CSRF, SSRF, privilege escalation, and remote code execution.

## Common Examples

1. **Shell execution** — Direct LLM output passed to system command functions, enabling remote code execution
2. **Web injection** — JavaScript or Markdown generated by LLM interpreted by browsers, causing XSS
3. **SQL injection** — Unparameterized LLM-generated SQL queries executed against databases
4. **Path traversal** — Unsanitized LLM output used in file path construction
5. **Phishing via email** — LLM-generated content in email templates without proper escaping

## Prevention and Mitigation

| # | Strategy | Description |
|---|----------|-------------|
| 1 | Zero-trust LLM output | Treat LLM outputs like untrusted user input with proper backend validation. |
| 2 | OWASP ASVS guidelines | Follow Application Security Verification Standard for effective input validation. |
| 3 | Output encoding | Encode model outputs to mitigate undesired code execution via JavaScript or Markdown. |
| 4 | Context-aware encoding | Apply encoding based on deployment context (HTML, SQL, shell, etc.). |
| 5 | Parameterized queries | Use prepared statements for all database operations with LLM-generated content. |
| 6 | Content Security Policy | Deploy strict CSP to prevent XSS from LLM-generated content. |
| 7 | Logging and monitoring | Establish robust logging to detect exploitation patterns in LLM outputs. |

## Example Attack Scenarios

1. **Administrative function abuse** — Chatbot extension passes unvalidated LLM responses to admin functions, causing denial of service.
2. **Data exfiltration via summarizer** — Website summarizer contains injected instructions to capture and transmit sensitive data.
3. **Database destruction** — Unreviewed SQL queries generated through chat interface result in database deletion.
4. **XSS via crafted prompts** — Crafted prompts generate unsanitized JavaScript payloads rendering as XSS in victim browsers.
5. **Malicious code generation** — Code generation introduces hallucinated packages with vulnerabilities.

## AISVS Controls

| AISVS Section | Control | Key Requirements |
|---------------|---------|-----------------|
| C7.1 Output Format Enforcement | Validate outputs against strict schema, use stop sequences/token limits, treat output as untrusted | 7.1.1, 7.1.2, 7.1.3, 7.1.4 |
| C7.3 Output Safety & Privacy Filtering | Block harmful content, scan and redact PII, block confidential data | 7.3.1, 7.3.2, 7.3.3 |
| C7.4 Output & Action Limiting | Per-user token limits, require confirmation for high-impact actions, max recursion depth | 7.4.1, 7.4.2, 7.4.3 |
| C9.3 Tool and Plugin Isolation | Validate tool outputs against strict schemas before downstream use | 9.3.4 |
| C2.4 Schema, Type & Length Validation | Define explicit input schemas, reject oversized inputs, enforce type checks | 2.4.1, 2.4.2, 2.4.3 |

## Related Frameworks

- CWE-79 — Cross-site Scripting (XSS)
- CWE-89 — SQL Injection
- CWE-78 — OS Command Injection

## References

- [OWASP Top 10 for LLM Applications](https://genai.owasp.org)
- [OWASP ASVS — Application Security Verification Standard](https://owasp.org/www-project-application-security-verification-standard/)
## LLM06 Excessive Agency

# LLM06:2025 Excessive Agency

## Description

LLM-based systems granted agency to invoke functions or extensions may suffer from excessive agency vulnerabilities. This occurs when damaging actions result from unexpected or manipulated LLM outputs, triggered by hallucination, prompt injection, or compromised agents. Root causes include excessive functionality, excessive permissions, and excessive autonomy. Impacts span confidentiality, integrity, and availability.

## Common Examples

**Excessive Functionality:**
1. LLM agents accessing extensions with unneeded capabilities beyond intended scope
2. Deprecated development plugins remaining accessible to agents
3. Extensions that run specific commands failing to prevent other commands from executing

**Excessive Permissions:**
4. Extensions possessing database permissions beyond operational needs (UPDATE/DELETE when only SELECT required)
5. Extensions connecting to document repositories with privileged accounts

**Excessive Autonomy:**
6. High-impact actions lacking independent verification or user approval before execution

## Prevention and Mitigation

| # | Strategy | Description |
|---|----------|-------------|
| 1 | Minimize extensions | Limit available extensions to essential functions only. |
| 2 | Limit functionality | Restrict extension functionality to minimum necessary operations. |
| 3 | Avoid open-ended extensions | Avoid unrestricted tools like generic shell command or URL fetch. |
| 4 | Minimize permissions | Restrict extension permissions to minimum required levels. |
| 5 | User-context execution | Execute extensions within individual user contexts with minimal privileges. |
| 6 | Human-in-the-loop | Implement approval for significant or destructive actions. |
| 7 | Downstream authorization | Enforce authorization in downstream systems rather than relying on LLM decisions. |
| 8 | Input/output sanitization | Sanitize inputs and outputs following OWASP ASVS standards. |
| 9 | Rate limiting | Monitor extension activity and implement rate-limiting for undesirable actions. |

## Example Attack Scenarios

1. **Email exfiltration** — A personal assistant app with mailbox access is exploited via malicious incoming email. Hidden instructions trick the LLM into scanning the inbox for sensitive information and forwarding it to the attacker.
2. **Tool chaining** — Individually safe tool calls are chained together to achieve a harmful outcome that no single tool would permit.

## AISVS Controls

| AISVS Section | Control | Key Requirements |
|---------------|---------|-----------------|
| C9.2 High-Impact Action Approval | Require human approval for privileged/irreversible actions, bind approvals to parameters, test rollback | 9.2.1, 9.2.2, 9.2.3 |
| C9.3 Tool and Plugin Isolation | Sandboxed execution, per-tool quotas, declared privileges, quarantine on violation | 9.3.1, 9.3.2, 9.3.3, 9.3.6 |
| C9.6 Authorization & Delegation | Fine-grained tool/parameter policies, integrity-protected delegation, time-bound scopes | 9.6.1, 9.6.2, 9.6.3 |
| C9.7 Intent Verification | Pre-execution constraint gates, explicit user intent confirmation, post-condition checks | 9.7.1, 9.7.2, 9.7.3 |
| C9.1 Execution Budgets | Per-execution budgets, cumulative resource counters, circuit breakers | 9.1.1, 9.1.2, 9.1.3 |
| C5.6 Autonomous Agent Authorization | Scoped capability tokens, high-risk capabilities disabled by default, session-bound tokens | 5.6.1, 5.6.2, 5.6.3, 5.6.4 |
| C7.4 Output & Action Limiting | Require confirmation for high-impact actions, max recursion depth and delegation limits | 7.4.2, 7.4.3 |
| C13.2 Human-in-the-Loop | High-risk decisions require human approval, risk thresholds with auto-triggers, escalation procedures | 13.2.1, 13.2.2, 13.2.4 |

## Related Frameworks

- CWE-250 — Execution with Unnecessary Privileges
- CWE-732 — Incorrect Permission Assignment for Critical Resource

## References

- [OWASP Top 10 for LLM Applications](https://genai.owasp.org)
- [Slack AI Data Exfil from Private Channels — PromptArmor](https://promptarmor.substack.com/p/data-exfiltration-from-slack-ai-via)
- [Embrace the Red: Confused Deputy Problem](https://embracethered.com/blog/posts/2023/chatgpt-cross-plugin-request-forgery-and-prompt-injection/)
## LLM07 System Prompt Leakage

# LLM07:2025 System Prompt Leakage

## Description

System prompt leakage occurs when instructions designed to guide LLM behavior inadvertently contain sensitive information. The system prompt should not be considered a secret, nor should it be used as a security control. The actual vulnerability lies not in disclosure itself, but in underlying weaknesses: storing sensitive data in prompts, bypassing authorization mechanisms, or delegating critical security functions to the LLM.

## Common Examples

1. **Exposure of sensitive functionality** — Revealing system architecture details, API keys, or database credentials through system prompts
2. **Exposure of internal rules** — Leaking business logic like transaction limits enables circumvention of security controls
3. **Revealing of filtering criteria** — Disclosing content filtering mechanisms shows attackers what restrictions exist and how to bypass them
4. **Disclosure of permissions and user roles** — Revealed privilege structures enable escalation attacks

## Prevention and Mitigation

| # | Strategy | Description |
|---|----------|-------------|
| 1 | Separate sensitive data | Keep API keys, credentials, and permission structures external to system prompts. |
| 2 | Don't rely on prompt secrecy | Use external systems for content filtering and harmful output detection. |
| 3 | Implement guardrails | Create independent inspection systems rather than relying solely on model training. |
| 4 | Enforce controls independently | Authorization and privilege separation must occur outside the LLM through deterministic, auditable mechanisms. |

## Example Attack Scenarios

1. **Credential extraction** — Attackers extract system prompt credentials and reuse them to access backend systems.
2. **Rule extraction and bypass** — Attackers extract prohibition rules, then use prompt injection to bypass restrictions and enable code execution.

## AISVS Controls

| AISVS Section | Control | Key Requirements |
|---------------|---------|-----------------|
| C2.1 Prompt Injection Defense | Enforce instruction hierarchy where system/developer messages override user instructions | 2.1.2 |
| C5.4 Output Filtering & DLP | Post-inference filtering redacts PII and classified data, validate citations, output format restrictions | 5.4.1, 5.4.2, 5.4.3 |
| C4.4 Secrets Management | Deploy secrets at runtime; never embed in code, configs, or prompts | 4.4.3 |
| C7.5 Explainability & Transparency | Sanitize explanations to remove system prompts and backend data | 7.5.2 |
| C5.2 Authorization & Policy | Access controls with default-deny, real-time alerts for unauthorized access | 5.2.1, 5.2.5 |

## Related Frameworks

- AML.T0051.000 — LLM Prompt Injection: Direct / Meta Prompt Extraction (MITRE ATLAS)

## References

- [OWASP Top 10 for LLM Applications](https://genai.owasp.org)
- [chatgpt_system_prompt — LouisShark (GitHub)](https://github.com/LouisShark/chatgpt_system_prompt)
- [leaked-system-prompts — Jujumilk3 (GitHub)](https://github.com/jujumilk3/leaked-system-prompts)
## LLM08 Vector and Embedding Weaknesses

# LLM08:2025 Vector and Embedding Weaknesses

## Description

This vulnerability category addresses risks in systems using Retrieval Augmented Generation (RAG) with LLMs. RAG combines pre-trained language models with external knowledge sources to enhance response quality and contextual relevance. Weaknesses in how vectors and embeddings are generated, stored, and retrieved can be exploited to inject harmful content, manipulate model outputs, or access sensitive information.

## Common Examples

1. **Unauthorized access and data leakage** — Insufficient access controls expose sensitive embeddings. Personal data, proprietary information, or copyrighted material disclosed without proper authorization.
2. **Cross-context information leaks** — In multi-tenant environments, risk of context leakage between users or queries. Data from multiple sources may contradict each other.
3. **Embedding inversion attacks** — Attackers invert embeddings to recover significant amounts of source information, compromising data confidentiality.
4. **Data poisoning attacks** — Malicious or unintentional poisoned data from insiders, prompts, or unverified sources manipulate model outputs.
5. **Behavior alteration** — RAG can inadvertently reduce qualities like emotional intelligence while improving factual accuracy.

## Prevention and Mitigation

| # | Strategy | Description |
|---|----------|-------------|
| 1 | Permission-aware vector stores | Implement fine-grained controls with strict logical and access partitioning to prevent cross-user access. |
| 2 | Data validation | Establish robust validation pipelines, regularly audit knowledge base integrity, accept data only from trusted sources. |
| 3 | Data classification | Thoroughly review combined datasets, tag and classify information to control access levels. |
| 4 | Monitoring and logging | Maintain detailed immutable logs of retrieval activities to detect suspicious behavior. |

## Example Attack Scenarios

1. **Data poisoning** — Attacker embeds hidden instructions (white text on white background) in a resume submitted to a RAG-based job screening system, causing it to recommend an unqualified candidate.
2. **Access control failure** — In multi-tenant environments sharing a vector database, embeddings from one user group are retrieved for another group's queries, leaking sensitive information.
3. **Behavior alteration** — After RAG implementation, an LLM's response to an emotional query becomes purely factual, losing empathetic tone despite remaining accurate.

## AISVS Controls

| AISVS Section | Control | Key Requirements |
|---------------|---------|-----------------|
| C8.1 Access Controls on RAG Indices | Namespace/collection scope controls with default-deny, scoped API claims, cross-scope detection | 8.1.1, 8.1.2, 8.1.3 |
| C8.2 Embedding Sanitization | Detect sensitive data before embedding, reject malformed/poisoning inputs | 8.2.1, 8.2.2 |
| C8.3 Memory Expiry & Deletion | Retention times on stored vectors, purge within defined timeframes, ensure unrecoverability | 8.3.1, 8.3.2, 8.3.3 |
| C8.4 Embedding Inversion Prevention | Protect sensitive collections via encryption, privacy/utility regression tests | 8.4.1, 8.4.2 |
| C8.5 User-Specific Memory Scope | Scope constraints in vector engine, prevent cross-scope collisions, adversarial multi-tenant tests | 8.5.1, 8.5.2, 8.5.3, 8.5.4, 8.5.5 |
| C5.5 Multi-Tenant Isolation | Default-deny cross-tenant policies, authenticated tenant IDs, namespace segregation, per-tenant encryption | 5.5.1, 5.5.2, 5.5.3, 5.5.4 |

## Related Frameworks

- AML.T0043 — Craft Adversarial Data (MITRE ATLAS)

## References

- [OWASP Top 10 for LLM Applications](https://genai.owasp.org)
- [Information Leakage in Embedding Models](https://arxiv.org/abs/2004.00053)
- [ConfusedPilot: Confused Deputy Risks in RAG-based LLMs](https://confusedpilot.info)
## LLM09 Misinformation

# LLM09:2025 Misinformation

## Description

This vulnerability addresses how LLMs generate false or misleading information that appears credible, potentially causing security breaches, reputational damage, and legal liability. Key causes include hallucination (models fabricate content by filling training data gaps using statistical patterns) and overreliance (users place excessive trust in LLM outputs without verification).

## Common Examples

1. **Factual inaccuracies** — Air Canada's chatbot provided incorrect travel information, resulting in successful litigation against the airline.
2. **Unsupported claims** — ChatGPT generated fictitious legal cases that were cited in actual court proceedings.
3. **Misrepresentation of expertise** — Chatbots misrepresent complexity regarding health matters, falsely suggesting legitimate debate around unproven treatments.
4. **Unsafe code generation** — LLMs recommend non-existent or insecure code libraries, introducing vulnerabilities when developers trust suggestions without scrutiny.

## Prevention and Mitigation

| # | Strategy | Description |
|---|----------|-------------|
| 1 | Retrieval-Augmented Generation | Retrieve verified information from trusted external databases to reduce hallucinations. |
| 2 | Model fine-tuning | Apply techniques like parameter-efficient tuning and chain-of-thought prompting. |
| 3 | Cross-verification | Implement fact-checking processes with trained human reviewers. |
| 4 | Automatic validation | Validate outputs programmatically in high-stakes environments. |
| 5 | Risk communication | Clearly convey limitations and misinformation potential to users. |
| 6 | Secure coding practices | Verify all LLM-suggested packages and libraries exist and are trustworthy before use. |
| 7 | UI design | Label AI-generated content, integrate filters, specify field-of-use limitations. |
| 8 | Training and education | Educate users on LLM limitations and importance of independent verification. |

## Example Attack Scenarios

1. **Package hallucination attack** — Attackers identify hallucinated package names suggested by coding assistants, then publish malicious packages using those names. Developers unknowingly integrate compromised code.
2. **Medical chatbot liability** — A company deploys a diagnosis chatbot without ensuring accuracy. Poor guidance causes patient harm, leading to successful litigation.

## AISVS Controls

| AISVS Section | Control | Key Requirements |
|---------------|---------|-----------------|
| C7.2 Hallucination Detection | Calculate confidence scores, block low-confidence responses, log hallucination events | 7.2.1, 7.2.2, 7.2.3 |
| C7.5 Explainability & Transparency | Display confidence scores and reasoning summaries, sanitize explanations | 7.5.1, 7.5.2 |
| C10.1 Model Alignment & Safety | Version-controlled alignment test-suite, refusal guard-rails, harmful-content metrics | 10.1.1, 10.1.2, 10.1.3 |
| C13.4 Explainable-AI Techniques | Human-readable explanations, explanation quality validation, feature importance scores | 13.4.1, 13.4.2, 13.4.3 |
| C13.6 Uncertainty Quantification | Confidence scores with outputs, uncertainty triggers human review, calibrated methods | 13.6.1, 13.6.2, 13.6.3, 13.6.4 |

## Related Frameworks

- CWE-1357 — Reliance on Insufficiently Trustworthy Component

## References

- [OWASP Top 10 for LLM Applications](https://genai.owasp.org)
- [AI Package Hallucinations — Lasso Security](https://www.lasso.security/blog/ai-package-hallucinations)
- [Air Canada Chatbot Misinformation — BBC](https://www.bbc.com/travel/article/20240222-air-canada-chatbot-misinformation-]
## LLM10 Unbounded Consumption

# LLM10:2025 Unbounded Consumption

## Description

This vulnerability describes how LLM applications permit excessive, uncontrolled inferences, creating risks including denial of service, financial losses, model theft, and degraded performance. The computational intensity of LLMs, particularly in cloud settings, makes them susceptible to resource exploitation.

## Common Examples

1. **Variable-length input flood** — Overwhelming systems with numerous inputs of varying sizes to deplete resources
2. **Denial of wallet (DoW)** — Initiating high volumes of operations to exploit cost-per-use pricing models
3. **Continuous input overflow** — Sending inputs exceeding context windows causing excessive computation
4. **Resource-intensive queries** — Submitting demanding queries with complex language patterns
5. **Model extraction via API** — Using carefully crafted inputs to replicate or create shadow models
6. **Functional model replication** — Generating synthetic training data to fine-tune equivalent models
7. **Side-channel attacks** — Exploiting input filtering to harvest model weights and architecture details

## Prevention and Mitigation

| # | Strategy | Description |
|---|----------|-------------|
| 1 | Input validation | Implement strict input validation with reasonable size limits. |
| 2 | Restrict logits | Limit exposure of logits and logprobs in API responses. |
| 3 | Rate limiting | Apply rate limiting and per-user quotas on requests. |
| 4 | Resource management | Monitor and manage resource allocation dynamically. |
| 5 | Timeouts | Set timeouts and throttle resource-intensive operations. |
| 6 | Sandboxing | Restrict LLM access to external resources. |
| 7 | Monitoring | Deploy comprehensive logging, monitoring, and anomaly detection. |
| 8 | Watermarking | Implement watermarking frameworks for unauthorized use detection. |
| 9 | Graceful degradation | Design systems to degrade gracefully under heavy load. |
| 10 | Access controls | Enforce strong RBAC and least privilege principles. |
| 11 | Model inventory | Maintain centralized ML model inventory with governance workflows. |

## Example Attack Scenarios

1. **Uncontrolled input size** — Large inputs cause memory exhaustion and system crashes.
2. **Repeated requests** — High-volume API requests deplete computational resources.
3. **Denial of wallet** — Excessive operations exploit pay-per-use pricing, causing unexpected costs.
4. **Model replication** — Attacker uses API to generate synthetic training data, cloning the model's capabilities.

## AISVS Controls

| AISVS Section | Control | Key Requirements |
|---------------|---------|-----------------|
| C2.6 Rate Limiting & Abuse Prevention | Per-user/IP/API-key rate limits, burst/sustained tuning, anomalous pattern blocking | 2.6.1, 2.6.2, 2.6.3, 2.6.4 |
| C4.6 Resource Management | Workload resource quotas, automated protections on threshold breach | 4.6.1, 4.6.2 |
| C9.1 Execution Budgets | Per-execution budgets, cumulative counters, circuit breakers on violations | 9.1.1, 9.1.2, 9.1.3 |
| C10.5 Model-Extraction Defense | Rate limits, query-entropy detection, watermarks, extraction alerts with incident response | 10.5.1, 10.5.2, 10.5.3, 10.5.5 |
| C13.1 Kill-Switch & Override | Manual kill-switch, authorized override controls, rollback procedures | 13.1.1, 13.1.2, 13.1.3 |

## Related Frameworks

- CWE-400 — Uncontrolled Resource Consumption
- CWE-770 — Allocation of Resources Without Limits or Throttling

## References

- [OWASP Top 10 for LLM Applications](https://genai.owasp.org)
- [Stealing Part of a Production Language Model](https://arxiv.org/abs/2403.06634)
- [Sponge Examples: Energy-Latency Attacks on Neural Networks](https://arxiv.org/abs/2006.03463)
