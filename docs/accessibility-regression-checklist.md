# Accessibility regression checklist

Run this after a WebView or browse-flow change with keyboard only, then repeat
the announced labels and state changes with Narrator.

- [ ] Start Aisles: the loading message resolves to the populated library without trapping focus.
- [ ] Tab through the 3D console labels; Arrow keys move between them and Enter selects a configured console.
- [ ] On a console marked **Set folder**, Enter opens that console's Settings page; Cancel returns without saving.
- [ ] Focus the shelf: Arrow/Home/End changes the active case, Enter selects it, and Escape clears it.
- [ ] In Covers and List, Tab to a game, then Enter/Space selects it; the selected state is announced.
- [ ] Use Ctrl+K, search for a known title, then clear the search and confirm the result count changes.
- [ ] Open Settings from the header, verify initial focus and Tab wrapping, then Escape/Cancel without changes.
- [ ] Temporarily point a console at a missing folder, rescan, and verify the recovery action opens its Settings page.
