-- Jump CLI is the pre-registered first-party OAuth public client. Its loopback
-- port varies per invocation; authorization enforces the registered host/path
-- exactly while allowing RFC 8252's dynamic loopback port.
INSERT INTO "OAuthClient" (
  "id", "clientId", "kind", "name", "redirectUris", "createdAt"
) VALUES (
  'oauth_jump_cli',
  'jump-cli',
  'FIRST_PARTY'::"OAuthClientKind",
  'Jump CLI',
  ARRAY['http://127.0.0.1/callback', 'http://localhost/callback', 'http://[::1]/callback']::TEXT[],
  CURRENT_TIMESTAMP
)
ON CONFLICT ("clientId") DO NOTHING;
