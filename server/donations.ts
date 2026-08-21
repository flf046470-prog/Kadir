import { createHash } from 'node:crypto'
import type { Prisma, PrismaClient } from '@prisma/client'
import type { PaymentWebhook } from './webhook.js'

export async function recordVerifiedDonation(db: PrismaClient, campaignId: string, provider: string, expectedCurrency: string, event: PaymentWebhook, rawPayload: string) {
  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    const existingEvent = await tx.paymentEvent.findUnique({ where: { eventId: event.eventId } })
    if (existingEvent) return { duplicate: true, donation: null }

    if (event.currency !== expectedCurrency) throw new Error('Webhook currency does not match campaign currency')
    if (Number(event.amount) <= 0) throw new Error('Donation amount must be greater than zero')

    const payloadHash = createHash('sha256').update(rawPayload).digest('hex')
    await tx.paymentEvent.create({ data: { provider, eventId: event.eventId, eventType: event.eventType, paymentId: event.paymentId, signatureValid: true, payloadHash, processedAt: new Date() } })
    const payment = await tx.payment.upsert({
      where: { providerId: event.paymentId },
      update: { status: event.status.toUpperCase() as 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'REFUNDED', rawStatus: event.status },
      create: { provider, providerId: event.paymentId, amount: event.amount, currency: event.currency, status: event.status.toUpperCase() as 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'REFUNDED', rawStatus: event.status },
    })
    if (event.status !== 'succeeded') return { duplicate: false, donation: null, paymentId: payment.id }
    const donation = await tx.donation.create({ data: { campaignId, paymentId: payment.id, amount: event.amount, currency: event.currency, donatedAt: event.donatedAt ? new Date(event.donatedAt) : new Date(), donorName: event.donorName, donorEmail: event.donorEmail } })
    await tx.campaign.update({ where: { id: campaignId }, data: { totalRaised: { increment: event.amount } } })
    return { duplicate: false, donation, paymentId: payment.id }
  })
}
