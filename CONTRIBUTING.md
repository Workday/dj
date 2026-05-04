# Contributing to Workday DJ (Data JSON) Framework

Thank you for your interest in contributing to the Workday DJ (Data JSON) Framework VS Code extension! This document provides guidelines and information for contributors.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Submitting Changes](#submitting-changes)
- [Reporting Issues](#reporting-issues)

## Code of Conduct

This project and everyone participating in it is governed by our Code of Conduct. By participating, you are expected to uphold this code.

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally
3. **Set up the development environment** - see **[Development Setup Guide](DEVELOPMENT_SETUP.md)**
4. **Create a new branch** for your changes

## Development Workflow

Check [Development Setup](DEVELOPMENT_SETUP.md) for setting up your local development environment.

Once you have your development environment set up:

1. **Make your changes** in a feature branch
2. **Test your changes** thoroughly
3. **Follow coding standards** and project conventions
4. **Update documentation** if your changes affect user-facing features

## Submitting Changes

### Pull Request Process

1. **Ensure tests pass** before submitting
2. **Update documentation** if needed
3. **Follow the commit message format**:

```text
type(scope): description

[optional body]
[optional footer]
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`
Scopes: `extension`, `web`, `macros`, `schemas`, `scripts`

4. **Update CHANGELOG.md** with your changes
5. **Increment version** in `package.json` and run `npm audit fix` to fix any dependencies issues

### Packaging the Extension (VSIX)

To build a VSIX for testing/install:

```bash
npm run vscode:prepublish && npm run package
```

### Code Review

- All changes require review from maintainers
- Address feedback and make requested changes
- Ensure CI/CD checks pass

## Reporting Issues

### Bug Reports

When reporting bugs, please include:

- **Description** of the problem
- **Steps to reproduce**
- **Expected vs actual behavior**
- **Environment details** (OS, VS Code version, extension version)
- **Screenshots or logs** if applicable

### Feature Requests

For feature requests:

- **Describe the feature** you'd like to see
- **Explain the use case** and benefits
- **Consider implementation complexity**
- **Check if it aligns** with project goals

## Getting Help

- **GitHub Issues**: For bugs and feature requests
- **GitHub Discussions**: For questions and general discussion
- **Documentation**: Check the [Documentation](docs/) for comprehensive guides

## License

By contributing to this project, you agree that your contributions will be licensed under the Apache License 2.0.

---

Thank you for contributing to making this extension better for the dbt community!
