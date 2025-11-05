# Contributing to Mineflayer BasicBot

First off, thank you for considering contributing to Mineflayer BasicBot! It's people like you that make this project such a great tool for the Minecraft community.

## Code of Conduct

This project and everyone participating in it is governed by our [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior to the project maintainers.

## How Can I Contribute?

### Reporting Bugs

This section guides you through submitting a bug report. Following these guidelines helps maintainers and the community understand your report, reproduce the behavior, and find related reports.

**Before Submitting A Bug Report:**
- Check the [documentation](README.md) for common issues
- Check if the issue has already been reported in [Issues](https://github.com/RogueZephyr/Mineflayer-Templates/issues)
- Collect information about the bug:
  - Stack trace or error messages
  - Operating system and version
  - Node.js version
  - Minecraft server version
  - Bot configuration (without sensitive data)

**How Do I Submit A Good Bug Report?**

Bugs are tracked as GitHub issues. Create an issue and provide the following information:

- **Use a clear and descriptive title**
- **Describe the exact steps to reproduce the problem**
- **Provide specific examples** (commands, configurations, etc.)
- **Describe the behavior you observed** and what you expected
- **Include screenshots** if relevant
- **Include your environment details** (OS, Node.js version, Minecraft version)

### Suggesting Enhancements

This section guides you through submitting an enhancement suggestion, including completely new features and minor improvements to existing functionality.

**Before Submitting An Enhancement Suggestion:**
- Check if the enhancement has already been suggested
- Check if it aligns with the project's goals
- Think about whether your idea fits the scope of the project

**How Do I Submit A Good Enhancement Suggestion?**

Enhancement suggestions are tracked as GitHub issues. Create an issue and provide:

- **Use a clear and descriptive title**
- **Provide a detailed description** of the suggested enhancement
- **Explain why this enhancement would be useful** to most users
- **List any alternative solutions** you've considered
- **Include mockups or examples** if applicable

### Pull Requests

**Before Submitting a Pull Request:**
- Ensure your code follows the existing code style
- Update documentation to reflect any changes
- Add tests if you're adding functionality
- Ensure all tests pass
- Update the CHANGELOG.md with your changes

**Pull Request Process:**

1. **Fork the repository** and create your branch from `main`
2. **Make your changes** following the coding standards below
3. **Test your changes** thoroughly
4. **Update documentation** as needed
5. **Commit your changes** with clear commit messages
6. **Push to your fork** and submit a pull request
7. **Respond to feedback** from maintainers

## Development Setup

### Prerequisites
- Node.js 16 or higher
- npm (comes with Node.js)
- A Minecraft server for testing (local or remote)

### Setup Steps

1. **Clone your fork:**
   ```bash
   git clone https://github.com/YOUR-USERNAME/Mineflayer-Templates.git
   cd Mineflayer-Templates
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure the bot:**
   - Copy and edit `src/config/config.json` with your server details
   - Update `data/botNames.json` with bot usernames

4. **Run the bot:**
   ```bash
   npm run dev
   ```

## Coding Standards

### JavaScript Style Guide
- Use ES6+ features (import/export, const/let, arrow functions, async/await)
- Use meaningful variable and function names
- Add JSDoc comments for public APIs
- Keep functions small and focused (single responsibility)
- Use 4 spaces for indentation
- Use semicolons

### File Organization
- Place behaviors in `src/behaviors/`
- Place utilities in `src/utils/`
- Place core systems in `src/core/`
- Keep state management in `src/state/`

### Naming Conventions
- **Classes:** PascalCase (e.g., `BotController`, `FarmBehavior`)
- **Functions/Methods:** camelCase (e.g., `enableBehavior`, `harvestCrops`)
- **Constants:** UPPER_SNAKE_CASE (e.g., `MAX_RETRIES`, `DEFAULT_TIMEOUT`)
- **Private methods:** Prefix with underscore (e.g., `_internalHelper`)
- **Files:** PascalCase for classes, camelCase for utilities

### Code Organization

**Behavior Module Structure:**
```javascript
export default class MyBehavior {
    constructor(bot) {
        this.bot = bot;
        this.enabled = false;
        // initialization
    }

    enable() {
        // Setup event listeners
        this.enabled = true;
    }

    disable() {
        // Remove event listeners
        this.enabled = false;
    }

    // Public methods
    async doSomething() { }

    // Private methods
    _helperMethod() { }
}
```

### Documentation Standards

- **Add JSDoc comments** for all public methods and classes
- **Update README.md** when adding features
- **Update relevant docs** in the `docs/` directory
- **Include inline comments** for complex logic
- **Add examples** in documentation for new features

**JSDoc Example:**
```javascript
/**
 * Harvests crops in the specified area
 * @param {Object} area - The farming area {start: Vec3, end: Vec3}
 * @param {boolean} replant - Whether to replant after harvesting
 * @returns {Promise<number>} Number of crops harvested
 */
async harvestCrops(area, replant = true) {
    // implementation
}
```

### Testing

While we don't currently have automated tests, please:
- **Manually test** your changes thoroughly
- **Test with multiple bot configurations**
- **Test edge cases** (empty inventory, missing tools, etc.)
- **Document test scenarios** in your PR description

### Commit Messages

Follow conventional commits format:

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types:**
- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `style:` Code style changes (formatting, etc.)
- `refactor:` Code refactoring
- `perf:` Performance improvements
- `test:` Adding tests
- `chore:` Maintenance tasks

**Examples:**
```
feat(farming): add support for pumpkin farming

Implements pumpkin detection and harvesting logic.
Includes replanting and collection.

Closes #123
```

```
fix(mining): correct tool durability check

The previous check was causing premature tool switching.
Now properly checks remaining durability before switching.
```

## Project Structure

Understanding the project structure will help you contribute effectively:

```
Mineflayer-Templates/
├── src/
│   ├── index.js              # Entry point, multi-bot spawner
│   ├── core/                 # Core systems
│   │   ├── BotController.js  # Main bot lifecycle
│   │   ├── BotCoordinator.js # Multi-bot coordination
│   │   └── ConfigLoader.js   # Configuration management
│   ├── behaviors/            # Bot behavior modules
│   │   ├── FarmBehavior.js
│   │   ├── MiningBehavior.js
│   │   ├── WoodCuttingBehavior.js
│   │   └── ...
│   ├── utils/                # Utility modules
│   │   ├── ChatCommandHandler.js
│   │   ├── ToolHandler.js
│   │   └── ...
│   ├── state/                # State management
│   └── config/               # Configuration files
├── data/                     # Runtime data (generated)
├── docs/                     # Additional documentation
├── package.json
├── README.md
└── CONTRIBUTING.md
```

## Adding a New Behavior

To add a new behavior module:

1. **Create a new file** in `src/behaviors/` (e.g., `MyBehavior.js`)
2. **Implement the behavior** following the standard structure
3. **Register in BotController.js** to enable it for all bots
4. **Add commands** in `ChatCommandHandler.js` if needed
5. **Document** in README.md and create a doc in `docs/`
6. **Test** thoroughly with different scenarios

## Adding a New Command

To add a new command:

1. **Open** `src/utils/ChatCommandHandler.js`
2. **Add your command** to the appropriate section
3. **Implement the handler** function
4. **Add to permission system** in `data/whitelist.json` structure
5. **Document** in README.md command section
6. **Test** with different permission levels

## Documentation Updates

When making changes, please update:

- **README.md** - For user-facing features
- **CHANGELOG.md** - For all notable changes
- **docs/** - For technical documentation
- **Inline comments** - For complex code
- **JSDoc comments** - For public APIs

## Community

- **Questions?** Open a [Discussion](https://github.com/RogueZephyr/Mineflayer-Templates/discussions)
- **Found a bug?** Open an [Issue](https://github.com/RogueZephyr/Mineflayer-Templates/issues)
- **Want to help?** Check [Issues labeled "good first issue"](https://github.com/RogueZephyr/Mineflayer-Templates/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)

## Recognition

Contributors will be recognized in:
- The project README
- Release notes
- GitHub contributor stats

Thank you for contributing to Mineflayer BasicBot! 🎮🤖
