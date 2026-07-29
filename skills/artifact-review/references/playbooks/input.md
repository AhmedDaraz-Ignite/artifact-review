use_when: form collecting input, survey artifact, configuration wizard, gathering structured answers from the human, questionnaire

## Controls

- Native HTML controls only: `<input>`, `<select>`, `<textarea>`, `<input type="checkbox">`, `<input type="radio">`. No custom-built dropdowns or toggle widgets - native controls work with keyboard, screen readers, and the review tool with zero extra wiring.
- Pick the type that matches the data: `type="number"` for numbers, `type="date"` for dates, `<select>` for a fixed short list, radio group for a fixed short list where all options should be visible at once.
- Use `<textarea>` for free text longer than a short phrase; plain `<input type="text">` for short single-line answers.

## Labels

- Every input has a `<label for="id">` bound to it by matching `id`, or wraps the input directly. Never rely on placeholder text as the only label - placeholders disappear once the human starts typing.
- Group related inputs (e.g. a radio set) inside a `<fieldset>` with a `<legend>` describing the group, so the group has one readable name.

## Defaults

- Preselect the sensible default for every control that has one - a preselected radio/checkbox/select option, a reasonable placeholder-free default in a text input if there's an obvious common answer.
- Never ship every field blank if a likely-correct default exists; the human should be able to accept defaults and move on, only editing what's unusual.

## Submit

- One single, obviously primary submit/flush action per form (a `<button type="submit">`, visually distinct - solid fill, clear label like "Submit" or "Save", not "OK").
- Don't scatter multiple save-like buttons across the form. If there are secondary actions (reset, cancel), style them visibly less prominent than the primary submit.
- Disable the submit button (or show inline validation) if required fields are empty, rather than letting the human submit and find out after.

## Validation

- Use native HTML validation attributes (`required`, `min`/`max`, `pattern`, `type="email"`) before writing custom JS validation - the browser already does this for free.
- Show validation errors inline next to the field, not only in an alert/toast that can be missed.

## What to avoid

- Don't build a custom multi-select chip picker or custom date picker when the native `<select multiple>` or `<input type="date">` does the job - custom widgets are exactly what breaks keyboard use and review-tool capture.
- Don't require JS to submit the form if a plain native form submit would work; only add JS for genuinely dynamic behavior (conditional fields, live validation feedback).
