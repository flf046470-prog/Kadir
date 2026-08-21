import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import test from 'node:test'
import { parsePaymentWebhook, verifyWebhookSignature } from './webhook.js'

test('accepts a valid signed payment webhook', () => {
  const raw = JSON.stringify({ eventId: 'evt_1', eventType: 'payment.succeeded', paymentId: 'pay_1', amount: '25.00', currency: 'USD', status: 'succeeded' })
  const signature = createHmac('sha256', 'secret').update(raw).digest('hex')
  assert.equal(verifyWebhookSignature(raw, `sha256=${signature}`, 'secret'), true)
  assert.equal(parsePaymentWebhook(JSON.parse(raw)).status, 'succeeded')
})

test('rejects missing or invalid signatures', () => {
  assert.equal(verifyWebhookSignature('{}', undefined, 'secret'), false)
  assert.equal(verifyWebhookSignature('{}', 'sha256=bad', 'secret'), false)
})

test('rejects malformed payment events', () => {
  assert.throws(() => parsePaymentWebhook({ eventId: 'evt_1', status: 'succeeded' }))
  assert.throws(() => parsePaymentWebhook({ eventId: 'evt_1', eventType: 'payment.succeeded', paymentId: 'pay_1', amount: '-1', currency: 'USD', status: 'succeeded' }))
})
