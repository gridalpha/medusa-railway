import { defineConfig, loadEnv } from "@medusajs/framework/utils"

loadEnv(process.env.NODE_ENV || "development", process.cwd())

const port = Number(process.env.PORT || 9000)

/**
 * Every URL Medusa hands to a browser — admin asset paths, uploaded file URLs,
 * CORS origins — has to be the *server* service's public URL, and the worker
 * service has no public domain of its own. So both services are given the same
 * MEDUSA_PUBLIC_URL rather than deriving it from RAILWAY_PUBLIC_DOMAIN, which is
 * only injected into the service that owns the domain.
 */
const publicUrl = (
  process.env.MEDUSA_PUBLIC_URL ||
  (process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : `http://localhost:${port}`)
).replace(/\/+$/, "")

const storefrontUrl = (process.env.STOREFRONT_URL || "").replace(/\/+$/, "")

const origins = (...values: (string | undefined)[]) =>
  Array.from(
    new Set(
      values
        .flatMap((value) => (value || "").split(","))
        .map((value) => value.trim())
        .filter(Boolean)
    )
  ).join(",")

const redisUrl = process.env.REDIS_URL

const s3Bucket = process.env.S3_BUCKET
const s3Endpoint = process.env.S3_ENDPOINT
const s3AccessKeyId = process.env.S3_ACCESS_KEY_ID
const s3SecretAccessKey = process.env.S3_SECRET_ACCESS_KEY
const useS3 = Boolean(s3Bucket && s3AccessKeyId && s3SecretAccessKey)

/**
 * Uploads are served back through this app's own /media/:key route, which signs
 * a short-lived read against the bucket. Railway's managed buckets answer 403 to
 * anonymous GETs and implement no bucket policy, so a raw bucket URL would leave
 * every product image broken for logged-out shoppers.
 */
const fileProvider = useS3
  ? {
      resolve: "@medusajs/medusa/file-s3",
      id: "s3",
      options: {
        file_url: `${publicUrl}/media`,
        authentication_method: "access-key",
        access_key_id: s3AccessKeyId,
        secret_access_key: s3SecretAccessKey,
        region: process.env.S3_REGION || "auto",
        bucket: s3Bucket,
        endpoint: s3Endpoint,
        // Railway's bucket ignores canned ACLs; omitting the header keeps the
        // same call working against S3 backends that reject them outright.
        acl: false,
        additional_client_config: {
          forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
        },
      },
    }
  : {
      resolve: "@medusajs/medusa/file-local",
      id: "local",
      options: {
        upload_dir: "static",
        backend_url: `${publicUrl}/static`,
      },
    }

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    redisUrl,
    workerMode: (process.env.MEDUSA_WORKER_MODE || "shared") as
      | "shared"
      | "worker"
      | "server",
    http: {
      port,
      storeCors: process.env.STORE_CORS || origins(storefrontUrl, publicUrl),
      adminCors: process.env.ADMIN_CORS || origins(publicUrl),
      authCors:
        process.env.AUTH_CORS || origins(publicUrl, storefrontUrl),
      jwtSecret: process.env.JWT_SECRET,
      cookieSecret: process.env.COOKIE_SECRET,
    },
  },
  admin: {
    disable: process.env.DISABLE_MEDUSA_ADMIN === "true",
  },
  modules: [
    {
      resolve: "@medusajs/medusa/file",
      options: { providers: [fileProvider] },
    },
    ...(redisUrl
      ? [
          {
            resolve: "@medusajs/medusa/caching",
            options: {
              providers: [
                {
                  resolve: "@medusajs/medusa/caching-redis",
                  id: "caching-redis",
                  is_default: true,
                  options: { redisUrl },
                },
              ],
            },
          },
          {
            resolve: "@medusajs/medusa/event-bus-redis",
            options: { redisUrl },
          },
          {
            resolve: "@medusajs/medusa/workflow-engine-redis",
            options: { redis: { redisUrl } },
          },
          {
            resolve: "@medusajs/medusa/locking",
            options: {
              providers: [
                {
                  resolve: "@medusajs/medusa/locking-redis",
                  id: "locking-redis",
                  is_default: true,
                  options: { redisUrl },
                },
              ],
            },
          },
        ]
      : []),
  ],
})
