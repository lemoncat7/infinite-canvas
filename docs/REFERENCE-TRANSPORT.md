# Reference image transport

The ownership boundary validates local assets and provides a short-lived signed
URL plus an execution-only original reader. It does not make private assets public
or store Base64 copies in jobs. Providers declare their transport policy.

- OpenAI-compatible video: URL first; explicit HTTP 400/422 image download failure
  without a task identifier permits one embedded retry. Embedded references share
  a conservative 768 KiB budget; oversized images become temporary JPEG copies.
  This budget is a client transport choice, not a claimed universal upstream limit.
- Agnes legacy video: URL/CDN behavior retained; the same narrow rejection rule
  gates embedded fallback.
- Agnes 2.5 video: embedded images, with its existing dimensions and byte limits.
- Agnes image: URL first with the common fallback rule.
- OpenAI image edits and other adapters: retain existing upload/embedded protocols.

Timeouts, authentication failures, rate limits, server errors and active/unknown tasks
must not trigger reference resubmission. An accepted video task may retry once with
embedded images only after a confirmed `failed` terminal response explicitly reports
image download failure and no output. A task already using embedded images cannot
take this fallback again. The intermediate failure is not published to local billing
or job status; only the final outcome settles the local job. This does not assert
that external providers refund failed attempts.
The queue no longer retries entire video
runs on transient errors. Public URLs must be accessible from the provider; local
original readers avoid fetching signed URLs back through public DNS on fallback.
Image downloads never inherit the provider API authorization header.

## Download diagnostics

The signed-image API logs `reference_download_started`, followed by exactly one
`reference_download_finished` or `reference_download_interrupted`. Fields include
asset ID, request ID, expected payload bytes, socket byte delta (includes HTTP
overhead), status, elapsed time, and rejection reason. A finished response means
data was handed to the socket, **not** confirmation of receipt by xAI.

Nginx logs `reference_download_proxy` with the matching response request ID,
upstream response length/status/time, downstream body bytes, request time and
completion. Neither structured access log contains URL queries or signatures.
Video polling logs the failed task ID, reference transport, failure category and
whether a terminal embedded fallback is eligible, without raw upstream bodies.

Run `node scripts/test-download-logging.mjs` after building to verify logging.

Run `npm run build && node scripts/test-reference-transport.mjs` in `api/`.
