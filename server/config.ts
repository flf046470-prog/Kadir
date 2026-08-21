import 'dotenv/config'

const required = ['CAMPAIGN_NAME', 'CAMPAIGN_DESCRIPTION', 'CAMPAIGN_URL', 'DONATION_URL', 'CAMPAIGN_TARGET', 'CURRENCY', 'OWNER_EMAIL', 'DATABASE_URL', 'CAMPAIGN_ID'] as const

export type AppConfig = {
  campaignName: string
  campaignDescription: string
  campaignUrl: string
  donationUrl: string
  campaignTarget: number
  currency: string
  ownerEmail: string
  campaignId: string
  paymentProvider: string
  paymentMode: 'live' | 'mock'
  webhookSecret: string
  adminToken: string
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const missing = required.filter(key => !env[key])
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(', ')}`)
  const paymentMode = env.PAYMENT_MODE === 'mock' ? 'mock' : 'live'
  if (env.NODE_ENV === 'production' && paymentMode === 'mock') throw new Error('PAYMENT_MODE=mock is forbidden in production')
  const target = Number(env.CAMPAIGN_TARGET)
  if (!Number.isFinite(target) || target <= 0) throw new Error('CAMPAIGN_TARGET must be a positive number')
  const currency = String(env.CURRENCY).toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('CURRENCY must be a 3-letter ISO code')
  if (!env.WEBHOOK_SECRET || !env.ADMIN_TOKEN) throw new Error('WEBHOOK_SECRET and ADMIN_TOKEN are required')
  return {
    campaignName: env.CAMPAIGN_NAME!, campaignDescription: env.CAMPAIGN_DESCRIPTION!,
    campaignUrl: env.CAMPAIGN_URL!, donationUrl: env.DONATION_URL!, campaignTarget: target,
    currency, ownerEmail: env.OWNER_EMAIL!, campaignId: env.CAMPAIGN_ID!, paymentProvider: env.PAYMENT_PROVIDER || 'unconfigured', paymentMode, webhookSecret: env.WEBHOOK_SECRET!, adminToken: env.ADMIN_TOKEN!,
  }
}
