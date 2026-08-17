import { json } from 'co-body'

/* =========================================================================
 * CONFIGURACIÓN  — revisá estos valores antes de desplegar
 * ========================================================================= */

// Tasa del IGTF
const IGTF_RATE = 0.03

const IGTF_NAME = 'IGTF'
const IGTF_DESCRIPTION = 'Impuesto a las Grandes Transacciones Financieras (pago en divisas)'

// paymentSystem IDs que disparan el IGTF (Zelle y efectivo).
// >>> IMPRESCINDIBLE: reemplazá 'XX'/'YY' por los IDs reales.
// Los obtenés inspeccionando un orderForm real con esos métodos seleccionados,
// en orderForm.paymentData.payments[].paymentSystem
const USD_PAYMENT_SYSTEMS = new Set<string>(['Zelle', 'Efectivo'])

// ¿El IGTF incluye la comisión por servicio en su base?
// El requisito era: IGTF sobre (productos + delivery + comisión).
// Si la comisión es un 3% fijo del neto de productos, la calculamos aquí para
// meterla en la base. Si tu comisión se calcula de otra forma, ajustá esto.
const INCLUDE_COMMISSION_IN_BASE = true
const COMMISSION_RATE = 0.03

/* ========================================================================= */

interface TaxItem {
  id: string
  // OJO: confirmá el nombre real del campo de precio inspeccionando un request
  // real (logueá el payload). Suele venir alguno de estos:
  itemPrice?: number
  sellingPrice?: number
  quantity?: number
}

interface TaxTotal {
  id: string // 'Items' | 'Discounts' | 'Shipping' | ...
  name?: string
  value: number
}

export async function orderTax(ctx: Context) {
  const {
    clients: { checkout },
    vtex: { logger },
  } = ctx

  const payload = await json(ctx.req)
  const items: TaxItem[] = payload?.items ?? []
  const totals: TaxTotal[] = payload?.totals ?? []

  // Respuesta por defecto: SIN impuesto. Es un fail-safe: si algo falla,
  // preferimos no cobrar IGTF antes que romper el checkout (timeout de 5s,
  // sin reintento). Perder el recargo en un caso raro es mejor que bloquear.
  const noTax = {
    itemTaxResponse: items.map(it => ({ id: it.id, taxes: [] as unknown[] })),
  }

  try {
    // 1) Leer el método de pago seleccionado (no viene en el payload del tax).
    const orderForm = await checkout.getOrderForm(payload.orderFormId)
    const payments = orderForm?.paymentData?.payments ?? []
    const isUsdPayment = payments.some(
      p => p.paymentSystem != null && USD_PAYMENT_SYSTEMS.has(String(p.paymentSystem))
    )

    if (!isUsdPayment) {
      ctx.status = 200
      ctx.body = noTax
      return
    }

    // 2) Base del IGTF = productos (neto de descuentos) + envío + comisión.
    const byId = totals.reduce<Record<string, number>>((acc, t) => {
      acc[t.id] = t.value
      return acc
    }, {})

    const itemsTotal = byId.Items ?? 0
    const discounts = byId.Discounts ?? 0 // ya viene en negativo
    const shipping = byId.Shipping ?? 0
    const productsNet = itemsTotal + discounts

    const commission = INCLUDE_COMMISSION_IN_BASE
      ? productsNet * COMMISSION_RATE
      : 0

    const base = productsNet + shipping + commission
    const igtfTotal = round2(base * IGTF_RATE)

    if (igtfTotal <= 0) {
      ctx.status = 200
      ctx.body = noTax
      return
    }

    // 3) El Tax Protocol sólo devuelve impuestos POR ÍTEM. Como el IGTF también
    //    grava envío y comisión (que no son items), prorrateamos el total del
    //    IGTF entre los items. El monto total cobrado queda exacto; sólo la
    //    atribución por línea es proporcional.
    const itemTaxResponse = prorate(items, igtfTotal)

    logger.info({
      message: 'IGTF applied',
      orderFormId: payload.orderFormId,
      base,
      igtfTotal,
    })

    ctx.status = 200
    ctx.body = { itemTaxResponse }
  } catch (err) {
    logger.error({
      message: 'IGTF calculation failed — returning no tax (fail-safe)',
      error: (err as Error)?.message,
      orderFormId: payload?.orderFormId,
    })
    ctx.status = 200
    ctx.body = noTax
  }
}

function lineValue(it: TaxItem): number {
  const price = it.itemPrice ?? it.sellingPrice ?? 0
  const qty = it.quantity ?? 1
  return price * qty
}

/**
 * Reparte igtfTotal entre los items en proporción a su valor.
 * Corrige el arrastre de redondeo en el último item para que la suma sea exacta.
 */
function prorate(items: TaxItem[], igtfTotal: number) {
  const values = items.map(lineValue)
  const sum = values.reduce((a, b) => a + b, 0)
  let allocated = 0

  return items.map((it, i) => {
    const isLast = i === items.length - 1
    let share: number

    if (isLast) {
      share = round2(igtfTotal - allocated)
    } else if (sum > 0) {
      share = round2((values[i] / sum) * igtfTotal)
    } else {
      share = round2(igtfTotal / items.length)
    }

    allocated = round2(allocated + share)

    return {
      id: it.id,
      taxes:
        share > 0
          ? [{ name: IGTF_NAME, description: IGTF_DESCRIPTION, value: share }]
          : [],
    }
  })
}

// OJO CON LA UNIDAD: derivamos todo de los propios valores del payload, así que
// la salida sale en la misma unidad que la entrada. round2 sirve tanto si los
// montos vienen en unidades de moneda (16.00) como si vienen enteros. Confirmá
// la unidad logueando un request real y ajustá el redondeo si hiciera falta.
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}
