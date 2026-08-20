import { defineMiddlewares } from "@medusajs/framework/http"
import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

/**
 * Medusa hardcodes `app.set("trust proxy", 1)` in its express loader, with no
 * configuration hook. As a hop *count* that is wrong behind Railway: the edge
 * delivers `X-Forwarded-For: <real client>, <railway edge>`, so proxy-addr walks
 * one trusted hop from the socket and lands on Railway's own edge address — which
 * rotates per request. Every HTTP log line then records Railway instead of the
 * shopper, and any IP-keyed limiter added later would key on a moving target.
 *
 * Trusting every hop makes proxy-addr return the *leftmost* XFF entry instead,
 * which is the real client and is not forgeable: Railway's edge overwrites a
 * client-supplied `X-Forwarded-For`. proxy-addr rejects a `/0` prefix, hence the
 * four half-space CIDRs.
 */
const TRUST_ALL_PROXIES = ["0.0.0.0/1", "128.0.0.0/1", "::/1", "8000::/1"]

let trustProxyWidened = false

const widenTrustProxy = (
  req: MedusaRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction
) => {
  if (!trustProxyWidened) {
    trustProxyWidened = true
    const previous = req.app.get("trust proxy")
    req.app.set("trust proxy", TRUST_ALL_PROXIES)
    console.log(
      `[medusa-railway] trust proxy widened from ${JSON.stringify(
        previous
      )} so req.ip resolves to the real client behind Railway's edge`
    )
  }

  next()
}

export default defineMiddlewares({
  routes: [
    {
      matcher: "/*",
      middlewares: [widenTrustProxy],
    },
  ],
})
