import { json } from 'co-body'

import { OrderFormPayment } from '../clients/checkout'

/* =========================================================================
 * CONFIGURACIÓN
 * ========================================================================= */

const IGTF_RATE = 0.03
const IGTF_NAME = 'IGTF'
const IGTF_DESCRIPTION = 'Impuesto a las Grandes Transacciones Financieras (pago en divisas)'

// paymentSystem IDs que disparan el IGTF (Zelle=201, agregá Efectivo cuando lo tengas)
const USD_PAYMENT_SYSTEMS = new Set<string>(['201','204'])

// IGTF sobre (productos + delivery + comisión)
const INCLUDE_COMMISSION_IN_BASE = true
const COMMISSION_RATE = 0.03

/* ========================================================================= */

interface TaxItem {
  id: string
  itemPrice?: number
  sellingPrice?: number
  quantity?: number
}

interface TaxTotal {
  id: string
  name?: string
  value: number
}

/**
 * Handler del Tax Protocol. REGLA DE ORO: pase lo que pase, responder 200.
 * Un 500 acá rompe el checkout entero. Todo está envuelto: si algo falla,
 * devolvemos itemTaxResponse vacío (sin IGTF) pero con status 200.
 */
export async function orderTax(ctx: Context) {
  const { clients: { checkout }, vtex: { logger } } = ctx

  // Fallback global. Si no logramos ni parsear items, devolvemos vacío total.
  let items: TaxItem[] = []

  try {
    // --- Parseo defensivo del body (ACÁ solía reventar en 500) ---
    let payload: any = {}
    try {
      payload = (ctx.req as any).body ?? (await json(ctx.req))
    } catch (parseErr) {
      logger.error({ message: 'IGTF: no pude parsear el body', error: (parseErr as Error)?.message })
      ctx.status = 200
      ctx.body = { itemTaxResponse: [] }
      return
    }

    // LOG DEL PAYLOAD REAL: para ver qué manda Checkout (id, unidad, campos).
    // Quitá o bajá a debug una vez validado.
    logger.info({
      message: 'IGTF: request recibido',
      orderFormId: payload?.orderFormId,
      itemsSample: JSON.stringify((payload?.items ?? []).slice(0, 2)),
      totals: JSON.stringify(payload?.totals ?? []),
    })

    items = Array.isArray(payload?.items) ? payload.items : []
    const totals: TaxTotal[] = Array.isArray(payload?.totals) ? payload.totals : []

    const noTax = { itemTaxResponse: items.map(it => ({ id: it.id, taxes: [] as unknown[] })) }

    // Sin orderFormId no podemos leer el método de pago -> sin IGTF.
    if (!payload?.orderFormId) {
      ctx.status = 200
      ctx.body = noTax
      return
    }

    // 1) Método de pago (no viene en el payload; lo leemos del orderForm).
    let isUsdPayment = false
    try {
      const orderForm = await checkout.getOrderForm(payload.orderFormId)
      const payments = orderForm?.paymentData?.payments ?? []
      isUsdPayment = payments.some(
        (p: OrderFormPayment) =>
          p.paymentSystem != null && USD_PAYMENT_SYSTEMS.has(String(p.paymentSystem))
      )
    } catch (ofErr) {
      // Si falla la lectura del orderForm, NO reventamos: sin IGTF y seguimos.
      logger.error({ message: 'IGTF: getOrderForm falló', error: (ofErr as Error)?.message })
      ctx.status = 200
      ctx.body = noTax
      return
    }

    if (!isUsdPayment) {
      ctx.status = 200
      ctx.body = noTax
      return
    }

    // 2) Base = productos (neto de descuentos) + envío + comisión.
    const byId = totals.reduce<Record<string, number>>((acc, t) => {
      if (t && typeof t.id === 'string') acc[t.id] = Number(t.value) || 0
      return acc
    }, {})

    const itemsTotal = byId.Items ?? 0
    const discounts = byId.Discounts ?? 0
    const shipping = byId.Shipping ?? 0
    const productsNet = itemsTotal + discounts
    const commission = INCLUDE_COMMISSION_IN_BASE ? productsNet * COMMISSION_RATE : 0
    const base = productsNet + shipping + commission
    const igtfTotal = round2(base * IGTF_RATE)

    if (igtfTotal <= 0 || items.length === 0) {
      ctx.status = 200
      ctx.body = noTax
      return
    }

    const itemTaxResponse = prorate(items, igtfTotal)
    logger.info({ message: 'IGTF aplicado', orderFormId: payload.orderFormId, base, igtfTotal })

    ctx.status = 200
    ctx.body = { itemTaxResponse }
  } catch (err) {
    // Red de seguridad final: cualquier cosa no prevista -> 200 sin IGTF.
    logger.error({ message: 'IGTF: error inesperado (fail-safe)', error: (err as Error)?.message })
    ctx.status = 200
    ctx.body = { itemTaxResponse: items.map(it => ({ id: it.id, taxes: [] as unknown[] })) }
  }
}

function lineValue(it: TaxItem): number {
  const price = it.itemPrice ?? it.sellingPrice ?? 0
  const qty = it.quantity ?? 1
  return (Number(price) || 0) * (Number(qty) || 1)
}

function prorate(items: TaxItem[], igtfTotal: number) {
  const values = items.map(lineValue)
  const sum = values.reduce((a, b) => a + b, 0)
  let allocated = 0

  return items.map((it, i) => {
    const isLast = i === items.length - 1
    let share: number
    if (isLast) share = round2(igtfTotal - allocated)
    else if (sum > 0) share = round2((values[i] / sum) * igtfTotal)
    else share = round2(igtfTotal / items.length)
    allocated = round2(allocated + share)
    return {
      id: it.id,
      taxes: share > 0
        ? [{ name: IGTF_NAME, description: IGTF_DESCRIPTION, value: share }]
        : [],
    }
  })
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}