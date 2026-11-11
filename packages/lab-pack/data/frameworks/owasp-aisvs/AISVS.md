# AISVS reference

AI Application Security Verification Standard extracts from the OWASP Secure Agent Playbook.

Publisher: OWASP Secure Agent Playbook. Edition: AISVS.
Source tree: https://github.com/OWASP/secure-agent-playbook/tree/65d4efd2cd0b081d52101e9708792b944e4ddebb/data/aisvs (89 sections).

## C1.1 Training Data Provenance

# C1.1 Training Data Provenance

Maintain a verifiable inventory of all datasets, accept only trusted sources, and log every change for auditability.

| # | Description | Level | Role |
| :---: | :--- | :---: | :---: |
| **1.1.1** | **Verify that** an up-to-date inventory of every training-data source (origin, responsible party, license, collection method, intended use constraints, and processing history) is maintained. | 1 | D/V |
| **1.1.2** | **Verify that** training data processes exclude unnecessary features, attributes, or fields (e.g., unused metadata, sensitive PII, leaked test data). | 1 | D/V |
| **1.1.3** | **Verify that** all dataset changes are subject to a logged approval workflow. | 1 | D/V |
| **1.1.4** | **Verify that** datasets or subsets are watermarked or fingerprinted where feasible. | 3 | D/V |
## C1.2 Training Data Security & Integrity

# C1.2 Training Data Security & Integrity

Restrict access to training data, encrypt it at rest and in transit, and validate its integrity to prevent tampering, theft, or data poisoning.

| # | Description | Level | Role |
| :---: | :--- | :---: | :---: |
| **1.2.1** | **Verify that** access controls protect training data storage and pipelines. | 1 | D/V |
| **1.2.2** | **Verify that** all access to training data is logged, including user, time, and action. | 1 | D/V |
| **1.2.3** | **Verify that** training datasets are encrypted in transit and at rest, using current recommended cryptographic algorithms and key management practices. | 1 | D/V |
| **1.2.4** | **Verify that** cryptographic hashes or digital signatures are used to ensure data integrity during training data storage and transfer. | 2 | D/V |
| **1.2.5** | **Verify that** automated integrity monitoring is applied to guard against unauthorized modifications or corruption of training data. | 2 | D/V |
| **1.2.6** | **Verify that** obsolete training data is securely purged or anonymized. | 1 | D/V |
| **1.2.7** | **Verify that** all training dataset versions are uniquely identified, stored immutably, and auditable to support rollback and forensic analysis. | 3 | D/V |
## C1.3 Data Labeling and Annotation Security

# C1.3 Data Labeling and Annotation Security

Ensure labeling and annotation processes are access-controlled, auditable, and protect sensitive information.

| # | Description | Level | Role |
| :---: | :--- | :---: | :---: |
| **1.3.1** | **Verify that** labeling interfaces and platforms enforce access controls and maintain audit logs of all labeling activities. | 1 | D/V |
| **1.3.2** | **Verify that** cryptographic hashes or digital signatures are applied to labeling artifacts and annotation data to ensure their integrity and authenticity. | 2 | D/V |
| **1.3.3** | **Verify that** labeling audit logs are tamper-evident and that labeling platforms protect against unauthorized modifications. | 2 | D/V |
| **1.3.4** | **Verify that** sensitive information in labels is redacted, anonymized, or encrypted using appropriate granularity at rest and in transit. | 2 | D/V |
## C1.4 Training Data Quality and Security Assurance

# C1.4 Training Data Quality and Security Assurance

Combine automated validation, manual spot-checks, and logged remediation to guarantee dataset reliability.

| # | Description | Level | Role |
| :---: | :--- | :---: | :---: |
| **1.4.1** | **Verify that** automated tests catch format errors and nulls on every ingest or significant data transformation. | 1 | D |
| **1.4.2** | **Verify that** training and fine-tuning pipelines implement data integrity validation and poisoning detection techniques (e.g., statistical analysis, outlier detection, embedding analysis) to identify potential data poisoning or unintentional corruption in training data. | 2 | D/V |
| **1.4.3** | **Verify that** automatically generated labels (e.g., via models or weak supervision) are subject to confidence thresholds and consistency checks to detect misleading or low-confidence labels. | 2 | D/V |
| **1.4.4** | **Verify that** appropriate defenses, such as adversarial training, data augmentation with perturbed inputs, or robust optimization techniques, are implemented and tuned for relevant models based on risk assessment. | 3 | D/V |
| **1.4.5** | **Verify that** automated tests catch label skews on every ingest or significant data transformation. | 2 | D |
## C1.5 Data Lineage and Traceability

# C1.5 Data Lineage and Traceability

Track the full journey of each dataset from source to model input for auditability and incident response.

| # | Description | Level | Role |
| :---: | :--- | :---: | :---: |
| **1.5.1** | **Verify that** the lineage of each dataset and its components, including all transformations, augmentations, and merges, is recorded and can be reconstructed. | 1 | D/V |
| **1.5.2** | **Verify that** lineage records are immutable, securely stored, and accessible for audits. | 2 | D/V |
| **1.5.3** | **Verify that** lineage tracking covers synthetic data generated via augmentation, synthesis, or privacy-preserving techniques and that all synthetic data is clearly labeled and distinguishable from real data throughout the pipeline. | 2 | D/V |
## C10.1 Model Alignment & Safety

## 10.1 Model Alignment & Safety

Guard against harmful or policy-breaking outputs.

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **10.1.1** | **Verify that** an alignment test-suite (red-team prompts, jailbreak probes, disallowed content) is version-controlled and run on every model release. | 1 | D/V |
| **10.1.2** | **Verify that** refusal and safe-completion guard-rails are enforced. | 1 | D |
| **10.1.3** | **Verify that** an automated evaluator measures harmful-content rate and flags regressions beyond a set threshold. | 2 | D/V |
| **10.1.4** | **Verify that** counter-jailbreak training is documented and reproducible. | 2 | D |
| **10.1.5** | **Verify that** formal policy-compliance proofs or certified monitoring cover critical domains. | 3 | V |

---
## C10.2

## 10.2 Adversarial-Example Hardening

Increase resilience to manipulated inputs. Robust adversarial-training and benchmark scoring are the current best practice.

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **10.2.1** | **Verify that** project repositories include adversarial-training configurations with reproducible seeds. | 1 | D |
| **10.2.2** | **Verify that** adversarial-example detection raises blocking alerts in production pipelines. | 2 | D/V |
| **10.2.4** | **Verify that** certified‐robustness proofs or interval-bound certificates cover at least the top critical classes. | 3 | V |
| **10.2.5** | **Verify that** regression tests use adaptive attacks to confirm no measurable robustness loss. | 3 | V |

---
## C10.3 Membership-Inference Mitigation

## 10.3 Membership-Inference Mitigation

Limit the ability to decide whether a record was in training data. Differential privacy and confidence-score masking remain the most effective known defenses.

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **10.3.1** | **Verify that** per-query entropy regularization or temperature-scaling reduces overconfident predictions. | 1 | D |
| **10.3.2** | **Verify that** training employs ε-bounded differentially-private optimization for sensitive datasets. | 2 | D |
| **10.3.3** | **Verify that** attack simulations (shadow-model or black-box) show attack AUC ≤ 0.60 on held-out data. | 2 | V |

---
## C10.4 Model-Inversion Resistance

## 10.4 Model-Inversion Resistance

Prevent reconstruction of private attributes. Recent surveys emphasize output truncation and DP guarantees as practical defenses.

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **10.4.1** | **Verify that** sensitive attributes are never directly output; where needed, use buckets or one-way transforms. | 1 | D |
| **10.4.2** | **Verify that** query-rate limits throttle repeated adaptive queries from the same principal. | 1 | D/V |
| **10.4.3** | **Verify that** the model is trained with privacy-preserving noise. | 2 | D |

---
## C10.5 Model-Extraction Defense

## 10.5 Model-Extraction Defense

Detect and deter unauthorized cloning. Watermarking and query-pattern analysis are recommended.

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **10.5.1** | **Verify that** inference gateways enforce global and per-API-key rate limits tuned to the model's memorization threshold. | 1 | D |
| **10.5.2** | **Verify that** query-entropy and input-plurality statistics feed an automated extraction detector. | 2 | D/V |
| **10.5.3** | **Verify that** fragile or probabilistic watermarks can be proved with p < 0.01 in ≤ 1 000 queries against a suspected clone. | 2 | V |
| **10.5.4** | **Verify that** watermark keys and trigger sets are stored in a hardware-security-module and rotated yearly. | 3 | D |
| **10.5.5** | **Verify that** extraction-alert events include offending queries and are integrated with incident-response playbooks. | 3 | V |

---
## C10.6 Inference-Time Poisoned-Data Detection

## 10.6 Inference-Time Poisoned-Data Detection

Identify and neutralize backdoored or poisoned inputs.

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **10.6.1** | **Verify that** inputs pass through an anomaly detector (e.g., STRIP, consistency-scoring) before model inference. | 1 | D |
| **10.6.2** | **Verify that** detector thresholds are tuned on clean/poisoned validation sets to achieve less that 5% false positives. | 1 | V |
| **10.6.3** | **Verify that** inputs flagged as poisoned trigger soft-blocking and human review workflows. | 2 | D |
| **10.6.4** | **Verify that** detectors are stress-tested with adaptive, triggerless backdoor attacks. | 2 | V |
| **10.6.5** | **Verify that** detection efficacy metrics are logged and periodically re-evaluated with fresh threat intel. | 3 | D |

---
## C10.7

## 10.7 Dynamic Security Policy Adaptation

Real-time security policy updates based on threat intelligence and behavioral analysis.

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **10.7.1** | **Verify that** security policies can be updated dynamically without agent restart while maintaining policy version integrity. | 1 | D/V |
| **10.7.2** | **Verify that** policy updates are cryptographically signed by authorized security personnel and validated before application. | 2 | D/V |
| **10.7.3** | **Verify that** dynamic policy changes are logged with full audit trails including justification, approval chains, and rollback procedures. | 2 | D/V |
| **10.7.4** | **Verify that** adaptive security mechanisms adjust threat detection sensitivity based on risk context and behavioral patterns. | 3 | D/V |
| **10.7.5** | **Verify that** policy adaptation decisions are explainable and include evidence trails for security team review. | 3 | D/V |

---
## C10.8

## 10.8 Reflection-Based Security Analysis

Security validation through agent self-reflection and meta-cognitive analysis.

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **10.8.1** | **Verify that** agent reflection mechanisms include security-focused self-assessment of decisions and actions. | 1 | D/V |
| **10.8.2** | **Verify that** reflection outputs are validated to prevent manipulation of self-assessment mechanisms by adversarial inputs. | 2 | D/V |
| **10.8.3** | **Verify that** meta-cognitive security analysis identifies potential bias, manipulation, or compromise in agent reasoning processes. | 2 | D/V |
| **10.8.4** | **Verify that** reflection-based security warnings trigger enhanced monitoring and potential human intervention workflows. | 3 | D/V |
| **10.8.5** | **Verify that** continuous learning from security reflections improves threat detection without degrading legitimate functionality. | 3 | D/V |

---
## C10.9

## 10.9 Evolution & Self-Improvement Security

Security controls for agent systems capable of self-modification and evolution.

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **10.9.1** | **Verify that** self-modification capabilities are restricted to designated safe areas with formal verification boundaries. | 1 | D/V |
| **10.9.2** | **Verify that** evolution proposals undergo security impact assessment before implementation. | 2 | D/V |
| **10.9.3** | **Verify that** self-improvement mechanisms include rollback capabilities with integrity verification. | 2 | D/V |
| **10.9.4** | **Verify that** meta-learning security prevents adversarial manipulation of improvement algorithms. | 3 | D/V |
| **10.9.5** | **Verify that** recursive self-improvement is bounded by formal safety constraints with mathematical proofs of convergence. | 3 | D/V |

---

### References
## C11.1 Anonymization & Data Minimization

## 11.1 Anonymization & Data Minimization

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **11.1.1** | **Verify that** direct and quasi-identifiers are removed, hashed. | 1 | D/V |
| **11.1.2** | **Verify that** automated audits measure k-anonymity/l-diversity and alert when thresholds drop below policy. | 2 | D/V |
| **11.1.3** | **Verify that** model feature-importance reports prove no identifier leakage beyond ε = 0.01 mutual information. | 2 | V |
| **11.1.4** | **Verify that** formal proofs or synthetic-data certification show re-identification risk ≤ 0.05 even under linkage attacks. | 3 | V |

---
## C11.2 Right-to-be-Forgotten & Deletion Enforcement

## 11.2 Right-to-be-Forgotten & Deletion Enforcement

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **11.2.1** | **Verify that** data-subject deletion requests propagate to raw datasets, checkpoints, embeddings, logs, and backups within service level agreements of less than 30 days. | 1 | D/V |
| **11.2.2** | **Verify that** "machine-unlearning" routines physically re-train or approximate removal using certified unlearning algorithms. | 2 | D |
| **11.2.3** | **Verify that** shadow-model evaluation proves forgotten records influence less than 1% of outputs after unlearning. | 2 | V |
| **11.2.4** | **Verify that** deletion events are immutably logged and auditable for regulators. | 3 | V

---
## C11.3 Differential-Privacy Safeguards

## 11.3 Differential-Privacy Safeguards

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **11.3.1** | **Verify that** privacy-loss accounting dashboards alert when cumulative ε exceeds policy thresholds. | 2 | D/V |
| **11.3.2** | **Verify that** black-box privacy audits estimate ε̂ within 10% of declared value. | 2 | V |
| **11.3.3** | **Verify that** formal proofs cover all post-training fine-tunes and embeddings. | 3 | V |

---
## C11.4

## 11.4 Purpose-Limitation & Scope-Creep Protection

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **11.4.1** | **Verify that** every dataset and model checkpoint carries a machine-readable purpose tag aligned to the original consent. | 1 | D |
| **11.4.2** | **Verify that** runtime monitors detect queries inconsistent with declared purpose and trigger soft refusal. | 1 | D/V |
| **11.4.3** | **Verify that** policy-as-code gates block redeployment of models to new domains without DPIA review. | 3 | D |
| **11.4.4** | **Verify that** formal traceability proofs show every personal data lifecycle remains within consented scope. | 3 | V |

---
## C11.5

## 11.5 Consent Management & Lawful-Basis Tracking

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **11.5.1** | **Verify that** a Consent-Management Platform (CMP) records opt-in status, purpose, and retention period per data-subject. | 1 | D/V |
| **11.5.2** | **Verify that** APIs expose consent tokens; models must validate token scope before inference. | 2 | D |
| **11.5.3** | **Verify that** denied or withdrawn consent halts processing pipelines within 24 hours. | 2 | D/V |

---
## C11.6

## 11.6 Federated Learning with Privacy Controls

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **11.6.1** | **Verify that** client updates employ local differential privacy noise addition before aggregation. | 1 | D |
| **11.6.2** | **Verify that** training metrics are differentially private and never reveal single-client loss. | 2 | D/V |
| **11.6.3** | **Verify that** poisoning-resistant aggregation (e.g., Krum/Trimmed-Mean) is enabled. | 2 | V |
| **11.6.4** | **Verify that** formal proofs demonstrate overall ε budget with less than 5 utility loss. | 3 | V |

---

### References
## C12.1

## C12.1 Request & Response Logging

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **12.1.1** | **Verify that** all user prompts and model responses are logged with appropriate metadata (e.g. timestamp, user ID, session ID, model version). | 1   | D/V |
| **12.1.2** | **Verify that** logs are stored in secure, access-controlled repositories with appropriate retention policies and backup procedures. | 1   | D/V |
| **12.1.3** | **Verify that** log storage systems implement encryption at rest and in transit to protect sensitive information contained in logs. | 1   | D/V |
| **12.1.4** | **Verify that** sensitive data in prompts and outputs is automatically redacted or masked before logging, with configurable redaction rules for PII, credentials, and proprietary information. | 1   | D/V |
| **12.1.5** | **Verify that** policy decisions and safety filtering actions are logged with sufficient detail to enable audit and debugging of content moderation systems. | 2   | D/V |
| **12.1.6** | **Verify that** log integrity is protected through e.g. cryptographic signatures or write-only storage. | 2   | D/V |

---
## C12.2

## C12.2 Abuse Detection and Alerting

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **12.2.1** | **Verify that** the system detects and alerts on known jailbreak patterns, prompt injection attempts, and adversarial inputs using signature-based detection. | 1   | D/V |
| **12.2.2** | **Verify that** the system integrates with existing Security Information and Event Management (SIEM) platforms using standard log formats and protocols. | 1   | D/V |
| **12.2.3** | **Verify that** enriched security events include AI-specific context such as model identifiers, confidence scores, and safety filter decisions. | 2   | D/V |
| **12.2.4** | **Verify that** behavioral anomaly detection identifies unusual conversation patterns, excessive retry attempts, or systematic probing behaviors. | 2   | D/V |
| **12.2.5** | **Verify that** real-time alerting mechanisms notify security teams when potential policy violations or attack attempts are detected. | 2   | D/V |
| **12.2.6** | **Verify that** custom rules are included to detect AI-specific threat patterns including coordinated jailbreak attempts, prompt injection campaigns, and model extraction attacks. | 2   | D/V |
| **12.2.7** | **Verify that** automated incident response workflows can isolate compromised models, block malicious users, and escalate critical security events. | 3   | D/V |

---
## C12.3

## C12.3 Model Drift Detection

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **12.3.1** | **Verify that** the system tracks basic performance metrics such as accuracy, confidence scores, latency, and error rates across model versions and time periods. | 1   | D/V |
| **12.3.2** | **Verify that** automated alerting triggers when performance metrics exceed predefined degradation thresholds or deviate significantly from baselines. | 2   | D/V |
| **12.3.3** | **Verify that** hallucination detection monitors identify and flag instances when model outputs contain factually incorrect, inconsistent, or fabricated information. | 2   | D/V |

---
## C12.4

## C12.4 Performance & Behavior Telemetry

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **12.4.1** | **Verify that** operational metrics including request latency, token consumption, memory usage, and throughput are continuously collected and monitored. | 1   | D/V |
| **12.4.2** | **Verify that** success and failure rates are tracked with categorization of error types and their root causes. | 1   | D/V |
| **12.4.3** | **Verify that** resource utilization monitoring includes GPU/CPU usage, memory consumption, and storage requirements with alerting on threshold breaches. | 2   | D/V |

---
## C12.5

## C12.5 AI Incident Response Planning & Execution

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **12.5.1** | **Verify that** incident response plans specifically address AI-related security events including model compromise, data poisoning, and adversarial attacks. | 1   | D/V |
| **12.5.2** | **Verify that** incident response teams have access to AI-specific forensic tools and expertise to investigate model behavior and attack vectors. | 2   | D/V |
| **12.5.3** | **Verify that** post-incident analysis includes model retraining considerations, safety filter updates, and lessons learned integration into security controls. | 3   | D/V |

---
## C12.6

## C12.6 AI Performance Degradation Detection

Monitor and detect degradation in AI model performance and quality over time.

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **12.6.1** | **Verify that** model accuracy, precision, recall, and F1 scores are continuously monitored and compared against baseline thresholds. | 1 | D/V |
| **12.6.2** | **Verify that** data drift detection monitors input distribution changes that may impact model performance. | 1 | D/V |
| **12.6.3** | **Verify that** concept drift detection identifies changes in the relationship between inputs and expected outputs. | 2 | D/V |
| **12.6.4** | **Verify that** performance degradation triggers automated alerts and initiates model retraining or replacement workflows. | 2 | D/V |
| **12.6.5** | **Verify that** degradation root cause analysis correlates performance drops with data changes, infrastructure issues, or external factors. | 3 | V |

---
## C12.7

## C12.7 DAG Visualization & Workflow Security

Protect workflow visualization systems from information leakage and manipulation attacks.

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **12.7.1** | **Verify that** DAG visualization data is sanitized to remove sensitive information before storage or transmission. | 1 | D/V |
| **12.7.2** | **Verify that** workflow visualization access controls ensure only authorized users can view agent decision paths and reasoning traces. | 1 | D/V |
| **12.7.3** | **Verify that** DAG data integrity is protected through cryptographic signatures and tamper-evident storage mechanisms. | 2 | D/V |
| **12.7.4** | **Verify that** workflow visualization systems implement input validation to prevent injection attacks through crafted node or edge data. | 2 | D/V |
| **12.7.5** | **Verify that** real-time DAG updates are rate-limited and validated to prevent denial-of-service attacks on visualization systems. | 3 | D/V |

---
## C12.8

## C12.8 Proactive Security Behavior Monitoring

Detection and prevention of security threats through proactive agent behavior analysis.

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **12.8.1** | **Verify that** proactive agent behaviors are security-validated before execution with risk assessment integration. | 1 | D/V |
| **12.8.2** | **Verify that** autonomous initiative triggers include security context evaluation and threat landscape assessment. | 2 | D/V |
| **12.8.3** | **Verify that** proactive behavior patterns are analyzed for potential security implications and unintended consequences. | 2 | D/V |
| **12.8.4** | **Verify that** security-critical proactive actions require explicit approval chains with audit trails. | 3 | D/V |
| **12.8.5** | **Verify that** behavioral anomaly detection identifies deviations in proactive agent patterns that may indicate compromise. | 3 | D/V |

---

## References
## C13.1 Kill-Switch & Override Mechanisms

## C13.1 Kill-Switch & Override Mechanisms

Provide shutdown or rollback paths when unsafe behavior of the AI system is observed.

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **13.1.1** | **Verify that** a manual kill-switch mechanism exists to immediately halt AI model inference and outputs. | 1 | D/V |
| **13.1.2** | **Verify that** override controls are accessible to only to authorized personnel. | 1 | D |
| **13.1.3** | **Verify that** rollback procedures can revert to previous model versions or safe-mode operations. | 3 | D/V |
| **13.1.4** | **Verify that** override mechanisms are tested regularly. | 3 | V |

---
## C13.2 Human-in-the-Loop Decision Checkpoints

## C13.2 Human-in-the-Loop Decision Checkpoints

Require human approvals when stakes surpass predefined risk thresholds.

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **13.2.1** | **Verify that** high-risk AI decisions require explicit human approval before execution. | 1 | D/V |
| **13.2.2** | **Verify that** risk thresholds are clearly defined and automatically trigger human review workflows. | 1 | D |
| **13.2.3** | **Verify that** time-sensitive decisions have fallback procedures when human approval cannot be obtained within required timeframes. | 2 | D |
| **13.2.4** | **Verify that** escalation procedures define clear authority levels for different decision types or risk categories, if applicable. | 3 | D/V |

---
## C13.3

## C13.3 Chain of Responsibility & Auditability

Log operator actions and model decisions.

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **13.3.1** | **Verify that** all AI system decisions and human interventions are logged with timestamps, user identities, and decision rationale. | 1 | D/V |
| **13.3.2** | **Verify that** audit logs cannot be tampered with and include integrity verification mechanisms. | 2 | D |

---
## C13.4 Explainable-AI Techniques

## C13.4 Explainable-AI Techniques

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **13.4.1** | **Verify that** AI systems provide basic explanations for their decisions in human-readable format. | 1 | D/V |
| **13.4.2** | **Verify that** explanation quality is validated through human evaluation studies and metrics. | 2 | V |
| **13.4.3** | **Verify that** feature importance scores or attribution methods (SHAP, LIME, etc.) are available for critical decisions. | 3 | D/V |
| **13.4.4** | **Verify that** counterfactual explanations show how inputs could be modified to change outcomes, if applicable to the use case and domain. | 3 | V |

---
## C13.5

## C13.5 Model Cards & Usage Disclosures

Maintain model cards for intended use, performance metrics, and ethical considerations.

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **13.5.1** | **Verify that** model cards document intended use cases, limitations, and known failure modes. | 1 | D |
| **13.5.2** | **Verify that** performance metrics across different applicable use cases are disclosed. | 1 | D/V |
| **13.5.3** | **Verify that** ethical considerations, bias assessments, fairness evaluations, training data characteristics, and known training data limitations are documented and updated regularly. | 2 | D |
| **13.5.4** | **Verify that** model cards are version-controlled and maintained throughout the model lifecycle with change tracking. | 2 | D/V |

---
## C13.6 Uncertainty Quantification

## C13.6 Uncertainty Quantification

Propagate confidence scores or entropy measures in responses.

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **13.6.1** | **Verify that** AI systems provide confidence scores or uncertainty measures with their outputs. | 1 | D |
| **13.6.2** | **Verify that** uncertainty thresholds trigger additional human review or alternative decision pathways. | 2 | D/V |
| **13.6.3** | **Verify that** uncertainty quantification methods are calibrated and validated against ground truth data. | 2 | V |
| **13.6.4** | **Verify that** uncertainty propagation is maintained through multi-step AI workflows. | 3 | D/V |

---
## C13.7

## C13.7 User-Facing Transparency Reports

Provide periodic disclosures on incidents, drift, and data usage.

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **13.7.1** | **Verify that** data usage policies and user consent management practices are clearly communicated to stakeholders. | 1 | D/V |
| **13.7.2** | **Verify that** AI impact assessments are conducted and results are included in reporting. | 2 | D/V |
| **13.7.3** | **Verify that** transparency reports published regularly disclose AI incidents and operational metrics in reasonable detail. | 2 | D/V |

### References
## C2.1 Prompt Injection Defense

## C2.1 Prompt Injection Defense

Prompt injection is one of the top risks for AI systems. Defenses against this tactic employ a combination of pattern filters, data classifiers and instruction hierarchy enforcement.

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **2.1.1** | **Verify that** any external or derived input that may steer behavior, including user prompts, RAG results, tool integration or MCP outputs, agent to agent messages, API or webhook responses, configuration or policy files, memory reads and memory writes, is treated as untrusted, made inert by quoting or tagging and active content removal, and screened by a maintained prompt injection detection ruleset or service before concatenation into prompts or execution of actions. | 1 |  D/V |
| **2.1.2** | **Verify that** the system enforces an instruction hierarchy in which system and developer messages override user instructions and other untrusted inputs, even after processing user instructions. | 1 |  D/V |
| **2.1.3** | **Verify that** prompts originating from third-party content (web pages, PDFs, emails) are sanitized in isolation (for example, stripping instruction-like directives and neutralizing HTML, Markdown, and script content) before being concatenated into the main prompt. | 2 | D |

---
## C2.2 Adversarial-Example Resistance

## C2.2 Adversarial-Example Resistance

AI models are vulnerable to subtle input perturbations that humans often miss but models tend to misclassify.

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **2.2.1** | **Verify that** basic input normalization steps (Unicode NFC, homoglyph mapping, whitespace trimming, removal of control and invisible Unicode characters) are run before tokenization or embedding and before parsing into tool or MCP arguments. | 1 | D |
| **2.2.2** | **Verify that** suspected adversarial inputs are quarantined, and logged with payload snippets and trace metadata (source, tool or MCP server, agent ID, session).  | 1 | V |
| **2.2.3** | **Verify that** statistical anomaly detection flags inputs with unusually high edit distance to language norms or abnormal embedding distances and that flagged inputs are gated before concatenation into prompts or execution of actions. | 2 |  D/V |
| **2.2.4** | **Verify that** the inference pipeline supports adversarial-training-hardened model variants or defense layers (e.g., randomization, defensive distillation, alignment checks) for high-risk endpoints. | 2 | D |
| **2.2.5** | **Verify that** encoding and representation smuggling in both inputs and outputs (e.g., invisible Unicode/control characters, homoglyph swaps, or mixed-direction text) are detected and mitigated. Approved mitigations include canonicalization, strict schema validation, policy-based rejection, or explicit marking. | 3 | D/V |

---
## C2.3

## C2.3 Prompt Character Set

Restricting the character set of user inputs to only allow characters that are necessary for business requirements can help prevent various types of attacks.

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **2.3.1** | **Verify that** the system implements a character set limitation for user inputs, allowing only characters that are explicitly required for business purposes using an allow-list approach. | 1 | D |
| **2.3.2** | **Verify that** inputs containing characters outside of the allowed set are rejected and logged with trace metadata (source, tool or MCP server, agent ID, session). | 1 | D/V |

---
## C2.4 Schema, Type & Length Validation

## C2.4 Schema, Type & Length Validation

AI attacks featuring malformed or oversized inputs can cause parsing errors, prompt spillage across fields, and resource exhaustion.  Strict schema enforcement is also a prerequisite when performing deterministic tool calls.

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **2.4.1** | **Verify that** every API, tool or MCP endpoint defines an explicit input schema (e.g., JSON Schema, Protocol Buffers, or multimodal equivalent), rejects extra or unknown fields and implicit type coercion, and validates inputs server-side before prompt assembly or tool execution. | 1 | D |
| **2.4.2** | **Verify that** inputs exceeding maximum token or byte limits are rejected with a safe error and never silently truncated. | 1 |  D/V |
| **2.4.3** | **Verify that** type checks (e.g., numeric ranges, enum values, MIME types for images/audio) are enforced server-side including for tool or MCP arguments. | 1 |  D/V |
| **2.4.4** | **Verify that** semantic validators run in constant time and avoid external network calls to prevent algorithmic DoS. | 2 | D |
| **2.4.5** | **Verify that** validation failures are logged with redacted payload snippets and unambiguous error codes and include trace metadata (source, tool or MCP server, agent ID, session) to aid security triage. | 3 | V |

---
## C2.5

## C2.5 Content & Policy Screening

Developers should be able to detect syntactically valid prompts that request disallowed content (such as policy-violating instructions, harmful content, or restricted material) then prevent them from propagating.

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **2.5.1** | **Verify that** a content classifier scores every input and output for violence, self-harm, hate, sexual content and illegal requests, with configurable thresholds. | 1 | D |
| **2.5.2** | **Verify that** inputs which violate policies will be rejected so they will not propagate to downstream model or tool/MCP calls. | 1 |  D/V |
| **2.5.3** | **Verify that** screening respects user-specific policies (age and regional legal constraints) via attribute-based rules resolved at request time, including agent-role attributes.  | 2 | D |
| **2.5.4** | **Verify that** screening logs include classifier confidence scores and policy category tags with applied stage (pre-prompt or post-response) and trace metadata (source, tool or MCP server, agent ID, session) for SOC correlation and future red-team replay. | 3 | V |

---
## C2.6 Input Rate Limiting & Abuse Prevention

## C2.6 Input Rate Limiting & Abuse Prevention

Developers should prevent abuse, resource exhaustion, and automated attacks against AI systems by limiting input rates and detecting anomalous usage patterns.

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **2.6.1** | **Verify that** per-user, per-IP, per-API-key, and per-agent and per-session/task rate limits are enforced for all input and tool/MCP endpoints. | 1 | D/V |
| **2.6.2** | **Verify that** burst and sustained rate limits are tuned to prevent DoS and brute force attacks, and that per-task budgets (for example tokens, tool/MCP calls, and cost) are enforced for agent planning loops. | 2 | D/V |
| **2.6.3** | **Verify that** anomalous usage patterns (e.g., rapid-fire requests, input flooding, repetitive failing tool/MCP calls or recursive agent loops) trigger automated blocks or escalations. | 2 | D/V |
| **2.6.4** | **Verify that** abuse prevention logs are retained and reviewed for emerging attack patterns, with trace metadata (source, tool or MCP server, agent ID, session). | 3 | V |

---
## C2.7 Multi-Modal Input Validation

## C2.7 Multi-Modal Input Validation

AI systems should include robust validation for non-textual inputs (images, audio, files) to prevent injection, evasion, or resource abuse.

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **2.7.1** | **Verify that** all non-text inputs (images, audio, files) are validated for type, size, and format before processing, and that any extracted text (image-to-text or speech-to-text) and any hidden or embedded instructions (metadata, layers, alt text, comments) are treated as untrusted per 2.1.1. | 1 | D |
| **2.7.2** | **Verify that** files are scanned for malware and steganographic payloads before ingestion, and that any active content (like scripts or macros) is removed or the file is quarantined. | 2 | D/V |
| **2.7.3** | **Verify that** image/audio inputs are checked for adversarial perturbations or known attack patterns, and detections trigger gating (block or degrade capabilities) before model use. | 2 | D/V |
| **2.7.4** | **Verify that** multi-modal input validation failures trigger detailed logging including all input modalities, validation results, threat scores, and trace metadata (source, tool or MCP server, agent ID, session as applicable), and generate alerts for investigation. | 3 | D/V |
| **2.7.5** | **Verify that** cross-modal attack detection identifies coordinated attacks spanning multiple input types (e.g., steganographic payloads in images combined with prompt injection in text) with correlation rules and alert generation, and that confirmed detections are blocked or require HITL (human-in-the-loop) approval. | 3 | D/V |

---
## C2.8 Real-Time Adaptive Threat Detection

## C2.8 Real-Time Adaptive Threat Detection

Developers should employ advanced threat detection systems for AI that adapt to new attack patterns and provide real-time protection.

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **2.8.1** | **Verify that** pattern matching (e.g., compiled regular expressions) runs on all inputs and outputs (including tool/MCP surfaces). | 1 | D/V |
| **2.8.2** | **Verify that** adaptive detection models adjust sensitivity based on recent attack activity and are updated with new patterns in real time, and trigger risk-adaptive responses (for example disable tools, shrink context, or require HITL approval). | 2 | D/V |
| **2.8.3** | **Verify that** detection accuracy is improved via contextual analysis of user history, source, and session behavior, including trace metadata (source, tool or MCP server, agent ID, session). | 3 | D/V |
| **2.8.4** | **Verify that** detection performance metrics (detection rate, false positive rate, processing latency) are continuously monitored and optimized, including time-to-block and stage (pre-prompt/post-response). | 3 | D/V |

## References

* [OWASP LLM01:2025 Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)
* [LLM Prompt Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html)
* [MITRE ATLAS : Adversarial Input Detection](https://atlas.mitre.org/mitigations/AML.M00150)
* [Mitigate jailbreaks and prompt injections](https://docs.anthropic.com/en/docs/test-and-evaluate/strengthen-guardrails/mitigate-jailbreaks)
## C3.1 Model Authorization & Integrity

## C3.1 Model Authorization & Integrity

Only authorized models with verified integrity reach production environments.

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **3.1.1** | **Verify that** a model registry maintains an inventory of all deployed model artifacts and produces a machine-readable Model/AI Bill of Materials (MBOM/AIBOM) (e.g., SPDX or CycloneDX). | 1 | V |
| **3.1.2** | **Verify that** all model artifacts (weights, configurations, tokenizers, base models, fine-tunes, adapters, and safety/policy models) are cryptographically signed by authorized entities and verified at deployment admission (and on load), blocking any unsigned or tampered artifact. | 1 | D/V |
| **3.1.3** | **Verify that** lineage and dependency tracking maintains a dependency graph that enables identification of all consuming services and agents per environment (e.g., dev, staging, prod). | 3 | V |
| **3.1.4** | **Verify that** model origin integrity and trace records include an authorizing entity's identity, training data checksums, validation test results with pass/fail status, signature fingerprint/certificate chain ID, a creation timestamp, and approved deployment environments. | 3 | D/V |

---
## C3.2

## C3.2 Model Validation & Testing

Models must pass defined security and safety validations before deployment.

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **3.2.1** | **Verify that** models undergo automated security testing that includes input validation, output sanitization, and safety evaluations with pass/fail thresholds before deployment. | 1 | D/V |
| **3.2.2** | **Verify that** security testing covers agent workflows, tool and MCP integrations, RAG and memory interactions, multimodal inputs, and guardrails (safety models or detection services) using a versioned evaluation harness. | 2 | D/V |
| **3.2.3** | **Verify that** all model changes (deployment, configuration, retirement) generate immutable audit records including a timestamp, an authenticated actor identity, a change type, and before/after states, with trace metadata (environment and consuming services/agents) and a model identifier (version/digest/signature). | 2 | V |
| **3.2.4** | **Verify that** validation failures automatically block model deployment unless an explicit override approval from pre-designated authorized personnel with documented business justifications. | 3 | D/V |

---
## C3.3

## C3.3 Controlled Deployment & Rollback

Model deployments must be controlled, monitored, and reversible.

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **3.3.1** | **Verify that** deployment processes validate cryptographic signatures and compute integrity checksums before model activation or load, failing deployment on any mismatch. | 1 | D/V |
| **3.3.2** | **Verify that** production deployments implement gradual rollout mechanisms (e.g., canary or blue-green deployments) with automated rollback triggers based on pre-agreed error rates, latency thresholds, guardrail alerts, or tool/MCP failure rates. | 2 | D |
| **3.3.3** | **Verify that** rollback capabilities restore the complete model state (weights, configurations, dependencies including adapters and safety/policy models) atomically. | 2 | D/V |
| **3.3.4** | **Verify that** emergency model shutdown capabilities can disable model endpoints within a pre-defined response time. | 3 | D/V |
| **3.3.5** | **Verify that** emergency shutdown cascades to all parts of the system including e.g. deactivating agent tool and MCP access, RAG connectors, database and API credentials, and memory-store bindings. | 3 | D/V |

---
## C3.4 Secure Development Practices

## C3.4 Secure Development Practices

Model development and training processes must follow secure practices to prevent compromise.

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **3.4.1** | **Verify that** model development, testing, and production environments are physically or logically separated. They have no shared infrastructure, distinct access controls, and isolated data stores, and agent orchestration and tool or MCP servers are also isolated. | 1 | D/V |
| **3.4.2** | **Verify that** model development artifacts (such as hyperparameters, training scripts, configuration files, prompt templates, agent policies/routing graphs, tool or MCP contracts/schemas, and action catalogs or capability allow-lists) are stored in version control and require peer review approval before use in training. | 1 | D |
| **3.4.3** | **Verify that** model training and fine-tuning occur in isolated environments with controlled network access using egress allow-lists and no access to production tools or MCP resources. | 2 | D/V |
| **3.4.4** | **Verify that** training data sources are validated through integrity checks and authenticated via trusted sources with documented chain of custody before use in model development, including RAG indexes, tool logs, and agent-generated data used for fine-tuning. | 2 | D |

---
## C3.5

## C3.5 Model Retirement & Decommissioning

Models must be securely retired when they are no longer needed or when security issues are identified.

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **3.5.1** | **Verify that** retired model artifacts (including adapters and safety/policy models) are securely wiped using secure cryptographic erasure. | 1 | D/V |
| **3.5.2** | **Verify that** model retirement events are logged with timestamp and actor identity, model identifier (version/digest/signature), and trace metadata (environment and consuming services/agents). Model signatures are revoked, registry/serving deny-lists are updated, and model loader caches are invalidated to prevent agents from loading retired artifacts. | 2 | V |

---

## References

* [MITRE ATLAS](https://atlas.mitre.org/)
* [MLOps Principles](https://ml-ops.org/content/mlops-principles)
* [Reinforcement fine-tuning](https://platform.openai.com/docs/guides/reinforcement-fine-tuning)
* [What is AI adversarial robustness? – IBM Research](https://research.ibm.com/blog/securing-ai-workflows-with-adversarial-robustness)
## C4.1

## C4.1 Runtime Environment Isolation

Prevent container escapes and privilege escalation through OS-level isolation primitives.

| # | Description | Level | Role |
|:--------:|--------------------------------------------------------------------------------------------|:---:|:---:|
| **4.1.1** | **Verify that** all AI workloads run with minimal permissions needed on the operating system, by e.g. dropping unnecessary Linux capabilities in case of a container. | 1 | D/V |
| **4.1.2** | **Verify that** workloads are protected by technologies limiting exploitation such as sandboxing, seccomp profiles, AppArmor, SELinux or similar, and that the configuration is appropriate. | 1 | D/V |
| **4.1.3** | **Verify that** workloads run with a read-only root filesystem, and that any writable mounts are explicitly defined and hardened with restrictive options that prevent execution and privilege escalation (e.g., noexec, nosuid, nodev). | 2 | D/V |
| **4.1.4** | **Verify that** runtime monitoring detects privilege-escalation and container-escape behaviors and automatically terminates offending processes. | 3 | D/V |
| **4.1.5** | **Verify that** high-risk AI workloads run in hardware-isolated environments (e.g., TEEs, trusted hypervisors, or bare-metal nodes) only after successful remote attestation. | 3 | D/V |

---
## C4.2

## C4.2 Secure Build & Deployment Pipelines

Ensure cryptographic integrity and supply chain security through reproducible builds and signed artifacts.

| # | Description | Level | Role |
|:--------:|--------------------------------------------------------------------------------------------|:---:|:---:|
| **4.2.1** | **Verify that** builds are completely automated and produce a software bill of materials (SBOM). | 1 | D/V |
| **4.2.2** | **Verify that** build artifacts are cryptographically signed with provenance metadata that can be independently verified. | 2 | D/V |
| **4.2.3** | **Verify that** build artifact signatures and provenance metadata are validated at deployment admission, and unverified artifacts are rejected. | 2 | D/V |
| **4.2.4** | **Verify that** builds are reproducible, producing identical output from identical source inputs, enabling independent verification of build integrity. | 3 | D/V |

---
## C4.3

## C4.3 Network Security & Access Control

Implement zero-trust networking with default-deny policies and encrypted communications.

| # | Description | Level | Role |
|:--------:|--------------------------------------------------------------------------------------------|:---:|:---:|
| **4.3.1** | **Verify that** network policies enforce default-deny ingress and egress, with only required services explicitly allowed. | 1 | D/V |
| **4.3.2** | **Verify that** AI workloads across environments (development, testing, production) run in isolated network segments with no direct internet access and no shared identity roles, security groups, or cross-environment connectivity. | 1 | D/V |
| **4.3.3** | **Verify that** administrative and remote access protocols and access to cloud metadata services are restricted and require strong authentication. | 1 | D/V |
| **4.3.4** | **Verify that** inter-service communication uses mutual TLS with certificate validation and regular automated rotation. | 2 | D/V |
| **4.3.5** | **Verify that** egress traffic is restricted to approved destinations and all requests are logged. | 3 | D/V |
## C4.4 Secrets & Cryptographic Key Management

## C4.4 Secrets & Cryptographic Key Management

Protect secrets and cryptographic keys with secure storage, automated rotation, and strong access controls.

| # | Description | Level | Role |
|:--------:|--------------------------------------------------------------------------------------------|:---:|:---:|
| **4.4.1** | **Verify that** secrets are stored in a dedicated secrets management system with encryption at rest and isolated from application workloads. | 1 | D/V |
| **4.4.2** | **Verify that** access to production secrets requires strong authentication. | 1 | D/V |
| **4.4.3** | **Verify that** secrets are deployed to applications at runtime through a dedicated secrets management system. Secrets must never be embedded in source code, configuration files, build artifacts, container images, or environment variables. | 1 | D/V |
| **4.4.4** | **Verify that** cryptographic keys are generated and stored in hardware-backed modules (e.g., HSMs, cloud KMS). | 2 | D/V |
| **4.4.5** | **Verify that** secrets rotation is automated. | 2 | D/V |

---
## C4.5

## C4.5 AI Workload Sandboxing & Validation

Isolate untrusted AI models in secure sandboxes and protect sensitive AI workloads using trusted execution environments (TEEs) and confidential computing technologies.

| # | Description | Level | Role |
|:--------:|--------------------------------------------------------------------------------------------|:---:|:---:|
| **4.5.1** | **Verify that** external or untrusted AI models execute in isolated sandboxes.| 1 | D/V |
| **4.5.2** | **Verify that** sandboxed workloads have no outbound network connectivity by default, with any required access explicitly defined.| 1 | D/V |
| **4.5.3** | **Verify that** workload attestation is performed before model loading, ensuring cryptographic proof that the execution environment has not been tampered with. | 2 | D/V |
| **4.5.4** | **Verify that** confidential workloads execute within a trusted execution environment (TEE) that provides hardware-enforced isolation, memory encryption, and integrity protection. | 3 | D/V |
| **4.5.5** | **Verify that** confidential inference services prevent model extraction through encrypted computation with sealed model weights and protected execution. | 3 | D/V |
| **4.5.6** | **Verify that** orchestration of trusted execution environments includes lifecycle management, remote attestation, and encrypted communication channels. | 3 | D/V |
| **4.5.7** | **Verify that** secure multi-party computation (SMPC) enables collaborative AI training without exposing individual datasets or model parameters. | 3 | D/V |

---
## C4.6 AI Infrastructure Resource Management, Backup and Recovery

## C4.6 AI Infrastructure Resource Management, Backup and Recovery

Prevent resource exhaustion attacks and ensure fair resource allocation through quotas and monitoring. Maintain infrastructure resilience through secure backups, tested recovery procedures, and disaster recovery capabilities.

| # | Description | Level | Role |
|:--------:|--------------------------------------------------------------------------------------------|:---:|:---:|
| **4.6.1** | **Verify that** workload resource consumption is limited through quotas and limits (e.g., CPU, memory, GPU) to mitigate denial-of-service attacks. | 1 | D/V |
| **4.6.2** | **Verify that** resource exhaustion triggers automated protections (e.g., rate limiting or workload isolation) once defined CPU, memory, or request thresholds are exceeded. | 2 | D/V |
| **4.6.3** | **Verify that** backup systems run in isolated networks with separate credentials, and the storage system is either run in an air-gapped network or implements WORM (write-once-read-many) protection against unauthorized modification. | 2 | D/V |

---
## C4.7

## C4.7 AI Hardware Security

Secure AI-specific hardware components including GPUs, TPUs, and specialized AI accelerators.

| # | Description | Level | Role |
|:--------:|--------------------------------------------------------------------------------------------|:---:|:---:|
| **4.7.1** | **Verify that** before workload execution, AI accelerator integrity is validated using hardware-based attestation mechanisms (e.g., TPM, DRTM, or equivalent). | 2 | D/V |
| **4.7.2** | **Verify that** accelerator (GPU) memory is isolated between workloads through partitioning mechanisms with memory sanitization between jobs. | 2 | D/V |
| **4.7.3** | **Verify that** AI accelerator firmware is version-pinned, signed, and attested at boot; unsigned or debug firmware is blocked. | 2 | D/V |
| **4.7.4** | **Verify that** VRAM and on-package memory are zeroed between jobs/tenants and that device reset policies prevent cross-tenant data remanence. | 2 | D/V |
| **4.7.5** | **Verify that** partitioning/isolation features (e.g., MIG/VM partitioning) are enforced per tenant and prevent peer-to-peer memory access across partitions. | 2 | D/V |
| **4.7.6** | **Verify that** hardware security modules (HSMs) or equivalent tamper-resistant hardware protect AI model weights and cryptographic keys, with certification to an appropriate assurance level (e.g., FIPS 140-3 Level 3 or Common Criteria EAL4+). | 3 | D/V |
| **4.7.7** | **Verify that** accelerator interconnects (NVLink/PCIe/InfiniBand/RDMA/NCCL) are restricted to approved topologies and authenticated endpoints; plaintext cross-tenant links are disallowed. | 3 | D/V |
| **4.7.8** | **Verify that** accelerator telemetry (power draw, temperature, error correction, performance counters) is exported to centralized security monitoring and alerts on anomalies indicative of side-channels or covert channels. | 3 | D |

---
## C4.8

## C4.8 Edge & Distributed AI Security

Secure distributed AI deployments including edge computing, federated learning, and multi-site architectures.

| # | Description | Level | Role |
|:--------:|--------------------------------------------------------------------------------------------|:---:|:---:|
| **4.8.1** | **Verify that** edge AI devices authenticate to central infrastructure using mutual authentication with certificate validation (e.g., mutual TLS). | 1 | D/V |
| **4.8.2** | **Verify that** models deployed to edge or mobile devices are cryptographically signed during packaging, and that the on-device runtime validates these signatures or checksums before loading or inference; unverified or altered models must be rejected. | 1 | D/V |
| **4.8.3** | **Verify that** edge devices implement secure boot with verified signatures and rollback protection to prevent firmware downgrade attacks. | 2 | D/V |
| **4.8.4** | **Verify that** mobile or edge inference applications implement platform-level anti-tampering protections (e.g., code signing, verified boot, runtime integrity checks) that detect and block modified binaries, repackaged applications, or attached instrumentation frameworks. | 2 | D/V |
| **4.8.5** | **Verify that** distributed AI coordination uses Byzantine fault-tolerant consensus mechanisms with participant validation and malicious node detection. | 3 | D/V |
| **4.8.6** | **Verify that** edge-to-cloud communication supports bandwidth throttling, data compression, and secure offline operation with encrypted local storage. | 3 | D/V |
| **4.8.7** | **Verify that** on-device inference runtimes enforce process, memory, and file access isolation to prevent model dumping, debugging, or extraction of intermediate embeddings and activations. | 3 | D/V |
| **4.8.8** | **Verify that** model weights and sensitive parameters stored locally are encrypted using hardware-backed key stores or secure enclaves (e.g., Android Keystore, iOS Secure Enclave, TPM/TEE), with keys inaccessible to user space. | 3 | D/V |
| **4.8.9** | **Verify that** models packaged within mobile, IoT, or embedded applications are encrypted or obfuscated at rest, and decrypted only inside a trusted runtime or secure enclave, preventing direct extraction from the app package or filesystem. | 3 | D/V |

---

## References

* [NIST Cybersecurity Framework 2.0](https://www.nist.gov/cyberframework)
* [CIS Controls v8](https://www.cisecurity.org/controls/v8)
* [Kubernetes Security Best Practices](https://kubernetes.io/docs/concepts/security/)
* [Cloud Security Alliance: Cloud Controls Matrix](https://cloudsecurityalliance.org/research/cloud-controls-matrix/)
* [ENISA: Secure Infrastructure Design](https://www.enisa.europa.eu/topics/critical-information-infrastructures-and-services)
* [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework)
## C5.1

## C5.1 Identity Management & Authentication

Establish verified identities for all entities interacting with AI systems, with authentication strength appropriate to the risk level.

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **5.1.1** | **Verify that** all human users and service principals authenticate through a centralized identity provider using industry-standard federation protocols (e.g., OIDC, SAML). | 1 | D/V |
| **5.1.2** | **Verify that** high-risk operations (model deployment, weight export, training data access, production configuration changes) require multi-factor authentication or step-up authentication with session re-validation. | 2 | D/V |
| **5.1.3** | **Verify that** AI agents in federated or multi-system deployments authenticate via short-lived, cryptographically signed authentication tokens (e.g., signed JWT assertions) with a maximum lifetime appropriate to the risk level and including cryptographic proof of origin. | 3 | D/V |

---
## C5.2 Authorization & Policy

## C5.2 Authorization & Policy

Implement access controls for all AI resources with explicit permission models and audit trails.

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **5.2.1** | **Verify that** every AI resource (datasets, models, endpoints, vector collections, embedding indices, compute instances) enforces access controls (e.g., RBAC, ABAC) with explicit allow-lists and default-deny policies. | 1 | D/V |
| **5.2.2** | **Verify that** all access control modifications are logged with timestamps, actor identities, resource identifiers, and permission changes. | 1 | V |
| **5.2.3** | **Verify that** access control audit logs are stored immutably and are tamper-evident. | 2 | V |
| **5.2.4** | **Verify that** data classification labels (PII, PHI, proprietary, etc.) automatically propagate to derived resources (embeddings, prompt caches, model outputs). | 2 | D |
| **5.2.5** | **Verify that** unauthorized access attempts and privilege escalation events trigger real-time alerts with contextual metadata. | 2 | D/V |
| **5.2.6** | **Verify that** authorization decisions are externalized to a dedicated policy decision point (e.g., OPA, Cedar, or equivalent). | 3 | D/V |
| **5.2.7** | **Verify that** policies evaluate dynamic attributes at runtime including user role or group, resource classification, request context, tenant isolation, and temporal constraints. | 3 | D/V |
| **5.2.8** | **Verify that** policy cache TTL values are defined based on resource sensitivity, with shorter TTLs for high-sensitivity resources, and that cache invalidation capabilities are available. | 3 | D/V |

---
## C5.3

## C5.3 Query-Time Security Enforcement

Enforce authorization at the data access layer to prevent unauthorized data retrieval through AI queries.

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **5.3.1** | **Verify that** all data store queries (e.g., vector databases, SQL databases, search indices) include mandatory security filters (tenant ID, sensitivity labels, user scope) enforced at the data access layer. | 1 | D/V |
| **5.3.2** | **Verify that** failed authorization evaluations immediately abort queries and return explicit authorization error codes. | 1 | D |
| **5.3.3** | **Verify that** row-level security policies and field-level masking are enabled with policy inheritance for all data stores containing sensitive data used by AI systems. | 2 | D/V |
| **5.3.4** | **Verify that** query retry mechanisms re-evaluate authorization policies to account for dynamic permission changes within active sessions. | 3 | D/V |

---
## C5.4 Output Filtering & Data Loss Prevention

## C5.4 Output Filtering & Data Loss Prevention

Deploy post-processing controls to prevent unauthorized data exposure in AI-generated content.

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **5.4.1** | **Verify that** post-inference filtering mechanisms scan and redact unauthorized PII, classified information, and proprietary data before delivering content to requestors. | 1 | D/V |
| **5.4.2** | **Verify that** citations, references, and source attributions in model outputs are validated against caller entitlements and removed if unauthorized access is detected. | 2 | D/V |
| **5.4.3** | **Verify that** output format restrictions (sanitized documents, metadata-stripped images, approved file types) are enforced based on user permission levels and data classifications. | 2 | D |

---
## C5.5 Multi-Tenant Isolation

## C5.5 Multi-Tenant Isolation

Ensure logical and cryptographic isolation between tenants in shared AI infrastructure.

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **5.5.1** | **Verify that** network policies implement default-deny rules for cross-tenant communication. | 2 | D |
| **5.5.2** | **Verify that** every API request includes an authenticated tenant identifier that is cryptographically validated against session context and user entitlements. | 1 | D/V |
| **5.5.3** | **Verify that** memory spaces, embedding stores, cache entries, and temporary files are namespace-segregated per tenant with secure purging on tenant deletion or session termination. | 2 | D/V |
| **5.5.4** | **Verify that** encryption keys are unique per tenant with customer-managed key (CMK) support and cryptographic isolation between tenant data stores. | 3 | D |

---
## C5.6 Autonomous Agent Authorization

## C5.6 Autonomous Agent Authorization

Control permissions for AI agents and autonomous systems through scoped capability tokens and continuous authorization.

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **5.6.1** | **Verify that** autonomous agents receive scoped capability tokens that explicitly enumerate permitted actions, accessible resources, time boundaries, and operational constraints. | 1 | D/V |
| **5.6.2** | **Verify that** high-risk capabilities (file system access, code execution, external API calls, financial transactions) are disabled by default and require explicit authorization. | 1 | D/V |
| **5.6.3** | **Verify that** capability tokens are bound to user sessions, include cryptographic integrity protection, and cannot be persisted or reused across sessions. | 2 | D |
| **5.6.4** | **Verify that** agent-initiated actions undergo authorization through a policy decision point that evaluates contextual attributes (e.g., user identity, resource sensitivity, action type, environmental context). | 3 | V |

---

## References

* [NIST SP 800-162: Guide to Attribute Based Access Control (ABAC)](https://csrc.nist.gov/pubs/sp/800/162/final)
* [NIST SP 800-207: Zero Trust Architecture](https://csrc.nist.gov/pubs/sp/800/207/final)
* [NIST SP 800-63-3: Digital Identity Guidelines](https://csrc.nist.gov/pubs/sp/800/63/3/final)
* [NIST IR 8360: Machine Learning for Access Control Policy Verification](https://csrc.nist.gov/pubs/ir/8360/final)
## C6.1 Pretrained Model Vetting & Origin Integrity

## C6.1 Pretrained Model Vetting & Origin Integrity

Assess and authenticate third‑party model origins, licenses, and hidden behaviors before any fine‑tuning or deployment.

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **6.1.1** | **Verify that** every third‑party model artifact includes a signed provenance record identifying its source, version, and integrity checksum. | 1 | D/V |
| **6.1.2** | **Verify that** models are scanned for malicious layers or Trojan triggers using automated tools before import. | 1 | D/V |
| **6.1.3** | **Verify that** model licenses, export‑control tags, and data‑origin statements are recorded in an AI BOM entry. | 2 | V |
| **6.1.4** | **Verify that** high‑risk models (e.g., publicly uploaded weights, unverified creators) remain quarantined until human review and sign‑off. | 2 | D/V |
| **6.1.5** | **Verify that** transfer‑learning fine‑tunes pass adversarial evaluation to detect hidden behaviors. | 3 | D |

---
## C6.2 Framework & Library Scanning

## C6.2 Framework & Library Scanning

Continuously scan AI frameworks and libraries for vulnerabilities and malicious code to keep the runtime stack secure.

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **6.2.1** | **Verify that** CI pipelines run dependency scanners on AI frameworks and critical libraries. | 1 | D/V |
| **6.2.2** | **Verify that** critical and high‑severity vulnerabilities block promotion to production images. | 2 | D/V |
| **6.2.3** | **Verify that** static code analysis runs on forked or vendored AI libraries. | 2 | D |
| **6.2.4** | **Verify that** framework upgrade proposals include a security impact assessment referencing public vulnerability feeds. | 2 | V |
| **6.2.5** | **Verify that** runtime sensors alert on unexpected dynamic library loads that deviate from the signed SBOM. | 3 | V |

---
## C6.3 Dependency Pinning & Verification

## C6.3 Dependency Pinning & Verification

Pin every dependency to immutable digests and verify builds to guarantee tamper‑free artifacts.

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **6.3.1** | **Verify that** all package managers enforce version pinning via lockfiles. | 1 | D/V |
| **6.3.2** | **Verify that** immutable digests are used instead of mutable tags in container references. | 1 | D/V |
| **6.3.3** | **Verify that** expired or unmaintained dependencies trigger automated notifications to update or replace pinned versions. | 2 | D |
| **6.3.4** | **Verify that** build attestations are retained for a period defined by organizational policy for audit traceability. | 3 | V |
| **6.3.5** | **Verify that** reproducible‑build checks compare hashes across CI runs to ensure identical outputs. | 3 | D |

---
## C6.4 Trusted Source Enforcement

## C6.4 Trusted Source Enforcement

Allow artifact downloads only from cryptographically verified, organization‑approved sources and block everything else.

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **6.4.1** | **Verify that** model weights, datasets, and containers are downloaded only from approved sources or internal registries. | 1 | D/V |
| **6.4.2** | **Verify that** cryptographic signatures validate publisher identity before artifacts are cached locally. | 1 | D/V |
| **6.4.3** | **Verify that** egress controls block unauthenticated artifact downloads to enforce trusted‑source policy. | 2 | D |
| **6.4.4** | **Verify that** repository allow‑lists are reviewed periodically with evidence of business justification for each entry. | 3 | V |
| **6.4.5** | **Verify that** policy violations trigger quarantining of artifacts and rollback of dependent pipeline runs. | 3 | V |

---
## C6.5

## C6.5 Third‑Party Dataset Risk Assessment

Evaluate external datasets for poisoning, bias, and legal compliance, and monitor them throughout their lifecycle.

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **6.5.1** | **Verify that** external datasets undergo poisoning risk assessment (e.g., data fingerprinting, outlier detection). | 1 | D/V |
| **6.5.2** | **Verify that** disallowed content (e.g., copyrighted material, PII) is detected and removed via automated scrubbing prior to training. | 1 | D |
| **6.5.3** | **Verify that** origin, lineage, and license terms for datasets are captured in AI BOM entries. | 2 | V |
| **6.5.4** | **Verify that** bias metrics (e.g., demographic parity, equal opportunity) are calculated before dataset approval. | 2 | D |
| **6.5.5** | **Verify that** periodic monitoring detects drift or corruption in hosted datasets. | 3 | V |

---
## C6.6 Supply Chain Attack Monitoring

## C6.6 Supply Chain Attack Monitoring

Detect supply‑chain threats early through vulnerability feeds, audit‑log analytics, and incident response readiness.

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **6.6.1** | **Verify that** incident response playbooks include rollback procedures for compromised models or libraries. | 2 | D |
| **6.6.2** | **Verify that** CI/CD audit logs are streamed to centralized security monitoring with detections for anomalous package pulls or tampered build steps. | 2 | V |
| **6.6.3** | **Verify that** threat‑intelligence enrichment tags AI‑specific indicators (e.g., model‑poisoning indicators of compromise) in alert triage. | 3 | V |

---
## C6.7 AI BOM for Model Artifacts

## C6.7 AI BOM for Model Artifacts

Generate and sign detailed AI‑specific bills of materials (AI BOMs) so downstream consumers can verify component integrity at deploy time.

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **6.7.1** | **Verify that** every model artifact publishes an AI BOM that lists datasets, weights, hyperparameters, and licenses. | 1 | D/V |
| **6.7.2** | **Verify that** AI BOM generation and cryptographic signing are automated in CI and required for merge. | 2 | D/V |
| **6.7.3** | **Verify that** AI BOM completeness checks fail the build if any component metadata (hash and license) is missing. | 2 | D |
| **6.7.4** | **Verify that** downstream consumers can query AI BOMs via API to validate imported models at deploy time. | 2 | V |
| **6.7.5** | **Verify that** AI BOMs are version‑controlled and diffed to detect unauthorized modifications. | 3 | V |

---

## References

* [OWASP LLM03:2025 Supply Chain](https://genai.owasp.org/llmrisk/llm032025-supply-chain/)
* [MITRE ATLAS : Supply Chain Compromise](https://atlas.mitre.org/techniques/AML.T0010)
* [SBOM Overview – CISA](https://www.cisa.gov/sbom)
* [CycloneDX – Machine Learning Bill of Materials](https://cyclonedx.org/capabilities/mlbom/)
## C7.1 Output Format Enforcement

## C7.1 Output Format Enforcement

Ensure the model outputs data in a way that helps prevents injection.

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **7.1.1** | **Verify that** the application validates all model outputs against a strict schema (like JSON Schema) and rejects any output that does not match. | 1 | D/V |
| **7.1.2** | **Verify that** the system uses "stop sequences" or token limits to strictly cut off generation before it can overflow buffers or executes unintended commands. | 1 | D/V |
| **7.1.3** | **Verify that** components processing model output treat it as untrusted input (e.g., using parameterized queries or safe de-serializers). | 2 | D/V |
| **7.1.4** | **Verify that** the system logs the specific error type when an output is rejected for bad formatting. | 3 | V |

---
## C7.2 Hallucination Detection & Mitigation

## C7.2 Hallucination Detection & Mitigation

Detect when the model is unsure or lying, and stop that information from reaching the user.

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **7.2.1** | **Verify that** the system calculates a numerical confidence score (e.g., using log-probabilities) for generated answers. | 1 | D/V |
| **7.2.2** | **Verify that** the application automatically blocks answers or switches to a fallback message if the confidence score drops below a defined threshold. | 1 | D/V |
| **7.2.3** | **Verify that** hallucination events (low-confidence responses) are logged with input/output metadata for analysis. | 2 | D/V |

---
## C7.3 Output Safety & Privacy Filtering

## C7.3 Output Safety & Privacy Filtering

Technical controls to detect and scrub bad content before it is shown to the user.

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **7.3.1** | **Verify that** automated classifiers scan every response and block content that matches hate, harassment, or sexual violence categories. | 1 | D/V |
| **7.3.2** | **Verify that** the system scans every response for PII (like credit cards or emails) and automatically redacts it before display. | 1 | D/V |
| **7.3.3** | **Verify that** data labeled as "confidential" in the system remains blocked or redacted. | 2 | D |
| **7.3.4** | **Verify that** the system requires a human approval step or re-authentication if the model generates high-risk content. | 3 | D/V |
| **7.3.5** | **Verify that** safety filters can be configured differently based on the user's role or location (e.g., stricter filters for minors). | 3 | D/V |

---
## C7.4 Output & Action Limiting

## C7.4 Output & Action Limiting

Prevent the model from doing too much, too fast, or accessing things it should not.

| # | Description | Level | Role |
|:--------:|---------------------------------------------------------------------------------------------------------------------|:---:|:---:|
| **7.4.1** | **Verify that** the system enforces hard limits on requests and tokens per user to prevent cost spikes and denial of service. | 1 | D |
| **7.4.2** | **Verify that** the model cannot execute high-impact actions (like writing files, sending emails, or executing code) without explicit user confirmation. | 1 | D/V |
| **7.4.3** | **Verify that** the agent framework explicitly configures and enforces the maximum depth of recursive calls, delegation limits, and the list of allowed external tools. | 2 | D |

---
## C7.5 Explainability & Transparency

## C7.5 Explainability & Transparency

Ensure the user knows why a decision was made.

| # | Description | Level | Role |
| :-------: | ------------------------------------------------------------------------------------------------------------------------------ | :---: | :--: |
| **7.5.1** | **Verify that** the UI displays a confidence score or "reasoning summary" to the user for critical decisions. | 2 | D/V |
| **7.5.2** | **Verify that** explanations provided to the user are sanitized to remove system prompts or backend data. | 2 | D/V |
| **7.5.3** | **Verify that** technical evidence of the model's decision (like attention maps) are logged.| 3 | D |

---
## C7.6

## C7.6 Monitoring Integration

Ensure the application sends the right signals for security teams to watch.

| # | Description | Level | Role |
| :-------: | -------------------------------------------------------------------------------------------------------------------------------------------- | :---: | :--: |
| **7.6.1** | **Verify that** the system logs real-time metrics for safety violations (e.g., "Hallucination Detected", "PII Blocked").| 1 | D |
| **7.6.2** | **Verify that** the system triggers an alert if safety violation rates exceed a defined threshold within a specific time window. | 1 | V |
| **7.6.3** | **Verify that** logs include the specific model version and other details necessary to investigate potential abuse. | 2 | V |

---

## 7.7 Generative Media Safeguards

Prevent the creation of illegal or fake media.

| # | Description | Level | Role |
| :-------: | -------------------------------------------------------------------------------------------------------------------------------------------- | :---: | :--: |
| **7.7.1** | **Verify that** the system refuses to generate media (images/audio) that depicts real people without verified consent. | 1 | D/V |
| **7.7.2** | **Verify that** input filters block prompts requesting explicit or deepfake content before the model processes them. | 2 | D/V  |
| **7.7.3** | **Verify that** the system checks generated content for copyright violations before releasing it. | 2 | V |
| **7.7.4** | **Verify that** all generated media includes an invisible watermark or cryptographic signature to prove it was AI-generated. | 3 | D/V  |
| **7.7.5** | **Verify that** attempts to bypass filters are detected and logged as security events. | 3 | V |

## References

* [OWASP LLM05:2025 Improper Output Handling](https://genai.owasp.org/llmrisk/llm052025-improper-output-handling/)
* [OWASP LLM06:2025 Excessive Agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/)
## C8.1 Access Controls on Memory & RAG Indices

## C8.1 Access Controls on Memory & RAG Indices

Enforce fine-grained access controls and query-time scope enforcement for every vector collection.

| # | Description | Level | Role |
| :--: | --- | :---: | :--: |
| **8.1.1** | **Verify that** vector insert, update, delete, and query operations are enforced with namespace/collection/document-tag scope controls (e.g., tenant ID, user ID, data classification labels) with default-deny. | 1 | D/V |
| **8.1.2** | **Verify that** API credentials used for vector operations carry **scoped claims** (e.g., permitted collections, allowed verbs, tenant binding). | 1 | D/V |
| **8.1.3** | **Verify that** cross-scope access attempts (e.g., cross-tenant similarity queries, namespace traversal, tag bypass) are detected and rejected. | 2 | D/V |
## C8.2 Embedding Sanitization & Validation

## C8.2 Embedding Sanitization & Validation

Pre-screen content before vectorization; treat memory writes as untrusted inputs; prevent ingestion of unsafe payloads.

| # | Description | Level | Role |
| :--: | --- | :---: | :--: |
| **8.2.1** | **Verify that** regulated data and sensitive fields are detected prior to embedding and are masked, tokenized, transformed, or dropped based on policy. | 1 | D/V |
| **8.2.2** | **Verify that** embedding ingestion rejects or quarantines inputs that violate required content constraints (e.g., non-UTF-8, malformed encodings, oversized payloads, invisible ASCII characters, or executable content intended to poison retrieval). | 1 | D/V |
## C8.3 Memory Expiry, Revocation & Deletion

## C8.3 Memory Expiry, Revocation & Deletion

Retention must be explicit and enforceable; deletions must propagate to derived indices and caches.

| # | Description | Level | Role |
| :--: | --- | :---: | :--: |
| **8.3.1** | **Verify that** retention times are applied to every stored vector and related metadata across memory storage. | 1 | D/V |
| **8.3.2** | **Verify that** deletion requests purge vectors, metadata, cache copies, and derivative indices within an organization-defined maximum time. | 1 | D/V |
| **8.3.3** | **Verify that** deleted or expired vectors are removed reliably and are unrecoverable. | 2 | D |
| **8.3.4** | **Verify that** expired vectors are excluded from retrieval results within a measured and monitored propagation windows. | 3 | D/V |
## C8.4 Prevent Embedding Inversion & Leakage

## C8.4 Prevent Embedding Inversion & Leakage

Address inversion, membership inference, and attribute inference with explicit threat modeling, mitigations, and regression testing gates.

| # | Description | Level | Role |
| :--: | --- | :---: | :--: |
| **8.4.1** | **Verify that** sensitive vector collections are protected against direct read access by infrastructure administrators via technical controls such as application-layer encryption, envelope encryption with strict KMS policies, or equivalent compensating controls. | 2 | D/V |
| **8.4.2** | **Verify that** privacy/utility targets for embedding leakage resistance are **defined and measured**, and that changes to embedding models, tokenizers, retrieval settings, or privacy transforms are gated by regression tests against those targets. | 3 | D/V |
## C8.5 Scope Enforcement for User-Specific Memory

## C8.5 Scope Enforcement for User-Specific Memory

Prevent cross-tenant and cross-user leakage in retrieval and prompt assembly.

| # | Description | Level | Role |
| :--: | --- | :---: | :--: |
| **8.5.1** | **Verify that** every retrieval operation enforces scope constraints (tenant/user/classification) **in the vector engine query** and verifies them again **before prompt assembly** (post-filter). | 1 | D/V |
| **8.5.2** | **Verify that** vector identifiers, namespaces, and metadata indexing prevent cross-scope collisions and enforce uniqueness per tenant. | 1 | D |
| **8.5.3** | **Verify that** retrieval results that match similarity criteria but fail scope checks are discarded. | 2 | D/V |
| **8.5.4** | **Verify that** multi-tenant tests simulate adversarial retrieval attempts (prompt-based and query-based) and demonstrate zero out-of-scope document inclusion in prompts and outputs. | 2 | V |
| **8.5.5** | **Verify that** encryption keys and access policies are segregated per tenant for memory/vector storage, providing cryptographic isolation in shared infrastructure. | 3 | D/V |

## References (recommended additions)

* OWASP Foundation. **OWASP Top 10 for Large Language Model Applications (LLM) 2025**. https://owasp.org/www-project-top-10-for-large-language-model-applications/assets/PDF/OWASP-Top-10-for-LLMs-v2025.pdf
## C9.1 Execution Budgets, Loop Control, and Circuit Breakers

## C9.1 Execution Budgets, Loop Control, and Circuit Breakers

Bound runtime expansion (recursion, concurrency, cost) and halt safely on runaway behavior.

| # | Description | Level | Role |
| :--: | --- | :---: | :--: |
| **9.1.1** | **Verify that** per-execution budgets (max recursion depth, max fan-out/concurrency, wall-clock time, tokens, and monetary spend) are configured and enforced by the orchestration runtime. | 1 | D/V |
| **9.1.2** | **Verify that** cumulative resource/spend counters are tracked per request chain and hard-stop the chain when thresholds are exceeded. | 2 | D/V |
| **9.1.3** | **Verify that** circuit breakers terminate execution on budget violations. | 2 | D/V |
| **9.1.4** | **Verify that** security testing covers runaway loops, budget exhaustion, and partial-failure scenarios, confirming safe termination and consistent state. | 3 | V |
| **9.1.5** | **Verify that** budget and circuit-breaker policies are expressed as policy-as-code and are validated in CI/CD to prevent drift and unsafe configuration changes. | 3 | D/V |

---
## C9.2 High-Impact Action Approval and Irreversibility Controls

## C9.2 High-Impact Action Approval and Irreversibility Controls

Require explicit checkpoints for privileged or irreversible outcomes.

| # | Description | Level | Role |
| :--: | --- | :---: | :--: |
| **9.2.1** | **Verify that** privileged or irreversible actions (e.g., code merges/deploys, financial transfers, user access changes, destructive deletes, external notifications) require explicit human-in-loop approval. | 1 | D/V |
| **9.2.2** | **Verify that** approval requests present the exact action parameters (diff/command/recipient/amount/scope) and bind approvals to those parameters to prevent “approve one thing, execute another.” | 2 | D/V |
| **9.2.3** | **Verify that** where rollback is feasible, compensating actions are defined and tested (transactional semantics), and failures trigger rollback or safe containment. | 3 | V |

---
## C9.3 Tool and Plugin Isolation and Safe Integration

## C9.3 Tool and Plugin Isolation and Safe Integration

Constrain tool execution, loading, and outputs to prevent unauthorized system access and unsafe side effects.

| # | Description | Level | Role |
| :--: | --- | :---: | :--: |
| **9.3.1** | **Verify that** each tool/plugin executes in an isolated sandbox (container/VM/WASM/OS sandbox) with least-privilege filesystem, network egress, and syscall permissions appropriate to the tool’s function. | 1 | D/V |
| **9.3.2** | **Verify that** per-tool quotas and timeouts (CPU, memory, disk, egress, execution time) are enforced and logged, and that quota breaches fail closed. | 1 | D/V |
| **9.3.3** | **Verify that** tool manifests declare required privileges, side-effect level, resource limits, and output validation requirements, and that the runtime enforces these declarations. | 2 | D/V |
| **9.3.4** | **Verify that** tool outputs are validated against strict schemas and security policies before being incorporated into downstream reasoning or follow-on actions. | 2 | D/V |
| **9.3.5** | **Verify that** tool binaries are integrity-protected and validated prior to loading. | 2 | D/V |
| **9.3.6** | **Verify that** sandbox escape indicators or policy violations trigger automated containment (tool disabled/quarantined). | 3 | D/V |

---
## C9.4

## C9.4 Agent and Orchestrator Identity, Signing, and Tamper-Evident Audit

Make every action attributable and every mutation detectable.

| # | Description | Level | Role |
| :--: | --- | :---: | :--: |
| **9.4.1** | **Verify that** each agent instance (and orchestrator/runtime) has a unique cryptographic identity and authenticates as a first-class principal to downstream systems (no reuse of end-user credentials). | 1 | D/V |
| **9.4.2** | **Verify that** agent-initiated actions are cryptographically bound to the execution chain (chain ID) and are signed and timestamped for non-repudiation and traceability. | 2 | D/V |
| **9.4.3** | **Verify that** audit logs are tamper-evident (append-only/WORM/immutable log store) and include sufficient context to reconstruct who/what acted, initiating user identifier, delegation scope, authorization decision (policy/version), tool parameters, approvals (where applicable), and outcomes. | 2 | D/V |
| **9.4.4** | **Verify that** agent identity credentials (keys/certs/tokens) rotate on a defined schedule and on compromise indicators, with rapid revocation and quarantine on suspected compromise or spoofing attempts. | 3 | D/V |

---
## C9.5

## C9.5 Secure Messaging and Protocol Hardening

Protect agent-to-agent and agent-to-tool communications from hijacking, injection, replay, and desynchronization.

| # | Description | Level | Role |
| :--: | --- | :---: | :--: |
| **9.5.1** | **Verify that** agent-to-agent and agent-to-tool channels enforce mutual authentication and encryption with modern protocols (e.g., TLS 1.3) and strong certificate/token validation. | 1 | D/V |
| **9.5.2** | **Verify that** all messages are strictly schema-validated; unknown fields, malformed payloads, and oversized frames are rejected. | 1 | D/V |
| **9.5.3** | **Verify that** message integrity covers the full payload including tool parameters, and that replay protections (nonces/sequence numbers/timestamp windows) are enforced. | 2 | D/V |

---
## C9.6 Authorization, Delegation, and Continuous Enforcement

## C9.6 Authorization, Delegation, and Continuous Enforcement

Ensure every action is authorized at execution time and constrained by scope.

| # | Description | Level | Role |
| :--: | --- | :---: | :--: |
| **9.6.1** | **Verify that** agent actions are authorized against fine-grained policies that restrict which tools an agent may invoke and which parameters it may supply (allow-list plus parameter constraints), enforced by the runtime. | 2 | D/V |
| **9.6.2** | **Verify that** when an agent acts on a user’s behalf, the runtime propagates an integrity-protected delegation context (user ID, tenant, session, scopes) and enforces that context at every downstream call without using the user’s credentials. | 2 | D/V |
| **9.6.3** | **Verify that** authorization is re-evaluated on every call (continuous authorization) using current context (tenant, environment, data classification, time, risk), and that delegated scopes are time-bound and automatically expire. | 3 | D/V |

---
## C9.7 Intent Verification and Constraint Gates

## C9.7 Intent Verification and Constraint Gates

Prevent “technically authorized but unintended” actions by binding execution to user intent and hard constraints.

| # | Description | Level | Role |
| :--: | --- | :---: | :--: |
| **9.7.1** | **Verify that** pre-execution gates evaluate proposed actions and parameters against hard policy constraints (deny rules, data handling constraints, allow-lists, side-effect budgets) and block execution on any violation. | 1 | D/V |
| **9.7.2** | **Verify that** high-impact actions require explicit user intent confirmation that is integrity-protected and bound to the exact action parameters (and expires quickly) to prevent stale or substituted approvals. | 2 | D/V |
| **9.7.3** | **Verify that** post-condition checks confirm the intended outcome and detect unintended side effects; any mismatch triggers containment (and compensating actions where supported). | 2 | V |

---
## C9.8

## C9.8 Multi-Agent Domain Isolation and Swarm Risk Controls

Reduce cross-domain interference and emergent unsafe collective behavior.

| # | Description | Level | Role |
| :--: | --- | :---: | :--: |
| **9.8.1** | **Verify that** agents in different tenants, security domains, or environments (dev/test/prod) run in isolated runtimes and network segments, with default-deny controls that prevent cross-domain discovery and calls. | 1 | D/V |
| **9.8.2** | **Verify that** runtime monitoring detects unsafe emergent behavior (oscillation, deadlocks, uncontrolled broadcast, abnormal call graphs) and automatically applies corrective actions (throttle, isolate, terminate). | 3 | D/V |

---
## C9.9

## C9.9 Model Context Protocol (MCP) Security

Ensure secure discovery, authentication, authorization, transport, and use of MCP-based tool and resource integrations to prevent context confusion, unauthorized tool invocation, or cross-tenant data exposure.

### Component Integrity & Supply Chain Hygiene

| # | Description | Level | Role |
| :--: | --- | :---: | :--: |
| **9.9.1** | **Verify that** MCP server and client components are obtained only from trusted sources and verified using signatures, checksums, or secure package metadata, rejecting tampered or unsigned builds. | 1 | D/V |

### Authentication & Authorization

| # | Description | Level | Role |
| :--: | --- | :---: | :--: |
| **9.9.2** | **Verify that** MCP clients and servers mutually authenticate using strong, non-user credentials (e.g., mTLS, DPoP), and that unauthenticated MCP requests are rejected. | 2 | D/V |
| **9.9.3** | **Verify that** MCP servers are registered through a controlled technical onboarding mechanism requiring explicit owner, environment, and resource definitions; unregistered or undiscoverable servers must not be callable in production. | 2 | D/V |
| **9.9.4** | **Verify that** each MCP tool or resource defines explicit authorization scopes (e.g., read-only, restricted queries, side-effect levels), and that agents cannot invoke MCP functions outside their assigned scope. | 2 | D/V |

### Secure Transport & Network Boundary Protection

| # | Description | Level | Role |
| :--: | --- | :---: | :--: |
| **9.9.5** | **Verify that** authenticated, encrypted streamable-HTTP is used as the primary MCP transport in production environments; alternate transports (stdio, SSE) are restricted to local or tightly controlled environments with explicit justification. | 2 | D/V |
| **9.9.6** | **Verify that** streamable-HTTP MCP transports use authenticated, encrypted channels (TLS 1.3 or later) with certificate validation. | 2 | D/V |
| **9.9.7** | **Verify that** SSE-based MCP transports are used only within private, authenticated internal channels and enforce TLS, authentication, schema validation, payload size limits, and rate limiting; SSE endpoints must not be exposed to the public internet. | 2 | D/V |
| **9.9.8** | **Verify that** MCP servers validate the `Origin` and `Host` headers on all HTTP-based transports (including SSE and streamable-HTTP) to prevent DNS rebinding attacks, and reject requests from untrusted, mismatched, or missing origins. | 2 | D/V |

### Schema, Message, and Input Validation

| # | Description | Level | Role |
| :--: | --- | :---: | :--: |
| **9.9.9** | **Verify that** MCP tool and resource schemas (e.g., JSON schemas or capability descriptors) are validated for authenticity and integrity using signatures to prevent schema tampering or malicious parameter modification. | 2 | D/V |
| **9.9.10** | **Verify that** all MCP transports enforce message-framing integrity, strict schema validation, maximum payload sizes, and rejection of malformed, truncated, or interleaved frames to prevent desynchronization or injection attacks. | 2 | D/V |
| **9.9.11** | **Verify that** MCP servers perform strict input validation for all function calls, including type checking, boundary checking, enumeration enforcement, and rejection of unrecognized or oversized parameters. | 2 | D/V |

### Outbound Access & Agent Execution Safety

| # | Description | Level | Role |
| :--: | --- | :---: | :--: |
| **9.9.12** | **Verify that** MCP servers may only initiate outbound requests to approved internal or external destinations following least-privilege egress policies, and cannot access arbitrary network targets or internal cloud metadata services. | 2 | D/V |
| **9.9.15** | **Verify that** outbound MCP actions implement execution limits (timeouts, recursion limits, concurrency caps, circuit breakers) to prevent unbounded agent-driven tool invocation or chained side effects. | 2 | D/V |

### Transport Restrictions & High-Risk Boundary Controls

| # | Description | Level | Role |
| :--: | --- | :---: | :--: |
| **9.9.16** | **Verify that** stdio-based MCP transports are limited to co-located, single-process development scenarios, isolated from shell execution, terminal injection, and process-spawning capabilities; stdio must never cross network or multi-tenant boundaries. | 3 | D/V |
| **9.9.17** | **Verify that** MCP servers expose only allow-listed functions and resources, and prohibit dynamic dispatch, reflective invocation, or execution of function names influenced by user or model-provided input. | 3 | D/V |
| **9.9.18** | **Verify that** tenant boundaries, environment boundaries (dev/test/prod), and data domain boundaries are enforced at the MCP layer, preventing cross-tenant or cross-environment server or resource discovery. | 3 | D/V |

---

## References

* [Model Context Protocol (MCP) Specification](https://modelcontextprotocol.io/)
* [NIST SP 800-207: Zero Trust Architecture](https://csrc.nist.gov/publications/detail/sp/800-207/final)
