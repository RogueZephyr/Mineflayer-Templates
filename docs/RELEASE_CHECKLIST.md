# Release Checklist

This document outlines the steps to prepare and publish a new release of Mineflayer BasicBot.

## Pre-Release Checklist

### Documentation
- [ ] Update CHANGELOG.md with new version and changes
- [ ] Update README.md if there are new features or changes
- [ ] Review and update all docs in `docs/` directory
- [ ] Ensure GETTING_STARTED.md is up to date
- [ ] Update any code examples in documentation

### Code Quality
- [ ] Run syntax check: `node --check src/index.js`
- [ ] Test bot startup: `npm run dev`
- [ ] Test major features (farming, mining, woodcutting)
- [ ] Verify all commands work as expected
- [ ] Check for any TODO or FIXME comments that need addressing
- [ ] Review and clean up console logs

### Configuration
- [ ] Update version in package.json
- [ ] Verify package.json metadata (description, keywords, repository)
- [ ] Check all config examples are valid
- [ ] Ensure data files contain only templates, no personal data

### Security
- [ ] Run `npm audit` and address any vulnerabilities
- [ ] Review SECURITY.md is current
- [ ] Check .gitignore excludes sensitive files
- [ ] Verify no credentials are committed

### Dependencies
- [ ] Update dependencies if needed: `npm update`
- [ ] Test after dependency updates
- [ ] Check for deprecated dependencies
- [ ] Review licenses of dependencies

### GitHub
- [ ] Issue templates are up to date
- [ ] Pull request template is current
- [ ] README badges work correctly
- [ ] Links in documentation are valid

## Release Process

### 1. Version Bump

Update version in package.json following [Semantic Versioning](https://semver.org/):
- **MAJOR** version for incompatible API changes
- **MINOR** version for new functionality (backward compatible)
- **PATCH** version for bug fixes (backward compatible)

### 2. Update CHANGELOG

Add new section to CHANGELOG.md:
```markdown
## Version X.Y.Z - YYYY-MM-DD

### Added
- New feature descriptions

### Changed
- Modified feature descriptions

### Fixed
- Bug fix descriptions

### Security
- Security fix descriptions
```

### 3. Commit Changes

```bash
git add .
git commit -m "Release version X.Y.Z"
git push origin main
```

### 4. Create Git Tag

```bash
git tag -a vX.Y.Z -m "Release version X.Y.Z"
git push origin vX.Y.Z
```

### 5. Create GitHub Release

1. Go to GitHub repository
2. Click "Releases" → "Draft a new release"
3. Select the tag you just created
4. Title: "Version X.Y.Z"
5. Description: Copy relevant section from CHANGELOG.md
6. Mark as pre-release if appropriate
7. Publish release

### 6. Verify Release

- [ ] GitHub release is visible
- [ ] Tag appears in repository
- [ ] Release notes are complete
- [ ] Download and test the release archive

## Post-Release

### Announcements
- [ ] Update project documentation website (if applicable)
- [ ] Announce on relevant forums/communities
- [ ] Update any external documentation

### Monitoring
- [ ] Monitor GitHub issues for bug reports
- [ ] Check discussion boards for feedback
- [ ] Watch for security advisories

### Next Steps
- [ ] Create milestone for next version
- [ ] Update roadmap.md if applicable
- [ ] Plan next feature set

## Hotfix Process

For urgent fixes:

1. Create hotfix branch from latest release tag
   ```bash
   git checkout -b hotfix-X.Y.Z vX.Y.Z
   ```

2. Fix the issue
3. Update CHANGELOG.md
4. Bump patch version (e.g., 1.0.0 → 1.0.1)
5. Commit and tag
   ```bash
   git commit -m "Hotfix: description"
   git tag -a vX.Y.(Z+1) -m "Hotfix version X.Y.(Z+1)"
   # Example: git tag -a v1.0.1 -m "Hotfix version 1.0.1"
   ```

6. Merge back to main
   ```bash
   git checkout main
   git merge hotfix-X.Y.Z
   git push origin main
   git push origin vX.Y.(Z+1)
   # Example: git push origin v1.0.1
   ```

7. Create GitHub release for hotfix

## Version History

### Version 1.0.0 - November 5, 2025
- Initial public release
- Full feature set documented
- Open source essentials added (LICENSE, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY)
- Comprehensive documentation
- GitHub templates for issues and PRs

## Notes

- Always test thoroughly before release
- Keep CHANGELOG.md updated
- Follow semantic versioning strictly
- Communicate breaking changes clearly
- Maintain backward compatibility when possible
