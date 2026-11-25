/* Writes a new signing key to a private file; never prints the private key. */
const { generateKeyPairSync } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const destination = process.argv[2];
if (!destination) {
  process.stderr.write(
    'Usage: node scripts/generate-offline-signing-key.cjs /private/path/offline-key.env\n',
  );
  process.exitCode = 1;
} else {
  const { privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const encoded = Buffer.from(
    privateKey.export({ type: 'pkcs8', format: 'pem' }),
  ).toString('base64');
  // wx refuses to overwrite an existing signing key. Losing old verification keys
  // would prevent independent validation of already saved offline events.
  fs.writeFileSync(
    path.resolve(destination),
    `OFFLINE_SIGNING_PRIVATE_KEY_BASE64=${encoded}\n`,
    { flag: 'wx', mode: 0o600 },
  );
  process.stdout.write(
    `Created signing-key file: ${path.resolve(destination)}\nKeep this file outside source control and load it into your server environment.\n`,
  );
}
