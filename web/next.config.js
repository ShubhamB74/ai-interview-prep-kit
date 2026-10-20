/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  transpilePackages: ['@prepkit/shared'],
  // Production: browser -> this site (/api/...) -> backend. Same-origin requests mean first-party cookies and no CORS.
  async rewrites() {
    return process.env.API_URL ? [{ source: '/api/:path*', destination: `${process.env.API_URL.replace(/\/$/, '')}/api/:path*` }] : [];
  },
};
