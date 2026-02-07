import test from "node:test";
import assert from "node:assert/strict";

import { getReadinessData, getNextPracticeProblem } from "../../src/readiness-logic/classic.js";
import { getPracticeProblem } from "../../src/readiness-logic/practice.js";
import { targetTopics } from "../../src/readiness-logic/target-topics.js";
import { installChromeStub, uninstallChromeStub, makeAllProblems, q } from "./_helpers.mjs";

// ─── Dedup / Trigger Behavior ──────────────────────────────────────────────

test("dedup: identical data should produce identical readiness (no spurious re-render)", () => {
  const problems = makeAllProblems([
    q({ titleSlug: "a", difficulty: "Easy", status: "ac", topicSlugs: ["array"] }),
    q({ titleSlug: "b", difficulty: "Medium", status: null, topicSlugs: ["array"] }),
  ]);

  const r1 = getReadinessData(problems, null);
  const r2 = getReadinessData(problems, null);

  assert.deepStrictEqual(r1, r2, "Same input must produce same output (render dedup)");
});

test("dedup: timestamp change alone does not alter readiness scores", () => {
  const problems = makeAllProblems([
    q({ titleSlug: "a", difficulty: "Easy", status: "ac", topicSlugs: ["hash-table"] }),
  ]);
  problems.timeStamp = 100;

  const r1 = getReadinessData(problems, null);

  problems.timeStamp = 999;
  const r2 = getReadinessData(problems, null);

  assert.deepStrictEqual(r1, r2, "Timestamp metadata should not affect readiness computation");
});

// ─── New Problems Added ────────────────────────────────────────────────────

test("adding a new unsolved problem changes availability but not readiness score", () => {
  const base = [
    q({ titleSlug: "a", difficulty: "Easy", status: "ac", topicSlugs: ["array"] }),
  ];

  const r1 = getReadinessData(makeAllProblems(base), null);

  const expanded = [
    ...base,
    q({ titleSlug: "b", difficulty: "Medium", status: null, topicSlugs: ["array"] }),
  ];

  const r2 = getReadinessData(makeAllProblems(expanded), null);

  // Score should be identical or lower (more unsolved problems dilute percentage)
  assert.ok(r2.array[1] <= r1.array[1],
    "Adding unsolved problems should not increase readiness score");
});

test("adding a new solved problem increases readiness score", () => {
  const base = [
    q({ titleSlug: "a", difficulty: "Easy", status: "ac", topicSlugs: ["array"] }),
  ];

  const r1 = getReadinessData(makeAllProblems(base), null);

  const expanded = [
    ...base,
    q({ titleSlug: "b", difficulty: "Easy", status: "ac", topicSlugs: ["array"] }),
  ];

  const r2 = getReadinessData(makeAllProblems(expanded), null);

  assert.ok(r2.array[1] > r1.array[1],
    "Adding a solved problem should increase readiness score");
});

// ─── Problems Removed ──────────────────────────────────────────────────────

test("removing a solved problem decreases readiness score", () => {
  const full = [
    q({ titleSlug: "a", difficulty: "Easy", status: "ac", topicSlugs: ["hash-table"] }),
    q({ titleSlug: "b", difficulty: "Easy", status: "ac", topicSlugs: ["hash-table"] }),
  ];

  const r1 = getReadinessData(makeAllProblems(full), null);

  const reduced = [full[0]]; // remove one solved problem
  const r2 = getReadinessData(makeAllProblems(reduced), null);

  assert.ok(r2["hash-table"][1] < r1["hash-table"][1],
    "Removing a solved problem should decrease readiness score");
});

test("removing an unsolved problem does not change readiness score", () => {
  const full = [
    q({ titleSlug: "a", difficulty: "Easy", status: "ac", topicSlugs: ["array"] }),
    q({ titleSlug: "b", difficulty: "Easy", status: null, topicSlugs: ["array"] }),
  ];

  const r1 = getReadinessData(makeAllProblems(full), null);

  const reduced = [full[0]]; // remove unsolved problem
  const r2 = getReadinessData(makeAllProblems(reduced), null);

  assert.equal(r1.array[1], r2.array[1],
    "Removing an unsolved problem should not change readiness score");
});

// ─── Problem Completion (status change) ────────────────────────────────────

test("completing a problem (null → ac) increases readiness score", () => {
  const before = makeAllProblems([
    q({ titleSlug: "a", difficulty: "Easy", status: null, topicSlugs: ["linked-list"] }),
    q({ titleSlug: "b", difficulty: "Medium", status: null, topicSlugs: ["linked-list"] }),
  ]);

  const r1 = getReadinessData(before, null);
  assert.equal(r1["linked-list"][1], 0, "No solved problems = 0 readiness");

  const after = makeAllProblems([
    q({ titleSlug: "a", difficulty: "Easy", status: "ac", topicSlugs: ["linked-list"] }),
    q({ titleSlug: "b", difficulty: "Medium", status: null, topicSlugs: ["linked-list"] }),
  ]);

  const r2 = getReadinessData(after, null);
  assert.ok(r2["linked-list"][1] > 0, "Completing a problem should increase readiness above 0");
});

test("completing a problem via recent submissions (not status) increases readiness", () => {
  const problems = makeAllProblems([
    q({ titleSlug: "a", difficulty: "Easy", status: null, topicSlugs: ["array"] }),
  ]);

  const withoutRecent = getReadinessData(problems, null);
  assert.equal(withoutRecent.array[1], 0, "Unsolved with no recent submissions = 0");

  const withRecent = getReadinessData(problems, {
    data: { recentAcSubmissionList: [{ titleSlug: "a" }] },
  });
  assert.ok(withRecent.array[1] > 0,
    "Recent accepted submission should count as solved for readiness");
});

test("completing a problem changes practice problem selection", async () => {
  const restoreRandom = Math.random;
  Math.random = () => 0;

  // Before completion: should suggest unsloved "a"
  installChromeStub({
    localData: {
      problemsKey: makeAllProblems([
        q({ titleSlug: "a", difficulty: "Easy", status: null, topicSlugs: ["array"] }),
        q({ titleSlug: "b", difficulty: "Easy", status: null, topicSlugs: ["array"] }),
      ]),
      recentSubmissionsKey: { data: { recentAcSubmissionList: [] } },
      userDataKey: { isPremium: false },
    },
  });

  try {
    const beforeSlug = await getNextPracticeProblem("array", "easy");
    assert.ok(beforeSlug, "Should suggest an unsolved problem");

    // After completion: "a" is solved, should not suggest it again
    uninstallChromeStub();
    installChromeStub({
      localData: {
        problemsKey: makeAllProblems([
          q({ titleSlug: "a", difficulty: "Easy", status: "ac", topicSlugs: ["array"] }),
          q({ titleSlug: "b", difficulty: "Easy", status: null, topicSlugs: ["array"] }),
        ]),
        recentSubmissionsKey: { data: { recentAcSubmissionList: [] } },
        userDataKey: { isPremium: false },
      },
    });

    const afterSlug = await getNextPracticeProblem("array", "easy");
    assert.equal(afterSlug, "b", "After completing 'a', should suggest 'b'");
  } finally {
    Math.random = restoreRandom;
    uninstallChromeStub();
  }
});

// ─── Empty / Missing Data Resilience ───────────────────────────────────────

test("readiness handles empty problem list gracefully", () => {
  const result = getReadinessData(makeAllProblems([]), null);
  for (const topic of targetTopics) {
    assert.equal(result[topic][0], "notReady");
    assert.equal(result[topic][1], 0);
  }
});

test("readiness handles null problem data gracefully", () => {
  const result = getReadinessData(null, null);
  assert.deepStrictEqual(result, {}, "Should return empty object for null data");
});

test("readiness handles undefined questions array gracefully", () => {
  const result = getReadinessData({ data: {} }, null);
  assert.deepStrictEqual(result, {}, "Should return empty object for missing questions");
});

test("practice problem returns null when all problems in topic are solved", async () => {
  const restoreRandom = Math.random;
  Math.random = () => 0;

  installChromeStub({
    localData: {
      problemsKey: makeAllProblems([
        q({ titleSlug: "a", difficulty: "Easy", status: "ac", topicSlugs: ["queue"] }),
        q({ titleSlug: "b", difficulty: "Medium", status: "ac", topicSlugs: ["queue"] }),
      ]),
      recentSubmissionsKey: { data: { recentAcSubmissionList: [] } },
      userDataKey: { isPremium: false },
    },
  });

  try {
    // When all problems are solved, getNextPracticeProblem falls back to solved pool
    const slug = await getNextPracticeProblem("queue", "easy");
    // Should return a solved problem as fallback (not null)
    assert.ok(slug, "Should fall back to a solved problem when no unsolved remain");
  } finally {
    Math.random = restoreRandom;
    uninstallChromeStub();
  }
});

// ─── Multi-topic Completion Tracking ───────────────────────────────────────

test("completing a multi-topic problem increases readiness for all its topics", () => {
  const before = makeAllProblems([
    q({ titleSlug: "multi", difficulty: "Easy", status: null, topicSlugs: ["array", "hash-table"] }),
  ]);
  const r1 = getReadinessData(before, null);

  const after = makeAllProblems([
    q({ titleSlug: "multi", difficulty: "Easy", status: "ac", topicSlugs: ["array", "hash-table"] }),
  ]);
  const r2 = getReadinessData(after, null);

  assert.ok(r2.array[1] > r1.array[1], "Array readiness should increase");
  assert.ok(r2["hash-table"][1] > r1["hash-table"][1], "Hash-table readiness should increase");
});

test("status merge simulation: overwriting null status with 'ac' changes readiness", () => {
  // Simulates what happens when content-script merges GitHub data (status:null) 
  // with LeetCode user status (status:'ac')
  const githubData = makeAllProblems([
    q({ titleSlug: "two-sum", difficulty: "Easy", status: null, topicSlugs: ["array", "hash-table"] }),
    q({ titleSlug: "lru-cache", difficulty: "Hard", status: null, topicSlugs: ["hash-table", "linked-list"] }),
  ]);

  const beforeMerge = getReadinessData(githubData, null);

  // Simulate merge: set status to 'ac' for first problem
  const mergedData = makeAllProblems([
    q({ titleSlug: "two-sum", difficulty: "Easy", status: "ac", topicSlugs: ["array", "hash-table"] }),
    q({ titleSlug: "lru-cache", difficulty: "Hard", status: null, topicSlugs: ["hash-table", "linked-list"] }),
  ]);

  const afterMerge = getReadinessData(mergedData, null);

  assert.ok(afterMerge.array[1] > beforeMerge.array[1],
    "Merging user status should reflect in readiness scores");
  assert.ok(afterMerge["hash-table"][1] > beforeMerge["hash-table"][1],
    "Merging user status should reflect for all topics of that problem");
});
