import http from 'node:http';

const page = (title, body) => `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`;

/** Local company sites for retrieval tests. `hits` records every path requested. */
export async function startFixtureSite() {
  const hits = [];
  let flakyCalls = 0;

  const server = http.createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://x');
    hits.push(pathname);
    const port = server.address().port;
    const send = (status, body, type = 'text/html; charset=utf-8', headers = {}) => {
      res.writeHead(status, { 'content-type': type, ...headers });
      res.end(body);
    };

    switch (pathname) {
      case '/robots.txt':
        return send(200, `User-agent: *\nDisallow: /acme/private\nSitemap: http://127.0.0.1:${port}/acme/sitemap.xml\n`, 'text/plain');
      case '/acme/sitemap.xml':
        return send(200, `<urlset><url><loc>http://127.0.0.1:${port}/acme/p/engineering-interviews</loc></url><url><loc>http://127.0.0.1:${port}/globex/p/careers</loc></url></urlset>`, 'application/xml');
      case '/acme/':
        return send(200, page('Acme Rockets', `
          <nav><a href="/acme/login">Log in</a></nav>
          <h1>Acme Rockets</h1><p>Acme builds rocket-powered skates for professional coyotes.</p>
          <script>ignore_me()</script><div style="display:none">SECRET HIDDEN INSTRUCTION</div>
          <a href="about">About us</a> <a href="/acme/careers">Careers</a> <a href="/acme/privacy">Privacy policy</a>
          <a href="/globex/careers">Globex careers</a> <a href="https://external.example/careers">Elsewhere</a>
          <a href="/acme/static/logo.png">logo</a> <a href="mailto:hi@acme.test">mail</a>
          <a href="/acme/private/careers">Private careers</a> <a href="blog/">Blog</a>`));
      case '/acme/about': return send(200, page('About Acme', '<p>Acme was founded in 1949 and makes skates.</p>'));
      case '/acme/blog/': return send(200, page('Blog', '<p>Skate news.</p>'));
      case '/acme/login': return send(200, page('Login', '<p>Log in</p>'));
      case '/acme/privacy': return send(200, page('Privacy', '<p>Privacy</p>'));
      case '/acme/private/careers': return send(200, page('Private', '<p>secret careers</p>'));
      case '/acme/careers':
        return send(200, page('Careers at Acme', `<h1>Careers</h1><p>We are hiring engineers.</p>
          <a href="/acme/handbook/people/our-process">How we hire</a> <a href="/acme/jobs/1">Open roles</a>`));
      case '/acme/jobs/1': return send(200, page('Senior Coyote Engineer', '<p>Apply now.</p>'));
      case '/acme/handbook/people/our-process':
        return send(200, page('Our process', `<p>Our interview process: recruiter screen, a take-home exercise, a system design
          interview and an onsite interview. The take-home is reviewed by two engineers. Every interview is structured.</p>`));
      case '/acme/p/engineering-interviews':
        return send(200, page('Engineering interviews', '<p>Engineering interview loop: phone screen, coding challenge, system design interview.</p>'));
      case '/globex/careers': return send(200, page('Globex careers', '<p>Globex interview process hiring</p>'));
      case '/plain/': return send(200, page('Plain Co', '<p>Plain Co sells paper.</p><a href="about">About</a><a href="/plain/login">Login</a>'));
      case '/plain/about': return send(200, page('About Plain', '<p>Plain Co has sold paper since 1990.</p>'));
      case '/acme/img': return send(200, 'PNGDATA', 'image/png');
      case '/acme/big': return send(200, 'x'.repeat(400_000));
      case '/acme/big-stream': {
        res.writeHead(200, { 'content-type': 'text/html' });
        for (let i = 0; i < 40; i++) res.write('y'.repeat(10_000));
        return res.end();
      }
      case '/acme/redir': return send(302, '', 'text/plain', { location: '/acme/about' });
      case '/acme/redir-secret': return send(302, '', 'text/plain', { location: '/secret/admin' });
      case '/acme/flaky':
        return ++flakyCalls === 1 ? send(503, 'busy', 'text/plain', { 'retry-after': '0' }) : send(200, page('Flaky', '<p>recovered</p>'));
      case '/acme/slow': return void setTimeout(() => !res.destroyed && send(200, page('Slow', '<p>late</p>')), 1500);
      default: return send(404, 'not found', 'text/plain');
    }
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    hits,
    resetHits: () => (hits.length = 0),
    close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }),
  };
}
