---
name: "Artifact Review"
description: "A calm, precise review surface that keeps the artifact and delivery state clear."
colors:
  canvas: "#F2F3F5"
  surface: "#FFFFFF"
  surface-subtle: "#F7F8FA"
  ink: "#171A20"
  muted: "#61687A"
  line: "#DCDDE3"
  accent: "#3557C0"
  accent-hover: "#2947A5"
  accent-soft: "#E8EDFB"
  success: "#186A4B"
  warning: "#A1420F"
  danger: "#A63D40"
typography:
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "14px"
    fontWeight: 650
    lineHeight: 1.4
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.35
rounded:
  control: "8px"
  popover: "10px"
  surface: "12px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "9px 12px"
    height: "36px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "9px 12px"
    height: "36px"
  input:
    backgroundColor: "{colors.surface-subtle}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
---

# Design System: Artifact Review

## Overview

**Creative North Star: "The Review Desk"**

The interface should feel like a well-arranged desk during a focused review:
the work occupies the center, draft notes remain close at hand, and delivery
state is legible without asking for attention. Density is compact but never
cryptic. Familiar controls, explicit language, and immediate state feedback
create trust.

The system rejects scattered review actions, generic AI-tool decoration, and
dashboard chrome that competes with the artifact.

**Key Characteristics:**

- Artifact-first composition with a narrow, purposeful review rail.
- Restrained neutral surfaces and one functional blue accent.
- Consistent draft-versus-send semantics at every feedback entry point.
- Fast state transitions with text, icon, and live-region confirmation.

## Colors

The palette is restrained: neutral working surfaces carry the interface while
the blue accent is reserved for selection, focus, and primary delivery actions.

### Primary

- **Working Blue:** The sole primary accent for Send, active annotation mode,
  focus, and current selection.
- **Quiet Blue:** A low-emphasis background for selected rows and agent replies.

### Neutral

- **Canvas Gray:** Separates the review chrome from the artifact.
- **Review White:** Carries the header, rail, menus, and dialogs.
- **Work Ink:** Primary text and icons.
- **Operational Gray:** Secondary text, timestamps, and supporting labels.
- **Hairline Gray:** Dividers and control boundaries.

### Named Rules

**The One Signal Rule.** Blue means active, selected, focused, or ready to send;
it is never decorative.

**The State Has Words Rule.** Success, warning, and danger colors always appear
with a label or icon; color never carries delivery meaning alone.

## Typography

**Display Font:** System UI sans-serif
**Body Font:** System UI sans-serif
**Label/Mono Font:** System UI sans-serif; platform monospace only for selectors
and keyboard hints

**Character:** Familiar, compact, and operational. One family reduces visual
noise and makes the tool feel native on every agent host.

### Hierarchy

- **Title** (650, 14px, 1.4): Artifact name, panel title, dialog title.
- **Body** (400, 14px, 1.5): Feedback, conversation, and instructions.
- **Label** (600, 12px, 1.35): Buttons, state labels, metadata.
- **Micro** (500, 11px, 1.3): Timestamps, counters, selectors, and key hints.

### Named Rules

**The Sentence Case Rule.** Use sentence case everywhere. Uppercase tracking is
forbidden as a substitute for hierarchy.

## Elevation

The interface is flat by default. Tonal layering and hairline dividers establish
structure. Popovers and dialogs may use one compact shadow with no more than
8px blur; ordinary panels, buttons, and feedback rows never float.

### Shadow Vocabulary

- **Popover lift** (`0 4px 8px rgba(20, 24, 32, 0.14)`): Menus and contextual
  annotation composers only.

### Named Rules

**The Flat Desk Rule.** Surfaces remain flat until an element temporarily enters
the top layer.

## Components

### Buttons

- **Shape:** Gently rounded controls (8px).
- **Primary:** Working Blue, white label, compact 36px desktop height.
- **Hover / Focus:** Darker blue on hover; a 2px external focus ring on keyboard
  focus; pressed state moves no layout.
- **Secondary:** Review White with a Hairline Gray boundary.
- **Menu button:** One button opens a native top-layer popover. Its menu contains
  “Send now” and “Add to review”; it is not rendered as a segmented button group.
  The composer menu adds a separated, danger-toned “Send and end review” as the
  last step of the review. It never becomes the remembered default action.

### Chips

- **Style:** Small status treatment with text and a quiet tonal background.
- **State:** For delivery, use Draft, Sending, Sent, Received, Answered, and
  Failed only. The composer chip also reads Nothing to send or Nothing to add
  when the reviewer acts on an empty composer. No request leaves the browser
  then, so Failed stays reserved for a delivery the server refused.

### Cards / Containers

- **Corner Style:** 12px only for the audit message and dialogs.
- **Background:** Review White or Canvas Gray.
- **Shadow Strategy:** Flat except for temporary top-layer surfaces.
- **Border:** Full 1px boundaries where separation is necessary; never a colored
  side stripe.
- **Internal Padding:** 12–16px.

### Inputs / Fields

- **Style:** Always-visible label, subtle neutral fill, 8px radius.
- **Focus:** Working Blue 2px ring with 2px offset.
- **Error / Disabled:** Preserve the draft on error and explain the recovery;
  ended sessions disable editing and sending.

### Navigation

The top bar identifies the artifact and contains annotation mode, agent status,
and one session menu. The review rail uses Draft and Activity sections without
competing tab bars. At narrow widths, the rail becomes a full-width bottom sheet.

### Feedback composer

Annotation, chat, and whiteboard feedback share the same action language and
menu behavior. The main action repeats the reviewer’s last explicit choice,
while the menu makes the alternate action available and explains its effect.

## Do's and Don'ts

### Do:

- **Do** keep the artifact visually dominant.
- **Do** show Draft, Sending, Sent, Received, Answered, or Failed explicitly.
- **Do** preserve text and queued items when a request fails.
- **Do** support Enter, Shift+Enter, Escape, arrow keys, and visible focus.
- **Do** use motion only to explain a state transition, with reduced-motion
  alternatives.

### Don't:

- **Don't** scatter or duplicate controls for annotating, queuing, chatting,
  sending, and ending a session.
- **Don't** use ambiguous labels where “Queue,” “Send,” and “Send to agent”
  conceal different delivery behavior.
- **Don't** use generic AI-tool styling: purple gradients, glass panels,
  decorative glows, oversized cards, or motion without state meaning.
- **Don't** add dense dashboard chrome that competes with the artifact.
- **Don't** use colored side-stripe borders, gradient text, nested cards, or
  border-plus-wide-shadow ghost cards.
