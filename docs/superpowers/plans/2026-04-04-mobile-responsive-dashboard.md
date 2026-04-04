# Mobile Responsive Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Tamias dashboard usable on phones and tablets by adding targeted Tailwind responsive classes to 5 pages.

**Architecture:** Surgical per-page Tailwind fixes only — no new components, no structural rewrites. Each task is a single file. All changes use Tailwind breakpoint prefixes (`md:`, `sm:`) to apply layouts at the right viewport width. The nav drawer is already responsive and is not touched.

**Tech Stack:** Next.js App Router, Tailwind CSS, DaisyUI, React `useState`

---

## File Map

| File | Change type |
|------|-------------|
| `src/dashboard/src/app/page.tsx` | Modify — stacked layout + collapse toggle for sessions panel |
| `src/dashboard/src/app/history/page.tsx` | Modify — horizontal scroll table, wrapping filter row |
| `src/dashboard/src/app/projects/page.tsx` | Modify — scrollable tab bar, wrapping project header |
| `src/dashboard/src/app/channels/page.tsx` | Modify — wrapping card headers, narrower form labels |
| `src/dashboard/src/app/usage/page.tsx` | Modify — verify/fix header wrapping |

---

### Task 1: Chat Page — Stacked Layout + Collapsible Sessions Panel

**Files:**
- Modify: `src/dashboard/src/app/page.tsx`

The current layout puts the sessions sidebar and chat area side-by-side with no mobile adaptation. On mobile we stack them vertically: sessions panel at the top with a collapse toggle, chat below.

- [ ] **Step 1: Add `sessionsOpen` state and auto-collapse on session select**

In `src/dashboard/src/app/page.tsx`, find the existing `useState` declarations near the top of `ChatPage` (around line 48–58) and add one new state variable:

```tsx
const [sessionsOpen, setSessionsOpen] = useState(false)
```

Then find the `setSelectedSession(s.id)` call in the sessions list (around line 287) and add the auto-collapse after it:

```tsx
onClick={() => {
  setSelectedSession(s.id)
  setSessionsOpen(false)
}}
```

Also update the "ensure selected session is visible" button's `onClick` (around line 275):
```tsx
// no onClick needed here, it's already selected — leave as-is
```

And update `handleCreateSession` (around line 189) to collapse the panel after creating:
```tsx
const handleCreateSession = () => {
  if (!newSessionName.trim()) return
  const sid = newSessionName.trim()
  setSelectedSession(sid)
  setSessionsOpen(false)
  setShowNewSessionModal(false)
  setNewSessionName('')
}
```

- [ ] **Step 2: Make the outer content area stack on mobile**

Find (around line 247):
```tsx
<div className="flex flex-1 gap-4 min-h-0">
```
Replace with:
```tsx
<div className="flex flex-col md:flex-row flex-1 gap-4 min-h-0">
```

- [ ] **Step 3: Make the sessions panel responsive with collapse toggle**

Find the sessions sidebar div (around line 249):
```tsx
<div className="card w-60 bg-base-200 border border-base-300 flex flex-col shrink-0 overflow-hidden shadow-xl">
```
Replace with:
```tsx
<div className="card w-full md:w-60 bg-base-200 border border-base-300 flex flex-col md:shrink-0 overflow-hidden shadow-xl">
```

Then find the sessions header row (around line 251–259):
```tsx
<div className="px-5 py-3 border-b border-base-300 flex items-center justify-between shrink-0 bg-base-300/30">
  <h2 className="text-xs text-base-content/50 uppercase tracking-wider font-mono font-bold">Sessions</h2>
  <button
    className="btn btn-ghost btn-xs btn-square hover:text-success"
    onClick={() => setShowNewSessionModal(true)}
    title="Start New Session"
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="M12 5v14" /></svg>
  </button>
</div>
```
Replace with:
```tsx
<div className="px-5 py-3 border-b border-base-300 flex items-center justify-between shrink-0 bg-base-300/30">
  <button
    className="md:hidden flex items-center gap-2 min-w-0 flex-1 text-left"
    onClick={() => setSessionsOpen(o => !o)}
  >
    <h2 className="text-xs text-base-content/50 uppercase tracking-wider font-mono font-bold">
      {selectedSession
        ? <span className="truncate text-base-content/80">{sessions.find(s => s.id === selectedSession)?.name || selectedSession}</span>
        : 'Sessions'}
    </h2>
    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`ml-1 transition-transform ${sessionsOpen ? 'rotate-180' : ''}`}><path d="m6 9 6 6 6-6"/></svg>
  </button>
  <h2 className="hidden md:block text-xs text-base-content/50 uppercase tracking-wider font-mono font-bold">Sessions</h2>
  <button
    className="btn btn-ghost btn-xs btn-square hover:text-success"
    onClick={() => setShowNewSessionModal(true)}
    title="Start New Session"
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="M12 5v14" /></svg>
  </button>
</div>
```

- [ ] **Step 4: Hide sessions list body on mobile when collapsed**

Find the search input wrapper div (around line 261):
```tsx
<div className="px-3 py-2 border-b border-base-300 shrink-0 bg-base-300/10">
```
Replace with:
```tsx
<div className={`px-3 py-2 border-b border-base-300 shrink-0 bg-base-300/10 ${sessionsOpen ? 'block' : 'hidden'} md:block`}>
```

Find the sessions list scroll area (around line 270):
```tsx
<div className="flex-1 overflow-y-auto p-2">
```
Replace with:
```tsx
<div className={`flex-1 overflow-y-auto p-2 ${sessionsOpen ? 'block' : 'hidden'} md:block`}>
```

- [ ] **Step 5: Make the page header wrap on mobile**

Find (around line 240):
```tsx
<div className="flex items-center justify-between shrink-0">
```
Replace with:
```tsx
<div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
```

- [ ] **Step 6: Verify visually and commit**

Open the dashboard at `http://localhost:5678` in a browser. Resize the window to ~375px wide. Confirm:
- Sessions panel appears at the top, collapsed by default, showing the active session name
- Tapping the sessions header expands the list
- Selecting a session collapses the list automatically
- At `md` (768px+) the layout reverts to side-by-side

```bash
git add src/dashboard/src/app/page.tsx
git commit -m "feat(dashboard): make chat page mobile responsive with collapsible sessions panel"
```

---

### Task 2: History Page — Scrollable Table + Wrapping Filter Row

**Files:**
- Modify: `src/dashboard/src/app/history/page.tsx`

The table uses `grid-cols-[180px_120px_1fr_100px_80px]` fixed columns that overflow on mobile. We wrap the table in a horizontal scroll container and make the filter row wrap.

- [ ] **Step 1: Make the filter row wrap on small screens**

Find (around line 140):
```tsx
<div className="flex items-center gap-3">
  <div className="relative">
    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-base-content/30" />
    <input
      data-testid="history-filter-input"
      type="text"
      placeholder="Filter by prompt, model, session..."
      className="input input-bordered input-sm pl-9 w-64 font-mono text-xs focus:input-success transition-all"
      value={filter}
      onChange={e => setFilter(e.target.value)}
    />
  </div>
  <button data-testid="history-refresh-btn" className="btn btn-ghost btn-sm btn-square" onClick={fetchLogs} title="Refresh History">
```
Replace the outer div and input className:
```tsx
<div className="flex flex-wrap items-center gap-2">
  <div className="relative flex-1 min-w-[200px] sm:flex-none">
    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-base-content/30" />
    <input
      data-testid="history-filter-input"
      type="text"
      placeholder="Filter by prompt, model, session..."
      className="input input-bordered input-sm pl-9 w-full sm:w-64 font-mono text-xs focus:input-success transition-all"
      value={filter}
      onChange={e => setFilter(e.target.value)}
    />
  </div>
  <button data-testid="history-refresh-btn" className="btn btn-ghost btn-sm btn-square" onClick={fetchLogs} title="Refresh History">
```

- [ ] **Step 2: Wrap the table in a horizontal scroll container**

Find the table content area (around line 165–178). The structure is:
```tsx
<div className="flex-1 overflow-hidden">
  <div className="card h-full bg-base-200 border border-base-300 flex flex-col overflow-hidden">
    <div className="card-body p-0 flex flex-col min-h-0">
      {/* Table Header */}
      <div className="grid grid-cols-[180px_120px_1fr_100px_80px] px-6 py-3 ...">
```

Wrap the table header and table content in a `overflow-x-auto` div, and add `min-w-[700px]` to the inner content. Replace:
```tsx
      {/* Table Header */}
      <div className="grid grid-cols-[180px_120px_1fr_100px_80px] px-6 py-3 border-b border-base-300 bg-base-300/30 text-[10px] uppercase font-bold tracking-widest text-base-content/50 font-mono items-center shrink-0">
        <div className="flex items-center gap-2"><Clock className="w-3 h-3" /> Timestamp</div>
        <div className="flex items-center gap-2"><Cpu className="w-3 h-3" /> Model / Action</div>
        <div className="flex items-center gap-2"><Terminal className="w-3 h-3" /> Input Prompt Snippet</div>
        <div className="flex items-center gap-2 justify-end text-right"><Database className="w-3 h-3" /> Tokens</div>
        <div className="text-right pr-2">Dur. / Cost</div>
      </div>

      {/* Table Content */}
      <div className="flex-1 overflow-y-auto">
```
With:
```tsx
      {/* Scrollable Table */}
      <div className="flex-1 overflow-auto">
        <div className="min-w-[700px]">
        {/* Table Header */}
        <div className="grid grid-cols-[180px_120px_1fr_100px_80px] px-6 py-3 border-b border-base-300 bg-base-300/30 text-[10px] uppercase font-bold tracking-widest text-base-content/50 font-mono items-center shrink-0 sticky top-0">
          <div className="flex items-center gap-2"><Clock className="w-3 h-3" /> Timestamp</div>
          <div className="flex items-center gap-2"><Cpu className="w-3 h-3" /> Model / Action</div>
          <div className="flex items-center gap-2"><Terminal className="w-3 h-3" /> Input Prompt Snippet</div>
          <div className="flex items-center gap-2 justify-end text-right"><Database className="w-3 h-3" /> Tokens</div>
          <div className="text-right pr-2">Dur. / Cost</div>
        </div>

        {/* Table Content */}
        <div>
```

- [ ] **Step 3: Close the new wrapper divs**

After the table content `<div>` (which wraps the `loading ? ...` ternary containing `filteredLogs.map`), close it. Then close the `min-w-[700px]` div. The full structure of the scrollable region should be:

```tsx
{/* Scrollable Table */}
<div className="flex-1 overflow-auto">
  <div className="min-w-[700px]">
    {/* Table Header */}
    <div className="grid grid-cols-[180px_120px_1fr_100px_80px] px-6 py-3 border-b border-base-300 bg-base-300/30 text-[10px] uppercase font-bold tracking-widest text-base-content/50 font-mono items-center shrink-0 sticky top-0">
      ...
    </div>
    {/* Table Content */}
    <div>
      {loading ? ( ... ) : filteredLogs.length === 0 ? ( ... ) : (
        filteredLogs.map((log, idx) => ( ... ))
      )}
    </div>
  </div>
</div>

{/* Table Footer */}
<div className="px-6 py-3 border-t border-base-300 bg-base-300/30 flex justify-between items-center shrink-0">
```

- [ ] **Step 4: Verify and commit**

Resize to ~375px. The table should scroll horizontally. The filter input should stretch full-width on mobile, fixed `w-64` on `sm:` and above. The table columns should not compress.

```bash
git add src/dashboard/src/app/history/page.tsx
git commit -m "feat(dashboard): make history page table horizontally scrollable on mobile"
```

---

### Task 3: Projects Page — Scrollable Tab Bar + Wrapping Header

**Files:**
- Modify: `src/dashboard/src/app/projects/page.tsx`

The 8-tab bar overflows with no scroll affordance. We add `overflow-x-auto` to the tab container and `shrink-0 whitespace-nowrap` to each tab.

- [ ] **Step 1: Make the tabs container scrollable**

Find (around line 322):
```tsx
<div className="tabs tabs-bordered px-6 border-b-0">
```
Replace with:
```tsx
<div className="tabs tabs-bordered px-6 border-b-0 overflow-x-auto flex-nowrap">
```

- [ ] **Step 2: Add `shrink-0 whitespace-nowrap` to each tab button**

There are 8 tab buttons. Each looks like:
```tsx
<button
  className={`tab tab-lg gap-2 transition-all ${activeTab === 'overview' ? '...' : '...'}`}
  onClick={() => setActiveTab('overview')}
>
```

For each of the 8 tab buttons, add `shrink-0 whitespace-nowrap` to the className string. For example:

```tsx
<button
  className={`tab tab-lg gap-2 transition-all shrink-0 whitespace-nowrap ${activeTab === 'overview' ? 'tab-active font-bold text-base-content border-base-content' : 'text-base-content/50 hover:text-base-content/80'}`}
  onClick={() => setActiveTab('overview')}
>
  <FileText className="w-4 h-4" /> Overview
</button>
```

Apply the same `shrink-0 whitespace-nowrap` addition to all 8 tabs: overview, chat, kanban, agents, crons, skills, files, settings.

- [ ] **Step 3: Make the project header wrap on mobile**

Find (around line 304):
```tsx
<div className="p-6 pb-4 flex justify-between items-start">
```
Replace with:
```tsx
<div className="p-6 pb-4 flex flex-wrap justify-between items-start gap-3">
```

- [ ] **Step 4: Verify and commit**

Resize to ~375px. The tab bar should be scrollable left/right. All 8 tabs should be reachable. The project header should not overflow.

```bash
git add src/dashboard/src/app/projects/page.tsx
git commit -m "feat(dashboard): make projects page tabs scrollable and header wrapping on mobile"
```

---

### Task 4: Channels Page — Wrapping Card Headers + Narrower Labels

**Files:**
- Modify: `src/dashboard/src/app/channels/page.tsx`

The `BotCard` header has icon + title on the left and toggle + delete on the right in a single flex row. On very small phones this overflows. Form field labels with `w-32 shrink-0` are also too wide on phones.

- [ ] **Step 1: Fix the page-level header (title + save button)**

Find (around line 386):
```tsx
<div className="flex justify-between items-start">
```
Replace with:
```tsx
<div className="flex flex-wrap justify-between items-start gap-3">
```

- [ ] **Step 2: Fix the `BotCard` header row**

In the `BotCard` component, find (around line 78):
```tsx
<div className="flex items-center justify-between mb-4">
```
Replace with:
```tsx
<div className="flex flex-wrap items-center justify-between gap-3 mb-4">
```

- [ ] **Step 3: Fix form field label widths in `BotCard`**

In `BotCard`, there are three form rows with `w-32 shrink-0` labels. Find each one and replace `w-32 shrink-0` with `w-24 sm:w-32 shrink-0`:

First label (Bot Token row, around line 109):
```tsx
<span className="text-xs font-bold uppercase tracking-wider text-base-content/50 w-24 sm:w-32 shrink-0">Bot Token</span>
```

Second label (allowed channels/chats row, around line 120):
```tsx
<span className="text-xs font-bold uppercase tracking-wider text-base-content/50 w-24 sm:w-32 shrink-0 mt-2">{allowLabel}</span>
```

Third label (reply mode row, around line 133):
```tsx
<span className="text-xs font-bold uppercase tracking-wider text-base-content/50 w-24 sm:w-32 shrink-0">Reply Mode</span>
```

- [ ] **Step 4: Fix the `WhatsAppUnofficialCard` header row and labels**

In `WhatsAppUnofficialCard`, find (around line 169):
```tsx
<div className="flex items-center justify-between mb-4">
```
Replace with:
```tsx
<div className="flex flex-wrap items-center justify-between gap-3 mb-4">
```

Also fix the `w-32 shrink-0` labels in this card (Mode, Groups, DM Contacts):
```tsx
<span className="text-xs font-bold uppercase tracking-wider text-base-content/50 w-24 sm:w-32 shrink-0">Mode</span>
<span className="text-xs font-bold uppercase tracking-wider text-base-content/50 w-24 sm:w-32 shrink-0 mt-2">Groups</span>
<span className="text-xs font-bold uppercase tracking-wider text-base-content/50 w-24 sm:w-32 shrink-0 mt-2">DM Contacts</span>
```

- [ ] **Step 5: Verify and commit**

Resize to ~375px. Card headers should wrap rather than overflow. Labels should be narrower and not force the input to squeeze.

```bash
git add src/dashboard/src/app/channels/page.tsx
git commit -m "feat(dashboard): make channels page cards and labels mobile responsive"
```

---

### Task 5: Usage Page — Verify and Fix Header Wrapping

**Files:**
- Modify: `src/dashboard/src/app/usage/page.tsx`

The header already has `flex flex-col md:flex-row` but the total spend badge may not wrap cleanly. This task verifies and makes minor fixes.

- [ ] **Step 1: Verify the existing header responsive classes**

The header (around line 105) already has:
```tsx
<div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
```
This is correct. No change needed here.

- [ ] **Step 2: Fix the total spend badge to not overflow on mobile**

Find the total spend badge div (around line 116):
```tsx
<div className="bg-base-200 border border-base-300 px-4 py-2 rounded-xl flex items-center gap-3 shadow-sm">
  <div className="text-right">
    <div className="text-[10px] uppercase font-bold text-base-content/40 tracking-tighter">Total Spend</div>
    <div className="font-mono font-black text-xl leading-none">${data.total.toFixed(2)}</div>
  </div>
  <div className="divider divider-horizontal mx-0"></div>
  <Coins className="w-6 h-6 text-warning" />
</div>
```
Replace the outer div to allow full width on mobile:
```tsx
<div className="bg-base-200 border border-base-300 px-4 py-2 rounded-xl flex items-center gap-3 shadow-sm self-start md:self-auto">
  <div className="text-right">
    <div className="text-[10px] uppercase font-bold text-base-content/40 tracking-tighter">Total Spend</div>
    <div className="font-mono font-black text-xl leading-none">${data.total.toFixed(2)}</div>
  </div>
  <div className="divider divider-horizontal mx-0"></div>
  <Coins className="w-6 h-6 text-warning" />
</div>
```

- [ ] **Step 3: Verify and commit**

Resize to ~375px. The header should stack vertically: title above, total spend badge below. The stat cards grid is already `grid-cols-1 md:grid-cols-2 lg:grid-cols-4` so it works on mobile.

```bash
git add src/dashboard/src/app/usage/page.tsx
git commit -m "feat(dashboard): fix usage page header badge alignment on mobile"
```
