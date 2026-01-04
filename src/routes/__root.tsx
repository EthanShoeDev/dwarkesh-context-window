import { HeadContent, Link, Scripts, createRootRoute } from '@tanstack/react-router';
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools';
import { TanStackDevtools } from '@tanstack/react-devtools';
import { createClientOnlyFn } from '@tanstack/react-start';

import { ModeToggle } from '@/components/mode-toggle';
import { buttonVariants } from '@/components/ui/button';
import { ThemeProvider } from '@/components/theme-provider';
import appCss from '../styles.css?url';

const renderDevtools = createClientOnlyFn(() => (
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
));

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
    <header className='border-b bg-background/80 backdrop-blur supports-backdrop-filter:bg-background/60'>
      <div className='max-w-5xl mx-auto flex items-center justify-between gap-6 px-6 py-5'>
        <div className='flex items-center gap-3'>
          <Link to='/' className='font-semibold tracking-tight text-base sm:text-lg'>
            Dwarkesh Context Window
          </Link>
          <nav className='flex items-center gap-1 text-base text-muted-foreground'>
            <Link to='/' className={buttonVariants({ variant: 'ghost', size: 'default' })}>
              Home
            </Link>
            <Link to='/llm' className={buttonVariants({ variant: 'ghost', size: 'default' })}>
              Posts
            </Link>
            <a
              href='https://github.com/EthanShoeDev/dwarkesh-context-window'
              target='_blank'
              rel='noreferrer'
              className={buttonVariants({ variant: 'ghost', size: 'default' })}
            >
              GitHub
            </a>
          </nav>
        </div>
        <div className='flex items-center gap-2'>
          <ModeToggle />
        </div>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className='border-t'>
      <div className='max-w-5xl mx-auto px-6 py-10 text-sm text-muted-foreground'>
        <div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
          <p>Not affiliated with Dwarkesh Patel.</p>
          <div className='flex items-center gap-4'>
            <a
              href='https://github.com/EthanShoeDev/dwarkesh-context-window'
              target='_blank'
              rel='noreferrer'
              className='underline underline-offset-4 hover:text-foreground'
            >
              Source
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang='en' suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <ThemeProvider defaultTheme='dark' storageKey='vite-ui-theme'>
          <div className='min-h-dvh flex flex-col'>
            <Header />
            <main className='flex-1'>
              <div className='max-w-5xl mx-auto px-6 py-10'>{children}</div>
            </main>
            <Footer />
          </div>
        </ThemeProvider>
        {renderDevtools()}
        <Scripts />
      </body>
    </html>
  );
}
