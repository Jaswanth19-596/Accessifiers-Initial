# Accessifiers — Architecture Documentation

## What is Accessifiers?

**Accessifiers** is a **web accessibility scanning tool** that audits any public website for accessibility issues and gives it a score based on how well it complies with **WCAG (Web Content Accessibility Guidelines)** standards.

It's built as a full-stack app with two parts:

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────┐
│                 React Frontend (Scanner.jsx)          │
│  User enters a URL → Sends it to the backend API     │
└────────────────────┬─────────────────────────────────┘
                     │ HTTP POST
┌────────────────────▼─────────────────────────────────┐
│          Node.js Backend (server.js)                  │
│  Launches a headless Chrome browser via Playwright   │
│  Runs axe-core accessibility checks on the page     │
│  Returns violations, passes, and a score (0-100)    │
└──────────────────────────────────────────────────────┘
```

---

## Frontend — `frontend/src/Scanner.jsx`

A React UI that lets the user:

1. **Enter a URL** to scan (must start with `http://` or `https://`)
2. **Optionally configure** a backend URL via a settings panel
3. **Click "Scan Website"** to trigger the scan
4. **View the results**, which include:
   - An overall **accessibility score** (0–100)
   - A **breakdown** of issues by severity: Critical, Serious, Moderate, Minor
   - A **list of violations** — each with:
     - The rule ID and description
     - Which HTML elements are affected (CSS selectors + HTML snippets)
     - A failure summary explaining *why* it failed
     - A "Learn how to fix" link
   - **Rules that passed** (collapsed, expandable)
   - **Items needing manual review** (incomplete checks)

### Score Rating Scale

| Score | Label |
|---|---|
| 90–100 | ✅ Excellent |
| 70–89 | 🟡 Good |
| 50–69 | 🟠 Needs Improvement |
| 0–49 | 🔴 Poor |

---

## Backend — `accessibility-scanner-backend/server.js`

A **Node.js + Express** API server.

### `POST /api/scan-accessibility` *(primary endpoint)*

The main scan flow:
1. Launches a **headless Chromium browser** using [Playwright](https://playwright.dev/)
2. Navigates to the given URL with **3 fallback strategies** (networkidle → domcontentloaded → commit)
3. Runs **[axe-core](https://github.com/dequelabs/axe-core)** via `@axe-core/playwright`
4. Checks against **WCAG 2.0 A & AA** rules by default (configurable)
5. Calculates a **weighted score** — violations cost more points based on severity:
   - Critical: −10 pts/element
   - Serious: −7 pts/element
   - Moderate: −4 pts/element
   - Minor: −1 pt/element
6. **Saves results** to a local `database.json` file
7. Returns the full results to the frontend

### `POST /api/scan-batch`

Scans **up to 10 URLs** at once, processing up to 3 concurrently.

### `GET /api/rules`

Lists all available **axe-core rules and tags** with descriptions.

### `GET /api/health`

Health check that launches a test browser instance and reports uptime, memory usage, and Playwright status.

### `POST /api/accessibility-insights` *(legacy/deprecated)*

Uses the `accessibility-insights-scan` CLI tool (crawls the site and generates HTML/SARIF reports). Less detailed than the primary endpoint.

---

## Local Database

Scan results are persisted to `database.json` in a flat JSON format. Each scan record stores:
- The scanned URL + timestamp
- The score and summary stats (violations, passes, total nodes)
- Every individual violation as a `reportNavigation` entry, with the CSS selector, HTML snippet, and failure message

---

## Key Libraries

| Library | Purpose |
|---|---|
| `playwright` | Headless Chrome browser automation |
| `@axe-core/playwright` | Accessibility rule engine integrated with Playwright |
| `accessibility-insights-scan` | Legacy CLI-based accessibility crawler |
| `express` | REST API server |
| `dotenv` | Environment variable management |
| `cors` | Cross-origin support so the React frontend can call the backend |

---

## Summary

You paste a URL → it opens it in a headless Chrome → runs hundreds of accessibility checks → returns a scored report showing exactly which elements fail WCAG standards, down to the specific HTML snippet and CSS selector of the broken element. It's a self-hosted alternative to tools like [WAVE](https://wave.webaim.org/) or [Lighthouse Accessibility](https://developers.google.com/web/tools/lighthouse).
