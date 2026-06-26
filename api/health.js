module.exports = function handler(_request, response) {
  response.status(200).json({
    ok: true,
    service: "dancr",
    runtime: "vercel-function",
    time: new Date().toISOString(),
  });
};
