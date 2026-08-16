export default {
  async fetch(request) {
    return Response.json({
      ok: true,
      name: "pg-deepcatacomb",
      path: new URL(request.url).pathname,
    });
  },
};
