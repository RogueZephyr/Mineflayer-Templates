# Security Policy

## Supported Versions

We take security seriously and provide security updates for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

We appreciate your efforts to responsibly disclose your findings and will make every effort to acknowledge your contributions.

### How to Report a Security Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please report them via one of the following methods:

1. **GitHub Security Advisories** (Preferred)
   - Navigate to the [Security tab](https://github.com/RogueZephyr/Mineflayer-Templates/security)
   - Click "Report a vulnerability"
   - Fill in the details

2. **Email**
   - Contact the project maintainers through GitHub
   - Use the subject line: "Security Vulnerability Report - Mineflayer BasicBot"

### What to Include in Your Report

To help us better understand and resolve the issue quickly, please include:

- **Type of vulnerability** (e.g., credential exposure, code injection, etc.)
- **Full paths** of source file(s) related to the vulnerability
- **Location** of the affected source code (tag/branch/commit or direct URL)
- **Step-by-step instructions** to reproduce the issue
- **Proof-of-concept or exploit code** (if possible)
- **Impact** of the issue, including how an attacker might exploit it

### What to Expect

- **Acknowledgment**: We'll acknowledge receipt of your vulnerability report within 48 hours
- **Updates**: We'll send you regular updates about our progress
- **Timeline**: We aim to resolve critical issues within 30 days
- **Credit**: If you'd like, we'll credit you in the security advisory

## Security Best Practices for Users

### Configuration Security

1. **Protect Credentials**
   - Never commit `config.json` with real credentials to version control
   - Use environment variables for sensitive data when possible
   - Rotate bot passwords regularly

2. **Whitelist Management**
   - Keep `data/whitelist.json` updated
   - Remove access for inactive users promptly
   - Use the principle of least privilege

3. **Server Connection**
   - Only connect to trusted Minecraft servers
   - Be aware of server-side plugins that might interact with bots
   - Use secure connections when possible

### File System Security

1. **Data Directory**
   - Ensure `data/` directory has appropriate permissions
   - Don't share files from `data/` that might contain sensitive information
   - Regularly clean up old logs and diagnostics

2. **Dependencies**
   - Keep dependencies up to date: `npm audit fix`
   - Review dependency updates before applying
   - Use `npm audit` regularly to check for vulnerabilities

### Runtime Security

1. **Bot Permissions**
   - Don't give bots unnecessary server permissions
   - Monitor bot behavior for unexpected actions
   - Use the whitelist system to control who can command bots

2. **Command Security**
   - Be cautious with commands that affect world state
   - Validate all command inputs
   - Review command logs regularly

## Known Security Considerations

### Bot Account Security

- **Credentials**: Bot accounts use Minecraft credentials which should be protected
- **Account Type**: Consider using offline-mode accounts for testing or dedicated bot accounts
- **Session Tokens**: The bot maintains session tokens during runtime

### Network Security

- **Server Communication**: All communication uses Minecraft protocol (unencrypted by default)
- **Whisper Messages**: Whisper patterns are configurable; validate input appropriately
- **Command Injection**: Commands are parsed and validated before execution

### Data Storage

- **Local Files**: Configuration and state are stored in JSON files
- **No Encryption**: Currently, no data is encrypted at rest
- **File Permissions**: Ensure appropriate file system permissions

## Disclosure Policy

- We request that you give us reasonable time to investigate and fix the issue before public disclosure
- We'll work with you to understand and resolve the issue quickly
- We'll publicly acknowledge your responsible disclosure (unless you prefer to remain anonymous)

## Security Updates

Security updates will be released as:
- **Patch versions** for minor issues (e.g., 1.0.1)
- **Minor versions** for moderate issues (e.g., 1.1.0)
- **Immediate hotfixes** for critical issues

Updates will be announced via:
- GitHub Security Advisories
- Release notes
- README updates

## Scope

### In Scope
- Vulnerabilities in the bot code itself
- Configuration security issues
- Dependency vulnerabilities in our direct dependencies
- Authentication and authorization issues

### Out of Scope
- Minecraft server vulnerabilities
- Minecraft client vulnerabilities
- Third-party plugin vulnerabilities
- Social engineering attacks
- Physical security

## Security Testing

We encourage security researchers to:
- Test on their own private Minecraft servers
- Use separate test accounts
- Follow responsible disclosure practices
- Not disrupt public servers or other users

## Additional Resources

- [Mineflayer Security Considerations](https://github.com/PrismarineJS/mineflayer/blob/master/docs/FAQ.md)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)
- [npm Security Advisories](https://www.npmjs.com/advisories)

## Contact

For questions about this security policy, please open a discussion on GitHub.

---

**Last Updated**: November 2025  
**Version**: 1.0.0
