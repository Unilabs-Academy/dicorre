import { readFile } from 'node:fs/promises'
import net from 'node:net'
import tls from 'node:tls'
import {
  Agent,
  buildConnector,
  fetch as undiciFetch,
  getGlobalDispatcher,
  setGlobalDispatcher,
} from 'undici'
import type buildConnectorType from 'undici/types/connector'

export const ENV_SOCKS_PROXY = 'DICORRE_SOCKS_PROXY'
export const ENV_CA_CERT = 'DICORRE_CA_CERT'

export interface CliNetworkOptions {
  readonly socksProxy?: string
  readonly caCert?: string
}

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

const readCaBundle = async (value?: string | null): Promise<string | undefined> => {
  const raw = value?.trim()
  if (!raw) return undefined

  try {
    return await readFile(raw, 'utf8')
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Unable to read CA certificate bundle at ${raw}: ${detail}`)
  }
}

const readFromSocket = (socket: net.Socket, isComplete: (buffer: Buffer) => boolean): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0)

    const cleanup = () => {
      socket.off('data', onData)
      socket.off('error', onError)
      socket.off('close', onClose)
    }
    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])
      if (isComplete(buffer)) {
        cleanup()
        resolve(buffer)
      }
    }
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    const onClose = () => {
      cleanup()
      reject(new Error('SOCKS proxy closed the connection'))
    }

    socket.on('data', onData)
    socket.once('error', onError)
    socket.once('close', onClose)
  })

const waitForConnect = (socket: net.Socket): Promise<void> =>
  new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.off('connect', onConnect)
      socket.off('error', onError)
    }
    const onConnect = () => {
      cleanup()
      resolve()
    }
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    socket.once('connect', onConnect)
    socket.once('error', onError)
  })

const socksResponseLength = (buffer: Buffer): number | undefined => {
  if (buffer.length < 5) return undefined
  const atyp = buffer[3]
  if (atyp === 0x01) return 10
  if (atyp === 0x03) {
    const length = buffer[4]
    return length === undefined ? undefined : 5 + length + 2
  }
  if (atyp === 0x04) return 22
  return undefined
}

const connectViaSocks = async (
  proxyUrl: URL,
  targetHost: string,
  targetPort: number,
): Promise<net.Socket> => {
  const socket = net.connect({
    host: proxyUrl.hostname,
    port: Number(proxyUrl.port || 1080),
  })

  await waitForConnect(socket)

  const username = decodeURIComponent(proxyUrl.username || '')
  const password = decodeURIComponent(proxyUrl.password || '')
  const wantsAuth = username.length > 0 || password.length > 0
  socket.write(Buffer.from(wantsAuth ? [0x05, 0x02, 0x00, 0x02] : [0x05, 0x01, 0x00]))

  const greeting = await readFromSocket(socket, (buffer) => buffer.length >= 2)
  if (greeting[0] !== 0x05 || greeting[1] === 0xff) {
    socket.destroy()
    throw new Error('SOCKS proxy did not accept an authentication method')
  }

  if (greeting[1] === 0x02) {
    const user = Buffer.from(username, 'utf8')
    const pass = Buffer.from(password, 'utf8')
    if (user.length > 255 || pass.length > 255) {
      socket.destroy()
      throw new Error('SOCKS proxy username/password must be at most 255 bytes')
    }
    socket.write(Buffer.concat([Buffer.from([0x01, user.length]), user, Buffer.from([pass.length]), pass]))
    const auth = await readFromSocket(socket, (buffer) => buffer.length >= 2)
    if (auth[1] !== 0x00) {
      socket.destroy()
      throw new Error('SOCKS proxy authentication failed')
    }
  }

  const host = Buffer.from(targetHost, 'utf8')
  if (host.length > 255) {
    socket.destroy()
    throw new Error('SOCKS target host must be at most 255 bytes')
  }
  const request = Buffer.alloc(4 + 1 + host.length + 2)
  request[0] = 0x05
  request[1] = 0x01
  request[2] = 0x00
  request[3] = 0x03
  request[4] = host.length
  host.copy(request, 5)
  request.writeUInt16BE(targetPort, 5 + host.length)
  socket.write(request)

  const response = await readFromSocket(socket, (buffer) => {
    const length = socksResponseLength(buffer)
    return length !== undefined && buffer.length >= length
  })

  if (response[1] !== 0x00) {
    socket.destroy()
    throw new Error(`SOCKS proxy connect failed with status 0x${response[1]?.toString(16).padStart(2, '0')}`)
  }

  return socket
}

const createSocksConnector = (
  proxyUrl: string,
  ca?: string[],
): buildConnectorType.connector => {
  const proxy = new URL(proxyUrl)

  return (options, callback) => {
    const run = async () => {
      const hostname = options.hostname || options.host
      if (!hostname) throw new Error('SOCKS connector requires a target hostname')
      const port = Number(options.port || (options.protocol === 'https:' ? 443 : 80))
      const socket = await connectViaSocks(proxy, hostname, port)

      if (options.protocol !== 'https:') return socket

      return await new Promise<tls.TLSSocket>((resolve, reject) => {
        const tlsSocket = tls.connect({
          socket,
          servername: options.servername || hostname,
          ca,
        })
        tlsSocket.once('secureConnect', () => resolve(tlsSocket))
        tlsSocket.once('error', reject)
      })
    }

    run().then((socket) => callback(null, socket), (error) => callback(error, null))
  }
}

export const withCliNetwork = async <A>(
  options: CliNetworkOptions,
  run: () => Promise<A>,
): Promise<A> => {
  const proxyUrl = resolveSocksProxyUrl(options.socksProxy ?? process.env[ENV_SOCKS_PROXY])
  const ca = await readCaBundle(options.caCert ?? process.env[ENV_CA_CERT])
  const caBundle = ca ? [...tls.rootCertificates, ca] : undefined
  if (!proxyUrl && !ca) return run()

  const previousFetch = globalThis.fetch
  const previousDispatcher = getGlobalDispatcher()
  const agent = proxyUrl
    ? new Agent({ connect: createSocksConnector(proxyUrl, caBundle) })
    : new Agent({ connect: buildConnector({ ca: caBundle }) })

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
