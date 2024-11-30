const core = require('@actions/core')
const { Octokit } = require('@octokit/rest')
const OpenAI = require('openai')

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
async function run() {
  try {
    // Get inputs
    const githubToken = core.getInput('github_token', { required: true })
    const openaiKey = core.getInput('openai_api_key', { required: true })
    const model = core.getInput('model') || 'gpt-4'
    const maxPrs = parseInt(core.getInput('max_prs') || '100', 10)

    // Initialize clients
    const octokit = new Octokit({
      auth: githubToken
    })

    const openai = new OpenAI({
      apiKey: openaiKey
    })

    // Get authenticated user
    const { data: user } = await octokit.users.getAuthenticated()

    // Get PRs where you're requested as reviewer from specified days ago
    const daysAgo = parseInt(core.getInput('days_ago') || '1', 10)
    const startDate = new Date(
      Date.now() - daysAgo * 24 * 60 * 60 * 1000
    ).toISOString()
    const { data: prs } = await octokit.search.issuesAndPullRequests({
      q: `is:open is:pr review-requested:${user.login} created:>=${startDate}`,
      per_page: maxPrs
    })

    const summaries = []

    // If no PRs found in last 24 hours
    if (prs.items.length === 0) {
      console.log(
        'No pull requests found requiring your review from the last 24 hours.'
      )
      core.setOutput('summary', JSON.stringify([]))
      return
    }

    for (const pr of prs.items) {
      // Get PR details including diff
      const [owner, repo] = pr.repository_url.split('/').slice(-2)
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
        model,
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

      const prSummary = {
        number: pr.number,
        title: pr.title,
        repo: `${owner}/${repo}`,
        url: pr.html_url,
        summary: summary.choices[0].message.content
      }

      summaries.push(prSummary)

      // Log to console
      console.log(`\n=== PR #${pr.number}: ${pr.title} ===`)
      console.log(`Repository: ${owner}/${repo}`)
      console.log(`URL: ${pr.html_url}`)
      console.log('\nSummary:')
      console.log(summary.choices[0].message.content)
      console.log('\n---')
    }

    // Set output for use in workflow
    core.setOutput('summary', JSON.stringify(summaries))
  } catch (error) {
    // Fail the workflow run if an error occurs
    core.setFailed(error.message)
  }
}

module.exports = {
  run
}
