/**
 * Activa o desactiva el tax service en la config del orderForm de la cuenta.
 *
 *   POST   /_v/igtf/configure   -> activa (marketplace responsable)
 *   DELETE /_v/igtf/configure   -> desactiva
 *
 * Hace GET de la config actual y hace merge, para NO pisar el resto de ajustes
 * del orderForm (precisión decimal, cantidades mínimas, etc.).
 */
export async function configure(ctx: Context) {
  const {
    clients: { checkout },
    vtex: { account, logger },
  } = ctx

  const isDeactivate = ctx.req.method === 'DELETE'

  // URL pública de tu ruta de cálculo. Ajustá el workspace si probás en uno
  // que no sea master (ej: https://{workspace}--{account}.myvtex.com/...).
  const taxUrl = `https://dev1--${account}.myvtex.com/_v/igtf/order-tax`

  try {
    const current = await checkout.getOrderFormConfiguration()

    const updated = {
      ...current,
      taxConfiguration: isDeactivate
        ? null
        : {
            url: taxUrl,
            // Clave de todo: hace que el marketplace sea responsable de los
            // impuestos de TODO el carrito, incluidos items de otros sellers.
            isMarketplaceResponsibleForTaxes: true,
            // Si querés proteger el endpoint, seteá un header compartido y
            // validalo en orderTax.ts.
            // authorizationHeader: 'un-secreto-compartido',
            allowExecutionAfterErrors: false,
          },
    }

    await checkout.setOrderFormConfiguration(updated)

    ctx.status = 200
    ctx.body = {
      ok: true,
      action: isDeactivate ? 'deactivated' : 'activated',
      taxConfiguration: updated.taxConfiguration,
    }
  } catch (err) {
    logger.error({
      message: 'Failed to update tax configuration',
      error: (err as Error)?.message,
    })
    ctx.status = 500
    ctx.body = { ok: false, error: (err as Error)?.message }
  }
}
