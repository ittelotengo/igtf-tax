import { ClientsConfig, Service, ServiceContext, RecorderState, method } from '@vtex/api'

import { Clients } from './clients'
import { orderTax } from './middlewares/orderTax'
import { configure } from './middlewares/configure'

const TIMEOUT_MS = 3000

declare global {
  type Context = ServiceContext<Clients, State>
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  interface State extends RecorderState {}
}

const clients: ClientsConfig<Clients> = {
  implementation: Clients,
  options: {
    default: {
      retries: 1,
      timeout: TIMEOUT_MS,
    },
  },
}

export default new Service<Clients, State>({
  clients,
  routes: {
    orderTax: method({ POST: [orderTax] }),
    configure: method({ POST: [configure], DELETE: [configure] }),
  },
})
