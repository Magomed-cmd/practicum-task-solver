# Practicum Task Solver

Chrome MV3 extension for automating Yandex Practicum flow:

- solves the current task through the Practicum API
- moves through theory and transition screens
- continues to the next task automatically
- writes detailed diagnostic logs to a local file

## Documentation

GitHub does not render repository HTML files as a styled README.  
Because of that, this repository uses two entry points:

- GitHub-friendly documentation: this `README.md`
- Full visual documentation: `docs/index.html`

Rendered HTML docs:

- GitHub Pages: [magomed-cmd.github.io/practicum-task-solver](https://magomed-cmd.github.io/practicum-task-solver/)

If Pages is not live yet, open the local file directly:

- `/Users/valiev/Downloads/practicum-task-solver/docs/index.html`

If this is the first Pages deployment for the repository:

1. Open GitHub repository settings
2. Go to `Pages`
3. Set source to `GitHub Actions`

## Quick Start

1. Open `chrome://extensions`
2. Enable Developer mode
3. Load unpacked extension from `/Users/valiev/Downloads/practicum-task-solver`
4. Optionally start the local log server:

```bash
cd /Users/valiev/Downloads/practicum-task-solver
node logger-server.js
```

## Main Files

- `manifest.json` — MV3 manifest and permissions
- `background.js` — automation orchestration and tab lifecycle
- `pageActions.js` — page-side solve and navigation logic
- `popup.html` / `popup.js` — control UI
- `config.js` — automation rules and timings
- `logger-server.js` — local HTTP server for logs
- `task-solver.log` — runtime log, ignored by git
- `docs/index.html` — full visual documentation

## Development

```bash
git clone https://github.com/Magomed-cmd/practicum-task-solver.git
cd practicum-task-solver
```

Follow logs:

```bash
tail -f task-solver.log
```
