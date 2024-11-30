const { Octokit } = require('@octokit/rest')
const OpenAI = require('openai')

async function summarizePRs() {
  // Initialize clients
  const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN
  })

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  })

  try {
    // Get authenticated user
    const { data: user } = await octokit.users.getAuthenticated()

    // Get PRs where you're requested as reviewer
    const { data: prs } = await octokit.search.issuesAndPullRequests({
      q: `is:open is:pr review-requested:${user.login}`,
      per_page: 100
    })

    for (const pr of prs) {
      // Get PR details including diff
      const [owner, repo] = pr.repository_url.split('/').slice(-2)
      const { data: prDetails } = await octokit.pulls.get({
        owner,
        repo,
        pull_number: pr.number
      })

      // Get the diff
      const { data: diff } = await octokit.pulls.get({
        owner,
        repo,
        pull_number: pr.number,
        mediaType: {
          format: 'diff'
        }
      })

      // Summarize with OpenAI
      const summary = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content:
              'You are a helpful code reviewer. Summarize the key changes in this PR concisely.'
          },
          {
            role: 'user',
            content: `PR Title: ${pr.title}\nDescription: ${pr.body}\nDiff:\n${diff}`
          }
        ],
        max_tokens: 500
      })

      console.log(`\n=== PR #${pr.number}: ${pr.title} ===`)
      console.log(`Repository: ${owner}/${repo}`)
      console.log(`URL: ${pr.html_url}`)
      console.log('\nSummary:')
      console.log(summary.choices[0].message.content)
      console.log('\n---')
    }
  } catch (error) {
    console.error('Error:', error.message)
  }
}
