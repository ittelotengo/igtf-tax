import { JanusClient, InstanceOptions, IOContext } from '@vtex/api'

export interface OrderFormPayment {
  paymentSystem?: string
  paymentSystemName?: string
  value?: number
}

export interface OrderForm {
  orderFormId: string
  paymentData?: {
    payments?: OrderFormPayment[]
  }
}

// Full orderForm configuration. We only care about taxConfiguration, but we
// must preserve everything else on write, or we would wipe other settings.
export interface OrderFormConfiguration {
  taxConfiguration?: TaxConfiguration | null
  [key: string]: unknown
}

export interface TaxConfiguration {
  url: string
  authorizationHeader?: string
  allowExecutionAfterErrors?: boolean
  integratedAuthentication?: boolean
  appId?: string
  isMarketplaceResponsibleForTaxes?: boolean
}

export class Checkout extends JanusClient {
  constructor(ctx: IOContext, options?: InstanceOptions) {
    super(ctx, {
      ...options,
      headers: {
        ...(options?.headers ?? {}),
        VtexIdclientAutCookie: ctx.authToken ?? '',
      },
    })
  }

  // Public endpoint: lets us read the currently selected payment method,
  // which is NOT included in the tax service request payload.
  public getOrderForm = (orderFormId: string) =>
    this.http.get<OrderForm>(`/api/checkout/pub/orderForm/${orderFormId}`, {
      metric: 'igtf-get-orderform',
      // Timeout corto: si el orderForm no responde rápido, abortamos y
      // seguimos sin IGTF, para nunca colgar la respuesta al Checkout.
      timeout: 1500,
    })

  public getOrderFormConfiguration = () =>
    this.http.get<OrderFormConfiguration>(
      '/api/checkout/pvt/configuration/orderForm',
      { metric: 'igtf-get-config' }
    )

  public setOrderFormConfiguration = (config: OrderFormConfiguration) =>
    this.http.post('/api/checkout/pvt/configuration/orderForm', config, {
      metric: 'igtf-set-config',
    })
}