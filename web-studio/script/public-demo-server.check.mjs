import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createShowcaseServer,
  isAllowedRead,
  verifyIdentity,
} from './public-demo-server.mjs'

test('only explicitly reviewed reads pass; GET cannot auto-create sessions', () => {
  const allowed = [
    '/health',
    '/api/v1/fs/ls?uri=viking://&show_all_hidden=true&sort_by=mtime&sort_order=desc',
    '/api/v1/fs/tree?uri=viking://&show_all_hidden=true&node_limit=1000&level_limit=3',
    '/api/v1/skills?node_limit=1000',
    '/api/v1/skills/demo?include_content=true&include_files=true&target_uri=viking://user/skills',
    '/api/v1/fs/ls?uri=viking://resources',
    '/api/v1/sessions/demo/context?token_budget=1000',
  ]
  for (const path of allowed)
    assert.ok(isAllowedRead('GET', new URL(path, 'https://demo.test')))
  for (const path of [
    '/api/v1/admin/accounts',
    '/api/v1/sessions/demo?auto_create=true',
    '/api/v1/fs/ls?uri=viking://&account_id=other',
    '/api/v1/unknown',
    '/api/v1/sessions/demo/config',
  ]) {
    assert.equal(
      isAllowedRead('GET', new URL(path, 'https://demo.test')),
      false,
      path,
    )
  }
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']) {
    assert.equal(
      isAllowedRead(method, new URL('/api/v1/fs/ls', 'https://demo.test')),
      false,
    )
  }
})

test('HTTP facade strips visitor credentials, blocks writes, protects downloads and refuses redirects', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ov-demo-test-'))
  await writeFile(join(dir, 'index.html'), '<html>Demo</html>')
  const forwarded = []
  let role = 'user'
  const upstream = createServer((req, res) => {
    forwarded.push({ url: req.url, headers: req.headers })
    if (req.url === '/health') {
      res.setHeader('Content-Type', 'application/json')
      res.end(
        JSON.stringify({ role, account_id: 'default', user_id: 'jye10032' }),
      )
    } else if (req.url.includes('redirect')) {
      res.writeHead(302, { Location: '/leak' })
      res.end()
    } else {
      res.setHeader('Content-Type', 'application/json')
      res.end('{"status":"ok","result":[]}')
    }
  })
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  const origin = new URL(`http://127.0.0.1:${upstream.address().port}`)
  const server = createShowcaseServer({
    upstream: origin,
    key: 'server-only-key',
    staticRoot: dir,
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    await verifyIdentity(origin, 'server-only-key')
    role = 'root'
    await assert.rejects(verifyIdentity(origin, 'root-key'))
    role = 'user'
    const read = await fetch(base + '/api/v1/fs/ls?uri=viking://resources', {
      headers: {
        'X-API-Key': 'attacker',
        'X-OpenViking-User': 'other',
        Cookie: 'private=1',
        Authorization: 'Bearer attacker',
      },
    })
    assert.equal(read.status, 200)
    const headers = forwarded.at(-1).headers
    assert.equal(headers['x-api-key'], 'server-only-key')
    for (const key of ['cookie', 'authorization', 'x-openviking-user'])
      assert.equal(headers[key], undefined)
    let count = forwarded.length
    for (const [method, path] of [
      ['POST', '/api/v1/content/write'],
      ['DELETE', '/api/v1/fs?uri=viking://resources'],
      ['GET', '/api/v1/admin/accounts'],
      ['GET', '/api/v1/sessions/test?auto_create=true'],
      ['POST', '/bot/v1/chat'],
      ['POST', '/api/v1/search/find'],
    ])
      assert.equal((await fetch(base + path, { method })).status, 403)
    assert.equal(forwarded.length, count)
    const download = await fetch(
      base + '/api/v1/content/download?uri=viking://resources/page.html',
    )
    assert.equal(download.headers.get('content-disposition'), 'attachment')
    assert.match(download.headers.get('content-security-policy'), /sandbox/)
    assert.equal(
      (await fetch(base + '/api/v1/content/read?uri=redirect')).status,
      502,
    )
    assert.ok(!forwarded.some((item) => item.url === '/leak'))
    const page = await fetch(base + '/filesystem')
    assert.equal(await page.text(), '<html>Demo</html>')
    assert.equal((await fetch(base + '/.env')).status, 403)
    assert.equal(
      (await fetch(base + '/script/public-demo-server.mjs')).headers.get(
        'content-type',
      ),
      'text/html; charset=utf-8',
    )
  } finally {
    server.closeAllConnections()
    upstream.closeAllConnections()
    await Promise.all([
      new Promise((resolve) => server.close(resolve)),
      new Promise((resolve) => upstream.close(resolve)),
    ])
    await rm(dir, { recursive: true })
  }
})
