param(
    [string]$OutputPath = "data/problems.json",
    [int]$BatchSize = 100
)

$LeetCodeGraphQL = "https://leetcode.com/graphql/"
$allQuestions = @()

function Fetch-Batch {
    param(
        [int]$Skip,
        [int]$Limit
    )
    
    $queryBody = @{
        query = "query problemsetQuestionList(`$categorySlug: String, `$limit: Int, `$skip: Int, `$filters: QuestionListFilterInput) {problemsetQuestionList: questionList(categorySlug: `$categorySlug limit: `$limit skip: `$skip filters: `$filters) {total: totalNum questions: data {acRate difficulty frontendQuestionId: questionFrontendId isFavor paidOnly: isPaidOnly status title titleSlug topicTags {name id slug} hasSolution hasVideoSolution}}}"
        variables = @{
            categorySlug = ""
            skip = $Skip
            limit = $Limit
            filters = @{}
        }
        operationName = "problemsetQuestionList"
    } | ConvertTo-Json -Depth 10
    
    $response = Invoke-WebRequest -Uri $LeetCodeGraphQL `
        -Method Post `
        -UseBasicParsing `
        -Headers @{ "Content-Type" = "application/json" } `
        -Body $queryBody `
        -ErrorAction Stop
    
    $data = $response.Content | ConvertFrom-Json
    return $data
}

# Fetch first batch
Write-Host "Fetching first batch..."
$firstBatch = Fetch-Batch -Skip 0 -Limit $BatchSize
$total = $firstBatch.data.problemsetQuestionList.total
$allQuestions = $firstBatch.data.problemsetQuestionList.questions

Write-Host "Total problems: $total, fetched: $($allQuestions.Count)"

# Fetch remaining batches
$skip = $BatchSize
while ($skip -lt $total) {
    Write-Host "Fetching batch at skip=$skip..."
    $batch = Fetch-Batch -Skip $skip -Limit $BatchSize
    $allQuestions += $batch.data.problemsetQuestionList.questions
    Write-Host "Fetched: $($allQuestions.Count)/$total"
    $skip += $BatchSize
}

# Build result
$result = @{
    data = @{
        problemsetQuestionList = @{
            total = $total
            questions = $allQuestions
        }
    }
    generatedAt = ([datetime]::UtcNow).ToString("o")
}

# Ensure directory exists
$dir = Split-Path -Path $OutputPath
if (-not (Test-Path $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
}

# Write to file
$result | ConvertTo-Json -Depth 100 | Set-Content -Path $OutputPath -Encoding UTF8
Write-Host "Wrote $($allQuestions.Count) problems to $OutputPath"
