# Mobile Responsive Dashboard — Design Spec

**Date:** 2026-04-04  
**Approach:** Surgical per-page Tailwind responsive fixes (Option A)  
**Scope:** 5 files, targeted breakpoint additions only — no new components, no structural rewrites

---

## Problem

The Tamias dashboard has no mobile responsiveness beyond the existing nav drawer. Key pages break on phones and tablets:

- Chat page: fixed side-by-side layout leaves ~0px for the chat area on a phone
- History page: fixed 5-column `grid-cols-[180px_120px_1fr_100px_80px]` overflows horizontally
- Projects page: 8-tab row overflows with no way to scroll to hidden tabs
- Channels / Usage: minor overflow issues in headers and form fields

The nav itself (DaisyUI drawer + mobile header) is already responsive — no changes needed there.

---

## Target Breakpoints

- **Mobile:** `< 768px` (default / no prefix)
- **Tablet+:** `md:` (768px+)
- **Desktop:** `lg:` (1024px+)

---

## File-by-File Changes

### 1. Chat Page — `src/dashboard/src/app/page.tsx`

**Problem:** Sessions sidebar (`w-60`) and chat area are always side-by-side.

**Fix:**
- Outer flex container: `flex flex-col md:flex-row` (stacks on mobile)
- Sessions panel: `w-full md:w-60 h-auto md:h-full` — on mobile it sits at the top
- Sessions panel gets a `useState`-controlled collapse toggle on mobile: a button shows/hides the full list. Collapsed state shows the active session name + a "switch" button.
- Auto-collapse sessions panel when a session is selected on mobile (via `useEffect` watching `selectedSession` + a `isMobile` check or CSS `hidden md:block`)
- Page header row: `flex flex-wrap gap-2` so session badge wraps on narrow screens

### 2. History Page — `src/dashboard/src/app/history/page.tsx`

**Problem:** Fixed-width grid columns overflow horizontally with no scroll.

**Fix:**
- Wrap table content area in `overflow-x-auto`
- Add `min-w-[700px]` to the inner grid container so columns hold their shape — horizontal scroll handles the rest
- Header filter row: `flex flex-wrap gap-2` so search input + refresh button stack on small screens
- Search input: `w-full sm:w-64`

### 3. Projects Page — `src/dashboard/src/app/projects/page.tsx`

**Problem:** 8-tab row overflows with no affordance for reaching hidden tabs.

**Fix:**
- Tab container: `overflow-x-auto` + `flex-nowrap` (or DaisyUI `tabs` with scroll)
- Each tab: `shrink-0 whitespace-nowrap`
- Project header (title + action buttons): `flex flex-wrap gap-2` so buttons wrap on narrow screens

### 4. Channels Page — `src/dashboard/src/app/channels/page.tsx`

**Problem:** `BotCard` form field labels use `w-32 shrink-0` which is too wide on phones; card header can overflow.

**Fix:**
- Form field label width: `w-24 sm:w-32`
- Card header: `flex flex-wrap gap-3` so toggle+delete wrap below title on very small screens
- Page header (title + save button): `flex flex-wrap gap-3`

### 5. Usage Page — `src/dashboard/src/app/usage/page.tsx`

**Problem:** Header row with total spend badge can overflow on very narrow screens.

**Fix:**
- Header row already has `flex flex-col md:flex-row` — verify it's working correctly
- Total spend badge: ensure it wraps gracefully with `flex-wrap` on the outer header `flex` container
- No chart changes needed — `ResponsiveContainer` already handles chart sizing

---

## Out of Scope

- Live Logs page — terminal-style output, horizontal scroll is expected behaviour
- Agents, Skills, Tools, Models, Docs, Changelog pages — these are simple card/list layouts that already reflow acceptably
- Any new mobile-specific navigation patterns beyond what exists
- Touch gesture enhancements
- PWA / manifest changes
