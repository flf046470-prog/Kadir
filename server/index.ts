import { createServer } from 'node:http'
import { loadConfig } from './config.js'
import { PrismaClient } from '@prisma/client'
import { recordVerifiedDonation } from './donations.js'
import { parsePaymentWebhook, verifyWebhookSignature } from './webhook.js'

const config = loadConfig()
const db = new PrismaClient()

function json(response: import('node:http').ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  response.end(JSON.stringify(body))
}

async function readBody(request: import('node:http').IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  const raw = Buffer.concat(chunks).toString('utf8')
  if (raw.length > 1_000_000) throw new Error('Payload too large')
  return raw
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/health') return json(response, 200, { ok: true, paymentMode: config.paymentMode })
    if (request.method === 'GET' && request.url === '/api/campaign') return json(response, 200, { name: config.campaignName, description: config.campaignDescription, url: config.campaignUrl, donationUrl: config.donationUrl, target: config.campaignTarget, currency: config.currency })
    if (request.method === 'POST' && request.url === '/api/webhooks/payment') {
      const raw = await readBody(request)
      const signature = Array.isArray(request.headers['x-webhook-signature']) ? request.headers['x-webhook-signature'][0] : request.headers['x-webhook-signature']
      if (!verifyWebhookSignature(raw, signature, config.webhookSecret)) return json(response, 401, { error: 'Invalid webhook signature' })
      const event = parsePaymentWebhook(JSON.parse(raw))
      const result = await recordVerifiedDonation(db, config.campaignId, config.paymentProvider, config.currency, event, raw)
      return json(response, 202, { accepted: true, eventId: event.eventId, status: event.status, duplicate: result.duplicate, donationRecorded: Boolean(result.donation) })
    }
    if (request.url?.startsWith('/api/admin')) {
      if (request.headers.authorization !== `Bearer ${config.adminToken}`) return json(response, 401, { error: 'Unauthorized' })
      if (request.method === 'POST' && request.url === '/api/admin/campaign/pause') return json(response, 200, { status: 'paused' })
      if (request.method === 'POST' && request.url === '/api/admin/campaign/close') return json(response, 200, { status: 'closed' })
      return json(response, 404, { error: 'Not found' })
    }
    return json(response, 404, { error: 'Not found' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Request failed'
    return json(response, 400, { error: message })
  }
})

server.listen(Number(process.env.PORT || 8787), () => console.log('Donation service listening'))
