import { createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

const DEFAULT_ORIGIN = 'https://neoy.qili2.com';
const CALLBACK = 'http://127.0.0.1:8765/neo/oauth/callback';
const DEFAULT_TOKEN_FILE = join(homedir(), 'Library', 'Application Support', 'NeoY', 'core-token');

/** Request a one-hour, non-refreshable client credential via Neo's existing OAuth PKCE gateway. */
export async function issueNeoMcpToken({
  origin = process.env.NEO_MCP_ORIGIN ?? DEFAULT_ORIGIN,
  operatorToken,
  fetcher = fetch,
  clientName = 'Neo interactive MCP client',
} = {}) {
  origin = origin.replace(/\/$/, '');
  if (!/^https:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?$/.test(origin)) throw Error('Neo MCP OAuth origin must use HTTPS');
  if (!operatorToken) throw Error('The Neo operator credential is required on the trusted host');
  if (typeof clientName !== 'string' || !clientName.trim() || clientName.length > 100) {
    throw Error('Invalid OAuth client name');
  }

  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(18).toString('hex');
  const request = (path, options) => fetcher(origin + path, {
    ...options, signal: AbortSignal.timeout(15_000), redirect: 'manual',
  });
  const json = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const form = body => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });

  const registration = await request('/register', json({
    client_name: clientName,
    redirect_uris: [CALLBACK],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  }));
  if (registration.status !== 201) throw Error('Neo OAuth client registration rejected: HTTP ' + registration.status);
  const client = await registration.json();
  if (!client.client_id) throw Error('Neo OAuth client registration returned no client ID');

  const query = new URLSearchParams({
    response_type: 'code', client_id: client.client_id, redirect_uri: CALLBACK,
    code_challenge: challenge, code_challenge_method: 'S256',
    scope: 'mcp', resource: origin + '/mcp', state,
  });
  const authorization = await request('/authorize?' + query, { method: 'GET' });
  if (authorization.status !== 200) throw Error('Neo OAuth authorization rejected: HTTP ' + authorization.status);
  const authorizationHtml = await authorization.text();
  const rid = authorizationHtml.match(/name="rid"\s+value="([A-Za-z0-9_-]+)"/)?.[1];
  if (!rid) throw Error('Neo OAuth authorization page did not return a request ID');

  const approval = await request('/authorize', form({ rid, token: operatorToken }));
  if (approval.status !== 302) throw Error('Neo OAuth operator approval rejected: HTTP ' + approval.status);
  const location = approval.headers.get('location');
  if (!location) throw Error('Neo OAuth operator approval did not redirect');
  const callback = new URL(location);
  const expected = new URL(CALLBACK);
  if (callback.origin !== expected.origin || callback.pathname !== expected.pathname ||
      callback.searchParams.get('state') !== state || callback.searchParams.get('iss') !== origin) {
    throw Error('Neo OAuth callback failed issuer/state/redirect validation');
  }
  const code = callback.searchParams.get('code');
  if (!code) throw Error('Neo OAuth callback lacked an authorization code');

  const exchange = await request('/token', form({
    grant_type: 'authorization_code', client_id: client.client_id,
    redirect_uri: CALLBACK, code, code_verifier: verifier,
  }));
  if (exchange.status !== 200) throw Error('Neo OAuth token exchange rejected: HTTP ' + exchange.status);
  const result = await exchange.json();
  if (typeof result.access_token !== 'string' || !result.access_token || result.expires_in !== 3600) {
    throw Error('Neo OAuth returned an invalid one-hour access token');
  }
  // Never give a refresh credential to an interactive external AI client.
  if (result.refresh_token) {
    const revocation = await request('/revoke', form({ token: result.refresh_token }));
    if (revocation.status !== 200) throw Error('Neo OAuth failed to revoke its unused refresh token');
  }
  return { accessToken: result.access_token, expiresInSeconds: result.expires_in, mcpUrl: origin + '/mcp' };
}

export function parseNeoMcpTokenArgs(args) {
  const [verb, ...options] = args;
  if (verb !== 'issue' && verb !== 'revoke') throw Error('usage: neo mcp token issue --output ABSOLUTE_PATH [--origin HTTPS_URL] [--client-name NAME]\n       neo mcp token revoke --file ABSOLUTE_PATH [--origin HTTPS_URL]');
  const values = {};
  for (let i = 0; i < options.length; i += 2) {
    const option = options[i];
    if (!['--output', '--file', '--origin', '--client-name'].includes(option) || values[option] !== undefined) {
      throw Error('Invalid or repeated Neo MCP token option: ' + option);
    }
    if (!options[i + 1] || options[i + 1].startsWith('--')) throw Error(option + ' needs a value');
    values[option] = options[i + 1];
  }
  const filepath = verb === 'issue' ? values['--output'] : values['--file'];
  if (!filepath || !isAbsolute(filepath)) throw Error('Neo MCP token requires an absolute ' + (verb === 'issue' ? '--output' : '--file') + ' file path');
  if (verb === 'issue' && values['--file'] !== undefined || verb === 'revoke' && (values['--output'] !== undefined || values['--client-name'] !== undefined)) {
    throw Error('Unsupported option for token ' + verb);
  }
  return { verb, filepath, origin: values['--origin'], clientName: values['--client-name'] };
}

export async function runNeoMcpToken(args, {
  fetcher = fetch,
  readOperator = () => readFile(process.env.NEO_MCP_OPERATOR_TOKEN_FILE ?? DEFAULT_TOKEN_FILE, 'utf8'),
} = {}) {
  const options = parseNeoMcpTokenArgs(args);
  const origin = options.origin ?? process.env.NEO_MCP_ORIGIN ?? DEFAULT_ORIGIN;
  if (options.verb === 'issue') {
    // A failed output path must not cause needless credential issuance.
    const { open } = await import('node:fs/promises');
    const file = await open(options.filepath, 'wx', 0o600);
    try {
      const operatorToken = (await readOperator()).trim();
      const result = await issueNeoMcpToken({ origin, clientName: options.clientName, operatorToken, fetcher });
      await file.writeFile(result.accessToken + '\n', 'utf8');
      return {
        token_file: options.filepath,
        expires_in_seconds: result.expiresInSeconds,
        mcp_url: result.mcpUrl,
        note: 'Read the private file locally. Do not paste the token into public logs, a repository, or shared bootstrap instructions.',
      };
    } catch (error) {
      await file.close();
      await unlink(options.filepath).catch(() => {});
      throw error;
    } finally {
      await file.close().catch(() => {});
    }
  }
  const accessToken = (await readFile(options.filepath, 'utf8')).trim();
  if (!accessToken) throw Error('Neo MCP access token file is empty');
  const revokeUrl = origin.replace(/\/$/, '') + '/revoke';
  if (!/^https:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?\/revoke$/.test(revokeUrl)) throw Error('Revocation requires an HTTPS Neo OAuth origin');
  const revocation = await fetcher(revokeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: accessToken }),
    signal: AbortSignal.timeout(15_000),
    redirect: 'manual',
  });
  if (revocation.status !== 200) throw Error('Neo MCP access token revocation failed: HTTP ' + revocation.status);
  await unlink(options.filepath);
  return { revoked: true, removed_file: options.filepath };
}
