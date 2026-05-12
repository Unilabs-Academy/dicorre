import {
  fetch as undiciFetch,
  getGlobalDispatcher,
  setGlobalDispatcher,
  Socks5ProxyAgent,
} from 'undici'

export const ENV_SOCKS_PROXY = 'DICORRE_SOCKS_PROXY'

export const resolveSocksProxyUrl = (value?: string | null): string | undefined => {
  const raw = value?.trim()
  if (!raw) return undefined

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`Invalid SOCKS proxy URL: ${raw}`)
  }

  if (url.protocol !== 'socks5:' && url.protocol !== 'socks:') {
    throw new Error('SOCKS proxy URL must start with socks5:// or socks://')
  }

  if (!url.hostname) {
    throw new Error('SOCKS proxy URL must include a host')
  }

  return url.toString()
}

export const withCliSocksProxy = async <A>(
  proxyArg: string | undefined,
  run: () => Promise<A>,
): Promise<A> => {
  const proxyUrl = resolveSocksProxyUrl(proxyArg ?? process.env[ENV_SOCKS_PROXY])
  if (!proxyUrl) return run()

  const previousFetch = globalThis.fetch
  const previousDispatcher = getGlobalDispatcher()
  const agent = new Socks5ProxyAgent(proxyUrl)

  setGlobalDispatcher(agent)
  globalThis.fetch = undiciFetch as typeof fetch

  try {
    return await run()
  } finally {
    globalThis.fetch = previousFetch
    setGlobalDispatcher(previousDispatcher)
    await agent.close()
  }
}
