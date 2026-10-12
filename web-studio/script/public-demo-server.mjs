// Public, read-only facade. The real user key never enters the Vite build.
import { createServer } from 'node:http'
import { readFile, realpath, stat } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../dist/', import.meta.url)))
const identity = { account_id: 'default', user_id: 'jye10032' }
const routes = new Map([
  ['/health', []],
  ['/ready', []],
  ['/bot/v1/health', []],
  ['/api/v1/system/status', []],
  [
    '/api/v1/fs/ls',
    [
      'uri',
      'simple',
      'recursive',
      'output',
      'abs_limit',
      'include_abstract',
      'include_overview',
      'overview_limit',
      'show_all_hidden',
      'node_limit',
      'offset',
      'limit',
      'sort_by',
      'sort_order',
      'extra_fields',
      'tags',
      'include_tags',
    ],
  ],
  [
    '/api/v1/fs/tree',
    [
      'uri',
      'output',
      'abs_limit',
      'include_abstract',
      'include_overview',
      'overview_limit',
      'show_all_hidden',
      'directories_only',
      'node_limit',
      'offset',
      'limit',
      'level_limit',
      'extra_fields',
      'tags',
      'include_tags',
    ],
  ],
  ['/api/v1/fs/stat', ['uri']],
  ['/api/v1/fs/attrs', ['uri']],
  ['/api/v1/content/read', ['uri', 'offset', 'limit', 'raw']],
  ['/api/v1/content/abstract', ['uri']],
  ['/api/v1/content/overview', ['uri']],
  ['/api/v1/content/download', ['uri']],
  ['/api/v1/sessions', []],
  ['/api/v1/stats/memories', ['category']],
  ['/api/v1/console/dashboard/summary', ['timezone']],
  ['/api/v1/console/tokens', ['start_date', 'end_date', 'bucket', 'timezone']],
  [
    '/api/v1/console/context-commits',
    ['start_date', 'end_date', 'bucket', 'timezone'],
  ],
  [
    '/api/v1/console/audit',
    ['page', 'page_size', 'request_id', 'status', 'api_type'],
  ],
  ['/api/v1/skills', ['node_limit', 'target_uri']],
  ...[
    'system',
    'queue',
    'vikingdb',
    'models',
    'filesystem',
    'lock',
    'retrieval',
  ].map((name) => [`/api/v1/observer/${name}`, ['format']]),
])
const dynamicRoutes = [
  // Deliberately exclude auto_create: a GET can otherwise create a session.
  [/^\/api\/v1\/sessions\/[\w-]+$/, []],
  [/^\/api\/v1\/sessions\/[\w-]+\/context$/, ['token_budget']],
  [/^\/api\/v1\/sessions\/[\w-]+\/archives\/[\w.-]+$/, []],
  [/^\/api\/v1\/stats\/sessions\/[\w-]+$/, []],
  [
    /^\/api\/v1\/skills\/[\w.-]+$/,
    [
      'target_uri',
      'include_content',
      'include_files',
      'include_integrity',
      'include_source',
      'level',
    ],
  ],
]

export function isAllowedRead(method, url) {
  if (method !== 'GET') return false
  const keys =
    routes.get(url.pathname) ??
    dynamicRoutes.find(([pattern]) => pattern.test(url.pathname))?.[1]
  return (
    keys !== undefined &&
    [...url.searchParams.keys()].every((key) => keys.includes(key))
  )
}

function json(response, status, data) {
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  })
  response.end(JSON.stringify(data))
}

function deny(response) {
  json(response, 403, {
    status: 'error',
    error: {
      code: 'PERMISSION_DENIED',
      message:
        'Public showcase is read-only. Writing, administration and model calls are disabled.',
    },
  })
}

export async function verifyIdentity(upstream, key) {
  if (!key) throw new Error('OV_DEMO_USER_API_KEY is required')
  const response = await fetch(new URL('/health', upstream), {
    headers: { 'X-API-Key': key },
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  })
  const health = await response.json()
  if (
    !response.ok ||
    health.role !== 'user' ||
    health.account_id !== identity.account_id ||
    health.user_id !== identity.user_id
  ) {
    throw new Error(
      'The showcase requires the ordinary default/jye10032 user key',
    )
  }
}

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

export function createShowcaseServer({ upstream, key, staticRoot = root }) {
  let inFlight = 0
  let windowStart = Date.now()
  let requestCount = 0
  return createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Referrer-Policy', 'no-referrer')
    try {
      if (
        !request.url?.startsWith('/') ||
        request.url.startsWith('//') ||
        request.url.includes('\\')
      )
        return deny(response)
      const url = new URL(request.url, 'http://showcase.local')
      if (url.pathname === '/showcase-health')
        return json(response, 200, { status: 'ok', mode: 'read-only' })
      const api =
        /^\/(?:api|bot)(?:\/|$)/.test(url.pathname) ||
        ['/health', '/ready'].includes(url.pathname)
      if (api) {
        if (!isAllowedRead(request.method, url)) return deny(response)
        if (Date.now() - windowStart >= 60000) {
          windowStart = Date.now()
          requestCount = 0
        }
        if (++requestCount > 600 || inFlight >= 20) {
          response.setHeader('Retry-After', '60')
          return json(response, 429, {
            status: 'error',
            error: {
              code: 'RATE_LIMITED',
              message: 'Please try again shortly.',
            },
          })
        }
        inFlight++
        try {
          // Construct headers from scratch: never forward visitor keys, cookies,
          // identity headers, method overrides, or a caller-controlled upstream.
          const result = await fetch(
            new URL(url.pathname + url.search, upstream),
            {
              headers: { 'X-API-Key': key, Accept: '*/*' },
              redirect: 'error',
              signal: AbortSignal.timeout(20000),
            },
          )
          response.setHeader(
            'Content-Security-Policy',
            "sandbox; default-src 'none'",
          )
          response.setHeader('Cache-Control', 'no-store')
          response.setHeader(
            'Content-Type',
            result.headers.get('content-type') || 'application/json',
          )
          if (url.pathname === '/api/v1/content/download')
            response.setHeader('Content-Disposition', 'attachment')
          // Buffer with a cap so upstream errors cannot produce unbounded output.
          const chunks = []
          let size = 0
          for await (const chunk of result.body ?? []) {
            size += chunk.length
            if (size > 16 * 1024 * 1024)
              throw new Error('Response exceeds showcase limit')
            chunks.push(chunk)
          }
          response.writeHead(result.status)
          response.end(Buffer.concat(chunks))
        } finally {
          inFlight--
        }
        return
      }
      if (!['GET', 'HEAD'].includes(request.method)) return deny(response)
      const pathname = decodeURIComponent(url.pathname)
      if (pathname.split('/').some((part) => part.startsWith('.')))
        return deny(response)
      let file = resolve(staticRoot, '.' + pathname)
      if (!file.startsWith(resolve(staticRoot) + sep))
        file = resolve(staticRoot, 'index.html')
      try {
        if (!(await stat(file)).isFile())
          file = resolve(staticRoot, 'index.html')
      } catch {
        file = resolve(staticRoot, 'index.html')
      }
      if (
        !(await realpath(file)).startsWith((await realpath(staticRoot)) + sep)
      )
        return deny(response)
      const content = await readFile(file)
      response.writeHead(200, {
        'Content-Type': mime[extname(file)] || 'application/octet-stream',
        'Cache-Control': file.endsWith('index.html')
          ? 'no-store'
          : 'public, max-age=3600',
      })
      response.end(request.method === 'HEAD' ? undefined : content)
    } catch {
      // No upstream URLs, credentials, stack traces, or response bodies in errors.
      if (!response.headersSent)
        json(response, 502, {
          status: 'error',
          error: {
            code: 'UNAVAILABLE',
            message: 'Showcase temporarily unavailable.',
          },
        })
      else response.destroy()
    }
  })
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const upstream = new URL(
    process.env.OV_DEMO_UPSTREAM ||
      'https://openviking-server-production.up.railway.app',
  )
  if (
    upstream.protocol !== 'https:' ||
    upstream.username ||
    upstream.password ||
    upstream.pathname !== '/'
  )
    throw new Error('Use an HTTPS upstream origin')
  const key = process.env.OV_DEMO_USER_API_KEY?.trim()
  await verifyIdentity(upstream, key)
  createShowcaseServer({ upstream, key }).listen(
    Number(process.env.PORT || 8080),
    '0.0.0.0',
    () => {
      console.log('OpenViking public read-only showcase ready')
    },
  )
}
