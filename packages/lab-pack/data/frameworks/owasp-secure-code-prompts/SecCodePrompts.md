# Secure code prompts

Secure code prompt library (MIT) bundled with the OWASP Secure Agent Playbook.

Publisher: OWASP Secure Agent Playbook. Edition: SecCodePrompts.
Source tree: https://github.com/OWASP/secure-agent-playbook/tree/65d4efd2cd0b081d52101e9708792b944e4ddebb/plugins/code-security-skills/data/secure-code-prompts (4 sections).

## Secure API Design Checklist

# Secure API Design Checklist

Apply these security principles when building API functionality. Addresses OWASP API Security Top 10 risks.

## Maintainability

- [ ] Modularize security logic (auth, validation, error handling) for clean reuse and updates
- [ ] Centralize security configs under version control — no hardcoding
- [ ] Standardize error/response schemas and log structures across services
- [ ] Document decisions and security trade-offs using OpenAPI or Markdown files
- [ ] Add regression tests for known vulnerabilities and past pentest findings

## Resilience

- [ ] Apply rate limiting and throttling (per token/IP/etc.) with clear failure responses (`429`)
- [ ] Use circuit breakers and fallback logic for dependencies and external services
- [ ] Gracefully handle errors without crashing; log details, return stable responses
- [ ] Implement liveness/readiness health checks and configure upstream timeouts
- [ ] Periodically load test and simulate failures to verify API behavior under stress

## Authentication & Authorization

- [ ] Use OAuth 2.0 with PKCE or OpenID Connect; avoid Basic Auth
- [ ] Enforce strong JWT validation (`alg`, expiration, issuer)
- [ ] Store secrets in a vault — never in code or configs
- [ ] Apply RBAC: check user permissions on every request
- [ ] Validate `redirect_uri` and use the `state` parameter in OAuth flows
- [ ] Secure all endpoints by default; document exceptions explicitly

## Data Protection

- [ ] Enforce HTTPS (TLS 1.2 or higher) and use strong cipher suites
- [ ] Add HSTS headers with preload and `includeSubDomains`
- [ ] Encrypt sensitive data at rest with AES-256 GCM or equivalent
- [ ] Never log or expose secrets, tokens, or PII in URLs or error messages
- [ ] Use vetted cryptographic libraries (e.g. libsodium, BouncyCastle)

## Input Validation

- [ ] Validate all inputs server-side (headers, body, query, etc.)
- [ ] Use JSON Schema or shared validators across services
- [ ] Enforce proper `Content-Type` and `Accept` headers
- [ ] Use parameterized queries — never build SQL strings manually
- [ ] Disable DTDs and external entities in XML parsers

## Logging & Error Handling

- [ ] Log authentication failures, denied access, and system errors
- [ ] Avoid logging secrets, passwords, or sensitive identifiers
- [ ] Send users generic error messages (e.g., "Invalid input"); log details internally
- [ ] Use correlation IDs in logs to trace request chains

## Testing & Deployment

- [ ] Write tests for authentication, validation, and error-handling flows
- [ ] Include negative tests (e.g., tampered tokens, malformed input)
- [ ] Store configs (e.g., allowed HTTP methods, token expiry) in version control
- [ ] Keep dependencies updated; review security PRs with intention

## References

- [OWASP API Security Top 10 (2023)](https://owasp.org/API-Security/)
- [OWASP API Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html)
## AWS CloudFormation Security Review

# AWS CloudFormation Security Review

Review CloudFormation templates for security risks, insecure configurations, and potential misconfigurations.

## 1. Identity and Access Management (IAM)

Review IAM resources including Roles, Policies, Instance Profiles, and Service Roles.

Check for:
- Overly permissive policies (`Action: "*"`)
- Wildcard resources (`Resource: "*"`)
- Excessive administrative privileges
- Roles assumable by unintended principals
- Missing separation of duties

Recommend least privilege IAM policies.

## 2. Secrets and Sensitive Data

Identify whether the template:
- Embeds secrets directly in parameters
- Stores credentials in plaintext
- Exposes API keys or access tokens
- Stores secrets in environment variables without secure handling

Recommend using AWS Secrets Manager, SSM Parameter Store, or encrypted parameters.

## 3. Network Security

Review Security Groups, Network ACLs, Load Balancers, and VPC configuration.

Check for:
- Open ingress rules (`0.0.0.0/0`)
- Publicly accessible databases
- Unrestricted SSH or RDP access
- Internal services exposed to the internet
- Missing network segmentation

## 4. Storage Security

Review S3 buckets, EBS volumes, EFS, and RDS storage.

Check whether:
- S3 buckets allow public access
- Encryption at rest is disabled
- Versioning is missing
- Public read/write access is enabled

## 5. Encryption

Verify encryption for sensitive resources (S3, RDS, EBS, SQS, SNS):
- Encryption at rest is enabled
- Customer-managed keys (KMS) are used when appropriate
- Encryption in transit is enforced

## 6. Logging and Monitoring

Check whether the template enables:
- CloudTrail
- CloudWatch Logs
- VPC Flow Logs
- S3 access logging

Identify missing logging controls that could prevent detection of security incidents.

## 7. Public Resource Exposure

Identify resources exposed to the public internet:
- EC2 instances
- Load balancers
- Databases
- Admin interfaces
- Management APIs

Evaluate whether exposure is necessary and recommend limiting access.

## 8. Resource Hardening

Check whether compute resources are hardened (EC2, containers, Lambda):
- Overly permissive instance roles
- Outdated AMIs
- Lack of runtime restrictions
- Missing patch management practices

## 9. Infrastructure Misconfiguration

Identify general infrastructure risks:
- Insecure defaults
- Lack of network isolation
- Missing resource limits
- Lack of tagging or environment separation

## 10. Supply Chain and Template Integrity

Check for:
- Templates pulled from untrusted sources
- Unverified nested stacks
- Lack of template validation or scanning
- Deployment pipelines lacking security checks

## Output Format

For each finding:
- **Severity**: Critical / High / Medium / Low
- **Resource**: CloudFormation resource affected
- **Issue**: Description of the security problem
- **Impact**: Why this is dangerous
- **Recommendation**: How to fix it
- **Example Fix**: Suggested CloudFormation configuration improvement

## Guidance & Reference Sources

- [CIS AWS Foundations Benchmark](https://www.cisecurity.org/benchmark/amazon_web_services)
- [AWS Well-Architected Framework — Security Pillar](https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/welcome.html)
- [AWS CloudFormation Best Practices](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/best-practices.html)
- [cfn-lint](https://github.com/aws-cloudformation/cfn-lint) and [cfn-nag](https://github.com/stelligent/cfn_nag)
## Kubernetes Security Review

# Kubernetes Security Review

Review Kubernetes configuration files for security risks, insecure patterns, and misconfigurations.

## 1. Pod Security Configuration

Check whether containers:
- Run as root
- Lack `runAsNonRoot`
- Allow privilege escalation
- Run in `privileged: true` mode
- Mount sensitive host paths
- Use `hostNetwork`, `hostPID`, or `hostIPC`
- Lack seccomp profiles
- Lack AppArmor or SELinux policies

Recommend secure `securityContext` configurations.

## 2. Container Image Security

Check for:
- Images using `latest` tag
- Unpinned image versions
- Images from untrusted registries
- Lack of image provenance verification
- Containers running outdated base images

Recommend pinned versions and trusted registries.

## 3. Secrets Management

Identify:
- Secrets stored in plain text in manifests
- Secrets embedded directly in environment variables
- ConfigMaps used for sensitive data
- Missing integration with secret management systems (Vault, External Secrets Operator, etc.)

## 4. RBAC and Permissions

Review Role, ClusterRole, RoleBinding, and ClusterRoleBinding definitions.

Check for:
- Wildcard permissions (`*`)
- Overly broad `cluster-admin` privileges
- Roles applied at cluster scope unnecessarily
- Service accounts with excessive privileges

Recommend least privilege RBAC policies.

## 5. Network Security

Analyze Services, NetworkPolicies, and Ingress configurations.

Identify:
- Missing NetworkPolicies
- Pods exposed without restrictions
- Services exposed externally unnecessarily
- Public LoadBalancers exposing internal services
- Ingress rules allowing unrestricted access

Recommend proper network segmentation and policies.

## 6. Resource Constraints

Check for missing resource constraints:
- CPU limits
- Memory limits
- Resource requests

Missing constraints can allow denial-of-service conditions or cluster instability.

## 7. Sensitive Volume Mounts

Identify containers mounting:
- Docker socket paths
- `/etc` directories
- `/proc` filesystem
- Host filesystem paths

These mounts can allow container escape or host compromise.

## 8. Logging and Monitoring

Check whether workloads support:
- Centralized logging
- Security event monitoring
- Audit logging

Recommend enabling Kubernetes audit logging and observability tools.

## 9. Supply Chain Risks

Identify:
- Helm charts from unverified sources
- Containers without vulnerability scanning
- Unpinned Helm chart versions
- Untrusted container registries

Recommend secure supply chain practices.

## 10. Service Exposure Risks

Identify publicly exposed services that could expose sensitive systems:
- Databases
- Internal APIs
- Admin dashboards
- Message queues

Recommend internal-only networking where appropriate.

## Output Format

For each finding:
- **Severity**: Critical / High / Medium / Low
- **Resource**: Kubernetes resource affected
- **Issue**: Description of the security problem
- **Impact**: Why this is dangerous
- **Recommendation**: How to fix it
- **Example Fix**: Suggested Kubernetes configuration improvement

## Guidance & Reference Sources

- [CIS Kubernetes Benchmark](https://www.cisecurity.org/benchmark/kubernetes)
- [NSA/CISA Kubernetes Hardening Guide](https://media.defense.gov/2022/Aug/29/2003066362/-1/-1/0/CTR_KUBERNETES_HARDENING_GUIDANCE_1.2_20220829.PDF)
- [OWASP Kubernetes Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Kubernetes_Security_Cheat_Sheet.html)
- [Pod Security Standards (PSS)](https://kubernetes.io/docs/concepts/security/pod-security-standards/)
## Terraform Security Review

# Terraform Security Review

Review Terraform configurations for security risks, misconfigurations, and insecure patterns.

## 1. Identity and Access Management

Check for:
- Overly permissive IAM policies
- Wildcard permissions (`*`)
- Lack of least privilege
- Hardcoded credentials or access keys
- Publicly assumable roles
- Improper trust relationships

## 2. Secrets Management

Identify:
- Hardcoded secrets
- Tokens or API keys in Terraform variables
- Secrets stored in plain text
- Secrets passed via environment variables insecurely
- Missing use of secret managers (Vault, AWS Secrets Manager, etc.)

## 3. Network Security

Review:
- Publicly exposed services
- Security groups with open ingress rules (e.g., `0.0.0.0/0`)
- Unrestricted ports such as SSH (22), RDP (3389), databases
- Missing network segmentation
- Missing private networking for sensitive resources

## 4. Storage Security

Check whether storage resources:
- Allow public access
- Lack encryption at rest
- Lack versioning or backup protections
- Allow insecure transport

## 5. Encryption

Verify that:
- Encryption at rest is enabled
- Encryption in transit is enforced
- Managed keys or KMS services are used
- Sensitive resources do not use default or weak encryption settings

## 6. Logging and Monitoring

Check whether:
- Logging is enabled for critical services
- Audit logs are configured
- Monitoring alerts exist for security events

## 7. Resource Exposure

Identify resources that may expose sensitive services to the internet:
- Databases
- Internal APIs
- Message queues
- Admin interfaces

## 8. Terraform-Specific Risks

Check for:
- Use of `terraform state` that may expose secrets
- Sensitive variables not marked `sensitive = true`
- Lack of remote state encryption
- Remote state without locking
- Unsafe module sources
- Unpinned module or provider versions
- Use of untrusted modules

## 9. Supply Chain Risks

Identify:
- Unpinned provider versions
- External modules without version constraints
- Modules from unverified sources

## 10. Cost and Abuse Risks

Flag configurations that could allow:
- Resource abuse
- Crypto mining infrastructure
- Unlimited scaling without guardrails

## Output Format

For each finding:
- **Severity**: Critical / High / Medium / Low
- **Resource**: Terraform resource affected
- **Issue**: Description of the security problem
- **Impact**: Why this is dangerous
- **Recommendation**: How to fix it
- **Example Fix**: Suggested Terraform code improvement

## References

- [CIS Benchmark for AWS/Azure/GCP](https://www.cisecurity.org/cis-benchmarks)
- [OWASP Infrastructure Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Infrastructure_as_Code_Security_Cheat_Sheet.html)
- [Terraform Security Best Practices — HashiCorp](https://developer.hashicorp.com/terraform/cloud-docs/recommended-practices)
