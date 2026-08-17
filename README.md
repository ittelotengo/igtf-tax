# IGTF Tax Service (VTEX IO)

Tax service que aplica **3% de IGTF** para pagos en divisas (Zelle / efectivo) a
**todo el carrito**, incluidos items de otros sellers, usando el flag
`isMarketplaceResponsibleForTaxes`.

## Cómo funciona

1. Checkout llama a `POST /_v/igtf/order-tax` cada vez que cambia el carrito.
2. El servicio lee el orderForm (`getOrderForm`) para ver el método de pago
   seleccionado — **no viene en el payload del tax**.
3. Si es Zelle/efectivo, calcula 3% sobre (productos − descuentos + envío +
   comisión) y prorratea ese total entre los items.
4. Devuelve `itemTaxResponse`. Checkout lo muestra y lo persiste en la orden.

## Antes de desplegar — valores a revisar

- `USD_PAYMENT_SYSTEMS` en `node/middlewares/orderTax.ts`: poné los
  `paymentSystem` reales de Zelle y efectivo.
- Campo de precio del item (`itemPrice` / `sellingPrice`): confirmá el nombre
  logueando un request real.
- **Unidad monetaria** de los montos (unidades vs. enteros): confirmala con un
  request real y ajustá `round2` si hiciera falta.
- `INCLUDE_COMMISSION_IN_BASE` / `COMMISSION_RATE`: ajustá según cómo calcules
  la comisión por servicio.
- `TU_VENDOR` en `manifest.json`.

## Deploy

```bash
vtex login {tu-cuenta}
vtex use workspace-dev          # trabajá en un workspace, no en master
vtex link                       # desarrollo con hot reload
# validá en el workspace, luego:
vtex release                    # o vtex publish + vtex deploy
```

## Activar el tax service

Con el app corriendo (linkeado o instalado), activá la config del orderForm:

```bash
# activar (marketplace responsable de impuestos, aplica a todos los sellers)
curl -X POST https://{workspace}--{cuenta}.myvtex.com/_v/igtf/configure \
  -H "VtexIdclientAutCookie: {tu-token}"

# desactivar
curl -X DELETE https://{workspace}--{cuenta}.myvtex.com/_v/igtf/configure \
  -H "VtexIdclientAutCookie: {tu-token}"
```

> `isMarketplaceResponsibleForTaxes` **no es compatible** con Multilevel
> Omnichannel Inventory. Verificalo antes de activar.

## Prueba crítica

Armá un carrito que mezcle **un producto tuyo y uno de un seller invite**,
llegá al paso de Pago y seleccioná Zelle:

- El IGTF debe aparecer y afectar **ambos** items.
- Cambiá a un método no-USD (ej. pago móvil): el IGTF debe **desaparecer**.
- Colocá la orden y verificá en el OMS que el impuesto **quedó registrado**.

## Pendiente (no incluido en este scaffold)

- **Disparador de recálculo** en `checkout-ui-custom`: forzar que Checkout
  recalcule el tax cuando el usuario cambia de método de pago. Sin esto, si el
  tax se calculó antes de elegir pago, no se re-evalúa. Es la pieza frágil.
- **Hook de invoice** (`hooks` en la respuesta) si necesitás el impuesto también
  en la nota fiscal / OMS al facturar.
