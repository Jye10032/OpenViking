export const PUBLIC_DEMO = import.meta.env.VITE_OV_PUBLIC_DEMO === 'true'

export function publicDemoConnection() {
  return {
    accountId: 'default',
    adminApiKey: '',
    // A public UI marker, not an OpenViking credential. The server supplies it.
    apiKey: 'public-readonly-showcase',
    baseUrl: typeof window === 'undefined' ? '' : window.location.origin,
    userId: 'jye10032',
  }
}
