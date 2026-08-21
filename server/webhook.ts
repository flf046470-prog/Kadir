import { createHmac, timingSafeEqual } from 'node:crypto'

export function verifyWebhookSignature(rawBody: string, signature: string | undefined, secret: string): boolean {
  if (!signature) return false
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  const provided = signature.replace(/^sha256=/, '')
  if (provided.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
}

export type PaymentWebhook = {
  eventId: string
  eventType: string
  paymentId: string
  amount: string
  currency: string
  status: 'succeeded' | 'failed' | 'refunded' | 'pending'
  donatedAt?: string
  donorName?: string
  donorEmail?: string
}

export function parsePaymentWebhook(input: unknown): PaymentWebhook {
  if (!input || typeof input !== 'object') throw new Error('Invalid webhook payload')
  const value = input as Record<string, unknown>
  const requiredStrings = ['eventId', 'eventType', 'paymentId', 'amount', 'currency', 'status']
  for (const key of requiredStrings) if (typeof value[key] !== 'string' || !value[key]) throw new Error(`Missing webhook field: ${key}`)
  if (!['succeeded', 'failed', 'refunded', 'pending'].includes(value.status as string)) throw new Error('Unsupported payment status')
  if (!/^\d+(\.\d{1,2})?$/.test(value.amount as string)) throw new Error('Invalid payment amount')
  if (!/^[A-Z]{3}$/.test(value.currency as string)) throw new Error('Invalid payment currency')
  return value as unknown as PaymentWebhook
}
