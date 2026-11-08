// Cloudflare gives up after about 125 seconds of silence. A slow AI answer sends harmless spaces
// (JSON allows them before the object) so the connection stays open while it's being written.
//
//   const finish = keepAlive(res);
//   ...
//   finish(200, { ...answer });
//
// A fast answer is a normal response. A slow one has already sent status 200, so its real status
// goes in the body as httpStatus (public/js/lib/api.js reads it).

const KEEP_ALIVE_MS = Number(process.env.KEEP_ALIVE_MS) || 20000;

export function keepAlive(res) {
  let started = false;
  const timer = setInterval(() => {
    if (!started) {
      started = true;
      res.status(200).type('application/json');
    }
    res.write(' ');
  }, KEEP_ALIVE_MS);
  return (status, body) => {
    clearInterval(timer);
    if (started) return res.end(JSON.stringify({ ...body, httpStatus: status }));
    return res.status(status).json(body);
  };
}
