import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';
export default function Root({children}:PropsWithChildren) {
  return <html lang="en"><head><meta charSet="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><meta name="theme-color" content="#A8462E"/><meta name="description" content="KampusOne brings your classes, study tools and campus community together."/><link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48"/><link rel="icon" href="/icon-32.png" type="image/png" sizes="32x32"/><link rel="apple-touch-icon" href="/icon-180.png"/><link rel="manifest" href="/manifest.webmanifest"/><ScrollViewStyleReset/></head><body>{children}</body></html>;
}
