export const Runtime = {
  port: Number(process.env.PORT ?? 8084),
  jwtSecret: process.env.JWT_SECRET ?? 'change-me-in-prod',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '12h',
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS ?? 10),
  totpIssuer: process.env.TOTP_ISSUER ?? 'Guardrails-Admin',
  bootstrapEmail: process.env.ADMIN_BOOTSTRAP_EMAIL ?? '',
  bootstrapPassword: process.env.ADMIN_BOOTSTRAP_PASSWORD ?? '',
  dbDriver: ((process.env.DB_DRIVER ?? 'postgres').toLowerCase() === 'sqlite' ? 'sqlite' : 'postgres') as
    | 'postgres'
    | 'sqlite',
  sqlitePath: process.env.SQLITE_PATH ?? './var/admin.db',
  policyEngineUrl: process.env.POLICY_ENGINE_URL ?? 'http://127.0.0.1:8082',
};
