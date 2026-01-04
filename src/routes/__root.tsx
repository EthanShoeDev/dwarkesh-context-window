import { HeadContent, Link, Scripts, createRootRoute } from '@tanstack/react-router';
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools';
import { TanStackDevtools } from '@tanstack/react-devtools';

import appCss from '../styles.css?url';

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'Dwarkesh Context Window',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
    ],
  }),

  shellComponent: RootDocument,
});

function Header() {
  return (
    <header className='px-6 py-4 border-b border-slate-200/20'>
      <div className='max-w-5xl mx-auto flex items-center justify-between gap-6'>
        <div className='flex items-center gap-4'>
          <Link to='/' className='font-semibold'>
            Dwarkesh Context Window
          </Link>
          <nav className='flex items-center gap-4 text-sm'>
            <Link to='/'>Home</Link>
            <Link to='/llm'>Posts</Link>
            <a
              href='https://github.com/EthanShoeDev/dwarkesh-context-window'
              target='_blank'
              rel='noreferrer'
            >
              GitHub
            </a>
          </nav>
        </div>
      </div>
    </header>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang='en'>
      <head>
        <HeadContent />
      </head>
      <body>
        <Header />
        {children}
        <TanStackDevtools
          config={{
            position: 'bottom-right',
          }}
          plugins={[
            {
              name: 'Tanstack Router',
              render: <TanStackRouterDevtoolsPanel />,
            },
          ]}
        />
        <Scripts />
      </body>
    </html>
  );
}
