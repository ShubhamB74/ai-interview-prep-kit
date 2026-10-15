import './globals.css';

export const metadata = { title: 'Interview Prep Kit' };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:p-2 focus:bg-white">
          Skip to content
        </a>
        <main id="main" className="mx-auto max-w-3xl p-4 sm:p-8">
          {children}
        </main>
      </body>
    </html>
  );
}
