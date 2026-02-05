const LEETCODE_GRAPHQL = "https://leetcode.com/graphql/";
const OUTPUT_PATH = new URL("../data/problems.json", import.meta.url);

const queryBody = {
  query:
    "query problemsetQuestionList($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput) {problemsetQuestionList: questionList(categorySlug: $categorySlug limit: $limit skip: $skip filters: $filters) {total: totalNum questions: data {acRate difficulty frontendQuestionId: questionFrontendId isFavor paidOnly: isPaidOnly status title titleSlug topicTags {name id slug} hasSolution hasVideoSolution}}}",
  variables: { categorySlug: "", skip: 0, limit: 5000, filters: {} },
  operationName: "problemsetQuestionList",
};

async function run() {
  const response = await fetch(LEETCODE_GRAPHQL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(queryBody),
  });

  if (!response.ok) {
    throw new Error(`LeetCode GraphQL request failed: ${response.status}`);
  }

  const result = await response.json();
  result.generatedAt = new Date().toISOString();

  const fs = await import("node:fs/promises");
  await fs.mkdir(new URL("../data/", import.meta.url), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(result, null, 2));
  console.log(`Wrote ${OUTPUT_PATH.pathname}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
