# Contributing to OpenOnyx

Thank you for your interest in contributing to OpenOnyx! OpenOnyx is an open-source, local-first, AI-assisted knowledge management tool for desktop. We welcome contributions of all kinds, including bug fixes, feature enhancements, documentation improvements, and plugin runtime compatibility updates.

---

## Code of Conduct

All contributors and maintainers are expected to adhere to the [Code of Conduct](CODE_OF_CONDUCT.md). Please read it before participating in our community.

---

## Getting Started

### Prerequisites

Ensure you have the following installed on your development machine:
- **Node.js**: v24.x or newer
- **npm**: v9.x or newer
- **Git**

### Setting Up Your Local Environment

1. **Fork the Repository:**
   Click the **Fork** button at the top right of the GitHub page to create your own copy of the repository.

2. **Clone Your Fork:**
   ```bash
   git clone https://github.com/YOUR_USERNAME/OpenOnyx.git
   cd OpenOnyx
   ```

3. **Install Dependencies:**
   ```bash
   npm install
   ```

4. **Start the Local Development Server:**
   ```bash
   npm run dev
   ```
   This command starts the Vite development server on `http://localhost:5173`, compiles the Electron process, and launches the desktop app.

---

## Development Workflow

### Branching Guidelines

Create a descriptive feature branch from the `main` branch:
```bash
git checkout -b feature/your-feature-name
# or for bug fixes:
git checkout -b fix/issue-description
```

### Key Development Commands

| Command | Description |
| :--- | :--- |
| `npm run dev` | Launch the desktop app with Vite hot-reloading |
| `npm run lint` | Run TypeScript type checking (`tsc --noEmit`) |
| `npm run build` | Compile the renderer and Electron processes |
| `npm run package` | Package desktop installers locally |
| `npm run test:all-checks` | Run full test suite and verification suite |

---

## Quality Checks & Verification

Before submitting a pull request, run the verification checks to ensure there are no compilation or runtime regressions:

1. **TypeScript Type Check:**
   ```bash
   npm run lint
   ```

2. **Full Verification Suite:**
   ```bash
   npm run test:all-checks
   ```

---

## Submitting a Pull Request (PR)

1. **Keep PRs Focused:** Small, single-purpose PRs are reviewed and merged much faster.
2. **Write Clear Commit Messages:** Use descriptive commit titles (e.g., `fix(editor): fix line wrap calculation on window resize`).
3. **Open the PR:**
   - Push your branch: `git push origin feature/your-feature-name`
   - Open a pull request against the `main` branch of `OpenOnyx/OpenOnyx`.
   - Complete the PR template checklist provided in the PR creation form.

---

## Security Disclosures

If you discover a potential security vulnerability, please do **not** open a public issue. Follow our private security disclosure instructions in [SECURITY.md](SECURITY.md).
