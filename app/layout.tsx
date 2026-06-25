import type {Metadata} from 'next';
import { Inter } from 'next/font/google';
import './globals.css'; // Global styles
import { AuthProvider } from '@/components/AuthProvider';
import { ThemeProvider, themeInitScript } from '@/components/ThemeProvider';
import { Toaster } from 'sonner';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
});

export const metadata: Metadata = {
  title: 'CRM AG LABS',
  description: 'Um sistema de CRM moderno e funcional.',
  icons: {
    icon: '/favicon.png',
  },
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="pt-BR" className={`${inter.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="font-sans bg-bg text-fg antialiased">
        <ThemeProvider>
          <AuthProvider>
            {children}
          </AuthProvider>
          <Toaster position="top-right" richColors />
        </ThemeProvider>
      </body>
    </html>
  );
}
