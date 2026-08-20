import { defineMiddlewares } from "@medusajs/framework/http"
import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import type { NextFunction, Request, Response } from "express"

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

/**
 * Medusa sets no security headers, and Railway's edge adds none of its own — so
 * the Admin dashboard ships framable, sniffable and without HSTS. `frame-ancestors`
 * is the only CSP directive here on purpose: the dashboard is a Vite bundle with
 * inline styles, and a stricter policy would break it. Browsers prefer
 * `frame-ancestors` over `X-Frame-Options`, which is kept for older ones.
 */
const SECURITY_HEADERS: Record<string, string> = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Content-Security-Policy": "frame-ancestors 'self'",
}

const securityHeaders = (
  _req: Request,
  res: Response,
  next: NextFunction
) => {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    res.setHeader(name, value)
  }
  next()
}

let bootstrapped = false

const bootstrap = (
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) => {
  if (!bootstrapped) {
    bootstrapped = true

    const app = req.app
    const previous = app.get("trust proxy")
    app.set("trust proxy", TRUST_ALL_PROXIES)
    console.log(
      `[medusa-railway] trust proxy widened from ${JSON.stringify(
        previous
      )} so req.ip resolves to the real client behind Railway's edge`
    )

    /**
     * The security headers have to cover the Admin dashboard, which Medusa's
     * admin loader serves with `express.static` — a layer registered
     * independently of this file. Appending the middleware and then moving its
     * layer to the front of the router puts it ahead of every route, static
     * assets included. If Express ever stops exposing the stack this degrades
     * to "headers on API routes only" rather than failing the boot.
     */
    try {
      app.use(securityHeaders)
      const stack = (app as any)._router?.stack
      if (Array.isArray(stack) && stack.length) {
        stack.unshift(stack.pop())
        console.log("[medusa-railway] security headers installed at the front of the router")
      } else {
        console.log("[medusa-railway] WARN: could not reach the router stack; security headers cover API routes only")
      }
    } catch (error) {
      console.log(`[medusa-railway] WARN: security header install failed: ${error}`)
    }
  }

  next()
}

export default defineMiddlewares({
  routes: [
    {
      matcher: "/*",
      middlewares: [bootstrap],
    },
  ],
})
