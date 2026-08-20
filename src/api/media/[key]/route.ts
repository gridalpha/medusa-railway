import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * Public read surface for uploaded files.
 *
 * Medusa stores an absolute `url` on every uploaded file and product image, and
 * shoppers fetch those with a plain <img> — no credentials. Railway's managed
 * buckets answer 403 to anonymous GETs and reject PutBucketPolicy, so the bucket
 * itself can never serve them. This route signs a short-lived read and redirects,
 * which keeps the bytes coming from storage rather than through Node.
 *
 * `medusa-config.ts` points the S3 provider's `file_url` at this path, so the
 * key is the last segment of the stored URL.
 */

const REDIRECT_MAX_AGE = 300
const SIGNED_URL_TTL = 3600

let client: S3Client | undefined

const getClient = (): S3Client | undefined => {
  const bucket = process.env.S3_BUCKET
  const accessKeyId = process.env.S3_ACCESS_KEY_ID
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY

  if (!bucket || !accessKeyId || !secretAccessKey) {
    return undefined
  }

  client ??= new S3Client({
    credentials: { accessKeyId, secretAccessKey },
    region: process.env.S3_REGION || "auto",
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
  })

  return client
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const s3 = getClient()

  if (!s3) {
    res.status(404).json({ message: "Object storage is not configured" })
    return
  }

  const key = String(req.params.key || "")

  if (!key || key.includes("..")) {
    res.status(400).json({ message: "Invalid key" })
    return
  }

  try {
    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: key }),
      { expiresIn: SIGNED_URL_TTL }
    )

    res.setHeader("Cache-Control", `public, max-age=${REDIRECT_MAX_AGE}`)
    res.redirect(302, url)
  } catch (error) {
    req.scope
      .resolve("logger")
      .error(`Failed to sign a read for media key "${key}": ${error}`)
    res.status(404).json({ message: "Not found" })
  }
}
