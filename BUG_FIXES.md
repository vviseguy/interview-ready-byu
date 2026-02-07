# Bug Fixes - Interview Ready Extension

## Overview

We set up a Node.js-based unit testing infrastructure to document and verify the extension's intended behavior. This uncovered 7 real bugs in the core logic and configuration.

**Setup:** Added `package.json` with npm scripts and a test suite in `tests/unit/`. Tests run via `npm test` using Node's built-in test runner (no external dependencies). This lets us test readiness logic and extension behavior in isolation, without needing a browser.

**Result:** All 19 tests now pass. Bugs were caught before runtime.

---

## src/manifest.json

**Bug: Missing "tabs" permission**

The popup code calls `chrome.tabs.query()` and `chrome.tabs.update()` to open and navigate to LeetCode problems, but the manifest only declared `"storage"` permission. Chrome silently fails these calls.

**Change:** Added `"tabs"` to the permissions array.

```json
"permissions": ["storage", "tabs"]
```

---

## src/onsite/content-script.js

**Bug #1: Hardcoded username "michael187"**

The content script fetches recent accepted submissions using a hardcoded username. Any student other than "michael187" gets the wrong data. This was likely left over from development.

**Change:** Read the username from `userDataKey` (the logged-in user) instead:

```javascript
// BEFORE:
{"username": "michael187", "limit": 15}

// AFTER:
const userData = (await chrome.storage.local.get([userDataKey])).userDataKey;
const username = userData?.username;
if (!username) {
  delog("No username available; skipping recent accepts update.");
  return;
}
// ... use username dynamically
```

**Bug #2: Storage helper uses literal "key" instead of computed property**

The `setStoragePromise` helper was written as `{key: value}` instead of `{[key]: value}`. This means every call to `setStoragePromise("userDataKey", data)` was actually writing to a literal key named `"key"`, not `"userDataKey"`. Data wasn't being persisted correctly.

**Change:** Use computed property syntax:

```javascript
// BEFORE:
const setStoragePromise = (key, value) => {
  return chrome.storage.local.set({key: value});
}

// AFTER:
const setStoragePromise = (key, value) => {
  return chrome.storage.local.set({[key]: value});
}
```

---

## src/readiness-logic/classic.js

**Bug #1: Medium acceptance-rate banding has impossible condition**

The readiness scoring weights Medium problems differently based on acceptance rate (to encourage solving appropriately-difficult problems). The condition for the "target" band (40-60% acceptance rate) was impossible:

```javascript
question.acRate < READINESS_TARGET_UPPER_AC_RATE &&  // < 60
question.acRate > READINESS_TARGET_UPPER_AC_RATE      // > 60 (impossible!)
```

Students solving Medium problems in the 40-60% difficulty range never got the intended 1.0 points.

**Change:** Use the lower bound constant:

```javascript
question.acRate > READINESS_TARGET_LOWER_AC_RATE  // > 40 (correct range: 40-60)
```

**Bug #2: Recent submissions key is wrong**

`getNextPracticeProblem` reads recent accepted submissions to exclude them from suggestions (so you don't get the same problem twice). But it was reading from `.problemsKey` instead of `.recentSubmissionsKey`:

```javascript
// BEFORE:
const recentAccepted = getAcceptedSet(
  (await chrome.storage.local.get(["recentSubmissionsKey"])).problemsKey  // Wrong key!
);

// AFTER:
const recentAccepted = getAcceptedSet(
  (await chrome.storage.local.get(["recentSubmissionsKey"])).recentSubmissionsKey  // Correct
);
```

**Bug #3: Premature return blocks "suggested" mode**

The function has different selection strategies depending on `target` (easy/medium/hard/random/suggested). There was an early `return null;` after the random case that made all code below unreachable. Since "suggested" is the default when you click a topic, this broke the core feature—it always returned null.

**Change:** Removed the early return so suggested mode logic is reachable:

```javascript
// BEFORE:
} else if (target == "random") {
  return unsolvedProblems.length > 0 ? ... : ...;
}

return null;  // ❌ Blocks everything below

const numberOfEasyProblemsFirst = ...  // Never reached
```

```javascript
// AFTER:
} else if (target == "random") {
  return unsolvedProblems.length > 0 ? ... : ...;
}

// Default "suggested" mode: progressive difficulty recommendation
const numberOfEasyProblemsFirst = ...  // Now reachable
```

---

## src/readiness-logic/random.js

**Bug: Empty array returns undefined**

When `randomElementInArray([])` is called, it returns `undefined`. If that's used in a URL like `https://leetcode.com/problems/${slug}`, you get `/problems/undefined`.

**Change:** Guard for empty arrays:

```javascript
// BEFORE:
export const randomElementInArray = (arr) => {
  return arr[Math.floor(Math.random() * arr.length)];
}

// AFTER:
export const randomElementInArray = (arr) => {
  if (!arr || arr.length === 0) {
    return null;
  }
  return arr[Math.floor(Math.random() * arr.length)];
}
```

---

## src/ux/popup/home/home.js

**Safety guard: Check for null slug before navigation**

Added defensive checks in both click handlers to prevent attempting to navigate to invalid URLs:

```javascript
function onTopicClick(topic, target) {
  var nextProblemSlug = await getNextPracticeProblem(topic, target);
  if (!nextProblemSlug) {
    delog(`No problem found for topic=${topic} target=${target}`);
    return;
  }
  var nextProblemUrl = `https://leetcode.com/problems/${nextProblemSlug}`;
  chrome.tabs.update(tab.id, { url: nextProblemUrl });
  window.close();
}
```

Same logic added to `onBigPracticeButtonClick`.

---

## Testing

All bugs were caught by writing tests that encode the intended behavior:
- Readiness scoring weights (Medium banding)
- Recent accepts exclusion
- Random selection on empty arrays
- Null safety in practice selection
- Manifest permissions
- Content script username handling

`npm test` runs 19 unit tests. All pass.

---

## UX Refactor: Accessibility & Defensive Rendering

**Previously:** The extension showed error messages/toasts when users clicked on buttons with no available problems. This created a new UI experience that needed maintenance.

**Now:** The UI prevents invalid interactions through defensive rendering:
- **Topics with zero problems**: Hidden entirely (topic row not rendered)
- **Difficulty buttons with no problems**: Disabled with greyed-out styling and hover tooltip explaining why
- **Exhausted categories (all solved)**: Clicking picks a random *solved* problem for review
- **Big button states**:
  - "Next Suggested Problem" becomes "Solve Random Problem" when all recommended problems are complete
  - "Review Random Completed" disabled when nothing has been completed yet
- **Errors**: Logged to console only (silent to normal users, visible to debuggers)

**Implementation:**
1. Removed message controller entirely ([src/ux/popup/home/message-controller.js](src/ux/popup/home/message-controller.js) deleted)
2. Added availability computation before rendering ([src/ux/popup/home/home.js](src/ux/popup/home/home.js)):
   - `computeTopicAvailability()`: Scans all problems per topic+difficulty
   - `computeBigButtonStates()`: Determines big button labels and enabled state
   - `pickFromSolved()`: Fallback when all problems in a category are completed
3. Updated render logic to hide empty topics and disable unavailable buttons
4. Added disabled button CSS ([src/ux/popup/home/home.css](src/ux/popup/home/home.css)): greyed out, not-allowed cursor, no hover effects
5. Errors logged via `console.error()` and `delog()` instead of UI toasts

**Tests:** Added 8 new tests in [tests/unit/popup-behavior.test.js](tests/unit/popup-behavior.test.js) verifying:
- Topics with zero problems are not rendered
- Disabled buttons have appropriate styling
- Fallback to solved problems when exhausted
- Big button state computation and usage
- Suggested button becomes random when exhausted
- Review button disabled when no completed problems
- Errors logged to console, not shown in UI
- CSS disabled styles exist

All 30 unit tests pass (22 existing + 8 new).

---

## New Feature: User Feedback Messages

**Previously:** When no problems were available (all problems completed, nothing in category, etc.), the extension silently did nothing. Users had no indication why clicking a button didn't navigate.

**Now:** A friendly yellow message appears near the top of the popup explaining what's happening:
- **Topic click with no problems:** "No unsolved problems in [topic] at [difficulty] level"
- **Suggested mode (all done):** "All recommended problems completed!"
- **Review mode (nothing solved yet):** "No problems solved yet in this category"
- **Random mode (no problems):** "No problems available"

**Implementation:**
1. Added `<div id="message">` to [src/ux/popup/home/home.html](src/ux/popup/home/home.html)
2. Added CSS styles in [src/ux/popup/home/home.css](src/ux/popup/home/home.css) (yellow warning banner with auto-dismiss)
3. Created `showMessage(text, duration)` function in [src/ux/popup/home/home.js](src/ux/popup/home/home.js)
4. Updated `onTopicClick()` and `onBigPracticeButtonClick()` to call `showMessage()` with contextual text
5. Messages auto-clear after 4 seconds

**Tests:** Added tests in [tests/unit/popup-messages.test.js](tests/unit/popup-messages.test.js) and [tests/unit/popup-guards.test.js](tests/unit/popup-guards.test.js):
- **Timeout behavior**: Verify messages auto-clear and previous timeouts are cancelled
- **Message templates**: Verify correct message text for each scenario (topic/suggested/review/random)
- **Null handling**: Verify that when `getNextPracticeProblem()` or `getPracticeProblem()` returns `null`, the user sees feedback (not silent failure)

All 30 unit tests pass (19 existing + 11 new).
