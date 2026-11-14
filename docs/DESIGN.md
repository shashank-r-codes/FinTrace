# FinTrace Design Principles & Evidentiary Design System

> **Methodological Source & Credit Line**:  
> UI refinement method adapted from [unslop by Damir Sokolovsky (@heydamir)](https://github.com/heydamir/unslop), CC BY 4.0.

This document defines the visual character, typography, tokens, geometry, component rules, and copy guidelines for the FinTrace platform. Any future interfaces, officer tools, or citizen portal pages must adhere strictly to these standards to prevent regression into decorative slop.

---

## 1. Character & Product Metaphor

FinTrace serves two distinct audiences facing intense financial stress:
1. **Law Enforcement Investigators & Bank Nodal Officers**: Working under extreme time pressure to trace and freeze stolen funds before physical ATM withdrawals.
2. **Victim Citizens**: Ordinary individuals who have just lost money through UPI, phishing, or investment fraud and require calm, reassuring, jargon-free support.

### The Forensic Evidentiary Ledger
The visual metaphor is that of an **official court-admissible forensic docket**:
- **Calm, Exact, Trustworthy**: Eliminates neon accents, sci-fi glows, decorative gradients, dark mode saturated blues, and floating glassmorphism.
- **Evidentiary Restraint**: Surfaces are neutral and quiet. Color is strictly reserved for two specific moments:
  1. **Risk Status & Signals**: (Critical `#DC2626`, High `#D97706`, Medium `#3489E8`, Low `#10B981`).
  2. **Primary User Action**: (Interactive primary CTA `#3489E8`).
- **Chain of Custody**: Cryptographic hashes (SHA-256), timestamps, account IDs, and UTRs are rendered with equal importance and strict alignment (`tabular-nums`).

---

## 2. Palette & Theme Tokens

FinTrace preserves the existing base tokens while defining strict semantic boundaries:

### Light Mode Foundation
- **App Canvas**: `#F4F8FF` (Cool evidentiary ground)
- **Card Surface**: `#FFFFFF` (Clean docket surface)
- **Sidebar Surface**: `#FFFFFF`
- **Subtle Surface**: `#EDF4FF` (Nested containers, table zebra, input background)
- **Highlight Surface**: `#DCEEFF` (Active selections, hover states)
- **Hairline Borders**: `rgba(23, 43, 77, 0.08)` (Subtle), `rgba(23, 43, 77, 0.16)` (Strong)

### Dark Mode Foundation
- **App Canvas**: `#0B1120` (Deep obsidian ground)
- **Card Surface**: `#111827` (Matte slate surface)
- **Sidebar Surface**: `#090E1A`
- **Subtle Surface**: `#0F172A`
- **Highlight Surface**: `#0C4A6E`
- **Hairline Borders**: `rgba(241, 245, 249, 0.08)` (Subtle), `rgba(241, 245, 249, 0.16)` (Strong)

### Three-Tier Typography Contrast (WCAG AA Certified)
1. **Heading**: `#172B4D` (Light) / `#F1F5F9` (Dark) — High-contrast title and value emphasis.
2. **Body**: `#334155` (Light) / `#CBD5E1` (Dark) — Standard prose, descriptions, and labels.
3. **Muted**: `#64748B` (Light) / `#94A3B8` (Dark) — Timestamps, metadata, secondary helper text.

### Calibrated Risk Signal Tokens
Semantic status colors are never used decoratively and are always paired with visible text and geometric icons:
- **Critical / Block**:
  - Light: `#991B1B` text on `#FEE2E2` background (`border-red-200`)
  - Dark: `#FCA5A5` text on `rgba(239, 68, 68, 0.14)` background (`border-red-900/50`)
- **High / Urgent Warning**:
  - Light: `#92400E` text on `#FEF3C7` background (`border-amber-200`)
  - Dark: `#FDE68A` text on `rgba(245, 158, 11, 0.14)` background (`border-amber-900/50`)
- **Medium / Review**:
  - Light: `#1E40AF` text on `#DCEEFF` background (`border-blue-200`)
  - Dark: `#BAE6FD` text on `rgba(14, 165, 233, 0.14)` background (`border-sky-900/50`)
- **Low / Resolved / Safe**:
  - Light: `#065F46` text on `#D8F8EC` background (`border-emerald-200`)
  - Dark: `#86EFAC` text on `rgba(16, 185, 129, 0.14)` background (`border-emerald-900/50`)

---

## 3. Geometric Nested Radii Rule

FinTrace avoids arbitrary border radiuses. Elements adhere to an exact nested geometric scale:
- `rounded-[6px]` (`--radius-tag`): Status pills, table tags, role chips, mini indicators.
- `rounded-[8px]` (`--radius-control`): Action buttons, inputs, dropdown selects, table row actions, stepper steps.
- `rounded-[12px]` (`--radius-card`): Cards, panels, KPI strips, tables, charts, dossier dossiers.
- `rounded-[16px]` (`--radius-panel`): Modal dialogs, slide-over sheets, full preview drawers.

---

## 4. Border-Over-Shadow Rule

- **No Diffuse Shadows**: Avoid heavy multi-layer blurry drop shadows (`shadow-2xl` or colored glow filters).
- **Hairlines for Separation**: Use quiet 1px hairlines (`border border-border-subtle`).
- **Dark Mode Elevation**: In dark mode, card surfaces use a top hairline highlight (`inset 0 1px 0 rgba(255, 255, 255, 0.06)`) rather than glowing outer borders.

---

## 5. Spacing & Density Scale

The system is built on a 4/8-pt grid:
- **Officer & Casework Pages (Dense & Scannable)**:
  - Standard spacing: `space-y-6`.
  - Master-detail grids: `gap-6` at desktop (`lg:grid-cols-12`).
  - Container padding: `p-3.5` to `p-4`.
  - Table rows: `py-2.5 px-3` to `py-3 px-4`.
- **Citizen Portal Pages (Roomy & Empathetic)**:
  - Container padding: `p-5` to `p-6`.
  - Form spacing: `space-y-5` to `space-y-6`.
  - Field inputs: `px-3 py-2 text-xs`.

---

## 6. Typography & Tabular Figures

- **Prose Font**: Inter / Plus Jakarta Sans.
- **Code & Figures Font**: JetBrains Mono / Geist Mono.
- **Strict `tabular-nums`**: Always apply `font-mono tabular-nums` to numbers that change or align:
  - Indian Rupee amounts (`₹45,000`, `₹12.5 Lakhs`)
  - Timestamps (`14 Nov 2026, 06:12`)
  - SHA-256 hash digests and UTR transaction numbers
  - Geographic latitude / longitude coordinates
  - KPI counter values and percentages

---

## 7. Motion & Accessibility

- **Duration & Easing**: All transitions use a single 120ms curve (`cubic-bezier(0.22, 1, 0.36, 1)`).
- **Purposeful Motion**: Animations exist only to explain a state change (spinner while query is executing, collapse/expand). Never use gratuitous entrance animations.
- **Prefers-Reduced-Motion**: Enforced globally in `index.css`:
  ```css
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      transition-duration: 0.01ms !important;
      scroll-behavior: auto !important;
    }
  }
  ```
- **Visible Keyboard Focus**: All interactive triggers support `:focus-visible` with a distinct 2px accent outline.

---

## 8. Copy Guidelines & Humanization

1. **Sentence Case Everywhere**: Titles, table headers, button labels, and tags must use sentence case (except official acronyms like UPI, UTR, SHA-256, ATM, KYC).
2. **Verb-First Buttons**:
   - `File a complaint` (not "New Complaint")
   - `Verify checksum` (not "Hash Check")
   - `Run cash-out forecast` (not "Execute ATM Intelligence")
   - `Initialize dossier` (not "Create Case")
3. **No Marketing or Sci-Fi Clichés**:
   - Never use: "AI-Powered", "Next-Gen", "Supercharge", "Tactical", "Command Centre", "Syndicates".
   - Instead use: "Database-grounded briefing", "Evidentiary registry", "Linked accounts", "Procedural casework".
4. **Calibrated ML & Risk Honesty**:
   - Never claim probability when showing a score: Display `"Risk score (0-100)"`, never `"98% probability of withdrawal"`.
   - Never hide synthetic data disclaimers: Maintain `"Synthetic demonstration data"` notices clearly and calmly.
   - Display score provenance: `"Trained ML prediction"`, `"Rule-based risk score"`, or `"Synthetic demo result"`.
5. **Empathetic Citizen Language**:
   - Reading level: Grade 8. Short, direct sentences.
   - Reassuring confirmation: "Your complaint was received. An investigator will review your submission shortly."
   - Emergency helpline prominence: Display National Cybercrime Helpline **1930** (Toll-free) and **cybercrime.gov.in** across all citizen views.
