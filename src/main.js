const core = require('@actions/core')
const { google } = require('googleapis')
const OpenAI = require('openai')
const path = require('path')

/**
 * Authenticate with Gmail API using service account
 * @param {string} serviceAccountKey - Service account key JSON string
 * @returns {gmail_v1.Gmail} - Gmail API client
 */
async function getGmailClient(serviceAccountKey) {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(serviceAccountKey),
    scopes: ['https://www.googleapis.com/auth/gmail.readonly']
  })

  return google.gmail({
    version: 'v1',
    auth
  })
}

/**
 * Get emails from Gmail within date range
 * @param {gmail_v1.Gmail} gmail - Gmail API client
 * @param {number} daysAgo - Number of days to look back
 * @param {string} label - Gmail label to filter
 * @param {number} maxEmails - Maximum number of emails to fetch
 * @returns {Promise<Array>} Array of email messages
 */
async function getEmails(gmail, daysAgo, label, maxEmails) {
  const date = new Date()
  date.setDate(date.getDate() - daysAgo)
  const query = `label:${label} after:${date.toISOString().split('T')[0]}`

  try {
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: maxEmails
    })

    const emails = []
    for (const message of response.data.messages || []) {
      const email = await gmail.users.messages.get({
        userId: 'me',
        id: message.id,
        format: 'full'
      })
      emails.push(email.data)
    }

    return emails
  } catch (error) {
    throw new Error(`Failed to fetch emails: ${error.message}`)
  }
}

/**
 * Extract email content and metadata
 * @param {Object} email - Gmail message object
 * @returns {Object} Formatted email data
 */
function parseEmail(email) {
  const headers = email.payload.headers
  const subject = headers.find(h => h.name === 'Subject')?.value || 'No Subject'
  const from = headers.find(h => h.name === 'From')?.value || 'Unknown Sender'
  const date = headers.find(h => h.name === 'Date')?.value || ''

  let body = ''
  if (email.payload.parts) {
    const textPart = email.payload.parts.find(
      part => part.mimeType === 'text/plain'
    )
    if (textPart && textPart.body.data) {
      body = Buffer.from(textPart.body.data, 'base64').toString()
    }
  } else if (email.payload.body.data) {
    body = Buffer.from(email.payload.body.data, 'base64').toString()
  }

  return {
    subject,
    from,
    date,
    body
  }
}

/**
 * Generate summary using OpenAI
 * @param {OpenAI} openai - OpenAI API client
 * @param {Array} emails - Array of parsed emails
 * @returns {Promise<string>} Generated summary
 */
async function generateSummary(openai, emails) {
  const emailsContent = emails
    .map(
      email =>
        `From: ${email.from}\nSubject: ${email.subject}\nDate: ${email.date}\n\n${email.body}\n---`
    )
    .join('\n')

  const prompt = `Please summarize the following emails in a concise and organized way, 
    highlighting important information and action items:\n\n${emailsContent}`

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content:
            'You are a helpful assistant that summarizes emails clearly and concisely.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 1000
    })

    return completion.choices[0].message.content
  } catch (error) {
    throw new Error(`Failed to generate summary: ${error.message}`)
  }
}

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
async function run() {
  try {
    // Get inputs
    const serviceAccountKey = core.getInput('service_account_key', { required: true })
    const openaiApiKey = core.getInput('openai_api_key', { required: true })
    const maxEmails = parseInt(core.getInput('max_emails'), 30)
    const label = core.getInput('label')
    const daysAgo = parseInt(core.getInput('days_ago'), 10)

    // Initialize API clients
    const gmail = await getGmailClient(serviceAccountKey)
    const openai = new OpenAI({ apiKey: openaiApiKey })

    // Get emails
    core.debug(
      `Fetching up to ${maxEmails} emails from the last ${daysAgo} days with label ${label}...`
    )
    const emails = await getEmails(gmail, daysAgo, label, maxEmails)

    // Parse emails
    const parsedEmails = emails.map(parseEmail)

    // Generate summary
    core.debug('Generating summary with OpenAI...')
    const summary = await generateSummary(openai, parsedEmails)

    // Set outputs
    core.setOutput('summary', summary)
    core.setOutput('processed_emails', emails.length)
  } catch (error) {
    core.setOutput('error', error.message)
    core.setFailed(error.message)
  }
}

module.exports = {
  run
}
