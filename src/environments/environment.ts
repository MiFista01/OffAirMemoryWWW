export const environment = {
  apiUrl: '/api',
  /** Same public host as the SPA; nginx proxies /socket.io/ → Nest (как в crime). */
  apiSocket: 'wss://tv.mifista.eu',
  apiStatic: '/static',
  streamBase: '',
};
